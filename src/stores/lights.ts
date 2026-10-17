/**
 * Room lights: drives Govee bulbs over Bluetooth in time with the music.
 *
 * About 30 times a second it reads where playback is (from the audio clock), works out each
 * bulb's colour with the light show (utils/lights/show) and sends what changed. Beat grids
 * and cover colours are loaded per song, including the next one so transitions are ready.
 *
 * While music plays it tells Keystone (through the Mac's Keystone forwarder) that Aurora has
 * the lights: Keystone pauses "Match outside" and shows a notice. Pausing hands them back:
 * warm white after a moment, then Keystone takes over again.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePlayerStore } from './player'
import { coverPalette } from '@/utils/coverColor'
import { getBeatGrid } from '@/utils/transitions/analysis'
import { frame, usableGrid, beatPosition, WARM_WHITE, type LightIntensity } from '@/utils/lights/show'
import { setColour, connectedNames, onBulbsChange, disconnectAll, type RGB } from '@/utils/lights/govee'
import type { BeatGrid } from '@/types/transition'

export interface LightBulb {
  /** Bluetooth name */
  name: string
  label: string
  on: boolean
}

/** Jason's bedroom, in chase order. The Sunset Light is left out: it can only show red. */
const DEFAULT_BULBS: LightBulb[] = [
  { name: 'ihoment_H6008_3B85', label: 'Top', on: true },
  { name: 'ihoment_H6008_A9B9', label: 'Middle', on: true },
  { name: 'ihoment_H6008_7FCD', label: 'Bottom', on: true },
  { name: 'ihoment_H6008_B597', label: 'Dresser', on: true },
  { name: 'ihoment_H6006_9075', label: 'Corner', on: true },
  { name: 'ihoment_H6006_BC87', label: 'Hall', on: false },
]

const TICK_MS = 33
/** Bluetooth write → light change, roughly; frames are computed this far ahead */
const SEND_LEAD = 0.04
/** After a pause: warm white after this long, and Keystone gets the lights back after this */
const PAUSE_WHITE_MS = 1200
const PAUSE_RELEASE_MS = 4000
/** Let go of Bluetooth after this long paused, so the Govee app can reach the bulbs */
const IDLE_DISCONNECT_MS = 3 * 60 * 1000
const HEARTBEAT_MS = 10000

type Status = 'off' | 'connecting' | 'on' | 'error'

