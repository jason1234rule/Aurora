import { describe, it, expect } from 'vitest'
import { PeakPyramid } from '@/utils/transitions/peaks'
import { mixMapping, moveExit, slideTo, fromSpeed } from '@/utils/transitions/timeline'
import { splitRates, rateRatio, type TransitionTiming } from '@/utils/transitions/schedule'
import { previewStretchPlan } from '@/utils/transitions/engine'
import { planKey } from '@/utils/transitions/stretch/plan'
import { noise } from './helpers'

function bufferOf(channels: Float32Array[], sampleRate = 48000) {
  return { sampleRate, length: channels[0].length, numberOfChannels: channels.length, getChannelData: (c: number) => channels[c] }
}

describe('PeakPyramid', () => {
  const sr = 48000
  const l = noise(sr * 30, 1), r = noise(sr * 30, 2)
  const pyr = new PeakPyramid(bufferOf([l, r], sr))

  function brute(t0: number, t1: number): [number, number] {
    let lo = Infinity, hi = -Infinity
    for (let i = Math.floor(t0 * sr); i < Math.ceil(t1 * sr); i++) {
      const v = (l[i] + r[i]) / 2
      lo = Math.min(lo, v); hi = Math.max(hi, v)
    }
    return [lo, hi]
  }

  it('is exact when zoomed right in', () => {
    expect(pyr.range(1.00001, 1.0015)).toEqual(brute(1.00001, 1.0015))
  })

  it('contains the true range when zoomed out, and stays close to it', () => {
    for (const [a, b] of [[0, 30], [3.3, 9.1], [12, 12.05]]) {
      const [lo, hi] = pyr.range(a, b)
      const [blo, bhi] = brute(a, b)
      expect(lo).toBeLessThanOrEqual(blo + 1e-6)
      expect(hi).toBeGreaterThanOrEqual(bhi - 1e-6)
      // Block edges may reach a little outside the window, never far
      expect(blo - lo).toBeLessThan(0.2)
      expect(hi - bhi).toBeLessThan(0.2)
    }
  })

  it('is empty outside the file', () => {
    expect(pyr.range(-5, -1)).toEqual([0, 0])
    expect(pyr.range(31, 40)).toEqual([0, 0])
  })
})

describe('timeline mapping', () => {
  const base: TransitionTiming = {
    type: 'blend', exitAt: 100, entryAt: 10, overlap: 8, fadeOut: 'linear', fadeIn: 'linear', rateTo: 0.98,
  }

  it('TO entryAt is heard at FROM exitAt, and the mapping inverts', () => {
    const m = mixMapping(base)
    expect(m.toPosAt(100)).toBeCloseTo(10, 9)
    expect(m.toPosAt(104)).toBeCloseTo(10 + 4 * 0.98, 9)
    for (const x of [95, 100, 103.7, 108, 111, 130]) expect(m.xForToPos(m.toPosAt(x))).toBeCloseTo(x, 6)
  })

  it('moving the exit keeps TO aligned against FROM', () => {
    const before = mixMapping(base)
    const moved = moveExit(base, 98)
    const after = mixMapping({ ...base, ...moved })
    // Content that lined up before (within the overlap) still lines up
    for (const x of [99, 100, 102]) expect(after.toPosAt(x)).toBeCloseTo(before.toPosAt(x), 6)
  })

  it('sliding TO moves it by dx of FROM time', () => {
    const entry = slideTo(base, 0.5)
    const m0 = mixMapping(base), m1 = mixMapping({ ...base, entryAt: entry })
    // What was heard at x is now heard at x + 0.5
    expect(m1.toPosAt(100.5 + 2)).toBeCloseTo(m0.toPosAt(100 + 2), 6)
  })

  it('cuts ignore the rate', () => {
    expect(slideTo({ ...base, type: 'cut' }, 1)).toBeCloseTo(9, 9)
  })
})

