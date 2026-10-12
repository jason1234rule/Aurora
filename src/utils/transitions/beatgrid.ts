/**
 * Offline beat-grid analysis for hand-made transitions.
 *
 * Pipeline:
 *  1. Onset envelope: block-average decimation to ~11 kHz, three one-pole bands
 *     (<200 Hz, 200 Hz–2 kHz, >2 kHz), log energy in short trailing windows on a
 *     ~2.5 ms hop, half-wave-rectified flux summed over the bands. Working in the
 *     log domain makes every band count regardless of its level.
 *  2. Tempo: autocorrelation of the envelope (via FFT). Each candidate period in
 *     70–180 BPM is scored by a comb over its first four multiples times a mild
 *     log-Gaussian prior around 120 BPM; an octave check then moves to double
 *     tempo when bar accents made the comb settle on half of it.
 *  3. Period sharpening: the ACF peak near 2, 4, 8 … periods is tracked out to
 *     half the track, so a one-frame quantisation error becomes 1/m of a frame.
 *  4. Phase: comb summation of the envelope at that period.
 *  5. Least-squares fit of the local onset peak nearest each predicted beat, with
 *     MAD outlier rejection and shrinking search windows, so the grid stays
 *     locked over the whole track instead of drifting. bpm is snapped to an
 *     integer / half-integer only when that is within the fit's standard error.
 *  6. Downbeat from low-band energy accents; confidence from how much onset
 *     energy the grid catches compared with other positions in the beat.
 *
 * The grid is constant-tempo by design (BeatGrid has no tempo map). Pure TS,
 * no Web Audio, so it runs in a worker or under vitest.
 */
import type { BeatGrid } from '@/types/transition'

const ANALYSIS_RATE = 11025
const HOP_SECONDS = 0.0025
const MIN_BPM = 70
const MAX_BPM = 180
const PRIOR_BPM = 120
/** σ of the tempo prior, in octaves: only breaks near-ties such as 87 vs 174 */
const PRIOR_OCTAVES = 1
const MIN_SECONDS = 4
const LOW_HZ = 200
const MID_HZ = 2000
/** Log-energy floor relative to the average window energy (−35 dB), so near-silence yields no onsets */
const ENERGY_FLOOR = 3e-4
/** Trailing energy windows per band, in hops: long enough to smooth a bass cycle, short enough for transients */
const WINDOWS = { low: 8, mid: 4, high: 2 }

function emptyGrid(): BeatGrid {
  return { bpm: 0, offset: 0, period: 0, downbeatPhase: 0, confidence: 0 }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Offset (−0.5…0.5) of the vertex of the parabola through three samples around a maximum. */
function parabolic(a: number, b: number, c: number): number {
  const denom = a - 2 * b + c
  if (!(denom < 0)) return 0
  return Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom))
}

/** Linear interpolation of x at a fractional index (0 outside the array). */
function sampleAt(x: ArrayLike<number>, pos: number): number {
  const i = Math.floor(pos)
  if (i < 0 || i >= x.length - 1) return i === x.length - 1 ? x[i] : 0
  const f = pos - i
  return x[i] + (x[i + 1] - x[i]) * f
}

