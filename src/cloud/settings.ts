import type { StorageLike } from '../storage/sessions'

export const CLOUD_SETTINGS_KEY = 'hrv-reader.cloud.v1'

export interface CloudSettings {
  enabled: boolean
  passphrase: string
}

export function emptyCloudSettings(): CloudSettings {
  return { enabled: false, passphrase: '' }
}

export function loadCloudSettings(storage?: StorageLike): CloudSettings {
  try {
    const store = storage ?? browserStorage()
    const raw = store.getItem(CLOUD_SETTINGS_KEY)
    if (!raw) return emptyCloudSettings()
    const parsed: unknown = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object') return emptyCloudSettings()
    const row = parsed as Record<string, unknown>
    return {
      enabled: row.enabled === true,
      passphrase: typeof row.passphrase === 'string' ? row.passphrase : '',
    }
  } catch {
    return emptyCloudSettings()
  }
}

export function saveCloudSettings(settings: CloudSettings, storage?: StorageLike): void {
  const store = storage ?? browserStorage()
  store.setItem(CLOUD_SETTINGS_KEY, JSON.stringify({ enabled: settings.enabled, passphrase: settings.passphrase }))
}

function browserStorage(): StorageLike {
  if (typeof localStorage === 'undefined') throw new Error('localStorage is not available in this browser.')
  return localStorage
}
