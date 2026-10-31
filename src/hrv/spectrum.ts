/**
 * Frequency-domain HRV.
 *
 * The filtered NN series is placed in time by the cumulative sum of its
 * intervals, linearly interpolated to 4 Hz, and turned into a power spectral
 * density with Welch's method (Hann window, 50% overlap). LF is 0.04–0.15 Hz
 * and HF is 0.15–0.40 Hz.
 */

export const HRV_SAMPLE_HZ = 4
export const LF_BAND: readonly [number, number] = [0.04, 0.15]
export const HF_BAND: readonly [number, number] = [0.15, 0.4]

export interface Spectrum {
  freqs: number[]
  psd: number[]
}

export interface BandPowers {
  lf: number | null
  hf: number | null
  ratio: number | null
}

/** Evenly sample an irregular NN tachogram. Times are seconds, values milliseconds. */
export function interpolateSeries(times: number[], values: number[], fs: number): number[] {
  const count = Math.min(times.length, values.length)
  if (count < 2 || !(fs > 0)) return []
  const t0 = times[0]
  const t1 = times[count - 1]
  const v0 = values[0]
  if (t0 == null || t1 == null || v0 == null || !(t1 > t0)) return []

  const samples = Math.floor((t1 - t0) * fs + 1e-9) + 1
  const out: number[] = []
  let segment = 1
  for (let i = 0; i < samples; i++) {
    const t = t0 + i / fs
    if (t > t1 + 1e-9) break
    while (segment < count - 1 && (times[segment] ?? t) < t) segment++
    const tA = times[segment - 1]
    const tB = times[segment]
    const vA = values[segment - 1]
    const vB = values[segment]
    if (tA == null || tB == null || vA == null || vB == null) continue
    const span = tB - tA
    const alpha = span === 0 ? 0 : (t - tA) / span
    out.push(vA + alpha * (vB - vA))
  }
  return out
}

/** Beat times (seconds) from the cumulative sum of RR intervals (milliseconds). */
export function beatTimes(rrMs: number[]): number[] {
  const times: number[] = []
  let acc = 0
  for (const rr of rrMs) {
    acc += rr / 1000
    times.push(acc)
  }
  return times
}

function hann(length: number): Float64Array {
  const window = new Float64Array(length)
  if (length <= 1) {
    if (length === 1) window[0] = 1
    return window
  }
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length)
  }
  return window
}

/** In-place radix-2 Cooley–Tukey FFT. `n` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n === 0 || (n & (n - 1)) !== 0 || im.length !== n) {
    throw new Error('FFT length must be a power of two.')
  }

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const reI = re[i] ?? 0
      const reJ = re[j] ?? 0
      const imI = im[i] ?? 0
      const imJ = im[j] ?? 0
      re[i] = reJ
      re[j] = reI
      im[i] = imJ
      im[j] = imI
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wLenRe = Math.cos(angle)
    const wLenIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      const half = len >> 1
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k] ?? 0
        const aIm = im[i + k] ?? 0
        const bRe = re[i + k + half] ?? 0
        const bIm = im[i + k + half] ?? 0
        const vRe = bRe * wRe - bIm * wIm
        const vIm = bRe * wIm + bIm * wRe
        re[i + k] = aRe + vRe
        im[i + k] = aIm + vIm
        re[i + k + half] = aRe - vRe
        im[i + k + half] = aIm - vIm
        const nextRe = wRe * wLenRe - wIm * wLenIm
        wIm = wRe * wLenIm + wIm * wLenRe
        wRe = nextRe
      }
    }
  }
}

function segmentLength(sampleCount: number): number {
  let length = 256
  while (length > sampleCount) length >>= 1
  return length
}

/**
 * One-sided Welch power spectral density (units of input² / Hz).
 * Each segment is mean-centered, then windowed with a periodic Hann window.
 */
