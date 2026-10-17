/**
 * Hand-made light shows: a song's lights laid out on its bars, like a transition is laid out
 * on its two songs. Bulbs are referred to by their Bluetooth name (e.g. ihoment_H6008_3B85),
 * so shows keep working if bulbs are added or relabelled.
 */

/** How a look moves, always locked to the beat */
export type LightMotion = 'hold' | 'breathe' | 'barhit' | 'pulse' | 'alternate' | 'chase'

export interface LightLook {
  name: string
  /** Colour per bulb (by Bluetooth name); bulbs not listed use `colour` */
  colours: Record<string, string>
  /** Default colour, for bulbs without their own (and for a single light's block) */
  colour: string
  motion: LightMotion
  /** Brightness range, 0–100 */
  lo: number
  hi: number
  /** Half time: the motion steps every other beat */
  half: boolean
}

export interface LightBlock {
  id: string
  /** 'all' for the room-wide lane, or one bulb's Bluetooth name (overrides 'all' for that bulb) */
  target: 'all' | string
  /** First bar (0-based from the show's origin) and length in bars */
  start: number
  len: number
  look: LightLook
}

export type LightAccentType = 'flash' | 'blackout' | 'hit'

export interface LightAccent {
  id: string
  /** Beat number from the show's origin */
  beat: number
  type: LightAccentType
  /** For 'hit' */
  colour?: string
}

export interface LightSection {
  name: string
  start: number
  len: number
}

export interface LightShow {
  id: string
  /** songKey of the song (see smartPlaylistMatcher) */
  key: string
  path: string
  title: string
  artist: string
  duration: number
  /**
   * The beat grid the show was laid out on: seconds to the first downbeat at or after 0 (bar 1)
   * and seconds per beat. Saved with the show so re-analysis can't shift it.
   */
  origin: number
  period: number
  blocks: LightBlock[]
  accents: LightAccent[]
  sections: LightSection[]
  /** Every light kicks up on each beat, on top of the looks */
  beatFlash: boolean
  /** The file changed length since the show was made: it won't play until it's re-saved */
  needsReview: boolean
  createdAt: number
  updatedAt: number
}

export interface LightShowsFile {
  shows: Record<string, LightShow>
  /** Saved looks, shared by every show */
  looks: LightLook[]
}
