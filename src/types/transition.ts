/** Hand-made transitions ("mixes") between two specific songs. */

/** 'none' holds full volume for the whole overlap; 'custom' follows the transition's fade points */
export type CurvePreset = 'linear' | 'equal-power' | 's-curve' | 'none' | 'custom'

/**
 * A vertex on a custom fade, like a volume keyframe in a video editor.
 * x: 0–1 through the overlap, y: gain 0–1. The ends are fixed (a fade-out runs
 * 1 → 0, a fade-in 0 → 1), so only the points in between are stored.
 */
export interface FadePoint {
  x: number
  y: number
}
export type TransitionType = 'blend' | 'cut' | 'echo-out'

export interface TransitionEndpoint {
  /** songKey() of the track, so the transition survives file moves */
  key: string
  /** Path at authoring time (informational; playback uses the current track's path) */
  path: string
  /** Decoded duration at authoring time; a mismatch flags the transition for review */
  duration: number
  title: string
  artist: string
}

export interface TransitionFilter {
  target: 'from' | 'to'
  kind: 'highpass' | 'lowpass'
  startHz: number
  endHz: number
}

export interface Transition {
  id: string
  from: TransitionEndpoint
  to: TransitionEndpoint
  type: TransitionType
  /** Seconds into FROM where the transition begins */
  exitAt: number
  /** Seconds into TO that is heard at exitAt */
  entryAt: number
  /** Seconds both play together (ignored for 'cut') */
  overlap: number
  fadeOut: CurvePreset
  fadeIn: CurvePreset
  /** Interior vertices of FROM's fade when fadeOut is 'custom', sorted by x */
  fadeOutPoints?: FadePoint[]
  /** Interior vertices of TO's fade when fadeIn is 'custom', sorted by x */
  fadeInPoints?: FadePoint[]
  /** Seconds into the overlap where FROM's lows are swapped for TO's */
  bassSwap?: { at: number }
  filter?: TransitionFilter
  /** Echo-out only: delay time in seconds and feedback (0–0.9) */
  echo?: { delay: number; feedback: number }
  /** playbackRate for TO during the overlap (clamped to ±3%), ramps back to 1 afterwards */
  rateTo?: number
  needsReview: boolean
  createdAt: number
  updatedAt: number
}

/** Beat grid for one file, from the analyser. Times are in seconds. */
export interface BeatGrid {
  bpm: number
  /** Time of the first beat */
  offset: number
  /** Seconds per beat (60 / bpm) */
  period: number
  /** Index (0–3) of the beat within its bar that is the downbeat, when detected */
  downbeatPhase: number
  /** 0–1, how strongly the onset envelope agrees with the grid */
  confidence: number
  /** Analyser version that produced it (cache entries from other versions are ignored) */
  version?: number
}
