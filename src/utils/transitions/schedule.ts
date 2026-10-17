/**
 * Pure scheduling math for hand-made transitions.
 *
 * Everything here maps a Transition plus a few clock facts onto AudioContext
 * times: when each buffer starts, at which file offset, and how every gain,
 * filter and playbackRate param moves. No Web Audio objects are touched, so it
 * can be unit tested without audio hardware.
 *
 * Coordinates: "file positions" are seconds into the decoded file (the same
 * timeline decodeAudioData produces). "ctx times" are AudioContext seconds.
 * `t0` is the ctx time at which FROM's `exitAt` is heard; TO's `entryAt` is
 * heard at the same instant.
 */
import type { CurvePreset, FadePoint, PitchMode, StretchMode, Transition } from '@/types/transition'

/** Largest speed change either song gets, as a fraction */
export const MAX_RATE_DEVIATION = 0.10
/** Beyond this, time-stretching artifacts may start to be audible */
export const STRETCH_WARN_DEVIATION = 0.06
export const MIN_OVERLAP = 0.05
export const CUT_DECLICK = 0.005
export const ECHO_DRY_CUT = 0.03
export const BASS_SHELF_HZ = 200
export const BASS_CUT_DB = -40
export const BASS_SWAP_RAMP = 0.02
export const FILTER_RELEASE = 1.0
/** Tempo ramp-back for transitions saved before `rampBack` existed */
export const DEFAULT_RATE_RAMP = 2.0
/** New transitions ease back over this many bars of TO, or this many seconds without a beat grid */
export const DEFAULT_RAMP_BACK_BARS = 8
export const DEFAULT_RAMP_BACK_SECONDS = 8
/** FROM's ramp into the overlap is capped so the engine can still prepare it in time */
export const MAX_FROM_RAMP = 16
/** FROM's ramp starts at least this far into the file (covers the engine's longest lead-in before it) */
const FROM_RAMP_HEADROOM = 3
export const DEFAULT_ECHO = { delay: 0.375, feedback: 0.5 }

export type ParamEvent =
  | { type: 'set'; time: number; value: number }
  | { type: 'linear'; time: number; value: number }
  | { type: 'exponential'; time: number; value: number }
  | { type: 'curve'; time: number; duration: number; values: Float32Array }

/** A breakpoint of a piecewise-linear playbackRate envelope. Constant outside the points. */
export interface RatePoint { time: number; rate: number }

export interface ParamPlan {
  /** Value assigned to `.value` when the node is created (before any event) */
  initial: number
  events: ParamEvent[]
}

export interface TransitionSchedule {
  t0: number
  /** ctx time when FROM is fully gone (== t0 for cuts) */
  overlapEnd: number
  /** ctx time after which TO plays alone, at rate 1, unfiltered: safe to hand back */
  settledAt: number
  /** TO's and FROM's speeds during the overlap */
  rate: number
  rateFrom: number
  pitch: PitchMode
  from: { startAt: number; offset: number; stopAt: number; startPos: number }
  to: { startAt: number; offset: number; startPos: number }
  /** Tempo envelopes: what each song's position follows (see positionAt) */
  toRate: RatePoint[]
  fromRate: RatePoint[]
  /** ctx time FROM starts changing speed (Infinity if it never does) */
  fromRampStart: number
  /** What to put on each source's playbackRate: the envelope, or nothing when the buffer is pre-stretched */
  toPlaybackRate: RatePoint[]
  fromPlaybackRate: RatePoint[]
  /** Media element fade during the element→buffer swap; empty when there is no swap */
  elementGain: ParamEvent[]
  fromGain: ParamPlan
  toGain: ParamPlan
  bassSwap: null | { shelfHz: number; from: ParamPlan; to: ParamPlan }
  filter: null | { target: 'from' | 'to'; kind: 'highpass' | 'lowpass'; frequency: ParamPlan }
  echo: null | { delay: number; feedback: number; send: ParamPlan; wet: ParamPlan }
}

