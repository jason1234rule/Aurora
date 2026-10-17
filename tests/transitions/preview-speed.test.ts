/**
 * Editor preview at another speed (renderPreviewSpeed): slowed down or sped up, every beat of
 * both songs must still be where the transition puts it.
 */
import { describe, it, expect } from 'vitest'
import { buildSchedule, fromTimeAt, toTimeAt, type TransitionTiming } from '@/utils/transitions/schedule'
import { renderStretch } from '@/utils/transitions/stretch/core'
import { renderPreviewSpeed } from '@/utils/transitions/previewSpeed'
import { clickTrack, peakNear } from './helpers'

let WA: any = null
try {
  WA = await import('node-web-audio-api')
} catch (err) {
  console.warn('node-web-audio-api unavailable, skipping offline render tests:', (err as Error).message)
}

const d = WA ? describe : describe.skip

d('preview at another speed', () => {
  const SR = 48000

  it('puts every beat of both songs where it belongs, slowed down or sped up', async () => {
    const f = clickTrack(SR, 40, 120, 0.37), t = clickTrack(SR, 40, 126, 0.11)
    const ctx = new WA.OfflineAudioContext(1, 1, SR)
    const mono = (x: Float32Array) => { const b = ctx.createBuffer(1, x.length, SR); b.copyToChannel(x, 0); return b }
    const timing: TransitionTiming = {
      type: 'blend', exitAt: f.beats[40], entryAt: t.beats[8], overlap: 8, fadeOut: 'linear', fadeIn: 'linear', rateTo: 120 / 126, rampBack: 2,
    }
    const preRoll = 5, postRoll = 4
    // Heard time 0 = the start of the stems, preRoll before the exit
    const s = buildSchedule(timing, { t0: preRoll, leadIn: preRoll, fromWindowStart: 0, toWindowStart: 0 })
    for (const speed of [0.5, 1.5]) {
      const started = performance.now()
      const mix = await renderPreviewSpeed({ from: mono(f.data), to: mono(t.data) }, undefined, timing, { preRoll, postRoll, speed }, renderStretch, WA.OfflineAudioContext)
      console.log(`preview stems at ${speed}x: ${(performance.now() - started).toFixed(0)} ms for ${mix.duration.toFixed(1)} s`)
      expect(mix.duration).toBeCloseTo(preRoll + 8 + postRoll, 9)
      expect(mix.from.duration).toBeCloseTo(mix.duration / speed, 2)
      const check = (buf: AudioBuffer, times: number[], lo: number, hi: number) => {
        let worst = 0, n = 0
        for (const heard of times) {
          if (heard < lo || heard > hi) continue
          const p = peakNear(buf.getChannelData(0) as Float32Array, SR, heard / speed, 0.02, 0.05)
          expect(p, `beat at ${heard.toFixed(3)} s`).not.toBeNull()
          worst = Math.max(worst, Math.abs(p! - heard / speed) * speed)
          n++
        }
        return { worst, n }
      }
      const fromRes = check(mix.from, f.beats.map(b => fromTimeAt(timing.exitAt, s, b)), 0.5, s.overlapEnd - 1)
      const toRes = check(mix.to, t.beats.map(b => toTimeAt(s, b)), s.t0 + 1, mix.duration - 0.5)
      console.log(`  FROM worst ${(fromRes.worst * 1000).toFixed(2)} ms over ${fromRes.n}, TO worst ${(toRes.worst * 1000).toFixed(2)} ms over ${toRes.n} (in transition time)`)
      expect(fromRes.n).toBeGreaterThan(10)
      expect(toRes.n).toBeGreaterThan(10)
      // Measured in the transition's own time, so a slowed preview is held to the same standard
      expect(fromRes.worst).toBeLessThan(0.002)
      expect(toRes.worst).toBeLessThan(0.002)
    }
  }, 120000)
})
