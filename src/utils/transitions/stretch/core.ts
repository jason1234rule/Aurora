/**
 * Offline, pitch-preserving time stretch that follows an exact tempo envelope,
 * using Signalsmith Stretch (MIT). Runs wherever WASM runs: a Web Worker in the
 * app, Node in the tests. Never on the UI thread.
 *
 * The stretcher is seeked once, then fed block by block exactly the input the
 * envelope calls for: before each output block the input head is moved to
 * (position heard outputLatency after the block's end) + inputLatency. Because
 * that target comes from the envelope every block, rounding never accumulates
 * into drift. Measured against click tracks: exact at rate 1, within about
 * ±0.5 ms at ±8–10% (see tests/transitions/stretch.test.ts).
 */
import { capturedProcessor } from './signalsmithShim'
import 'signalsmith-stretch'
import { positionAt, rateAt, type RatePoint } from '../schedule'

export interface StretchJob {
  /** Source audio (one array per channel) and its sample rate */
  channels: Float32Array[]
  sampleRate: number
  /** File position (s) of channels[*][0] */
  sourceStart: number
  /** File position heard at output time 0 */
  startPos: number
  /** Rate envelope against output time (s from output start), as in schedule.ts */
  points: RatePoint[]
  /** Output length in seconds */
  duration: number
}

/** Output frames per process() call */
const BLOCK = 128
/** Rendered then discarded before output time 0, so the stretcher has settled when it counts */
const PRE_ROLL = 0.25
/**
 * Longer analysis blocks than the library default: cleaner chords (noise between partials
 * −48 dB → −64…−78 dB in the comparison) for about 1.5× the CPU. Renders are offline and
 * run ~90× real time on Apple Silicon, so the cost doesn't matter here.
 */
const QUALITY = { blockMs: 180, intervalMs: 40 }

interface Stretcher {
  module: any
  bufferLength: number
  buffersIn: number[]
  buffersOut: number[]
  inputLatency: number
  outputLatency: number
}

const cache = new Map<string, Promise<Stretcher>>()

async function createStretcher(channels: number, sampleRate: number): Promise<Stretcher> {
  if (!capturedProcessor) throw new Error('signalsmith-stretch did not register its processor')
  const g = globalThis as any
  // Read by the processor's constructor and configure()
  g.sampleRate = sampleRate
  g.currentTime = 0
  const proc = new capturedProcessor({ numberOfOutputs: 1, outputChannelCount: [channels] })
  for (let i = 0; i < 500 && !proc.wasmReady; i++) await new Promise(r => setTimeout(r, 2))
  if (!proc.wasmReady) throw new Error('Signalsmith Stretch WASM failed to start')
  // Reconfigure from the library default; this also refreshes buffers and latencies
  proc.config = { ...QUALITY }
  proc.configure()
  return {
    module: proc.wasmModule,
    bufferLength: proc.bufferLength,
    buffersIn: proc.buffersIn,
    buffersOut: proc.buffersOut,
    inputLatency: proc.inputLatencySeconds,
    outputLatency: proc.outputLatencySeconds,
  }
}

function getStretcher(channels: number, sampleRate: number): Promise<Stretcher> {
  const key = `${channels}@${sampleRate}`
  let p = cache.get(key)
  if (!p) {
    p = createStretcher(channels, sampleRate)
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

function heap(module: any): ArrayBuffer {
  return module.exports ? module.exports.memory.buffer : module.HEAP8.buffer
}

/** Latencies of the stretcher for this layout, in seconds */
export async function stretchLatency(channels: number, sampleRate: number) {
  const s = await getStretcher(channels, sampleRate)
  return { input: s.inputLatency, output: s.outputLatency }
}

export async function renderStretch(job: StretchJob): Promise<Float32Array[]> {
  const nCh = job.channels.length
  const sr = job.sampleRate
  const s = await getStretcher(nCh, sr)
  const m = s.module
  m._reset()
  // Keep pitch (0 semitones); the library's defaults for tonality limit and formants
  m._setTransposeSemitones(0, 8000 / sr)
  m._setFormantSemitones(0, 0)
  m._setFormantBase(0)

  const outLen = Math.ceil(job.duration * sr)
  const out = Array.from({ length: nCh }, () => new Float32Array(outLen))
  const srcLen = job.channels[0].length
  const preBlocks = Math.ceil(PRE_ROLL * sr / BLOCK)

  /** Input index the head should reach once output time `t` has been produced */
  const headAt = (t: number) =>
    Math.round((positionAt(0, job.startPos, job.points, t + s.outputLatency) + s.inputLatency - job.sourceStart) * sr)

  /** Copy source[start, end) into dst, zero-filling outside the source */
  const fill = (dst: Float32Array, src: Float32Array, start: number, end: number) => {
    const a = Math.max(0, start), z = Math.min(srcLen, end)
    if (z <= a) { dst.fill(0, 0, end - start); return }
    if (a > start) dst.fill(0, 0, a - start)
    dst.set(src.subarray(a, z), a - start)
    if (z < end) dst.fill(0, z - start, end - start)
  }

  const t0 = -preBlocks * BLOCK / sr
  let head = headAt(t0)
  let mem = heap(m)
  for (let c = 0; c < nCh; c++) {
    fill(new Float32Array(mem, s.buffersIn[c], s.bufferLength), job.channels[c], head - s.bufferLength, head)
  }
  m._seek(s.bufferLength, rateAt(job.points, t0 + s.outputLatency))

  for (let b = -preBlocks; b * BLOCK < outLen; b++) {
    const target = headAt((b + 1) * BLOCK / sr)
    const nIn = Math.max(0, Math.min(s.bufferLength, target - head))
    mem = heap(m)
    for (let c = 0; c < nCh; c++) {
      fill(new Float32Array(mem, s.buffersIn[c], nIn), job.channels[c], head, head + nIn)
    }
    m._process(nIn, BLOCK)
    head += nIn
    if (b < 0) continue
    // process() may grow memory, so take a fresh view
    mem = heap(m)
    const o0 = b * BLOCK
    const n = Math.min(BLOCK, outLen - o0)
    for (let c = 0; c < nCh; c++) out[c].set(new Float32Array(mem, s.buffersOut[c], n), o0)
  }
  return out
}
