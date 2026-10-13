import { describe, it, expect } from 'vitest'
import { analyzeBeats, beatTime, beatIndexAt, nearestBeat, isDownbeat, beatsBetween } from '@/utils/transitions/beatgrid'
import { suggestTransition, isUsableGrid, MIN_GRID_CONFIDENCE, type TransitionSuggestion } from '@/utils/transitions/suggest'
import { MAX_RATE_DEVIATION } from '@/utils/transitions/schedule'
import type { BeatGrid } from '@/types/transition'
import { clickTrack, noise } from './helpers'

// 22.05 kHz keeps synthesis and analysis cheap; other rates are covered separately
const SR = 22050

interface Synth { data: Float32Array; beats: number[] }

/** Clicks over a quiet noise bed, optionally with a 60 Hz thump on every 4th beat from `accent`. */
function clicks(bpm: number, seconds: number, offset: number, opts: { sr?: number; bed?: number; seed?: number; accent?: number } = {}): Synth {
  const sr = opts.sr ?? SR
  const { data, beats } = clickTrack(sr, seconds, bpm, offset)
  const bed = noise(data.length, opts.seed ?? 3)
  const level = opts.bed ?? 0.05
  for (let i = 0; i < data.length; i++) data[i] = data[i] * 0.8 + bed[i] * level
  if (opts.accent !== undefined) {
    beats.forEach((t, k) => {
      if (k % 4 !== opts.accent) return
      const s = Math.round(t * sr)
      for (let i = 0; i < Math.round(0.25 * sr) && s + i < data.length; i++) {
        data[s + i] += 0.8 * Math.exp(-i / sr / 0.06) * Math.sin(2 * Math.PI * 60 * i / sr)
      }
    })
  }
  return { data, beats }
}

function distanceToNearest(sorted: number[], t: number): number {
  let lo = 0, hi = sorted.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < t) lo = mid
    else hi = mid
  }
  return Math.min(Math.abs(sorted[lo] - t), Math.abs(sorted[hi] - t))
}

/** Worst distance from any predicted beat inside the clicks' span to the nearest true click. */
function worstBeatError(grid: BeatGrid, beats: number[]): { worst: number; count: number } {
  const first = beats[0], last = beats[beats.length - 1]
  let worst = 0, count = 0
  for (let i = Math.ceil(beatIndexAt(grid, first - 0.01)); beatTime(grid, i) <= last + 0.01; i++) {
    worst = Math.max(worst, distanceToNearest(beats, beatTime(grid, i)))
    count++
  }
  return { worst, count }
}

function expectFinite(grid: BeatGrid) {
  for (const v of Object.values(grid)) expect(Number.isFinite(v)).toBe(true)
}

const EMPTY: BeatGrid = { bpm: 0, offset: 0, period: 0, downbeatPhase: 0, confidence: 0 }

