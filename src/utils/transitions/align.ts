/**
 * Locates a short capture of a media element's output inside the decoded
 * buffer of the same file. Media elements report currentTime with tens of ms
 * of slop and can disagree with decodeAudioData about encoder delay, so we
 * measure the real offset instead of trusting either.
 */

export interface AlignResult {
  /** Index in `reference` where captured[0] lines up */
  index: number
  /** Normalised cross-correlation at that index (1 = identical up to gain) */
  score: number
}

/** Average all channels of an AudioBuffer-like object into one Float32Array. */
export function mixToMono(buf: { numberOfChannels: number; length: number; getChannelData(c: number): Float32Array }): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice()
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += ch[i]
  }
  const k = 1 / buf.numberOfChannels
  for (let i = 0; i < out.length; i++) out[i] *= k
  return out
}

/** Block-average decimation: a crude low-pass plus downsample, good enough for a coarse search. */
function decimate(x: Float32Array, factor: number): Float32Array {
  const n = Math.floor(x.length / factor)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const base = i * factor
    for (let j = 0; j < factor; j++) s += x[base + j]
    out[i] = s / factor
  }
  return out
}

/** Normalised correlation of cap against ref starting at lag; refEnergy is Σ ref² over that window. */
function ncc(ref: Float32Array, cap: Float32Array, lag: number, capEnergy: number, refEnergy: number): number {
  let dot = 0
  for (let i = 0; i < cap.length; i++) dot += ref[lag + i] * cap[i]
  const denom = Math.sqrt(capEnergy * refEnergy)
  return denom > 0 ? dot / denom : 0
}

function energy(x: Float32Array, from = 0, len = x.length): number {
  let e = 0
  for (let i = from; i < from + len; i++) e += x[i] * x[i]
  return e
}

/**
 * Search `reference` for the best match of `captured` within ±radius samples of
 * `expectedIndex`. Coarse pass on decimated signals, then a sample-accurate refine.
 * Returns null when the search window is empty or either signal is silent.
 */
export function findAlignment(
  reference: Float32Array,
  captured: Float32Array,
  expectedIndex: number,
  radius: number,
  decimation = 8,
): AlignResult | null {
  const maxLag = reference.length - captured.length
  if (maxLag < 0 || captured.length < decimation * 16) return null
  const lo = Math.max(0, Math.floor(expectedIndex - radius))
  const hi = Math.min(maxLag, Math.ceil(expectedIndex + radius))
  if (hi < lo) return null

  const capEnergy = energy(captured)
  if (capEnergy < 1e-8) return null

  // ── Coarse search ──
  const refD = decimate(reference, decimation)
  const capD = decimate(captured, decimation)
  const capDEnergy = energy(capD)
  const dLo = Math.floor(lo / decimation)
  const dHi = Math.min(Math.floor(hi / decimation), refD.length - capD.length)
  if (dHi < dLo || capDEnergy < 1e-10) return null

  // Sliding window energy of the reference
  let winE = energy(refD, dLo, capD.length)
  let best = dLo, bestScore = -Infinity
  for (let lag = dLo; lag <= dHi; lag++) {
    if (lag > dLo) {
      const outV = refD[lag - 1], inV = refD[lag + capD.length - 1]
      winE += inV * inV - outV * outV
    }
    const sc = ncc(refD, capD, lag, capDEnergy, Math.max(winE, 0))
    if (sc > bestScore) { bestScore = sc; best = lag }
  }

  // ── Fine search around the coarse peak ──
  // Both sides get the same short moving average first: the media element and decodeAudioData
  // resample differently near Nyquist, which costs correlation without moving the peak.
  const fLo = Math.max(lo, best * decimation - 2 * decimation)
  const fHi = Math.min(hi, best * decimation + 2 * decimation)
  const refSlice = smooth(reference.subarray(fLo, Math.min(reference.length, fHi + captured.length)))
  const capS = smooth(captured)
  const capSEnergy = energy(capS)
  let fineBest = fLo, fineScore = -Infinity
  for (let lag = fLo; lag <= fHi; lag++) {
    const sc = ncc(refSlice, capS, lag - fLo, capSEnergy, energy(refSlice, lag - fLo, capS.length))
    if (sc > fineScore) { fineScore = sc; fineBest = lag }
  }
  return { index: fineBest, score: fineScore }
}

/** 4-tap moving average (first null at a quarter of the sample rate). Same length as the input. */
function smooth(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    out[i] = (x[i] + (x[i - 1] ?? 0) + (x[i - 2] ?? 0) + (x[i - 3] ?? 0)) * 0.25
  }
  return out
}
