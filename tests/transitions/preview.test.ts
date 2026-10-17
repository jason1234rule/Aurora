/**
 * Editor preview from part-way through (cueSchedule): from the jump on, every automation value
 * and every source position must be what the full preview has at that moment, and nothing may
 * be scheduled before the jump (browsers clamp past events to "now", restarting fades).
 *
 * Checked exactly on the schedule rather than by rendering: the offline renderer
 * (node-web-audio-api) segfaulted now and then under parallel test load once these renders were
 * added. The same jumps were checked by ear-free measurement in Chromium (playhead lands where
 * clicked, no errors). Listening at another speed is in preview-speed.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSchedule, cueSchedule, cuePlan, planValueAt, envelopeIntegral,
  type ParamPlan, type ParamEvent, type TransitionTiming, type TransitionSchedule,
} from '@/utils/transitions/schedule'

/** Value of an AudioParam following `plan` at `time`, with Web Audio semantics (curves included) */
function valueAt(plan: ParamPlan, time: number): number {
  let value = plan.initial
  let prevTime = -Infinity
  for (const e of plan.events) {
    if (e.type === 'curve') {
      if (time < e.time) break
      const f = Math.min(1, (time - e.time) / e.duration)
      const x = f * (e.values.length - 1)
      const i = Math.min(e.values.length - 2, Math.floor(x))
      value = e.values[i] + (e.values[i + 1] - e.values[i]) * (x - i)
      prevTime = e.time + e.duration
      if (time < prevTime) return value
      value = e.values[e.values.length - 1]
      continue
    }
    if (e.time <= time) { value = e.value; prevTime = e.time; continue }
    if (e.type === 'set') break
    const start = Number.isFinite(prevTime) ? prevTime : time
    const x = e.time > start ? (time - start) / (e.time - start) : 1
    if (e.type === 'linear') return value + (e.value - value) * x
    return value > 0 && e.value > 0 ? value * Math.pow(e.value / value, x) : value
  }
  return value
}

/** Every automation plan in a schedule, by name */
function plans(s: TransitionSchedule): Record<string, ParamPlan> {
  const out: Record<string, ParamPlan> = { fromGain: s.fromGain, toGain: s.toGain }
  if (s.bassSwap) { out.bassFrom = s.bassSwap.from; out.bassTo = s.bassSwap.to }
  if (s.filter) out.filter = s.filter.frequency
  if (s.echo) { out.echoSend = s.echo.send; out.echoWet = s.echo.wet }
  return out
}

/** Buffer position (s) a source plays at ctx `time`, or null while it isn't playing */
function bufferPos(src: { startAt: number; offset: number; stopAt?: number }, rate: TransitionSchedule['toRate'], time: number) {
  if (time < src.startAt || (src.stopAt !== undefined && time >= src.stopAt)) return null
  return src.offset + envelopeIntegral(rate, src.startAt, time)
}

/** Web Audio throws if any event falls inside a value curve's span */
function noOverlapWithCurves(events: ParamEvent[]) {
  for (const c of events) {
    if (c.type !== 'curve') continue
    for (const e of events) {
      if (e === c) continue
      expect(e.time > c.time && e.time < c.time + c.duration, 'event inside a curve').toBe(false)
    }
  }
}

describe('cuePlan', () => {
  it('joins ramps and curves where they are', () => {
    const plan = {
      initial: 0,
      events: [
        { type: 'set' as const, time: 1, value: 0 },
        { type: 'linear' as const, time: 3, value: 1 },
        { type: 'set' as const, time: 4, value: 1 },
        { type: 'exponential' as const, time: 6, value: 0.25 },
      ],
    }
    for (const at of [0.5, 2, 3.5, 5, 7]) {
      const cued = cuePlan(plan, at)
      expect(cued.events.every(e => e.time >= at)).toBe(true)
      for (const t of [at, at + 0.3, at + 1, 6.5]) {
        if (t < at) continue
        expect(planValueAt(cued, t)).toBeCloseTo(planValueAt(plan, t), 9)
      }
    }
  })

  it('continues a value curve as straight ramps between its remaining points', () => {
    const values = new Float32Array(101).map((_, i) => Math.sin(i / 100 * Math.PI / 2))
    const plan: ParamPlan = { initial: 0, events: [{ type: 'curve', time: 2, duration: 4, values }] }
    const cued = cuePlan(plan, 3.013)
    expect(cued.events[0]).toEqual({ type: 'set', time: 3.013, value: expect.closeTo(valueAt(plan, 3.013), 6) })
    expect(cued.events.every(e => e.type !== 'curve')).toBe(true)
    for (let t = 3.013; t < 7; t += 0.01) expect(valueAt(cued, t)).toBeCloseTo(valueAt(plan, t), 6)
  })
})

