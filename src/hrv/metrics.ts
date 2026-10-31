import type { Session, SessionTags } from '../model'
import { emptyTags } from '../model'
import { filterRrIntervals } from './filter'
import { lfHfRatio } from './spectrum'
import { mean, sampleStd } from './stats'

export interface HrvSummary {
  meanHr: number | null
  rmssd: number | null
  lnRmssd: number | null
  /** ln(RMSSD) × 20. Null when RMSSD is not a positive finite number. */
  score: number | null
  sdnn: number | null
  pnn50: number | null
  lf: number | null
  hf: number | null
  lfHf: number | null
  /** False when the session is under 2 minutes or the spectrum could not be estimated. */
  lfHfReliable: boolean
  sd1: number | null
  sd2: number | null
  beatsTotal: number
  beatsRemovedPct: number
  filteredRr: number[]
}

export interface ComputeOptions {
  durationSec: number
  /** Used for mean HR only when no clean RR intervals remain. */
  fallbackHr?: number | null
}

/** Root mean square of successive differences, in milliseconds. */
export function rmssd(rr: number[]): number | null {
  if (rr.length < 2) return null
  let acc = 0
  for (let i = 1; i < rr.length; i++) {
    const prev = rr[i - 1] ?? 0
    const next = rr[i] ?? 0
    const diff = next - prev
    acc += diff * diff
  }
  return Math.sqrt(acc / (rr.length - 1))
}

/** Sample standard deviation of NN intervals, in milliseconds. */
export function sdnn(rr: number[]): number | null {
  return sampleStd(rr)
}

/** Percent of successive absolute differences greater than 50 ms. */
export function pnn50(rr: number[]): number | null {
  if (rr.length < 2) return null
  let over = 0
  const pairs = rr.length - 1
  for (let i = 1; i < rr.length; i++) {
    const prev = rr[i - 1] ?? 0
    const next = rr[i] ?? 0
    if (Math.abs(next - prev) > 50) over++
  }
  return (over / pairs) * 100
}

/** 60 000 / mean NN interval. */
export function meanHeartRate(rr: number[]): number | null {
  const meanRr = mean(rr)
  if (meanRr == null || !(meanRr > 0)) return null
  return 60000 / meanRr
}

/**
 * Poincaré SD1 and SD2.
 *
 * SD1 is the sample standard deviation of successive differences divided by √2
 * (the spread perpendicular to the identity line). SD2 is the sample standard
 * deviation of the pairs projected along the identity line. Both need at least
 * two successive pairs.
 */
export function poincare(rr: number[]): { sd1: number | null; sd2: number | null } {
  if (rr.length < 3) return { sd1: null, sd2: null }
  const perpendicular: number[] = []
  const along: number[] = []
  for (let i = 1; i < rr.length; i++) {
    const x = rr[i - 1] ?? 0
    const y = rr[i] ?? 0
    perpendicular.push((x - y) / Math.SQRT2)
    along.push((x + y) / Math.SQRT2)
  }
  return {
    sd1: sampleStd(perpendicular),
    sd2: sampleStd(along),
  }
}

export function computeHrv(rawRrMs: number[], options: ComputeOptions): HrvSummary {
  const filtered = filterRrIntervals(rawRrMs)
  const nn = filtered.accepted
  const rmssdMs = rmssd(nn)
  const lnRmssd = rmssdMs != null && rmssdMs > 0 ? Math.log(rmssdMs) : null
  const score = lnRmssd != null ? lnRmssd * 20 : null
  const bands = lfHfRatio(nn)
  const hrFromRr = meanHeartRate(nn)
  const fallback = options.fallbackHr
  const meanHr =
    hrFromRr ?? (fallback != null && Number.isFinite(fallback) && fallback > 0 ? fallback : null)
  const cloud = poincare(nn)
  const reliable = options.durationSec >= 120 && bands.ratio != null && Number.isFinite(bands.ratio)

  return {
    meanHr,
    rmssd: rmssdMs,
    lnRmssd,
    score,
    sdnn: sdnn(nn),
    pnn50: pnn50(nn),
    lf: bands.lf,
    hf: bands.hf,
    lfHf: bands.ratio,
    lfHfReliable: reliable,
    sd1: cloud.sd1,
    sd2: cloud.sd2,
    beatsTotal: filtered.total,
    beatsRemovedPct: filtered.removedPct,
    filteredRr: nn.slice(),
  }
}

export function createSession(input: {
  id?: string
  startedAt: string
  durationSec: number
  source: Session['source']
  deviceName: string | null
  batteryPercent: number | null
  summary: HrvSummary
  rawRr: number[]
  tags?: SessionTags
}): Session {
  const { summary } = input
  return {
    id: input.id ?? crypto.randomUUID(),
    startedAt: input.startedAt,
    durationSec: input.durationSec,
    source: input.source,
    deviceName: input.deviceName,
    batteryPercent: input.batteryPercent,
    meanHr: summary.meanHr,
    rmssd: summary.rmssd,
    lnRmssd: summary.lnRmssd,
    score: summary.score,
    sdnn: summary.sdnn,
    pnn50: summary.pnn50,
    lf: summary.lf,
    hf: summary.hf,
    lfHf: summary.lfHf,
    lfHfReliable: summary.lfHfReliable,
    sd1: summary.sd1,
    sd2: summary.sd2,
    beatsTotal: summary.beatsTotal,
    beatsRemovedPct: summary.beatsRemovedPct,
    rawRr: input.rawRr.slice(),
    filteredRr: summary.filteredRr.slice(),
    tags: input.tags ?? emptyTags(),
  }
}
