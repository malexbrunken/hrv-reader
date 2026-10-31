/**
 * Bluetooth Heart Rate Measurement (UUID 0x2A37).
 *
 * Flags (uint8):
 * - bit 0: 0 = uint8 heart rate, 1 = uint16 heart rate (little-endian)
 * - bits 1–2: sensor contact (0/1 unsupported, 2 supported but not detected, 3 detected)
 * - bit 3: energy expended (uint16 kJ) follows the heart rate
 * - bit 4: one or more RR intervals follow, each uint16 in units of 1/1024 s
 * - bits 5–7: reserved
 *
 * RR intervals convert to milliseconds as raw * 1000 / 1024. A notification may
 * carry more than one interval.
 */

const FLAG_HR_16 = 0x01
const FLAG_ENERGY = 0x08
const FLAG_RR = 0x10

export interface HeartRateMeasurement {
  heartRateBpm: number
  contactSupported: boolean
  /** Null when the sensor does not report contact. */
  contactDetected: boolean | null
  energyExpendedKj: number | null
  rrIntervalsMs: number[]
}

function requireBytes(view: DataView, offset: number, bytes: number): void {
  if (view.byteLength < offset + bytes) {
    throw new Error('Heart Rate Measurement packet is truncated.')
  }
}

export function parseHeartRateMeasurement(view: DataView): HeartRateMeasurement {
  requireBytes(view, 0, 1)
  const flags = view.getUint8(0)
  const hrIs16 = (flags & FLAG_HR_16) !== 0
  const contact = (flags >> 1) & 0x03
  const energyPresent = (flags & FLAG_ENERGY) !== 0
  const rrPresent = (flags & FLAG_RR) !== 0

  let offset = 1
  let heartRateBpm: number
  if (hrIs16) {
    requireBytes(view, offset, 2)
    heartRateBpm = view.getUint16(offset, true)
    offset += 2
  } else {
    requireBytes(view, offset, 1)
    heartRateBpm = view.getUint8(offset)
    offset += 1
  }

  let energyExpendedKj: number | null = null
  if (energyPresent) {
    requireBytes(view, offset, 2)
    energyExpendedKj = view.getUint16(offset, true)
    offset += 2
  }

  const rrIntervalsMs: number[] = []
  if (rrPresent) {
    while (offset + 1 < view.byteLength) {
      const raw = view.getUint16(offset, true)
      rrIntervalsMs.push((raw * 1000) / 1024)
      offset += 2
    }
  }

  const contactSupported = contact >= 2
  return {
    heartRateBpm,
    contactSupported,
    contactDetected: contactSupported ? contact === 3 : null,
    energyExpendedKj,
    rrIntervalsMs,
  }
}
