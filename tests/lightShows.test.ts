import { describe, it, expect } from 'vitest'
import { showFrame, timingFromGrid, detectSections, suggestShow, changesPerSecond, blockFor, paletteLook } from '@/utils/lights/handmade'
import type { LightShow } from '@/types/lightShow'

const BULBS = ['a', 'b', 'c', 'd']
const period = 0.5
const red = '#ff0000', blue = '#0000ff'
const show = (patch: Partial<LightShow> = {}): LightShow => ({
  id: 'x', key: 'k', path: '/p', title: 'T', artist: 'A', duration: 120, origin: 1, period,
  blocks: [], accents: [], sections: [], beatFlash: false, needsReview: false, createdAt: 0, updatedAt: 0, ...patch,
})
const block = (target: string, start: number, len: number, look = paletteLook('L', [red, blue], BULBS, 'hold', 50, 100)) =>
  ({ id: `${target}${start}`, target, start, len, look })
const level = (c: number[]) => Math.max(...c)
// Seconds at bar b, beat k (0-3), phase p
const at = (b: number, k = 0, p = 0.1) => 1 + (b * 4 + k + p) * period

describe('show timing', () => {
  it('puts bar 1 on the first downbeat at or after 0 s', () => {
    // Kiss Me More: first sustained beat at 24.93 s, 111 BPM → bar 1 at 1.15 s
    const t = timingFromGrid({ bpm: 111, offset: 24.928913661246533, period: 60 / 111, downbeatPhase: 0, confidence: 0.7 })
    expect(t.origin).toBeCloseTo(1.145, 2)
  })
})

describe('showFrame', () => {
  it('colours each bulb from the room-wide look', () => {
    const f = showFrame(show({ blocks: [block('all', 0, 8)] }), at(1), BULBS)
    expect(f[0]).toEqual([255, 0, 0])
    expect(f[1]).toEqual([0, 0, 255])
  })
  it('a bulb\'s own block overrides the room-wide one, only where it is', () => {
    const solo = block('c', 2, 2, { ...paletteLook('S', [red], BULBS, 'hold', 100, 100), colour: '#00ff00' })
    const s = show({ blocks: [block('all', 0, 8), solo] })
    expect(showFrame(s, at(2), BULBS)[2]).toEqual([0, 255, 0])
    expect(showFrame(s, at(2), BULBS)[0]).toEqual([255, 0, 0])
    expect(showFrame(s, at(5), BULBS)[2]).toEqual([255, 0, 0])
    expect(blockFor(s, 'c', 2)).toBe(solo)
  })
  it('is dark where there is no block', () => {
    expect(showFrame(show(), at(1), BULBS)[0]).toEqual([0, 0, 0])
  })
  it('pulse hits for half a beat then drops to the low level', () => {
    const s = show({ blocks: [block('all', 0, 8, paletteLook('P', [red], BULBS, 'pulse', 20, 100))] })
    expect(level(showFrame(s, at(1, 1, 0.1), BULBS)[0])).toBe(255)
    expect(level(showFrame(s, at(1, 1, 0.7), BULBS)[0])).toBe(51)
  })
  it('chase lights one bulb per beat', () => {
    const s = show({ blocks: [block('all', 0, 8, paletteLook('C', [red], BULBS, 'chase', 10, 100))] })
    const f = showFrame(s, at(0, 2), BULBS).map(level)
    expect(f.indexOf(255)).toBe(2)
    expect(f.filter(v => v === 255)).toHaveLength(1)
  })
  it('accents: flash to white, blackout, colour hit', () => {
    const base = { blocks: [block('all', 0, 8)] }
    expect(showFrame(show({ ...base, accents: [{ id: '1', beat: 4, type: 'flash' }] }), at(1, 0, 0.05), BULBS)[1][1]).toBeGreaterThan(200)
    expect(showFrame(show({ ...base, accents: [{ id: '1', beat: 4, type: 'blackout' }] }), at(1, 0, 0.5), BULBS)[0]).toEqual([0, 0, 0])
    expect(showFrame(show({ ...base, accents: [{ id: '1', beat: 4, type: 'hit', colour: '#00ff00' }] }), at(1, 0, 0.3), BULBS)[0]).toEqual([0, 255, 0])
  })
  it('beat flash brightens every bulb right on the beat', () => {
    const s = show({ blocks: [block('all', 0, 8, paletteLook('H', [red], BULBS, 'hold', 50, 50))] })
    const off = level(showFrame(s, at(1, 1, 0.01), BULBS)[0])
    const on = level(showFrame({ ...s, beatFlash: true }, at(1, 1, 0.01), BULBS)[0])
    expect(on).toBeGreaterThan(off * 1.5)
  })
})

describe('sections and suggest', () => {
  const energy = [...Array(8).fill(0.1), ...Array(16).fill(0.5), ...Array(4).fill(0.6), ...Array(8).fill(0.9), ...Array(8).fill(0.2), ...Array(8).fill(0.95), ...Array(4).fill(0.1)]
  const sections = detectSections(energy)
  it('separates verses from choruses in a song that is loud throughout', () => {
    // Kiss Me More's energy per 4-bar phrase: quiet intro, then everything is fairly loud
    const phrases = [0, 0.04, 0.26, 0.9, 0.91, 0.86, 0.83, 0.73, 0.71, 0.84, 0.78, 0.9, 0.92, 0.86, 0.72, 0.48, 0.89, 0.89, 0.82, 0.89, 0.84, 0.9, 0.63, 0]
    const names = detectSections(phrases.flatMap(e => [e, e, e, e])).map(s => s.name)
    expect(names.slice(0, 4)).toEqual(['Intro', 'Chorus', 'Verse', 'Chorus'])
    expect(names.filter(n => n === 'Chorus').length).toBeGreaterThanOrEqual(3)
  })
  it('names sections from the energy', () => {
    expect(sections.map(s => s.name)).toEqual(['Intro', 'Verse', 'Chorus', 'Break', 'Chorus', 'Outro'])
    expect(sections[2]).toMatchObject({ start: 28, len: 8 })
  })
  it('suggests a block per section, flashes on choruses and a blackout after a break', () => {
    const { blocks, accents } = suggestShow(sections, [red, blue], BULBS)
    expect(blocks).toHaveLength(sections.length)
    expect(blocks.every(b => b.target === 'all')).toBe(true)
    expect(accents.filter(a => a.type === 'flash').map(a => a.beat)).toEqual([28 * 4, 44 * 4])
    expect(accents.find(a => a.type === 'blackout')?.beat).toBe(44 * 4 - 1)
  })
  it('flags looks that are too fast for the bulbs', () => {
    expect(changesPerSecond({ motion: 'pulse', half: false }, 60 / 111)).toBeLessThan(5)
    expect(changesPerSecond({ motion: 'pulse', half: false }, 60 / 170)).toBeGreaterThan(5)
    expect(changesPerSecond({ motion: 'pulse', half: true }, 60 / 170)).toBeLessThan(5)
  })
})
