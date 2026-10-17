/** Main-thread side of the stretch worker. Jobs run one at a time, in order. */
import type { StretchJob } from './core'
import StretchWorker from './stretch.worker?worker&inline'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (c: Float32Array[]) => void; reject: (e: Error) => void }>()

/** Time the last few renders took, for the dev hook / RETURN_NOTES numbers */
export const stretchTimings: { seconds: number; ms: number }[] = []

function getWorker(): Worker {
  if (worker) return worker
  worker = new StretchWorker()
  worker.onmessage = (e: MessageEvent<{ id: number; channels?: Float32Array[]; ms?: number; error?: string }>) => {
    const p = pending.get(e.data.id)
    pending.delete(e.data.id)
    if (!p) return
    if (e.data.error || !e.data.channels) p.reject(new Error(e.data.error ?? 'stretch failed'))
    else p.resolve(e.data.channels)
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`stretch worker crashed: ${e.message}`))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function stretchInWorker(job: StretchJob): Promise<Float32Array[]> {
  const id = ++nextId
  const started = performance.now()
  return new Promise<Float32Array[]>((resolve, reject) => {
    pending.set(id, {
      resolve: (c) => {
        stretchTimings.push({ seconds: job.duration, ms: performance.now() - started })
        if (stretchTimings.length > 20) stretchTimings.shift()
        resolve(c)
      },
      reject,
    })
    getWorker().postMessage({ id, job }, job.channels.map(c => c.buffer))
  })
}
