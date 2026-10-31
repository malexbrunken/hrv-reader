import { filterRrIntervals } from '../hrv/filter'
import type { Session, SessionTags } from '../model'

export const STORAGE_KEY = 'hrv-reader.sessions.v1'
export const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface SessionTrend extends Session {
  rollingScore: number | null
  rollingHr: number | null
}

export interface MergeResult {
  sessions: Session[]
  added: number
  skipped: number
}

const CSV_COLUMNS = [
  'id',
  'started_at',
  'duration_sec',
  'source',
  'device_name',
  'battery_percent',
  'mean_hr',
  'rmssd',
  'ln_rmssd',
  'score',
  'sdnn',
  'pnn50',
  'lf',
  'hf',
  'lf_hf',
  'lf_hf_reliable',
  'sd1',
  'sd2',
  'beats_total',
  'beats_removed_pct',
  'sleep',
  'soreness',
  'stress',
  'notes',
  'raw_rr_ms',
  'filtered_rr_ms',
] as const

function browserStorage(): StorageLike {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage is not available in this browser.')
  }
  return localStorage
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function tagValue(value: unknown): number | null {
  const parsed = finiteOrNull(value)
  if (parsed == null || !Number.isInteger(parsed) || parsed < 1 || parsed > 5) return null
  return parsed
}

function numberList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => finiteOrNull(item)).filter((item): item is number => item != null)
  }
  if (typeof value === 'string') return parseRrCell(value)
  return []
}

function parseRrCell(cell: string): number[] {
  if (!cell.trim()) return []
  return cell
    .split(/[|;]/)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value))
}

export function sanitizeSession(value: unknown): Session | null {
  if (value == null || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const startedAt = typeof row.startedAt === 'string' ? row.startedAt : ''
  if (!id || !Number.isFinite(Date.parse(startedAt))) return null

  const duration = finiteOrNull(row.durationSec)
  if (duration == null || duration < 0) return null

  const source = row.source === 'demo' ? 'demo' : 'bluetooth'

  const rawRr = numberList(row.rawRr)
  const filteredGiven = numberList(row.filteredRr)
  const tagsRaw = row.tags
  const tagsObj = tagsRaw != null && typeof tagsRaw === 'object' ? (tagsRaw as Record<string, unknown>) : {}
  const notes = typeof tagsObj.notes === 'string' ? tagsObj.notes.slice(0, 2000) : ''
  const tags: SessionTags = {
    sleep: tagValue(tagsObj.sleep),
    soreness: tagValue(tagsObj.soreness),
    stress: tagValue(tagsObj.stress),
    notes,
  }

  const deviceName = typeof row.deviceName === 'string' && row.deviceName.trim() ? row.deviceName : null
  const battery = finiteOrNull(row.batteryPercent)
  const beatsTotal = finiteOrNull(row.beatsTotal)

  return {
    id,
    startedAt,
    durationSec: duration,
    source,
    deviceName,
    batteryPercent: battery != null && battery >= 0 && battery <= 100 ? Math.round(battery) : null,
    meanHr: finiteOrNull(row.meanHr),
    rmssd: finiteOrNull(row.rmssd),
    lnRmssd: finiteOrNull(row.lnRmssd),
    score: finiteOrNull(row.score),
    sdnn: finiteOrNull(row.sdnn),
    pnn50: finiteOrNull(row.pnn50),
    lf: finiteOrNull(row.lf),
    hf: finiteOrNull(row.hf),
    lfHf: finiteOrNull(row.lfHf),
    lfHfReliable: row.lfHfReliable === true || row.lfHfReliable === 'true',
    sd1: finiteOrNull(row.sd1),
    sd2: finiteOrNull(row.sd2),
    beatsTotal: beatsTotal != null && beatsTotal >= 0 ? beatsTotal : rawRr.length,
    beatsRemovedPct: finiteOrNull(row.beatsRemovedPct) ?? 0,
    rawRr,
    filteredRr: filteredGiven.length > 0 || rawRr.length === 0 ? filteredGiven : filterRrIntervals(rawRr).accepted,
    tags,
  }
}

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export function loadSessions(storage?: StorageLike): Session[] {
  try {
    const store = storage ?? browserStorage()
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return sortSessions(parsed.map(sanitizeSession).filter((session): session is Session => session != null))
  } catch {
    return []
  }
}

export function saveSessions(sessions: Session[], storage?: StorageLike): void {
  const store = storage ?? browserStorage()
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(sortSessions(sessions)))
  } catch {
    throw new Error(
      'Could not save sessions in this browser. Export a backup and delete older sessions if storage is full.',
    )
  }
}

export function mergeSessions(existing: Session[], incoming: Session[]): MergeResult {
  const ids = new Set(existing.map((session) => session.id))
  const added: Session[] = []
  let skipped = 0
  for (const session of incoming) {
    if (ids.has(session.id)) {
      skipped++
      continue
    }
    ids.add(session.id)
    added.push(session)
  }
  return {
    sessions: sortSessions([...existing, ...added]),
    added: added.length,
    skipped,
  }
}

/**
 * 7-day rolling means of score and resting HR.
 * A session exactly 7 × 24 hours earlier is included. Null metrics are skipped.
 * The returned array keeps the input order.
 */