export const useLightsStore = defineStore('lights', () => {
  const enabled = ref(false)
  const bulbs = ref<LightBulb[]>(DEFAULT_BULBS.map(b => ({ ...b })))
  const intensity = ref<LightIntensity>('normal')
  /** Manual timing nudge in ms: positive = lights earlier */
  const offsetMs = ref(0)
  const status = ref<Status>('off')
  const statusText = ref('')
  const connected = ref<string[]>([])
  const keystone = ref<'unknown' | 'claimed' | 'released' | 'unreachable'>('unknown')

  const activeBulbs = computed(() => bulbs.value.filter(b => b.on))

  // ── Per-song data ──────────────────────────────────────────────────────────
  const grids = new Map<string, BeatGrid | null>()
  const palettes = new Map<string, RGB[]>()
  const loading = new Set<string>()
  let decodeCtx: AudioContext | null = null

  async function loadSong(track: Track | null | undefined) {
    if (!track?.path || loading.has(track.path) || grids.has(track.path)) return
    loading.add(track.path)
    try {
      palettes.set(track.path, track.coverArt ? await coverPalette(track.coverArt) : [])
      let grid: BeatGrid | null = null
      try {
        const cached = await window.api.getBeatGrid(track.path)
        if (usableGrid(cached)) grid = cached
      } catch { /* analyse below */ }
      if (!grid) {
        const data = await (await fetch(window.api.getMediaUrl(track.path))).arrayBuffer()
        decodeCtx ??= new AudioContext()
        grid = await getBeatGrid(track.path, await decodeCtx.decodeAudioData(data))
      }
      grids.set(track.path, grid)
    } catch (err) {
      console.warn('[Lights] Couldn\'t analyse', track.path, err)
      grids.set(track.path, null)
    } finally {
      loading.delete(track.path)
    }
    // Keep memory in check: these are small, but a long session adds up
    while (grids.size > 40) grids.delete(grids.keys().next().value!)
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async function init() {
    try {
      const s = (await window.api.getSettings())?.roomLights
      if (s) {
        if (Array.isArray(s.bulbs)) {
          // Keep saved choices, but pick up any bulb added to the defaults since
          const saved = new Map<string, LightBulb>(s.bulbs.map((b: LightBulb) => [b.name, b]))
          bulbs.value = [...s.bulbs, ...DEFAULT_BULBS.filter(b => !saved.has(b.name))]
        }
        if (['chill', 'normal', 'party'].includes(s.intensity)) intensity.value = s.intensity
        if (typeof s.offsetMs === 'number') offsetMs.value = s.offsetMs
        if (s.enabled) setEnabled(true)
      }
    } catch { /* no settings yet */ }
    onBulbsChange(() => { connected.value = connectedNames() })
    window.addEventListener('beforeunload', () => { if (claimed) window.api.lightsKeystone('release') })
  }

  function save() {
    window.api.mergeSettings({
      roomLights: { enabled: enabled.value, bulbs: bulbs.value, intensity: intensity.value, offsetMs: offsetMs.value },
    })
  }

  function setEnabled(on: boolean) {
    enabled.value = on
    save()
    if (on) start()
    else stop()
  }
  function setIntensity(v: LightIntensity) { intensity.value = v; save() }
  function setOffset(ms: number) { offsetMs.value = Math.max(-500, Math.min(500, Math.round(ms))); save() }
  function toggleBulb(name: string) {
    const b = bulbs.value.find(x => x.name === name)
    if (!b) return
    b.on = !b.on
    save()
    if (b.on && enabled.value) connect()
    if (!b.on) setColour(name, scaleRGB(WARM_WHITE, 0.6))
  }

  // ── Connection ─────────────────────────────────────────────────────────────
  let connecting: Promise<void> | null = null
  function connect(): Promise<void> {
    if (connecting) return connecting
    const missing = activeBulbs.value.map(b => b.name).filter(n => !connectedNames().includes(n))
    if (!missing.length) { status.value = 'on'; return Promise.resolve() }
    status.value = 'connecting'
    statusText.value = `Connecting to ${missing.length} light${missing.length > 1 ? 's' : ''}…`
    connecting = window.api.lightsConnect(missing).then(results => {
      connected.value = connectedNames()
      const failed = Object.entries(results).filter(([, r]) => r !== 'ok')
      const label = (n: string) => bulbs.value.find(b => b.name === n)?.label ?? n
      if (!connected.value.length) {
        status.value = 'error'
        statusText.value = failed.length ? `Couldn't connect: ${failed[0][1]}` : 'Couldn\'t connect'
      } else {
        status.value = 'on'
        statusText.value = failed.length ? `Not found: ${failed.map(([n]) => label(n)).join(', ')}` : ''
      }
    }).finally(() => { connecting = null })
    return connecting
  }

  // ── Keystone ───────────────────────────────────────────────────────────────
  let claimed = false
  let lastHeartbeat = 0
  function keystoneBody() {
    const t = usePlayerStore().currentTrack
    return { track: t?.title ?? '', artist: t?.artist ?? '', lights: activeBulbs.value.map(b => b.label) }
  }
  async function claim() {
    claimed = true
    lastHeartbeat = Date.now()
    const r = await window.api.lightsKeystone('claim', keystoneBody())
    keystone.value = r?.ok ? 'claimed' : 'unreachable'
  }
  function heartbeat() {
    if (Date.now() - lastHeartbeat < HEARTBEAT_MS) return
    lastHeartbeat = Date.now()
    window.api.lightsKeystone('update', keystoneBody())
  }
  async function release() {
    if (!claimed) return
    claimed = false
    const r = await window.api.lightsKeystone('release')
    keystone.value = r?.ok ? 'released' : 'unreachable'
  }

  // ── The loop ───────────────────────────────────────────────────────────────
  let timer: ReturnType<typeof setInterval> | null = null
  let pausedAt = 0
  let restingSent = false
  const lastSent = new Map<string, RGB>()
  let lastTrackPath = ''
  let lastBeat = -1

  function start() {
    if (timer) return
    connect()
    timer = setInterval(tick, TICK_MS)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
    for (const b of activeBulbs.value) setColour(b.name, scaleRGB(WARM_WHITE, 0.6))
    release()
    setTimeout(disconnectAll, 1500)
    status.value = 'off'
    statusText.value = ''
    connected.value = []
    lastSent.clear()
  }

  function tick() {
    const player = usePlayerStore()
    const clock = player.lightsClock()
    const now = performance.now()

    if (!clock.playing || !clock.track) {
      if (!pausedAt) pausedAt = now
      const paused = now - pausedAt
      if (paused > PAUSE_WHITE_MS && !restingSent) {
        restingSent = true
        for (const b of activeBulbs.value) send(b.name, scaleRGB(WARM_WHITE, 0.6), true)
      }
      if (paused > PAUSE_RELEASE_MS) release()
      if (paused > IDLE_DISCONNECT_MS && connected.value.length) {
        disconnectAll()
        status.value = 'off'
        statusText.value = 'Paused: lights disconnected so the Govee app can use them'
      }
      return
    }

    pausedAt = 0
    restingSent = false
    if (!claimed) claim()
    else heartbeat()
    if (connected.value.length < activeBulbs.value.length && !connecting && status.value !== 'error') connect()

    const track = clock.track
    if (track.path !== lastTrackPath) {
      lastTrackPath = track.path
      loadSong(track)
      loadSong(player.upcomingTrack())
    }
    if (clock.next) loadSong(clock.next.track)

    const ahead = SEND_LEAD + offsetMs.value / 1000 - clock.latency
    const useNext = !!clock.next && clock.next.mix >= 0.5
    const t = (useNext ? clock.next!.pos : clock.pos) + ahead
    const grid = grids.get(useNext ? clock.next!.track.path : track.path) ?? null
    const names = activeBulbs.value.map(b => b.name)
    const colours = frame({
      t,
      grid,
      palette: palettes.get(track.path) ?? [],
      bulbs: names.length,
      intensity: intensity.value,
      next: clock.next ? { palette: palettes.get(clock.next.track.path) ?? palettes.get(track.path) ?? [], mix: clock.next.mix } : undefined,
      flash: clock.next?.sinceBassSwap != null && clock.next.sinceBassSwap >= 0 ? Math.exp(-clock.next.sinceBassSwap * 5) : 0,
    })
    // On a new beat send everything, so every bulb hits at once
    const beat = usableGrid(grid) ? beatPosition(grid, t).beat : -1
    const onBeat = beat !== lastBeat
    lastBeat = beat
    names.forEach((n, i) => send(n, colours[i], onBeat))
  }

  function send(name: string, rgb: RGB, force: boolean) {
    const prev = lastSent.get(name)
    if (!force && prev && Math.abs(prev[0] - rgb[0]) + Math.abs(prev[1] - rgb[1]) + Math.abs(prev[2] - rgb[2]) < 18) return
    lastSent.set(name, rgb)
    setColour(name, rgb)
  }

  return {
    enabled, bulbs, intensity, offsetMs, status, statusText, connected, keystone,
    init, setEnabled, setIntensity, setOffset, toggleBulb, connect,
  }
})

function scaleRGB(c: RGB, k: number): RGB {
  return c.map(v => Math.round(v * k)) as RGB
}
