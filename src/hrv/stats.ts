/** Arithmetic mean. Returns null for an empty list. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

/**
 * Sample standard deviation (divide by n − 1).
 * Returns null when fewer than two values are present.
 */
export function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null
  const center = mean(values)
  if (center == null) return null
  let acc = 0
  for (const value of values) {
    const delta = value - center
    acc += delta * delta
  }
  return Math.sqrt(acc / (values.length - 1))
}

/** Median. Even counts use the mean of the two central values. */
export function median(values: number[]): number {
  if (values.length === 0) throw new Error('Cannot take the median of an empty list.')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  const left = sorted[mid - 1] ?? 0
  const right = sorted[mid] ?? 0
  return (left + right) / 2
}
