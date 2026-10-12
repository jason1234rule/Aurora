/** Beat grids for the editor: disk cache first, otherwise analysed in a worker and cached. */
import type { BeatGrid } from '@/types/transition'
import BeatgridWorker from './beatgrid.worker?worker&inline'

/** Bump when analyzeBeats changes enough that cached grids should be recomputed */
export const BEATGRID_VERSION = 1

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, (grid: BeatGrid | null) => void>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new BeatgridWorker()
  worker.onmessage = (e: MessageEvent<{ id: number; grid: BeatGrid | null; error?: string }>) => {
    if (e.data.error) console.warn('[Transitions] Beat analysis failed:', e.data.error)
    pending.get(e.data.id)?.(e.data.grid)
    pending.delete(e.data.id)
  }
  worker.onerror = (e) => {
    console.error('[Transitions] Beat analysis worker crashed:', e.message)
    for (const resolve of pending.values()) resolve(null)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** Mono mix, halved in rate when it's high: beat tracking doesn't need the top octave. */
function analysisSignal(buf: AudioBuffer): { mono: Float32Array; sampleRate: number } {
  const factor = buf.sampleRate > 32000 ? 2 : 1
  const n = Math.floor(buf.length / factor)
  const mono = new Float32Array(n)
  const k = 1 / (buf.numberOfChannels * factor)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < factor; j++) s += ch[i * factor + j]
      mono[i] += s * k
    }
  }
  return { mono, sampleRate: buf.sampleRate / factor }
}

export function analyzeBuffer(buf: AudioBuffer): Promise<BeatGrid | null> {
  const { mono, sampleRate } = analysisSignal(buf)
  const id = ++nextId
  return new Promise(resolve => {
    pending.set(id, resolve)
    getWorker().postMessage({ id, mono, sampleRate }, [mono.buffer])
  })
}

export async function getBeatGrid(path: string, buf: AudioBuffer, force = false): Promise<BeatGrid | null> {
  if (!force) {
    try {
      const cached = await window.api.getBeatGrid(path)
      if (cached && cached.version === BEATGRID_VERSION) return cached
    } catch { /* fall through to analysis */ }
  }
  const analysed = await analyzeBuffer(buf)
  if (!analysed) return null
  const grid = { ...analysed, version: BEATGRID_VERSION }
  window.api.saveBeatGrid(path, grid).catch(() => {})
  return grid
}
