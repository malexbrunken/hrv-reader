import { describe, expect, it } from 'vitest'
import { filterRrIntervals } from './filter'
import { computeHrv, meanHeartRate, pnn50, poincare, rmssd, sdnn } from './metrics'
import { bandPower, beatTimes, interpolateSeries, welchPsd } from './spectrum'
import { generateRrSeries } from './simulate'

const alternating = [1000, 1050, 1000, 1050, 1000]

describe('artifact filter', () => {
  it('drops intervals outside 300–2000 ms and reports the share removed', () => {
    const result = filterRrIntervals([1000, 1000, 1000, 1600, 1000, 100, 1000, 1000, 1000, 1000])
    expect(result.accepted).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000])
    expect(result.removedCount).toBe(2)
    expect(result.removedPct).toBe(20)
    expect(result.total).toBe(10)
  })

  it('keeps the inclusive range and a beat exactly 20% from the local median', () => {
    expect(filterRrIntervals([300, 300, 300]).accepted).toEqual([300, 300, 300])
    expect(filterRrIntervals([2000, 2000, 2000]).accepted).toEqual([2000, 2000, 2000])
    expect(filterRrIntervals([299, 300, 300]).accepted).toEqual([300, 300])
    expect(filterRrIntervals([2001, 2000, 2000]).accepted).toEqual([2000, 2000])

    const exact = filterRrIntervals([1000, 1000, 1200, 1000, 1000])
    expect(exact.accepted).toEqual([1000, 1000, 1200, 1000, 1000])

    const over = filterRrIntervals([1000, 1000, 1201, 1000, 1000])
    expect(over.accepted).toEqual([1000, 1000, 1000, 1000])

    const under = filterRrIntervals([1000, 1000, 799, 1000, 1000])
    expect(under.accepted).toEqual([1000, 1000, 1000, 1000])
  })

  it('keeps an in-range beat that has no in-range neighbors', () => {
    expect(filterRrIntervals([1000]).removedPct).toBe(0)
    expect(filterRrIntervals([100]).removedPct).toBe(100)
    expect(filterRrIntervals([]).removedPct).toBe(0)
  })

  it('does not let an out-of-range neighbor set the median', () => {
    const result = filterRrIntervals([1000, 100, 1000])
    expect(result.acceptedIndex).toEqual([0, 2])
    expect(result.accepted).toEqual([1000, 1000])
  })
})

describe('time-domain HRV', () => {
  it('computes RMSSD, SDNN, pNN50, and mean HR on a known series', () => {
    expect(rmssd(alternating)).toBe(50)
    expect(sdnn(alternating)).toBeCloseTo(Math.sqrt(750), 8)
    expect(pnn50(alternating)).toBe(0)
    expect(meanHeartRate(alternating)).toBeCloseTo(60000 / 1020, 8)
    expect(pnn50([1000, 1060, 1070])).toBe(50)
    expect(pnn50([1000, 1060, 1000])).toBe(100)
    expect(rmssd([1000])).toBeNull()
    expect(sdnn([1000])).toBeNull()
  })

  it('computes Poincaré SD1 and SD2 from the sample spread of the pairs', () => {
    const cloud = poincare(alternating)
    expect(cloud.sd1).toBeCloseTo(Math.sqrt(10000 / 3) / Math.SQRT2, 8)
    expect(cloud.sd2).toBeCloseTo(0, 8)
    expect(poincare([1000, 1100])).toEqual({ sd1: null, sd2: null })
  })

  it('builds the Elite-style score from the natural log of RMSSD', () => {
    const summary = computeHrv(alternating, { durationSec: 120 })
    expect(summary.rmssd).toBe(50)
    expect(summary.lnRmssd).toBeCloseTo(Math.log(50), 10)
    expect(summary.score).toBeCloseTo(Math.log(50) * 20, 10)
    expect(summary.beatsRemovedPct).toBe(0)
    expect(summary.filteredRr).toEqual(alternating)
    expect(summary.lfHf).toBeNull()
    expect(summary.lfHfReliable).toBe(false)
  })

  it('leaves the log score empty when RMSSD is zero and falls back for mean HR', () => {
    const flat = computeHrv([1000, 1000, 1000, 1000], { durationSec: 120 })
    expect(flat.rmssd).toBe(0)
    expect(flat.lnRmssd).toBeNull()
    expect(flat.score).toBeNull()

    const dropped = computeHrv([100], { durationSec: 120, fallbackHr: 58 })
    expect(dropped.meanHr).toBe(58)
    expect(dropped.beatsRemovedPct).toBe(100)
    expect(computeHrv([], { durationSec: 120, fallbackHr: 61 }).meanHr).toBe(61)
  })
})

