/**
 * Builds the Web Audio node graph for one transition from a TransitionSchedule.
 * Shared by live playback, the editor preview and the offline render tests,
 * so all three hear exactly the same thing.
 *
 *   FROM: source → [low-shelf] → [filter] → fromGain ─────────────────┐
 *                                   └→ send → delay ⇄ feedback → wet ─┴→ fromOut → outFrom
 *   TO:   source → [low-shelf] → [filter] → toGain → toCurveTrim ─────┐
 *                                   └→ toDirect (0) ──────────────────┴→ toOut → outTo
 *
 * The schedule's value curves live on fromGain / toGain / wet. Anything that
 * interrupts a transition (back out, skip ahead, handback) only automates the
 * curve-free stages (fromOut, toOut, toCurveTrim, toDirect): browsers handle
 * cancelling an in-progress value curve poorly (Chromium leaves a small step).
 */
import { applyParamPlan, applyRatePoints, type TransitionSchedule } from './schedule'

export interface TransitionGraph {
  fromSource: AudioBufferSourceNode
  toSource: AudioBufferSourceNode
  fromOut: GainNode
  toOut: GainNode
  /** Crossfading toCurveTrim 1→0 against toDirect 0→1 takes TO to full level mid-fade-in */
  toCurveTrim: GainNode
  toDirect: GainNode
  toShelf: BiquadFilterNode | null
  toFilter: BiquadFilterNode | null
  /** Stop both sources (at ctx time `when`, default now) and disconnect everything shortly after */
  dispose(when?: number): void
}

export function buildTransitionGraph(
  ctx: BaseAudioContext,
  buffers: { from: AudioBuffer; to: AudioBuffer },
  s: TransitionSchedule,
  outFrom: AudioNode,
  outTo: AudioNode = outFrom,
): TransitionGraph {
  const all: AudioNode[] = []
  const track = <T extends AudioNode>(n: T): T => { all.push(n); return n }

  // ── FROM chain ──
  const fromSource = track(ctx.createBufferSource())
  fromSource.buffer = buffers.from
  applyRatePoints(fromSource.playbackRate, s.fromPlaybackRate)
  let fromTail: AudioNode = fromSource

  if (s.bassSwap) {
    const shelf = track(ctx.createBiquadFilter())
    shelf.type = 'lowshelf'
    shelf.frequency.value = s.bassSwap.shelfHz
    applyParamPlan(shelf.gain, s.bassSwap.from)
    fromTail.connect(shelf)
    fromTail = shelf
  }
  if (s.filter?.target === 'from') {
    const f = track(ctx.createBiquadFilter())
    f.type = s.filter.kind
    f.Q.value = Math.SQRT1_2
    applyParamPlan(f.frequency, s.filter.frequency)
    fromTail.connect(f)
    fromTail = f
  }

  const fromOut = track(ctx.createGain())
  fromOut.connect(outFrom)
  const fromGain = track(ctx.createGain())
  applyParamPlan(fromGain.gain, s.fromGain)
  fromTail.connect(fromGain)
  fromGain.connect(fromOut)

  if (s.echo) {
    const send = track(ctx.createGain())
    const delay = track(ctx.createDelay(2))
    const feedback = track(ctx.createGain())
    const wet = track(ctx.createGain())
    applyParamPlan(send.gain, s.echo.send)
    delay.delayTime.value = s.echo.delay
    feedback.gain.value = s.echo.feedback
    applyParamPlan(wet.gain, s.echo.wet)
    fromTail.connect(send)
    send.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    delay.connect(wet)
    wet.connect(fromOut)
  }

  // ── TO chain ──
  const toSource = track(ctx.createBufferSource())
  toSource.buffer = buffers.to
  applyRatePoints(toSource.playbackRate, s.toPlaybackRate)
  let toTail: AudioNode = toSource

  let toShelf: BiquadFilterNode | null = null
  if (s.bassSwap) {
    toShelf = track(ctx.createBiquadFilter())
    toShelf.type = 'lowshelf'
    toShelf.frequency.value = s.bassSwap.shelfHz
    applyParamPlan(toShelf.gain, s.bassSwap.to)
    toTail.connect(toShelf)
    toTail = toShelf
  }
  let toFilter: BiquadFilterNode | null = null
  if (s.filter?.target === 'to') {
    toFilter = track(ctx.createBiquadFilter())
    toFilter.type = s.filter.kind
    toFilter.Q.value = Math.SQRT1_2
    applyParamPlan(toFilter.frequency, s.filter.frequency)
    toTail.connect(toFilter)
    toTail = toFilter
  }

  const toOut = track(ctx.createGain())
  toOut.connect(outTo)
  const toGain = track(ctx.createGain())
  applyParamPlan(toGain.gain, s.toGain)
  const toCurveTrim = track(ctx.createGain())
  const toDirect = track(ctx.createGain())
  toDirect.gain.value = 0
  toTail.connect(toGain)
  toGain.connect(toCurveTrim)
  toCurveTrim.connect(toOut)
  toTail.connect(toDirect)
  toDirect.connect(toOut)

  // Browsers reject negative start times; the schedule never produces them for live use
  fromSource.start(Math.max(0, s.from.startAt), Math.max(0, s.from.offset))
  fromSource.stop(Math.max(0, s.from.stopAt))
  toSource.start(Math.max(0, s.to.startAt), Math.max(0, s.to.offset))

  let disposed = false
  function dispose(when?: number) {
    if (disposed) return
    disposed = true
    const at = Math.max(when ?? 0, ctx.currentTime)
    for (const src of [fromSource, toSource]) {
      try { src.stop(at) } catch { /* already stopped */ }
    }
    const disconnectAll = () => { for (const n of all) { try { n.disconnect() } catch { /* ignore */ } } }
    setTimeout(disconnectAll, Math.max(0, (at - ctx.currentTime) * 1000) + 50)
  }

  return { fromSource, toSource, fromOut, toOut, toCurveTrim, toDirect, toShelf, toFilter, dispose }
}
