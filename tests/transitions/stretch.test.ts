/**
 * Pitch-preserving tempo matching: the Signalsmith-based renderer on its own, then
 * whole transitions rendered offline through the real graph with pre-stretched
 * buffers (FROM on the left channel, TO on the right).
 */
import { describe, it, expect } from 'vitest'
import { renderStretch } from '@/utils/transitions/stretch/core'
import { stretchPlan, renderPlan } from '@/utils/transitions/stretch/plan'
import {
  buildSchedule, toTimeAt, fromTimeAt, fromPositionAt, timeAtPosition, positionAt, rampBackOf, pitchOf,
  DEFAULT_RATE_RAMP, type TransitionTiming, type TransitionSchedule,
} from '@/utils/transitions/schedule'
import { buildTransitionGraph } from '@/utils/transitions/graph'
import { clickTrack, peakNear } from './helpers'

let WA: any = null
try {
  WA = await import('node-web-audio-api')
} catch (err) {
  console.warn('node-web-audio-api unavailable, skipping offline render tests:', (err as Error).message)
}

/** Frequency from zero crossings over [a, b) seconds */
function zeroCrossHz(x: Float32Array, sr: number, a: number, b: number): number {
  let first = -1, last = -1, n = 0
  for (let i = Math.round(a * sr) + 1; i < Math.round(b * sr); i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = (i - 1 + -x[i - 1] / (x[i] - x[i - 1])) / sr
      if (first < 0) first = t
      last = t
      n++
    }
  }
  return n > 1 ? (n - 1) / (last - first) : 0
}

function sine(sr: number, seconds: number, hz: number, amp = 0.5): Float32Array {
  const x = new Float32Array(Math.round(sr * seconds))
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * hz * i / sr)
  return x
}

describe('stretch renderer', () => {
  const sr = 44100

  it('places clicks where the envelope says, at constant rates and through a ramp', async () => {
    const { data, beats } = clickTrack(sr, 60, 130, 0.2)
    const cases = [
      [{ time: 0, rate: 120 / 130 }],
      [{ time: 0, rate: 1.1 }],
      [{ time: 0, rate: 0.9 }],
      [{ time: 0, rate: 120 / 130 }, { time: 4, rate: 120 / 130 }, { time: 16, rate: 1 }],
    ]
    for (const points of cases) {
      const startPos = 5, duration = 20
      const [out] = await renderStretch({ channels: [data], sampleRate: sr, sourceStart: 0, startPos, points, duration })
      let worst = 0, n = 0
      for (const b of beats) {
        if (b < startPos + 0.3) continue
        const t = timeAtPosition(0, startPos, points, b)
        if (t > duration - 0.3) break
        const p = peakNear(out, sr, t, 0.01, 0.05)
        expect(p, `click at ${t.toFixed(3)}`).not.toBeNull()
        worst = Math.max(worst, Math.abs(p! - t))
        n++
      }
      expect(n).toBeGreaterThan(30)
      expect(worst).toBeLessThan(0.001)
    }
  }, 60000)

  it('keeps pitch: a 440 Hz sine stays at 440 Hz while tempo moves ±10%', async () => {
    const points = [{ time: 0, rate: 0.9 }, { time: 5, rate: 0.9 }, { time: 15, rate: 1.1 }]
    const [out] = await renderStretch({ channels: [sine(sr, 40, 440)], sampleRate: sr, sourceStart: 0, startPos: 2, points, duration: 20 })
    let worst = 0
    for (let t = 0.2; t < 19.5; t += 0.5) worst = Math.max(worst, Math.abs(zeroCrossHz(out, sr, t, t + 0.25) / 440 - 1))
    expect(worst).toBeLessThan(0.005)
  }, 60000)

  it('renders a 30 s stereo window much faster than real time', async () => {
    const l = sine(48000, 40, 220), r = sine(48000, 40, 330)
    const started = performance.now()
    const out = await renderStretch({
      channels: [l, r], sampleRate: 48000, sourceStart: 0, startPos: 1,
      points: [{ time: 0, rate: 1.08 }, { time: 8, rate: 1.08 }, { time: 23, rate: 1 }], duration: 30,
    })
    const ms = performance.now() - started
    console.log(`30 s stereo 48 kHz stretched in ${ms.toFixed(0)} ms (${(30000 / ms).toFixed(0)}x real time)`)
    expect(out[0].length).toBe(30 * 48000)
    expect(ms).toBeLessThan(15000)
  }, 60000)
})

