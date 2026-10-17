/**
 * Hand-made light shows: what each bulb shows at a moment in a song, and Suggest (a first
 * draft laid out from the song's energy). Pure, so the editor, the live lights and the tests
 * all run the same code.
 *
 * Shows are laid out in bars and beats from the show's origin (bar 1 = the first downbeat at
 * or after 0 s). A bulb's own block beats the room-wide block; accents (flash, blackout, colour
 * hit) and the beat flash go on top.
 */
import type { BeatGrid } from '@/types/transition'
import type { LightShow, LightBlock, LightLook, LightAccent, LightSection, LightMotion } from '@/types/lightShow'
import type { RGB } from './govee'
import type { Energy } from './energy'

/** The darkest a lit bulb goes, as a share of its colour: lower turns muddy on these bulbs */
const MIN_LEVEL = 0.1
const FLASH_SECONDS = 0.45

export const MOTIONS: { id: LightMotion; label: string; perBeat: number }[] = [
  { id: 'hold', label: 'Hold', perBeat: 0 },
  { id: 'breathe', label: 'Breathe', perBeat: 0.5 },
  { id: 'barhit', label: 'Bar hit', perBeat: 0.5 },
  { id: 'pulse', label: 'Pulse', perBeat: 2 },
  { id: 'alternate', label: 'Alternate', perBeat: 2 },
  { id: 'chase', label: 'Chase', perBeat: 2 },
]

/** Bulbs keep up with about this many changes a second each */
export const MAX_CHANGES_PER_SECOND = 5

/** Colour changes per second per bulb a look asks for at a tempo */
export function changesPerSecond(look: Pick<LightLook, 'motion' | 'half'>, period: number): number {
  const perBeat = MOTIONS.find(m => m.id === look.motion)?.perBeat ?? 0
  return perBeat / period / (look.half ? 2 : 1)
}

/** A show's bar 1 from a beat grid: the first downbeat at or after 0 s */
export function timingFromGrid(grid: BeatGrid): { origin: number; period: number } {
  const bar = grid.period * 4
  const down = grid.offset + grid.downbeatPhase * grid.period
  return { origin: ((down % bar) + bar) % bar, period: grid.period }
}

export function barsIn(show: Pick<LightShow, 'origin' | 'period' | 'duration'>): number {
  return Math.max(1, Math.floor((show.duration - show.origin) / (show.period * 4)))
}

export function hexRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16) || 0
  return [n >> 16, (n >> 8) & 255, n & 255]
}

const inBlock = (b: LightBlock, bar: number) => bar >= b.start && bar < b.start + b.len

/** The block lighting a bulb at a bar: its own lane's block if it has one there, else the room-wide one */
export function blockFor(show: Pick<LightShow, 'blocks'>, bulb: string, bar: number): LightBlock | undefined {
  return show.blocks.find(b => b.target === bulb && inBlock(b, bar)) ?? show.blocks.find(b => b.target === 'all' && inBlock(b, bar))
}

/** Brightness (0–1) of bulb `i` of `count` under a look, `beatF` beats into the show */
function level(look: LightLook, beatF: number, i: number, count: number): number {
  const lo = look.lo / 100, hi = look.hi / 100
  const beat = Math.floor(beatF), phase = beatF - beat, inBar = ((beat % 4) + 4) % 4
  const rate = look.half ? 2 : 1
  const step = Math.floor(beatF / rate), stepPhase = (beatF / rate) % 1
  switch (look.motion) {
    case 'hold': return hi
    case 'breathe': return lo + (hi - lo) * (0.5 + 0.5 * Math.sin((beatF / 8) * 2 * Math.PI))
    case 'barhit': return inBar === 0 && phase < 0.5 ? hi : lo
    case 'pulse': return stepPhase < 0.5 ? hi : lo
    case 'alternate': return (inBar === 0 || i % 2 === ((step % 2) + 2) % 2) && stepPhase < 0.5 ? hi : lo
    case 'chase': return ((step % count) + count) % count === i && stepPhase < 0.7 ? hi : lo
  }
  return hi
}

export function lookColour(look: LightLook, bulb: string, solo: boolean): string {
  return solo ? look.colour : look.colours[bulb] ?? look.colour
}

/** Every bulb's colour `t` seconds into the song */
export function showFrame(show: Pick<LightShow, 'origin' | 'period' | 'blocks' | 'accents' | 'beatFlash'>, t: number, bulbs: string[]): RGB[] {
  const beatF = (t - show.origin) / show.period
  const bar = Math.floor(beatF / 4)
  let out: RGB[] = bulbs.map((name, i) => {
    const b = blockFor(show, name, bar)
    if (!b) return [0, 0, 0]
    const solo = b.target !== 'all'
    const k = Math.max(MIN_LEVEL, level(b.look, beatF, solo ? 0 : i, solo ? 1 : bulbs.length))
    return hexRgb(lookColour(b.look, name, solo)).map(v => Math.round(v * k)) as RGB
  })
  if (show.beatFlash && beatF >= 0) {
    const k = Math.exp(-(beatF % 1) * 7) * 0.8
    out = out.map(c => c.map(v => Math.min(255, Math.round(v + (255 - v) * k * 0.45 + v * k))) as RGB)
  }
  for (const a of show.accents) {
    const d = t - (show.origin + a.beat * show.period)
    if (d < 0) continue
    if (a.type === 'flash' && d < FLASH_SECONDS) {
      const k = 1 - d / FLASH_SECONDS
      out = out.map(c => c.map(v => Math.round(v + (255 - v) * k)) as RGB)
    } else if (a.type === 'blackout' && d < show.period) {
      out = out.map(() => [0, 0, 0])
    } else if (a.type === 'hit' && d < show.period * 0.75) {
      const c = hexRgb(a.colour ?? '#ffffff')
      out = out.map(() => c)
    }
  }
  return out
}

