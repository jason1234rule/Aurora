/**
 * Live playback engine for hand-made transitions.
 *
 * The player normally plays through a media element. Around a transition the
 * engine takes over:
 *   1. prepare: decode windows of FROM and TO into AudioBuffers.
 *   2. arm: capture the element's own output, find exactly where it is in the
 *      FROM buffer (cross-correlation), and schedule everything on the
 *      AudioContext clock from that measurement.
 *   3. running: a short gain swap moves FROM from the element to its buffer
 *      (same audio, so it's inaudible), then the transition plays entirely on
 *      buffers. The element keeps playing FROM, muted and in sync, so backing
 *      out before the commit point is just the swap in reverse.
 *   4. commit: once TO dominates, the player makes TO the current track.
 *   5. handback: the element is switched to TO, measured against the TO
 *      buffer, nudged into sample alignment (muted, via playbackRate), then a
 *      second short swap hands TO back to the element.
 *
 * With pitch 'keep', prepare also renders time-stretched copies of the parts
 * that change speed (in a worker, see stretch/). Those play at rate 1 from
 * their first sample and follow the same tempo envelope, so measuring,
 * positions and the handback work exactly as with resampling.
 */
import type { Transition } from '@/types/transition'
import {
  buildSchedule, toPositionAt, toTimeAt, fromPositionAt, rampRateToUnity, applyParamEvents,
  planValueAt, rateAt, fromRampIn, equalPowerEvents, type TransitionSchedule, type TransitionTiming,
} from './schedule'
import { buildTransitionGraph, type TransitionGraph } from './graph'
import { findAlignment, mixToMono } from './align'
import { stretchPlan, renderPlan, type StretchRenderer } from './stretch/plan'
import { stretchInWorker } from './stretch/client'

/** Start decoding this long before exitAt */
export const PREP_WINDOW = 30
/** At least this long between starting to prepare and arming (decoding plus time-stretching) */
const PREP_TIME = 12
/** FROM's buffer takes over this long before exitAt */
export const LEAD_IN = 1.0
/** Measure the element this long before the FROM buffer takes over */
export const MEASURE_LEAD = 2.0
/** Element ↔ buffer gain swap duration */
export const SWAP = 0.04
/**
 * Interruptions are scheduled this far ahead: the render thread runs ahead of
 * ctx.currentTime as seen here, and automation placed in its past lands late.
 */
const LOOKAHEAD = 0.05
/** Seconds of TO decoded beyond the point where it plays alone, for the handback */
const HANDBACK_BUDGET = 15
const CAPTURE_FRAMES = 16384
const ALIGN_RADIUS = 0.25
const MIN_SCORE = 0.8
/** Handback is considered aligned within this many seconds */
const HANDBACK_TOLERANCE = 0.001

export type EnginePhase = 'idle' | 'preparing' | 'ready' | 'arming' | 'running' | 'handback'

export interface EngineHost {
  ctx: AudioContext
  /** Node the player's own element chain feeds (compressor or analyser) */
  bus: AudioNode
  element: HTMLAudioElement
  elementSource: AudioNode
  /** The player's gain between the element and the bus */
  elementGain: GainNode
  mediaUrl(path: string): string
  /** TO now dominates: make it the current track */
  onCommit(to: Track, info: { duration: number }): void
  /** The element plays TO at full gain again; normal element handling resumes */
  onSettled(to: Track): void
  /** TO wouldn't load in the element: the player should load it normally at `position` */
  onHandbackFailed(to: Track, position: number): void
}

export type PreviewSolo = 'both' | 'from' | 'to'

export interface PreviewOptions {
  /** Seconds of FROM before exitAt */
  preRoll: number
  /** Seconds after the overlap ends */
  postRoll: number
  solo: PreviewSolo
  onEnded?: () => void
  /** Pre-stretched sections from previewStretchPlan (pitch 'keep'); missing ones play resampled */
  stretched?: { from?: AudioBuffer; to?: AudioBuffer }
}

export interface PreviewHandle {
  /** ctx time at which exitAt is heard */
  t0: number
  startAt: number
  endAt: number
  schedule: TransitionSchedule
  setSolo(solo: PreviewSolo): void
  stop(): void
}

export type PrepareResult =
  | { ok: true }
  | { ok: false; reason: 'mismatch'; side: 'from' | 'to'; decoded: number }
  | { ok: false; reason: 'error'; error: string }

