// Time-stretch rendering off the UI thread. Loaded inline (?worker&inline) so it
// also works when the renderer is served from file:// in packaged builds.
import { renderStretch, type StretchJob } from './core'

self.onmessage = async (e: MessageEvent<{ id: number; job: StretchJob }>) => {
  const { id, job } = e.data
  try {
    const started = performance.now()
    const channels = await renderStretch(job)
    self.postMessage({ id, channels, ms: performance.now() - started }, { transfer: channels.map(c => c.buffer) })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