describe('analyzeBeats on click tracks', () => {
  it.each([
    [90, 0.05], [90, 0.41],
    [120, 0], [120, 0.137],
    [128, 0.2], [128, 0.333],
    [140, 0.09], [140, 0.4],
    [174, 0.15], [174, 0.3],
  ])('%d BPM, first click at %d s', (bpm, offset) => {
    const { data, beats } = clicks(bpm, 40, offset)
    const grid = analyzeBeats(data, SR)
    // A bare 174 BPM click is equally periodic at 87; the prior around 120 may pick
    // either, and every grid line still lands on a click (see analyzeBeats docs)
    const truth = bpm === 174 && Math.abs(grid.bpm - 87) < 1 ? 87 : bpm
    expect(Math.abs(grid.bpm - truth)).toBeLessThan(0.05)
    expect(grid.period).toBeCloseTo(60 / grid.bpm, 12)
    // At half tempo the first grid line may be the first or the second click
    const firstBeats = truth === bpm ? [beats[0]] : beats.slice(0, 2)
    expect(Math.min(...firstBeats.map(b => Math.abs(grid.offset - b)))).toBeLessThan(0.005)
    const { worst, count } = worstBeatError(grid, beats)
    expect(worst).toBeLessThan(0.005)
    expect(count).toBeGreaterThanOrEqual(Math.floor(beats.length * truth / bpm) - 1)
    expect(grid.confidence).toBeGreaterThan(0.8)
    // Identical clicks give no accent to go on: the first beat is taken as the downbeat
    expect(grid.downbeatPhase).toBe(0)
  })

  it('does not drift over a 3-minute track', () => {
    // Non-integer tempo, so the result can't lean on bpm snapping
    const { data, beats } = clicks(123.45, 180, 0.213)
    const grid = analyzeBeats(data, SR)
    expect(Math.abs(grid.bpm - 123.45)).toBeLessThan(0.05)
    const { worst, count } = worstBeatError(grid, beats)
    expect(count).toBe(beats.length)
    expect(worst).toBeLessThan(0.005)
  })

  it('stays locked with a much louder noise bed', () => {
    const { data, beats } = clicks(128, 60, 0.2, { bed: 0.4, seed: 8 })
    const grid = analyzeBeats(data, SR)
    expect(Math.abs(grid.bpm - 128)).toBeLessThan(0.05)
    expect(worstBeatError(grid, beats).worst).toBeLessThan(0.005)
    expect(grid.confidence).toBeGreaterThan(0.5)
  })

  it('works at the usual decode rates', () => {
    for (const sr of [44100, 48000]) {
      const { data, beats } = clicks(126, 20, 0.31, { sr })
      const grid = analyzeBeats(data, sr)
      expect(Math.abs(grid.bpm - 126)).toBeLessThan(0.05)
      expect(Math.abs(grid.offset - beats[0])).toBeLessThan(0.005)
      expect(worstBeatError(grid, beats).worst).toBeLessThan(0.005)
    }
  })

  it('skips leading near-silence: offset is the first real beat', () => {
    const lead = 10
    const { data, beats } = clicks(124, 50, 0.25)
    const hiss = noise(lead * SR, 9)
    const audio = new Float32Array(lead * SR + data.length)
    for (let i = 0; i < hiss.length; i++) audio[i] = hiss[i] * 1e-4
    audio.set(data, lead * SR)
    const grid = analyzeBeats(audio, SR)
    expect(Math.abs(grid.bpm - 124)).toBeLessThan(0.05)
    expect(Math.abs(grid.offset - (lead + beats[0]))).toBeLessThan(0.005)
    expect(worstBeatError(grid, beats.map(b => b + lead)).worst).toBeLessThan(0.005)
  })

  it('finds the downbeat from low-frequency accents', () => {
    for (const accent of [0, 1, 2, 3]) {
      const { data } = clicks(120, 30, 0.2, { accent })
      const grid = analyzeBeats(data, SR)
      expect(grid.offset).toBeCloseTo(0.2, 2)
      expect(grid.downbeatPhase).toBe(accent)
      expect(isDownbeat(grid, accent)).toBe(true)
    }
  })

  it('tolerates NaN and Infinity samples', () => {
    const { data, beats } = clicks(118, 30, 0.2)
    for (let i = 0; i < data.length; i += 5000) data[i] = NaN
    data[1234] = Infinity
    const grid = analyzeBeats(data, SR)
    expectFinite(grid)
    expect(Math.abs(grid.bpm - 118)).toBeLessThan(0.05)
    expect(worstBeatError(grid, beats).worst).toBeLessThan(0.005)
  })

  it('analyses 5 minutes of 44.1 kHz audio in well under a second', () => {
    const { data } = clicks(126, 300, 0.3, { sr: 44100 })
    const t0 = performance.now()
    const grid = analyzeBeats(data, 44100)
    const elapsed = performance.now() - t0
    expect(Math.abs(grid.bpm - 126)).toBeLessThan(0.05)
    expect(elapsed).toBeLessThan(1000)
  })
})

