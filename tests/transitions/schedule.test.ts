import { describe, it, expect } from 'vitest'
import {
  buildSchedule, fadeCurve, presetVertices, positionAt, timeAtPosition, rateAt, rampRateToUnity,
  toPositionAt, toTimeAt, fromPositionAt, clampRate, effectiveOverlap, planValueAt,
  type ParamEvent, type TransitionSchedule,
} from '@/utils/transitions/schedule'
import type { Transition } from '@/types/transition'

type Timing = Pick<Transition, 'type' | 'exitAt' | 'entryAt' | 'overlap' | 'fadeOut' | 'fadeIn' | 'fadeOutPoints' | 'fadeInPoints'
  | 'bassSwap' | 'filter' | 'echo' | 'rateTo'>

function timing(over: Partial<Timing> = {}): Timing {
  return { type: 'blend', exitAt: 100, entryAt: 8, overlap: 8, fadeOut: 'equal-power', fadeIn: 'equal-power', ...over }
}

const beatsOf = (bpm: number, offset: number, until: number) => {
  const out: number[] = []
  for (let t = offset; t < until; t += 60 / bpm) out.push(t)
  return out
}

describe('fade curves', () => {
  it('start and end where they should', () => {
    for (const p of ['linear', 'equal-power', 's-curve'] as const) {
      const fi = fadeCurve(p, 'in'), fo = fadeCurve(p, 'out')
      expect(fi[0]).toBeCloseTo(0, 6)
      expect(fi[fi.length - 1]).toBeCloseTo(1, 6)
      expect(fo[0]).toBeCloseTo(1, 6)
      expect(fo[fo.length - 1]).toBeCloseTo(0, 6)
    }
  })
  it('equal-power keeps constant power', () => {
    const fi = fadeCurve('equal-power', 'in'), fo = fadeCurve('equal-power', 'out')
    for (let i = 0; i < fi.length; i++) expect(fi[i] ** 2 + fo[i] ** 2).toBeCloseTo(1, 5)
  })
  it("'none' holds full volume and only moves on the outermost step", () => {
    const fi = fadeCurve('none', 'in'), fo = fadeCurve('none', 'out')
    expect(fi[0]).toBe(0)
    expect(fo[fo.length - 1]).toBe(0)
    for (let i = 1; i < fi.length; i++) expect(fi[i]).toBe(1)
    for (let i = 0; i < fo.length - 1; i++) expect(fo[i]).toBe(1)
  })
  it('custom fades pass through their vertices with fixed ends', () => {
    const fo = fadeCurve('custom', 'out', 101, [{ x: 0.5, y: 0.8 }, { x: 0.25, y: 0.9 }])
    expect(fo[0]).toBeCloseTo(1, 6)
    expect(fo[25]).toBeCloseTo(0.9, 6)
    expect(fo[50]).toBeCloseTo(0.8, 6)
    expect(fo[75]).toBeCloseTo(0.4, 6)
    expect(fo[100]).toBeCloseTo(0, 6)
    const fi = fadeCurve('custom', 'in', 101, [{ x: 0.5, y: 2 }])
    expect(fi[0]).toBeCloseTo(0, 6)
    expect(fi[50]).toBeCloseTo(1, 6) // gain clamped to 1
    expect(fi[100]).toBeCloseTo(1, 6)
  })
  it('custom fades without vertices are linear', () => {
    const custom = fadeCurve('custom', 'in', 64), linear = fadeCurve('linear', 'in', 64)
    for (let i = 0; i < 64; i++) expect(custom[i]).toBeCloseTo(linear[i], 6)
  })
  it('presetVertices sit on the preset curve', () => {
    const curve = fadeCurve('equal-power', 'out', 1025)
    for (const p of presetVertices('equal-power', 'out')) expect(p.y).toBeCloseTo(curve[Math.round(p.x * 1024)], 6)
  })
  it('the schedule uses custom fade points', () => {
    const s = buildSchedule(
      timing({ fadeOut: 'custom', fadeOutPoints: [{ x: 0.5, y: 0.2 }] }),
      { t0: 10, leadIn: 1, fromWindowStart: 0, toWindowStart: 0 },
    )
    const curve = s.fromGain.events.find(e => e.type === 'curve')
    expect(curve?.type === 'curve' && curve.values[Math.round((curve.values.length - 1) / 2)]).toBeCloseTo(0.2, 2)
  })
})

