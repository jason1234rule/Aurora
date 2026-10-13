/**
 * Editor timeline math. The x-axis is FROM's file position in seconds; TO is
 * drawn where it would be heard against FROM. Using the schedule with
 * t0 = exitAt makes "ctx time" equal FROM position, so the playback math
 * (including the post-overlap rate ramp) is reused unchanged.
 */
import { buildSchedule, toPositionAt, toTimeAt, clampRate, effectiveOverlap, type TransitionSchedule, type TransitionTiming } from './schedule'

export interface MixMapping {
  /** TO file position heard at FROM position x */
  toPosAt(x: number): number
  /** FROM position at which TO file position q is heard */
  xForToPos(q: number): number
  schedule: TransitionSchedule
}

export function mixMapping(t: TransitionTiming): MixMapping {
  const schedule = buildSchedule(t, { t0: t.exitAt, leadIn: 0, fromWindowStart: -1e9, toWindowStart: -1e9 })
  return {
    toPosAt: (x) => toPositionAt(schedule, x),
    xForToPos: (q) => toTimeAt(schedule, q),
    schedule,
  }
}

/** Move the transition start along FROM while keeping TO where it is relative to FROM. */
export function moveExit(t: TransitionTiming, newExit: number): Pick<TransitionTiming, 'exitAt' | 'entryAt'> {
  return { exitAt: newExit, entryAt: mixMapping(t).toPosAt(newExit) }
}

/** Slide TO against FROM by dx seconds of FROM time (positive = TO later). */
export function slideTo(t: TransitionTiming, dx: number): number {
  const rate = effectiveOverlap(t) > 0 ? clampRate(t.rateTo) : 1
  return t.entryAt - dx * rate
}