export function withRollingAverages(sessions: Session[], windowMs = ROLLING_WINDOW_MS): SessionTrend[] {
  const chronological = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  const byId = new Map<string, { rollingScore: number | null; rollingHr: number | null }>()

  for (const session of chronological) {
    const t = Date.parse(session.startedAt)
    if (!Number.isFinite(t)) {
      byId.set(session.id, { rollingScore: null, rollingHr: null })
      continue
    }
    const scores: number[] = []
    const hrs: number[] = []
    for (const other of chronological) {
      const otherTime = Date.parse(other.startedAt)
      if (!Number.isFinite(otherTime) || otherTime > t || t - otherTime > windowMs) continue
      if (other.score != null && Number.isFinite(other.score)) scores.push(other.score)
      if (other.meanHr != null && Number.isFinite(other.meanHr)) hrs.push(other.meanHr)
    }
    byId.set(session.id, {
      rollingScore: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
      rollingHr: hrs.length ? hrs.reduce((sum, value) => sum + value, 0) / hrs.length : null,
    })
  }

  return sessions.map((session) => ({
    ...session,
    rollingScore: byId.get(session.id)?.rollingScore ?? null,
    rollingHr: byId.get(session.id)?.rollingHr ?? null,
  }))
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function cell(value: string | number | boolean | null): string {
  if (value == null) return ''
  return csvEscape(String(value))
}

function rrCell(values: number[]): string {
  return values.map((value) => String(value)).join('|')
}

export function sessionsToCsv(sessions: Session[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const session of sessions) {
    const row = [
      cell(session.id),
      cell(session.startedAt),
      cell(session.durationSec),
      cell(session.source),
      cell(session.deviceName),
      cell(session.batteryPercent),
      cell(session.meanHr),
      cell(session.rmssd),
      cell(session.lnRmssd),
      cell(session.score),
      cell(session.sdnn),
      cell(session.pnn50),
      cell(session.lf),
      cell(session.hf),
      cell(session.lfHf),
      cell(session.lfHfReliable),
      cell(session.sd1),
      cell(session.sd2),
      cell(session.beatsTotal),
      cell(session.beatsRemovedPct),
      cell(session.tags.sleep),
      cell(session.tags.soreness),
      cell(session.tags.stress),
      cell(session.tags.notes),
      cell(rrCell(session.rawRr)),
      cell(rrCell(session.filteredRr)),
    ]
    lines.push(row.join(','))
  }
  return `\uFEFF${lines.join('\n')}\n`
}

export function sessionsToJson(sessions: Session[]): string {
  return `${JSON.stringify({ app: 'hrv-reader', version: 1, sessions }, null, 2)}\n`
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
          continue
        }
        quoted = false
        continue
      }
      field += char ?? ''
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((item) => item.length > 0)) rows.push(row)
      row = []
      continue
    }
    field += char ?? ''
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((item) => item.length > 0)) rows.push(row)
  }
  return rows
}

function sessionFromRecord(record: Record<string, unknown>, index: number): Session | null {
  const idValue = typeof record.id === 'string' ? record.id.trim() : ''
  return sanitizeSession({
    ...record,
    id: idValue || `imported-${index}-${typeof record.startedAt === 'string' ? record.startedAt : 'session'}`,
  })
}

export function parseCsvSessions(text: string): Session[] {
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header || !header.some((column) => column.trim() === 'started_at')) {
    throw new Error('This CSV is missing the HRV Reader header row.')
  }
  const columns = header.map((column) => column.trim())
  const sessions: Session[] = []
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r] ?? []
    const record: Record<string, unknown> = {}
    columns.forEach((column, index) => {
      record[column] = values[index] ?? ''
    })
    const session = sessionFromRecord(
      {
        id: record.id,
        startedAt: record.started_at,
        durationSec: record.duration_sec,
        source: record.source,
        deviceName: record.device_name,
        batteryPercent: record.battery_percent,
        meanHr: record.mean_hr,
        rmssd: record.rmssd,
        lnRmssd: record.ln_rmssd,
        score: record.score,
        sdnn: record.sdnn,
        pnn50: record.pnn50,
        lf: record.lf,
        hf: record.hf,
        lfHf: record.lf_hf,
        lfHfReliable: record.lf_hf_reliable,
        sd1: record.sd1,
        sd2: record.sd2,
        beatsTotal: record.beats_total,
        beatsRemovedPct: record.beats_removed_pct,
        rawRr: record.raw_rr_ms,
        filteredRr: record.filtered_rr_ms,
        tags: {
          sleep: record.sleep,
          soreness: record.soreness,
          stress: record.stress,
          notes: record.notes,
        },
      },
      r,
    )
    if (session) sessions.push(session)
  }
  return sessions
}

export function parseJsonSessions(text: string): Session[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed != null && typeof parsed === 'object' && Array.isArray((parsed as { sessions?: unknown }).sessions)
      ? (parsed as { sessions: unknown[] }).sessions
      : null
  if (list == null) throw new Error('JSON should be a list of sessions, or an object with a sessions list.')
  return list
    .map((item, index) => {
      if (item == null || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'string' && row.id.trim() ? row.id : `imported-${index}`
      return sanitizeSession({ ...row, id })
    })
    .filter((session): session is Session => session != null)
}

export function readSessionText(text: string): Session[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseJsonSessions(trimmed)
  return parseCsvSessions(trimmed)
}