describe('rate integration', () => {
  const points = [{ time: 10, rate: 0.97 }, { time: 18, rate: 0.97 }, { time: 20, rate: 1 }]

  it('integrates constant and ramped segments', () => {
    expect(positionAt(10, 5, points, 18)).toBeCloseTo(5 + 0.97 * 8, 9)
    // ramp area = (0.97 + 1) / 2 * 2
    expect(positionAt(10, 5, points, 20)).toBeCloseTo(5 + 0.97 * 8 + 1.97, 9)
    expect(positionAt(10, 5, points, 25)).toBeCloseTo(5 + 0.97 * 8 + 1.97 + 5, 9)
  })

  it('timeAtPosition inverts positionAt', () => {
    for (let t = 10; t < 30; t += 0.137) {
      const pos = positionAt(10, 5, points, t)
      expect(timeAtPosition(10, 5, points, pos)).toBeCloseTo(t, 9)
    }
  })

  it('matches a k-rate (128-frame) simulation of the browser', () => {
    // AudioBufferSourceNode.playbackRate is k-rate: constant per render quantum
    const sr = 48000, q = 128 / sr
    const steps = Math.round(16 / q)
    let pos = 5
    for (let i = 0; i < steps; i++) pos += rateAt(points, 10 + i * q) * q
    const ideal = positionAt(10, 5, points, 10 + steps * q)
    expect(Math.abs(pos - ideal)).toBeLessThan(0.0005)
  })

  it('rampRateToUnity holds the current rate then ramps to 1', () => {
    const p2 = rampRateToUnity(points, 14, 0.5)
    expect(rateAt(p2, 14)).toBeCloseTo(0.97)
    expect(rateAt(p2, 14.25)).toBeCloseTo(0.985)
    expect(rateAt(p2, 15)).toBe(1)
    expect(positionAt(10, 5, p2, 14)).toBeCloseTo(positionAt(10, 5, points, 14), 9)
  })
})

describe('click alignment through the schedule', () => {
  // FROM at 120 BPM, first beat 0.37 s. Exit on beat 64.
  const fromBeats = beatsOf(120, 0.37, 200)
  const exitAt = fromBeats[64]

  function check(toBpm: number, toOffset: number, rateTo: number) {
    const toBeats = beatsOf(toBpm, toOffset, 200)
    const entryAt = toBeats[8]
    const s = buildSchedule(timing({ exitAt, entryAt, overlap: 16 * 0.5, rateTo }), {
      t0: 50, leadIn: 1, fromWindowStart: exitAt - 3, toWindowStart: entryAt - 0.5, swapIn: 0.04,
    })
    const fromTimes = fromBeats.map(b => s.t0 + (b - exitAt))
    let checked = 0
    for (const b of toBeats) {
      const t = toTimeAt(s, b)
      if (t < s.t0 - 1e-9 || t > s.overlapEnd + 1e-9) continue
      const nearest = Math.min(...fromTimes.map(f => Math.abs(f - t)))
      expect(nearest).toBeLessThan(0.001)
      checked++
    }
    expect(checked).toBe(17) // beats 0..16 of the overlap, inclusive
    return s
  }

  it('same tempo, no rate change', () => {
    const s = check(120, 0.11, 1)
    expect(s.rate).toBe(1)
    expect(s.toRate).toEqual([])
  })

  it('TO at 123 BPM nudged down by rateTo = 120/123', () => {
    const s = check(123, 0.11, 120 / 123)
    expect(s.rate).toBeCloseTo(120 / 123, 12)
  })

  it('TO at 117 BPM nudged up by rateTo = 120/117', () => {
    check(117, 0.42, 120 / 117)
  })

  it('FROM position is linear in ctx time', () => {
    const s = buildSchedule(timing({ exitAt }), { t0: 50, leadIn: 1, fromWindowStart: 0, toWindowStart: 0 })
    expect(fromPositionAt(exitAt, s, 53.25)).toBeCloseTo(exitAt + 3.25, 12)
    expect(s.from.offset).toBeCloseTo(exitAt - 1, 12)
    expect(s.from.startAt).toBe(49)
  })

  it('TO is back at native tempo after the ramp', () => {
    const s = buildSchedule(timing({ rateTo: 0.98 }), { t0: 50, leadIn: 1, fromWindowStart: 0, toWindowStart: 0, rateRamp: 2 })
    const a = toPositionAt(s, 61), b = toPositionAt(s, 62)
    expect(b - a).toBeCloseTo(1, 9)
    expect(s.settledAt).toBeCloseTo(50 + 8 + 2 + 0.05, 9)
  })
})

/** Automation sanity: events time-ordered, and nothing lands inside a value curve (that throws in browsers). */
function assertValidEvents(events: ParamEvent[]) {
  for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time)
  for (const c of events) {
    if (c.type !== 'curve') continue
    for (const e of events) {
      if (e === c) continue
      const inside = e.time >= c.time && e.time < c.time + c.duration
      expect(inside, `event at ${e.time} inside curve ${c.time}+${c.duration}`).toBe(false)
    }
  }
}

function allPlans(s: TransitionSchedule): ParamEvent[][] {
  const out = [s.elementGain, s.fromGain.events, s.toGain.events]
  if (s.bassSwap) out.push(s.bassSwap.from.events, s.bassSwap.to.events)
  if (s.filter) out.push(s.filter.frequency.events)
  if (s.echo) out.push(s.echo.send.events, s.echo.wet.events)
  return out
}

