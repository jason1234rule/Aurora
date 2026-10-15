import { defineStore } from 'pinia'
import { ref, shallowRef, computed, watch } from 'vue'
import { pluginBus } from '@/plugins/eventBus'
import { useTransitionsStore } from './transitions'
import {
  TransitionEngine, MEASURE_LEAD, leadInFor, prepWindowFor,
  type PrepareResult, type PreviewHandle, type PreviewOptions,
} from '@/utils/transitions/engine'
import type { TransitionTiming, AutoMeet } from '@/utils/transitions/schedule'
import { pickNextMix, type MixCandidate } from '@/utils/transitions/mix'
import { songKey } from '@/utils/smartPlaylistMatcher'
import type { Transition } from '@/types/transition'

// Lazy accessor for library store to avoid circular dependency
// Must not use require() — Vite doesn't resolve @/ aliases in require() calls
let _libStore: any = null
function getLibStore() {
  if (!_libStore) {
    // Dynamic import resolved at module level by Vite, called lazily
    _libStore = (window as any).__auroraLibStore
  }
  return _libStore
}

let _statsStore: any = null
function getStatsStore() {
  if (!_statsStore) _statsStore = (window as any).__auroraStatsStore
  return _statsStore
}

export const usePlayerStore = defineStore('player', () => {
  // ── Internal audio element ───────────────────────────────────────────────
  const audio = new Audio()
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous' // Required for Web Audio API with cross-origin sources (e.g. Navidrome streams)

  // Second audio element — used exclusively for crossfade pre-playback
  const audioNext = new Audio()
  audioNext.preload = 'auto'
  audioNext.crossOrigin = 'anonymous'

  // Stream bypass element — NOT connected to the AudioContext.
  // External CDNs (YouTube, radio) don't send CORS headers, so once `audio` is
  // wrapped by createMediaElementSource() the browser silences CORS-blocked media.
  // This element plays HTTP/HTTPS plugin streams directly to hardware instead.
  const audioStream = new Audio()
  audioStream.preload = 'auto'
  // Intentionally NO crossOrigin — external CDNs reject requests with an Origin header.
  let usingStream = false
  function activeAudio() { return usingStream ? audioStream : audio }

  // ── Subsonic stream preload system ─────────────────────────────────────
  // Two-tier cache:
  //  1. _urlCache   – resolved stream URLs for ALL subsonic tracks in the
  //                   queue. Just strings, negligible memory. Eliminates
  //                   IPC + HTTP round-trip on every track change.
  //  2. _bufferCache – live Audio elements that pre-download audio data
  //                    for a sliding window around the current track
  //                    (1 behind, 3 ahead). These consume real bandwidth
  //                    but guarantee gapless playback on slow connections.
  //
  // When loadTrack() runs, the URL is resolved instantly from _urlCache.
  // The browser often serves the same URL from its HTTP/disk cache because
  // the buffer element already fetched (or is fetching) that data.
  // Consumed buffer elements are kept alive for 30 s so the HTTP cache
  // entry doesn't get evicted before the main <audio> finishes loading.

  const _urlCache = new Map<string, string>()           // trackId → streamUrl
  const _urlInFlight = new Set<string>()                // trackIds being resolved
  const _bufferCache = new Map<string, HTMLAudioElement>() // trackId → preloading Audio
  const _disposalTimers = new Map<string, ReturnType<typeof setTimeout>>() // delayed cleanup

  // How many tracks to buffer ahead / behind the current index
  const BUFFER_AHEAD = 3
  const BUFFER_BEHIND = 1

  /** Resolve stream URLs for every subsonic track in the queue. Cheap (string
   *  only) and done in small batches to avoid flooding the server. */
  function _resolveAllUrls() {
    const q = queue.value
    for (const track of q) {
      if (
        track.source !== 'subsonic' ||
        !track.path.startsWith('subsonic://') ||
        _urlCache.has(track.id) ||
        _urlInFlight.has(track.id)
      ) continue

      _urlInFlight.add(track.id)
      const songId = track.path.replace('subsonic://', '')
      window.api.subsonicGetStreamUrl(songId).then((url) => {
        _urlInFlight.delete(track.id)
        _urlCache.set(track.id, url)
      }).catch(() => {
        _urlInFlight.delete(track.id)
      })
    }
  }

  /** Maintain the audio-buffer sliding window (1 behind, 3 ahead). */
  function _updateBufferWindow() {
    const idx = currentIndex.value
    const q = queue.value

    // Determine which track IDs should have active buffer elements
    const wantBuffered = new Set<string>()
    const lo = Math.max(0, idx - BUFFER_BEHIND)
    const hi = Math.min(q.length - 1, idx + BUFFER_AHEAD)
    for (let i = lo; i <= hi; i++) {
      const t = q[i]
      if (t && t.source === 'subsonic' && t.path.startsWith('subsonic://')) {
        wantBuffered.add(t.id)
      }
    }

    // Evict buffer entries outside the window (with delayed disposal)
    for (const [id, el] of _bufferCache) {
      if (!wantBuffered.has(id)) {
        _bufferCache.delete(id)
        _scheduleDisposal(id, el)
      }
    }

    // Create buffer elements for tracks in the window that aren't buffered yet
    for (let i = lo; i <= hi; i++) {
      const t = q[i]
      if (!t || t.source !== 'subsonic' || !t.path.startsWith('subsonic://')) continue
      if (_bufferCache.has(t.id)) continue

      // We need a resolved URL to start buffering
      const url = _urlCache.get(t.id)
      if (!url) {
        // URL not ready yet — _resolveAllUrls is working on it.
        // We'll pick it up on the next _updateBufferWindow call.
        continue
      }

      // Cancel any pending delayed disposal for this track (re-entering window)
      _cancelDisposal(t.id)

      const preAudio = new Audio()
      preAudio.preload = 'auto'
      preAudio.crossOrigin = 'anonymous'
      preAudio.src = url
      preAudio.load()
      _bufferCache.set(t.id, preAudio)
    }
  }

  /** Schedule delayed disposal of a buffer element so the browser HTTP cache
   *  stays warm for the main audio element. */
  function _scheduleDisposal(id: string, el: HTMLAudioElement) {
    // If thre's already a pending timer for a different element, clear it
    _cancelDisposal(id)
    _disposalTimers.set(id, setTimeout(() => {
      el.src = ''
      el.load()
      _disposalTimers.delete(id)
    }, 30_000))
  }

  function _cancelDisposal(id: string) {
    const timer = _disposalTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      _disposalTimers.delete(id)
    }
  }

  /** Main preload entry point — call after track loads or queue mutations. */
  function _preloadAdjacent() {
    _resolveAllUrls()
    _updateBufferWindow()

    // Retry buffer creation shortly — some URLs may still be in flight
    setTimeout(_updateBufferWindow, 1500)
  }

  /** Get a resolved stream URL from cache (returns null if not yet resolved). */
  function _getCachedUrl(trackId: string): string | null {
    return _urlCache.get(trackId) ?? null
  }

  /** Dispose all preload caches (on clearQueue etc.) */
  function _disposePreloadCache() {
    for (const [, el] of _bufferCache) { el.src = ''; el.load() }
    _bufferCache.clear()
    for (const [, timer] of _disposalTimers) clearTimeout(timer)
    _disposalTimers.clear()
    _urlCache.clear()
    _urlInFlight.clear()
  }

  // ── Web Audio API chain for normalization ───────────────────────────────
  let audioCtx: AudioContext | null = null
  let sourceNode: MediaElementAudioSourceNode | null = null
  let compressorNode: DynamicsCompressorNode | null = null
  let gainNode: GainNode | null = null
  let analyserNode: AnalyserNode | null = null
  const frequencyBuf = new Uint8Array(128)
  // Crossfade gain nodes — inserted in both chain modes
  let mainFadeGain: GainNode | null = null
  let nextFadeGain: GainNode | null = null
  let nextSourceNode: MediaElementAudioSourceNode | null = null

  // ── Exclusive mode (process-level flag from main process) ──────────────
  let exclusiveModeActive = false
  // Query async at init, stored for AudioContext creation
  window.api.getExclusiveStatus().then(s => { exclusiveModeActive = s.active }).catch(() => {})

  function createAudioContext(): AudioContext {
    // When exclusive mode is active, use 'playback' latency hint for higher quality
    // and avoid unnecessary processing. Otherwise use default (interactive).
    const opts: AudioContextOptions = exclusiveModeActive
      ? { latencyHint: 'playback' }
      : {}
    return new AudioContext(opts)
  }

  function initAudioChain() {
    if (audioCtx) return
    audioCtx = createAudioContext()
    mainFadeGain = audioCtx.createGain()
    mainFadeGain.gain.value = 1
    nextFadeGain = audioCtx.createGain()
    nextFadeGain.gain.value = 0
    sourceNode = audioCtx.createMediaElementSource(audio)
    nextSourceNode = audioCtx.createMediaElementSource(audioNext)
    compressorNode = audioCtx.createDynamicsCompressor()
    // Gentle normalization settings
    compressorNode.threshold.value = -24   // start compressing at -24dB
    compressorNode.knee.value = 12         // soft knee
    compressorNode.ratio.value = 4         // 4:1 compression
    compressorNode.attack.value = 0.003    // fast attack
    compressorNode.release.value = 0.25    // moderate release
    gainNode = audioCtx.createGain()
    gainNode.gain.value = 1.4              // make-up gain
    analyserNode = audioCtx.createAnalyser()
    analyserNode.fftSize = 256
    analyserNode.smoothingTimeConstant = 0.8
    // Chain: source -> mainFadeGain -> compressor -> gain -> analyser -> output
    sourceNode.connect(mainFadeGain)
    mainFadeGain.connect(compressorNode)
    compressorNode.connect(gainNode)
    gainNode.connect(analyserNode)
    analyserNode.connect(audioCtx.destination)
    // Crossfade next: nextSource -> nextFadeGain -> compressor (merges before compressor)
    nextSourceNode.connect(nextFadeGain)
    nextFadeGain.connect(compressorNode)
  }

  function initAudioBypass() {
    if (audioCtx) return
    audioCtx = createAudioContext()
    mainFadeGain = audioCtx.createGain()
    mainFadeGain.gain.value = 1
    nextFadeGain = audioCtx.createGain()
    nextFadeGain.gain.value = 0
    sourceNode = audioCtx.createMediaElementSource(audio)
    nextSourceNode = audioCtx.createMediaElementSource(audioNext)
    analyserNode = audioCtx.createAnalyser()
    analyserNode.fftSize = 256
    analyserNode.smoothingTimeConstant = 0.8
    // source -> mainFadeGain -> analyser -> output
    sourceNode.connect(mainFadeGain)
    mainFadeGain.connect(analyserNode)
    analyserNode.connect(audioCtx.destination)
    // next -> nextFadeGain -> analyser (merges at analyser)
    nextSourceNode.connect(nextFadeGain)
    nextFadeGain.connect(analyserNode)
  }
  // ── Reactive state ───────────────────────────────────────────────────────
  const currentTrack = ref<Track | null>(null)
  const queue = ref<Track[]>([])
  const originalQueue = ref<Track[]>([])
  const currentIndex = ref(-1)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(0.8)
  const isMuted = ref(false)
  const isShuffle = ref(false)
  const repeatMode = ref<'off' | 'all' | 'one'>('off')
  const isLoading = ref(false)

  // ── Audio output device ─────────────────────────────────────────────────
  const outputDeviceId = ref('')
  const audioDevices = ref<MediaDeviceInfo[]>([])

  async function enumerateOutputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      audioDevices.value = devices.filter(d => d.kind === 'audiooutput')
    } catch (err) {
      console.error('Failed to enumerate devices:', err)
    }
  }

  // ── Plugin URL resolvers ─────────────────────────────────────────────────
  // Plugins can register an async resolver to override the stream URL for a track.
  // This lets plugins re-fetch expiring URLs (e.g. YouTube CDN) on demand.
  const _urlResolvers = new Map<string, (track: Track) => Promise<string | null>>()

  function registerUrlResolver(id: string, fn: (track: Track) => Promise<string | null>) {
    _urlResolvers.set(id, fn)
  }

  function unregisterUrlResolver(id: string) {
    _urlResolvers.delete(id)
  }

  async function resolveTrackUrl(track: Track): Promise<string> {
    for (const resolver of _urlResolvers.values()) {
      try {
        const result = await resolver(track)
        if (result) return result
      } catch { /* ignore resolver errors */ }
    }
    return track.path
  }

  async function setOutputDevice(deviceId: string) {
    try {
      if ((audio as any).setSinkId) {
        await (audio as any).setSinkId(deviceId)
        await (audioStream as any).setSinkId?.(deviceId)
        outputDeviceId.value = deviceId
        await window.api.mergeSettings({ outputDeviceId: deviceId })
      }
    } catch (err) {
      console.error('Failed to set output device:', err)
    }
  }

  // ── Lyrics offset ───────────────────────────────────────────────────────
  const lyricsOffset = ref(0) // in seconds (positive = lyrics earlier, negative = later)

  // ── Waveform data ──────────────────────────────────────────────────────
  const waveformData = ref<number[]>([])
  const waveformEnabled = ref(true)
  const waveformCache = new Map<string, number[]>()

  // ── Animated covers ────────────────────────────────────────────────────
  const animatedCoversEnabled = ref(true)
  const pauseAnimatedOnBlur = ref(false)

  async function generateWaveform(trackPath: string) {
    if (waveformCache.has(trackPath)) {
      waveformData.value = waveformCache.get(trackPath)!
      return
    }
    waveformData.value = []
    try {
      const result = await window.api.generateWaveform(trackPath)
      if (result && result.length > 0) {
        waveformCache.set(trackPath, result)
        waveformData.value = result
      }
    } catch (err) {
      console.error('Waveform generation error:', err)
      waveformData.value = []
    }
  }

  async function generateSubsonicWaveform(songId: string) {
    const cacheKey = `subsonic-${songId}`
    if (waveformCache.has(cacheKey)) {
      waveformData.value = waveformCache.get(cacheKey)!
      return
    }
    waveformData.value = []
    try {
      const result = await window.api.generateWaveformSubsonic(songId)
      if (result && result.length > 0) {
        waveformCache.set(cacheKey, result)
        waveformData.value = result
      }
    } catch (err) {
      console.error('Subsonic waveform generation error:', err)
      waveformData.value = []
    }
  }

  // ── Adaptive accent ────────────────────────────────────────────────────
  const adaptiveAccent = ref(true)
  const currentAccentColor = ref<string | null>(null)

  // ── iOS-style sliders ──────────────────────────────────────────────────
  const iosSliders = ref(true)

  // ── Tray icon ──────────────────────────────────────────────────────
  const trayEnabled = ref(true) // default on

  // ── Transparency ───────────────────────────────────────────────────
  const transparencyEnabled = ref(true) // default on

  // ── Auto-fullscreen on idle ─────────────────────────────────────────
  const autoFullscreen = ref(false)
  const autoFullscreenDelay = ref(30) // seconds

  // ── Audio normalization ───────────────────────────────────────────────
  const normalization = ref(false)

  // ── Crossfade ────────────────────────────────────────────────────────────
  const crossfadeEnabled = ref(false)
  const crossfadeDuration = ref(1.5) // seconds
  let isCrossfading = false
  let cfNextTrack: Track | null = null
  let cfNextIndex = -1

  // ── Hand-made transitions ────────────────────────────────────────────────
  // See src/utils/transitions/engine.ts. The engine is created lazily once the
  // audio graph exists; everything below just tells it when to act.
  const transitionsEnabled = ref(true)
  let txEngine: TransitionEngine | null = null
  /** Transitions that failed or were skipped during the current track's play-through */
  const txSkip = new Set<string>()
  let txUiTimer: ReturnType<typeof setInterval> | null = null

  /** When the editor's Match tempo switches to "meet in the middle" (see autoStretchMode) */
  const autoMeet = ref<AutoMeet>('above')
  /** Threshold for autoMeet 'above': the incoming song's own speed change, in percent */
  const autoMeetPercent = ref(6)

  // ── Mix mode ─────────────────────────────────────────────────────────────
  // Walks the graph of saved transitions: each time a song starts, the next one
  // is chosen from the transitions out of it (see utils/transitions/mix.ts).
  const mixMode = ref(false)
  /** Queue entries (track ids) that Mix mode put there */
  const mixPicks = ref(new Set<string>())
  /** songKeys of recently started tracks, oldest first */
  const mixHistory: string[] = []
  let mixPickPending = false

  // ── LRC sync mode (pause at end of track instead of advancing) ────────
  const lrcSyncMode = ref(false)

  // ── Sleep timer ─────────────────────────────────────────────────────────
  const sleepTimerMode = ref<null | 'song' | 'album' | 'time'>(null)
  const sleepTimerEndTime = ref<number | null>(null) // ms timestamp for 'time' mode
  const sleepTimerRemaining = ref(0) // seconds remaining (updated by interval)
  let sleepTimerInterval: ReturnType<typeof setInterval> | null = null

  function startSleepTimer(mode: 'song' | 'album' | 'time', minutes?: number) {
    cancelSleepTimer()
    sleepTimerMode.value = mode
    if (mode === 'time' && minutes && minutes > 0) {
      sleepTimerEndTime.value = Date.now() + minutes * 60 * 1000
      sleepTimerRemaining.value = minutes * 60
      sleepTimerInterval = setInterval(() => {
        if (!sleepTimerEndTime.value) { cancelSleepTimer(); return }
        const left = Math.max(0, Math.round((sleepTimerEndTime.value - Date.now()) / 1000))
        sleepTimerRemaining.value = left
        if (left <= 0) {
          pause()
          cancelSleepTimer()
        }
      }, 1000)
    }
  }

  function cancelSleepTimer() {
    sleepTimerMode.value = null
    sleepTimerEndTime.value = null
    sleepTimerRemaining.value = 0
    if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null }
  }

  // ── Scrobbling ──────────────────────────────────────────────────────────
  let scrobblingEnabled = false
  let scrobbleTimer: ReturnType<typeof setTimeout> | null = null
  let scrobbleReported = false

  // ── Stats tracking ───────────────────────────────────────────────────────
  let statsReported = false

  // ── Computed ─────────────────────────────────────────────────────────────
  const progress = computed(() => {
    if (duration.value === 0) return 0
    return (currentTime.value / duration.value) * 100
  })

  const hasNext = computed(() => {
    if (repeatMode.value !== 'off') return true
    return currentIndex.value < queue.value.length - 1
  })

  const hasPrevious = computed(() => {
    if (repeatMode.value !== 'off') return true
    return currentIndex.value > 0
  })

  // ── Audio event listeners ────────────────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    if (txEngine?.ownsElement) return
    // FROM's buffer may be changing speed while the muted element doesn't: show what's heard
    currentTime.value = txEngine?.active ? txEngine.fromPosition() : audio.currentTime
    // Scrobble after listening to 50% or 4 minutes, whichever is first
    if (scrobblingEnabled && !scrobbleReported && currentTrack.value && duration.value > 30) {
      const threshold = Math.min(duration.value * 0.5, 240)
      if (audio.currentTime >= threshold) {
        scrobbleReported = true
        window.api.scrobbleTrack({
          title: currentTrack.value.title,
          artist: currentTrack.value.artist,
          album: currentTrack.value.album,
          duration: duration.value,
          timestamp: Date.now(),
        }).catch(() => {})
      }
    }
    // Record play in stats after 50% listened
    if (!statsReported && currentTrack.value && duration.value > 10) {
      if (audio.currentTime >= duration.value * 0.5) {
        statsReported = true
        getStatsStore()?.recordPlay(currentTrack.value, audio.currentTime)
      }
    }
    // Crossfade trigger (skip for external streams — live/CDN sources)
    // A prepared hand-made transition owns this track change, even before it starts
    if (crossfadeEnabled.value && !isCrossfading && !usingStream && duration.value > 0 && isPlaying.value && (!txEngine || txEngine.phase === 'idle')) {
      const timeLeft = duration.value - audio.currentTime
      if (timeLeft > 0 && timeLeft <= crossfadeDuration.value + 0.2) {
        startCrossfade()
      }
    }
    transitionTick()
  })
  audio.addEventListener('durationchange', () => {
    if (txEngine?.ownsElement) return
    duration.value = audio.duration
  })
  // While a transition runs, FROM may reach its end on the (muted) element: that's not a track end
  audio.addEventListener('ended', () => { if (!txEngine?.active) handleTrackEnd() })
  audio.addEventListener('playing', () => {
    if (txEngine?.ownsElement) return
    isPlaying.value = true
    isLoading.value = false
    pluginBus.emit('play')
  })
  audio.addEventListener('pause', () => {
    if (txEngine?.active) return
    isPlaying.value = false
    pluginBus.emit('pause')
  })
  audio.addEventListener('waiting', () => {
    if (txEngine?.ownsElement) return
    isLoading.value = true
  })
  audio.addEventListener('canplay', () => {
    if (txEngine?.ownsElement) return
    isLoading.value = false
  })

  // Track playback errors with meaningful messages and auto-skip
  const playbackError = ref<string | null>(null)
  let errorSkipTimeout: ReturnType<typeof setTimeout> | null = null

  audio.addEventListener('error', () => {
    // Ignore errors from intentional queue clearing (audio.src = '')
    if (!currentTrack.value) return
    // The transition engine handles errors while it has the element
    if (txEngine?.ownsElement) return
    isLoading.value = false
    isPlaying.value = false
    const err = audio.error
    const codes: Record<number, string> = {
      1: 'Playback aborted',
      2: 'Network error loading file',
      3: 'Codec/decode error — format may not be supported',
      4: 'Source not supported — file format not playable',
    }
    const msg = err ? (codes[err.code] || `Unknown error (code ${err.code})`) : 'Unknown playback error'
    const trackName = currentTrack.value ? `${currentTrack.value.artist} - ${currentTrack.value.title}` : 'Unknown'
    console.error(`Audio error for "${trackName}": ${msg}`)
    playbackError.value = `Cannot play "${currentTrack.value?.title || 'track'}": ${msg}`

    // Auto-skip to next track after a short delay (avoid rapid loops)
    if (errorSkipTimeout) clearTimeout(errorSkipTimeout)
    errorSkipTimeout = setTimeout(() => {
      playbackError.value = null
      if (queue.value.length > 1) next()
    }, 2000)
  })

  // ── audioStream event listeners (mirrors audio's, but reads from audioStream) ──
  audioStream.addEventListener('timeupdate', () => {
    currentTime.value = audioStream.currentTime
    if (scrobblingEnabled && !scrobbleReported && currentTrack.value && duration.value > 30) {
      const threshold = Math.min(duration.value * 0.5, 240)
      if (audioStream.currentTime >= threshold) {
        scrobbleReported = true
        window.api.scrobbleTrack({
          title: currentTrack.value.title,
          artist: currentTrack.value.artist,
          album: currentTrack.value.album,
          duration: duration.value,
          timestamp: Date.now(),
        }).catch(() => {})
      }
    }
    if (!statsReported && currentTrack.value && duration.value > 10) {
      if (audioStream.currentTime >= duration.value * 0.5) {
        statsReported = true
        getStatsStore()?.recordPlay(currentTrack.value, audioStream.currentTime)
      }
    }
    // No crossfade for streams (live/external sources)
  })
  audioStream.addEventListener('durationchange', () => { duration.value = audioStream.duration })
  audioStream.addEventListener('ended', () => handleTrackEnd())
  audioStream.addEventListener('playing', () => { isPlaying.value = true; isLoading.value = false; pluginBus.emit('play') })
  audioStream.addEventListener('pause', () => { isPlaying.value = false; pluginBus.emit('pause') })
  audioStream.addEventListener('waiting', () => { isLoading.value = true })
  audioStream.addEventListener('canplay', () => { isLoading.value = false })
  audioStream.addEventListener('error', () => {
    if (!currentTrack.value) return
    isLoading.value = false
    isPlaying.value = false
    const err = audioStream.error
    const codes: Record<number, string> = {
      1: 'Playback aborted',
      2: 'Network error loading file',
      3: 'Codec/decode error — format may not be supported',
      4: 'Source not supported — file format not playable',
    }
    const msg = err ? (codes[err.code] || `Unknown error (code ${err.code})`) : 'Unknown playback error'
    const trackName = currentTrack.value ? `${currentTrack.value.artist} - ${currentTrack.value.title}` : 'Unknown'
    console.error(`Audio error for "${trackName}": ${msg}`)
    playbackError.value = `Cannot play "${currentTrack.value?.title || 'track'}": ${msg}`
    if (errorSkipTimeout) clearTimeout(errorSkipTimeout)
    errorSkipTimeout = setTimeout(() => {
      playbackError.value = null
      if (queue.value.length > 1) next()
    }, 2000)
  })

  // ── Watchers ─────────────────────────────────────────────────────────────
  // Apply a quadratic curve so the slider feels more natural
  // (perceived loudness is logarithmic; linear volume is way too loud at the top)
  audio.volume = volume.value * volume.value
  audioStream.volume = volume.value * volume.value

  watch(volume, (val) => {
    audio.volume = val * val
    audioStream.volume = val * val
    if (isCrossfading) audioNext.volume = val * val
    txEngine?.setVolume(isMuted.value ? 0 : val * val)
    if (val > 0 && isMuted.value) isMuted.value = false
    // Persist volume
    window.api.mergeSettings({ volume: val })
  })

  watch(isMuted, (val) => {
    audio.muted = val
    audioStream.muted = val
    if (isCrossfading) audioNext.muted = val
    txEngine?.setVolume(val ? 0 : volume.value * volume.value)
  })

  // ── Restore persisted playback settings ────────────────────────────────────
  window.api.getSettings().then((s: any) => {
    if (s.volume !== undefined) {
      volume.value = s.volume
      audio.volume = s.volume * s.volume
      audioStream.volume = s.volume * s.volume
    }
    if (s.shuffle === true) isShuffle.value = true
    if (s.repeatMode && ['off', 'all', 'one'].includes(s.repeatMode)) repeatMode.value = s.repeatMode
    if (s.muted === true) { isMuted.value = true; audio.muted = true; audioStream.muted = true }
    if (s.lyricsOffset !== undefined) lyricsOffset.value = s.lyricsOffset
    if (typeof s.waveformEnabled === 'boolean') waveformEnabled.value = s.waveformEnabled
    if (typeof s.animatedCoversEnabled === 'boolean') animatedCoversEnabled.value = s.animatedCoversEnabled
    if (typeof s.pauseAnimatedOnBlur === 'boolean') pauseAnimatedOnBlur.value = s.pauseAnimatedOnBlur
    if (typeof s.adaptiveAccent === 'boolean') adaptiveAccent.value = s.adaptiveAccent
    if (typeof s.iosSliders === 'boolean') iosSliders.value = s.iosSliders
    if (s.trayEnabled === false) trayEnabled.value = false
    if (s.transparencyEnabled === false) transparencyEnabled.value = false
    if (s.autoFullscreen === true) autoFullscreen.value = true
    if (s.autoFullscreenDelay !== undefined) autoFullscreenDelay.value = s.autoFullscreenDelay
    if (s.normalization === true) {
      normalization.value = true
      initAudioChain()
    } else {
      initAudioBypass()
    }
    if (s.outputDeviceId) {
      setOutputDevice(s.outputDeviceId).catch(() => {})
    }
    scrobblingEnabled = s.scrobblingEnabled === true
    if (typeof s.crossfadeEnabled === 'boolean') crossfadeEnabled.value = s.crossfadeEnabled
    if (s.crossfadeDuration !== undefined) crossfadeDuration.value = s.crossfadeDuration
    if (s.transitionsEnabled === false) transitionsEnabled.value = false
    if (s.mixMode === true) mixMode.value = true
    if (s.autoMeet === 'never' || s.autoMeet === 'above' || s.autoMeet === 'always') autoMeet.value = s.autoMeet
    if (typeof s.autoMeetPercent === 'number' && isFinite(s.autoMeetPercent)) autoMeetPercent.value = s.autoMeetPercent
  })

  // ── Controls lock (the transition editor owns playback) ─────────────────
  /** While set, the player bar is disabled and play/pause from media keys, MPRIS or
   *  remotes goes to this handler instead; other transport commands are ignored. */
  const lockedToggle = shallowRef<(() => void) | null>(null)
  const controlsLocked = computed(() => !!lockedToggle.value)
  function setControlsLock(onToggle: (() => void) | null) {
    lockedToggle.value = onToggle
    if (onToggle && isPlaying.value) pause()
  }
  /** Run `fn` unless the controls are locked; play/pause commands toggle the locker instead */
  function unlessLocked(fn: () => void, isToggle = false) {
    if (!lockedToggle.value) return fn()
    if (isToggle) lockedToggle.value()
  }

  // ── MediaSession action handlers (MPRIS integration) ─────────────────────
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => unlessLocked(() => play(), true))
    navigator.mediaSession.setActionHandler('pause', () => unlessLocked(() => pause(), true))
    navigator.mediaSession.setActionHandler('previoustrack', () => unlessLocked(() => previous()))
    navigator.mediaSession.setActionHandler('nexttrack', () => unlessLocked(() => next()))
    navigator.mediaSession.setActionHandler('stop', () => unlessLocked(() => { pause(); activeAudio().currentTime = 0 }))
    navigator.mediaSession.setActionHandler('seekto', (details) => unlessLocked(() => {
      if (details.seekTime != null) seek(details.seekTime)
    }))
    // currentTime (not the element's) so these stay right while a transition owns the element
    navigator.mediaSession.setActionHandler('seekbackward', (details) => unlessLocked(() => {
      seek(Math.max(0, currentTime.value - (details.seekOffset || 10)))
    }))
    navigator.mediaSession.setActionHandler('seekforward', (details) => unlessLocked(() => {
      seek(Math.min(duration.value, currentTime.value + (details.seekOffset || 10)))
    }))
  }

  // Keep MediaSession playback state in sync
  watch(isPlaying, (playing) => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    }
    // MPRIS playback status
    window.api.mprisSendPlaybackStatus(playing ? 'Playing' : 'Paused')
  })

  // Update MediaSession position state periodically
  function updatePositionState() {
    if ('mediaSession' in navigator && duration.value > 0 && isFinite(duration.value)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration.value,
          playbackRate: activeAudio().playbackRate,
          position: Math.min(currentTime.value, duration.value),
        })
      } catch { /* ignore invalid state errors */ }
    }
    // MPRIS position (send every timeupdate, the MPRIS module just stores the value)
    window.api.mprisSendPosition(currentTime.value)
  }
  // Update position when time or duration changes (both elements)
  audio.addEventListener('timeupdate', updatePositionState)
  audio.addEventListener('durationchange', updatePositionState)
  audioStream.addEventListener('timeupdate', updatePositionState)
  audioStream.addEventListener('durationchange', updatePositionState)

  // Send volume changes to MPRIS
  watch(volume, (val) => {
    window.api.mprisSendVolume(val)
  })

  // Send repeat/shuffle changes to MPRIS
  watch(repeatMode, (mode) => {
    window.api.mprisSendLoopStatus(mode)
  })
  watch(isShuffle, (val) => {
    window.api.mprisSendShuffle(val)
  })

  // Listen for MPRIS commands from the main process
  window.api.onMprisCommand((command: string, data?: any) => {
    const transport = ['play', 'pause', 'playPause', 'togglePlay', 'next', 'previous', 'stop', 'seek', 'seekAbsolute', 'playFromQueue']
    if (lockedToggle.value && transport.includes(command)) {
      if (command === 'play' || command === 'pause' || command === 'playPause' || command === 'togglePlay') lockedToggle.value()
      return
    }
    switch (command) {
      case 'play': play(); break
      case 'pause': pause(); break
      case 'playPause': togglePlay(); break
      case 'next': next(); break
      case 'previous': previous(); break
      case 'stop': pause(); activeAudio().currentTime = 0; break
      case 'seek': seek(Math.max(0, currentTime.value + (data || 0))); window.api.mprisSendSeeked(currentTime.value); break
      case 'seekAbsolute': seek(data || 0); window.api.mprisSendSeeked(data || 0); break
      case 'volume': setVolume(data || 0); break
      case 'loop': {
        const map: Record<string, 'off' | 'all' | 'one'> = { None: 'off', Playlist: 'all', Track: 'one' }
        if (map[data]) repeatMode.value = map[data]
        break
      }
      case 'shuffle': isShuffle.value = !!data; break
    }
  })

  // Enumerate audio devices on init
  enumerateOutputDevices()
  navigator.mediaDevices?.addEventListener('devicechange', enumerateOutputDevices)

  // Persist shuffle / repeat / mute when they change
  watch(isShuffle, (val) => {
    window.api.mergeSettings({ shuffle: val })
  })
  watch(repeatMode, (val) => {
    window.api.mergeSettings({ repeatMode: val })
  })
  watch(isMuted, (val) => {
    window.api.mergeSettings({ muted: val })
  })

  // ── Discord Rich Presence sync ───────────────────────────────────────────
  let discordFormat = 'title-artist'
  let discordEnabled = true

  // Load settings once
  window.api.getSettings().then((s: any) => {
    if (s.discordRPCFormat) discordFormat = s.discordRPCFormat
    if (s.discordRPC === false) discordEnabled = false
  })

  function sendDiscordUpdate() {
    if (!discordEnabled) return
    const track = currentTrack.value
    if (!track || !isPlaying.value) {
      window.api.updateDiscordPresence(null)
      return
    }
    window.api.updateDiscordPresence({
      title: track.title,
      artist: track.artist,
      album: track.album,
      isPlaying: isPlaying.value,
      duration: duration.value,
      elapsed: currentTime.value,
      format: discordFormat,
    })
  }

  function setDiscordFormat(fmt: string) {
    discordFormat = fmt
    sendDiscordUpdate()
  }

  function setDiscordEnabled(enabled: boolean) {
    discordEnabled = enabled
    if (!enabled) {
      window.api.updateDiscordPresence(null)
    } else {
      sendDiscordUpdate()
    }
  }

  // Update Discord on track change and play/pause
  watch(currentTrack, () => {
    // Small delay to let isPlaying settle
    setTimeout(sendDiscordUpdate, 500)
  })

  watch(isPlaying, () => {
    sendDiscordUpdate()
  })

  // ── Internal helpers ─────────────────────────────────────────────────────
  async function loadTrack(track: Track) {
    cancelCrossfade()
    abortTransition()
    currentTrack.value = track
    duration.value = track.duration || 0
    isLoading.value = true

    // Notify plugins of track change
    pluginBus.emit('trackChange', { ...track })

    // Resolve audio source
    if (track.source === 'subsonic' && track.path.startsWith('subsonic://')) {
      // Clear stream element when switching back to a local/subsonic track
      if (usingStream) { audioStream.pause(); audioStream.src = '' }
      usingStream = false
      // Try the URL cache first (instant), fall back to live IPC resolve
      const cachedUrl = _getCachedUrl(track.id)
      if (cachedUrl) {
        audio.src = cachedUrl
      } else {
        const songId = track.path.replace('subsonic://', '')
        const url = await window.api.subsonicGetStreamUrl(songId)
        _urlCache.set(track.id, url)   // populate cache for future use
        audio.src = url
      }
      // Wait for remote stream to become playable before returning
      await new Promise<void>((resolve) => {
        audio.addEventListener('canplay', () => resolve(), { once: true })
        audio.addEventListener('error', () => resolve(), { once: true })
        audio.load()
      })
    } else {
      const isExternal = track.path.startsWith('http://') || track.path.startsWith('https://')
      // Always run plugin URL resolvers — plugins may return a stream URL for
      // non-HTTP paths (e.g. test://, yt://) that need remote resolution.
      const resolvedPath = await resolveTrackUrl(track)
      const resolvedIsStream = resolvedPath.startsWith('http://') || resolvedPath.startsWith('https://') || resolvedPath.startsWith('blob:')
      const resolvedIsLocal  = resolvedPath.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(resolvedPath)
      if (isExternal || resolvedIsStream) {
        // Route through audioStream (NOT connected to AudioContext) so CORS
        // restrictions on external CDNs don't silence playback.
        if (!usingStream) { audio.pause(); audio.src = '' }
        usingStream = true
        audioStream.src = window.api.getMediaUrl(resolvedPath)
        audioStream.load()
      } else if (resolvedIsLocal) {
        // Local file — use the main audio element connected to AudioContext
        if (usingStream) { audioStream.pause(); audioStream.src = '' }
        usingStream = false
        audio.src = window.api.getMediaUrl(resolvedPath)
        audio.load()
      } else {
        // Custom scheme (e.g. test://) that no resolver handled — abort cleanly
        console.warn('[Player] No resolver handled path:', resolvedPath)
        isLoading.value = false
        return
      }
    }

    announceTrack(track)
  }

  /** Everything that follows a track becoming current: preload, scrobble/stats reset, waveform, OS metadata */
  function announceTrack(track: Track) {
    scheduleMixPick()
    // Update preload caches (resolve remaining URLs + shift buffer window)
    _preloadAdjacent()

    // Reset scrobble + stats tracking for new track
    scrobbleReported = false
    statsReported = false
    if (scrobbleTimer) { clearTimeout(scrobbleTimer); scrobbleTimer = null }

    // Generate waveform if enabled (skip for remote/stream URLs — infinite or unavailable)
    if (waveformEnabled.value) {
      if (track.source === 'subsonic' && track.path.startsWith('subsonic://')) {
        const songId = track.path.replace('subsonic://', '')
        generateSubsonicWaveform(songId)
      } else if (track.path.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(track.path)) {
        // Only attempt waveform generation for real local file paths
        generateWaveform(track.path)
      } else {
        waveformData.value = []
      }
    }

    // Scrobble: update now playing
    if (scrobblingEnabled) {
      window.api.updateNowPlaying({
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
      }).catch(() => {})
    }

    // MediaSession metadata (for system integration)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.coverArt
          ? [{ src: window.api.getMediaUrl(track.coverArt), sizes: '512x512', type: 'image/jpeg' }]
          : [],
      })
    }

    // MPRIS metadata (custom D-Bus service for Linux)
    if (track.coverArt) {
      if (track.source === 'subsonic') {
        // Subsonic cover art is already an HTTP URL
        window.api.mprisSendMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
          artUrl: track.coverArt,
          length: track.duration || 0,
          trackId: `/org/mpris/MediaPlayer2/Track/${track.id?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown'}`,
        })
      } else {
        window.api.getCoverFileUrl(track.coverArt).then((artUrl: string) => {
          window.api.mprisSendMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album,
            artUrl,
            length: track.duration || 0,
            trackId: `/org/mpris/MediaPlayer2/Track/${track.id?.replace(/[^a-zA-Z0-9]/g, '_') || 'unknown'}`,
          })
        }).catch(() => {
          window.api.mprisSendMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album,
            length: track.duration || 0,
          })
        })
      }
    } else {
      window.api.mprisSendMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        length: track.duration || 0,
      })
    }
  }

  function handleTrackEnd() {
    // If a crossfade is already in progress, finalize it (swap audioNext → audio)
    if (isCrossfading) {
      finalizeCrossfade()
      return
    }
    // LRC sync mode: pause at end so user can save their work
    if (lrcSyncMode.value) {
      activeAudio().currentTime = 0
      pause()
      return
    }

    // Sleep timer: "after this song" — pause immediately
    if (sleepTimerMode.value === 'song') {
      cancelSleepTimer()
      return // don't advance, just stop
    }

    // Sleep timer: "after this album" — pause if next track is a different album
    if (sleepTimerMode.value === 'album') {
      const currentAlbum = currentTrack.value?.album
      const nextIdx = currentIndex.value + 1
      const nextTrack = nextIdx < queue.value.length ? queue.value[nextIdx] : null
      if (!nextTrack || nextTrack.album !== currentAlbum) {
        cancelSleepTimer()
        return // album finished, stop
      }
    }

    if (repeatMode.value === 'one') {
      scrobbleReported = false
      statsReported = false
      if (scrobbleTimer) { clearTimeout(scrobbleTimer); scrobbleTimer = null }
      activeAudio().currentTime = 0
      activeAudio().play()
    } else {
      next()
    }
  }

  function cancelCrossfade() {
    if (!isCrossfading) return
    isCrossfading = false
    cfNextTrack = null
    cfNextIndex = -1
    audioNext.pause()
    audioNext.src = ''
    if (audioCtx && mainFadeGain && nextFadeGain) {
      const now = audioCtx.currentTime
      mainFadeGain.gain.cancelScheduledValues(now)
      nextFadeGain.gain.cancelScheduledValues(now)
      mainFadeGain.gain.setValueAtTime(1, now)
      nextFadeGain.gain.setValueAtTime(0, now)
    }
  }

  async function startCrossfade() {
    if (isCrossfading) return
    let nextIdx = currentIndex.value + 1
    if (nextIdx >= queue.value.length) {
      if (repeatMode.value === 'all') nextIdx = 0
      else return
    }
    if (repeatMode.value === 'one') return // repeat-one doesn't crossfade
    const nextTrack = queue.value[nextIdx]
    // Skip crossfade for external stream tracks (would be silenced by AudioContext CORS check)
    const nextIsExternal = nextTrack.path.startsWith('http://') || nextTrack.path.startsWith('https://')
    if (nextIsExternal && nextTrack.source !== 'subsonic') return
    isCrossfading = true
    cfNextTrack = nextTrack
    cfNextIndex = nextIdx
    try {
      if (nextTrack.source === 'subsonic' && nextTrack.path.startsWith('subsonic://')) {
        const cachedUrl = _getCachedUrl(nextTrack.id)
        if (cachedUrl) {
          audioNext.src = cachedUrl
        } else {
          const songId = nextTrack.path.replace('subsonic://', '')
          const url = await window.api.subsonicGetStreamUrl(songId)
          _urlCache.set(nextTrack.id, url)
          audioNext.src = url
        }
      } else {
        audioNext.src = window.api.getMediaUrl(nextTrack.path)
      }
      audioNext.volume = audio.volume
      audioNext.muted = audio.muted
      audioNext.load()
      await new Promise<void>(resolve => {
        audioNext.addEventListener('canplay', () => resolve(), { once: true })
        audioNext.addEventListener('error', () => { isCrossfading = false; resolve() }, { once: true })
        setTimeout(resolve, 3000) // timeout fallback
      })
      if (!isCrossfading) return
      await audioNext.play().catch(() => { isCrossfading = false })
      if (!isCrossfading) return
      if (audioCtx && mainFadeGain && nextFadeGain) {
        const now = audioCtx.currentTime
        const dur = crossfadeDuration.value
        mainFadeGain.gain.cancelScheduledValues(now)
        mainFadeGain.gain.setValueAtTime(mainFadeGain.gain.value, now)
        mainFadeGain.gain.linearRampToValueAtTime(0, now + dur)
        nextFadeGain.gain.cancelScheduledValues(now)
        nextFadeGain.gain.setValueAtTime(0, now)
        nextFadeGain.gain.linearRampToValueAtTime(1, now + dur)
      }
    } catch {
      isCrossfading = false
      cfNextTrack = null
      cfNextIndex = -1
    }
  }

  async function finalizeCrossfade() {
    if (!cfNextTrack) return
    const nextTrack = cfNextTrack
    const nextIdx = cfNextIndex
    const savedSrc = audioNext.src
    const savedPos = audioNext.currentTime
    // Keep next audible, silence main while we reload it
    if (audioCtx && mainFadeGain && nextFadeGain) {
      const now = audioCtx.currentTime
      mainFadeGain.gain.cancelScheduledValues(now)
      nextFadeGain.gain.cancelScheduledValues(now)
      mainFadeGain.gain.setValueAtTime(0, now)
      nextFadeGain.gain.setValueAtTime(1, now)
    }
    // Update reactive state
    currentIndex.value = nextIdx
    currentTrack.value = nextTrack
    duration.value = audioNext.duration || nextTrack.duration || 0
    scrobbleReported = false
    statsReported = false
    if (scrobbleTimer) { clearTimeout(scrobbleTimer); scrobbleTimer = null }
    // Load next track into main audio element (audioNext covers audio during this gap)
    audio.src = savedSrc
    audio.load()
    await new Promise<void>(resolve => {
      audio.addEventListener('canplay', () => resolve(), { once: true })
      audio.addEventListener('error', () => resolve(), { once: true })
      setTimeout(resolve, 2000)
    })
    audio.currentTime = Math.min(savedPos, audio.duration || Infinity)
    await audio.play().catch(() => {})
    // Switch gains: bring main back up, silence next
    if (audioCtx && mainFadeGain && nextFadeGain) {
      const now = audioCtx.currentTime
      mainFadeGain.gain.setValueAtTime(1, now)
      nextFadeGain.gain.setValueAtTime(0, now)
    }
    audioNext.pause()
    audioNext.src = ''
    isCrossfading = false
    cfNextTrack = null
    cfNextIndex = -1
    // Update remaining metadata / preload
    pluginBus.emit('trackChange', { ...nextTrack })
    scheduleMixPick()
    _preloadAdjacent()
    if (waveformEnabled.value) {
      if (nextTrack.source === 'subsonic' && nextTrack.path.startsWith('subsonic://')) {
        generateSubsonicWaveform(nextTrack.path.replace('subsonic://', ''))
      } else if (!nextTrack.path.startsWith('http://') && !nextTrack.path.startsWith('https://')) {
        generateWaveform(nextTrack.path)
      } else {
        waveformData.value = []
      }
    }
    if (scrobblingEnabled) {
      window.api.updateNowPlaying({ title: nextTrack.title, artist: nextTrack.artist, album: nextTrack.album, duration: nextTrack.duration }).catch(() => {})
    }
  }

  // ── Hand-made transitions: player glue ─────────────────────────────────
  function isLocalTrack(t: Track): boolean {
    return t.source !== 'subsonic' && (t.path.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(t.path))
  }

  /** Queue index that plays after the current track, or -1 */
  function upcomingIndex(): number {
    const idx = currentIndex.value + 1
    if (idx < queue.value.length) return idx
    return repeatMode.value === 'all' && queue.value.length > 0 ? 0 : -1
  }

  /** The track a transition may lead into, or null when the next track change isn't a plain "advance" */
  function upcomingTrack(): Track | null {
    if (repeatMode.value === 'one' || lrcSyncMode.value || sleepTimerMode.value === 'song') return null
    const idx = upcomingIndex()
    if (idx < 0) return null
    const next = queue.value[idx]
    if (sleepTimerMode.value === 'album' && next.album !== currentTrack.value?.album) return null
    return next
  }

  function getTxEngine(): TransitionEngine | null {
    if (txEngine) return txEngine
    const bus = compressorNode ?? analyserNode
    if (!audioCtx || !sourceNode || !mainFadeGain || !bus) return null
    txEngine = new TransitionEngine({
      ctx: audioCtx,
      bus,
      element: audio,
      elementSource: sourceNode,
      elementGain: mainFadeGain,
      mediaUrl: (path) => window.api.getMediaUrl(path),
      onCommit: (to, info) => commitTransitionState(to, info.duration),
      onSettled: () => {
        stopTxUiTimer()
        duration.value = audio.duration || duration.value
        currentTime.value = audio.currentTime
        isLoading.value = false
        isPlaying.value = !audio.paused
      },
      onHandbackFailed: async (to, position) => {
        stopTxUiTimer()
        console.warn('[Transitions] Handback failed, loading TO normally')
        restoreElementGainSoon()
        await loadTrack(to)
        audio.currentTime = position
        play()
      },
    })
    txEngine.setVolume(isMuted.value ? 0 : volume.value * volume.value)
    return txEngine
  }

  /** Called on every timeupdate of the main element: prepares and arms the transition into the next track. */
  function transitionTick() {
    if (!transitionsEnabled.value || usingStream || isCrossfading || !isPlaying.value) return
    const eng = getTxEngine()
    if (!eng || eng.active || eng.phase === 'preparing') return
    const from = currentTrack.value
    const to = upcomingTrack()
    const t = from && to && isLocalTrack(from) && isLocalTrack(to) ? useTransitionsStore().find(from, to) : null
    if (!from || !to || !t || t.needsReview || txSkip.has(t.id)) {
      if (eng.phase === 'ready') eng.release()
      return
    }
    if (eng.phase === 'ready' && !eng.isFor(t, from, to)) eng.release()

    const untilExit = t.exitAt - audio.currentTime
    const lead = leadInFor(t)
    // Too close (or past it, e.g. after a seek): skip, but stay eligible if the user seeks back
    if (untilExit < lead + 0.6) {
      if (eng.phase === 'ready') eng.release()
      return
    }
    if (eng.phase === 'idle' && untilExit <= prepWindowFor(t)) {
      eng.prepare(t, from, to).then(r => handlePrepareResult(t, from, to, r))
    } else if (eng.phase === 'ready' && untilExit <= lead + MEASURE_LEAD) {
      eng.arm().catch(err => {
        console.error('[Transitions] arm failed:', err)
        txSkip.add(t.id)
        eng.release()
      })
    }
  }

  function handlePrepareResult(t: Transition, from: Track, to: Track, r: PrepareResult) {
    if (r.ok) return
    if (r.reason === 'error') {
      if (r.error !== 'superseded') {
        console.warn('[Transitions] Could not prepare transition:', r.error)
        txSkip.add(t.id)
      }
      return
    }
    // A file's length changed. Flag for review only if it's the same file (or the original is gone):
    // another song with the same artist/title (e.g. a live version) just doesn't get this transition.
    txSkip.add(t.id)
    const endpoint = r.side === 'from' ? t.from : t.to
    const track = r.side === 'from' ? from : to
    const originalStillThere = getLibStore()?.tracks?.some((x: Track) => x.path === endpoint.path)
    if (track.path === endpoint.path || !originalStillThere) {
      console.warn(`[Transitions] ${r.side.toUpperCase()} duration changed (${endpoint.duration.toFixed(2)}s → ${r.decoded.toFixed(2)}s): needs review`)
      useTransitionsStore().setNeedsReview(t.id, true).catch(() => {})
    }
  }

  /** TO has become the dominant side: make it the current track, as a normal track change would. */
  function commitTransitionState(to: Track, decodedDuration: number) {
    let idx = upcomingIndex()
    if (idx < 0 || queue.value[idx]?.id !== to.id) idx = queue.value.findIndex(t => t.id === to.id)
    if (idx < 0) {
      // Removed from the queue mid-transition: it's playing, so put it back right after the current track
      idx = currentIndex.value + 1
      queue.value.splice(idx, 0, to)
    }
    txSkip.clear()
    currentIndex.value = idx
    currentTrack.value = to
    duration.value = decodedDuration || to.duration || 0
    currentTime.value = txEngine?.toPosition() ?? 0
    pluginBus.emit('trackChange', { ...to })
    announceTrack(to)
    startTxUiTimer()
  }

  // While the engine plays TO from a buffer, drive the progress bar from its clock
  function startTxUiTimer() {
    stopTxUiTimer()
    txUiTimer = setInterval(() => {
      if (!txEngine?.ownsElement) { stopTxUiTimer(); return }
      currentTime.value = txEngine.toPosition()
    }, 250)
  }

  function stopTxUiTimer() {
    if (txUiTimer) { clearInterval(txUiTimer); txUiTimer = null }
  }

  /** Bring the element's gain back once whatever replaces the transition has started (or soon anyway). */
  function restoreElementGainSoon() {
    const eng = txEngine
    if (!eng) return
    let done = false
    const restore = () => {
      if (done) return
      done = true
      for (const ev of ['loadstart', 'playing', 'seeked']) audio.removeEventListener(ev, restore)
      eng.restoreElementGain()
    }
    for (const ev of ['loadstart', 'playing', 'seeked']) audio.addEventListener(ev, restore, { once: true })
    setTimeout(restore, 1500)
  }

  /** Hard stop before a normal track load. Safe to call when nothing is happening. */
  function abortTransition() {
    txSkip.clear()
    if (!txEngine) return
    stopTxUiTimer()
    const stopped = txEngine.stop()
    // Also covers a transition that already gave up (e.g. a failed handback) with the element muted
    if (stopped || (!isCrossfading && mainFadeGain && mainFadeGain.gain.value < 0.999)) restoreElementGainSoon()
  }

  /**
   * Stop the transition and leave TO on the element at `pos` (default: where it is now),
   * playing or paused. Used when TO dominates and the user pauses, seeks, etc.
   */
  function parkOnTo(playAfter: boolean, pos?: number) {
    const info = txEngine?.stop()
    stopTxUiTimer()
    if (!info) return
    if (!info.committed) commitTransitionState(info.toTrack, info.toTrack.duration)
    stopTxUiTimer()
    const target = Math.max(0, pos ?? info.toPos)
    if (!playAfter) audio.pause()
    if (!info.elementHasTo) {
      audio.src = window.api.getMediaUrl(info.toTrack.path)
      // Loading a new src drops the 'pause' event queued just above
      if (!playAfter) { isPlaying.value = false; pluginBus.emit('pause') }
    }
    audio.currentTime = target
    currentTime.value = target
    if (playAfter) audio.play().catch(() => {})
    restoreElementGainSoon()
  }

  /** After a queue edit: keep an audible transition's target next in line, or back out if it was removed. */
  function txQueueChanged() {
    const eng = txEngine
    if (!eng || eng.phase === 'idle' || eng.committed) return
    const to = eng.toTrack
    if (eng.phase !== 'running') {
      if (upcomingTrack()?.id !== to?.id) eng.release()
      return
    }
    if (!to) return
    if (queue.value[upcomingIndex()]?.id === to.id) return
    const idx = queue.value.findIndex(t => t.id === to.id)
    if (idx < 0) {
      if (!eng.collapseToFrom()) parkOnTo(true)
      return
    }
    const [item] = queue.value.splice(idx, 1)
    if (idx < currentIndex.value) currentIndex.value--
    queue.value.splice(currentIndex.value + 1, 0, item)
  }

  function setTransitionsEnabled(enabled: boolean) {
    transitionsEnabled.value = enabled
    window.api.mergeSettings({ transitionsEnabled: enabled })
    if (!enabled && txEngine && !txEngine.committed) txEngine.collapseToFrom()
  }

  /** Editor preview through the transition engine; pauses normal playback first. */
  function previewTransition(buffers: { from: AudioBuffer; to: AudioBuffer }, t: TransitionTiming, opts: PreviewOptions): PreviewHandle | null {
    if (isPlaying.value) pause()
    const eng = getTxEngine()
    return eng ? eng.preview(buffers, t, opts) : null
  }

  function stopTransitionPreview() {
    txEngine?.stopPreview()
  }

  function isTransitionPreviewing(): boolean {
    return txEngine?.previewing ?? false
  }

  function getAudioContext(): AudioContext | null {
    return audioCtx
  }

  /** Play FROM a little before its exit point with TO queued next, so a saved transition runs for real. */
  async function auditionTransition(from: Track, to: Track, startAt: number) {
    await play(from)
    if (queue.value[currentIndex.value + 1]?.id !== to.id) playNext(to)
    seek(Math.max(0, startAt))
  }

  // ── Mix mode ─────────────────────────────────────────────────────────────
  /** A library track for a transition endpoint: same file if it's still there, else same song */
  function resolveEndpointTrack(ep: { key: string; path: string }): Track | null {
    const tracks: Track[] = getLibStore()?.tracks ?? []
    return tracks.find(t => t.path === ep.path) ?? tracks.find(t => songKey(t) === ep.key) ?? null
  }

  function scheduleMixPick() {
    if (mixPickPending) return
    mixPickPending = true
    // After the caller has finished updating queue state
    queueMicrotask(() => { mixPickPending = false; mixPick() })
  }

  function mixPick() {
    const cur = currentTrack.value
    if (!cur) return
    const key = songKey(cur)
    if (mixHistory[mixHistory.length - 1] !== key) {
      mixHistory.push(key)
      if (mixHistory.length > 50) mixHistory.shift()
    }
    if (!mixMode.value || repeatMode.value === 'one' || !isLocalTrack(cur)) return
    const store = useTransitionsStore()
    const nextIdx = upcomingIndex()
    const next = nextIdx >= 0 ? queue.value[nextIdx] : null
    // Already heading somewhere through a hand-made transition: keep it
    const existing = next ? store.find(cur, next) : null
    if (existing && !existing.needsReview) return

    const candidates: MixCandidate[] = []
    for (const t of store.outgoing(cur)) {
      const track = resolveEndpointTrack(t.to)
      if (track && isLocalTrack(track) && track.id !== cur.id) candidates.push({ transition: t, track, key: t.to.key })
    }
    const pick = pickNextMix({
      candidates,
      recentKeys: mixHistory,
      contextKeys: new Set(originalQueue.value.map(songKey)),
    })
    if (!pick) return

    // Pull it forward if it's already queued later on, otherwise insert it
    const later = queue.value.findIndex((t, i) => i > currentIndex.value && t.id === pick.track.id)
    if (later >= 0) queue.value.splice(later, 1)
    queue.value.splice(currentIndex.value + 1, 0, pick.track)
    mixPicks.value = new Set([...mixPicks.value, pick.track.id])
    pluginBus.emit('queueChange', queue.value)
    _preloadAdjacent()
  }

  function setMixMode(enabled: boolean) {
    mixMode.value = enabled
    window.api.mergeSettings({ mixMode: enabled })
    if (enabled) scheduleMixPick()
  }

  function setAutoMeet(rule: AutoMeet, percent = autoMeetPercent.value) {
    autoMeet.value = rule
    autoMeetPercent.value = Math.max(1, Math.min(10, Math.round(percent * 2) / 2))
    window.api.mergeSettings({ autoMeet: rule, autoMeetPercent: autoMeetPercent.value })
  }

  /** Snapshot for the dev hook / debugging */
  function transitionDebug() {
    return {
      phase: txEngine?.phase ?? 'no-engine',
      transitionId: txEngine?.transition?.id ?? null,
      committed: txEngine?.committed ?? false,
      fromPosition: txEngine?.fromPosition(),
      toPosition: txEngine?.toPosition(),
      skipped: [...txSkip],
      ...(txEngine?.debug ?? {}),
    }
  }

  // Repeat-one, a sleep timer or LRC sync mode can mean "don't move on to TO": back out of a
  // transition that hasn't committed yet
  watch([repeatMode, sleepTimerMode, lrcSyncMode], () => {
    const eng = txEngine
    if (!eng || eng.phase === 'idle' || eng.committed) return
    if (upcomingTrack()?.id !== eng.toTrack?.id) eng.collapseToFrom()
  })

  // ── Actions ──────────────────────────────────────────────────────────────
  async function play(track?: Track) {
    txEngine?.stopPreview()
    if (track) {
      const idx = queue.value.findIndex((t) => t.id === track.id)
      if (idx >= 0) {
        currentIndex.value = idx
      } else {
        queue.value.push(track)
        currentIndex.value = queue.value.length - 1
      }
      await loadTrack(track)
    }

    try {
      await activeAudio().play()
      if (isCrossfading && !usingStream) audioNext.play().catch(() => {})
    } catch (err) {
      console.error('Play error:', err)
    }
  }

  function pause() {
    if (txEngine?.active) {
      // Before the commit point FROM is still running on the element in sync: just back out to it.
      // After it, TO is the current track: leave it on the element where it is.
      if (!txEngine.committed && txEngine.collapseToFrom()) audio.pause()
      else parkOnTo(false)
      return
    }
    activeAudio().pause()
    if (isCrossfading) audioNext.pause()
  }

  function togglePlay() {
    if (isPlaying.value) pause()
    else play()
  }

  async function next() {
    if (txEngine?.active && !txEngine.committed) {
      // Mid-transition "next" means "get to TO now", which is already playing
      if (txEngine.finishNow()) return
      txEngine.collapseToFrom()
    }
    cancelCrossfade()
    if (queue.value.length === 0) return
    let nextIdx = currentIndex.value + 1
    if (nextIdx >= queue.value.length) {
      if (repeatMode.value === 'all') nextIdx = 0
      else return
    }
    currentIndex.value = nextIdx
    await loadTrack(queue.value[nextIdx])
    play()
  }

  async function previous() {
    // The element may hold the other song mid-transition, so its currentTime can't be trusted here
    let skipRestart = false
    if (txEngine?.active) {
      if (!txEngine.committed && txEngine.collapseToFrom()) {
        // Back on FROM, which is well past 3 s: the restart below handles it
      } else {
        const pos = txEngine.toPosition()
        if (pos > 3 || !txEngine.committed) { parkOnTo(true, 0); return }
        skipRestart = true
      }
    }
    cancelCrossfade()
    if (!skipRestart && activeAudio().currentTime > 3) {
      activeAudio().currentTime = 0
      return
    }
    if (queue.value.length === 0) return

    let prevIdx = currentIndex.value - 1
    if (prevIdx < 0) {
      if (repeatMode.value === 'all') prevIdx = queue.value.length - 1
      else {
        activeAudio().currentTime = 0
        return
      }
    }
    currentIndex.value = prevIdx
    await loadTrack(queue.value[prevIdx])
    play()
  }

  function seek(time: number) {
    if (txEngine?.active && (txEngine.committed || !txEngine.collapseToFrom())) {
      // TO is current: put it back on the element at the requested spot
      parkOnTo(isPlaying.value, time)
      pluginBus.emit('seek', time)
      sendDiscordUpdate()
      return
    }
    activeAudio().currentTime = time
    currentTime.value = time
    pluginBus.emit('seek', time)
    sendDiscordUpdate()
  }

  function seekPercent(percent: number) {
    seek((percent / 100) * duration.value)
  }

  function setVolume(val: number) {
    volume.value = Math.max(0, Math.min(1, val))
    pluginBus.emit('volumeChange', volume.value)
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
  }

  function toggleShuffle() {
    isShuffle.value = !isShuffle.value
    if (isShuffle.value) {
      originalQueue.value = [...queue.value]
      const current = queue.value[currentIndex.value]
      const rest = queue.value.filter((_, i) => i !== currentIndex.value)
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[rest[i], rest[j]] = [rest[j], rest[i]]
      }
      queue.value = [current, ...rest]
      currentIndex.value = 0
    } else {
      const current = currentTrack.value
      queue.value = [...originalQueue.value]
      if (current) {
        currentIndex.value = queue.value.findIndex((t) => t.id === current.id)
      }
    }
    txQueueChanged()
    _preloadAdjacent()
  }

  function cycleRepeat() {
    const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one']
    repeatMode.value = modes[(modes.indexOf(repeatMode.value) + 1) % 3]
  }

  async function playAll(tracks: Track[], startIndex = 0) {
    originalQueue.value = [...tracks]
    if (isShuffle.value) {
      // Keep the starting track first, shuffle the rest
      const startTrack = tracks[startIndex]
      const rest = tracks.filter((_, i) => i !== startIndex)
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]]
      }
      queue.value = [startTrack, ...rest]
      currentIndex.value = 0
      pluginBus.emit('queueChange', queue.value)
      await loadTrack(startTrack)
    } else {
      queue.value = [...tracks]
      currentIndex.value = startIndex
      pluginBus.emit('queueChange', queue.value)
      await loadTrack(tracks[startIndex])
    }
    play()
  }

  async function addToQueue(tracks: Track[]) {
    queue.value.push(...tracks)
    originalQueue.value.push(...tracks)
    pluginBus.emit('queueChange', queue.value)
    // If nothing is playing, start from the first added track
    if (!currentTrack.value && tracks.length > 0) {
      currentIndex.value = queue.value.length - tracks.length
      await loadTrack(queue.value[currentIndex.value])
      play()
    } else {
      txQueueChanged()
      _preloadAdjacent()
    }
  }

  function clearQueue() {
    abortTransition()
    mixPicks.value = new Set()
    queue.value = []
    originalQueue.value = []
    currentIndex.value = -1
    currentTrack.value = null
    audio.src = ''
    isPlaying.value = false
    pluginBus.emit('queueChange', queue.value)
    _disposePreloadCache()
  }

  function removeFromQueue(index: number) {
    if (index < 0 || index >= queue.value.length) return
    if (index === currentIndex.value) {
      // Removing current track – play next if available
      queue.value.splice(index, 1)
      if (queue.value.length === 0) {
        clearQueue()
      } else {
        if (currentIndex.value >= queue.value.length) currentIndex.value = 0
        loadTrack(queue.value[currentIndex.value])
        play()
      }
    } else {
      queue.value.splice(index, 1)
      if (index < currentIndex.value) currentIndex.value--
      txQueueChanged()
      _preloadAdjacent()
    }
  }

  function playFromQueue(index: number) {
    if (index < 0 || index >= queue.value.length) return
    currentIndex.value = index
    loadTrack(queue.value[index])
    play()
  }

  /** Insert a track right after the currently playing track */
  function playNext(trackOrTracks: Track | Track[]) {
    const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks]
    if (tracks.length === 0) return

    if (queue.value.length === 0 || currentIndex.value < 0) {
      // Nothing playing – just start it
      queue.value = [...tracks]
      originalQueue.value = [...tracks]
      currentIndex.value = 0
      loadTrack(tracks[0])
      play()
      return
    }
    const insertAt = currentIndex.value + 1
    queue.value.splice(insertAt, 0, ...tracks)
    originalQueue.value.splice(insertAt, 0, ...tracks)
    txQueueChanged()
    _preloadAdjacent()
  }

  /** Append a track or tracks to the end of the queue */
  function playLater(trackOrTracks: Track | Track[]) {
    const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks]
    if (tracks.length === 0) return

    if (queue.value.length === 0 || currentIndex.value < 0) {
      queue.value = [...tracks]
      originalQueue.value = [...tracks]
      currentIndex.value = 0
      loadTrack(tracks[0])
      play()
      return
    }
    queue.value.push(...tracks)
    originalQueue.value.push(...tracks)
    txQueueChanged()
    _preloadAdjacent()
  }

  /** Move a queue item from one index to another (for drag reorder) */
  function moveInQueue(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || fromIndex >= queue.value.length) return
    if (toIndex < 0 || toIndex >= queue.value.length) return

    const [item] = queue.value.splice(fromIndex, 1)
    queue.value.splice(toIndex, 0, item)

    // Update currentIndex to follow the currently playing track
    if (fromIndex === currentIndex.value) {
      currentIndex.value = toIndex
    } else {
      if (fromIndex < currentIndex.value && toIndex >= currentIndex.value) {
        currentIndex.value--
      } else if (fromIndex > currentIndex.value && toIndex <= currentIndex.value) {
        currentIndex.value++
      }
    }
    txQueueChanged()
    _preloadAdjacent()
  }

  function setLyricsOffset(offset: number) {
    lyricsOffset.value = offset
    window.api.mergeSettings({ lyricsOffset: offset })
  }

  function setWaveformEnabled(enabled: boolean) {
    waveformEnabled.value = enabled
    window.api.mergeSettings({ waveformEnabled: enabled })
    if (enabled && currentTrack.value) {
      const t = currentTrack.value
      if (t.source === 'subsonic' && t.path.startsWith('subsonic://')) {
        generateSubsonicWaveform(t.path.replace('subsonic://', ''))
      } else if (!t.path.startsWith('http://') && !t.path.startsWith('https://')) {
        generateWaveform(t.path)
      }
    }
  }

  /** Returns the current frequency data (0-255) from the AnalyserNode, or null if unavailable */
  function getFrequencyData(): Uint8Array | null {
    if (!analyserNode) return null
    analyserNode.getByteFrequencyData(frequencyBuf)
    return frequencyBuf
  }

  function setAnimatedCoversEnabled(enabled: boolean) {
    animatedCoversEnabled.value = enabled
    window.api.mergeSettings({ animatedCoversEnabled: enabled })
  }

  function setPauseAnimatedOnBlur(enabled: boolean) {
    pauseAnimatedOnBlur.value = enabled
    window.api.mergeSettings({ pauseAnimatedOnBlur: enabled })
  }

  function setAdaptiveAccent(enabled: boolean) {
    adaptiveAccent.value = enabled
    window.api.mergeSettings({ adaptiveAccent: enabled })
    if (!enabled) {
      currentAccentColor.value = null
      document.documentElement.style.removeProperty('--accent')
      document.documentElement.style.removeProperty('--accent-hover')
    }
  }

  function setIOSSliders(enabled: boolean) {
    iosSliders.value = enabled
    window.api.mergeSettings({ iosSliders: enabled })
  }

  function setTrayEnabled(enabled: boolean) {
    trayEnabled.value = enabled
    window.api.mergeSettings({ trayEnabled: enabled })
    window.api.setTrayEnabled(enabled)
  }

  function setTransparencyEnabled(enabled: boolean) {
    transparencyEnabled.value = enabled
    window.api.mergeSettings({ transparencyEnabled: enabled })
  }

  function setAutoFullscreen(enabled: boolean) {
    autoFullscreen.value = enabled
    window.api.mergeSettings({ autoFullscreen: enabled })
  }

  function setAutoFullscreenDelay(seconds: number) {
    autoFullscreenDelay.value = seconds
    window.api.mergeSettings({ autoFullscreenDelay: seconds })
  }

  function setNormalization(enabled: boolean) {
    normalization.value = enabled
    window.api.mergeSettings({ normalization: enabled })
    // Normalization requires a page reload since the AudioContext source can only be connected once
    // We'll show a toast from the UI side prompting a restart
  }

  function setCrossfadeEnabled(enabled: boolean) {
    crossfadeEnabled.value = enabled
    window.api.mergeSettings({ crossfadeEnabled: enabled })
    if (!enabled) cancelCrossfade()
  }

  function setCrossfadeDuration(seconds: number) {
    crossfadeDuration.value = Math.max(1, Math.min(12, seconds))
    window.api.mergeSettings({ crossfadeDuration: crossfadeDuration.value })
  }

  function setScrobblingEnabled(enabled: boolean) {
    scrobblingEnabled = enabled
    window.api.mergeSettings({ scrobblingEnabled: enabled })
  }

  // ── Remote control integration ──────────────────────────────────────────
  function sendRemoteState() {
    const trackForRemote = currentTrack.value ? {
      id: currentTrack.value.id,
      title: currentTrack.value.title,
      artist: currentTrack.value.artist,
      album: currentTrack.value.album,
      coverArt: currentTrack.value.coverArt,
      duration: currentTrack.value.duration,
    } : null

    window.api.sendRemoteState({
      currentTrack: trackForRemote,
      isPlaying: isPlaying.value,
      currentTime: currentTime.value,
      duration: duration.value,
      volume: volume.value,
      isMuted: isMuted.value,
      isShuffle: isShuffle.value,
      repeatMode: repeatMode.value,
      currentIndex: currentIndex.value,
      queue: queue.value.slice(0, 50).map(t => ({
        id: t.id, title: t.title, artist: t.artist,
        album: t.album, coverArt: t.coverArt,
      })),
      accent: (() => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
        return raw ? `rgb(${raw})` : undefined
      })(),
      isFavorite: (() => {
        if (!currentTrack.value) return false
        const favStore = (window as any).__auroraFavoritesStore
        if (!favStore) return false
        const ids: Set<string> | undefined = favStore.ids?.value
        return ids ? ids.has(currentTrack.value.id) : false
      })(),
    })
  }

  // Throttled time updates (don't flood WS)
  let remoteTimeThrottle = 0
  audio.addEventListener('timeupdate', () => {
    const now = Date.now()
    if (now - remoteTimeThrottle > 1000) {
      remoteTimeThrottle = now
      sendRemoteState()
    }
  })

  // Send on meaningful state changes
  watch(currentTrack, sendRemoteState)
  watch(isPlaying, sendRemoteState)
  watch(volume, sendRemoteState)
  watch(isMuted, sendRemoteState)
  watch(isShuffle, sendRemoteState)
  watch(repeatMode, sendRemoteState)

  // Handle commands from remote clients
  window.api.onRemoteCommand((command: string, data?: any) => {
    const transport = ['play', 'pause', 'playPause', 'togglePlay', 'next', 'previous', 'stop', 'seek', 'seekAbsolute', 'playFromQueue']
    if (lockedToggle.value && transport.includes(command)) {
      if (command === 'play' || command === 'pause' || command === 'playPause' || command === 'togglePlay') lockedToggle.value()
      return
    }
    switch (command) {
      case 'play': play(); break
      case 'pause': pause(); break
      case 'togglePlay': togglePlay(); break
      case 'next': next(); break
      case 'previous': previous(); break
      case 'seek': seek(typeof data === 'number' ? data : 0); break
      case 'volume': setVolume(typeof data === 'number' ? data : 0); break
      case 'toggleMute': toggleMute(); break
      case 'toggleShuffle': toggleShuffle(); break
      case 'cycleRepeat': cycleRepeat(); break
      case 'playFromQueue': {
        if (data && typeof data.index === 'number') {
          playFromQueue(data.index)
        }
        break
      }
      case 'playTrack': {
        const lib = getLibStore()
        const track = lib.tracks.find((t: Track) => t.id === data?.trackId)
        if (track) {
          const albumTracks = lib.tracks.filter((t: Track) => t.album === track.album && t.albumArtist === track.albumArtist)
          const idx = albumTracks.findIndex((t: Track) => t.id === track.id)
          playAll(albumTracks, Math.max(0, idx))
        }
        break
      }
      case 'playAlbum': {
        const lib = getLibStore()
        const albumTracks = lib.tracks.filter((t: Track) => {
          const key = `${t.album}---${t.albumArtist}`
          return key === data?.albumKey
        })
        if (albumTracks.length > 0) {
          if (data?.shuffle) isShuffle.value = true
          playAll(albumTracks, data?.startIndex || 0)
        }
        break
      }
      case 'playNext': {
        const lib = getLibStore()
        const track = lib.tracks.find((t: Track) => t.id === data?.trackId)
        if (track) playNext(track)
        break
      }
      case 'playLater': {
        const lib = getLibStore()
        const track = lib.tracks.find((t: Track) => t.id === data?.trackId)
        if (track) playLater(track)
        break
      }
      case 'playPlaylist': {
        const playlistStore = (window as any).__auroraPlaylistStore
        if (!playlistStore) break
        const tracks = playlistStore.getPlaylistTracks(data?.playlistId)
        if (tracks.length > 0) {
          if (data?.shuffle) isShuffle.value = true
          playAll(tracks, 0)
        }
        break
      }
      case 'toggleFavorite': {
        const favStore = (window as any).__auroraFavoritesStore
        if (favStore && data?.trackId) {
          favStore.toggle(data.trackId)
        }
        break
      }
    }
  })

  return {
    currentTrack,
    queue,
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isShuffle,
    repeatMode,
    isLoading,
    progress,
    hasNext,
    hasPrevious,
    play,
    pause,
    togglePlay,
    next,
    previous,
    seek,
    seekPercent,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    playAll,
    addToQueue,
    clearQueue,
    removeFromQueue,
    playFromQueue,
    playNext,
    playLater,
    moveInQueue,
    setDiscordFormat,
    setDiscordEnabled,
    // Audio output
    outputDeviceId,
    audioDevices,
    enumerateOutputDevices,
    setOutputDevice,
    registerUrlResolver,
    unregisterUrlResolver,
    // Lyrics offset
    lyricsOffset,
    setLyricsOffset,
    // Waveform
    waveformData,
    waveformEnabled,
    setWaveformEnabled,
    generateWaveform,
    // Animated covers
    animatedCoversEnabled,
    setAnimatedCoversEnabled,
    pauseAnimatedOnBlur,
    setPauseAnimatedOnBlur,
    // Adaptive accent
    adaptiveAccent,
    currentAccentColor,
    setAdaptiveAccent,
    // iOS sliders
    iosSliders,
    setIOSSliders,
    // Tray
    trayEnabled,
    setTrayEnabled,
    // Transparency
    transparencyEnabled,
    setTransparencyEnabled,
    // Auto-fullscreen
    autoFullscreen,
    autoFullscreenDelay,
    setAutoFullscreen,
    setAutoFullscreenDelay,
    // Audio normalization
    normalization,
    setNormalization,
    // Crossfade
    crossfadeEnabled,
    crossfadeDuration,
    setCrossfadeEnabled,
    setCrossfadeDuration,
    // Hand-made transitions
    transitionsEnabled,
    setTransitionsEnabled,
    upcomingTrack,
    transitionDebug,
    previewTransition,
    stopTransitionPreview,
    mixMode,
    mixPicks,
    setMixMode,
    autoMeet,
    autoMeetPercent,
    setAutoMeet,
    isTransitionPreviewing,
    getAudioContext,
    controlsLocked,
    setControlsLock,
    auditionTransition,
    // Scrobbling
    setScrobblingEnabled,
    // Playback error
    playbackError,
    // LRC sync mode
    lrcSyncMode,
    // Sleep timer
    sleepTimerMode,
    sleepTimerRemaining,
    startSleepTimer,
    cancelSleepTimer,
    // Audio analyser (for visual effects)
    getFrequencyData,
  }
})
