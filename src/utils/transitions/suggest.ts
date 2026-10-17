/**
 * First-guess timing for a new transition, from the two songs' beat grids.
 *
 * Product rule: exit at a 16/32-beat phrase boundary near FROM's outro, enter on
 * the first downbeat after TO's intro, overlap 8/16 beats. It only has to be a
 * sensible starting point; everything it returns is editable.
 *
 * Whatever the grids say, the result satisfies 0 ≤ exitAt, exitAt + overlap ≤
 * FROM's duration, 0 ≤ entryAt < TO's duration and overlap > 0, as long as both
 * durations are positive. A FROM with no length gets exitAt 0 and overlap 0 (a cut).
 */
import type { BeatGrid, Transition } from '@/types/transition'
import { beatIndexAt, beatTime, isDownbeat } from './beatgrid'
import { clampRate, MAX_RATE_DEVIATION } from './schedule'

export interface SuggestInput {
  from: { grid: BeatGrid | null; duration: number }
  to: { grid: BeatGrid | null; duration: number }
}

export type TransitionSuggestion = Pick<Transition, 'type' | 'exitAt' | 'entryAt' | 'overlap' | 'rateTo' | 'fadeOut' | 'fadeIn' | 'bassSwap'>

/** Grids less confident than this are treated as missing */
export const MIN_GRID_CONFIDENCE = 0.3
/** Seconds of FROM left after the overlap, so the blend doesn't run into its last fade */
const TAIL = 2
/** Without a usable FROM grid: begin this many seconds before FROM ends… */
const FALLBACK_LEAD = 20
/** …and overlap for this long */
const FALLBACK_OVERLAP = 8

export function isUsableGrid(grid: BeatGrid | null | undefined): grid is BeatGrid {
  return !!grid && grid.confidence >= MIN_GRID_CONFIDENCE && grid.bpm > 0 &&
    grid.period > 0 && isFinite(grid.period) && isFinite(grid.offset)
}

/** Index (0–3) of the first downbeat at or after beat 0. */
function firstDownbeat(grid: BeatGrid): number {
  for (let i = 0; i < 4; i++) if (isDownbeat(grid, i)) return i
  return 0
}

/**
 * Latest beat d0 + step·n (n ≥ 0, d0 = first downbeat) at or after 0 such that
 * it plus `overlap` ends by `limit`; null when none fits.
 */
function latestBoundary(grid: BeatGrid, step: number, overlap: number, limit: number): number | null {
  const d0 = firstDownbeat(grid)
  const start = beatTime(grid, d0)
  const span = step * grid.period
  const nMin = Math.max(0, Math.ceil(-start / span))
  let n = Math.floor((limit - overlap - start) / span)
  // Float rounding in the division can land one boundary too late
  while (n >= nMin && beatTime(grid, d0 + step * n) + overlap > limit) n--
  return n >= nMin ? beatTime(grid, d0 + step * n) : null
}

/** Keep a (start, length) pair inside a song of `duration` s, shrinking the length if needed. */
function fitToSong(exitAt: number, overlap: number, duration: number): { exitAt: number; overlap: number } {
  if (!(duration > 0)) return { exitAt: 0, overlap: 0 }
  if (exitAt >= 0 && overlap > 0 && exitAt + overlap <= duration) return { exitAt, overlap }
  const start = Math.max(duration / 2, duration - overlap)
  // duration − start is exact here (start ≥ duration/2), so the sum can't overshoot
  return { exitAt: start, overlap: duration - start }
}

/**
 * Exit on FROM's latest 32-beat phrase boundary, else its latest 16-beat one. The
 * first downbeat is a boundary of both kinds, so "else" means: when no 32-boundary
 * after the first downbeat fits (songs shorter than about a phrase plus the overlap).
 * For songs too short even for that, halve the overlap (down to 2 beats), then give
 * up the tail, and finally ignore the grid.
 */
function phraseExit(grid: BeatGrid, beats: number, duration: number): { exitAt: number; overlap: number } {
  const first = beatTime(grid, firstDownbeat(grid))
  for (const limit of [duration - TAIL, duration]) {
    for (let b = beats; b >= 2; b /= 2) {
      const overlap = b * grid.period
      const at32 = latestBoundary(grid, 32, overlap, limit)
      if (at32 !== null && at32 > first) return { exitAt: at32, overlap }
      const at16 = latestBoundary(grid, 16, overlap, limit)
      if (at16 !== null) return { exitAt: at16, overlap }
    }
  }
  return fitToSong(duration - beats * grid.period, beats * grid.period, duration)
}

/** Seconds into the overlap of the FROM downbeat nearest its midpoint (the midpoint if none is inside). */
function bassSwapAt(grid: BeatGrid, exitAt: number, overlap: number): number {
  const d0 = firstDownbeat(grid)
  const m = Math.round((beatIndexAt(grid, exitAt + overlap / 2) - d0) / 4)
  const at = beatTime(grid, d0 + 4 * m) - exitAt
  return at > 0 && at < overlap ? at : overlap / 2
}

/** TO's first downbeat, or 0 when TO has no usable grid or it falls outside the song. */
function entryPoint(grid: BeatGrid | null, duration: number): number {
  if (!grid) return 0
  const t = beatTime(grid, firstDownbeat(grid))
  return t >= 0 && t < duration ? t : 0
}

export function suggestTransition(input: SuggestInput): TransitionSuggestion {
  const fromDuration = isFinite(input.from.duration) ? input.from.duration : 0
  const toDuration = isFinite(input.to.duration) ? input.to.duration : 0
  const fromGrid = isUsableGrid(input.from.grid) ? input.from.grid : null
  const toGrid = isUsableGrid(input.to.grid) ? input.to.grid : null
  const base = {
    type: 'blend' as const,
    fadeOut: 'equal-power' as const,
    fadeIn: 'equal-power' as const,
    entryAt: entryPoint(toGrid, toDuration),
  }

  if (!fromGrid) {
    const { exitAt, overlap } = fitToSong(Math.max(0, fromDuration - FALLBACK_LEAD), FALLBACK_OVERLAP, fromDuration)
    return { ...base, exitAt, overlap, rateTo: 1 }
  }

  // Beat-match only within the playbackRate range the engine allows; beyond that the
  // tempos clash anyway, so keep TO at its own speed and make the overlap short
  let rateTo = 1
  let beats = 8
  if (toGrid) {
    const ratio = fromGrid.bpm / toGrid.bpm
    if (Math.abs(ratio - 1) <= MAX_RATE_DEVIATION + 1e-9) {
      rateTo = clampRate(ratio)
      beats = 16
    }
  }
  const { exitAt, overlap } = phraseExit(fromGrid, beats, fromDuration)
  const out: TransitionSuggestion = { ...base, exitAt, overlap, rateTo }
  if (toGrid && overlap > 0) out.bassSwap = { at: bassSwapAt(fromGrid, exitAt, overlap) }
  return out
}