describe('schedule shapes', () => {
  const base = { t0: 20, leadIn: 1, fromWindowStart: 90, toWindowStart: 0, swapIn: 0.04 }

  it('blend with every option produces valid automation', () => {
    const s = buildSchedule(timing({
      bassSwap: { at: 4 }, filter: { target: 'to', kind: 'highpass', startHz: 400, endHz: 30 }, rateTo: 1.02,
    }), { ...base, sampleRate: 48000 })
    allPlans(s).forEach(assertValidEvents)
    expect(s.overlapEnd).toBe(28)
    expect(s.bassSwap?.from.events.at(-1)).toMatchObject({ time: 24, value: -40 })
    expect(s.filter?.frequency.events.at(-1)).toMatchObject({ type: 'exponential', value: 10 })
    expect(s.settledAt).toBeCloseTo(28 + 2 + 0.05)
  })

  it('cut has zero overlap, ignores rate, and declicks', () => {
    const s = buildSchedule(timing({ type: 'cut', rateTo: 1.03, bassSwap: { at: 1 } }), base)
    allPlans(s).forEach(assertValidEvents)
    expect(s.overlapEnd).toBe(20)
    expect(s.rate).toBe(1)
    expect(s.bassSwap).toBeNull()
    expect(s.fromGain.events.at(-1)).toMatchObject({ type: 'linear', time: 20, value: 0 })
    expect(s.from.stopAt).toBeCloseTo(20.05)
  })

  it('a blend with no overlap is treated as a cut', () => {
    expect(effectiveOverlap({ type: 'blend', overlap: 0 })).toBe(0)
    const s = buildSchedule(timing({ overlap: 0 }), base)
    expect(s.overlapEnd).toBe(s.t0)
  })

  it('echo-out opens the send one echo before the cut', () => {
    const s = buildSchedule(timing({ type: 'echo-out', echo: { delay: 0.5, feedback: 0.6 } }), base)
    allPlans(s).forEach(assertValidEvents)
    expect(s.echo?.send.events[0]).toMatchObject({ type: 'set', time: 19.5, value: 0 })
    expect(s.fromGain.events.at(-1)).toMatchObject({ type: 'linear', value: 0 })
    expect(s.echo?.feedback).toBe(0.6)
  })

  it('preview (no swap) starts FROM at full gain', () => {
    const s = buildSchedule(timing(), { t0: 10, leadIn: 10, fromWindowStart: 0, toWindowStart: 0 })
    expect(s.elementGain).toEqual([])
    expect(s.fromGain.initial).toBe(1)
    expect(s.from.startAt).toBe(0)
    allPlans(s).forEach(assertValidEvents)
  })

  it('clamps rate to ±10%', () => {
    expect(clampRate(1.2)).toBe(1.1)
    expect(clampRate(0.5)).toBe(0.9)
    expect(clampRate(undefined)).toBe(1)
  })

  it('rejects windows that do not contain the start positions', () => {
    expect(() => buildSchedule(timing(), { ...base, fromWindowStart: 99.5 })).toThrow()
    expect(() => buildSchedule(timing(), { ...base, toWindowStart: 9 })).toThrow()
  })
})

describe('planValueAt', () => {
  it('follows set / linear / exponential events', () => {
    const plan = {
      initial: -40,
      events: [
        { type: 'set', time: 10, value: -40 },
        { type: 'linear', time: 12, value: 0 },
        { type: 'exponential', time: 20, value: 1000 },
      ] as ParamEvent[],
    }
    expect(planValueAt(plan, 5)).toBe(-40)
    expect(planValueAt(plan, 11)).toBeCloseTo(-20)
    expect(planValueAt(plan, 12)).toBe(0)
    // exponential from 0 is undefined in Web Audio too: the value holds
    expect(planValueAt(plan, 15)).toBe(0)
    expect(planValueAt(plan, 25)).toBe(1000)
  })

  it('matches the bass-swap plan the schedule builds', () => {
    const s = buildSchedule(timing({ bassSwap: { at: 4 } }), { t0: 20, leadIn: 1, fromWindowStart: 90, toWindowStart: 0 })
    expect(planValueAt(s.bassSwap!.to, 21)).toBe(-40)
    expect(planValueAt(s.bassSwap!.to, 24 - 0.01)).toBeCloseTo(-20)
    expect(planValueAt(s.bassSwap!.to, 25)).toBe(0)
  })

  it('exponential ramps interpolate geometrically', () => {
    const plan = { initial: 100, events: [{ type: 'set', time: 0, value: 100 }, { type: 'exponential', time: 2, value: 10000 }] as ParamEvent[] }
    expect(planValueAt(plan, 1)).toBeCloseTo(1000)
  })
})
