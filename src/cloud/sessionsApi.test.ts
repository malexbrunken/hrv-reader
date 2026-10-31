import { describe, expect, it } from 'vitest'
import { authorizePassphrase, passphrasesMatch } from './auth'
import { handleSessionsRequest, type BlobStore } from './sessionsApi'
import { snapshotToJson } from '../storage/sessions'

function memoryStore(initial: string | null = null): BlobStore & { body: string | null; reads: number; writes: number } {
  const state = { body: initial, reads: 0, writes: 0 }
  return {
    get body() {
      return state.body
    },
    set body(value: string | null) {
      state.body = value
    },
    get reads() {
      return state.reads
    },
    get writes() {
      return state.writes
    },
    async read() {
      state.reads += 1
      return state.body
    },
    async write(body: string) {
      state.writes += 1
      state.body = body
    },
  }
}

const session = {
  id: 's1',
  startedAt: '2026-10-31T12:00:00.000Z',
  durationSec: 120,
  source: 'demo' as const,
  deviceName: null,
  batteryPercent: null,
  meanHr: 60,
  rmssd: 40,
  lnRmssd: Math.log(40),
  score: Math.log(40) * 20,
  sdnn: 30,
  pnn50: 10,
  lf: 1,
  hf: 2,
  lfHf: 0.5,
  lfHfReliable: true,
  sd1: 20,
  sd2: 40,
  beatsTotal: 2,
  beatsRemovedPct: 0,
  rawRr: [1000, 1010],
  filteredRr: [1000, 1010],
  tags: { sleep: null, soreness: null, stress: null, notes: '' },
}

describe('passphrase auth', () => {
  it('matches only the same string, including when the lengths differ', () => {
    expect(passphrasesMatch('correct horse', 'correct horse')).toBe(true)
    expect(passphrasesMatch('correct horse', 'correct horse ')).toBe(false)
    expect(passphrasesMatch('short', 'a much longer passphrase')).toBe(false)
    expect(passphrasesMatch('', 'secret')).toBe(false)
    expect(authorizePassphrase(null, 'secret')).toBe('unauthorized')
    expect(authorizePassphrase('nope', 'secret')).toBe('unauthorized')
    expect(authorizePassphrase('secret', 'secret')).toBe('ok')
    expect(authorizePassphrase('secret', '  ')).toBe('unconfigured')
    expect(authorizePassphrase('secret', undefined)).toBe('unconfigured')
  })

  it('rejects a missing or wrong passphrase before touching the blob', async () => {
    const store = memoryStore('should-not-be-read')
    const missing = await handleSessionsRequest({
      method: 'GET',
      headers: {},
      body: null,
      expectedPassphrase: 'secret',
      blobConfigured: true,
      store,
    })
    const wrong = await handleSessionsRequest({
      method: 'GET',
      headers: { 'x-hrv-passphrase': 'nope' },
      body: null,
      expectedPassphrase: 'secret',
      blobConfigured: true,
      store,
    })
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(store.reads).toBe(0)
    expect(JSON.parse(missing.body)).toEqual(JSON.parse(wrong.body))
  })

  it('reports missing server configuration without reading the blob', async () => {
    const store = memoryStore()
    const noPass = await handleSessionsRequest({
      method: 'GET',
      headers: { 'x-hrv-passphrase': 'secret' },
      body: null,
      expectedPassphrase: undefined,
      blobConfigured: true,
      store,
    })
    const noBlob = await handleSessionsRequest({
      method: 'GET',
      headers: { 'x-hrv-passphrase': 'secret' },
      body: null,
      expectedPassphrase: 'secret',
      blobConfigured: false,
      store,
    })
    expect(noPass.status).toBe(503)
    expect(noPass.body).toContain('HRV_PASSPHRASE')
    expect(noBlob.status).toBe(503)
    expect(noBlob.body).toContain('BLOB_READ_WRITE_TOKEN')
    expect(store.reads).toBe(0)
  })

  it('stores a snapshot on PUT and returns it on GET, including raw RR and tombstones', async () => {
    const store = memoryStore()
    const headers = { 'x-hrv-passphrase': 'secret' }
    const document = snapshotToJson({
      sessions: [session],
      tombstones: [{ id: 'gone', deletedAt: '2026-10-31T00:00:00.000Z' }],
    })
    const put = await handleSessionsRequest({
      method: 'PUT',
      headers,
      body: document,
      expectedPassphrase: 'secret',
      blobConfigured: true,
      store,
    })
    expect(put.status).toBe(200)
    expect(store.writes).toBe(1)
    const got = await handleSessionsRequest({
      method: 'GET',
      headers,
      body: null,
      expectedPassphrase: 'secret',
      blobConfigured: true,
      store,
    })
    const parsed = JSON.parse(got.body) as { sessions: Array<{ rawRr: number[] }>; tombstones: Array<{ id: string }> }
    expect(parsed.sessions[0]?.rawRr).toEqual([1000, 1010])
    expect(parsed.tombstones.map((tombstone) => tombstone.id)).toEqual(['gone'])
  })

  it('rejects an invalid document and other methods', async () => {
    const store = memoryStore('{"sessions":[]}')
    const bad = await handleSessionsRequest({
      method: 'PUT',
      headers: { 'x-hrv-passphrase': 'secret' },
      body: '{',
      expectedPassphrase: 'secret',
      blobConfigured: true,
      store,
    })
    const other = await handleSessionsRequest({
      method: 'POST',
      headers: { 'x-hrv-passphrase': 'secret' },
      body: null,
      expectedPassphrase: 'secret',
      blobConfigured: true,
      store,
    })
    expect(bad.status).toBe(400)
    expect(other.status).toBe(405)
    expect(store.writes).toBe(0)
    expect(store.body).toBe('{"sessions":[]}')
  })
})
