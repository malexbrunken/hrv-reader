/**
 * Synthetic chest-strap RR series for demo mode.
 *
 * A ~61 bpm rhythm with respiratory sinus arrhythmia near 0.26 Hz, a slower
 * wave near 0.09 Hz, a little noise, and rare ectopic beats so the artifact
 * filter has something to remove.
 */

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function synthesizeRr(tSec: number, rand: () => number): number {
  const respiratory = 36 * Math.sin(2 * Math.PI * 0.26 * tSec)
  const lowFreq = 16 * Math.sin(2 * Math.PI * 0.09 * tSec + 0.4)
  const noise = (rand() - 0.5) * 14
  let rr = 980 + respiratory + lowFreq + noise
  const roll = rand()
  if (roll < 0.008) rr = 420 + rand() * 40
  else if (roll < 0.012) rr = 1600 + rand() * 200
  return Math.round(Math.min(2400, Math.max(250, rr)))
}

/** Deterministic series. `t` advances by each interval, the way a strap does. */
export function generateRrSeries(count: number, seed: number): number[] {
  const rand = mulberry32(seed)
  const series: number[] = []
  let t = 0
  for (let i = 0; i < count; i++) {
    const rr = synthesizeRr(t, rand)
    series.push(rr)
    t += rr / 1000
  }
  return series
}

export interface RrSimulator {
  start(onBeat: (rrMs: number, hrBpm: number) => void): void
  stop(): void
}

/** Emits beats on the wall clock, one timeout per interval. */
export function createRrSimulator(seed = Date.now()): RrSimulator {
  const rand = mulberry32(seed)
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let t = 0

  return {
    start(onBeat) {
      stopped = false
      const tick = () => {
        if (stopped) return
        const rr = synthesizeRr(t, rand)
        t += rr / 1000
        onBeat(rr, Math.max(1, Math.round(60000 / rr)))
        timer = setTimeout(tick, rr)
      }
      tick()
    },
    stop() {
      stopped = true
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