describe('cueSchedule: a preview started part-way through', () => {
  // A preview 4 s before the exit, started at ctx time 0 (blend 4–10 s)
  const opts = { t0: 4, leadIn: 4, fromWindowStart: 0, toWindowStart: 0, sampleRate: 48000 }
  const cases: Record<string, TransitionTiming> = {
    'fades, bass swap and filter sweep': {
      type: 'blend', exitAt: 20, entryAt: 5, overlap: 6, fadeOut: 'equal-power', fadeIn: 's-curve',
      bassSwap: { at: 4 }, filter: { target: 'to', kind: 'lowpass', startHz: 400, endHz: 20000 },
    },
    'custom fades': {
      type: 'blend', exitAt: 20, entryAt: 5, overlap: 6, fadeOut: 'custom', fadeIn: 'custom',
      fadeOutPoints: [{ x: 0.3, y: 1 }, { x: 0.35, y: 0.2 }], fadeInPoints: [{ x: 0.5, y: 0.5 }],
    },
    'vinyl tempo match easing back': {
      type: 'blend', exitAt: 20, entryAt: 5, overlap: 6, fadeOut: 'linear', fadeIn: 'linear', rateTo: 0.96, rampBack: 3,
    },
    'meet in the middle (vinyl), FROM easing in': {
      type: 'blend', exitAt: 20, entryAt: 5, overlap: 6, fadeOut: 'linear', fadeIn: 'linear',
      rateTo: 0.98, rateFrom: 1.02, rampBack: 3,
    },
    'echo out': {
      type: 'echo-out', exitAt: 20, entryAt: 5, overlap: 4, fadeOut: 'linear', fadeIn: 'equal-power', echo: { delay: 0.5, feedback: 0.5 },
    },
  }

  for (const [name, timing] of Object.entries(cases)) {
    it(`${name}: everything after the jump is what the full preview has there`, () => {
      const lead = timing.rateFrom ? 4 + 3 : 4
      const full = buildSchedule(timing, { ...opts, t0: lead, leadIn: lead })
      const end = full.settledAt + 1
      for (const at of [0.7, lead - 0.3, lead + 0.01, lead + 1.37, full.overlapEnd - 0.5, full.overlapEnd + 0.4, full.settledAt - 0.2, end - 0.5]) {
        const cued = cueSchedule(full, at)
        const fullPlans = plans(full), cuedPlans = plans(cued)
        for (const [key, plan] of Object.entries(cuedPlans)) {
          // Nothing scheduled in the past, and no event inside a curve (Web Audio would throw)
          expect(plan.events.every(e => e.time >= at - 1e-12), `${key} has events before ${at}`).toBe(true)
          noOverlapWithCurves(plan.events)
          for (let t = at; t <= end; t += 0.013) {
            const a = valueAt(fullPlans[key], t), b = valueAt(plan, t)
            const tol = key === 'filter' ? Math.max(1e-6, Math.abs(a) * 1e-6) : 1e-6
            expect(Math.abs(a - b), `${key} at ${t.toFixed(3)} after a jump to ${at}`).toBeLessThan(tol)
          }
        }
        for (const side of ['from', 'to'] as const) {
          const fs = side === 'from' ? { ...full.from } : { ...full.to, stopAt: undefined }
          const cs = side === 'from' ? { ...cued.from } : { ...cued.to, stopAt: undefined }
          const fr = side === 'from' ? full.fromPlaybackRate : full.toPlaybackRate
          const cr = side === 'from' ? cued.fromPlaybackRate : cued.toPlaybackRate
          expect(cs.startAt).toBeGreaterThanOrEqual(at - 1e-12)
          for (let t = at; t <= end; t += 0.017) {
            const a = bufferPos(fs, fr, t), b = bufferPos(cs, cr, t)
            if (a === null) { expect(b, `${side} should be silent at ${t.toFixed(3)}`).toBeNull(); continue }
            expect(b, `${side} should be playing at ${t.toFixed(3)} after a jump to ${at}`).not.toBeNull()
            expect(Math.abs(a - b!), `${side} position at ${t.toFixed(3)}`).toBeLessThan(1e-9)
          }
        }
      }
    })
  }
})
