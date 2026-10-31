import { useState, type PointerEvent } from 'react'
import { fmt } from '../format'

export interface TachogramPoint {
  t: number
  rr: number
}

const WIDTH = 640
const HEIGHT = 240
const MARGIN = { left: 48, right: 14, top: 16, bottom: 36 }

export function Tachogram({ points }: { points: TachogramPoint[] }) {
  const [hover, setHover] = useState<TachogramPoint | null>(null)
  if (points.length === 0) {
    return <p className="empty">RR intervals will draw here once the session is recording.</p>
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom
  const last = points[points.length - 1]
  const xMax = Math.max(last?.t ?? 1, 1)
  const [yMin, yMax] = domain(points.map((point) => point.rr))
  const xOf = (t: number) => MARGIN.left + (t / xMax) * plotW
  const yOf = (rr: number) => MARGIN.top + ((yMax - rr) / (yMax - yMin)) * plotH

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(point.t).toFixed(2)} ${yOf(point.rr).toFixed(2)}`)
    .join(' ')

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH
    let nearest = points[0]
    if (!nearest) return
    let best = Infinity
    for (const point of points) {
      const distance = Math.abs(xOf(point.t) - px)
      if (distance < best) {
        best = distance
        nearest = point
      }
    }
    setHover(nearest)
  }

  return (
    <figure className="chart-block">
      <svg
        className="chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`RR tachogram of ${points.length} beats. Latest interval ${Math.round(last?.rr ?? 0)} milliseconds.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        {[yMin, (yMin + yMax) / 2, yMax].map((tick) => (
          <g key={tick}>
            <line className="grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yOf(tick)} y2={yOf(tick)} />
            <text className="tick" x={MARGIN.left - 8} y={yOf(tick) + 4} textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        ))}
        <text className="tick" x={MARGIN.left} y={HEIGHT - 10}>
          0s
        </text>
        <text className="tick" x={WIDTH - MARGIN.right} y={HEIGHT - 10} textAnchor="end">
          {xMax.toFixed(0)}s
        </text>
        <path d={path} className="line-rr" />
        {hover ? <circle className="point-rr" cx={xOf(hover.t)} cy={yOf(hover.rr)} r="4" /> : null}
      </svg>
      <figcaption className="hint">
        {hover
          ? `${fmt(hover.rr, 0)} ms at ${hover.t.toFixed(1)} s`
          : `${points.length} clean beats · milliseconds between beats`}
      </figcaption>
    </figure>
  )
}

function domain(values: number[]): [number, number] {
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [600, 1200]
  if (max - min < 40) {
    const mid = (min + max) / 2
    min = mid - 20
    max = mid + 20
  }
  const pad = (max - min) * 0.12
  return [min - pad, max + pad]
}
