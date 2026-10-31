import { fmt } from '../format'
import { mean } from '../hrv/stats'

const SIZE = 340
const MARGIN = { left: 48, right: 16, top: 16, bottom: 48 }

export function PoincarePlot({
  rr,
  sd1,
  sd2,
}: {
  rr: number[]
  sd1: number | null
  sd2: number | null
}) {
  if (rr.length < 2) {
    return <p className="empty">Not enough clean beats for a Poincaré plot.</p>
  }

  const xs = rr.slice(0, -1)
  const ys = rr.slice(1)
  const meanX = mean(xs) ?? 0
  const meanY = mean(ys) ?? 0
  const samples = [...xs, ...ys]
  if (sd1 != null && sd2 != null) {
    const reach = Math.sqrt((sd1 * sd1 + sd2 * sd2) / 2)
    samples.push(meanX - reach, meanX + reach, meanY - reach, meanY + reach)
  }
  const [min, max] = squareDomain(samples)
  const plot = SIZE - MARGIN.left - MARGIN.right
  const xOf = (value: number) => MARGIN.left + ((value - min) / (max - min)) * plot
  const yOf = (value: number) => MARGIN.top + ((max - value) / (max - min)) * plot
  const unit = (ms: number) => (ms / (max - min)) * plot
  const showEllipse = sd1 != null && sd2 != null && (sd1 > 0 || sd2 > 0)

  return (
    <figure className="chart-block">
      <svg
        className="chart poincare"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Poincaré plot. SD1 ${sd1 == null ? 'unavailable' : `${sd1.toFixed(1)} ms`}, SD2 ${sd2 == null ? 'unavailable' : `${sd2.toFixed(1)} ms`}.`}
      >
        <line className="grid" x1={xOf(min)} y1={yOf(min)} x2={xOf(max)} y2={yOf(max)} />
        {[min, (min + max) / 2, max].map((tick) => (
          <g key={tick}>
            <text className="tick" x={MARGIN.left - 8} y={yOf(tick) + 4} textAnchor="end">
              {Math.round(tick)}
            </text>
            <text className="tick" x={xOf(tick)} y={SIZE - 28} textAnchor="middle">
              {Math.round(tick)}
            </text>
          </g>
        ))}
        <text className="tick" x={SIZE / 2} y={SIZE - 8} textAnchor="middle">
          RRₙ (ms)
        </text>
        <text className="tick y-label" x={14} y={SIZE / 2} textAnchor="middle" transform={`rotate(-90 14 ${SIZE / 2})`}>
          RRₙ₊₁ (ms)
        </text>
        {showEllipse ? (
          <g transform={`translate(${xOf(meanX).toFixed(2)} ${yOf(meanY).toFixed(2)}) rotate(-45)`}>
            <ellipse className="ellipse" rx={Math.max(unit(sd2 ?? 0), 0)} ry={Math.max(unit(sd1 ?? 0), 0)} />
          </g>
        ) : null}
        {xs.map((x, index) => {
          const y = ys[index]
          if (y == null) return null
          return <circle key={`${index}-${x}-${y}`} className="point-rr" cx={xOf(x)} cy={yOf(y)} r="2.6" />
        })}
      </svg>
      <figcaption className="hint">
        SD1 {fmt(sd1, 1)} ms · SD2 {fmt(sd2, 1)} ms
      </figcaption>
    </figure>
  )
}

function squareDomain(values: number[]): [number, number] {
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [700, 1300]
  if (max - min < 40) {
    const mid = (min + max) / 2
    min = mid - 30
    max = mid + 30
  }
  const pad = (max - min) * 0.08
  return [min - pad, max + pad]
}
