import { describe, it, expect } from 'vitest'
import { packet, colourPackets } from '@/utils/lights/govee'
import { frame, beatPosition, type ShowInput } from '@/utils/lights/show'
import { computeEnergy, energyAt } from '@/utils/lights/energy'
import type { BeatGrid } from '@/types/transition'

const grid: BeatGrid = { bpm: 120, offset: 0.25, period: 0.5, downbeatPhase: 0, confidence: 0.8 }
const red: [number, number, number] = [255, 0, 0]
const blue: [number, number, number] = [0, 0, 255]
const base: ShowInput = { t: 0, grid, palette: [red, blue], bulbs: 4, intensity: 'normal' }
const level = (c: number[]) => Math.max(...c)

describe('Govee packets', () => {
  it('are 20 bytes ending in an XOR checksum', () => {
    // Same bytes the Python test sent to the Dresser bulb
    const p = packet(0x33, 0x05, 0x02, 255, 0, 0)
    expect(p.length).toBe(20)
    expect([...p.slice(0, 6)]).toEqual([0x33, 0x05, 0x02, 255, 0, 0])
    expect(p[19]).toBe(0x33 ^ 0x05 ^ 0x02 ^ 255)
  })
  it('send the colour command each model uses (both for unknown models)', () => {
    expect(colourPackets([1, 2, 3], 'ihoment_H6006_9075').map(p => p[2])).toEqual([0x0d])
    expect(colourPackets([1, 2, 3], 'Govee_H6076_218E').map(p => p[2])).toEqual([0x02, 0x0d])
    expect(colourPackets([1, 2, 3], 'ihoment_H6008_3B85').map(p => p[2])).toEqual([0x0d])
  })
})

describe('energy', () => {
  const sr = 1000
  // 10 s quiet, then 10 s loud
  const sig = new Float32Array(20 * sr).map((_, i) => (i < 10 * sr ? 0.02 : 0.5) * Math.sin(i / 3))
  const e = computeEnergy([sig], sr)
  it('is low in quiet parts and high in loud ones', () => {
    expect(energyAt(e, 8)).toBeLessThan(0.15)
    expect(energyAt(e, 18)).toBeGreaterThan(0.85)
  })
  it('finds the drop', () => {
    expect(e.drops).toHaveLength(1)
    expect(e.drops[0]).toBeGreaterThan(9.9)
    expect(e.drops[0]).toBeLessThan(12)
  })
})

describe('light show', () => {
  const sr = 1000
  const quietLoud = computeEnergy([new Float32Array(20 * sr).map((_, i) => (i < 10 * sr ? 0.02 : 0.5) * Math.sin(i / 3))], sr)
  it('finds beats and bars', () => {
    expect(beatPosition(grid, 0.25)).toMatchObject({ beat: 0, inBar: 0, bar: 0 })
    expect(beatPosition(grid, 0.8)).toMatchObject({ beat: 1, inBar: 1 })
    expect(beatPosition(grid, 2.3)).toMatchObject({ beat: 4, inBar: 0, bar: 1 })
  })
  it('normal: dim in quiet parts, bright in loud ones', () => {
    const quiet = frame({ ...base, energy: quietLoud, t: 8.76 })
    const loud = frame({ ...base, energy: quietLoud, t: 18.76 })
    expect(level(quiet[0])).toBeLessThan(level(loud[0]) * 0.6)
  })
  it('normal: holds steady within a beat (no stepped fades)', () => {
    const a = frame({ ...base, energy: quietLoud, t: 8.76 }), b = frame({ ...base, energy: quietLoud, t: 8.95 })
    expect(a).toEqual(b)
  })
  it('normal: colours move every bar when loud, every 4 bars when quiet', () => {
    const loudA = frame({ ...base, energy: quietLoud, t: 16.26 + 0.6 }), loudB = frame({ ...base, energy: quietLoud, t: 18.26 + 0.6 })
    expect(loudA[0]).not.toEqual(loudB[0])
    const quietA = frame({ ...base, energy: quietLoud, t: 4.26 + 0.6 }), quietB = frame({ ...base, energy: quietLoud, t: 6.26 + 0.6 })
    expect(quietA[0]).toEqual(quietB[0])
  })
  it('gives bulbs the cover colours', () => {
    const f = frame({ ...base, t: 0.76 })
    expect(f[0][0]).toBeGreaterThan(f[0][2]) // red
    expect(f[1][2]).toBeGreaterThan(f[1][0]) // blue
  })
  it('party: hits then holds, two levels per beat', () => {
    const hit = frame({ ...base, intensity: 'party', t: 0.3 })
    const held = frame({ ...base, intensity: 'party', t: 0.6 })
    expect(level(hit[0])).toBeGreaterThan(level(held[0]) * 1.5)
    expect(frame({ ...base, intensity: 'party', t: 0.65 })).toEqual(held)
  })
  it('party: bar starts hit every bulb, other beats half the room', () => {
    const down = frame({ ...base, intensity: 'party', t: 0.3 }).map(level)
    expect(Math.min(...down)).toBeGreaterThan(200)
    const off = frame({ ...base, intensity: 'party', t: 0.8 }).map(level)
    expect(off.filter(v => v > 200)).toHaveLength(2)
  })
  it('party: flashes white on a drop', () => {
    const f = frame({ ...base, intensity: 'party', palette: [red], energy: quietLoud, t: quietLoud.drops[0] + 0.05 })
    expect(f[0][1]).toBeGreaterThan(150)
  })
  it('blends to the next song during a transition and flashes on the bass swap', () => {
    const half = frame({ ...base, t: 0.76, palette: [red], next: { palette: [blue], mix: 0.5 } })
    expect(half[0][0]).toBeGreaterThan(50)
    expect(half[0][2]).toBeGreaterThan(50)
    const flash = frame({ ...base, t: 0.76, palette: [red], flash: 1 })
    expect(flash[0][1]).toBeGreaterThan(100)
  })
  it('keeps going without a beat grid', () => {
    const f = frame({ ...base, grid: null, intensity: 'party' })
    expect(f).toHaveLength(4)
    expect(level(f[0])).toBeGreaterThan(0)
  })
})
