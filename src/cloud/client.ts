import { PASSPHRASE_HEADER } from './header'
import { parseSnapshot, snapshotToJson, type SyncSnapshot } from '../storage/sessions'

export async function fetchCloudSnapshot(passphrase: string): Promise<SyncSnapshot> {
  const response = await requestCloud('GET', passphrase)
  return parseSnapshot(await response.text())
}

export async function pushCloudSnapshot(passphrase: string, snapshot: SyncSnapshot): Promise<void> {
  await requestCloud('PUT', passphrase, snapshotToJson(snapshot))
}

async function requestCloud(method: 'GET' | 'PUT', passphrase: string, body?: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch('/api/sessions', {
      method,
      cache: 'no-store',
      headers: {
        [PASSPHRASE_HEADER]: passphrase,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body,
    })
  } catch {
    throw new Error('Could not reach cloud sync.')
  }
  if (!response.ok) {
    let message = `Cloud sync failed (${response.status}).`
    try {
      const parsed: unknown = await response.json()
      if (parsed != null && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
        message = parsed.error
      }
    } catch {
      // Keep the status message.
    }
    throw new Error(message)
  }
  const text = await response.text()
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error('Cloud sync is not available on this server.')
  }
  return new Response(trimmed, { status: response.status, headers: response.headers })
}
