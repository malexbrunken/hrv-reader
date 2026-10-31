import { formatWhen } from '../format'
import type { SyncStatus } from '../useFolderSync'

export function FolderSyncCard({
  status,
  onChoose,
  onReconnect,
  onStop,
}: {
  status: SyncStatus
  onChoose: () => void
  onReconnect: () => void
  onStop: () => void
}) {
  const busy = status.phase === 'checking' || status.phase === 'syncing'
  const named = status.folderName ? `“${status.folderName}”` : 'the saved folder'

  return (
    <section className="card" aria-labelledby="sync-heading">
      <div className="card-head">
        <h2 id="sync-heading">Sync folder</h2>
        <SyncPill phase={status.phase} />
      </div>
      {status.phase === 'unsupported' ? (
        <p>
          Folder sync needs Chrome or Edge. This browser has no File System Access API, so sessions stay in
          local storage on this device.
        </p>
      ) : (
        <p className="hint">
          Choose a Dropbox, OneDrive, or iCloud folder. The app keeps <span className="file-name">hrv-data.json</span>{' '}
          there, including raw RR, and still caches sessions in this browser. After a restart, Chrome asks you to
          reconnect before it will read the folder again.
        </p>
      )}
      {status.phase === 'checking' ? <p className="hint">Looking for a saved folder…</p> : null}
      {status.phase === 'syncing' ? <p className="hint">Syncing…</p> : null}
      {status.phase === 'needs-reconnect' ? (
        <p role="status">Reconnect {named} to read and write hrv-data.json. The browser needs a click first.</p>
      ) : null}
      {status.folderName && status.phase !== 'needs-reconnect' && status.phase !== 'idle' ? (
        <p className="strap-detail">Folder {named}</p>
      ) : null}
      {status.lastSyncedAt ? (
        <p className="hint">Last synced {formatWhen(status.lastSyncedAt)}</p>
      ) : null}
      {status.error ? (
        <p className="warn-inline" role="alert">
          {status.error}
        </p>
      ) : null}
      {status.phase === 'unsupported' ? null : (
        <div className="actions">
          {status.phase === 'needs-reconnect' || status.phase === 'error' ? (
            <button type="button" className="primary" onClick={onReconnect} disabled={busy}>
              Reconnect folder
            </button>
          ) : null}
          {status.phase === 'idle' || status.phase === 'error' ? (
            <button type="button" className={status.phase === 'error' ? 'ghost' : 'primary'} onClick={onChoose} disabled={busy}>
              Sync folder
            </button>
          ) : null}
          {status.phase === 'ready' || status.phase === 'syncing' || status.phase === 'needs-reconnect' ? (
            <button type="button" className="ghost" onClick={onChoose} disabled={busy}>
              Change folder
            </button>
          ) : null}
          {status.phase === 'ready' || status.phase === 'needs-reconnect' || status.phase === 'syncing' ? (
            <button type="button" className="ghost" onClick={onStop} disabled={busy}>
              Stop folder sync
            </button>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SyncPill({ phase }: { phase: SyncStatus['phase'] }) {
  const label =
    phase === 'unsupported'
      ? 'Unavailable'
      : phase === 'checking'
        ? 'Checking'
        : phase === 'syncing'
          ? 'Syncing'
          : phase === 'ready'
            ? 'Synced'
            : phase === 'needs-reconnect'
              ? 'Reconnect'
              : phase === 'error'
                ? 'Error'
                : 'Off'
  const on = phase === 'ready' || phase === 'syncing'
  return <span className={`pill ${on ? 'on' : ''}`}>{label}</span>
}
