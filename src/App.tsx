import { useEffect, useRef, useState } from 'react'
import { BrowserBanner } from './components/BrowserBanner'
import { CloudSyncCard } from './components/CloudSyncCard'
import { FolderSyncCard } from './components/FolderSyncCard'
import { HistoryView } from './components/HistoryView'
import { MeasureView } from './components/MeasureView'
import type { Session } from './model'
import {
  applyTombstones,
  loadSessions,
  loadTombstones,
  mergeSessions,
  mergeSyncSnapshots,
  mergeTombstones,
  saveSessions,
  saveTombstones,
  sortSessions,
  type SyncSnapshot,
} from './storage/sessions'
import { registerReconcile, scheduleReconcile } from './syncSchedule'
import { useCloudSync } from './useCloudSync'
import { useFolderSync } from './useFolderSync'

type View = 'measure' | 'history'

export default function App() {
  const [view, setView] = useState<View>(() => (window.location.hash === '#history' ? 'history' : 'measure'))
  const [sessions, setSessions] = useState<Session[]>(() => applyTombstones(loadSessions(), loadTombstones()))
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  useEffect(() => {
    const onHash = () => setView(window.location.hash === '#history' ? 'history' : 'measure')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const folder = useFolderSync()
  const cloud = useCloudSync()
  const folderRef = useRef(folder)
  const cloudRef = useRef(cloud)
  folderRef.current = folder
  cloudRef.current = cloud

  function commit(snapshot: SyncSnapshot) {
    const sorted = sortSessions(snapshot.sessions)
    sessionsRef.current = sorted
    saveSessions(sorted)
    saveTombstones(snapshot.tombstones)
    setSessions(sorted)
  }

  function localSnapshot(): SyncSnapshot {
    return { sessions: sessionsRef.current, tombstones: loadTombstones() }
  }

  registerReconcile(async () => {
    const cloudApi = cloudRef.current
    const folderApi = folderRef.current
    const cloudOn = cloudApi.isActive()
    const folderOn = folderApi.isActive()
    if (!cloudOn && !folderOn) return
    let cloudPulled = false
    if (cloudOn) {
      cloudApi.markSyncing()
      try {
        commit(mergeSyncSnapshots(localSnapshot(), await cloudApi.pull()))
        cloudPulled = true
      } catch (err) {
        cloudApi.markError(err instanceof Error ? err.message : 'Could not read cloud sync.')
      }
    }
    if (folderOn) {
      folderApi.markSyncing()
      try {
        commit(mergeSyncSnapshots(localSnapshot(), await folderApi.readSnapshot()))
        await folderApi.writeSnapshot(localSnapshot())
        folderApi.markReady()
      } catch (err) {
        folderApi.markError(folderApi.describeError(err))
      }
    }
    if (cloudPulled) {
      try {
        await cloudApi.push(localSnapshot())
        cloudApi.markReady()
      } catch (err) {
        cloudApi.markError(err instanceof Error ? err.message : 'Could not write cloud sync.')
      }
    }
  })

  function persist(next: Session[]) {
    const tombstones = loadTombstones()
    commit({ sessions: applyTombstones(next, tombstones), tombstones })
    scheduleReconcile()
  }

  function deleteSession(id: string) {
    saveTombstones(mergeTombstones(loadTombstones(), [{ id, deletedAt: new Date().toISOString() }]))
    persist(sessionsRef.current.filter((session) => session.id !== id))
  }

  function saveOne(session: Session) {
    persist(mergeSessions(sessionsRef.current, [session]).sessions)
  }

  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="top">
        <div className="wrap top-row">
          <a className="brand" href="#measure">
            <Pulse />
            <span>
              <strong>HRV Reader</strong>
              <small>Chest strap · resting measurement</small>
            </span>
          </a>
          <nav aria-label="Primary">
            <a href="#measure" aria-current={view === 'measure' ? 'page' : undefined}>
              Measure
            </a>
            <a href="#history" aria-current={view === 'history' ? 'page' : undefined}>
              History{sessions.length > 0 ? ` (${sessions.length})` : ''}
            </a>
          </nav>
        </div>
      </header>
      <main id="content" className="wrap">
        <BrowserBanner />
        <CloudSyncCard
          status={cloud.status}
          onPassphrase={cloud.setPassphrase}
          onEnabled={cloud.setEnabled}
        />
        <FolderSyncCard
          status={folder.status}
          onChoose={() => void folder.chooseFolder()}
          onReconnect={() => void folder.reconnect()}
          onStop={() => void folder.stopSyncing()}
        />
        <div hidden={view !== 'measure'}>
          <MeasureView onSave={saveOne} />
        </div>
        <div hidden={view !== 'history'}>
          <HistoryView sessions={sessions} onChange={persist} onDelete={deleteSession} />
        </div>
        <footer>
          <p>Cloud sync shares history with your phone. A folder is an optional file backup, not an upload by itself.</p>
        </footer>
      </main>
    </>
  )
}

function Pulse() {
  return (
    <svg className="mark" viewBox="0 0 48 16" aria-hidden="true">
      <path d="M1 9h8l3-6 4.5 11L20 9h27" />
    </svg>
  )
}
