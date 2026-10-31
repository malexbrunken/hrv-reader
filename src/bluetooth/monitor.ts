import { parseHeartRateMeasurement, type HeartRateMeasurement } from '../hrv/parseHeartRate'

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator && navigator.bluetooth != null
}

export interface StrapConnection {
  deviceName: string
  manufacturer: string | null
  model: string | null
  batteryPercent: number | null
  subscribe(listener: (measurement: HeartRateMeasurement) => void): () => void
  onDisconnected(listener: () => void): () => void
  disconnect(): void
}

interface GattCharacteristic {
  value?: DataView
  startNotifications(): Promise<GattCharacteristic>
  readValue(): Promise<DataView>
  addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
  removeEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
}

interface GattService {
  getCharacteristic(name: string): Promise<GattCharacteristic>
}

interface GattServer {
  connected: boolean
  getPrimaryService(name: string): Promise<GattService>
  disconnect(): void
}

interface BtDevice {
  name?: string
  gatt?: { connect(): Promise<GattServer> } | null
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void
  removeEventListener(type: 'gattserverdisconnected', listener: () => void): void
}

interface BluetoothLike {
  requestDevice(options: {
    filters: Array<{ services: string[] }>
    optionalServices: string[]
  }): Promise<BtDevice>
}

function decodeString(view: DataView): string {
  return new TextDecoder('utf-8').decode(view).replaceAll('\0', '').trim()
}

async function readBattery(server: GattServer): Promise<number | null> {
  try {
    const service = await server.getPrimaryService('battery_service')
    const characteristic = await service.getCharacteristic('battery_level')
    const value = await characteristic.readValue()
    const level = value.getUint8(0)
    return level <= 100 ? level : null
  } catch {
    return null
  }
}

async function readInfo(server: GattServer): Promise<{ manufacturer: string | null; model: string | null }> {
  try {
    const service = await server.getPrimaryService('device_information')
    const read = async (name: string): Promise<string | null> => {
      try {
        const characteristic = await service.getCharacteristic(name)
        const text = decodeString(await characteristic.readValue())
        return text || null
      } catch {
        return null
      }
    }
    const [manufacturer, model] = await Promise.all([
      read('manufacturer_name_string'),
      read('model_number_string'),
    ])
    return { manufacturer, model }
  } catch {
    return { manufacturer: null, model: null }
  }
}

/**
 * Ask for a Heart Rate Service device and subscribe to Heart Rate Measurement.
 * Battery and Device Information are requested as optional services.
 * Must be called from a user gesture.
 */
export async function connectHeartRateMonitor(): Promise<StrapConnection> {
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth
  if (!bluetooth) throw new Error('Web Bluetooth is not available in this browser.')

  const device = await bluetooth.requestDevice({
    filters: [{ services: ['heart_rate'] }],
    optionalServices: ['battery_service', 'device_information'],
  })
  if (!device.gatt) throw new Error('This browser did not expose a GATT connection for the strap.')

  const server = await device.gatt.connect()
  const heartRate = await server.getPrimaryService('heart_rate')
  const measurement = await heartRate.getCharacteristic('heart_rate_measurement')
  await measurement.startNotifications()

  const [batteryPercent, info] = await Promise.all([readBattery(server), readInfo(server)])
  const listeners = new Set<(value: HeartRateMeasurement) => void>()
  const disconnectListeners = new Set<() => void>()

  const onValue = (event: Event) => {
    const target = event.target as GattCharacteristic | null
    const value = target?.value
    if (!value) return
    try {
      const parsed = parseHeartRateMeasurement(value)
      for (const listener of listeners) listener(parsed)
    } catch {
      // Ignore a malformed notification and keep the subscription.
    }
  }
  const onDisconnected = () => {
    for (const listener of disconnectListeners) listener()
  }

  measurement.addEventListener('characteristicvaluechanged', onValue)
  device.addEventListener('gattserverdisconnected', onDisconnected)

  return {
    deviceName: device.name?.trim() || 'Heart rate strap',
    manufacturer: info.manufacturer,
    model: info.model,
    batteryPercent,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onDisconnected(listener) {
      disconnectListeners.add(listener)
      return () => disconnectListeners.delete(listener)
    },
    disconnect() {
      measurement.removeEventListener('characteristicvaluechanged', onValue)
      device.removeEventListener('gattserverdisconnected', onDisconnected)
      listeners.clear()
      if (server.connected) server.disconnect()
      for (const listener of disconnectListeners) listener()
      disconnectListeners.clear()
    },
  }
}