export interface ScheduleOptions {
  /** ctx time at which FROM's exitAt is heard */
  t0: number
  /** FROM's buffer starts this many seconds before t0 */
  leadIn: number
  /** File position of sample 0 of the FROM / TO buffers (they may be windows of the file) */
  fromWindowStart: number
  toWindowStart: number
  /** Duration of the media element → FROM buffer gain swap. Omit when no element is playing (preview). */
  swapIn?: number
  /** Seconds to ramp TO's playbackRate back to 1 after the overlap */
  rateRamp?: number
  /** Used to pick a neutral lowpass frequency (Nyquist) */
  sampleRate?: number
  /**
   * Buffers already time-stretched to follow the envelope ('keep' pitch): they start at
   * their first sample (FROM at from.startAt, TO at t0) and play at rate 1.
   */
  prerendered?: { from?: boolean; to?: boolean }
}

/** The parts of a Transition that affect how it sounds */
export type TransitionTiming = Pick<Transition,
  'type' | 'exitAt' | 'entryAt' | 'overlap' | 'fadeOut' | 'fadeIn' | 'fadeOutPoints' | 'fadeInPoints'
  | 'bassSwap' | 'filter' | 'echo' | 'rateTo' | 'rateFrom' | 'pitch' | 'rampBack'>

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clampRate(rate: number | undefined): number {
  if (rate === undefined || !isFinite(rate) || rate <= 0) return 1
  return clamp(rate, 1 - MAX_RATE_DEVIATION, 1 + MAX_RATE_DEVIATION)
}

/** How much faster TO plays than FROM during the overlap (1 = no tempo change) */
export function rateRatio(t: Pick<Transition, 'rateTo' | 'rateFrom'>): number {
  return clampRate(t.rateTo) / clampRate(t.rateFrom)
}

/**
 * Split a tempo match (TO's speed relative to FROM's, as rateRatio) between the songs:
 * 'to' changes only TO, 'from' only FROM, 'meet' moves both halfway (geometrically).
 */
export function splitRates(ratio: number, mode: StretchMode): Pick<Transition, 'rateTo' | 'rateFrom'> {
  // Each song may change speed by up to MAX_RATE_DEVIATION, so the gap they can close
  // depends on how it's shared: meeting in the middle reaches about twice as far
  const { min, max } = ratioRange(mode)
  const r = isFinite(ratio) && ratio > 0 ? Math.min(max, Math.max(min, ratio)) : 1
  if (Math.abs(r - 1) < 1e-6) return { rateTo: undefined, rateFrom: undefined }
  if (mode === 'from') return { rateTo: undefined, rateFrom: 1 / r }
  if (mode === 'meet') { const h = Math.sqrt(r); return { rateTo: h, rateFrom: 1 / h } }
  return { rateTo: r, rateFrom: undefined }
}

/** The tempo ratios (TO's speed over FROM's) a stretch mode can match, each song within MAX_RATE_DEVIATION */
export function ratioRange(mode: StretchMode): { min: number; max: number } {
  const lo = 1 - MAX_RATE_DEVIATION, hi = 1 + MAX_RATE_DEVIATION
  if (mode === 'from') return { min: 1 / hi, max: 1 / lo }
  // rateTo = h and rateFrom = 1/h must both stay in range: h from 1/hi to hi
  if (mode === 'meet') return { min: 1 / (hi * hi), max: hi * hi }
  return { min: lo, max: hi }
}

/** Whether `mode` can match a tempo ratio without either song going past its limit */
export function tempoFits(ratio: number, mode: StretchMode): boolean {
  const { min, max } = ratioRange(mode)
  return ratio >= min - 1e-9 && ratio <= max + 1e-9
}

/** When Match tempo / suggestions switch an incoming-song match to 'meet' (a user setting) */
export type AutoMeet = 'never' | 'above' | 'always'

/**
 * The stretch mode to use for a tempo match of `ratio`. Only the default 'to' is ever
 * changed: a deliberate 'meet' or 'from' choice is kept. With 'above', 'meet' kicks in
 * once the incoming song alone would have to change speed by more than `threshold`.
 */
export function autoStretchMode(ratio: number, current: StretchMode, rule: AutoMeet, threshold: number): StretchMode {
  if (current !== 'to' || rule === 'never') return current
  const change = Math.abs(clampRate(ratio) - 1)
  if (change < 1e-6) return current
  return rule === 'always' || change > threshold + 1e-9 ? 'meet' : current
}

