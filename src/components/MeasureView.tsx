import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connectHeartRateMonitor, isWebBluetoothSupported, type StrapConnection } from '../bluetooth/monitor'
import { fmt, fmtPct, formatCountdown } from '../format'
import { filterRrIntervals } from '../hrv/filter'
import type { HeartRateMeasurement } from '../hrv/parseHeartRate'
import { computeHrv, createSession, rmssd } from '../hrv/metrics'
import { createRrSimulator } from '../hrv/simulate'
import { mean } from '../hrv/stats'
import type { Session } from '../model'
import { PoincarePlot } from './PoincarePlot'
import { Tachogram } from './Tachogram'
import { TagEditor } from './TagEditor'

const DURATIONS = [
  { sec: 60, label: '1 min' },
  { sec: 120, label: '2 min' },
  { sec: 180, label: '3 min' },
  { sec: 300, label: '5 min' },
] as const

type Phase = 'setup' | 'running' | 'review'

type LinkState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'demo' }
  | { kind: 'device'; connection: StrapConnection }

export function MeasureView({ onSave }: { onSave: (session: Session) => void }) {
  const bluetoothSupported = isWebBluetoothSupported()
  const [link, setLink] = useState<LinkState>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [durationSec, setDurationSec] = useState(120)
  const [phase, setPhase] = useState<Phase>('setup')
  const [liveHr, setLiveHr] = useState<number | null>(null)
  const [contact, setContact] = useState<boolean | null>(null)
  const [rawRr, setRawRr] = useState<number[]>([])
  const [remaining, setRemaining] = useState(120)
  const [draft, setDraft] = useState<Session | null>(null)
  const [beat, setBeat] = useState(0)

  const recordingRef = useRef(false)
  const finishedRef = useRef(false)
  const intentionalRef = useRef(false)
  const rawRef = useRef<number[]>([])
  const hrSamplesRef = useRef<number[]>([])
  const startedAtRef = useRef(0)
  const durationRef = useRef(durationSec)
  const linkRef = useRef(link)
  const connectionRef = useRef<StrapConnection | null>(null)
  const mountedRef = useRef(true)
  const hrRef = useRef<HTMLSpanElement>(null)

  durationRef.current = durationSec
  linkRef.current = link

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const el = hrRef.current
    if (!el || beat === 0) return
    el.classList.remove('thump')
    void el.offsetWidth
    el.classList.add('thump')
  }, [beat])

  const applyMeasurement = useCallback((measurement: HeartRateMeasurement) => {
    setLiveHr(measurement.heartRateBpm)
    setContact(measurement.contactDetected)
    setBeat((value) => value + 1)
    if (!recordingRef.current) return
    if (measurement.heartRateBpm > 0) hrSamplesRef.current.push(measurement.heartRateBpm)
    if (measurement.rrIntervalsMs.length === 0) return
    rawRef.current.push(...measurement.rrIntervalsMs)
    setRawRr(rawRef.current.slice())
  }, [])

  const finishSession = useCallback(() => {
    if (finishedRef.current || !recordingRef.current) return
    finishedRef.current = true
    recordingRef.current = false
    const planned = durationRef.current
    const elapsedRaw = (Date.now() - startedAtRef.current) / 1000
    const completed = elapsedRaw >= planned - 0.25
    const elapsed = completed ? planned : Math.max(1, Math.round(elapsedRaw))
    const raw = rawRef.current.slice()
    const fallbackHr = mean(hrSamplesRef.current.filter((hr) => hr > 0))
    const summary = computeHrv(raw, { durationSec: elapsed, fallbackHr })
    const current = linkRef.current
    const device = current.kind === 'device' ? current.connection : null
    const session = createSession({
      startedAt: new Date(startedAtRef.current).toISOString(),
      durationSec: elapsed,
      source: current.kind === 'demo' ? 'demo' : 'bluetooth',
      deviceName: current.kind === 'demo' ? 'Simulated strap' : strapLabel(device),
      batteryPercent: device?.batteryPercent ?? null,
      summary,
      rawRr: raw,
    })
    setDraft(session)
    setRemaining(0)
    setPhase('review')
  }, [])

  useEffect(() => {
    if (link.kind !== 'demo') return
    const simulator = createRrSimulator()
    simulator.start((rr, hr) => {
      applyMeasurement({
        heartRateBpm: hr,
        contactSupported: true,
        contactDetected: true,
        energyExpendedKj: null,
        rrIntervalsMs: [rr],
      })
    })
    return () => simulator.stop()
  }, [link.kind, applyMeasurement])

  useEffect(() => {
    if (link.kind !== 'device') return
    const connection = link.connection
    const unsubscribe = connection.subscribe(applyMeasurement)
    const unlisten = connection.onDisconnected(() => {
      if (intentionalRef.current) {
        intentionalRef.current = false
        return
      }
      connectionRef.current = null
      if (recordingRef.current) {
        finishSession()
        setError('The strap disconnected, so the session ended early. You can still save it.')
      } else {
        setNotice('The strap disconnected.')
      }
      setLink({ kind: 'idle' })
      setLiveHr(null)
      setContact(null)
    })
    return () => {
      unsubscribe()
      unlisten()
    }
  }, [link, applyMeasurement, finishSession])

  useEffect(() => {
    if (phase !== 'running') return
    const id = window.setInterval(() => {
      const left = durationRef.current - (Date.now() - startedAtRef.current) / 1000
      if (left <= 0) {
        setRemaining(0)
        finishSession()
      } else {
        setRemaining(left)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [phase, finishSession])

  const filtered = useMemo(() => filterRrIntervals(rawRr), [rawRr])
  const liveRmssd = rmssd(filtered.accepted)
  const tachogram = useMemo(() => {
    let t = 0
    return filtered.accepted.map((rr) => {
      t += rr / 1000
      return { t, rr }
    })
  }, [filtered])

  const linked = link.kind === 'demo' || link.kind === 'device'
  const progress = durationSec <= 0 ? 0 : Math.min(1, Math.max(0, 1 - remaining / durationSec))

  async function connect() {
    if (!bluetoothSupported) return
    if (!window.isSecureContext) {
      setError('Web Bluetooth needs a secure page. Use HTTPS, or localhost while developing.')
      return
    }
    setError(null)
    setNotice(null)
    setSaved(false)
    setLink({ kind: 'connecting' })
    try {
      const connection = await connectHeartRateMonitor()
      if (!mountedRef.current) {
        connection.disconnect()
        return
      }
      connectionRef.current = connection
      setLink({ kind: 'device', connection })
    } catch (err) {
      if (!mountedRef.current) return
      setLink({ kind: 'idle' })
      if (errorName(err) === 'NotFoundError') {
        setNotice('No strap selected.')
        return
      }
      if (errorName(err) === 'SecurityError') {
        setError('Bluetooth permission was blocked for this site.')
        return
      }
      setError(err instanceof Error ? err.message : 'Could not connect to the strap.')
    }
  }

  function stopLink() {
    if (link.kind === 'device') {
      intentionalRef.current = true
      connectionRef.current?.disconnect()
      connectionRef.current = null
    }
    if (recordingRef.current) finishSession()
    setLink({ kind: 'idle' })
    setLiveHr(null)
    setContact(null)
  }

  function startSession() {
    if (!linked) return
    rawRef.current = []
    hrSamplesRef.current = []
    setRawRr([])
    finishedRef.current = false
    recordingRef.current = true
    startedAtRef.current = Date.now()
    setRemaining(durationSec)
    setDraft(null)
    setError(null)
    setNotice(null)
    setSaved(false)
    setPhase('running')
  }

  function cancelSession() {
    finishedRef.current = true
    recordingRef.current = false
    rawRef.current = []
    hrSamplesRef.current = []
    setRawRr([])
    setDraft(null)
    setRemaining(durationSec)
    setPhase('setup')
  }

  function saveDraft() {
    if (!draft) return
    try {
      onSave(draft)
      setDraft(null)
      setRawRr([])
      setPhase('setup')
      setSaved(true)
      setNotice('Saved on this device.')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the session.')
    }
  }

  return (
    <div className="stack">
      {bluetoothSupported ? (
        <aside className="banner">
          <p>
            Disconnect the strap from Garmin Connect and from your watch before connecting. The HRM 600
            keeps a single Bluetooth link.
          </p>
        </aside>
      ) : (
        <aside className="banner warn" role="status">
          <p className="kicker">Browser support</p>
          <h2>Web Bluetooth isn’t available here</h2>
          <p>
            Safari and Firefox can’t connect to a chest strap. Use Chrome or Edge on a computer.
          </p>
          <p>
            Disconnect the strap from Garmin Connect and from your watch before connecting. The HRM 600
            keeps a single Bluetooth link, and a watch will hold it.
          </p>
          <p>Demo mode still runs a full session with synthetic beats.</p>
        </aside>
      )}

      <section className="card" aria-labelledby="strap-heading">
        <div className="card-head">
          <h2 id="strap-heading">Strap</h2>
          <Status link={link} />
        </div>
        {link.kind === 'device' ? (
          <p className="strap-detail">
            {strapLabel(link.connection)}
            {link.connection.batteryPercent != null ? ` · ${link.connection.batteryPercent}% battery` : ''}
            {link.connection.manufacturer ? ` · ${link.connection.manufacturer}` : ''}
          </p>
        ) : null}
        {liveHr != null && phase !== 'running' ? (
          <p className="strap-hr">
            <span ref={hrRef} className="nums">
              {liveHr}
            </span>{' '}
            bpm
          </p>
        ) : null}
        {contact === false ? (
          <p className="warn-inline" role="status">
            Strap contact isn’t detected. Wet the electrodes and snug the band.
          </p>
        ) : null}
        <div className="actions">
          {link.kind === 'device' || link.kind === 'demo' ? (
            <button type="button" className="ghost" onClick={stopLink}>
              {link.kind === 'demo' ? 'Stop simulation' : 'Disconnect'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="primary"
                onClick={() => void connect()}
                disabled={!bluetoothSupported || link.kind === 'connecting'}
              >
                {link.kind === 'connecting' ? 'Looking for a strap…' : 'Connect strap'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setError(null)
                  setNotice(null)
                  setSaved(false)
                  setLink({ kind: 'demo' })
                }}
                disabled={link.kind === 'connecting'}
              >
                Simulate strap
              </button>
            </>
          )}
        </div>
        <p className="hint">
          {link.kind === 'demo'
            ? 'Synthetic RR with respiratory sinus arrhythmia and a few ectopic beats. No strap required.'
            : 'Chrome or Edge opens a device picker. Choose the HRM 600. Wear it snug, wet the electrodes, and tap the module if it is asleep.'}
        </p>
        {error ? (
          <p className="warn-inline" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="notice" role="status">
            {notice} {saved ? <a href="#history">View history</a> : null}
          </p>
        ) : null}
      </section>

      {phase === 'running' ? (
        <section className="card" aria-labelledby="live-heading">
          <div className="card-head">
            <h2 id="live-heading">Recording</h2>
            <span className="pill">Live</span>
          </div>
          <div className="live-grid">
            <div className="live-stats">
              <div className="countdown">
                <svg viewBox="0 0 140 140" aria-hidden="true">
                  <circle className="ring-track" cx="70" cy="70" r="54" />
                  <circle
                    className="ring-value"
                    cx="70"
                    cy="70"
                    r="54"
                    strokeDasharray={2 * Math.PI * 54}
                    strokeDashoffset={2 * Math.PI * 54 * (1 - progress)}
                    transform="rotate(-90 70 70)"
                  />
                </svg>
                <div className="countdown-readout">
                  <span className="clock nums">{formatCountdown(remaining)}</span>
                  <span className="kicker">remaining</span>
                </div>
              </div>
              <p className="hr-block">
                <span className="kicker">Heart rate</span>
                <span ref={hrRef} className="hr-value nums">
                  {liveHr ?? '—'}
                </span>
                <span className="unit">bpm</span>
              </p>
            </div>
            <Tachogram points={tachogram} />
          </div>
          <dl className="inline-stats">
            <div>
              <dt>RMSSD</dt>
              <dd className="nums">{liveRmssd == null ? '—' : `${fmt(liveRmssd, 1)} ms`}</dd>
            </div>
            <div>
              <dt>Beats removed</dt>
              <dd className="nums">{filtered.total === 0 ? '—' : fmtPct(filtered.removedPct)}</dd>
            </div>
            <div>
              <dt>Beats kept</dt>
              <dd className="nums">
                {filtered.accepted.length}/{filtered.total}
              </dd>
            </div>
          </dl>
          <div className="actions">
            <button type="button" className="ghost" onClick={cancelSession}>
              Cancel session
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'review' && draft ? (
        <section className="card" aria-labelledby="results-heading">
          <div className="card-head">
            <h2 id="results-heading">Results</h2>
            <span className="hint">{draft.source === 'demo' ? 'Demo' : draft.deviceName ?? 'Strap'}</span>
          </div>
          {draft.score == null ? (
            <p className="warn-inline">
              Not enough clean RR intervals to score this session. You can still save the raw beats.
            </p>
          ) : null}
          <div className="review-grid">
            <div className="metrics">
              <div className="metric feature">
                <p className="metric-label">HRV score (Elite-style approximation)</p>
                <p className="score-value nums">{fmt(draft.score, 1)}</p>
                <p className="hint">ln(RMSSD) × 20, natural log of RMSSD in milliseconds</p>
              </div>
              <Metric label="Mean HR" value={`${fmt(draft.meanHr, 0)} bpm`} />
              <Metric label="RMSSD" value={`${fmt(draft.rmssd, 1)} ms`} />
              <Metric label="ln(RMSSD)" value={fmt(draft.lnRmssd, 2)} />
              <Metric label="SDNN" value={`${fmt(draft.sdnn, 1)} ms`} />
              <Metric label="pNN50" value={fmtPct(draft.pnn50)} />
              <Metric label="SD1" value={`${fmt(draft.sd1, 1)} ms`} />
              <Metric label="SD2" value={`${fmt(draft.sd2, 1)} ms`} />
              <div className="metric">
                <p className="metric-label">LF/HF</p>
                <p className="metric-value nums">{fmt(draft.lfHf, 2)}</p>
                <p className="hint">
                  {draft.lf != null && draft.hf != null
                    ? `LF ${fmt(draft.lf, 0)} · HF ${fmt(draft.hf, 0)} ms²`
                    : '0.04–0.15 Hz / 0.15–0.40 Hz'}
                </p>
                {!draft.lfHfReliable ? <p className="warn-inline">Unreliable under 2 minutes</p> : null}
              </div>
              <Metric label="Beats removed" value={fmtPct(draft.beatsRemovedPct)} />
            </div>
            <PoincarePlot rr={draft.filteredRr} sd1={draft.sd1} sd2={draft.sd2} />
          </div>
          <TagEditor
            tags={draft.tags}
            idPrefix="draft"
            onChange={(tags) => setDraft((current) => (current ? { ...current, tags } : current))}
          />
          <div className="actions">
            <button type="button" className="primary" onClick={saveDraft}>
              Save session
            </button>
            <button type="button" className="ghost" onClick={cancelSession}>
              Discard
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'setup' ? (
        <section className="card" aria-labelledby="session-heading">
          <h2 id="session-heading">Session</h2>
          <p className="hint">Sit still and breathe normally. The default is two minutes.</p>
          <div className="segmented" role="radiogroup" aria-label="Session length">
            {DURATIONS.map((option) => (
              <label key={option.sec} className={durationSec === option.sec ? 'on' : ''}>
                <input
                  type="radio"
                  name="duration"
                  value={option.sec}
                  checked={durationSec === option.sec}
                  onChange={() => setDurationSec(option.sec)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={startSession} disabled={!linked}>
              Start session
            </button>
          </div>
          {!linked ? <p className="hint">Connect a strap, or simulate one, to start.</p> : null}
        </section>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <p className="metric-label">{label}</p>
      <p className="metric-value nums">{value}</p>
    </div>
  )
}

function Status({ link }: { link: LinkState }) {
  const label =
    link.kind === 'device' ? 'Connected' : link.kind === 'demo' ? 'Demo' : link.kind === 'connecting' ? 'Connecting' : 'Not connected'
  return <span className={`pill ${link.kind === 'device' || link.kind === 'demo' ? 'on' : ''}`}>{label}</span>
}

function strapLabel(connection: StrapConnection | null): string | null {
  if (!connection) return null
  if (connection.model && !connection.deviceName.includes(connection.model)) {
    return `${connection.deviceName} · ${connection.model}`
  }
  return connection.deviceName
}

function errorName(err: unknown): string | null {
  if (err != null && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name
  return null
}