// Typed-array sort is numeric and much faster than Array#sort with a comparator
function median(values: ArrayLike<number>): number {
  if (values.length === 0) return 0
  const s = Float64Array.from(values).sort()
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function percentile(values: ArrayLike<number>, q: number): number {
  if (values.length === 0) return 0
  const s = Float64Array.from(values).sort()
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

// ── Onset envelope ──────────────────────────────────────────────────────────

interface Envelope {
  /** Summed band flux, one value per hop */
  onset: Float32Array
  /** Low-band energy per hop, for downbeats */
  lowEnergy: Float64Array
  /** Seconds per hop; hop k covers [k, k+1) · hopSec */
  hopSec: number
}

/** Half-wave-rectified flux of the log energy in a trailing window of `win` hops. */
function bandFlux(e: Float64Array, win: number): Float32Array {
  const n = e.length
  let mean = 0
  for (let k = 0; k < n; k++) mean += e[k]
  mean /= n
  const floor = mean * win * ENERGY_FLOOR + 1e-30
  const out = new Float32Array(n)
  let w = 0
  // Pretend the file is preceded by audio at −20 dB: a beat on the first sample still
  // registers, but merely starting mid-sound doesn't make a giant onset
  let prev = Math.log(mean * win * 0.01 + floor)
  for (let k = 0; k < n; k++) {
    w += e[k]
    if (k >= win) w -= e[k - win]
    const l = Math.log(Math.max(0, w) + floor)
    if (l > prev) out[k] = l - prev
    prev = l
  }
  return out
}

function onsetEnvelope(x: Float32Array, sampleRate: number): Envelope | null {
  const d = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE))
  const fs = sampleRate / d
  const hop = Math.max(1, Math.round(fs * HOP_SECONDS))
  const frames = Math.floor(x.length / (d * hop))
  if (frames < 16) return null

  const eLow = new Float64Array(frames), eMid = new Float64Array(frames), eHigh = new Float64Array(frames)
  const aLow = 1 - Math.exp(-2 * Math.PI * LOW_HZ / fs)
  const aMid = 1 - Math.exp(-2 * Math.PI * Math.min(MID_HZ, fs / 4) / fs)
  const inv = 1 / d
  let l1 = 0, l2 = 0, m1 = 0, total = 0, p = 0
  for (let k = 0; k < frames; k++) {
    let sl = 0, sm = 0, sh = 0
    for (let j = 0; j < hop; j++) {
      let s = 0
      for (let q = 0; q < d; q++) s += x[p++]
      let v = s * inv
      if (!(v > -1e4 && v < 1e4)) v = 0 // NaN / Inf would poison the filters for good
      l1 += aLow * (v - l1)
      l2 += aLow * (l1 - l2)
      m1 += aMid * (v - m1)
      const lo = l2, mid = m1 - l1, hi = v - m1
      sl += lo * lo
      sm += mid * mid
      sh += hi * hi
    }
    eLow[k] = sl
    eMid[k] = sm
    eHigh[k] = sh
    total += sl + sm + sh
  }
  // Below −100 dBFS on average there is nothing to analyse
  if (!(total > 1e-10 * frames * hop)) return null

  const low = bandFlux(eLow, WINDOWS.low)
  const mid = bandFlux(eMid, WINDOWS.mid)
  const high = bandFlux(eHigh, WINDOWS.high)
  const onset = new Float32Array(frames)
  for (let k = 0; k < frames; k++) onset[k] = low[k] + mid[k] + high[k]
  return { onset, lowEnergy: eLow, hopSec: hop * d / sampleRate }
}

// ── Tempo ───────────────────────────────────────────────────────────────────

/** In-place iterative radix-2 FFT; re.length must be a power of two. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/** Unbiased autocorrelation normalised to r[0] = 1, or null for a flat input. */
function autocorrelation(x: Float64Array): Float64Array | null {
  const n = x.length
  let size = 1
  while (size < 2 * n) size <<= 1
  const re = new Float64Array(size), im = new Float64Array(size)
  re.set(x)
  fft(re, im)
  for (let i = 0; i < size; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i]
    im[i] = 0
  }
  // The power spectrum is real and even, so a forward FFT is the inverse up to scale
  fft(re, im)
  if (!(re[0] > 1e-12)) return null
  const r = new Float64Array(n)
  const r0 = re[0] / n
  for (let l = 0; l < n; l++) r[l] = re[l] / (n - l) / r0
  return r
}

/** Onset envelope minus its ~1 s moving average, so loudness and density changes don't swamp the ACF. */
function highpass(o: Float32Array, radius: number): Float64Array {
  const n = o.length
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + o[i]
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius), hi = Math.min(n, i + radius + 1)
    out[i] = o[i] - (prefix[hi] - prefix[lo]) / (hi - lo)
  }
  return out
}

function tempoPrior(bpm: number): number {
  const oct = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES
  return Math.exp(-0.5 * oct * oct)
}

