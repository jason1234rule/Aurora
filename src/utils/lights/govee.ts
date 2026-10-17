/**
 * Govee bulbs over Bluetooth (Web Bluetooth in the renderer).
 *
 * Govee's BLE commands are 20-byte packets: 0x33, a command, its data, zero padding and an
 * XOR checksum. Colour has two variants depending on the model (0x02 older, 0x0D newer);
 * bulbs ignore the one they don't use, so both are sent. Tested on H6008 and H6006 bulbs.
 *
 * Connecting needs a user gesture, so the main process calls connectOne() through
 * executeJavaScript with userGesture set. Reconnecting a known device doesn't need one.
 */
export const GOVEE_SERVICE = '00010203-0405-0607-0809-0a0b0c0d1910'
export const GOVEE_WRITE = '00010203-0405-0607-0809-0a0b0c0d2b11'

export type RGB = [number, number, number]

export function packet(...bytes: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(20)
  bytes.slice(0, 19).forEach((b, i) => { out[i] = b & 0xff })
  let x = 0
  for (let i = 0; i < 19; i++) x ^= out[i]
  out[19] = x
  return out
}

export const colourPackets = ([r, g, b]: RGB) => [packet(0x33, 0x05, 0x02, r, g, b), packet(0x33, 0x05, 0x0d, r, g, b)]
export const powerPacket = (on: boolean) => packet(0x33, 0x01, on ? 1 : 0)
/** Brightness 0–255 */
export const brightnessPacket = (level: number) => packet(0x33, 0x04, Math.max(1, Math.min(255, Math.round(level))))
/** Govee drops idle connections; this keeps them open */
export const keepAlivePacket = () => packet(0xaa, 0x01)

interface Bulb {
  name: string
  device: BluetoothDevice
  char: BluetoothRemoteGATTCharacteristic | null
  busy: boolean
  /** Latest colour waiting to go out while a write is in flight */
  queued: RGB | null
  reconnecting: boolean
}

const bulbs = new Map<string, Bulb>()
let keepAliveTimer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(f => f())

async function attach(b: Bulb) {
  const server = await b.device.gatt!.connect()
  const service = await server.getPrimaryService(GOVEE_SERVICE)
  b.char = await service.getCharacteristic(GOVEE_WRITE)
  await write(b, powerPacket(true))
  await write(b, brightnessPacket(255))
}

async function write(b: Bulb, data: Uint8Array<ArrayBuffer>) {
  if (!b.char) return
  await b.char.writeValueWithoutResponse(data)
}

async function reconnect(b: Bulb) {
  if (b.reconnecting || !bulbs.has(b.name)) return
  b.reconnecting = true
  b.char = null
  changed()
  for (let attempt = 0; attempt < 5 && bulbs.has(b.name); attempt++) {
    try {
      await attach(b)
      break
    } catch {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  b.reconnecting = false
  changed()
}

/** Called from the main process inside a user gesture. Resolves to 'ok' or an error. */
async function connectOne(name: string): Promise<string> {
  const existing = bulbs.get(name)
  if (existing?.char) return 'ok'
  try {
    const device = existing?.device ?? await navigator.bluetooth.requestDevice({
      filters: [{ name }],
      optionalServices: [GOVEE_SERVICE],
    })
    const b: Bulb = existing ?? { name, device, char: null, busy: false, queued: null, reconnecting: false }
    if (!existing) {
      bulbs.set(name, b)
      device.addEventListener('gattserverdisconnected', () => { reconnect(b) })
    }
    await attach(b)
    if (!keepAliveTimer) keepAliveTimer = setInterval(keepAlive, 2000)
    changed()
    return 'ok'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

function keepAlive() {
  for (const b of bulbs.values()) {
    if (b.char && !b.busy) write(b, keepAlivePacket()).catch(() => {})
  }
}

/**
 * Set a bulb's colour. Writes never pile up: while one is in flight only the newest colour
 * is kept, so a slow bulb skips frames instead of falling behind.
 */
export function setColour(name: string, rgb: RGB) {
  const b = bulbs.get(name)
  if (!b?.char) return
  if (b.busy) { b.queued = rgb; return }
  b.busy = true
  const send = async (c: RGB) => {
    try {
      for (const p of colourPackets(c)) await write(b, p)
    } catch { /* a dropped write is fine: the next frame replaces it */ }
    const next = b.queued
    b.queued = null
    if (next) await send(next)
  }
  send(rgb).finally(() => { b.busy = false })
}

export function connectedNames(): string[] {
  return [...bulbs.values()].filter(b => b.char).map(b => b.name)
}

export function onBulbsChange(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

export function disconnectAll() {
  for (const b of bulbs.values()) {
    bulbs.delete(b.name)
    try { b.device.gatt?.disconnect() } catch { /* already gone */ }
  }
  if (keepAliveTimer) clearInterval(keepAliveTimer)
  keepAliveTimer = null
  changed()
}

declare global {
  interface Window { __auroraLights?: { connectOne: (name: string) => Promise<string> } }
}
if (typeof window !== 'undefined') window.__auroraLights = { connectOne }
