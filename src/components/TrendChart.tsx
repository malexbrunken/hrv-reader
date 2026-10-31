import type { SessionTrend } from '../storage/sessions'

/** Keeps resting HR visible when it shares a vertical position with the score. */
const HR_X_OFFSET = 10

const WIDTH = 720
const HEIGHT = 280
const MARGIN = { left: 48, right: 48, top: 18, bottom: 36 }

export function TrendChart({ sessions }: { sessions: SessionTrend[] }) {
  const points = [...sessions]
    .filter((session) => Number.isFinite(Date.parse(session.startedAt)))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))

  const scoreValues = points.flatMap((session) => [session.score, session.rollingScore])
  const hrValues = points.flatMap((session) => [session.meanHr, session.rollingHr])
  const hasScore = scoreValues.some(isNum)
  const hasHr = hrValues.some(isNum)
  if (points.length === 0 || (!hasScore && !hasHr)) {
    return <p className="empty">A scored session will start the trend.</p>
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom
  const times = points.map((session) => Date.parse(session.startedAt))
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const scoreDomain = padded(scoreValues.filter(isNum))
  const hrDomain = padded(hrValues.filter(isNum))
  const xOf = (time: number, offset = 0) =>
    MARGIN.left + (tMax === tMin ? plotW / 2 : ((time - tMin) / (tMax - tMin)) * plotW) + offset
  const yScore = (value: number) => MARGIN.top + ((scoreDomain[1] - value) / (scoreDomain[1] - scoreDomain[0])) * plotH
  const yHr = (value: number) => MARGIN.top + ((hrDomain[1] - value) / (hrDomain[1] - hrDomain[0])) * plotH

  const scoreLine = pathFor(points, (session) => {
    if (session.score == null) return null
    return { x: xOf(Date.parse(session.startedAt)), y: yScore(session.score) }
  })
  const scoreRoll = pathFor(points, (session) => {
    if (session.rollingScore == null) return null
    return { x: xOf(Date.parse(session.startedAt)), y: yScore(session.rollingScore) }
  })
  const hrLine = pathFor(points, (session) => {
    if (session.meanHr == null) return null
    return { x: xOf(Date.parse(session.startedAt), HR_X_OFFSET), y: yHr(session.meanHr) }
  })
  const hrRoll = pathFor(points, (session) => {
    if (session.rollingHr == null) return null
    return { x: xOf(Date.parse(session.startedAt), HR_X_OFFSET), y: yHr(session.rollingHr) }
  })

  const span = tMax - tMin
  const formatTick = new Intl.DateTimeFormat(undefined, span < 2 * 24 * 60 * 60 * 1000
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' })
  const xTicks = uniqueTicks([tMin, tMin + span / 2, tMax])

  return (
    <figure className="chart-block">
      <svg
        className="chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Trend of HRV score and resting heart rate across ${points.length} sessions, with a 7-day rolling average.`}
      >
        {hasScore
          ? [scoreDomain[0], (scoreDomain[0] + scoreDomain[1]) / 2, scoreDomain[1]].map((tick) => (
              <g key={`s-${tick}`}>
                <line className="grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScore(tick)} y2={yScore(tick)} />
                <text className="tick score-tick" x={MARGIN.left - 8} y={yScore(tick) + 4} textAnchor="end">
                  {compact(tick)}
                </text>
              </g>
            ))
          : null}
        {hasHr
          ? [hrDomain[0], (hrDomain[0] + hrDomain[1]) / 2, hrDomain[1]].map((tick) => (
              <text key={`h-${tick}`} className="tick hr-tick" x={WIDTH - MARGIN.right + 8} y={yHr(tick) + 4}>
                {compact(tick)}
              </text>
            ))
          : null}
        {scoreRoll ? <path d={scoreRoll} className="line-score-roll" /> : null}
        {hrRoll ? <path d={hrRoll} className="line-hr-roll" /> : null}
        {scoreLine ? <path d={scoreLine} className="line-score" /> : null}
        {hrLine ? <path d={hrLine} className="line-hr" /> : null}
        {points.map((session) => {
          const x = xOf(Date.parse(session.startedAt))
          return (
            <g key={session.id}>
              {session.score != null ? <circle className="point-score" cx={x} cy={yScore(session.score)} r="3.2" /> : null}
              {session.meanHr != null ? (
                <circle className="point-hr" cx={x + HR_X_OFFSET} cy={yHr(session.meanHr)} r="3.5" />
              ) : null}
            </g>
          )
        })}
        {xTicks.map((tick) => (
          <text key={tick} className="tick" x={xOf(tick)} y={HEIGHT - 10} textAnchor="middle">
            {formatTick.format(tick)}
          </text>
        ))}
      </svg>
      <figcaption className="legend">
        <span><i className="swatch score" /> HRV score</span>
        <span><i className="swatch score roll" /> 7-day average</span>
        <span><i className="swatch hr" /> Resting HR</span>
        <span><i className="swatch hr roll" /> 7-day HR</span>
      </figcaption>
    </figure>
  )
}

function isNum(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

function padded(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    const pad = Math.abs(min) * 0.08 || 1
    return [min - pad, max + pad]
  }
  const pad = (max - min) * 0.14
  return [min - pad, max + pad]
}

function compact(value: number): string {
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
}

function uniqueTicks(ticks: number[]): number[] {
  const seen = new Set<string>()
  return ticks.filter((tick) => {
    const key = String(Math.round(tick))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pathFor(
  sessions: SessionTrend[],
  project: (session: SessionTrend) => { x: number; y: number } | null,
): string | null {
  let path = ''
  let drawing = false
  for (const session of sessions) {
    const point = project(session)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      drawing = false
      continue
    }
    path += `${drawing ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)} `
    drawing = true
  }
  const trimmed = path.trim()
  return trimmed || null
}
