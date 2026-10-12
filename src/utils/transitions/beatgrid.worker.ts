// Beat-grid analysis off the UI thread. Loaded inline (?worker&inline) so it
// also works when the renderer is served from file:// in packaged builds.
import { analyzeBeats } from './beatgrid'

self.onmessage = (e: MessageEvent<{ id: number; mono: Float32Array; sampleRate: number }>) => {
  const { id, mono, sampleRate } = e.data
  try {
    self.postMessage({ id, grid: analyzeBeats(mono, sampleRate) })
  } catch (err) {
    self.postMessage({ id, grid: null, error: String(err) })
  }
}