/** Missing means 'vinyl': transitions saved before stretching existed must sound the same */
export function pitchOf(t: Pick<Transition, 'pitch'>): PitchMode {
  return t.pitch ?? 'vinyl'
}

export function rampBackOf(t: Pick<Transition, 'rampBack'>): number {
  const r = t.rampBack
  return r !== undefined && isFinite(r) ? clamp(r, 0.5, 60) : DEFAULT_RATE_RAMP
}

/**
 * Seconds FROM takes to reach its overlap speed before the exit (0 when it doesn't change).
 * Shortened near the start of the file so FROM's buffer (which starts a little before the
 * ramp) never has to start before position 0.
 */
export function fromRampIn(t: Pick<Transition, 'type' | 'overlap' | 'exitAt' | 'rateFrom' | 'rampBack'>): number {
  const rateFrom = clampRate(t.rateFrom)
  if (effectiveOverlap(t) === 0 || rateFrom === 1) return 0
  const room = Math.max(0, (t.exitAt - FROM_RAMP_HEADROOM) * 2 / (1 + rateFrom))
  return Math.min(rampBackOf(t), MAX_FROM_RAMP, room)
}

/**
 * Events for an equal-power swap between two sides that carry the same music but not the
 * same waveform (a time-stretched buffer against the original), made of linear segments
 * so the param stays safe to cancel and re-automate.
 */
export function equalPowerEvents(start: number, dur: number, rising: boolean, from = rising ? 0 : 1, to = rising ? 1 : 0): ParamEvent[] {
  const n = 8
  const events: ParamEvent[] = [{ type: 'set', time: start, value: from }]
  for (let k = 1; k <= n; k++) {
    const x = k / n
    const shape = rising ? Math.sin(x * Math.PI / 2) : 1 - Math.cos(x * Math.PI / 2)
    events.push({ type: 'linear', time: start + x * dur, value: from + (to - from) * shape })
  }
  return events
}

/** The overlap actually used: 0 for cuts, and blends shorter than MIN_OVERLAP become cuts. */
export function effectiveOverlap(t: Pick<Transition, 'type' | 'overlap'>): number {
  if (t.type === 'cut' || !(t.overlap >= MIN_OVERLAP)) return 0
  return t.overlap
}

/**
 * Gain curve for a fade. 'in' rises 0→1, 'out' falls 1→0 (mirror image of 'in').
 * 'none' stays at full volume and only drops (or rises) in the last (first) of the
 * `points` steps, which at 256 points over a typical overlap is a click-free ~30 ms.
 * 'custom' is piecewise linear through `vertices` between the fixed end points.
 */
export function fadeCurve(preset: CurvePreset, direction: 'in' | 'out', points = 256, vertices?: FadePoint[]): Float32Array {
  const out = new Float32Array(points)
  if (preset === 'custom') {
    const knots = fadeKnots(direction, vertices)
    for (let i = 0; i < points; i++) out[i] = evalKnots(knots, i / (points - 1))
    return out
  }
  const shape = (x: number) => {
    switch (preset) {
      case 'equal-power': return Math.sin(x * Math.PI / 2)
      case 's-curve': return x * x * (3 - 2 * x)
      case 'none': return x > 0 ? 1 : 0
      default: return x
    }
  }
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1)
    out[i] = shape(direction === 'in' ? x : 1 - x)
  }
  return out
}

/** The fade-out (FROM) or fade-in (TO) curve of a transition, honouring custom points. */
export function transitionFade(t: Pick<Transition, 'fadeOut' | 'fadeIn' | 'fadeOutPoints' | 'fadeInPoints'>, direction: 'in' | 'out', points = 256): Float32Array {
  return direction === 'out'
    ? fadeCurve(t.fadeOut, 'out', points, t.fadeOutPoints)
    : fadeCurve(t.fadeIn, 'in', points, t.fadeInPoints)
}

