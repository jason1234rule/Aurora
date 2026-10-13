/**
 * Offline render tests: build the real transition graph in node-web-audio-api's
 * OfflineAudioContext and measure what comes out. FROM is routed to the left
 * channel and TO to the right, so click alignment can be measured per side.
 */
import { describe, it, expect } from 'vitest'
import { buildSchedule, toTimeAt, type TransitionSchedule } from '@/utils/transitions/schedule'
import { buildTransitionGraph } from '@/utils/transitions/graph'
import type { Transition } from '@/types/transition'
import { clickTrack, peakNear, noise } from './helpers'

let WA: any = null
try {
  WA = await import('node-web-audio-api')
} catch (err) {
  console.warn('node-web-audio-api unavailable, skipping offline render tests:', (err as Error).message)
}
const d = WA ? describe : describe.skip

const SR = 48000
type Timing = Pick<Transition, 'type' | 'exitAt' | 'entryAt' | 'overlap' | 'fadeOut' | 'fadeIn' | 'bassSwap' | 'filter' | 'echo' | 'rateTo'>

function toBuffer(ctx: any, data: Float32Array, from = 0, to = data.length) {
  const buf = ctx.createBuffer(1, to - from, SR)
  buf.copyToChannel(data.slice(from, to), 0)
  return buf
}

interface RenderResult { left: Float32Array; right: Float32Array; s: TransitionSchedule }

/** Render a transition between two mono signals; FROM → left, TO → right. */
async function renderSplit(fromData: Float32Array, toData: Float32Array, t: Timing, seconds: number, t0 = 2.5): Promise<RenderResult> {
  const ctx = new WA.OfflineAudioContext(2, Math.round(seconds * SR), SR)
  const fromWindowStart = Math.max(0, t.exitAt - 2)
  const toWindowStart = Math.max(0, t.entryAt - 0.5)
  const s = buildSchedule(t, { t0, leadIn: 1, fromWindowStart, toWindowStart, sampleRate: SR })
  const merger = ctx.createChannelMerger(2)
  merger.connect(ctx.destination)
  const left = ctx.createGain(), right = ctx.createGain()
  left.connect(merger, 0, 0)
  right.connect(merger, 0, 1)
  buildTransitionGraph(
    ctx,
    { from: toBuffer(ctx, fromData, Math.round(fromWindowStart * SR)), to: toBuffer(ctx, toData, Math.round(toWindowStart * SR)) },
    s, left, right,
  )
  const out = await ctx.startRendering()
  return { left: out.getChannelData(0), right: out.getChannelData(1), s }
}

/** For each TO beat heard in [lo, hi], find its peak and the nearest FROM peak; return the worst gap. */
function worstGap(r: RenderResult, toBeats: number[], fromPeaksAt: (t: number) => number | null, lo: number, hi: number) {
  let worst = 0, n = 0
  for (const b of toBeats) {
    const expected = toTimeAt(r.s, b)
    if (expected < lo || expected > hi) continue
    const tp = peakNear(r.right, SR, expected, 0.01, 1e-4)
    const fp = fromPeaksAt(expected)
    expect(tp, `TO click near ${expected.toFixed(3)}`).not.toBeNull()
    expect(fp, `FROM click near ${expected.toFixed(3)}`).not.toBeNull()
    worst = Math.max(worst, Math.abs(tp! - fp!))
    n++
  }
  return { worst, n }
}

