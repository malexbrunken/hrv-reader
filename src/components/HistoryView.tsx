import { useRef, useState, type ChangeEvent } from 'react'
import { fmt, fmtPct, formatDuration, formatWhen } from '../format'
import type { Session, SessionTags } from '../model'
import {
  mergeSessions,
  readSessionText,
  sessionsToCsv,
  sessionsToJson,
  withRollingAverages,
} from '../storage/sessions'
import { PoincarePlot } from './PoincarePlot'
import { TagEditor } from './TagEditor'
import { TrendChart } from './TrendChart'

export function HistoryView({
  sessions,
  onChange,
}: {
  sessions: Session[]
  onChange: (sessions: Session[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const trends = withRollingAverages(sessions)

  function exportJson() {
    download(`hrv-sessions-${dayStamp()}.json`, sessionsToJson(sessions), 'application/json')
  }

  function exportCsv() {
    download(`hrv-sessions-${dayStamp()}.csv`, sessionsToCsv(sessions), 'text/csv;charset=utf-8')
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const incoming = readSessionText(await file.text())
      const merged = mergeSessions(sessions, incoming)
      onChange(merged.sessions)
      const duplicate =
        merged.skipped === 0
          ? ''
          : `, skipped ${merged.skipped} duplicate${merged.skipped === 1 ? '' : 's'}`
      setMessage(`Imported ${merged.added} session${merged.added === 1 ? '' : 's'}${duplicate}.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import that file.')
    }
  }

  function updateTags(id: string, tags: SessionTags) {
    onChange(sessions.map((session) => (session.id === id ? { ...session, tags } : session)))
  }

  function remove(session: Session) {
    const when = formatWhen(session.startedAt)
    if (
      !window.confirm(
        `Delete the session from ${when}? It is removed from this browser, and from hrv-data.json when a folder is syncing.`,
      )
    )
      return
    onChange(sessions.filter((item) => item.id !== session.id))
  }

  return (
    <div className="stack">
      <section className="card" aria-labelledby="history-heading">
        <div className="card-head">
          <h2 id="history-heading">History</h2>
          <div className="actions tight">
            <button type="button" className="ghost" onClick={exportJson} disabled={sessions.length === 0}>
              Export JSON
            </button>
            <button type="button" className="ghost" onClick={exportCsv} disabled={sessions.length === 0}>
              Export CSV
            </button>
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              accept=".json,.csv,application/json,text/csv"
              tabIndex={-1}
              onChange={(event) => void onFile(event)}
            />
          </div>
        </div>
        <p className="hint">
          Score and resting HR, with a 7-day rolling average. Resting HR is the session’s mean HR. CSV and
          JSON include the raw RR intervals.
        </p>
        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : null}
        {sessions.length === 0 ? (
          <p className="empty">No sessions yet. Two quiet minutes is enough to start a trend.</p>
        ) : (
          <TrendChart sessions={trends} />
        )}
      </section>

      {trends.length > 0 ? (
        <ol className="session-list">
          {trends.map((session) => (
            <li key={session.id}>
              <details className="card session">
                <summary>
                  <span className="when">{formatWhen(session.startedAt)}</span>
                  <span className="session-score nums">{fmt(session.score, 1)}</span>
                  <span className="meta">
                    {session.source === 'demo' ? 'Demo' : 'Strap'} · {formatDuration(session.durationSec)} ·{' '}
                    {fmt(session.meanHr, 0)} bpm
                    {session.rollingScore != null ? ` · 7-day ${fmt(session.rollingScore, 1)}` : ''}
                  </span>
                </summary>
                <div className="session-body">
                  <dl className="inline-stats">
                    <div>
                      <dt>RMSSD</dt>
                      <dd className="nums">{fmt(session.rmssd, 1)} ms</dd>
                    </div>
                    <div>
                      <dt>ln(RMSSD)</dt>
                      <dd className="nums">{fmt(session.lnRmssd, 2)}</dd>
                    </div>
                    <div>
                      <dt>SDNN</dt>
                      <dd className="nums">{fmt(session.sdnn, 1)} ms</dd>
                    </div>
                    <div>
                      <dt>pNN50</dt>
                      <dd className="nums">{fmtPct(session.pnn50)}</dd>
                    </div>
                    <div>
                      <dt>LF/HF</dt>
                      <dd className="nums">
                        {fmt(session.lfHf, 2)}
                        {!session.lfHfReliable ? <span className="warn-inline"> Unreliable under 2 minutes</span> : null}
                      </dd>
                    </div>
                    <div>
                      <dt>Removed</dt>
                      <dd className="nums">{fmtPct(session.beatsRemovedPct)}</dd>
                    </div>
                    <div>
                      <dt>Resting HR, 7-day</dt>
                      <dd className="nums">{fmt(session.rollingHr, 0)} bpm</dd>
                    </div>
                  </dl>
                  <PoincarePlot rr={session.filteredRr.length > 0 ? session.filteredRr : session.rawRr} sd1={session.sd1} sd2={session.sd2} />
                  <TagEditor
                    tags={session.tags}
                    idPrefix={session.id}
                    onChange={(tags) => updateTags(session.id, tags)}
                  />
                  <details className="raw">
                    <summary>Raw RR intervals ({session.rawRr.length})</summary>
                    <p className="rr-dump nums">{session.rawRr.map((rr) => rr.toFixed(1)).join('  ')}</p>
                  </details>
                  <div className="actions">
                    <button type="button" className="ghost danger" onClick={() => remove(session)}>
                      Delete session
                    </button>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function download(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