/** Beat period in (fractional) hops, or null when the envelope has no periodicity at all. */
function estimatePeriod(r: Float64Array, hopSec: number): number | null {
  const n = r.length
  const maxUsable = Math.floor(n / 2)
  const minLag = Math.max(2, Math.floor(60 / MAX_BPM / hopSec))
  const maxLag = Math.min(maxUsable, Math.ceil(60 / MIN_BPM / hopSec))
  if (maxLag <= minLag) return null

  const peakIn = (lo: number, hi: number) => {
    let best = -Infinity
    for (let l = Math.max(1, lo); l <= Math.min(n - 1, hi); l++) if (r[l] > best) best = r[l]
    return best
  }

  // Comb over the first four multiples: a true period lines up with all of them, a
  // 3/2 or 2/3 relative only with some. Integer lags stand for L ± 0.5, hence the window.
  let bestLag = -1, bestScore = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0, terms = 0
    for (let j = 1; j <= 4; j++) {
      if (j * lag > maxUsable && j > 1) break
      sum += peakIn(Math.round(j * (lag - 0.5)), Math.round(j * (lag + 0.5)))
      terms++
    }
    const score = Math.max(0, sum / terms) * tempoPrior(60 / (lag * hopSec))
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }
  if (bestLag < 0) return null

  // Octave check: accents on every bar or half bar pull the comb towards half tempo.
  // Take the double tempo when its own pulse is clearly there and the prior prefers
  // it (i.e. it is below ~170 BPM, where the two octaves are equally far from 120).
  const half = bestLag / 2
  const direct = (lag: number) => peakIn(Math.floor(lag - 1), Math.ceil(lag + 1))
  if (half >= minLag && direct(half) >= 0.7 * direct(bestLag) &&
      tempoPrior(60 / (half * hopSec)) > tempoPrior(60 / (bestLag * hopSec))) {
    let l = Math.floor(half - 1)
    for (let i = l + 1; i <= Math.ceil(half + 1); i++) if (r[i] > r[l]) l = i
    bestLag = l
  }

  // Follow the ACF peak out to m periods: its position is known to within a few hops
  // at any lag, so the period error shrinks as 1/m. Smoothing first turns a peak
  // smeared by timing jitter into a single hump.
  const rs = smooth(r, 2)
  let period = bestLag, err = 1
  for (let m = 2; m <= 512; m *= 2) {
    const radius = m * err + 2
    const lo = Math.max(1, Math.floor(m * period - radius)), hi = Math.ceil(m * period + radius)
    if (hi + 1 >= maxUsable) break
    let best = lo
    for (let l = lo; l <= hi; l++) if (rs[l] > rs[best]) best = l
    if (best === lo || best === hi) break // no proper peak in the window: keep what we have
    period = (best + parabolic(rs[best - 1], rs[best], rs[best + 1])) / m
    err = 3 / m
  }
  return period
}

/** Gaussian smoothing (σ in samples, kernel truncated at 3σ). */
function smooth(x: Float64Array, sigma: number): Float64Array {
  const r = Math.ceil(3 * sigma)
  const kernel: number[] = []
  for (let i = -r; i <= r; i++) kernel.push(Math.exp(-0.5 * (i / sigma) ** 2))
  const n = x.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0
    for (let j = -r; j <= r; j++) {
      const k = i + j
      if (k >= 0 && k < n) { s += x[k] * kernel[j + r]; w += kernel[j + r] }
    }
    out[i] = s / w
  }
  return out
}

// ── Phase and least-squares refinement ─────────────────────────────────────

/** Frame position in [0, period) of the comb phase that collects the most onset energy. */
function combPhase(o: Float32Array, period: number): number {
  const n = o.length
  const bins = Math.max(1, Math.ceil(period))
  const count = Math.floor((n - 1 - bins) / period) + 1
  if (count < 1) return 0
  const sums = new Float64Array(bins)
  for (let ph = 0; ph < bins; ph++) {
    let s = 0
    for (let k = 0; k < count; k++) s += sampleAt(o, ph + k * period)
    sums[ph] = s
  }
  let best = 0
  for (let i = 1; i < bins; i++) if (sums[i] > sums[best]) best = i
  const prev = sums[(best - 1 + bins) % bins], next = sums[(best + 1) % bins]
  return (best + parabolic(prev, sums[best], next) + period) % period
}

interface LineFit {
  /** Beat k sits at frame a + b·k */
  a: number
  b: number
  ks: number[]
  /** Measured onset-peak frame for each k */
  ts: number[]
  inlier: boolean[]
  /** Standard error of b */
  seB: number
}

