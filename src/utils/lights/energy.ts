/**
 * How intense a song is over time, for the room lights: loudness in 100 ms steps, scaled to
 * the song's own range (its quiet parts → 0, its loudest → 1) and smoothed so it rises in
 * about half a second and falls over two (the lights follow sections, not every hit).
 * "Drops" are moments where it jumps from quiet to loud.
 */
export interface Energy {
  /** Seconds per value */
  hop: number
  /** 0–1, smoothed */
  values: Float32Array
  /** Times (s) where the song suddenly gets much more intense */
  drops: number[]
}

const HOP = 0.1
const ATTACK = 0.5
const RELEASE = 2
/** A drop: at least this much louder (0–1 scale) than 2 s earlier, from below DROP_FROM */
const DROP_RISE = 0.35
const DROP_FROM = 0.55

export function computeEnergy(channels: Float32Array[], sampleRate: number): Energy {
  const len = channels[0]?.length ?? 0
  const step = Math.max(1, Math.round(sampleRate * HOP))
  const n = Math.floor(len / step)
  const db = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    // Every 4th sample is plenty for loudness
    for (const ch of channels) for (let j = i * step; j < (i + 1) * step; j += 4) sum += ch[j] * ch[j]
    const rms = Math.sqrt(sum / ((step / 4) * channels.length))
    db[i] = 20 * Math.log10(rms + 1e-6)
  }
  // Scale to the song's own range: 10th percentile → 0, 95th → 1 (ignoring silence)
  const audible = [...db].filter(v => v > -60).sort((a, b) => a - b)
  const lo = audible.length ? audible[Math.floor(audible.length * 0.1)] : -40
  const hi = audible.length ? audible[Math.floor(audible.length * 0.95)] : -10
  const span = Math.max(3, hi - lo)
  const values = new Float32Array(n)
  const up = 1 - Math.exp(-HOP / ATTACK), down = 1 - Math.exp(-HOP / RELEASE)
  let e = 0
  for (let i = 0; i < n; i++) {
    const target = Math.max(0, Math.min(1, (db[i] - lo) / span))
    e += (target - e) * (target > e ? up : down)
    values[i] = e
  }
  const drops: number[] = []
  const back = Math.round(2 / HOP)
  for (let i = back; i < n; i++) {
    const before = values[i - back]
    if (before < DROP_FROM && values[i] - before >= DROP_RISE && (!drops.length || i * HOP - drops[drops.length - 1] > 8)) {
      drops.push(i * HOP)
    }
  }
  return { hop: HOP, values, drops }
}

export function energyAt(e: Energy | null | undefined, t: number): number {
  if (!e || !e.values.length) return 0.6
  const i = Math.max(0, Math.min(e.values.length - 1, Math.floor(t / e.hop)))
  return e.values[i]
}

/** Seconds since the most recent drop at or before t, or null */
export function sinceDrop(e: Energy | null | undefined, t: number): number | null {
  if (!e) return null
  let last: number | null = null
  for (const d of e.drops) { if (d <= t) last = d; else break }
  return last === null ? null : t - last
}