/** All knots of a custom fade, fixed ends included, sorted and clamped. */
export function fadeKnots(direction: 'in' | 'out', vertices: FadePoint[] = []): FadePoint[] {
  const inner = vertices
    .filter(p => isFinite(p.x) && isFinite(p.y) && p.x > 0 && p.x < 1)
    .map(p => ({ x: p.x, y: clamp(p.y, 0, 1) }))
    .sort((a, b) => a.x - b.x)
  return direction === 'out'
    ? [{ x: 0, y: 1 }, ...inner, { x: 1, y: 0 }]
    : [{ x: 0, y: 0 }, ...inner, { x: 1, y: 1 }]
}

function evalKnots(knots: FadePoint[], x: number): number {
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1]
    if (x <= b.x) return b.x === a.x ? b.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)
  }
  return knots[knots.length - 1].y
}

/** Interior vertices that approximate a preset, to start a custom fade from what was there. */
export function presetVertices(preset: CurvePreset, direction: 'in' | 'out', count = 3): FadePoint[] {
  if (preset === 'custom' || preset === 'linear') return [{ x: 0.5, y: 0.5 }]
  const curve = fadeCurve(preset, direction, 1025)
  const pts: FadePoint[] = []
  for (let i = 1; i <= count; i++) {
    const x = i / (count + 1)
    pts.push({ x, y: curve[Math.round(x * 1024)] })
  }
  return pts
}

// ── Playback-rate integration ───────────────────────────────────────────────

export function rateAt(points: RatePoint[], time: number): number {
  if (points.length === 0) return 1
  if (time <= points[0].time) return points[0].rate
  const last = points[points.length - 1]
  if (time >= last.time) return last.rate
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    if (time >= a.time && time < b.time) {
      if (b.time === a.time) return b.rate
      return a.rate + (b.rate - a.rate) * (time - a.time) / (b.time - a.time)
    }
  }
  return last.rate
}

/** Knots strictly between a and b, plus the ends: the rate is linear on each interval. */
function knots(points: RatePoint[], a: number, b: number): number[] {
  const ts = [a]
  for (const p of points) if (p.time > a && p.time < b) ts.push(p.time)
  ts.push(b)
  return ts
}

/** ∫ rate dt from a to b (negative when b < a). The rate is linear between knots, so this is exact. */
export function envelopeIntegral(points: RatePoint[], a: number, b: number): number {
  if (b < a) return -envelopeIntegral(points, b, a)
  const ts = knots(points, a, b)
  let sum = 0
  for (let i = 0; i < ts.length - 1; i++) {
    sum += (rateAt(points, ts[i]) + rateAt(points, ts[i + 1])) / 2 * (ts[i + 1] - ts[i])
  }
  return sum
}

/**
 * File position at `time` of a source whose position is `startPos` at `startAt` and whose
 * speed follows `points` (in either direction, so a ramp before `startAt` is integrated too).
 */
export function positionAt(startAt: number, startPos: number, points: RatePoint[], time: number): number {
  return startPos + envelopeIntegral(points, startAt, time)
}

/** Inverse of positionAt: the ctx time at which file position `pos` is heard. */
export function timeAtPosition(startAt: number, startPos: number, points: RatePoint[], pos: number): number {
  let need = pos - startPos
  if (need === 0) return startAt
  if (need < 0) return timeBefore(startAt, points, -need)
  const lastKnot = points.length ? Math.max(startAt, points[points.length - 1].time) : startAt
  const ts = knots(points, startAt, lastKnot)
  for (let i = 0; i < ts.length - 1; i++) {
    const a = ts[i], b = ts[i + 1]
    if (b <= a) continue
    const ra = rateAt(points, a), rb = rateAt(points, b)
    const area = (ra + rb) / 2 * (b - a)
    if (area >= need) {
      const k = (rb - ra) / (b - a)
      if (Math.abs(k) < 1e-12) return a + need / ra
      // ra·x + k·x²/2 = need
      return a + (-ra + Math.sqrt(ra * ra + 2 * k * need)) / k
    }
    need -= area
  }
  return lastKnot + need / rateAt(points, lastKnot)
}

