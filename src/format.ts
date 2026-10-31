export function fmt(value: number | null | undefined, digits: number): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

/** Clock for a countdown. Each displayed second lasts until that second elapses. */
export function formatCountdown(remainingSec: number): string {
  const secs = Math.max(0, Math.ceil(remainingSec - 1e-9))
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function formatDuration(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '—'
  if (durationSec % 60 === 0) return `${durationSec / 60} min`
  return `${Math.round(durationSec)} s`
}

export function formatWhen(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(time))
}