describe('schedule with tempo matching', () => {
  const base: TransitionTiming = { type: 'blend', exitAt: 100, entryAt: 10, overlap: 8, fadeOut: 'linear', fadeIn: 'linear' }

  it('transitions saved before stretching keep their sound: vinyl, 2 s ramp', () => {
    expect(pitchOf(base)).toBe('vinyl')
    expect(rampBackOf(base)).toBe(DEFAULT_RATE_RAMP)
    const s = buildSchedule({ ...base, rateTo: 0.98 }, { t0: 20, leadIn: 1, fromWindowStart: 0, toWindowStart: 0 })
    expect(s.pitch).toBe('vinyl')
    expect(s.toPlaybackRate).toEqual(s.toRate)
    expect(s.settledAt).toBeCloseTo(28 + 2 + 0.05, 9)
  })

  it('pre-rendered sources play at rate 1 and start at their first sample', () => {
    const s = buildSchedule({ ...base, pitch: 'keep', rateTo: 0.92, rateFrom: 1.04, rampBack: 6 },
      { t0: 20, leadIn: 7, fromWindowStart: 0, toWindowStart: 0, prerendered: { from: true, to: true } })
    expect(s.toPlaybackRate).toEqual([])
    expect(s.fromPlaybackRate).toEqual([])
    expect(s.to.offset).toBe(0)
    expect(s.from.offset).toBe(0)
    expect(s.settledAt).toBeCloseTo(28 + 6 + 0.05, 9)
  })

  it('FROM eases into its overlap speed before the exit and its position integrates that ramp', () => {
    const s = buildSchedule({ ...base, rateFrom: 0.96, rampBack: 4 }, { t0: 20, leadIn: 6, fromWindowStart: 0, toWindowStart: 0 })
    expect(s.fromRampStart).toBe(16)
    // exitAt is heard at t0; during the ramp FROM covers (1 + 0.96) / 2 * 4 s of file
    expect(fromPositionAt(100, s, 20)).toBeCloseTo(100, 9)
    expect(fromPositionAt(100, s, 16)).toBeCloseTo(100 - 3.92, 9)
    expect(fromPositionAt(100, s, 14)).toBeCloseTo(100 - 3.92 - 2, 9)
    expect(s.from.startPos).toBeCloseTo(100 - 3.92 - 2, 9)
    expect(fromPositionAt(100, s, 24)).toBeCloseTo(100 + 0.96 * 4, 9)
    for (const t of [14.5, 16, 17.3, 20, 23.9]) expect(fromTimeAt(100, s, fromPositionAt(100, s, t))).toBeCloseTo(t, 9)
  })

  it('positions before a ramp integrate backwards correctly', () => {
    const points = [{ time: 10, rate: 1 }, { time: 14, rate: 0.9 }]
    expect(positionAt(14, 50, points, 10)).toBeCloseTo(50 - 3.8, 9)
    expect(positionAt(14, 50, points, 8)).toBeCloseTo(50 - 5.8, 9)
    expect(timeAtPosition(14, 50, points, 50 - 3.8)).toBeCloseTo(10, 9)
    expect(timeAtPosition(14, 50, points, 50 - 1)).toBeCloseTo(14 - (0.9 - Math.sqrt(0.81 + 2 * 0.025 * 1)) / -0.025, 9)
  })
})

const d = WA ? describe : describe.skip