/**
 * Least-squares line through (k, t) with iterative outlier rejection. The tolerance
 * comes from the MAD of the stronger half of the peaks, so a long noisy intro can't
 * widen it, and is capped at `maxTol`.
 */
function robustLine(ks: number[], ts: number[], vs: number[], minTol: number, maxTol: number): LineFit | null {
  const n = ks.length
  const vMed = median(vs)
  let inlier = new Array<boolean>(n).fill(true)
  let a = 0, b = 0, seB = Infinity
  for (let iter = 0; iter < 6; iter++) {
    let cnt = 0, mk = 0, mt = 0
    for (let i = 0; i < n; i++) if (inlier[i]) { cnt++; mk += ks[i]; mt += ts[i] }
    if (cnt < 8) return null
    mk /= cnt
    mt /= cnt
    let skk = 0, skt = 0
    for (let i = 0; i < n; i++) if (inlier[i]) { skk += (ks[i] - mk) ** 2; skt += (ks[i] - mk) * (ts[i] - mt) }
    if (!(skk > 0)) return null
    b = skt / skk
    a = mt - b * mk
    const res = ts.map((t, i) => t - a - b * ks[i])
    let ss = 0
    for (let i = 0; i < n; i++) if (inlier[i]) ss += res[i] ** 2
    seB = Math.sqrt(ss / Math.max(1, cnt - 2) / skk)
    const mad = median(res.filter((_, i) => vs[i] >= vMed).map(Math.abs))
    const tol = Math.min(maxTol, Math.max(minTol, 3.5 * 1.4826 * mad))
    const next = res.map(r => Math.abs(r) <= tol)
    if (next.every((v, i) => v === inlier[i])) break
    inlier = next
  }
  if (inlier.filter(Boolean).length < 8) return null
  return { a, b, ks, ts, inlier, seB }
}

/**
 * Snap every predicted beat to the strongest onset peak near it and refit the grid
 * by least squares, with progressively narrower windows.
 */
function refineGrid(o: Float32Array, phase: number, period: number): LineFit | null {
  const n = o.length
  let a = phase, b = period
  let fit: LineFit | null = null
  for (const frac of [0.12, 0.07, 0.045]) {
    const half = Math.max(3, frac * b)
    const ks: number[] = [], ts: number[] = [], vs: number[] = []
    const kFrom = Math.ceil((-half - a) / b), kTo = Math.floor((n - 1 - a) / b)
    for (let k = kFrom; k <= kTo; k++) {
      const c = a + b * k
      const lo = Math.max(0, Math.ceil(c - half)), hi = Math.min(n - 2, Math.floor(c + half))
      if (lo > hi) continue
      let j = lo
      for (let i = lo + 1; i <= hi; i++) if (o[i] > o[j]) j = i
      const v = o[j]
      const before = j > 0 ? o[j - 1] : 0
      // A maximum on the window edge is the flank of a neighbouring event, not a beat
      if (!(v > 0) || before > v || o[j + 1] > v) continue
      ks.push(k)
      ts.push(j + parabolic(before, v, o[j + 1]))
      vs.push(v)
    }
    // Drop windows whose best peak is just background flux. Relative to both the
    // typical and the strong beats, so heavily accented bar lines don't push
    // ordinary beats under the threshold.
    const thresh = Math.min(0.35 * percentile(vs, 0.75), 0.5 * median(vs))
    const keep = vs.map(v => v >= thresh)
    const pick = <T>(xs: T[]) => xs.filter((_, i) => keep[i])
    const next = robustLine(pick(ks), pick(ts), pick(vs), 1.5, Math.max(1.5, 0.06 * b))
    if (!next || Math.abs(next.b - b) > 0.02 * b) break
    fit = next
    a = next.a
    b = next.b
  }
  return fit
}

