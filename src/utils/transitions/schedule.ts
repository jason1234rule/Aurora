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
import type { CurvePreset, FadePoint, Transition } from '@/types/transition'

export const MAX_RATE_DEVIATION = 0.03
export const MIN_OVERLAP = 0.05
export const CUT_DECLICK = 0.005
export const ECHO_DRY_CUT = 0.03
export const BASS_SHELF_HZ = 200
export const BASS_CUT_DB = -40
export const BASS_SWAP_RAMP = 0.02
export const FILTER_RELEASE = 1.0
export const DEFAULT_RATE_RAMP = 2.0
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
  rate: number
  from: { startAt: number; offset: number; stopAt: number }
  to: { startAt: number; offset: number; startPos: number }
  toRate: RatePoint[]
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
}

/** The parts of a Transition that affect how it sounds */
export type TransitionTiming = Pick<Transition,
  'type' | 'exitAt' | 'entryAt' | 'overlap' | 'fadeOut' | 'fadeIn' | 'fadeOutPoints' | 'fadeInPoints'
  | 'bassSwap' | 'filter' | 'echo' | 'rateTo'>

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clampRate(rate: number | undefined): number {
  if (rate === undefined || !isFinite(rate) || rate <= 0) return 1
  return clamp(rate, 1 - MAX_RATE_DEVIATION, 1 + MAX_RATE_DEVIATION)
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

/**
 * File position at `time` of a source started at `startAt` from file position `startPos`
 * whose playbackRate follows `points`. Before `startAt` this extrapolates backwards.
 */
export function positionAt(startAt: number, startPos: number, points: RatePoint[], time: number): number {
  if (time <= startAt) return startPos - (startAt - time) * rateAt(points, startAt)
  const ts = knots(points, startAt, time)
  let pos = startPos
  for (let i = 0; i < ts.length - 1; i++) {
    pos += (rateAt(points, ts[i]) + rateAt(points, ts[i + 1])) / 2 * (ts[i + 1] - ts[i])
  }
  return pos
}

/** Inverse of positionAt: the ctx time at which file position `pos` is heard. */
export function timeAtPosition(startAt: number, startPos: number, points: RatePoint[], pos: number): number {
  let need = pos - startPos
  if (need <= 0) return startAt + need / rateAt(points, startAt)
  const lastKnot = points.length ? Math.max(startAt, points[points.length - 1].time) : startAt
  const ts = knots(points, startAt, lastKnot)
  for (let i = 0; i < ts.length - 1; i++) {
    const a = ts[i], b = ts[i + 1]
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
  const rateRamp = opts.rateRamp ?? DEFAULT_RATE_RAMP
  const nyquist = (opts.sampleRate ?? 44100) / 2

  // FROM starts leadIn before t0; if that is before the file start, start later at offset 0
  let fromStartAt = t0 - Math.max(0, opts.leadIn)
  let fromStartPos = t.exitAt - (t0 - fromStartAt)
  if (fromStartPos < 0) { fromStartAt -= fromStartPos; fromStartPos = 0 }
  const fromOffset = fromStartPos - opts.fromWindowStart
  if (fromOffset < -1e-9) throw new Error('FROM window starts after the FROM buffer start position')

  const toOffset = t.entryAt - opts.toWindowStart
  if (toOffset < -1e-9) throw new Error('TO window starts after entryAt')

  // The swap has to finish before anything else is automated on the FROM gain
  if (opts.swapIn !== undefined && t0 - fromStartAt < 0.002) throw new Error('leadIn too short for an element swap')
  const swapIn = opts.swapIn === undefined ? undefined : Math.min(opts.swapIn, (t0 - fromStartAt) / 2)

  const elementGain: ParamEvent[] = []
  const fromGain: ParamPlan = { initial: swapIn === undefined ? 1 : 0, events: [] }
  if (swapIn !== undefined) {
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
    from: { startAt: fromStartAt, offset: fromOffset, stopAt: fromStopAt },
    to: { startAt: t0, offset: toOffset, startPos: t.entryAt },
    toRate,
    elementGain,
    fromGain,
    toGain,
    bassSwap,
    filter,
    echo,
  }
}

export function fromPositionAt(exitAt: number, s: Pick<TransitionSchedule, 't0'>, time: number): number {
  return exitAt + (time - s.t0)
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