/** The beat number `t` falls in (for sending every bulb together on a new beat) */
export const showBeat = (show: Pick<LightShow, 'origin' | 'period'>, t: number) => Math.floor((t - show.origin) / show.period)

// ── Sections and Suggest ─────────────────────────────────────────────────────

/** Average energy of each bar */
export function barEnergy(energy: Energy, origin: number, period: number, bars: number): number[] {
  const out: number[] = []
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((origin + b * period * 4) / energy.hop)
    const to = Math.floor((origin + (b + 1) * period * 4) / energy.hop)
    let sum = 0, n = 0
    for (let i = from; i < to && i < energy.values.length; i++) { sum += energy.values[i]; n++ }
    out.push(n ? sum / n : 0)
  }
  return out
}

type Level = 'low' | 'mid' | 'high'

/**
 * Split a song into sections by energy, in 4-bar phrases: runs of quiet, middling and loud
 * phrases become Intro / Verse / Build / Chorus / Break / Outro. Names are guesses to edit.
 *
 * Loud is judged against the song itself (its louder half), so a song that's loud all the
 * way through still separates its choruses from its verses.
 */
export function detectSections(energyPerBar: number[]): LightSection[] {
  const means: number[] = []
  for (let s = 0; s < energyPerBar.length; s += 4) {
    const bars = energyPerBar.slice(s, s + 4)
    means.push(bars.reduce((a, b) => a + b, 0) / bars.length)
  }
  const sorted = [...means].sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  const high = Math.max(0.65, q(0.55)), low = Math.min(0.45, Math.max(0.3, q(0.15) + 0.02))
  let levels: Level[] = means.map(e => (e < low ? 'low' : e >= high ? 'high' : 'mid'))
  // A lone phrase between two of the same kind is noise: smooth it out
  levels = levels.map((lv, i) => (i > 0 && i < levels.length - 1 && levels[i - 1] === levels[i + 1] && lv !== levels[i - 1] && lv !== 'low' ? levels[i - 1] : lv))
  const phrases: { start: number; len: number; level: Level }[] = []
  levels.forEach((lv, i) => {
    const len = Math.min(4, energyPerBar.length - i * 4)
    const last = phrases[phrases.length - 1]
    if (last && last.level === lv) last.len += len
    else phrases.push({ start: i * 4, len, level: lv })
  })
  return phrases.map((p, i) => {
    const next = phrases[i + 1]
    let name: string
    if (p.level === 'high') name = 'Chorus'
    else if (p.level === 'low') name = i === 0 ? 'Intro' : i === phrases.length - 1 ? 'Outro' : 'Break'
    else name = p.len <= 8 && next?.level === 'high' && i > 0 ? 'Build' : i === 0 ? 'Intro' : 'Verse'
    return { name, start: p.start, len: p.len }
  })
}

function newId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

/** A look that spreads `palette` across the bulbs */
export function paletteLook(name: string, palette: string[], bulbs: string[], motion: LightMotion, lo: number, hi: number, half = false): LightLook {
  const p = palette.length ? palette : ['#ff9a4a', '#ffc98c']
  return { name, colours: Object.fromEntries(bulbs.map((b, i) => [b, p[i % p.length]])), colour: p[0], motion, lo, hi, half }
}

/**
 * A first draft: sections from the energy, a look per section in the cover's colours, a white
 * flash where each chorus starts and a blackout on the beat before a chorus that follows a build.
 */
export function suggestShow(sections: LightSection[], palette: string[], bulbs: string[]): { blocks: LightBlock[]; accents: LightAccent[] } {
  const shifted = (n: number) => palette.length ? [...palette.slice(n % palette.length), ...palette.slice(0, n % palette.length)] : palette
  const choruses = sections.filter(s => s.name === 'Chorus')
  const blocks: LightBlock[] = sections.map(s => {
    let look: LightLook
    switch (s.name) {
      case 'Chorus':
        look = s === choruses[choruses.length - 1] && choruses.length > 1
          ? paletteLook('Split hits', palette, bulbs, 'alternate', 25, 100)
          : paletteLook('Chorus pulse', palette, bulbs, 'pulse', 30, 100)
        break
      case 'Build': look = paletteLook('Bar hits', shifted(1), bulbs, 'barhit', 35, 100); break
      case 'Break': look = paletteLook('Room chase', shifted(2), bulbs, 'chase', 20, 90, true); break
      case 'Verse': look = paletteLook('Cover glow', palette, bulbs, 'breathe', 35, 75); break
      default: look = paletteLook('Calm', palette, bulbs, 'hold', 45, 45)
    }
    return { id: newId(), target: 'all', start: s.start, len: s.len, look }
  })
  const accents: LightAccent[] = []
  sections.forEach((s, i) => {
    if (s.name !== 'Chorus') return
    accents.push({ id: newId(), beat: s.start * 4, type: 'flash' })
    const prev = sections[i - 1]
    if (prev && (prev.name === 'Build' || prev.name === 'Break')) accents.push({ id: newId(), beat: s.start * 4 - 1, type: 'blackout' })
  })
  return { blocks, accents }
}

export { newId as lightId }
