/**
 * Editor timeline math. The x-axis is FROM's file position in seconds; TO is
 * drawn where it would be heard against FROM. The schedule with t0 = exitAt
 * gives "ctx time" = heard time, which equals FROM's position while FROM plays
 * at its own speed; when FROM changes speed too, positions go through its
 * envelope. Either way the playback math (including the rate ramps) is reused.
 */
import {
  buildSchedule, toPositionAt, toTimeAt, fromPositionAt, fromTimeAt, clampRate, effectiveOverlap,
  type TransitionSchedule, type TransitionTiming,
} from './schedule'

export interface MixMapping {
  /** TO file position heard at FROM position x */
  toPosAt(x: number): number
  /** FROM position at which TO file position q is heard */
  xForToPos(q: number): number
  schedule: TransitionSchedule
}

export function mixMapping(t: TransitionTiming): MixMapping {
  const schedule = buildSchedule(t, { t0: t.exitAt, leadIn: 0, fromWindowStart: -1e9, toWindowStart: -1e9 })
  if (!schedule.fromRate.length) {
    return { toPosAt: (x) => toPositionAt(schedule, x), xForToPos: (q) => toTimeAt(schedule, q), schedule }
  }
  return {
    toPosAt: (x) => toPositionAt(schedule, fromTimeAt(t.exitAt, schedule, x)),
    xForToPos: (q) => fromPositionAt(t.exitAt, schedule, toTimeAt(schedule, q)),
    schedule,
  }
}

/** FROM's speed during the overlap: FROM file seconds per heard second */
export function fromSpeed(t: TransitionTiming): number {
  return effectiveOverlap(t) > 0 ? clampRate(t.rateFrom) : 1
}

/** Move the transition start along FROM while keeping TO where it is relative to FROM. */
export function moveExit(t: TransitionTiming, newExit: number): Pick<TransitionTiming, 'exitAt' | 'entryAt'> {
  return { exitAt: newExit, entryAt: mixMapping(t).toPosAt(newExit) }
}

/** Slide TO against FROM by dx seconds of FROM time (positive = TO later). */
export function slideTo(t: TransitionTiming, dx: number): number {
  const rate = effectiveOverlap(t) > 0 ? clampRate(t.rateTo) : 1
  // During the overlap TO covers rateTo file seconds for every rateFrom seconds of FROM
  return t.entryAt - dx * rate / fromSpeed(t)
}
