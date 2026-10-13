/**
 * What a transition needs pre-stretched in 'keep' pitch mode, derived from its
 * schedule so playback, the editor preview and the tests all render the same thing.
 * Each section's output sample 0 is heard at that source's start time in the
 * schedule (TO at t0, FROM at from.startAt) and follows its tempo envelope.
 */
import { positionAt, type RatePoint, type TransitionSchedule } from '../schedule'
import type { StretchJob } from './core'

export interface StretchSection {
  /** File position heard at output time 0 */
  startPos: number
  /** Rate envelope, relative to output time 0 */
  points: RatePoint[]
  /** Seconds of output */
  duration: number
}

export interface StretchPlan {
  from?: StretchSection
  to?: StretchSection
}

export type StretchRenderer = (job: StretchJob) => Promise<Float32Array[]>

const shift = (points: RatePoint[], dt: number) => points.map(p => ({ time: p.time + dt, rate: p.rate }))

/** `toUntil`: ctx time TO's stretched audio must last until (handback budget, or the end of a preview) */
export function stretchPlan(s: TransitionSchedule, toUntil: number): StretchPlan {
  if (s.pitch !== 'keep') return {}
  const plan: StretchPlan = {}
  if (s.toRate.length) {
    plan.to = { startPos: s.to.startPos, points: shift(s.toRate, -s.to.startAt), duration: Math.max(0.1, toUntil - s.to.startAt) }
  }
  if (s.fromRate.length) {
    plan.from = { startPos: s.from.startPos, points: shift(s.fromRate, -s.from.startAt), duration: s.from.stopAt - s.from.startAt + 0.05 }
  }
  return plan
}

/** Stable key for caching a rendered plan */
export function planKey(plan: StretchPlan): string {
  const r = (v: number) => Math.round(v * 1e6) / 1e6
  const sec = (x?: StretchSection) => x && [r(x.startPos), r(x.duration), ...x.points.flatMap(p => [r(p.time), r(p.rate)])]
  return JSON.stringify([sec(plan.from), sec(plan.to)])
}

interface Source { buffer: AudioBuffer; start: number }

/** Render one section from a decoded source, sending only the part of the source it needs. */
async function renderSection(ctx: BaseAudioContext, sec: StretchSection, src: Source, render: StretchRenderer): Promise<AudioBuffer> {
  const sr = src.buffer.sampleRate
  const endPos = positionAt(0, sec.startPos, sec.points, sec.duration)
  const margin = 1
  const a = Math.max(0, Math.floor((sec.startPos - margin - src.start) * sr))
  const z = Math.min(src.buffer.length, Math.ceil((endPos + margin - src.start) * sr))
  const channels = Array.from({ length: src.buffer.numberOfChannels }, (_, c) => src.buffer.getChannelData(c).slice(a, Math.max(a, z)))
  const out = await render({
    channels,
    sampleRate: sr,
    sourceStart: src.start + a / sr,
    startPos: sec.startPos,
    points: sec.points,
    duration: sec.duration,
  })
  const buf = ctx.createBuffer(out.length, out[0].length, sr)
  out.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  return buf
}

export async function renderPlan(
  ctx: BaseAudioContext,
  plan: StretchPlan,
  sources: { from: Source; to: Source },
  render: StretchRenderer,
): Promise<{ from?: AudioBuffer; to?: AudioBuffer }> {
  const [from, to] = await Promise.all([
    plan.from ? renderSection(ctx, plan.from, sources.from, render) : undefined,
    plan.to ? renderSection(ctx, plan.to, sources.to, render) : undefined,
  ])
  return { from, to }
}
