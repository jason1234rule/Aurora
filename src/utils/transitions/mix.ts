/**
 * Mix mode: choose the next song by following a saved transition out of the
 * current one. Pure so it can be tested; the player store supplies the inputs.
 */
import type { Transition } from '@/types/transition'

export interface MixCandidate {
  transition: Transition
  /** The library track the transition leads to */
  track: Track
  /** songKey of that track */
  key: string
}

export interface MixPickInput {
  candidates: MixCandidate[]
  /** songKeys of recently played tracks, oldest first (the current track last) */
  recentKeys: string[]
  /** songKeys of the playlist / album / queue the user started from */
  contextKeys: Set<string>
  /** Don't repeat anything from this many most recent tracks */
  avoidLast?: number
  /** How much more likely a target in the current context is */
  contextWeight?: number
  random?: () => number
}

export const MIX_AVOID_LAST = 8
export const MIX_CONTEXT_WEIGHT = 4

export function pickNextMix(input: MixPickInput): MixCandidate | null {
  const avoid = new Set(input.recentKeys.slice(-(input.avoidLast ?? MIX_AVOID_LAST)))
  const weight = input.contextWeight ?? MIX_CONTEXT_WEIGHT
  const pool = input.candidates
    .filter(c => !c.transition.needsReview && !avoid.has(c.key))
    .map(c => ({ c, w: input.contextKeys.has(c.key) ? weight : 1 }))
  if (!pool.length) return null
  const total = pool.reduce((s, p) => s + p.w, 0)
  let r = (input.random ?? Math.random)() * total
  for (const p of pool) {
    r -= p.w
    if (r < 0) return p.c
  }
  return pool[pool.length - 1].c
}
