import { describe, expect, it } from 'vitest'
import { createSession, computeHrv } from '../hrv/metrics'
import { emptyTags, type Session } from '../model'
import {
  STORAGE_KEY,
  loadSessions,
  mergeFolderDocument,
  mergeSessions,
  mergeSyncSnapshots,
  parseCsv,
  readSessionText,
  saveSessions,
  sessionsToCsv,
  sessionsToJson,
  withRollingAverages,
  type StorageLike,
} from './sessions'

function memory(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

function session(partial: Partial<Session> & Pick<Session, 'id' | 'startedAt'>): Session {
  return {
    durationSec: 120,
    source: 'bluetooth',
    deviceName: 'HRM 600',
    batteryPercent: 80,
    meanHr: 60,
    rmssd: 40,
    lnRmssd: Math.log(40),
    score: Math.log(40) * 20,
    sdnn: 50,
    pnn50: 10,
    lf: 100,
    hf: 200,
    lfHf: 0.5,
    lfHfReliable: true,
    sd1: 28,
    sd2: 70,
    beatsTotal: 3,
    beatsRemovedPct: 0,
    rawRr: [1000, 1050, 1000],
    filteredRr: [1000, 1050, 1000],
    tags: emptyTags(),
    ...partial,
  }
}

describe('session storage', () => {
  it('round-trips sessions through local storage', () => {
    const store = memory()
    const saved = session({
      id: 's1',
      startedAt: '2026-10-31T12:00:00.000Z',
      tags: { sleep: 4, soreness: 2, stress: null, notes: 'easy morning' },
    })
    saveSessions([saved], store)
    expect(store.getItem(STORAGE_KEY)).toContain('easy morning')
    expect(loadSessions(store)).toEqual([saved])
    expect(loadSessions(memory())).toEqual([])
    const broken = memory()
    broken.setItem(STORAGE_KEY, '{not json')
    expect(loadSessions(broken)).toEqual([])
  })

  it('round-trips JSON and CSV, including raw RR and quoted notes', () => {
    const summary = computeHrv([800, 810, 790, 400, 805, 795], { durationSec: 120, fallbackHr: null })
    const original = createSession({
      id: 'round',
      startedAt: '2026-10-30T07:15:00.000Z',
      durationSec: 120,
      source: 'demo',
      deviceName: 'Simulated strap',
      batteryPercent: null,
      summary,
      rawRr: [800, 810, 790, 400, 805, 795],
      tags: { sleep: 5, soreness: 1, stress: 2, notes: 'said "fine", then paused' },
    })

    const fromJson = readSessionText(sessionsToJson([original]))
    expect(fromJson).toEqual([original])

    const csv = sessionsToCsv([original])
    const table = parseCsv(csv)
    expect(table[0]).toContain('raw_rr_ms')
    expect(csv).toContain('800|810|790|400|805|795')
    const fromCsv = readSessionText(csv)
    expect(fromCsv).toEqual([original])
  })

  it('unions the folder file with the local cache by session id', () => {
    const localOnly = session({
      id: 'local',
      startedAt: '2026-10-03T00:00:00.000Z',
      rawRr: [800, 810],
      tags: { sleep: 2, soreness: null, stress: null, notes: 'browser only' },
    })
    const sharedLocal = session({
      id: 'shared',
      startedAt: '2026-10-02T00:00:00.000Z',
      rawRr: [700, 710, 720],
      tags: { sleep: 5, soreness: 1, stress: 2, notes: 'edited here' },
    })
    const sharedFile = session({
      id: 'shared',
      startedAt: '2026-10-02T00:00:00.000Z',
      rawRr: [1],
      tags: { sleep: 1, soreness: 1, stress: 1, notes: 'older file' },
    })
    const fileOnly = session({
      id: 'file',
      startedAt: '2026-10-04T00:00:00.000Z',
      rawRr: [900, 950, 1000],
    })
    const duplicateInFile = session({
      id: 'file',
      startedAt: '2026-10-04T00:00:00.000Z',
      rawRr: [111],
    })

    const merged = mergeFolderDocument(
      [localOnly, sharedLocal],
      sessionsToJson([sharedFile, fileOnly, duplicateInFile]),
    )

    expect(merged.sessions.map((item) => item.id)).toEqual(['file', 'local', 'shared'])
    expect(merged.sessions.find((item) => item.id === 'shared')).toMatchObject({
      rawRr: [700, 710, 720],
      tags: { notes: 'edited here', sleep: 5 },
    })
    expect(merged.sessions.find((item) => item.id === 'file')?.rawRr).toEqual([111])
    expect(merged.sessions.find((item) => item.id === 'local')?.rawRr).toEqual([800, 810])
    expect(merged.tombstones).toEqual([])
    expect(mergeFolderDocument([localOnly], '   ')).toEqual({ sessions: [localOnly], tombstones: [] })
    expect(() => mergeFolderDocument([], '{')).toThrow(/JSON/)
  })

  it('lets a tombstone from either side delete a session and keeps the other copy', () => {
    const kept = session({ id: 'kept', startedAt: '2026-10-03T00:00:00.000Z', rawRr: [800] })
    const doomed = session({ id: 'doomed', startedAt: '2026-10-02T00:00:00.000Z', rawRr: [900, 910] })
    const remoteOnly = session({ id: 'remote', startedAt: '2026-10-04T00:00:00.000Z', rawRr: [1000, 1010] })
    const merged = mergeSyncSnapshots(
      {
        sessions: [kept, doomed],
        tombstones: [{ id: 'remote', deletedAt: '2026-10-05T00:00:00.000Z' }],
      },
      {
        sessions: [remoteOnly, { ...doomed, rawRr: [1], tags: { ...doomed.tags, notes: 'stale' } }],
        tombstones: [{ id: 'doomed', deletedAt: '2026-10-04T00:00:00.000Z' }],
      },
    )
    expect(merged.sessions.map((item) => item.id)).toEqual(['kept'])
    expect(merged.sessions[0]?.rawRr).toEqual([800])
    expect(merged.tombstones.map((item) => item.id).sort()).toEqual(['doomed', 'remote'])
  })

  it('merges imports by id and skips duplicates', () => {
    const older = session({ id: 'a', startedAt: '2026-10-01T00:00:00.000Z' })
    const newer = session({ id: 'b', startedAt: '2026-10-02T00:00:00.000Z' })
    const merged = mergeSessions([older], [newer, { ...older }])
    expect(merged.added).toBe(1)
    expect(merged.skipped).toBe(1)
    expect(merged.sessions.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('computes a 7-day rolling average and drops the point just outside the window', () => {
    const early = session({ id: 'a', startedAt: '2026-10-01T00:00:00.000Z', score: 40, meanHr: 60 })
    const edge = session({ id: 'b', startedAt: '2026-10-08T00:00:00.000Z', score: 80, meanHr: 70 })
    const past = session({ id: 'c', startedAt: '2026-10-08T00:00:00.001Z', score: 80, meanHr: 70 })

    const atEdge = withRollingAverages([edge, early])
    expect(atEdge.find((item) => item.id === 'a')).toMatchObject({ rollingScore: 40, rollingHr: 60 })
    expect(atEdge.find((item) => item.id === 'b')).toMatchObject({ rollingScore: 60, rollingHr: 65 })

    const outside = withRollingAverages([early, past]).find((item) => item.id === 'c')
    expect(outside).toMatchObject({ rollingScore: 80, rollingHr: 70 })
  })

  it('ignores null scores in the rolling window', () => {
    const scored = session({ id: 'a', startedAt: '2026-10-02T00:00:00.000Z', score: 50, meanHr: 62 })
    const empty = session({ id: 'b', startedAt: '2026-10-03T00:00:00.000Z', score: null, meanHr: null })
    const trend = withRollingAverages([scored, empty]).find((item) => item.id === 'b')
    expect(trend?.rollingScore).toBe(50)
    expect(trend?.rollingHr).toBe(62)
  })
})