describe('timeline mapping when the outgoing song changes speed too', () => {
  // Meet in the middle: FROM speeds up 2%, TO slows down 2%, FROM eases in over 4 s
  const meet: TransitionTiming = {
    type: 'blend', exitAt: 100, entryAt: 10, overlap: 8, fadeOut: 'linear', fadeIn: 'linear',
    rateTo: 0.98, rateFrom: 1.02, rampBack: 4,
  }

  it('TO is drawn where it is heard against FROM\'s (stretched) position', () => {
    const m = mixMapping(meet)
    expect(m.toPosAt(100)).toBeCloseTo(10, 9)
    // 4 s after the exit FROM is at 100 + 4 * 1.02 while TO has played 4 * 0.98
    expect(m.toPosAt(100 + 4 * 1.02)).toBeCloseTo(10 + 4 * 0.98, 9)
    for (const x of [90, 97, 100, 103.7, 108, 115]) expect(m.xForToPos(m.toPosAt(x))).toBeCloseTo(x, 6)
    expect(fromSpeed(meet)).toBeCloseTo(1.02, 12)
  })

  it('sliding TO moves it by dx of FROM position', () => {
    const entry = slideTo(meet, 0.5)
    const m0 = mixMapping(meet), m1 = mixMapping({ ...meet, entryAt: entry })
    expect(m1.toPosAt(100.5 + 2)).toBeCloseTo(m0.toPosAt(100 + 2), 6)
  })

  it('moving the exit keeps TO aligned', () => {
    const before = mixMapping(meet)
    const after = mixMapping({ ...meet, ...moveExit(meet, 101) })
    for (const x of [101, 102, 104]) expect(after.toPosAt(x)).toBeCloseTo(before.toPosAt(x), 6)
  })
})

describe('sharing a tempo match between the songs', () => {
  it('splits the ratio as asked and reads it back', () => {
    const r = 120 / 130
    for (const mode of ['to', 'meet', 'from'] as const) {
      const rates = splitRates(r, mode)
      expect(rateRatio(rates)).toBeCloseTo(r, 9)
    }
    expect(splitRates(r, 'to')).toEqual({ rateTo: r, rateFrom: undefined })
    expect(splitRates(r, 'from').rateTo).toBeUndefined()
    expect(splitRates(r, 'from').rateFrom).toBeCloseTo(130 / 120, 12)
    const meet = splitRates(r, 'meet')
    expect(meet.rateTo! * (1 / meet.rateFrom!)).toBeCloseTo(meet.rateTo! ** 2, 12)
    expect(splitRates(1, 'meet')).toEqual({ rateTo: undefined, rateFrom: undefined })
  })
})

describe('preview stretch plan', () => {
  const t: TransitionTiming = { type: 'blend', exitAt: 60, entryAt: 5, overlap: 8, fadeOut: 'linear', fadeIn: 'linear', rateTo: 0.95 }

  it('is empty with vinyl (or no speed change), so those previews start at once', () => {
    expect(previewStretchPlan(t, { preRoll: 10, postRoll: 5 })).toEqual({})
    expect(previewStretchPlan({ ...t, pitch: 'keep', rateTo: undefined }, { preRoll: 10, postRoll: 5 })).toEqual({})
  })

  it('covers TO from the exit to the end of the preview, and FROM when it changes speed', () => {
    const p = previewStretchPlan({ ...t, pitch: 'keep', rateFrom: 1.03, rampBack: 4 }, { preRoll: 10, postRoll: 5 })
    expect(p.to?.startPos).toBe(5)
    expect(p.to?.duration).toBeCloseTo(8 + 5 + 0.1, 9)
    expect(p.from?.points[0]).toEqual({ time: 6, rate: 1 }) // ramp starts 4 s before the exit, 10 s in
    expect(planKey(p)).toBe(planKey(previewStretchPlan({ ...t, pitch: 'keep', rateFrom: 1.03, rampBack: 4 }, { preRoll: 10, postRoll: 5 })))
    expect(planKey(p)).not.toBe(planKey(previewStretchPlan({ ...t, pitch: 'keep', rateFrom: 1.03, rampBack: 4 }, { preRoll: 5, postRoll: 5 })))
  })
})
