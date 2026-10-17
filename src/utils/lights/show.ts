/**
 * Room-light show: what colour each bulb is at a moment in a song. Pure, so it can be
 * tested and so the controller only has to sample it and send what changed.
 *
 * The bulbs take about five changes a second and jump rather than fade, so the styles avoid
 * stepped fades: brightness either moves slowly (following the song's energy) or snaps
 * between two levels in time with the beat.
 *
 * - Normal follows the song's energy: quiet sections dim with colours drifting every few
 *   bars, loud sections bright with colours moving every bar and a lift on each bar's start.
 * - Chill is the same, calmer: narrower range, colours change every 8 bars, no lifts.
 * - Party hits on every beat and holds (two clean steps per beat): bar starts hit every bulb,
 *   other beats alternate halves of the room. Colours move every bar; drops flash white.
 * - During a transition the room fades from one cover's colours to the next, and the bass
 *   swap (if the transition has one) flashes white.
 */
import type { BeatGrid } from '@/types/transition'
import type { RGB } from './govee'
import { energyAt, sinceDrop, type Energy } from './energy'

export type LightIntensity = 'chill' | 'normal' | 'party'

export interface ShowInput {
  /** Seconds into the song, as heard */
  t: number
  grid: BeatGrid | null
  /** How intense the song is over time (null while it's being measured) */
  energy?: Energy | null
  /** The cover's colours (at least one) */
  palette: RGB[]
  bulbs: number
  intensity: LightIntensity
  /** During a transition: the next song's colours and how far the blend is (0–1) */
  next?: { palette: RGB[]; mix: number }
  /** 0–1: how much to wash toward white (bass swap) */
  flash?: number
}

/** Warm white for covers without colour, and for when the music stops */
export const WARM_WHITE: RGB = [255, 170, 100]
const GREY_PALETTE: RGB[] = [[255, 150, 70], [255, 200, 140]]
/** Below this a bulb's colour gets muddy, so levels don't go lower */
const MIN_LEVEL = 0.2

export const usableGrid = (g: BeatGrid | null | undefined): g is BeatGrid => !!g && g.bpm > 0 && g.period > 0

/** Where in the music `t` is: beat number, how far through it (0–1) and the bar */
export function beatPosition(grid: BeatGrid, t: number) {
  const b = (t - grid.offset) / grid.period
  const beat = Math.floor(b)
  const sinceDown = beat - grid.downbeatPhase
  return { beat, phase: b - beat, inBar: ((sinceDown % 4) + 4) % 4, bar: Math.floor(sinceDown / 4) }
}

const mixRGB = (a: RGB, b: RGB, k: number): RGB => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * k) as RGB
const scale = (c: RGB, level: number): RGB => c.map(v => Math.round(v * Math.max(MIN_LEVEL, Math.min(1, level)))) as RGB

/** Colour of bulb `i` from a palette, rotating one bulb along per `step` */
function paletteColour(palette: RGB[], i: number, step: number): RGB {
  const p = palette.length ? palette : GREY_PALETTE
  return p[(((i + step) % p.length) + p.length) % p.length]
}

export function frame(input: ShowInput): RGB[] {
  const { t, grid, bulbs, intensity } = input
  const energy = energyAt(input.energy, t)
  // Without a beat grid, pretend bars are 2 s long so colours still move
  const pos = usableGrid(grid) ? beatPosition(grid, t) : { beat: Math.floor(t / 0.5), phase: (t / 0.5) % 1, inBar: Math.floor(t / 0.5) % 4, bar: Math.floor(t / 2) }
  const out: RGB[] = []

  if (intensity === 'party' && usableGrid(grid)) {
    // Quieter sections hit softer
    const hit = 0.7 + 0.3 * energy, hold = 0.25 + 0.2 * energy
    const drop = sinceDrop(input.energy, t)
    const dropFlash = drop !== null && drop < 0.8 ? Math.exp(-drop * 4) : 0
    for (let i = 0; i < bulbs; i++) {
      const hits = pos.inBar === 0 || i % 2 === pos.beat % 2
      const level = hits && pos.phase < 0.5 ? hit : hold
      out.push(scale(blend(input, i, pos.bar, dropFlash), level))
    }
    return out
  }

  // Normal / chill: brightness follows the song's energy, colours drift with it
  const chill = intensity === 'chill'
  let level = chill ? 0.45 + 0.4 * energy : 0.3 + 0.7 * energy
  const barsPerStep = chill ? 8 : energy < 0.35 ? 4 : energy < 0.7 ? 2 : 1
  // Loud sections get a lift on the first beat of each bar
  if (!chill && usableGrid(grid) && energy > 0.7 && pos.inBar === 0 && pos.phase < 0.5) level = 1
  const step = Math.floor(pos.bar / barsPerStep)
  for (let i = 0; i < bulbs; i++) out.push(scale(blend(input, i, step, 0), level))
  return out
}

/** Bulb i's colour, blended toward the next song's during a transition and toward white on a flash */
function blend(input: ShowInput, i: number, step: number, extraFlash: number): RGB {
  let c = paletteColour(input.palette, i, step)
  if (input.next) c = mixRGB(c, paletteColour(input.next.palette, i, step), Math.max(0, Math.min(1, input.next.mix)))
  const flash = Math.max(input.flash ?? 0, extraFlash)
  if (flash) c = mixRGB(c, [255, 255, 255], Math.max(0, Math.min(1, flash)))
  return c
}
