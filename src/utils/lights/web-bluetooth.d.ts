// The parts of Web Bluetooth the room lights use (TypeScript's DOM lib doesn't include it)
interface BluetoothRemoteGATTCharacteristic {
  writeValueWithoutResponse(value: BufferSource): Promise<void>
  writeValueWithResponse(value: BufferSource): Promise<void>
}
interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>
}
interface BluetoothRemoteGATTServer {
  connected: boolean
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>
}
interface BluetoothDevice extends EventTarget {
  id: string
  name?: string
  gatt?: BluetoothRemoteGATTServer
}
interface Bluetooth {
  requestDevice(options: { filters: { name?: string; namePrefix?: string }[]; optionalServices?: string[] }): Promise<BluetoothDevice>
}
interface Navigator {
  readonly bluetooth: Bluetooth
}