export function welchPsd(signal: number[], fs: number): Spectrum {
  const nperseg = segmentLength(signal.length)
  if (!(fs > 0) || nperseg < 16) return { freqs: [], psd: [] }

  const overlap = nperseg >> 1
  const step = nperseg - overlap
  const window = hann(nperseg)
  let windowPower = 0
  for (let i = 0; i < window.length; i++) {
    const weight = window[i] ?? 0
    windowPower += weight * weight
  }
  if (windowPower === 0) return { freqs: [], psd: [] }

  const nfreqs = nperseg / 2 + 1
  const acc = new Float64Array(nfreqs)
  let segments = 0

  for (let start = 0; start + nperseg <= signal.length; start += step) {
    let segMean = 0
    for (let i = 0; i < nperseg; i++) segMean += signal[start + i] ?? 0
    segMean /= nperseg

    const re = new Float64Array(nperseg)
    const im = new Float64Array(nperseg)
    for (let i = 0; i < nperseg; i++) {
      re[i] = ((signal[start + i] ?? 0) - segMean) * (window[i] ?? 0)
    }
    fft(re, im)

    const nyquist = nperseg / 2
    for (let k = 0; k < nfreqs; k++) {
      const real = re[k] ?? 0
      const imag = im[k] ?? 0
      const mag2 = real * real + imag * imag
      const sided = k === 0 || k === nyquist ? 1 : 2
      acc[k] = (acc[k] ?? 0) + (sided * mag2) / (fs * windowPower)
    }
    segments++
  }

  if (segments === 0) return { freqs: [], psd: [] }

  const freqs: number[] = []
  const psd: number[] = []
  for (let k = 0; k < nfreqs; k++) {
    freqs.push((k * fs) / nperseg)
    psd.push((acc[k] ?? 0) / segments)
  }
  return { freqs, psd }
}

/** Integrate a density with the trapezoid rule, interpolating partial edge bins. */
export function bandPower(freqs: number[], psd: number[], lo: number, hi: number): number {
  if (freqs.length < 2 || !(hi > lo)) return 0
  let power = 0
  const last = Math.min(freqs.length, psd.length) - 1
  for (let i = 0; i < last; i++) {
    const f0 = freqs[i]
    const f1 = freqs[i + 1]
    const p0 = psd[i]
    const p1 = psd[i + 1]
    if (f0 == null || f1 == null || p0 == null || p1 == null) continue
    if (f1 <= lo || f0 >= hi) continue
    const span = f1 - f0
    if (!(span > 0)) continue
    const left = Math.max(f0, lo)
    const right = Math.min(f1, hi)
    if (right <= left) continue
    const y0 = p0 + (p1 - p0) * ((left - f0) / span)
    const y1 = p0 + (p1 - p0) * ((right - f0) / span)
    power += ((y0 + y1) / 2) * (right - left)
  }
  return power
}

/**
 * LF/HF of an NN interval series already cleaned of artifacts.
 * Returns nulls when the interpolated series is shorter than 16 seconds.
 */
export function lfHfRatio(rrMs: number[], fs = HRV_SAMPLE_HZ): BandPowers {
  const times = beatTimes(rrMs)
  const samples = interpolateSeries(times, rrMs, fs)
  if (samples.length < fs * 16) return { lf: null, hf: null, ratio: null }

  const { freqs, psd } = welchPsd(samples, fs)
  if (freqs.length < 2) return { lf: null, hf: null, ratio: null }

  const lf = bandPower(freqs, psd, LF_BAND[0], LF_BAND[1])
  const hf = bandPower(freqs, psd, HF_BAND[0], HF_BAND[1])
  if (!(hf > 0) || !Number.isFinite(lf) || !Number.isFinite(hf)) {
    return { lf: Number.isFinite(lf) ? lf : null, hf: Number.isFinite(hf) ? hf : null, ratio: null }
  }
  return { lf, hf, ratio: lf / hf }
}