/** The time before `end` at which `need` seconds of position remain to be played until `end`. */
function timeBefore(end: number, points: RatePoint[], need: number): number {
  const firstKnot = points.length ? Math.min(end, points[0].time) : end
  const ts = knots(points, firstKnot, end)
  for (let i = ts.length - 1; i > 0; i--) {
    const a = ts[i - 1], b = ts[i]
    if (b <= a) continue
    const ra = rateAt(points, a), rb = rateAt(points, b)
    const area = (ra + rb) / 2 * (b - a)
    if (area >= need) {
      const k = (rb - ra) / (b - a)
      if (Math.abs(k) < 1e-12) return b - need / rb
      // rb·y − k·y²/2 = need, with y = b − t
      return b - (rb - Math.sqrt(Math.max(0, rb * rb - 2 * k * need))) / k
    }
    need -= area
  }
  return firstKnot - need / rateAt(points, firstKnot)
}

/** Replace the envelope from `time` on with a ramp from the current rate to 1 over `ramp` seconds. */
export function rampRateToUnity(points: RatePoint[], time: number, ramp: number): RatePoint[] {
  const current = rateAt(points, time)
  const kept = points.filter(p => p.time < time)
  return [...kept, { time, rate: current }, { time: time + ramp, rate: 1 }]
}

// ── Schedule ────────────────────────────────────────────────────────────────