export interface EngineDebug {
  arm?: { method: 'measured' | 'estimated'; score?: number; elementOffsetMs?: number }
  /** ctx times of the last armed transition */
  times?: { t0: number; swapIn: number; commitAt: number; overlapEnd: number; settledAt: number }
  handback?: { iterations: number; finalDeltaMs: number | null; converged: boolean; steps: string[] }
  /** Last prepare's time-stretch (pitch 'keep'): which sides, seconds of output, how long it took */
  stretch?: { from: boolean; to: boolean; seconds: number; ms: number }
  lastError?: string
}

interface Plan {
  transition: Transition
  fromTrack: Track
  toTrack: Track
  fromBuf: AudioBuffer
  toBuf: AudioBuffer
  /** File positions (s) of sample 0 of each buffer */
  fromWin: number
  toWin: number
  fromDuration: number
  toDuration: number
  fromMono?: Float32Array
  toMono?: Float32Array
  /** Time-stretched sections (pitch 'keep'), each starting at its source's start time */
  fromPlay?: AudioBuffer
  toPlay?: AudioBuffer
  schedule?: TransitionSchedule
  graph?: TransitionGraph
  commitAt?: number
  committed: boolean
}

export interface Decoded { buffer: AudioBuffer; start: number; duration: number }

/** Fetch and decode a local file, keeping only [start, end) seconds to save memory. */
export async function decodeWindow(ctx: BaseAudioContext, url: string, start = 0, end = Infinity): Promise<Decoded> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed (${res.status})`)
  const full = await ctx.decodeAudioData(await res.arrayBuffer())
  const sr = full.sampleRate
  const s = Math.min(full.length, Math.max(0, Math.floor(start * sr)))
  const e = Math.min(full.length, Math.max(s + 1, Math.ceil(end * sr)))
  if (s === 0 && e === full.length) return { buffer: full, start: 0, duration: full.duration }
  const win = ctx.createBuffer(full.numberOfChannels, e - s, sr)
  for (let c = 0; c < full.numberOfChannels; c++) win.copyToChannel(full.getChannelData(c).subarray(s, e), c)
  return { buffer: win, start: s / sr, duration: full.duration }
}

/** How long before exitAt FROM's buffer takes over: before FROM starts changing speed, if it does */
export function leadInFor(t: Transition): number {
  const base = t.type === 'echo-out' ? Math.max(LEAD_IN, (t.echo?.delay ?? 0.375) + 0.3) : LEAD_IN
  return base + fromRampIn(t)
}

/** Start preparing this long before exitAt */
export function prepWindowFor(t: Transition): number {
  return Math.max(PREP_WINDOW, leadInFor(t) + MEASURE_LEAD + PREP_TIME)
}

/** Preview pre-roll actually used (it can't start before the file does) */
function previewPreRoll(t: TransitionTiming, preRoll: number): number {
  return Math.max(0, Math.min(preRoll, t.exitAt))
}

/**
 * What a preview with these options needs time-stretched (empty unless pitch is 'keep'
 * and a song changes speed). Render it with renderPlan and pass the result as
 * PreviewOptions.stretched; the same options must be used for both.
 */
export function previewStretchPlan(t: TransitionTiming, opts: Pick<PreviewOptions, 'preRoll' | 'postRoll'>) {
  const preRoll = previewPreRoll(t, opts.preRoll)
  const s = buildSchedule(t, { t0: preRoll, leadIn: preRoll, fromWindowStart: 0, toWindowStart: 0 })
  return stretchPlan(s, s.overlapEnd + opts.postRoll + 0.1)
}

const TAP_PROCESSOR = `
class AuroraTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = null
    this.filled = 0
    this.startFrame = -1
    this.port.onmessage = (e) => { this.buf = new Float32Array(e.data.frames); this.filled = 0; this.startFrame = -1 }
  }
  process(inputs) {
    const input = inputs[0]
    if (this.buf && input && input.length > 0) {
      if (this.startFrame < 0) this.startFrame = currentFrame
      const n = Math.min(input[0].length, this.buf.length - this.filled)
      const k = 1 / input.length
      for (let i = 0; i < n; i++) {
        let s = 0
        for (let c = 0; c < input.length; c++) s += input[c][i]
        this.buf[this.filled + i] = s * k
      }
      this.filled += n
      if (this.filled >= this.buf.length) {
        const buf = this.buf
        this.buf = null
        this.port.postMessage({ startFrame: this.startFrame, samples: buf }, [buf.buffer])
      }
    }
    return true
  }
}
registerProcessor('aurora-tap', AuroraTap)
`

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Ramp a curve-free param from `from` (its value at `at`) to `to`. Deliberately not
 * cancelAndHoldAtTime: Chromium's version leaves steps in gains and mis-times
 * playbackRate ramps (measured ~5 ms of drift), whereas an explicit set + ramp is exact.
 */
function rampParam(param: AudioParam, at: number, from: number, to: number, dur: number, exponential = false) {
  param.cancelScheduledValues(at)
  param.setValueAtTime(from, at)
  if (exponential) param.exponentialRampToValueAtTime(Math.max(1e-4, to), at + dur)
  else param.linearRampToValueAtTime(to, at + dur)
}

/** Ramp from wherever the param is now (trim stages, whose value we don't model). */
function rampFromCurrent(param: AudioParam, at: number, to: number, dur: number) {
  rampParam(param, at, param.value, to, dur)
}

/** Equal-power version of rampFromCurrent, for swapping between a stretched buffer and the element */
function swapFromCurrent(param: AudioParam, at: number, to: number, dur: number) {
  const from = param.value
  param.cancelScheduledValues(at)
  applyParamEvents(param, equalPowerEvents(at, dur, to > from, from, to))
}

function waitForMedia(el: HTMLMediaElement, ok: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const done = (v: boolean) => {
      clearTimeout(timer)
      el.removeEventListener(ok, onOk)
      el.removeEventListener('error', onErr)
      resolve(v)
    }
    const onOk = () => done(true)
    const onErr = () => done(false)
    const timer = setTimeout(() => done(el.readyState >= 3), timeoutMs)
    el.addEventListener(ok, onOk)
    el.addEventListener('error', onErr)
  })
}

export class TransitionEngine {
  phase: EnginePhase = 'idle'
  debug: EngineDebug = {}
  private plan: Plan | null = null
  /** Bumped whenever the plan is dropped, so stale async work can bail out */
  private token = 0
  private timers: ReturnType<typeof setTimeout>[] = []
  private out: GainNode
  private tap: AudioWorkletNode | null = null
  private tapFailed = false
  private capturing = false
  /** Decoded buffers kept after a back-out so re-arming the same pair needn't decode again */
  private cache: { key: string; plan: Plan } | null = null

  constructor(private host: EngineHost, private stretch: StretchRenderer = stretchInWorker) {
    this.out = host.ctx.createGain()
    this.out.connect(host.bus)
  }

  // ── State queries ─────────────────────────────────────────────────────────

  /** The transition is scheduled or playing (crossfade and the arming tick must stay off) */
  get active(): boolean { return this.phase === 'running' || this.phase === 'handback' || this.phase === 'arming' }

  /** The engine is using the element for TO: the player must ignore its events */
  get ownsElement(): boolean {
    return this.phase === 'handback' || (this.phase === 'running' && !!this.plan?.committed)
  }

  get committed(): boolean { return !!this.plan?.committed && (this.phase === 'running' || this.phase === 'handback') }

  isFor(t: Transition, from: Track, to: Track): boolean {
    const p = this.plan
    return !!p && p.transition.id === t.id && p.transition.updatedAt === t.updatedAt
      && p.fromTrack.id === from.id && p.toTrack.id === to.id
  }

  get transition(): Transition | null { return this.plan?.transition ?? null }
  get schedule(): TransitionSchedule | null { return this.plan?.schedule ?? null }
  get toTrack(): Track | null { return this.plan?.toTrack ?? null }

  /** File position of TO right now (only meaningful once running) */
  toPosition(): number {
    const s = this.plan?.schedule
    return s ? Math.max(0, toPositionAt(s, this.host.ctx.currentTime)) : 0
  }

  fromPosition(): number {
    const p = this.plan
    if (!p?.schedule) return this.host.element.currentTime
    return Math.min(p.fromDuration, fromPositionAt(p.transition.exitAt, p.schedule, this.host.ctx.currentTime))
  }

  /** Before the commit point FROM is what the listener mostly hears */
  dominant(): 'from' | 'to' {
    const p = this.plan
    if (!p?.schedule || p.commitAt === undefined) return 'from'
    return this.host.ctx.currentTime < p.commitAt && !p.committed ? 'from' : 'to'
  }

  setVolume(v: number) {
    const now = this.host.ctx.currentTime
    this.out.gain.cancelScheduledValues(now)
    this.out.gain.setTargetAtTime(v, now, 0.01)
  }

  // ── Prepare ───────────────────────────────────────────────────────────────

  async prepare(t: Transition, from: Track, to: Track): Promise<PrepareResult> {
    this.release()
    const token = ++this.token
    const cacheKey = `${t.id}:${t.updatedAt}:${from.path}:${to.path}`
    if (this.cache?.key === cacheKey) {
      this.plan = { ...this.cache.plan, schedule: undefined, graph: undefined, commitAt: undefined, committed: false }
      this.phase = 'ready'
      return { ok: true }
    }
    this.phase = 'preparing'
    const { ctx } = this.host
    try {
      const lead = leadInFor(t)
      // Relative timing doesn't depend on t0, so a dry run tells us how much of each song is needed
      const dry = buildSchedule(t, { t0: 0, leadIn: lead, fromWindowStart: -1e9, toWindowStart: -1e9 })
      const toUntil = dry.settledAt + HANDBACK_BUDGET
      const toEnd = toPositionAt(dry, toUntil) + 0.5

      const fromDec = await decodeWindow(ctx, this.host.mediaUrl(from.path),
        Math.min(t.exitAt - lead - MEASURE_LEAD - 1.5, dry.from.startPos - 0.5),
        fromPositionAt(t.exitAt, dry, dry.from.stopAt) + 0.5)
      if (token !== this.token) return { ok: false, reason: 'error', error: 'superseded' }
      if (Math.abs(fromDec.duration - t.from.duration) > 0.5) {
        this.reset()
        return { ok: false, reason: 'mismatch', side: 'from', decoded: fromDec.duration }
      }

      const toDec = await decodeWindow(ctx, this.host.mediaUrl(to.path), t.entryAt - 0.5, toEnd)
      if (token !== this.token) return { ok: false, reason: 'error', error: 'superseded' }
      if (Math.abs(toDec.duration - t.to.duration) > 0.5) {
        this.reset()
        return { ok: false, reason: 'mismatch', side: 'to', decoded: toDec.duration }
      }

      // Pitch 'keep': render the parts that change speed now, so arming stays instant
      let stretched: { from?: AudioBuffer; to?: AudioBuffer } = {}
      const sp = stretchPlan(dry, toUntil)
      if (sp.from || sp.to) {
        const started = performance.now()
        try {
          stretched = await renderPlan(ctx, sp, {
            from: { buffer: fromDec.buffer, start: fromDec.start },
            to: { buffer: toDec.buffer, start: toDec.start },
          }, this.stretch)
          this.debug.stretch = {
            from: !!stretched.from, to: !!stretched.to,
            seconds: (sp.from?.duration ?? 0) + (sp.to?.duration ?? 0), ms: Math.round(performance.now() - started),
          }
        } catch (err) {
          // Still worth playing: the speed change falls back to resampling (pitch moves with it)
          console.warn('[Transitions] Time-stretch failed, resampling instead:', err)
          this.debug.lastError = `stretch: ${err}`
        }
        if (token !== this.token) return { ok: false, reason: 'error', error: 'superseded' }
      }

      this.plan = {
        transition: t, fromTrack: from, toTrack: to,
        fromBuf: fromDec.buffer, toBuf: toDec.buffer,
        fromWin: fromDec.start, toWin: toDec.start,
        fromDuration: fromDec.duration, toDuration: toDec.duration,
        fromPlay: stretched.from, toPlay: stretched.to,
        committed: false,
      }
      this.cache = { key: cacheKey, plan: this.plan }
      this.phase = 'ready'
      return { ok: true }
    } catch (err) {
      if (token === this.token) this.reset()
      this.debug.lastError = String(err)
      return { ok: false, reason: 'error', error: String(err) }
    }
  }

  // ── Arm ───────────────────────────────────────────────────────────────────

  /**
   * Measure where the element is and schedule the transition. Call while the
   * element is playing FROM, roughly MEASURE_LEAD + LEAD_IN before exitAt.
   * Returns false if it's too late (the caller should skip this play-through).
   */
  async arm(): Promise<boolean> {
    try {
      return await this.armInner()
    } catch (err) {
      this.debug.lastError = `arm: ${err}`
      if (this.phase === 'arming') this.reset()
      else if (this.phase === 'running') this.collapseToFrom()
      throw err
    }
  }

  private async armInner(): Promise<boolean> {
    const p = this.plan
    if (!p || this.phase !== 'ready') return false
    this.phase = 'arming'
    const token = this.token
    const { ctx, element } = this.host
    const t = p.transition
    const lead = leadInFor(t)
    const sr = ctx.sampleRate

    await this.ensureTap()
    if (token !== this.token) return false
    p.fromMono ??= mixToMono(p.fromBuf)
    const m = await this.measure(p.fromMono, p.fromWin, element.currentTime)
    if (token !== this.token) return false

    // Until FROM starts changing speed its buffer runs at rate 1 like the element, at file
    // position (time − t0) + k. Solving that against the measurement gives t0 (k = exitAt
    // when FROM keeps its speed).
    const dry = buildSchedule(t, { t0: 0, leadIn: lead, fromWindowStart: -1e9, toWindowStart: -1e9 })
    const k = fromPositionAt(t.exitAt, dry, dry.from.startAt) - dry.from.startAt
    let t0: number
    if (m) {
      t0 = m.frame / sr - m.pos + k
      this.debug.arm = { method: 'measured', score: m.score, elementOffsetMs: (element.currentTime - (m.pos + (ctx.currentTime - m.frame / sr))) * 1000 }
    } else {
      // No worklet or no confident match (e.g. muted): trust currentTime and hope
      t0 = ctx.currentTime - element.currentTime + k
      this.debug.arm = { method: 'estimated' }
    }

    const now = ctx.currentTime
    if (t0 - lead < now + 0.05 || element.paused) {
      this.reset()
      return false
    }

    const s = buildSchedule(t, {
      t0, leadIn: lead, fromWindowStart: p.fromWin, toWindowStart: p.toWin, swapIn: SWAP, sampleRate: sr,
      prerendered: { from: !!p.fromPlay, to: !!p.toPlay },
    })
    p.schedule = s
    p.graph = buildTransitionGraph(ctx, { from: p.fromPlay ?? p.fromBuf, to: p.toPlay ?? p.toBuf }, s, this.out)
    const eg = this.host.elementGain.gain
    eg.cancelScheduledValues(now)
    eg.setValueAtTime(1, now)
    applyParamEvents(eg, s.elementGain)

    const overlap = s.overlapEnd - s.t0
    p.commitAt = t.type === 'blend' && overlap > 0 ? s.t0 + overlap / 2 : s.t0
    this.debug.times = { t0: s.t0, swapIn: s.from.startAt, commitAt: p.commitAt, overlapEnd: s.overlapEnd, settledAt: s.settledAt }
    this.phase = 'running'
    this.at(p.commitAt, () => this.commit())
    this.at(s.settledAt, () => { this.handback() })
    return true
  }

  // ── Backing out / finishing early ─────────────────────────────────────────

  /** Drop a plan that hasn't become audible (preparing / ready / arming). */
  release() {
    if (this.phase === 'running' || this.phase === 'handback') return
    this.reset()
  }

  /**
   * Back out to FROM on the element. Only possible before the commit point,
   * while the element still plays FROM in sync. Returns false if not possible.
   */
  collapseToFrom(): boolean {
    if (this.phase === 'preparing' || this.phase === 'ready' || this.phase === 'arming') { this.reset(); return true }
    const p = this.plan
    const s = p?.schedule
    const el = this.host.element
    if (this.phase !== 'running' || !p?.graph || !s || p.committed || el.ended) return false
    const at = this.host.ctx.currentTime + LOOKAHEAD
    const diverged = at > s.fromRampStart
    if (!diverged && !p.fromPlay) {
      // The element still plays exactly what the FROM buffer plays
      rampFromCurrent(this.host.elementGain.gain, at, 1, SWAP)
      this.fadeGraph(at, SWAP)
    } else {
      // A stretched FROM matches the element in time but not sample for sample. Once FROM has
      // changed speed it doesn't even match in time: put the element where FROM is heard and
      // crossfade a little longer to cover the seek. Not sample-exact, but backing out is the
      // listener's own call.
      const delay = diverged ? 0.05 : 0
      const fade = diverged ? 0.12 : SWAP
      if (diverged) el.currentTime = Math.min(p.fromDuration, fromPositionAt(p.transition.exitAt, s, at + delay))
      swapFromCurrent(this.host.elementGain.gain, at + delay, 1, fade)
      swapFromCurrent(p.graph.fromOut.gain, at, 0, fade + delay)
      rampFromCurrent(p.graph.toOut.gain, at, 0, fade + delay)
      p.graph.dispose(at + fade + delay + 0.01)
    }
    this.reset(true)
    return true
  }

  /** Skip ahead: fade FROM out now, commit TO and hand back as soon as TO is steady. */
  finishNow(): boolean {
    const p = this.plan
    const s = p?.schedule
    if (this.phase !== 'running' || !p?.graph || !s) return false
    const { ctx } = this.host
    const at = ctx.currentTime + LOOKAHEAD
    // Before TO has started there's nothing to skip ahead to: let the caller back out instead
    if (at < s.t0) return false
    const g = p.graph
    const fade = 0.15
    rampFromCurrent(g.fromOut.gain, at, 0, fade)
    // TO may be mid fade-in: crossfade its curve path against the direct path to reach full level
    rampFromCurrent(g.toCurveTrim.gain, at, 0, fade)
    rampFromCurrent(g.toDirect.gain, at, 1, fade)
    if (g.toShelf && s.bassSwap) rampParam(g.toShelf.gain, at, planValueAt(s.bassSwap.to, at), 0, fade)
    if (g.toFilter && s.filter) {
      const neutral = g.toFilter.type === 'highpass' ? 10 : Math.min(20000, ctx.sampleRate / 2)
      rampParam(g.toFilter.frequency, at, planValueAt(s.filter.frequency, at), neutral, fade, true)
    }
    try { g.fromSource.stop(at + fade + 0.01) } catch { /* already stopped */ }
    let handAt = at + fade + 0.05
    if (p.toPlay) {
      // A stretched TO can't change course: it eases back to its own speed as planned
      handAt = Math.max(handAt, s.settledAt)
    } else if (s.toRate.length) {
      const rateRamp = 0.5
      rampParam(g.toSource.playbackRate, at, rateAt(s.toRate, at), 1, rateRamp)
      s.toRate = rampRateToUnity(s.toRate, at, rateRamp)
      handAt = Math.max(handAt, at + rateRamp + 0.05)
    }
    this.clearTimers()
    if (!p.committed) this.commit()
    this.at(handAt, () => { this.handback() })
    return true
  }

  /**
   * Stop everything now (short fade) and forget the transition. The element
   * gain stays at 0: the caller must switch the element and then call
   * restoreElementGain(). Returns where TO was, for parking it.
   */
  stop(): { toTrack: Track; toPos: number; committed: boolean; elementHasTo: boolean } | null {
    const p = this.plan
    if (!p || (this.phase !== 'running' && this.phase !== 'handback')) { this.reset(); return null }
    const now = this.host.ctx.currentTime
    const info = {
      toTrack: p.toTrack,
      toPos: this.toPosition(),
      committed: p.committed,
      elementHasTo: this.phase === 'handback',
    }
    // Short fades without lookahead: the caller is about to switch the element right away
    rampFromCurrent(this.host.elementGain.gain, now, 0, 0.02)
    this.fadeGraph(now, 0.03)
    this.resetElementRate()
    this.reset()
    return info
  }

  restoreElementGain(delay = 0.03) {
    rampFromCurrent(this.host.elementGain.gain, this.host.ctx.currentTime + delay, 1, 0.02)
  }

  // ── Editor preview ───────────────────────────────────────────────────────

  private previewHandle: PreviewHandle | null = null

  /**
   * Play a transition from whole-file buffers, through the same schedule and graph
   * as live playback. The caller must pause normal playback first.
   */
  preview(buffers: { from: AudioBuffer; to: AudioBuffer }, t: TransitionTiming, opts: PreviewOptions): PreviewHandle {
    this.stopPreview()
    const { ctx } = this.host
    const preRoll = previewPreRoll(t, opts.preRoll)
    const startAt = ctx.currentTime + 0.08
    const t0 = startAt + preRoll
    const st = opts.stretched ?? {}
    const s = buildSchedule(t, {
      t0, leadIn: preRoll, fromWindowStart: 0, toWindowStart: 0, sampleRate: ctx.sampleRate,
      prerendered: { from: !!st.from, to: !!st.to },
    })
    const endAt = s.overlapEnd + opts.postRoll

    const master = ctx.createGain()
    master.connect(this.out)
    const fromBus = ctx.createGain()
    const toBus = ctx.createGain()
    fromBus.connect(master)
    toBus.connect(master)
    const applySolo = (solo: PreviewSolo, at: number) => {
      rampFromCurrent(fromBus.gain, at, solo === 'to' ? 0 : 1, 0.02)
      rampFromCurrent(toBus.gain, at, solo === 'from' ? 0 : 1, 0.02)
    }
    fromBus.gain.value = opts.solo === 'to' ? 0 : 1
    toBus.gain.value = opts.solo === 'from' ? 0 : 1
    // Fade the tail so the preview doesn't stop mid-note
    master.gain.setValueAtTime(1, Math.max(startAt, endAt - 0.4))
    master.gain.linearRampToValueAtTime(0, endAt)

    const graph = buildTransitionGraph(ctx, { from: st.from ?? buffers.from, to: st.to ?? buffers.to }, s, fromBus, toBus)
    graph.toSource.stop(endAt + 0.02)
    let stopped = false
    const cleanup = () => {
      if (stopped) return
      stopped = true
      clearTimeout(endTimer)
      graph.dispose(ctx.currentTime + 0.04)
      setTimeout(() => { for (const n of [master, fromBus, toBus]) n.disconnect() }, 100)
      if (this.previewHandle === handle) this.previewHandle = null
    }
    const endTimer = setTimeout(() => { cleanup(); opts.onEnded?.() }, (endAt - ctx.currentTime) * 1000 + 30)
    const handle: PreviewHandle = {
      t0, startAt, endAt, schedule: s,
      setSolo: (solo) => { if (!stopped) applySolo(solo, ctx.currentTime + 0.01) },
      stop: () => {
        if (stopped) return
        rampFromCurrent(master.gain, ctx.currentTime, 0, 0.03)
        cleanup()
      },
    }
    this.previewHandle = handle
    return handle
  }

  stopPreview() {
    this.previewHandle?.stop()
    this.previewHandle = null
  }

  get previewing(): boolean { return !!this.previewHandle }

  // ── Internals ─────────────────────────────────────────────────────────────

  private commit() {
    const p = this.plan
    if (!p || p.committed) return
    p.committed = true
    this.host.onCommit(p.toTrack, { duration: p.toDuration })
  }

  private async handback() {
    try {
      await this.handbackInner()
    } catch (err) {
      console.error('[Transitions] handback failed:', err)
      if (this.phase === 'handback') this.failHandback()
    }
  }

  private async handbackInner() {
    const p = this.plan
    const s = p?.schedule
    if (!p || !s || this.phase !== 'running') return
    if (!p.committed) this.commit()
    this.phase = 'handback'
    const token = this.token
    const { ctx, element } = this.host
    const sr = ctx.sampleRate
    // Past this ctx time the TO buffer runs out, so swap no matter what
    const deadline = (p.toPlay ? s.to.startAt + p.toPlay.duration : toTimeAt(s, p.toWin + p.toBuf.duration)) - 1.0

    element.src = this.host.mediaUrl(p.toTrack.path)
    const loaded = await waitForMedia(element, 'canplay', 4000)
    if (token !== this.token) return
    if (!loaded) return this.failHandback()
    // Aim a little ahead to cover start-up latency; the measurement below corrects the rest
    element.currentTime = toPositionAt(s, ctx.currentTime + 0.03)
    await waitForMedia(element, 'seeked', 2000)
    if (token !== this.token) return
    try { await element.play() } catch { /* checked just below */ }
    if (token !== this.token) return
    if (element.paused) return this.failHandback()

    // Converge: measure the element against the TO buffer and re-seek it (it's muted) until it
    // lands close enough. Chrome restarts media output at a slightly random point after a seek
    // (±8 ms in testing), and playbackRate nudges move it in whole 128-frame steps, so retrying
    // seeks is the dependable way in. The tolerance loosens as attempts run out.
    p.toMono ??= mixToMono(p.toBuf)
    let attempts = 0, misses = 0, delta: number | null = null, converged = false, stable = 0
    const steps: string[] = []
    await sleep(200)
    while (token === this.token && ctx.currentTime < deadline - 1.2 && attempts < 16) {
      const m = await this.measure(p.toMono, p.toWin, element.currentTime)
      if (token !== this.token) return
      if (!m) {
        // Usually silence (muted, volume 0) or a capture that straddled a glitch: retry a little
        steps.push('no match')
        if (++misses >= 3) break
        continue
      }
      misses = 0
      delta = m.pos - toPositionAt(s, m.frame / sr) // > 0: element is ahead
      steps.push(`Δ=${(delta * 1000).toFixed(2)}ms score=${m.score.toFixed(3)}`)
      const tolerance = HANDBACK_TOLERANCE * (attempts < 6 ? 1 : attempts < 10 ? 2 : 3)
      if (Math.abs(delta) <= tolerance && m.score > 0.9) {
        // Measure once more before trusting it: output can still be settling after a seek
        if (++stable >= 2) { converged = true; break }
        continue
      }
      stable = 0
      attempts++
      element.currentTime = Math.max(0, element.currentTime - delta)
      await waitForMedia(element, 'seeked', 2000)
      await sleep(300)
    }
    if (token !== this.token) return
    this.debug.handback = { iterations: attempts, finalDeltaMs: delta === null ? null : delta * 1000, converged, steps }

    const at = ctx.currentTime + LOOKAHEAD
    const g = p.graph!
    if (p.toPlay) {
      // A stretched TO lines up with the element in time but not in phase: equal power
      swapFromCurrent(g.toOut.gain, at, 0, SWAP)
      swapFromCurrent(this.host.elementGain.gain, at, 1, SWAP)
    } else {
      // Same audio on both sides now, so a linear (amplitude-preserving) swap
      rampFromCurrent(g.toOut.gain, at, 0, SWAP)
      rampFromCurrent(this.host.elementGain.gain, at, 1, SWAP)
    }
    g.dispose(at + SWAP + 0.01)
    await sleep((LOOKAHEAD + SWAP + 0.06) * 1000)
    if (token !== this.token) return
    this.resetElementRate()
    const to = p.toTrack
    this.reset()
    this.host.onSettled(to)
  }

  private failHandback() {
    const p = this.plan
    if (!p) return
    const pos = this.toPosition()
    this.debug.lastError = 'handback: TO failed to load in the element'
    this.fadeGraph(this.host.ctx.currentTime, 0.03)
    this.resetElementRate()
    const to = p.toTrack
    this.reset()
    this.host.onHandbackFailed(to, pos)
  }

  private fadeGraph(at: number, dur: number) {
    const g = this.plan?.graph
    if (!g) return
    rampFromCurrent(g.fromOut.gain, at, 0, dur)
    rampFromCurrent(g.toOut.gain, at, 0, dur)
    g.dispose(at + dur + 0.01)
  }

  private resetElementRate() {
    const el = this.host.element
    if (el.playbackRate !== 1) el.playbackRate = 1
    el.preservesPitch = true
  }

  private at(ctxTime: number, fn: () => void) {
    const token = this.token
    const ms = Math.max(0, (ctxTime - this.host.ctx.currentTime) * 1000)
    this.timers.push(setTimeout(() => { if (token === this.token) fn() }, ms))
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  /** Forget the current plan. `keepCache` leaves decoded buffers for a quick re-arm. */
  private reset(keepCache = true) {
    this.clearTimers()
    this.token++
    this.plan = null
    this.phase = 'idle'
    if (!keepCache) this.cache = null
  }

  private async ensureTap() {
    if (this.tap || this.tapFailed) return
    const { ctx, elementSource } = this.host
    try {
      const url = URL.createObjectURL(new Blob([TAP_PROCESSOR], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const tap = new AudioWorkletNode(ctx, 'aurora-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      // Worklets are only processed when they lead to the destination
      const sink = ctx.createGain()
      sink.gain.value = 0
      tap.connect(sink).connect(ctx.destination)
      elementSource.connect(tap)
      this.tap = tap
    } catch (err) {
      this.tapFailed = true
      this.debug.lastError = `tap: ${err}`
      console.warn('[Transitions] Audio worklet unavailable, falling back to estimated alignment:', err)
    }
  }

  private async capture(frames: number): Promise<{ startFrame: number; samples: Float32Array } | null> {
    const tap = this.tap
    if (!tap) return null
    // A capture abandoned by a cancelled arm can still be running; it finishes within ~0.4 s
    for (let i = 0; i < 40 && this.capturing; i++) await sleep(25)
    if (this.capturing) return null
    this.capturing = true
    return new Promise(resolve => {
      const finish = (v: { startFrame: number; samples: Float32Array } | null) => {
        clearTimeout(timer)
        tap.port.onmessage = null
        this.capturing = false
        resolve(v)
      }
      const timer = setTimeout(() => finish(null), frames / this.host.ctx.sampleRate * 1000 + 800)
      tap.port.onmessage = (e: MessageEvent) => finish(e.data)
      tap.port.postMessage({ frames })
    })
  }

  /** Where in `mono` (a buffer starting at file position `winStart`) the element is. */
  private async measure(mono: Float32Array, winStart: number, expectedPos: number) {
    const cap = await this.capture(CAPTURE_FRAMES)
    if (!cap) return null
    const sr = this.host.ctx.sampleRate
    const r = findAlignment(mono, cap.samples, (expectedPos - winStart) * sr, ALIGN_RADIUS * sr)
    if (!r || r.score < MIN_SCORE) return null
    return { frame: cap.startFrame, pos: winStart + r.index / sr, score: r.score }
  }
}