d('offline render', () => {
  const from = clickTrack(SR, 40, 120, 0.37)
  const exitAt = from.beats[48]

  async function alignedBlend(toBpm: number, rateTo: number) {
    const to = clickTrack(SR, 40, toBpm, 0.11)
    const entryAt = to.beats[8]
    const overlap = 16 * 0.5
    const r = await renderSplit(from.data, to.data, {
      type: 'blend', exitAt, entryAt, overlap, fadeOut: 'linear', fadeIn: 'linear', rateTo,
    }, 14)
    // Skip the first and last beat of the overlap, where one side is (nearly) silent
    const { worst, n } = worstGap(r, to.beats, t => peakNear(r.left, SR, t, 0.01, 1e-4), r.s.t0 + 0.4, r.s.overlapEnd - 0.4)
    return { worst, n, r, to }
  }

  it('120 → 120 BPM: FROM and TO clicks land within 1 ms through the overlap', async () => {
    const { worst, n } = await alignedBlend(120, 1)
    expect(n).toBe(15)
    expect(worst).toBeLessThan(0.001)
  })

  it('120 → 123 BPM with rateTo = 120/123: still within 1 ms', async () => {
    const { worst, n } = await alignedBlend(123, 120 / 123)
    expect(n).toBe(15)
    expect(worst).toBeLessThan(0.001)
  })

  it('after the rate ramp, TO clicks are where the schedule says (TO back at native tempo)', async () => {
    const { r, to } = await alignedBlend(123, 120 / 123)
    let checked = 0
    for (const b of to.beats) {
      const expected = toTimeAt(r.s, b)
      if (expected < r.s.overlapEnd || expected > 13.5) continue
      const p = peakNear(r.right, SR, expected, 0.01, 1e-4)
      expect(p).not.toBeNull()
      expect(Math.abs(p! - expected)).toBeLessThan(0.001)
      checked++
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('FROM is silent after the overlap and TO is at full level', async () => {
    const { r } = await alignedBlend(120, 1)
    const after = Math.round((r.s.overlapEnd + 0.1) * SR)
    let maxL = 0
    for (let i = after; i < r.left.length; i++) maxL = Math.max(maxL, Math.abs(r.left[i]))
    expect(maxL).toBe(0)
    const p = peakNear(r.right, SR, r.s.overlapEnd + 1, 0.3)
    expect(Math.abs(r.right[Math.round(p! * SR)])).toBeGreaterThan(0.95)
  })

  it('cut: FROM stops and TO starts on the same sample', async () => {
    const to = clickTrack(SR, 20, 120, 0.11)
    const r = await renderSplit(from.data, to.data, {
      type: 'cut', exitAt, entryAt: to.beats[4], overlap: 0, fadeOut: 'linear', fadeIn: 'linear',
    }, 6)
    const t0i = Math.round(r.s.t0 * SR)
    for (let i = t0i + 2; i < r.left.length; i++) expect(r.left[i]).toBe(0)
    for (let i = 0; i < t0i - 1; i++) expect(r.right[i]).toBe(0)
    // entryAt is on a beat, so TO's next click is heard exactly one beat after t0
    expect(Math.abs(peakNear(r.right, SR, r.s.t0 + 0.5, 0.01)! - (r.s.t0 + 0.5))).toBeLessThan(0.0001)
  })

  it('echo-out keeps repeating FROM after the dry cut, then fades', async () => {
    const to = clickTrack(SR, 20, 120, 0.11)
    const r = await renderSplit(from.data, to.data, {
      type: 'echo-out', exitAt, entryAt: to.beats[4], overlap: 4, fadeOut: 'linear', fadeIn: 'linear',
      echo: { delay: 0.5, feedback: 0.5 },
    }, 9)
    const rms = (a: number, b: number) => {
      let e = 0
      const i0 = Math.round(a * SR), i1 = Math.round(b * SR)
      for (let i = i0; i < i1; i++) e += r.left[i] ** 2
      return Math.sqrt(e / (i1 - i0))
    }
    expect(rms(r.s.t0 + 0.1, r.s.t0 + 1.5)).toBeGreaterThan(1e-3) // echoes
    expect(rms(r.s.overlapEnd + 0.1, r.s.overlapEnd + 1)).toBeLessThan(1e-6) // faded out
  })

  it('bass swap and a TO filter sweep render without errors and settle TO to full level', async () => {
    const toNoise = noise(SR * 20, 5)
    const r = await renderSplit(from.data, toNoise, {
      type: 'blend', exitAt, entryAt: 4, overlap: 4, fadeOut: 'equal-power', fadeIn: 'equal-power',
      bassSwap: { at: 2 }, filter: { target: 'to', kind: 'lowpass', startHz: 300, endHz: 5000 },
    }, 12)
    // After settling, the lowpass has opened to ~nyquist and the shelf is back at 0 dB: TO ≈ the dry noise
    const i0 = Math.round((r.s.settledAt + 0.5) * SR)
    const toPos0 = 4 + (r.s.settledAt + 0.5 - r.s.t0)
    let eOut = 0, eRef = 0
    for (let i = 0; i < SR; i++) {
      eOut += r.right[i0 + i] ** 2
      eRef += toNoise[Math.round(toPos0 * SR) + i] ** 2
    }
    expect(Math.sqrt(eOut / eRef)).toBeGreaterThan(0.9)
  })

  it('element → buffer swap-in is seamless when both copies are aligned', async () => {
    // Stand-in for the media element: the whole FROM file through an "element gain"
    const ctx = new WA.OfflineAudioContext(1, Math.round(6 * SR), SR)
    const signal = noise(SR * 40, 11)
    const fromWindowStart = exitAt - 3
    const t0 = 4
    // A cut keeps value curves off the FROM gain: node-web-audio-api holds a slightly wrong value
    // (≈0.997) in the gap before a setValueCurveAtTime, which would mask what we're measuring here.
    const s = buildSchedule(
      { type: 'cut', exitAt, entryAt: 1, overlap: 0, fadeOut: 'linear', fadeIn: 'linear' },
      { t0, leadIn: 1, fromWindowStart, toWindowStart: 0, swapIn: 0.04 },
    )
    const element = ctx.createBufferSource()
    element.buffer = toBuffer(ctx, signal)
    const elementGain = ctx.createGain()
    element.connect(elementGain).connect(ctx.destination)
    for (const e of s.elementGain) {
      if (e.type === 'set') elementGain.gain.setValueAtTime(e.value, e.time)
      else if (e.type === 'linear') elementGain.gain.linearRampToValueAtTime(e.value, e.time)
    }
    // Element position at ctx time t is exitAt + (t - t0)
    element.start(0, exitAt - t0)
    const silentTo = toBuffer(ctx, new Float32Array(SR * 10))
    buildTransitionGraph(ctx, { from: toBuffer(ctx, signal, Math.round(fromWindowStart * SR)), to: silentTo }, s, ctx.destination)
    const out = (await ctx.startRendering()).getChannelData(0)
    // Across the swap window the output must equal the original signal
    let worst = 0
    const a = Math.round((s.from.startAt - 0.01) * SR), b = Math.round((s.from.startAt + 0.06) * SR)
    for (let i = a; i < b; i++) {
      const pos = Math.round((exitAt + (i / SR - t0)) * SR)
      worst = Math.max(worst, Math.abs(out[i] - signal[pos]))
    }
    expect(worst).toBeLessThan(1e-4)
  })
})