export function buildSchedule(t: TransitionTiming, opts: ScheduleOptions): TransitionSchedule {
  const { t0 } = opts
  const overlap = effectiveOverlap(t)
  const kind: Transition['type'] = overlap === 0 ? 'cut' : t.type
  const overlapEnd = t0 + overlap
  const rate = kind === 'cut' ? 1 : clampRate(t.rateTo)
  const rateFrom = kind === 'cut' ? 1 : clampRate(t.rateFrom)
  const rateRamp = opts.rateRamp ?? rampBackOf(t)
  const nyquist = (opts.sampleRate ?? 44100) / 2
  const pre = opts.prerendered ?? {}

  // FROM eases into its overlap speed over the ramp before t0, then holds it
  const rampIn = rateFrom === 1 ? 0 : fromRampIn(t)
  const fromRate: RatePoint[] = rateFrom === 1 ? [] : [{ time: t0 - rampIn, rate: 1 }, { time: t0, rate: rateFrom }]

  // FROM starts leadIn before t0; if that is before the file start, start later at offset 0
  let fromStartAt = t0 - Math.max(0, opts.leadIn)
  let fromStartPos = positionAt(t0, t.exitAt, fromRate, fromStartAt)
  if (fromStartPos < 0) { fromStartAt = timeAtPosition(t0, t.exitAt, fromRate, 0); fromStartPos = 0 }
  const fromOffset = pre.from ? 0 : fromStartPos - opts.fromWindowStart
  if (fromOffset < -1e-9) throw new Error('FROM window starts after the FROM buffer start position')

  const toOffset = pre.to ? 0 : t.entryAt - opts.toWindowStart
  if (toOffset < -1e-9) throw new Error('TO window starts after entryAt')

  // The swap has to finish before anything else is automated on the FROM gain
  if (opts.swapIn !== undefined && t0 - fromStartAt < 0.002) throw new Error('leadIn too short for an element swap')
  const swapIn = opts.swapIn === undefined ? undefined : Math.min(opts.swapIn, (t0 - fromStartAt) / 2)

  const elementGain: ParamEvent[] = []
  const fromGain: ParamPlan = { initial: swapIn === undefined ? 1 : 0, events: [] }
  if (swapIn !== undefined && pre.from) {
    // A stretched FROM matches the element in time but not sample for sample: keep the power steady
    elementGain.push(...equalPowerEvents(fromStartAt, swapIn, false))
    fromGain.events.push(...equalPowerEvents(fromStartAt, swapIn, true))
  } else if (swapIn !== undefined) {
    elementGain.push({ type: 'set', time: fromStartAt, value: 1 }, { type: 'linear', time: fromStartAt + swapIn, value: 0 })
    // FROM buffer and element carry the same audio, so a linear (amplitude-preserving) swap is right
    fromGain.events.push({ type: 'set', time: fromStartAt, value: 0 }, { type: 'linear', time: fromStartAt + swapIn, value: 1 })
  }

  const toGain: ParamPlan = { initial: 0, events: [] }
  let fromStopAt: number

  if (kind === 'cut') {
    fromGain.events.push({ type: 'set', time: t0 - CUT_DECLICK, value: 1 }, { type: 'linear', time: t0, value: 0 })
    toGain.events.push({ type: 'set', time: t0, value: 0 }, { type: 'linear', time: t0 + CUT_DECLICK, value: 1 })
    fromStopAt = t0 + 0.05
  } else if (kind === 'echo-out') {
    fromGain.events.push({ type: 'set', time: t0, value: 1 }, { type: 'linear', time: t0 + ECHO_DRY_CUT, value: 0 })
    toGain.events.push({ type: 'curve', time: t0, duration: overlap, values: transitionFade(t, 'in') })
    fromStopAt = t0 + ECHO_DRY_CUT + 0.05
  } else {
    fromGain.events.push({ type: 'curve', time: t0, duration: overlap, values: transitionFade(t, 'out') })
    toGain.events.push({ type: 'curve', time: t0, duration: overlap, values: transitionFade(t, 'in') })
    fromStopAt = overlapEnd + 0.05
  }

  let bassSwap: TransitionSchedule['bassSwap'] = null
  if (t.bassSwap && kind !== 'cut') {
    const ts = t0 + clamp(t.bassSwap.at, 0, overlap)
    bassSwap = {
      shelfHz: BASS_SHELF_HZ,
      from: { initial: 0, events: [{ type: 'set', time: ts - BASS_SWAP_RAMP, value: 0 }, { type: 'linear', time: ts, value: BASS_CUT_DB }] },
      to: { initial: BASS_CUT_DB, events: [{ type: 'set', time: ts - BASS_SWAP_RAMP, value: BASS_CUT_DB }, { type: 'linear', time: ts, value: 0 }] },
    }
  }

  let filter: TransitionSchedule['filter'] = null
  let filterSettled = 0
  if (t.filter && kind !== 'cut') {
    const { target, kind: fKind } = t.filter
    const neutral = fKind === 'highpass' ? 10 : Math.min(20000, nyquist)
    const startHz = clamp(t.filter.startHz, 10, nyquist)
    const endHz = clamp(t.filter.endHz, 10, nyquist)
    const events: ParamEvent[] = [
      { type: 'set', time: t0, value: startHz },
      { type: 'exponential', time: overlapEnd, value: endHz },
    ]
    if (target === 'to') {
      // TO keeps playing after the overlap, so open the filter before handing back
      events.push({ type: 'exponential', time: overlapEnd + FILTER_RELEASE, value: neutral })
      filterSettled = overlapEnd + FILTER_RELEASE
    }
    filter = { target, kind: fKind, frequency: { initial: target === 'from' ? neutral : startHz, events } }
  }

  let echo: TransitionSchedule['echo'] = null
  if (kind === 'echo-out') {
    const delay = clamp(t.echo?.delay ?? DEFAULT_ECHO.delay, 0.05, 2)
    const feedback = clamp(t.echo?.feedback ?? DEFAULT_ECHO.feedback, 0, 0.9)
    // Open the send about one echo before the cut so the last beat gets repeated
    const sendOpen = Math.min(t0, Math.max(fromStartAt, t0 - delay))
    const openEnd = Math.min(sendOpen + 0.01, t0)
    const send: ParamEvent[] = [
      { type: 'set', time: sendOpen, value: 0 },
      { type: 'linear', time: openEnd, value: 1 },
    ]
    if (t0 > openEnd) send.push({ type: 'set', time: t0, value: 1 })
    send.push({ type: 'linear', time: t0 + ECHO_DRY_CUT, value: 0 })
    echo = {
      delay,
      feedback,
      send: { initial: 0, events: send },
      wet: { initial: 1, events: [{ type: 'curve', time: t0, duration: overlap, values: transitionFade(t, 'out') }] },
    }
  }

  const toRate: RatePoint[] = rate === 1 ? [] : [
    { time: t0, rate },
    { time: overlapEnd, rate },
    { time: overlapEnd + rateRamp, rate: 1 },
  ]

  const settledAt = Math.max(
    overlapEnd,
    rate === 1 ? 0 : overlapEnd + rateRamp,
    filterSettled,
  ) + 0.05

  return {
    t0,
    overlapEnd,
    settledAt,
    rate,
    rateFrom,
    pitch: pitchOf(t),
    from: { startAt: fromStartAt, offset: fromOffset, stopAt: fromStopAt, startPos: fromStartPos },
    to: { startAt: t0, offset: toOffset, startPos: t.entryAt },
    toRate,
    fromRate,
    fromRampStart: rampIn > 0 ? t0 - rampIn : Infinity,
    toPlaybackRate: pre.to ? [] : toRate,
    fromPlaybackRate: pre.from ? [] : fromRate,
    elementGain,
    fromGain,
    toGain,
    bassSwap,
    filter,
    echo,
  }
}

