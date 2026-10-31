import { currentBrowserKind } from '../browserSupport'
import { isWebBluetoothSupported } from '../bluetooth/monitor'

export function BrowserBanner() {
  const kind = currentBrowserKind(isWebBluetoothSupported())
  if (kind === 'bluetooth') {
    return (
      <aside className="banner">
        <p>
          Disconnect the strap from Garmin Connect and from your watch before connecting. The HRM 600 keeps a
          single Bluetooth link.
        </p>
      </aside>
    )
  }
  if (kind === 'bluefy') {
    return (
      <aside className="banner">
        <p>
          Bluefy can reach the strap. Disconnect it from Garmin Connect and from your watch before connecting. The
          HRM 600 keeps a single Bluetooth link.
        </p>
      </aside>
    )
  }
  return (
    <aside className="banner warn" role="status">
      <p className="kicker">Browser support</p>
      <h2>{kind === 'ios-other' ? 'Open this page in Bluefy' : 'Web Bluetooth isn’t available here'}</h2>
      {kind === 'ios-other' ? (
        <p>
          Safari and other iPhone browsers can’t talk to a chest strap. Bluefy can, because it provides Web
          Bluetooth. Install Bluefy, then open this site there.
        </p>
      ) : (
        <p>Safari and Firefox can’t connect to a chest strap. Use Chrome or Edge on a computer, or Bluefy on an iPhone.</p>
      )}
      <p>
        Disconnect the strap from Garmin Connect and from your watch before connecting. The HRM 600 keeps a single
        Bluetooth link, and a watch will hold it.
      </p>
      <p>Demo mode still runs a full session with synthetic beats.</p>
    </aside>
  )
}
