/**
 * Min/max peak pyramid for drawing zoomable waveforms. Level 0 holds the
 * mono min/max of every BASE-sample block; each level above halves the
 * resolution, so any zoom reads at most a few thousand values per redraw.
 */
const BASE = 64

interface Level { block: number; min: Float32Array; max: Float32Array }

export interface PeakSource {
  sampleRate: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export class PeakPyramid {
  readonly sampleRate: number
  readonly length: number
  readonly duration: number
  private channels: Float32Array[]
  private levels: Level[] = []

  constructor(buf: PeakSource) {
    this.sampleRate = buf.sampleRate
    this.length = buf.length
    this.duration = buf.length / buf.sampleRate
    this.channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))

    const n0 = Math.ceil(this.length / BASE)
    const min = new Float32Array(n0), max = new Float32Array(n0)
    const k = 1 / this.channels.length
    for (let b = 0; b < n0; b++) {
      let lo = Infinity, hi = -Infinity
      const end = Math.min(this.length, (b + 1) * BASE)
      for (let i = b * BASE; i < end; i++) {
        let v = 0
        for (const ch of this.channels) v += ch[i]
        v *= k
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      min[b] = lo
      max[b] = hi
    }
    this.levels.push({ block: BASE, min, max })

    while (this.levels[this.levels.length - 1].min.length > 1) {
      const prev = this.levels[this.levels.length - 1]
      const n = Math.ceil(prev.min.length / 2)
      const lmin = new Float32Array(n), lmax = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const a = 2 * i, b = Math.min(2 * i + 1, prev.min.length - 1)
        lmin[i] = Math.min(prev.min[a], prev.min[b])
        lmax[i] = Math.max(prev.max[a], prev.max[b])
      }
      this.levels.push({ block: prev.block * 2, min: lmin, max: lmax })
    }
  }

  /** [min, max] of the mono mix over [t0, t1) seconds; [0, 0] outside the file. */
  range(t0: number, t1: number): [number, number] {
    const s0 = Math.max(0, Math.floor(t0 * this.sampleRate))
    const s1 = Math.min(this.length, Math.ceil(t1 * this.sampleRate))
    if (s1 <= s0) return [0, 0]
    const span = s1 - s0

    if (span < BASE * 2) {
      // Zoomed right in: read samples directly
      let lo = Infinity, hi = -Infinity
      const k = 1 / this.channels.length
      for (let i = s0; i < s1; i++) {
        let v = 0
        for (const ch of this.channels) v += ch[i]
        v *= k
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      return [lo, hi]
    }

    // Coarsest level whose blocks are at most half the span
    let level = this.levels[0]
    for (const l of this.levels) {
      if (l.block * 2 > span) break
      level = l
    }
    const b0 = Math.floor(s0 / level.block)
    const b1 = Math.min(level.min.length, Math.ceil(s1 / level.block))
    let lo = Infinity, hi = -Infinity
    for (let b = b0; b < b1; b++) {
      if (level.min[b] < lo) lo = level.min[b]
      if (level.max[b] > hi) hi = level.max[b]
    }
    return [lo, hi]
  }
}