export function fromPositionAt(exitAt: number, s: Pick<TransitionSchedule, 't0' | 'fromRate'>, time: number): number {
  return positionAt(s.t0, exitAt, s.fromRate, time)
}

export function fromTimeAt(exitAt: number, s: Pick<TransitionSchedule, 't0' | 'fromRate'>, pos: number): number {
  return timeAtPosition(s.t0, exitAt, s.fromRate, pos)
}

export function toPositionAt(s: Pick<TransitionSchedule, 'to' | 'toRate'>, time: number): number {
  return positionAt(s.to.startAt, s.to.startPos, s.toRate, time)
}

export function toTimeAt(s: Pick<TransitionSchedule, 'to' | 'toRate'>, pos: number): number {
  return timeAtPosition(s.to.startAt, s.to.startPos, s.toRate, pos)
}

/**
 * Value of a plan at `time`, following Web Audio semantics for set / linear / exponential
 * events. Returns NaN while a value curve is involved (callers only use it on curve-free params).
 */
export function planValueAt(plan: ParamPlan, time: number): number {
  let value = plan.initial
  let prevTime = -Infinity
  for (const e of plan.events) {
    if (e.type === 'curve') return NaN
    if (e.time <= time) { value = e.value; prevTime = e.time; continue }
    if (e.type === 'set') break
    // A ramp ending after `time` is in progress from the previous event
    const start = Number.isFinite(prevTime) ? prevTime : time
    const x = e.time > start ? (time - start) / (e.time - start) : 1
    if (e.type === 'linear') return value + (e.value - value) * x
    return value > 0 && e.value > 0 ? value * Math.pow(e.value / value, x) : value
  }
  return value
}

/** Apply a list of events to an AudioParam. Works with any BaseAudioContext. */
export function applyParamEvents(param: AudioParam, events: ParamEvent[]) {
  for (const e of events) {
    // Browsers throw on negative times; anything that early is simply "already happened"
    const time = Math.max(0, e.time)
    switch (e.type) {
      case 'set': param.setValueAtTime(e.value, time); break
      case 'linear': param.linearRampToValueAtTime(e.value, time); break
      case 'exponential': param.exponentialRampToValueAtTime(Math.max(1e-4, e.value), time); break
      case 'curve': param.setValueCurveAtTime(e.values, time, e.duration); break
    }
  }
}

export function applyParamPlan(param: AudioParam, plan: ParamPlan) {
  param.value = plan.initial
  applyParamEvents(param, plan.events)
}

/** Apply a rate envelope (the same breakpoints positionAt integrates) to a playbackRate param. */
export function applyRatePoints(param: AudioParam, points: RatePoint[]) {
  if (points.length === 0) { param.value = 1; return }
  param.value = points[0].rate
  param.setValueAtTime(points[0].rate, Math.max(0, points[0].time))
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (p.rate === points[i - 1].rate) param.setValueAtTime(p.rate, Math.max(0, p.time))
    else param.linearRampToValueAtTime(p.rate, Math.max(0, p.time))
  }
}

// ── Starting part-way through (editor preview seeking) ──────────────────────

