import { useEffect, useRef, useState } from 'react'
import { fetchCloudSnapshot, pushCloudSnapshot } from './cloud/client'
import { loadCloudSettings, saveCloudSettings } from './cloud/settings'
import type { SyncSnapshot } from './storage/sessions'
import { scheduleReconcile } from './syncSchedule'

export type CloudPhase = 'off' | 'syncing' | 'ready' | 'error'

export interface CloudStatus {
  phase: CloudPhase
  enabled: boolean
  passphrase: string
  lastSyncedAt: string | null
  error: string | null
}

export function useCloudSync() {
  const initial = loadCloudSettings()
  const enabledRef = useRef(initial.enabled && initial.passphrase.trim() !== '')
  const passphraseRef = useRef(initial.passphrase)
  const [status, setStatus] = useState<CloudStatus>({
    phase: enabledRef.current ? 'syncing' : initial.enabled ? 'error' : 'off',
    enabled: initial.enabled,
    passphrase: initial.passphrase,
    lastSyncedAt: null,
    error: initial.enabled && initial.passphrase.trim() === '' ? 'Enter the passphrase to turn on cloud sync.' : null,
  })

  function isActive() {
    return enabledRef.current && passphraseRef.current.trim() !== ''
  }

  async function pull(): Promise<SyncSnapshot> {
    return fetchCloudSnapshot(passphraseRef.current)
  }

  async function push(snapshot: SyncSnapshot): Promise<void> {
    await pushCloudSnapshot(passphraseRef.current, snapshot)
  }

  function markSyncing() {
    setStatus((current) => ({ ...current, phase: 'syncing', error: null }))
  }

  function markReady() {
    setStatus((current) => ({
      ...current,
      phase: 'ready',
      lastSyncedAt: new Date().toISOString(),
      error: null,
    }))
  }

  function markError(message: string) {
    setStatus((current) => ({ ...current, phase: 'error', error: message }))
  }

  function setPassphrase(passphrase: string) {
    const wasActive = isActive()
    passphraseRef.current = passphrase
    if (passphrase.trim() === '') {
      enabledRef.current = false
      saveCloudSettings({ enabled: false, passphrase })
      setStatus((current) => ({
        ...current,
        passphrase,
        enabled: false,
        phase: current.enabled ? 'error' : 'off',
        error: current.enabled ? 'Enter the passphrase to turn on cloud sync.' : null,
      }))
      return
    }
    saveCloudSettings({ enabled: status.enabled, passphrase })
    enabledRef.current = status.enabled
    setStatus((current) => ({ ...current, passphrase }))
    if (!wasActive && isActive()) scheduleReconcile()
  }

  function setEnabled(enabled: boolean) {
    if (enabled && passphraseRef.current.trim() === '') {
      saveCloudSettings({ enabled: false, passphrase: passphraseRef.current })
      enabledRef.current = false
      setStatus((current) => ({
        ...current,
        enabled: false,
        phase: 'error',
        error: 'Enter the passphrase to turn on cloud sync.',
      }))
      return
    }
    enabledRef.current = enabled
    saveCloudSettings({ enabled, passphrase: passphraseRef.current })
    setStatus((current) => ({
      ...current,
      enabled,
      phase: enabled ? 'syncing' : 'off',
      error: null,
    }))
    if (enabled) scheduleReconcile()
  }

  useEffect(() => {
    if (enabledRef.current) scheduleReconcile()
  }, [])

  return { status, isActive, pull, push, markSyncing, markReady, markError, setPassphrase, setEnabled }
}
