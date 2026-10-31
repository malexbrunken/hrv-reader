export interface SessionTags {
  sleep: number | null
  soreness: number | null
  stress: number | null
  notes: string
}

export interface Session {
  id: string
  startedAt: string
  durationSec: number
  source: 'bluetooth' | 'demo'
  deviceName: string | null
  batteryPercent: number | null
  meanHr: number | null
  rmssd: number | null
  lnRmssd: number | null
  score: number | null
  sdnn: number | null
  pnn50: number | null
  lf: number | null
  hf: number | null
  lfHf: number | null
  lfHfReliable: boolean
  sd1: number | null
  sd2: number | null
  beatsTotal: number
  beatsRemovedPct: number
  rawRr: number[]
  filteredRr: number[]
  tags: SessionTags
}

export function emptyTags(): SessionTags {
  return { sleep: null, soreness: null, stress: null, notes: '' }
}