describe('LF/HF spectrum', () => {
  it('interpolates the NN tachogram onto a 4 Hz grid', () => {
    expect(beatTimes([1000, 500])).toEqual([1, 1.5])
    const flat = interpolateSeries([1, 2, 3], [1000, 1000, 1000], 4)
    expect(flat).toHaveLength(9)
    expect(flat.every((value) => value === 1000)).toBe(true)

    const ramp = interpolateSeries([0.5, 2], [500, 1500], 4)
    expect(ramp[0]).toBe(500)
    expect(ramp[ramp.length - 1]).toBe(1500)
    expect(ramp[3]).toBeCloseTo(1000, 8)
  })

  it('recovers sine-wave power in the LF and HF bands', () => {
    const fs = 4
    const seconds = 180
    const signal: number[] = []
    for (let i = 0; i < fs * seconds; i++) {
      const t = i / fs
      signal.push(50 * Math.sin(2 * Math.PI * 0.1 * t) + 20 * Math.sin(2 * Math.PI * 0.25 * t))
    }
    const { freqs, psd } = welchPsd(signal, fs)
    const lf = bandPower(freqs, psd, 0.04, 0.15)
    const hf = bandPower(freqs, psd, 0.15, 0.4)
    expect(lf).toBeGreaterThan(900)
    expect(lf).toBeLessThan(1600)
    expect(hf).toBeGreaterThan(120)
    expect(hf).toBeLessThan(320)
    expect(lf / hf).toBeGreaterThan(3)
    expect(lf / hf).toBeLessThan(8)

    const variance = signal.reduce((sum, value) => sum + value * value, 0) / signal.length
    const total = bandPower(freqs, psd, 0, fs / 2)
    expect(total).toBeGreaterThan(variance * 0.75)
    expect(total).toBeLessThan(variance * 1.25)
  })

  it('mean-centers a constant signal down to an empty spectrum', () => {
    const { psd } = welchPsd(Array<number>(512).fill(5), 4)
    expect(Math.max(...psd)).toBeLessThan(1e-8)
  })

  it('marks LF/HF unreliable under two minutes and estimates it on a longer series', () => {
    const rr = modulated(180, 40, 12)
    const reliable = computeHrv(rr, { durationSec: 180 })
    const brief = computeHrv(rr, { durationSec: 60 })
    expect(reliable.lfHf).not.toBeNull()
    expect(reliable.lf).not.toBeNull()
    expect(reliable.hf).not.toBeNull()
    expect(reliable.lfHfReliable).toBe(true)
    expect(brief.lfHf).not.toBeNull()
    expect(brief.lfHfReliable).toBe(false)
    expect(reliable.score).toBeCloseTo(Math.log(reliable.rmssd ?? 1) * 20, 10)

    const hfHeavy = computeHrv(modulated(180, 8, 45), { durationSec: 180 })
    const lfHeavy = computeHrv(modulated(180, 45, 8), { durationSec: 180 })
    expect(hfHeavy.lfHf ?? 1).toBeLessThan(1)
    expect(lfHeavy.lfHf ?? 0).toBeGreaterThan(1)
  })
})

describe('demo RR generator', () => {
  it('is deterministic and stays near a resting rhythm', () => {
    const first = generateRrSeries(80, 42)
    expect(generateRrSeries(80, 42)).toEqual(first)
    expect(first.every((value) => value >= 250 && value <= 2400)).toBe(true)
    const typical = first.filter((value) => value >= 700 && value <= 1300)
    expect(typical.length).toBeGreaterThan(70)
  })
})

function modulated(seconds: number, lfAmp: number, hfAmp: number): number[] {
  const rr: number[] = []
  let t = 0
  while (t < seconds) {
    const value =
      1000 + lfAmp * Math.sin(2 * Math.PI * 0.1 * t) + hfAmp * Math.sin(2 * Math.PI * 0.25 * t)
    rr.push(value)
    t += value / 1000
  }
  return rr
}