/** Snap bpm to an integer or half-integer when that is within measurement error. */
function snapPeriod(fit: LineFit, ts: Map<number, number>, hopSec: number): { a: number; b: number } {
  const bpm = 60 / (fit.b * hopSec)
  const seBpm = bpm * fit.seB / fit.b
  for (const clean of [Math.round(bpm), Math.round(bpm * 2) / 2]) {
    if (Math.abs(bpm - clean) <= Math.max(2.5 * seBpm, 1e-6)) {
      const b = 60 / (clean * hopSec)
      let s = 0, cnt = 0
      for (const [k, t] of ts) { s += t - b * k; cnt++ }
      return { a: cnt ? s / cnt : fit.a, b }
    }
  }
  return { a: fit.a, b: fit.b }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyse a whole song (mono, any sample rate) into a constant-tempo beat grid.
 *
 * - `offset` is the first beat of sustained rhythm, so leading silence or a beatless
 *   intro is skipped; earlier grid lines are reachable with negative beat indices.
 * - Tempo is reported in 70–180 BPM. Material that is equally periodic at two
 *   octaves (e.g. a bare 174 BPM click) can come out at half tempo (87); the grid
 *   lines then fall on every other beat, which still mixes correctly.
 * - Silent, too short (< 4 s) or onset-free input returns bpm 0, period 0, offset 0,
 *   confidence 0. Rhythmless input (noise, pads, a steady tone) returns either that
 *   or a best-guess grid with confidence near 0. Never throws; never returns NaN.
 */
export function analyzeBeats(mono: Float32Array, sampleRate: number): BeatGrid {
  try {
    return analyze(mono, sampleRate)
  } catch {
    return emptyGrid()
  }
}

function analyze(mono: Float32Array, sampleRate: number): BeatGrid {
  if (!mono || !(sampleRate > 0) || !isFinite(sampleRate)) return emptyGrid()
  if (mono.length < MIN_SECONDS * sampleRate) return emptyGrid()
  const env = onsetEnvelope(mono, sampleRate)
  if (!env) return emptyGrid()
  const { onset, lowEnergy, hopSec } = env
  const n = onset.length

  const r = autocorrelation(highpass(onset, Math.round(0.5 / hopSec)))
  if (!r) return emptyGrid()
  const period0 = estimatePeriod(r, hopSec)
  if (!period0) return emptyGrid()

  const fit = refineGrid(onset, combPhase(onset, period0), period0)
  if (!fit) return emptyGrid()

  const inliers = new Map<number, number>()
  fit.ks.forEach((k, i) => { if (fit.inlier[i]) inliers.set(k, fit.ts[i]) })
  const { a, b } = snapPeriod(fit, inliers, hopSec)

  // Sustained rhythm: an inlier beat with at least 3 of the 4 beats from it on also inliers
  const sustained = (k: number, dir: 1 | -1) => {
    if (!inliers.has(k)) return false
    let c = 0
    for (let i = 0; i < 4; i++) if (inliers.has(k + dir * i)) c++
    return c >= 3
  }
  // Frame f is centred on (f + 0.5)·hopSec; a beat up to half a hop before 0 is the
  // one on the very first sample, so it counts (and is clamped to 0 below)
  const kFirst = Math.ceil((-1 - a) / b), kLast = Math.floor((n - 1 - a) / b)
  let k0 = kFirst, kEnd = kLast
  while (k0 <= kLast && !sustained(k0, 1)) k0++
  while (kEnd >= k0 && !sustained(kEnd, -1)) kEnd--
  if (kEnd - k0 < 7) {
    k0 = Math.max(kFirst, Math.min(...inliers.keys()))
    kEnd = Math.min(kLast, Math.max(...inliers.keys()))
  }

  const confidence = gridConfidence(onset, a, b, k0, kEnd, inliers)
  const downbeatPhase = findDownbeat(lowEnergy, a, b, k0, kEnd)
  const period = b * hopSec
  const offset = Math.max(0, (a + b * k0 + 0.5) * hopSec)
  const out: BeatGrid = { bpm: 60 / period, offset, period, downbeatPhase, confidence }
  return Object.values(out).every(isFinite) ? out : emptyGrid()
}

/**
 * Confidence = contrast × share × coverage:
 *  - contrast: typical (median over beats) local onset peak on the grid versus at
 *    other positions within the beat. Medians make a majority of beats carry an
 *    onset, so a few lucky hits in noise or random events don't count.
 *  - share: fraction of beats in the rhythmic span with a matched onset.
 *  - coverage: how much of the track the rhythmic span covers (saturates at 25%).
 * An absolute salience term then discounts grids whose "onsets" are sub-dB ripples
 * (steady tones beating against the analysis windows).
 */
function gridConfidence(o: Float32Array, a: number, b: number, k0: number, kEnd: number, inliers: Map<number, number>): number {
  const n = o.length
  if (kEnd - k0 < 7) return 0
  // Local max over ±2 hops absorbs quantisation and small timing jitter
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (o[j] > v) v = o[j]
    m[i] = v
  }
  const centres: number[] = []
  for (let k = k0; k <= kEnd; k++) centres.push(Math.round(a + b * k))
  const half = Math.floor(b / 2)
  let peak = 0
  const others: number[] = []
  const col: number[] = []
  for (let d = -half; d <= half; d++) {
    col.length = 0
    for (const c of centres) if (c + d >= 0 && c + d < n) col.push(m[c + d])
    const v = median(col)
    if (Math.abs(d) <= 1) peak = Math.max(peak, v)
    else if (Math.abs(d) > 4) others.push(v)
  }
  if (!(peak > 0)) return 0
  const contrast = (peak - median(others)) / peak
  let hits = 0
  for (let k = k0; k <= kEnd; k++) if (inliers.has(k)) hits++
  const share = hits / (kEnd - k0 + 1)
  const coverage = Math.min(1, (kEnd - k0 + 1) * b / (0.25 * n))
  const salience = clamp01((peak - 0.15) / 0.35)
  return clamp01((contrast - 0.25) / 0.55) * share * coverage * salience
}

