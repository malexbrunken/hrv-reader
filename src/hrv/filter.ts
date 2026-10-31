import { median } from './stats'

/** Inclusive physiological window, in milliseconds. */
export const RR_MIN_MS = 300
export const RR_MAX_MS = 2000

/**
 * Beats farther than this fraction from the local median are dropped.
 * The comparison is strict: a beat exactly 20% away is kept.
 */
export const MEDIAN_DEVIATION = 0.2

/** Neighbors considered on each side of a beat. The beat itself is excluded. */
export const MEDIAN_RADIUS = 2

export interface FilterResult {
  accepted: number[]
  acceptedIndex: number[]
  removedCount: number
  /** Removed beats as a percentage of every received interval. 0 when nothing arrived. */
  removedPct: number
  total: number
}

/**
 * Drop RR intervals outside 300–2000 ms, then drop beats that differ by more
 * than 20% from the median of nearby in-range beats.
 *
 * The window is the original series, two beats to either side, excluding the
 * candidate. Out-of-range neighbors are left out of the median so a dropout
 * does not define "normal". An in-range beat with no in-range neighbors is kept.
 */
export function filterRrIntervals(rr: number[]): FilterResult {
  const total = rr.length
  const inRange = rr.map((value) => value >= RR_MIN_MS && value <= RR_MAX_MS)
  const accepted: number[] = []
  const acceptedIndex: number[] = []

  for (let i = 0; i < rr.length; i++) {
    if (!inRange[i]) continue
    const value = rr[i]
    if (value == null) continue

    const window: number[] = []
    const start = Math.max(0, i - MEDIAN_RADIUS)
    const end = Math.min(rr.length - 1, i + MEDIAN_RADIUS)
    for (let j = start; j <= end; j++) {
      if (j === i || !inRange[j]) continue
      const neighbor = rr[j]
      if (neighbor != null) window.push(neighbor)
    }

    if (window.length > 0) {
      const mid = median(window)
      if (!(mid > 0) || Math.abs(value - mid) / mid > MEDIAN_DEVIATION) continue
    }

    accepted.push(value)
    acceptedIndex.push(i)
  }

  const removedCount = total - accepted.length
  return {
    accepted,
    acceptedIndex,
    removedCount,
    removedPct: total === 0 ? 0 : (removedCount / total) * 100,
    total,
  }
}
