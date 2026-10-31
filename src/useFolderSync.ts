import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Session } from './model'
import {
  clearDirectoryHandle,
  isFolderSyncSupported,
  isPickerDismissal,
  loadDirectoryHandle,
  loadSyncMeta,
  permissionMode,
  pickSyncDirectory,
  readFolderSessions,
  saveSyncMeta,
  storeDirectoryHandle,
  syncErrorMessage,
  writeFolderSessions,
  type DirectoryHandle,
  type SyncMeta,
} from './storage/folderSync'
import { saveSessions, unionSessionsById } from './storage/sessions'

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

export function useFolderSync(
  sessionsRef: MutableRefObject<Session[]>,
  setSessions: Dispatch<SetStateAction<Session[]>>,
) {
  const mountedRef = useRef(true)
  const directoryRef = useRef<DirectoryHandle | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
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

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = queueRef.current.then(task, task)
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function pullAndWrite(directory: DirectoryHandle): Promise<void> {
    const fromFile = await readFolderSessions(directory)
    const merged = unionSessionsById(sessionsRef.current, fromFile)
    sessionsRef.current = merged
    saveSessions(merged)
    if (mountedRef.current) setSessions(merged)
    await writeFolderSessions(directory, sessionsRef.current)
    remember('ready', { folderName: directory.name, lastSyncedAt: new Date().toISOString(), lastError: null })
  }

  function queueSync(directory: DirectoryHandle): Promise<void> {
    directoryRef.current = directory
    remember('syncing', { folderName: directory.name, lastError: null })
    return enqueue(async () => {
      try {
        await pullAndWrite(directory)
      } catch (err) {
        remember('error', { folderName: directory.name, lastError: syncErrorMessage(err) })
      }
    })
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
          remember('needs-reconnect', { folderName: handle.name, lastError: null })
          return
        }
        await queueSync(handle)
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
      await queueSync(handle)
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
        remember('needs-reconnect', {
          folderName: handle.name,
          lastError: 'Folder permission was not granted. Click Reconnect folder to try again.',
        })
        return
      }
      await storeDirectoryHandle(handle)
      await queueSync(handle)
    } catch (err) {
      if (isPickerDismissal(err)) return
      remember('error', { lastError: syncErrorMessage(err) })
    }
  }

  async function stopSyncing() {
    directoryRef.current = null
    try {
      await clearDirectoryHandle()
    } catch (err) {
      remember('error', { lastError: syncErrorMessage(err) })
      return
    }
    remember('idle', { folderName: null, lastError: null })
  }

  function writeThrough() {
    const directory = directoryRef.current
    if (!directory || status.phase === 'needs-reconnect' || status.phase === 'unsupported') return
    remember('syncing', { folderName: directory.name, lastError: null })
    void enqueue(async () => {
      const current = directoryRef.current
      if (!current) return
      try {
        await writeFolderSessions(current, sessionsRef.current)
        remember('ready', { folderName: current.name, lastSyncedAt: new Date().toISOString(), lastError: null })
      } catch (err) {
        remember('error', { folderName: current.name, lastError: syncErrorMessage(err) })
      }
    })
  }

  return { status, chooseFolder, reconnect, stopSyncing, writeThrough }
}
