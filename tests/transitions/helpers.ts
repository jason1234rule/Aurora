/** Synthetic click tracks and peak finding for transition tests. */

export interface ClickTrack {
  data: Float32Array
  /** Beat times in seconds (file positions) */
  beats: number[]
}

/** Raised-cosine clicks (±halfWidth s) centred on each beat, so the peak sits exactly on the beat. */
export function clickTrack(sampleRate: number, seconds: number, bpm: number, offset: number, halfWidth = 0.0008): ClickTrack {
  const n = Math.round(seconds * sampleRate)
  const data = new Float32Array(n)
  const period = 60 / bpm
  const beats: number[] = []
  const w = halfWidth * sampleRate
  for (let t = offset; t < seconds; t += period) {
    beats.push(t)
    const c = t * sampleRate
    for (let i = Math.max(0, Math.ceil(c - w)); i <= Math.min(n - 1, Math.floor(c + w)); i++) {
      data[i] += 0.5 * (1 + Math.cos(Math.PI * (i - c) / w))
    }
  }
  return { data, beats }
}

/** Sub-sample peak time (seconds) of |x| within ±window s of `around`, or null if nothing above `floor`. */
export function peakNear(x: Float32Array, sampleRate: number, around: number, window = 0.02, floor = 1e-3): number | null {
  const lo = Math.max(1, Math.floor((around - window) * sampleRate))
  const hi = Math.min(x.length - 2, Math.ceil((around + window) * sampleRate))
  let best = -1, bestV = floor
  for (let i = lo; i <= hi; i++) {
    const v = Math.abs(x[i])
    if (v > bestV) { bestV = v; best = i }
  }
  if (best < 0) return null
  // Parabolic interpolation around the max
  const a = Math.abs(x[best - 1]), b = Math.abs(x[best]), c = Math.abs(x[best + 1])
  const denom = a - 2 * b + c
  const frac = denom !== 0 ? 0.5 * (a - c) / denom : 0
  return (best + frac) / sampleRate
}

/** Deterministic pseudo-random noise (mulberry32) */
export function noise(n: number, seed = 1): Float32Array {
  let s = seed >>> 0
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
  return out
}