/** Value of a value curve at fraction `f` (0–1) of its duration, as Web Audio interpolates it */
function curveValueAt(values: Float32Array, f: number): number {
  const x = Math.min(1, Math.max(0, f)) * (values.length - 1)
  const i = Math.min(values.length - 2, Math.floor(x))
  return i < 0 ? values[0] : values[i] + (values[i + 1] - values[i]) * (x - i)
}

/**
 * The same automation, starting at `at`: everything before collapses into the value at `at`.
 * Needed because browsers clamp events scheduled in the past to "now", which would restart a
 * fade instead of joining it midway. A value curve in progress continues as straight ramps
 * between its remaining points, which is exactly how Web Audio interpolates a curve.
 */
export function cuePlan(plan: ParamPlan, at: number): ParamPlan {
  let value = plan.initial
  let prevTime = -Infinity
  let i = 0
  const rest: ParamEvent[] = []
  for (; i < plan.events.length; i++) {
    const e = plan.events[i]
    if (e.type === 'curve') {
      const end = e.time + e.duration
      if (end <= at) { value = e.values[e.values.length - 1]; prevTime = end; continue }
      if (e.time < at) {
        const n = e.values.length
        const step = e.duration / (n - 1)
        value = curveValueAt(e.values, (at - e.time) / e.duration)
        for (let j = Math.floor((at - e.time) / step) + 1; j < n; j++) {
          rest.push({ type: 'linear', time: e.time + j * step, value: e.values[j] })
        }
        i++
      }
      break
    }
    if (e.time <= at) { value = e.value; prevTime = e.time; continue }
    // A ramp in progress at `at`: restart it from its current value (same line / curve)
    if (e.type !== 'set') {
      const start = Number.isFinite(prevTime) ? prevTime : at
      const x = e.time > start ? (at - start) / (e.time - start) : 1
      if (e.type === 'linear') value = value + (e.value - value) * x
      else if (value > 0 && e.value > 0) value = value * Math.pow(e.value / value, x)
    }
    break
  }
  return { initial: value, events: [{ type: 'set', time: at, value }, ...rest, ...plan.events.slice(i)] }
}

/** A rate envelope that starts at `at` with the rate it has there */
export function cueRatePoints(points: RatePoint[], at: number): RatePoint[] {
  if (!points.length) return points
  return [{ time: at, rate: rateAt(points, at) }, ...points.filter(p => p.time > at)]
}

/**
 * The schedule as heard from ctx time `at` on: sources that would have started earlier start
 * at `at`, already advanced (following their playbackRate), and all automation joins in where
 * it would be. Positions (toPositionAt, fromPositionAt) are unchanged.
 */
export function cueSchedule(s: TransitionSchedule, at: number): TransitionSchedule {
  const cueP = (p: ParamPlan) => cuePlan(p, at)
  let from = s.from
  if (at >= s.from.stopAt) {
    from = { ...s.from, startAt: at, stopAt: at, offset: 0 }
  } else if (s.from.startAt < at) {
    from = {
      ...s.from,
      startAt: at,
      offset: s.from.offset + envelopeIntegral(s.fromPlaybackRate, s.from.startAt, at),
      startPos: positionAt(s.from.startAt, s.from.startPos, s.fromRate, at),
    }
  }
  let to = s.to
  if (s.to.startAt < at) {
    to = {
      startAt: at,
      offset: s.to.offset + envelopeIntegral(s.toPlaybackRate, s.to.startAt, at),
      startPos: positionAt(s.to.startAt, s.to.startPos, s.toRate, at),
    }
  }
  return {
    ...s,
    from,
    to,
    toPlaybackRate: cueRatePoints(s.toPlaybackRate, at),
    fromPlaybackRate: cueRatePoints(s.fromPlaybackRate, at),
    elementGain: [],
    fromGain: cueP(s.fromGain),
    toGain: cueP(s.toGain),
    bassSwap: s.bassSwap && { ...s.bassSwap, from: cueP(s.bassSwap.from), to: cueP(s.bassSwap.to) },
    filter: s.filter && { ...s.filter, frequency: cueP(s.filter.frequency) },
    echo: s.echo && { ...s.echo, send: cueP(s.echo.send), wet: cueP(s.echo.wet) },
  }
}
