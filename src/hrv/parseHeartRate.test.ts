import { describe, expect, it } from 'vitest'
import { parseHeartRateMeasurement } from './parseHeartRate'

function view(bytes: number[], byteOffset = 0): DataView {
  const buffer = Uint8Array.from(bytes)
  return new DataView(buffer.buffer, byteOffset, buffer.byteLength - byteOffset)
}

describe('parseHeartRateMeasurement', () => {
  it('reads an 8-bit heart rate and ignores reserved flag bits', () => {
    const parsed = parseHeartRateMeasurement(view([0x00, 60]))
    expect(parsed).toEqual({
      heartRateBpm: 60,
      contactSupported: false,
      contactDetected: null,
      energyExpendedKj: null,
      rrIntervalsMs: [],
    })

    const reserved = parseHeartRateMeasurement(view([0x80, 72]))
    expect(reserved.heartRateBpm).toBe(72)
    expect(reserved.rrIntervalsMs).toEqual([])
  })

  it('reads a little-endian 16-bit heart rate', () => {
    const parsed = parseHeartRateMeasurement(view([0x01, 0x2c, 0x01]))
    expect(parsed.heartRateBpm).toBe(300)
    expect(parsed.energyExpendedKj).toBeNull()
    expect(parsed.rrIntervalsMs).toEqual([])
  })

  it('decodes sensor contact without consuming extra bytes', () => {
    const detected = parseHeartRateMeasurement(view([0x06, 55]))
    expect(detected.heartRateBpm).toBe(55)
    expect(detected.contactSupported).toBe(true)
    expect(detected.contactDetected).toBe(true)

    const missing = parseHeartRateMeasurement(view([0x04, 55]))
    expect(missing.contactSupported).toBe(true)
    expect(missing.contactDetected).toBe(false)

    const unsupported = parseHeartRateMeasurement(view([0x02, 55]))
    expect(unsupported.contactSupported).toBe(false)
    expect(unsupported.contactDetected).toBeNull()
  })

  it('reads energy expended in kilojoules, including zero', () => {
    const parsed = parseHeartRateMeasurement(view([0x08, 70, 0x64, 0x00]))
    expect(parsed.heartRateBpm).toBe(70)
    expect(parsed.energyExpendedKj).toBe(100)

    const zero = parseHeartRateMeasurement(view([0x08, 70, 0x00, 0x00]))
    expect(zero.energyExpendedKj).toBe(0)
  })

  it('converts one or more RR intervals from 1/1024 s to milliseconds', () => {
    const one = parseHeartRateMeasurement(view([0x10, 60, 0x00, 0x04]))
    expect(one.rrIntervalsMs).toEqual([1000])

    const three = parseHeartRateMeasurement(view([0x10, 60, 0x00, 0x04, 0x00, 0x02, 0x00, 0x03]))
    expect(three.rrIntervalsMs).toEqual([1000, 500, 750])

    const trailingByte = parseHeartRateMeasurement(view([0x10, 60, 0x00, 0x04, 0xff]))
    expect(trailingByte.rrIntervalsMs).toEqual([1000])

    const flaggedEmpty = parseHeartRateMeasurement(view([0x10, 60]))
    expect(flaggedEmpty.rrIntervalsMs).toEqual([])
  })

  it('keeps field offsets correct when every optional flag is set', () => {
    // 16-bit HR, contact detected, energy, RR, plus a reserved bit.
    const flags = 0x01 | 0x06 | 0x08 | 0x10 | 0x80
    const parsed = parseHeartRateMeasurement(
      view([flags, 0xb4, 0x00, 0x0f, 0x00, 0x00, 0x04, 0x00, 0x02]),
    )
    expect(parsed.heartRateBpm).toBe(180)
    expect(parsed.contactDetected).toBe(true)
    expect(parsed.energyExpendedKj).toBe(15)
    expect(parsed.rrIntervalsMs).toEqual([1000, 500])
  })

  it('reads a view that does not start at byte zero of its buffer', () => {
    const parsed = parseHeartRateMeasurement(view([0xab, 0x00, 61], 1))
    expect(parsed.heartRateBpm).toBe(61)
  })

  it('rejects truncated packets', () => {
    expect(() => parseHeartRateMeasurement(view([]))).toThrow(/truncated/)
    expect(() => parseHeartRateMeasurement(view([0x01, 0x10]))).toThrow(/truncated/)
    expect(() => parseHeartRateMeasurement(view([0x08, 60]))).toThrow(/truncated/)
    expect(() => parseHeartRateMeasurement(view([0x09, 0x01]))).toThrow(/truncated/)
  })
})
