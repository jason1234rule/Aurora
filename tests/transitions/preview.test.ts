/**
 * Editor preview from part-way through (cueSchedule): it must sound like the normal preview
 * from that point on. Listening at another speed is in preview-speed.test.ts (kept in its own
 * file: node-web-audio-api has segfaulted when both sets of offline renders share a process).
 */
import { describe, it, expect } from 'vitest'
import { buildSchedule, cueSchedule, cuePlan, planValueAt, type TransitionTiming } from '@/utils/transitions/schedule'
import { buildTransitionGraph } from '@/utils/transitions/graph'
import { noise } from './helpers'

let WA: any = null
try {
  WA = await import('node-web-audio-api')
} catch (err) {
  console.warn('node-web-audio-api unavailable, skipping offline render tests:', (err as Error).message)
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

  it('cuts a value curve to its remaining part', () => {
    const values = new Float32Array(101).map((_, i) => Math.sin(i / 100 * Math.PI / 2))
    const cued = cuePlan({ initial: 0, events: [{ type: 'curve', time: 2, duration: 4, values }] }, 3)
    const c = cued.events[0]
    expect(c.type).toBe('curve')
    if (c.type !== 'curve') return
    expect(c.time).toBe(3)
    expect(c.duration).toBe(3)
    expect(c.values[0]).toBeCloseTo(Math.sin(0.25 * Math.PI / 2), 4)
    expect(c.values[c.values.length - 1]).toBeCloseTo(1, 6)
  })
})

const d = WA ? describe : describe.skip

d('preview from part-way through (offline render)', () => {
  const SR = 48000
  const from = noise(SR * 30, 3), to = noise(SR * 30, 4)
  const shaped: TransitionTiming = {
    type: 'blend', exitAt: 20, entryAt: 5, overlap: 6, fadeOut: 'equal-power', fadeIn: 's-curve',
    bassSwap: { at: 4 }, filter: { target: 'to', kind: 'lowpass', startHz: 400, endHz: 20000 },
  }

  async function render(timing: TransitionTiming, cueAt?: number) {
    // node-web-audio-api's worker has crashed after several long offline renders in a row: keep them short
    const seconds = 14
    const ctx = new WA.OfflineAudioContext(2, SR * seconds, SR)
    const mono = (x: Float32Array) => { const b = ctx.createBuffer(1, x.length, SR); b.copyToChannel(x, 0); return b }
    const merger = ctx.createChannelMerger(2)
    merger.connect(ctx.destination)
    const l = ctx.createGain(), r = ctx.createGain()
    l.connect(merger, 0, 0)
    r.connect(merger, 0, 1)
    // A preview 4 s before the exit, started at ctx time 0 (blend 4–10 s)
    const s = buildSchedule(timing, { t0: 4, leadIn: 4, fromWindowStart: 0, toWindowStart: 0, sampleRate: SR })
    buildTransitionGraph(ctx, { from: mono(from), to: mono(to) }, cueAt === undefined ? s : cueSchedule(s, cueAt), l, r)
    const out = await ctx.startRendering()
    return [out.getChannelData(0), out.getChannelData(1)] as Float32Array[]
  }

  it('fades, bass swap and filter join in exactly where they are', async () => {
    const full = await render(shaped)
    // Before the exit, mid-blend (curves, bass swap, filter sweep), during the filter release, after it
    for (const at of [2, 6.3, 10.6, 12]) {
      const cued = await render(shaped, at)
      // Filters need a moment to settle from silence
      const a = Math.round((at + 0.05) * SR)
      let worst = 0, before = 0
      for (let c = 0; c < 2; c++) {
        for (let i = a; i < full[c].length; i++) worst = Math.max(worst, Math.abs(cued[c][i] - full[c][i]))
        for (let i = 0; i < Math.round(at * SR) - 1; i++) before = Math.max(before, Math.abs(cued[c][i]))
      }
      expect(before, `silent before ${at}`).toBe(0)
      expect(worst, `differs from the full preview after ${at}`).toBeLessThan(1e-3)
    }
  }, 60000)

  it('a resampled (vinyl) song changing speed picks up within a sample or two of where it is', async () => {
    const timing: TransitionTiming = { ...shaped, rateTo: 0.96, rampBack: 3 }
    const full = await render(timing)
    for (const at of [6.3, 11.2]) {
      const cued = await render(timing, at)
      // Web Audio updates playbackRate once per 128-frame block, so during a speed ramp the
      // full preview runs up to ~1 sample behind the exact position the cue starts from
      for (const T of [at + 0.2, 12.5, 13.5]) {
        const a = Math.round(T * SR), n = 4096
        let best = -1, lag = 0
        for (let L = -4; L <= 4; L++) {
          let sxy = 0, sxx = 0, syy = 0
          for (let i = 0; i < n; i++) { const u = cued[1][a + i], w = full[1][a + i + L]; sxy += u * w; sxx += u * u; syy += w * w }
          const c = sxy / Math.sqrt(sxx * syy)
          if (c > best) { best = c; lag = L }
        }
        expect(Math.abs(lag), `offset at ${T} after cueing at ${at}`).toBeLessThanOrEqual(2)
        expect(best).toBeGreaterThan(0.99)
      }
    }
  }, 60000)
})