describe('analyzeBeats without rhythm', () => {
  it('returns the empty grid for silence, too-short or invalid input', () => {
    expect(analyzeBeats(new Float32Array(SR * 30), SR)).toEqual(EMPTY)
    expect(analyzeBeats(clicks(120, 2, 0.1).data, SR)).toEqual(EMPTY)
    expect(analyzeBeats(new Float32Array(0), SR)).toEqual(EMPTY)
    const { data } = clicks(120, 10, 0.1)
    expect(analyzeBeats(data, 0)).toEqual(EMPTY)
    expect(analyzeBeats(data, NaN)).toEqual(EMPTY)
  })

  it('reports near-zero confidence for noise', () => {
    for (const seed of [11, 22, 33, 44]) {
      const grid = analyzeBeats(noise(SR * 30, seed), SR)
      expectFinite(grid)
      expect(grid.confidence).toBeLessThan(0.1)
    }
  })

  it('reports near-zero confidence for a steady tone', () => {
    const tone = new Float32Array(SR * 20)
    for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR)
    const grid = analyzeBeats(tone, SR)
    expectFinite(grid)
    expect(grid.confidence).toBeLessThan(0.1)
  })
})

describe('grid helpers', () => {
  const grid: BeatGrid = { bpm: 120, offset: 1.25, period: 0.5, downbeatPhase: 2, confidence: 1 }

  it('beatTime / beatIndexAt are inverses, negative indices included', () => {
    expect(beatTime(grid, 0)).toBe(1.25)
    expect(beatTime(grid, 4)).toBe(3.25)
    expect(beatTime(grid, -2)).toBe(0.25)
    expect(beatIndexAt(grid, 3.5)).toBe(4.5)
    expect(beatIndexAt(grid, 0)).toBe(-2.5)
    for (const i of [-3, 0, 7, 100]) expect(beatIndexAt(grid, beatTime(grid, i))).toBeCloseTo(i, 9)
  })

  it('nearestBeat snaps to the closest grid line', () => {
    expect(nearestBeat(grid, 3.3)).toBe(3.25)
    expect(nearestBeat(grid, 3.6)).toBe(3.75)
    expect(nearestBeat(grid, 0.3)).toBe(0.25)
  })

  it('isDownbeat follows downbeatPhase every 4 beats', () => {
    expect([-2, 2, 6, 10].every(i => isDownbeat(grid, i))).toBe(true)
    expect([-1, 0, 1, 3, 4, 5, 2.5].some(i => isDownbeat(grid, i))).toBe(false)
  })

  it('beatsBetween is inclusive at both ends', () => {
    expect(beatsBetween(grid, 2.25, 4.25)).toEqual([2.25, 2.75, 3.25, 3.75, 4.25])
    expect(beatsBetween(grid, 2.3, 2.7)).toEqual([])
    expect(beatsBetween(grid, 0, 1)).toEqual([0.25, 0.75])
    expect(beatsBetween(grid, 4, 2)).toEqual([])
  })

  it('degrade gracefully on an empty grid', () => {
    expect(beatTime(EMPTY, 5)).toBe(0)
    expect(beatIndexAt(EMPTY, 12)).toBe(0)
    expect(nearestBeat(EMPTY, 12)).toBe(0)
    expect(beatsBetween(EMPTY, 0, 100)).toEqual([])
  })
})

