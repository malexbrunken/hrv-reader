import { useState } from 'react'
import { formatWhen } from '../format'
import type { CloudStatus } from '../useCloudSync'

export function CloudSyncCard({
  status,
  onPassphrase,
  onEnabled,
}: {
  status: CloudStatus
  onPassphrase: (value: string) => void
  onEnabled: (enabled: boolean) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <section className="card" aria-labelledby="cloud-heading">
      <div className="card-head">
        <h2 id="cloud-heading">Cloud sync</h2>
        <span className={`pill ${status.phase === 'ready' || status.phase === 'syncing' ? 'on' : ''}`}>
          {status.phase === 'ready' ? 'Synced' : status.phase === 'syncing' ? 'Syncing' : status.phase === 'error' ? 'Error' : 'Off'}
        </span>
      </div>
      <p className="hint">
        One history for this computer and for Bluefy on an iPhone. The passphrase is stored only in this browser and
        sent to your own API. Folder sync below stays an optional file backup.
      </p>
      <label className="notes" htmlFor="cloud-passphrase">
        <span>Passphrase</span>
        <span className="secret-row">
          <input
            id="cloud-passphrase"
            type={visible ? 'text' : 'password'}
            name="hrv-passphrase"
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={status.passphrase}
            onChange={(event) => onPassphrase(event.target.value)}
          />
          <button type="button" className="ghost" onClick={() => setVisible((value) => !value)}>
            {visible ? 'Hide' : 'Show'}
          </button>
        </span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={status.enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        <span>Cloud sync</span>
      </label>
      {status.phase === 'syncing' ? <p className="hint">Syncing…</p> : null}
      {status.lastSyncedAt ? <p className="hint">Last synced {formatWhen(status.lastSyncedAt)}</p> : null}
      {status.error ? (
        <p className="warn-inline" role="alert">
          {status.error}
        </p>
      ) : null}
    </section>
  )
}
