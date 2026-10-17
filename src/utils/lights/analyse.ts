/**
 * Everything the lights need to know about a song, worked out once from its audio: beat grid
 * (cached on disk by the transitions code), energy curve, a waveform for the editor and the
 * cover's colours. Kept in memory for the last few songs.
 */
import type { BeatGrid } from '@/types/transition'
import { getBeatGrid } from '@/utils/transitions/analysis'
import { coverPalette } from '@/utils/coverColor'
import { computeEnergy, type Energy } from './energy'
import { usableGrid } from './show'
import type { RGB } from './govee'

export interface SongAnalysis {
  grid: BeatGrid | null
  energy: Energy
  /** Loudest sample per PEAK_STEP seconds, 0–1 */
  peaks: Float32Array
  palette: RGB[]
  duration: number
}

export const PEAK_STEP = 0.05
const KEEP = 12

const cache = new Map<string, Promise<SongAnalysis | null>>()
let decodeCtx: AudioContext | null = null

export function analyseSong(track: Pick<Track, 'path' | 'coverArt'>): Promise<SongAnalysis | null> {
  const hit = cache.get(track.path)
  if (hit) return hit
  const p = run(track)
  cache.set(track.path, p)
  p.then(r => { if (!r) cache.delete(track.path) })
  while (cache.size > KEEP) cache.delete(cache.keys().next().value!)
  return p
}

/** Already analysed (or being analysed)? */
export const isAnalysing = (path: string) => cache.has(path)

async function run(track: Pick<Track, 'path' | 'coverArt'>): Promise<SongAnalysis | null> {
  try {
    const palette = track.coverArt ? await coverPalette(track.coverArt) : []
    const data = await (await fetch(window.api.getMediaUrl(track.path))).arrayBuffer()
    decodeCtx ??= new AudioContext()
    const buf = await decodeCtx.decodeAudioData(data)
    const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
    const energy = computeEnergy(channels, buf.sampleRate)
    const peaks = peaksOf(channels, buf.sampleRate)
    let grid: BeatGrid | null = null
    try {
      const cached = await window.api.getBeatGrid(track.path)
      if (usableGrid(cached)) grid = cached
    } catch { /* analyse below */ }
    grid ??= await getBeatGrid(track.path, buf)
    return { grid: usableGrid(grid) ? grid : null, energy, peaks, palette, duration: buf.duration }
  } catch (err) {
    console.warn('[Lights] Couldn\'t analyse', track.path, err)
    return null
  }
}

function peaksOf(channels: Float32Array[], sampleRate: number): Float32Array {
  const step = Math.max(1, Math.round(sampleRate * PEAK_STEP))
  const n = Math.ceil((channels[0]?.length ?? 0) / step)
  const out = new Float32Array(n)
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      let m = out[i]
      const end = Math.min(ch.length, (i + 1) * step)
      for (let j = i * step; j < end; j += 3) { const v = Math.abs(ch[j]); if (v > m) m = v }
      out[i] = m
    }
  }
  return out
}
