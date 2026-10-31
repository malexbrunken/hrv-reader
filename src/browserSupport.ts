export type BrowserKind = 'bluefy' | 'ios-other' | 'bluetooth' | 'unsupported'

export function detectBrowser(input: {
  userAgent: string
  platform: string
  maxTouchPoints: number
  bluetooth: boolean
}): BrowserKind {
  const ios =
    /iPad|iPhone|iPod/i.test(input.userAgent) ||
    (input.platform === 'MacIntel' && input.maxTouchPoints > 1)
  const bluefy = /bluefy/i.test(input.userAgent)
  if (ios && (input.bluetooth || bluefy)) return 'bluefy'
  if (ios) return 'ios-other'
  if (input.bluetooth) return 'bluetooth'
  return 'unsupported'
}

export function currentBrowserKind(bluetooth: boolean): BrowserKind {
  if (typeof navigator === 'undefined') return bluetooth ? 'bluetooth' : 'unsupported'
  return detectBrowser({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    bluetooth,
  })
}