/**
 * Downbeat = the bar position (relative to beat k0) whose beats add the most
 * low-band energy (kick and bass accents). Linear energy rather than log flux, so the
 * size of the accent counts, not how quiet it was just before. Falls back to 0 (music
 * usually starts on a downbeat) when position 0 is within 10% of the strongest, e.g.
 * for identical kicks on every beat.
 */
function findDownbeat(lowEnergy: Float64Array, a: number, b: number, k0: number, kEnd: number): number {
  const n = lowEnergy.length
  const span = Math.max(2, Math.round(0.03 / HOP_SECONDS))
  const sums = [0, 0, 0, 0], counts = [0, 0, 0, 0]
  for (let k = k0; k <= kEnd; k++) {
    const c = Math.round(a + b * k)
    let before = 0, after = 0
    for (let i = Math.max(0, c - span); i < c; i++) before += lowEnergy[i]
    for (let i = Math.max(0, c); i < Math.min(n, c + span); i++) after += lowEnergy[i]
    const p = (k - k0) % 4
    sums[p] += Math.max(0, after - before)
    counts[p]++
  }
  const avg = sums.map((s, i) => (counts[i] ? s / counts[i] : 0))
  let best = 0
  for (let p = 1; p < 4; p++) if (avg[p] > avg[best]) best = p
  return avg[0] >= 0.9 * avg[best] ? 0 : best
}

// ── Grid helpers ────────────────────────────────────────────────────────────

const hasPeriod = (grid: BeatGrid) => grid.period > 0 && isFinite(grid.period)

/** Time of beat `index` (0 = offset; negative indices are before the first beat). */
export function beatTime(grid: BeatGrid, index: number): number {
  return grid.offset + index * (hasPeriod(grid) ? grid.period : 0)
}

/** Fractional beat index at time t (0 for a grid without a period). */
export function beatIndexAt(grid: BeatGrid, t: number): number {
  return hasPeriod(grid) ? (t - grid.offset) / grid.period : 0
}

/** Time of the beat nearest to t. */
export function nearestBeat(grid: BeatGrid, t: number): number {
  return beatTime(grid, Math.round(beatIndexAt(grid, t)))
}

/** True when integer beat `index` starts a 4-beat bar. */
export function isDownbeat(grid: BeatGrid, index: number): boolean {
  if (!Number.isInteger(index)) return false
  return (((index - Math.round(grid.downbeatPhase)) % 4) + 4) % 4 === 0
}

/** Beat times within [from, to] (inclusive, with a little float tolerance). */
export function beatsBetween(grid: BeatGrid, from: number, to: number): number[] {
  if (!hasPeriod(grid) || !(to >= from)) return []
  const eps = 1e-9
  const first = Math.ceil(beatIndexAt(grid, from) - eps)
  const last = Math.floor(beatIndexAt(grid, to) + eps)
  const out: number[] = []
  for (let i = first; i <= last && out.length < 100000; i++) out.push(beatTime(grid, i))
  return out
}
