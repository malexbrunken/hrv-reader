import { useEffect, useRef, useState } from 'react'
import {
  clearDirectoryHandle,
  isFolderSyncSupported,
  isPickerDismissal,
  loadDirectoryHandle,
  loadSyncMeta,
  permissionMode,
  pickSyncDirectory,
  readFolderSnapshot,
  saveSyncMeta,
  storeDirectoryHandle,
  syncErrorMessage,
  writeFolderSnapshot,
  type DirectoryHandle,
  type SyncMeta,
} from './storage/folderSync'
import type { SyncSnapshot } from './storage/sessions'
import { scheduleReconcile } from './syncSchedule'

export type SyncPhase = 'unsupported' | 'checking' | 'idle' | 'needs-reconnect' | 'syncing' | 'ready' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  folderName: string | null
  lastSyncedAt: string | null
  error: string | null
}

function statusFrom(phase: SyncPhase, meta: SyncMeta): SyncStatus {
  return {
    phase,
    folderName: meta.folderName,
    lastSyncedAt: meta.lastSyncedAt,
    error: meta.lastError,
  }
}

export function useFolderSync() {
  const mountedRef = useRef(true)
  const directoryRef = useRef<DirectoryHandle | null>(null)
  const grantedRef = useRef(false)
  const metaRef = useRef<SyncMeta>(loadSyncMeta())
  const [status, setStatus] = useState<SyncStatus>(() =>
    statusFrom(isFolderSyncSupported() ? 'checking' : 'unsupported', metaRef.current),
  )

  function remember(phase: SyncPhase, patch: Partial<SyncMeta> = {}) {
    const meta: SyncMeta = {
      folderName: patch.folderName === undefined ? metaRef.current.folderName : patch.folderName,
      lastSyncedAt: patch.lastSyncedAt === undefined ? metaRef.current.lastSyncedAt : patch.lastSyncedAt,
      lastError: patch.lastError === undefined ? metaRef.current.lastError : patch.lastError,
    }
    metaRef.current = meta
    try {
      saveSyncMeta(meta)
    } catch {
      // The session cache is already updated. Status can still render from memory.
    }
    if (!mountedRef.current) return
    setStatus(statusFrom(phase, meta))
  }

  function isActive() {
    return directoryRef.current != null && grantedRef.current
  }

  async function readSnapshot(): Promise<SyncSnapshot> {
    const directory = directoryRef.current
    if (!directory) return { sessions: [], tombstones: [] }
    return readFolderSnapshot(directory)
  }

  async function writeSnapshot(snapshot: SyncSnapshot): Promise<void> {
    const directory = directoryRef.current
    if (!directory) return
    await writeFolderSnapshot(directory, snapshot)
  }

  function markSyncing() {
    const directory = directoryRef.current
    if (!directory) return
    remember('syncing', { folderName: directory.name, lastError: null })
  }

  function markReady() {
    const directory = directoryRef.current
    if (!directory) return
    remember('ready', { folderName: directory.name, lastSyncedAt: new Date().toISOString(), lastError: null })
  }

  function markError(message: string) {
    remember('error', { folderName: directoryRef.current?.name ?? null, lastError: message })
  }

  function arm(directory: DirectoryHandle) {
    directoryRef.current = directory
    grantedRef.current = true
    remember('syncing', { folderName: directory.name, lastError: null })
    scheduleReconcile()
  }

  useEffect(() => {
    mountedRef.current = true
    if (!isFolderSyncSupported()) return
    let cancelled = false
    void (async () => {
      try {
        const handle = await loadDirectoryHandle()
        if (cancelled || !mountedRef.current) return
        if (!handle) {
          directoryRef.current = null
          remember('idle', { folderName: null })
          return
        }
        const permission = await handle.queryPermission(permissionMode())
        if (cancelled || !mountedRef.current) return
        if (permission !== 'granted') {
          directoryRef.current = handle
          grantedRef.current = false
          remember('needs-reconnect', { folderName: handle.name, lastError: null })
          return
        }
        arm(handle)
      } catch (err) {
        if (cancelled || !mountedRef.current) return
        remember('error', { lastError: syncErrorMessage(err) })
      }
    })()
    return () => {
      cancelled = true
      mountedRef.current = false
    }
  }, [])

  async function chooseFolder() {
    if (!isFolderSyncSupported()) return
    try {
      const handle = await pickSyncDirectory()
      await storeDirectoryHandle(handle)
      arm(handle)
    } catch (err) {
      if (isPickerDismissal(err)) return
      remember('error', { lastError: syncErrorMessage(err) })
    }
  }

  async function reconnect() {
    try {
      const handle = directoryRef.current ?? (await loadDirectoryHandle())
      if (!handle) {
        await chooseFolder()
        return
      }
      const permission = await handle.requestPermission(permissionMode())
      if (permission !== 'granted') {
        directoryRef.current = handle
        grantedRef.current = false
        remember('needs-reconnect', {
          folderName: handle.name,
          lastError: 'Folder permission was not granted. Click Reconnect folder to try again.',
        })
        return
      }
      await storeDirectoryHandle(handle)
      arm(handle)
    } catch (err) {
      if (isPickerDismissal(err)) return
      remember('error', { lastError: syncErrorMessage(err) })
    }
  }

  async function stopSyncing() {
    directoryRef.current = null
    grantedRef.current = false
    try {
      await clearDirectoryHandle()
    } catch (err) {
      remember('error', { lastError: syncErrorMessage(err) })
      return
    }
    remember('idle', { folderName: null, lastError: null })
  }

  return {
    status,
    chooseFolder,
    reconnect,
    stopSyncing,
    isActive,
    readSnapshot,
    writeSnapshot,
    markSyncing,
    markReady,
    markError,
    describeError: syncErrorMessage,
  }
}
