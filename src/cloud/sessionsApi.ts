import { authorizePassphrase, headerValue } from './auth'
import { PASSPHRASE_HEADER } from './header'
import { emptySnapshot, parseSnapshot, snapshotToJson, type SyncSnapshot } from '../storage/sessions'

/** Stable, non-obvious object name. addRandomSuffix stays false so every write hits this object. */
export const CLOUD_BLOB_PATH = 'hrv/9f3c1a7e4b28d0c65a1e7f94b2d8c0e6.json'

export interface BlobStore {
  read(): Promise<string | null>
  write(body: string): Promise<void>
}

export interface SessionsRequest {
  method: string | undefined
  headers: Record<string, string | string[] | undefined>
  body: string | null
  expectedPassphrase: string | undefined
  blobConfigured: boolean
  store: BlobStore
}

export async function handleSessionsRequest(request: SessionsRequest): Promise<{ status: number; body: string }> {
  if (!request.blobConfigured) {
    return json(503, { error: 'Cloud sync is not configured. Set BLOB_READ_WRITE_TOKEN.' })
  }
  const auth = authorizePassphrase(headerValue(request.headers, PASSPHRASE_HEADER), request.expectedPassphrase)
  if (auth === 'unconfigured') {
    return json(503, { error: 'Cloud sync is not configured. Set HRV_PASSPHRASE.' })
  }
  if (auth === 'unauthorized') return json(401, { error: 'Unauthorized.' })

  if (request.method === 'GET') {
    const stored = await request.store.read()
    if (stored == null || stored.trim() === '') return { status: 200, body: snapshotToJson(emptySnapshot()) }
    try {
      return { status: 200, body: snapshotToJson(parseSnapshot(stored)) }
    } catch {
      return json(500, { error: 'The stored session file could not be read.' })
    }
  }

  if (request.method === 'PUT') {
    let snapshot: SyncSnapshot
    try {
      snapshot = parseSnapshot(request.body ?? '')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That document is not valid session JSON.'
      return json(400, { error: message })
    }
    const body = snapshotToJson(snapshot)
    await request.store.write(body)
    return { status: 200, body }
  }

  return json(405, { error: 'Use GET or PUT.' })
}

function json(status: number, body: { error: string }): { status: number; body: string } {
  return { status, body: `${JSON.stringify(body)}\n` }
}
