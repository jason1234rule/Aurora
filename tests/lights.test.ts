import { describe, it, expect } from 'vitest'
import { packet, colourPackets } from '@/utils/lights/govee'
import { frame, beatPosition, type ShowInput } from '@/utils/lights/show'
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
    expect(colourPackets([1, 2, 3], 'ihoment_H6008_3B85').map(p => p[2])).toEqual([0x02])
  })
})

describe('light show', () => {
  it('finds beats and bars', () => {
    expect(beatPosition(grid, 0.25)).toMatchObject({ beat: 0, inBar: 0, bar: 0 })
    expect(beatPosition(grid, 0.8)).toMatchObject({ beat: 1, inBar: 1 })
    expect(beatPosition(grid, 2.3)).toMatchObject({ beat: 4, inBar: 0, bar: 1 })
  })
  it('pulses on the beat and fades before the next', () => {
    const onBeat = frame({ ...base, t: 0.26 })
    const late = frame({ ...base, t: 0.7 })
    expect(level(onBeat[0])).toBeGreaterThan(240)
    expect(level(late[0])).toBeLessThan(level(onBeat[0]) / 2)
  })
  it('hits the first beat of a bar harder', () => {
    expect(level(frame({ ...base, t: 0.26 })[0])).toBeGreaterThan(level(frame({ ...base, t: 0.76 })[0]))
  })
  it('gives bulbs the cover colours and turns them every two bars', () => {
    const a = frame({ ...base, t: 0.26 })
    expect(a[0][0]).toBeGreaterThan(200) // red
    expect(a[1][2]).toBeGreaterThan(200) // blue
    const b = frame({ ...base, t: 0.26 + 8 * 0.5 }) // two bars later
    expect(b[0][2]).toBeGreaterThan(200)
  })
  it('chases one bulb per beat in party mode', () => {
    const f = frame({ ...base, intensity: 'party', t: 0.76 }) // beat 1
    const lit = f.map(level)
    expect(lit.indexOf(Math.max(...lit))).toBe(1)
  })
  it('blends to the next song during a transition and flashes on the bass swap', () => {
    const half = frame({ ...base, t: 0.26, palette: [red], next: { palette: [blue], mix: 0.5 } })
    expect(half[0][0]).toBeGreaterThan(100)
    expect(half[0][2]).toBeGreaterThan(100)
    const flash = frame({ ...base, t: 0.26, palette: [red], flash: 1 })
    expect(flash[0][1]).toBeGreaterThan(200)
  })
  it('breathes when there is no beat to follow', () => {
    const f = frame({ ...base, grid: null })
    expect(f).toHaveLength(4)
    expect(level(f[0])).toBeGreaterThan(0)
  })
  it('never fully blacks out a bulb', () => {
    const f = frame({ ...base, intensity: 'party', t: 0.74 })
    for (const c of f) expect(level(c)).toBeGreaterThan(0)
  })
})