d('offline render with time-stretching (FROM left, TO right)', () => {
  const SR = 48000
  const FROM_BPM = 120, TO_BPM = 130
  const from = clickTrack(SR, 60, FROM_BPM, 0.37)
  const to = clickTrack(SR, 60, TO_BPM, 0.11)
  const exitAt = from.beats[48]
  const entryAt = to.beats[8]
  const rampBack = 8 * 4 * 60 / TO_BPM // 8 bars of TO

  async function render(timing: TransitionTiming, fromData: Float32Array, toData: Float32Array, seconds: number, leadIn = 1, t0 = 2.5) {
    const ctx = new WA.OfflineAudioContext(2, Math.round(seconds * SR), SR)
    const mono = (x: Float32Array) => { const b = ctx.createBuffer(1, x.length, SR); b.copyToChannel(x, 0); return b }
    const fromBuf = mono(fromData), toBuf = mono(toData)
    const keep = timing.pitch === 'keep'
    // Same geometry the engine uses: plan from a schedule, render, then build with the stretched buffers
    const s: TransitionSchedule = buildSchedule(timing, {
      t0, leadIn, fromWindowStart: 0, toWindowStart: 0, sampleRate: SR,
      prerendered: keep ? { from: (timing.rateFrom ?? 1) !== 1, to: (timing.rateTo ?? 1) !== 1 } : undefined,
    })
    const stretched = await renderPlan(ctx, stretchPlan(s, seconds), { from: { buffer: fromBuf, start: 0 }, to: { buffer: toBuf, start: 0 } }, renderStretch)
    const merger = ctx.createChannelMerger(2)
    merger.connect(ctx.destination)
    const left = ctx.createGain(), right = ctx.createGain()
    left.connect(merger, 0, 0)
    right.connect(merger, 0, 1)
    buildTransitionGraph(ctx, { from: stretched.from ?? fromBuf, to: stretched.to ?? toBuf }, s, left, right)
    const out = await ctx.startRendering()
    return { L: out.getChannelData(0) as Float32Array, R: out.getChannelData(1) as Float32Array, s }
  }

  /** Worst |FROM click − TO click| over TO's clicks heard in [lo, hi] */
  function worstPair(L: Float32Array, R: Float32Array, s: TransitionSchedule, lo: number, hi: number) {
    let worst = 0, n = 0
    for (const b of to.beats) {
      const t = toTimeAt(s, b)
      if (t < lo || t > hi) continue
      const tp = peakNear(R, SR, t, 0.01, 1e-3)
      const fp = peakNear(L, SR, t, 0.01, 1e-3)
      expect(tp, `TO click near ${t.toFixed(3)}`).not.toBeNull()
      expect(fp, `FROM click near ${t.toFixed(3)}`).not.toBeNull()
      worst = Math.max(worst, Math.abs(tp! - fp!))
      n++
    }
    return { worst, n }
  }

  it('130 → 120 BPM, TO stretched (pitch kept): clicks within 2 ms through the overlap, then back on TO\'s own grid', async () => {
    const timing: TransitionTiming = {
      type: 'blend', exitAt, entryAt, overlap: 16 * 60 / FROM_BPM, fadeOut: 'linear', fadeIn: 'linear',
      pitch: 'keep', rateTo: FROM_BPM / TO_BPM, rampBack,
    }
    const { L, R, s } = await render(timing, from.data, to.data, 2.5 + 8 + rampBack + 4)
    const { worst, n } = worstPair(L, R, s, s.t0 + 0.4, s.overlapEnd - 0.4)
    console.log(`TO stretched to match: worst FROM/TO click gap ${(worst * 1000).toFixed(3)} ms over ${n} beats`)
    expect(n).toBeGreaterThanOrEqual(14)
    expect(worst).toBeLessThan(0.002)

    // Through and after the ramp, TO's clicks follow the envelope onto its native grid
    let worstOwn = 0, m = 0
    for (const b of to.beats) {
      const t = toTimeAt(s, b)
      if (t < s.overlapEnd || t > s.settledAt + 3) continue
      const p = peakNear(R, SR, t, 0.01, 0.05)
      expect(p).not.toBeNull()
      worstOwn = Math.max(worstOwn, Math.abs(p! - t))
      m++
    }
    console.log(`TO during and after the ramp: worst ${(worstOwn * 1000).toFixed(3)} ms over ${m} beats`)
    expect(m).toBeGreaterThan(30)
    expect(worstOwn).toBeLessThan(0.002)
    // Native tempo at the end: consecutive clicks one TO beat apart
    const tail = to.beats.map(b => toTimeAt(s, b)).filter(t => t > s.settledAt && t < s.settledAt + 3)
    for (let i = 1; i < tail.length; i++) expect(tail[i] - tail[i - 1]).toBeCloseTo(60 / TO_BPM, 6)
  }, 120000)

  it('a sustained tone in TO keeps its frequency within ±0.5% through the overlap and the ramp', async () => {
    const timing: TransitionTiming = {
      type: 'blend', exitAt, entryAt, overlap: 8, fadeOut: 'linear', fadeIn: 'linear',
      pitch: 'keep', rateTo: FROM_BPM / TO_BPM, rampBack,
    }
    const { R, s } = await render(timing, from.data, sine(SR, 60, 440), 2.5 + 8 + rampBack + 3)
    let worst = 0
    for (let t = s.t0 + 1; t < s.settledAt + 1; t += 0.5) worst = Math.max(worst, Math.abs(zeroCrossHz(R, SR, t, t + 0.25) / 440 - 1))
    console.log(`sine through overlap + ramp: worst deviation ${(worst * 100).toFixed(3)}%`)
    expect(worst).toBeLessThan(0.005)
  }, 120000)

  it('vinyl mode still resamples (the tone shifts with the speed)', async () => {
    const timing: TransitionTiming = {
      type: 'blend', exitAt, entryAt, overlap: 8, fadeOut: 'linear', fadeIn: 'linear', pitch: 'vinyl', rateTo: 0.95, rampBack: 4,
    }
    const { R, s } = await render(timing, from.data, sine(SR, 60, 440), 2.5 + 8 + 4 + 2)
    expect(zeroCrossHz(R, SR, s.t0 + 2, s.t0 + 4) / 440).toBeCloseTo(0.95, 3)
    expect(zeroCrossHz(R, SR, s.settledAt + 0.2, s.settledAt + 1.2) / 440).toBeCloseTo(1, 3)
  }, 120000)

  it('meet in the middle: both stretched halfway, clicks within 2 ms through the overlap', async () => {
    const meet = Math.sqrt(FROM_BPM * TO_BPM)
    const timing: TransitionTiming = {
      type: 'blend', exitAt, entryAt, overlap: 16 * 60 / meet, fadeOut: 'linear', fadeIn: 'linear',
      pitch: 'keep', rateFrom: meet / FROM_BPM, rateTo: meet / TO_BPM, rampBack: 6,
    }
    // Lead-in covers FROM's ramp, as the engine does
    const t0 = 7.5
    const { L, R, s } = await render(timing, from.data, to.data, t0 + 16 * 60 / meet + 6 + 3, 7, t0)
    expect(s.fromRampStart).toBeCloseTo(t0 - 6, 9)
    const { worst, n } = worstPair(L, R, s, s.t0 + 0.4, s.overlapEnd - 0.4)
    console.log(`meet in the middle: worst FROM/TO click gap ${(worst * 1000).toFixed(3)} ms over ${n} beats`)
    expect(n).toBeGreaterThanOrEqual(14)
    expect(worst).toBeLessThan(0.002)
    // FROM follows its own envelope from the buffer start, through its ramp into the overlap
    let worstFrom = 0, m = 0
    for (const b of from.beats) {
      const t = fromTimeAt(exitAt, s, b)
      if (t < s.from.startAt + 0.3 || t > s.overlapEnd - 0.3) continue
      // Before the ramp FROM is untouched: one FROM beat apart, as the media element plays it
      if (t + 0.5 < s.fromRampStart) expect(fromPositionAt(exitAt, s, t + 0.5) - b).toBeCloseTo(0.5, 9)
      const p = peakNear(L, SR, t, 0.01, 0.05)
      expect(p, `FROM click near ${t.toFixed(3)}`).not.toBeNull()
      worstFrom = Math.max(worstFrom, Math.abs(p! - t))
      m++
    }
    console.log(`FROM through its ramp: worst ${(worstFrom * 1000).toFixed(3)} ms over ${m} beats`)
    expect(m).toBeGreaterThan(20)
    expect(worstFrom).toBeLessThan(0.002)
  }, 120000)
})
