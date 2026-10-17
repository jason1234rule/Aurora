/**
 * Room-light show: what colour each bulb is at a moment in a song. Pure, so it can be
 * tested and so the controller only has to sample it and send what changed.
 *
 * - Every beat the lights jump up and fade back down; the first beat of each bar hits harder.
 * - Each bulb wears one of the cover's colours, and the colours move one bulb along every
 *   two bars, so the room slowly turns.
 * - "Party" lights one bulb per beat in turn (a chase) instead of pulsing them all together.
 * - During a transition the room fades from one cover's colours to the next, and the bass
 *   swap (if the transition has one) flashes white.
 * - Without a beat grid (still analysing, or no clear beat) the lights breathe slowly.
 */
import type { BeatGrid } from '@/types/transition'
import type { RGB } from './govee'

export type LightIntensity = 'chill' | 'normal' | 'party'

export interface ShowInput {
  /** Seconds into the song, as heard */
  t: number
  grid: BeatGrid | null
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

const STYLE: Record<LightIntensity, { floor: number; decay: number; offBeat: number }> = {
  // floor: level between beats; decay: how fast a pulse fades; offBeat: strength of beats 2–4
  chill: { floor: 0.55, decay: 2, offBeat: 0.6 },
  normal: { floor: 0.25, decay: 3.5, offBeat: 0.75 },
  party: { floor: 0.06, decay: 6, offBeat: 0.9 },
}
/** Below this a bulb's colour gets muddy, so levels don't go lower */
const MIN_LEVEL = 0.05

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
  const style = STYLE[intensity]
  const out: RGB[] = []

  if (!usableGrid(grid)) {
    // No beat to follow: breathe on a 6 s cycle
    const level = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin((t / 6) * 2 * Math.PI))
    for (let i = 0; i < bulbs; i++) out.push(scale(blend(input, i, Math.floor(t / 8)), level))
    return out
  }

  const { beat, phase, inBar, bar } = beatPosition(grid, t)
  const pulse = Math.exp(-phase * style.decay)
  const strength = inBar === 0 ? 1 : style.offBeat
  const step = Math.floor(bar / 2)
  for (let i = 0; i < bulbs; i++) {
    let level: number
    if (intensity === 'party') {
      // Chase: one bulb per beat takes the hit, the rest glow low
      level = beat % bulbs === i ? style.floor + (1 - style.floor) * pulse * strength : style.floor + 0.12 * pulse
    } else {
      level = style.floor + (1 - style.floor) * pulse * strength
    }
    out.push(scale(blend(input, i, step), level))
  }
  return out
}

/** Bulb i's colour, blended toward the next song's during a transition and toward white on a flash */
function blend(input: ShowInput, i: number, step: number): RGB {
  let c = paletteColour(input.palette, i, step)
  if (input.next) c = mixRGB(c, paletteColour(input.next.palette, i, step), Math.max(0, Math.min(1, input.next.mix)))
  if (input.flash) c = mixRGB(c, [255, 255, 255], Math.max(0, Math.min(1, input.flash)))
  return c
}
