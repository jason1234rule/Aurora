import { describe, it, expect } from 'vitest'
import { pickNextMix, type MixCandidate } from '@/utils/transitions/mix'
import type { Transition } from '@/types/transition'

function cand(key: string, needsReview = false): MixCandidate {
  return {
    key,
    track: { id: key, path: `/m/${key}.flac`, title: key, artist: 'a' } as Track,
    transition: { id: `t-${key}`, needsReview } as Transition,
  }
}

/** Deterministic generator cycling through evenly spaced values */
function sweep(n: number) {
  let i = 0
  return () => ((i++ % n) + 0.5) / n
}

describe('pickNextMix', () => {
  it('returns null with no candidates, or when all were played recently', () => {
    expect(pickNextMix({ candidates: [], recentKeys: [], contextKeys: new Set() })).toBeNull()
    expect(pickNextMix({ candidates: [cand('a'), cand('b')], recentKeys: ['a', 'b', 'x'], contextKeys: new Set() })).toBeNull()
  })

  it('skips transitions that need review', () => {
    const pick = pickNextMix({ candidates: [cand('a', true), cand('b')], recentKeys: [], contextKeys: new Set(), random: () => 0 })
    expect(pick?.key).toBe('b')
  })

  it('only avoids the last N tracks', () => {
    const recent = ['a', 'x1', 'x2', 'x3']
    const pick = pickNextMix({ candidates: [cand('a')], recentKeys: recent, contextKeys: new Set(), avoidLast: 3, random: () => 0 })
    expect(pick?.key).toBe('a')
    expect(pickNextMix({ candidates: [cand('a')], recentKeys: recent, contextKeys: new Set(), avoidLast: 4 })).toBeNull()
  })

  it('prefers targets in the current context, by weight', () => {
    const candidates = [cand('in'), cand('out1'), cand('out2')]
    const counts: Record<string, number> = { in: 0, out1: 0, out2: 0 }
    const random = sweep(600)
    for (let i = 0; i < 600; i++) {
      const p = pickNextMix({ candidates, recentKeys: [], contextKeys: new Set(['in']), contextWeight: 4, random })
      counts[p!.key]++
    }
    // weights 4 : 1 : 1 → 400 : 100 : 100
    expect(counts.in).toBe(400)
    expect(counts.out1).toBe(100)
    expect(counts.out2).toBe(100)
  })

  it('leans toward the target heard longest ago', () => {
    // 'old' was 12 plays ago, 'new' 9 plays ago: weights 144 : 81
    const recent = ['old', ...Array.from({ length: 2 }, (_, i) => `x${i}`), 'new', ...Array.from({ length: 8 }, (_, i) => `y${i}`)]
    const counts: Record<string, number> = { old: 0, new: 0 }
    const random = sweep(225)
    for (let i = 0; i < 225; i++) counts[pickNextMix({ candidates: [cand('old'), cand('new')], recentKeys: recent, contextKeys: new Set(), random })!.key]++
    expect(counts).toEqual({ old: 144, new: 81 })
  })
})
