import { parseJsonSessions, sessionsToJson, type StorageLike } from './sessions'
import type { Session } from '../model'

export const SYNC_FILE_NAME = 'hrv-data.json'
const HANDLE_DB = 'hrv-reader'
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'sync-directory'
export const SYNC_STATUS_KEY = 'hrv-reader.sync-status.v1'

export interface SyncMeta {
  folderName: string | null
  lastSyncedAt: string | null
  lastError: string | null
}

export interface DirectoryHandle {
  name: string
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>
}

interface FileHandle {
  getFile(): Promise<File>
  createWritable(): Promise<WritableFile>
}

interface WritableFile {
  write(data: string): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

const PERMISSION = { mode: 'readwrite' } as const

export function emptySyncMeta(): SyncMeta {
  return { folderName: null, lastSyncedAt: null, lastError: null }
}

export function isFolderSyncSupported(): boolean {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return false
  const candidate = (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker
  return typeof candidate === 'function'
}

export function loadSyncMeta(storage?: StorageLike): SyncMeta {
  try {
    const store = storage ?? browserStorage()
    const raw = store.getItem(SYNC_STATUS_KEY)
    if (!raw) return emptySyncMeta()
    const parsed: unknown = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object') return emptySyncMeta()
    const row = parsed as Record<string, unknown>
    return {
      folderName: typeof row.folderName === 'string' && row.folderName.trim() ? row.folderName : null,
      lastSyncedAt: typeof row.lastSyncedAt === 'string' && Number.isFinite(Date.parse(row.lastSyncedAt)) ? row.lastSyncedAt : null,
      lastError: typeof row.lastError === 'string' && row.lastError.trim() ? row.lastError : null,
    }
  } catch {
    return emptySyncMeta()
  }
}

export function saveSyncMeta(meta: SyncMeta, storage?: StorageLike): void {
  const store = storage ?? browserStorage()
  store.setItem(SYNC_STATUS_KEY, JSON.stringify(meta))
}

export async function pickSyncDirectory(): Promise<DirectoryHandle> {
  const picker = (window as Window & { showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<DirectoryHandle> })
    .showDirectoryPicker
  if (!picker) throw new Error('This browser cannot sync a folder.')
  return picker.call(window, { id: 'hrv-reader', mode: 'readwrite' })
}

export async function loadDirectoryHandle(): Promise<DirectoryHandle | null> {
  const db = await openHandleDb()
  try {
    return await requestHandle(db, 'readonly', (store) => store.get(HANDLE_KEY))
  } finally {
    db.close()
  }
}

export async function storeDirectoryHandle(handle: DirectoryHandle): Promise<void> {
  const db = await openHandleDb()
  try {
    await requestHandle(db, 'readwrite', (store) => store.put(handle, HANDLE_KEY))
  } finally {
    db.close()
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  const db = await openHandleDb()
  try {
    await requestHandle(db, 'readwrite', (store) => store.delete(HANDLE_KEY))
  } finally {
    db.close()
  }
}

export async function readFolderSessions(directory: DirectoryHandle): Promise<Session[]> {
  try {
    const fileHandle = await directory.getFileHandle(SYNC_FILE_NAME)
    const file = await fileHandle.getFile()
    const text = await file.text()
    if (!text.trim()) return []
    return parseJsonSessions(text)
  } catch (err) {
    if (errorName(err) === 'NotFoundError') return []
    throw err
  }
}

export async function writeFolderSessions(directory: DirectoryHandle, sessions: Session[]): Promise<void> {
  const fileHandle = await directory.getFileHandle(SYNC_FILE_NAME, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(sessionsToJson(sessions))
    await writable.close()
  } catch (err) {
    try {
      await writable.abort()
    } catch {
      // The original write error is the one to surface.
    }
    throw err
  }
}

export function permissionMode(): { mode: 'readwrite' } {
  return PERMISSION
}

/** User dismissed the folder picker. Not a failure to show. */
export function isPickerDismissal(err: unknown): boolean {
  return errorName(err) === 'AbortError'
}

export function syncErrorMessage(err: unknown): string {
  const name = errorName(err)
  if (name === 'NotAllowedError') return 'The browser blocked access to that folder.'
  if (name === 'SecurityError') return 'Folder sync needs a secure page. Use HTTPS, or localhost while developing.'
  if (name === 'NotFoundError') return 'The sync folder is no longer available. Choose it again.'
  if (err instanceof Error && err.message.trim()) return err.message
  return 'Could not sync the folder.'
}

function browserStorage(): StorageLike {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage is not available in this browser.')
  }
  return localStorage
}

function errorName(err: unknown): string | null {
  if (err != null && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name
  return null
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the sync database.'))
  })
}

function requestHandle(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<DirectoryHandle | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, mode)
    const request = run(tx.objectStore(HANDLE_STORE))
    request.onsuccess = () => {
      const result = request.result as DirectoryHandle | undefined
      resolve(result ?? null)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not access the saved folder.'))
  })
}