describe('suggestTransition', () => {
  const grid = (bpm: number, offset: number, downbeatPhase = 0, confidence = 0.9): BeatGrid =>
    ({ bpm, offset, period: 60 / bpm, downbeatPhase, confidence })

  function expectValid(s: TransitionSuggestion, fromDuration: number, toDuration: number) {
    for (const v of [s.exitAt, s.entryAt, s.overlap, s.rateTo]) expect(Number.isFinite(v)).toBe(true)
    expect(s.exitAt).toBeGreaterThanOrEqual(0)
    expect(s.overlap).toBeGreaterThan(0)
    expect(s.exitAt + s.overlap).toBeLessThanOrEqual(fromDuration)
    expect(s.entryAt).toBeGreaterThanOrEqual(0)
    expect(s.entryAt).toBeLessThan(toDuration)
    expect(Math.abs(s.rateTo! - 1)).toBeLessThanOrEqual(MAX_RATE_DEVIATION + 1e-12)
    if (s.bassSwap) {
      expect(s.bassSwap.at).toBeGreaterThanOrEqual(0)
      expect(s.bassSwap.at).toBeLessThanOrEqual(s.overlap)
    }
  }

  it('beat-matches close tempos from the latest 32-beat phrase boundary', () => {
    const from = grid(128, 0.3, 1), to = grid(127, 1.1, 2)
    const s = suggestTransition({ from: { grid: from, duration: 240 }, to: { grid: to, duration: 200 } })
    expectValid(s, 240, 200)
    expect(s).toMatchObject({ type: 'blend', fadeOut: 'equal-power', fadeIn: 'equal-power' })
    expect(s.rateTo).toBeCloseTo(128 / 127, 12)
    expect(s.overlap).toBeCloseTo(16 * from.period, 9)

    const idx = beatIndexAt(from, s.exitAt)
    expect(idx).toBeCloseTo(Math.round(idx), 6)
    expect((Math.round(idx) - 1) % 32).toBe(0) // counted from the first downbeat (beat 1)
    expect(s.exitAt + s.overlap).toBeLessThanOrEqual(240 - 2)
    // ...and it's the latest such boundary
    expect(beatTime(from, Math.round(idx) + 32) + s.overlap).toBeGreaterThan(240 - 2)

    expect(s.entryAt).toBeCloseTo(beatTime(to, 2), 9)
    expect(s.bassSwap!.at).toBeCloseTo(8 * from.period, 9)
    expect(isDownbeat(from, Math.round(beatIndexAt(from, s.exitAt + s.bassSwap!.at)))).toBe(true)
  })

  it('keeps TO at its own speed with an 8-beat overlap when tempos are more than 10% apart', () => {
    for (const [fromBpm, toBpm] of [[130, 115], [100, 115]]) {
      const from = grid(fromBpm, 0.2)
      const s = suggestTransition({ from: { grid: from, duration: 200 }, to: { grid: grid(toBpm, 0.5), duration: 180 } })
      expectValid(s, 200, 180)
      expect(s.rateTo).toBe(1)
      expect(s.overlap).toBeCloseTo(8 * from.period, 9)
      expect(s.bassSwap!.at).toBeCloseTo(4 * from.period, 9)
    }
  })

  it('rateTo is FROM/TO within ±10%, including the edge', () => {
    // 130 → 120 is the Megan Thee Stallion → Doja Cat example from the stretch handoff
    for (const [fromBpm, toBpm] of [[123, 120], [120, 123], [130, 120], [110, 100], [100, 110]]) {
      const s = suggestTransition({ from: { grid: grid(fromBpm, 0), duration: 200 }, to: { grid: grid(toBpm, 0), duration: 200 } })
      expect(s.rateTo).toBeCloseTo(fromBpm / toBpm, 9)
      expect(Math.abs(s.rateTo! - 1)).toBeLessThanOrEqual(MAX_RATE_DEVIATION + 1e-12)
      expect(s.overlap).toBeCloseTo(16 * 60 / fromBpm, 9)
    }
  })

  it('falls back to a 16-beat boundary when no later 32-beat one fits', () => {
    // 22 s song: the 32-beat boundary at 16.2 s + 8 s overlap overruns, 8.2 s doesn't
    const s = suggestTransition({ from: { grid: grid(120, 0.2), duration: 22 }, to: { grid: grid(120, 0.4), duration: 100 } })
    expectValid(s, 22, 100)
    expect(s.exitAt).toBeCloseTo(8.2, 9)
    expect(s.overlap).toBeCloseTo(8, 9)
  })

  it('treats low-confidence and empty grids as missing', () => {
    expect(isUsableGrid(grid(120, 0, 0, MIN_GRID_CONFIDENCE))).toBe(true)
    expect(isUsableGrid(grid(120, 0, 0, 0.29))).toBe(false)
    expect(isUsableGrid(EMPTY)).toBe(false)
    expect(isUsableGrid(null)).toBe(false)
    const s = suggestTransition({ from: { grid: grid(120, 0, 0, 0.2), duration: 200 }, to: { grid: EMPTY, duration: 100 } })
    expect(s).toMatchObject({ exitAt: 180, overlap: 8, entryAt: 0, rateTo: 1 })
    expect(s.bassSwap).toBeUndefined()
  })

  it('with only a FROM grid: phrase exit, entry at 0, 8 beats, no rate change or bass swap', () => {
    const from = grid(140, 0.5, 3)
    const s = suggestTransition({ from: { grid: from, duration: 210 }, to: { grid: null, duration: 190 } })
    expectValid(s, 210, 190)
    expect(s.entryAt).toBe(0)
    expect(s.rateTo).toBe(1)
    expect(s.overlap).toBeCloseTo(8 * from.period, 9)
    expect((Math.round(beatIndexAt(from, s.exitAt)) - 3) % 32).toBe(0)
    expect(s.bassSwap).toBeUndefined()
  })

  it("without a FROM grid: 20 s before the end, 8 s overlap, entry on TO's first downbeat", () => {
    const s = suggestTransition({ from: { grid: null, duration: 200 }, to: { grid: grid(100, 0.5, 3), duration: 150 } })
    expect(s).toMatchObject({ type: 'blend', exitAt: 180, overlap: 8, rateTo: 1 })
    expect(s.entryAt).toBeCloseTo(0.5 + 3 * 0.6, 9)
    expect(s.bassSwap).toBeUndefined()
  })

  it('shrinks the overlap for very short songs', () => {
    // 6 s at 120 BPM: 16 and 8 beats don't fit before the 2 s tail, 4 beats do
    const a = suggestTransition({ from: { grid: grid(120, 0.2), duration: 6 }, to: { grid: grid(120, 0.1), duration: 50 } })
    expectValid(a, 6, 50)
    expect(a.overlap).toBeCloseTo(2, 9)
    expect(a.exitAt).toBeCloseTo(0.2, 9)

    const b = suggestTransition({ from: { grid: null, duration: 5 }, to: { grid: null, duration: 5 } })
    expectValid(b, 5, 5)
    expect(b).toMatchObject({ exitAt: 2.5, overlap: 2.5, entryAt: 0 })

    const c = suggestTransition({ from: { grid: grid(90, 0.4), duration: 1 }, to: { grid: grid(90, 0.4), duration: 0.3 } })
    expectValid(c, 1, 0.3)
    expect(c.entryAt).toBe(0) // TO's first downbeat is past its end
  })

  it('always satisfies the invariants (randomised)', () => {
    let seed = 42
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const durations = [0.2, 1, 3, 7, 15, 25, 40, 90, 240, 600]
    const randomGrid = (): BeatGrid | null => {
      if (rnd() < 0.2) return null
      const bpm = 70 + rnd() * 110
      return { bpm, period: 60 / bpm, offset: rnd() < 0.8 ? rnd() * 5 : rnd() * 60, downbeatPhase: Math.floor(rnd() * 4), confidence: rnd() }
    }
    for (let i = 0; i < 3000; i++) {
      const fromDuration = durations[Math.floor(rnd() * durations.length)] * (0.5 + rnd())
      const toDuration = durations[Math.floor(rnd() * durations.length)] * (0.5 + rnd())
      const s = suggestTransition({ from: { grid: randomGrid(), duration: fromDuration }, to: { grid: randomGrid(), duration: toDuration } })
      expectValid(s, fromDuration, toDuration)
    }
  })

  it('lines up with analysed audio end to end', () => {
    const a = clicks(126, 120, 0.31, { accent: 1, seed: 5 })
    const b = clicks(124.5, 60, 1.7, { accent: 3, seed: 6 })
    const fromGrid = analyzeBeats(a.data, SR), toGrid = analyzeBeats(b.data, SR)
    const s = suggestTransition({ from: { grid: fromGrid, duration: 120 }, to: { grid: toGrid, duration: 60 } })
    expectValid(s, 120, 60)
    // Exit on a FROM click that starts a 32-beat phrase from its first accent
    expect(distanceToNearest(a.beats, s.exitAt)).toBeLessThan(0.005)
    expect(Math.round((s.exitAt - a.beats[1]) / (60 / 126)) % 32).toBe(0)
    // Entry on TO's first accented click
    expect(Math.abs(s.entryAt - b.beats[3])).toBeLessThan(0.005)
    expect(s.rateTo).toBeCloseTo(126 / 124.5, 3)
    expect(s.overlap).toBeCloseTo(16 * 60 / 126, 3)
  })
})
