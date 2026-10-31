import { useEffect, useRef, useState } from 'react'
import { FolderSyncCard } from './components/FolderSyncCard'
import { HistoryView } from './components/HistoryView'
import { MeasureView } from './components/MeasureView'
import type { Session } from './model'
import { loadSessions, mergeSessions, saveSessions, sortSessions } from './storage/sessions'
import { useFolderSync } from './useFolderSync'

type View = 'measure' | 'history'

export default function App() {
  const [view, setView] = useState<View>(() => (window.location.hash === '#history' ? 'history' : 'measure'))
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions())
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  useEffect(() => {
    const onHash = () => setView(window.location.hash === '#history' ? 'history' : 'measure')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const sync = useFolderSync(sessionsRef, setSessions)

  function persist(next: Session[]) {
    const sorted = sortSessions(next)
    sessionsRef.current = sorted
    saveSessions(sorted)
    setSessions(sorted)
    sync.writeThrough()
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
        <FolderSyncCard
          status={sync.status}
          onChoose={() => void sync.chooseFolder()}
          onReconnect={() => void sync.reconnect()}
          onStop={() => void sync.stopSyncing()}
        />
        <div hidden={view !== 'measure'}>
          <MeasureView onSave={saveOne} />
        </div>
        <div hidden={view !== 'history'}>
          <HistoryView sessions={sessions} onChange={persist} />
        </div>
        <footer>
          <p>Sessions stay on this device. A sync folder is a file you choose, not an upload.</p>
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
