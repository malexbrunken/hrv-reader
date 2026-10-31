import { describe, expect, it } from 'vitest'
import { detectBrowser } from './browserSupport'

describe('detectBrowser', () => {
  it('treats an iPhone with Web Bluetooth as Bluefy', () => {
    expect(
      detectBrowser({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
        bluetooth: true,
      }),
    ).toBe('bluefy')
  })

  it('tells other iOS browsers apart from desktop browsers that lack Bluetooth', () => {
    expect(
      detectBrowser({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
        bluetooth: false,
      }),
    ).toBe('ios-other')
    expect(
      detectBrowser({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/130.0',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        bluetooth: false,
      }),
    ).toBe('unsupported')
  })
})
