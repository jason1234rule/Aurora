import { describe, it, expect } from 'vitest'
import { findAlignment, mixToMono } from '@/utils/transitions/align'
import { clickTrack, noise } from './helpers'

describe('findAlignment', () => {
  const sr = 48000

  it('finds the exact offset of a scaled, noisy capture', () => {
    const ref = noise(sr * 5, 7)
    const at = 123457
    const n = 16384
    const hiss = noise(n, 99)
    const cap = new Float32Array(n)
    for (let i = 0; i < n; i++) cap[i] = ref[at + i] * 0.3 + hiss[i] * 0.01
    const r = findAlignment(ref, cap, at + 4000, 12000)
    expect(r?.index).toBe(at)
    expect(r!.score).toBeGreaterThan(0.95)
  })

  it('works on music-like material (clicks over a quiet bed)', () => {
    const { data } = clickTrack(sr, 6, 128, 0.2)
    const bed = noise(data.length, 3)
    for (let i = 0; i < data.length; i++) data[i] = data[i] * 0.8 + bed[i] * 0.05
    const at = 2 * sr + 777
    const cap = data.slice(at, at + 16384)
    expect(findAlignment(data, cap, at - 7000, 12000)?.index).toBe(at)
  })

  it('returns null for silence or an impossible window', () => {
    const ref = noise(sr, 1)
    expect(findAlignment(ref, new Float32Array(8192), 1000, 1000)).toBeNull()
    expect(findAlignment(ref, ref.slice(0, 8192), sr * 3, 100)).toBeNull()
  })

  it('mixToMono averages channels', () => {
    const l = new Float32Array([1, 0, 0.5]), r = new Float32Array([0, 1, 0.5])
    const mono = mixToMono({ numberOfChannels: 2, length: 3, getChannelData: (c) => (c ? r : l) })
    expect(Array.from(mono)).toEqual([0.5, 0.5, 0.5])
  })
})
