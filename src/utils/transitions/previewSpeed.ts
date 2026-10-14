/**
 * Editor preview at another playback speed, keeping pitch. Only the preview changes: the
 * transition itself is untouched.
 *
 * The preview is rendered offline through the same schedule and graph as a normal preview,
 * as two stereo stems (FROM and TO, so solo still works), then time-stretched at a constant
 * rate in the stretch worker.
 */
import { buildSchedule, type TransitionTiming } from './schedule'
import { buildTransitionGraph } from './graph'
import { previewPreRoll } from './engine'
import type { StretchRenderer } from './stretch/plan'

export interface PreviewSpeedMix {
  speed: number
  /** Seconds the stems cover at normal speed, starting preRoll before the exit */
  duration: number
  preRoll: number
  /** Stereo stems at `speed`: they last duration / speed seconds */
  from: AudioBuffer
  to: AudioBuffer
}

export async function renderPreviewSpeed(
  buffers: { from: AudioBuffer; to: AudioBuffer },
  stretched: { from?: AudioBuffer; to?: AudioBuffer } | undefined,
  t: TransitionTiming,
  opts: { preRoll: number; postRoll: number; speed: number },
  render: StretchRenderer,
  /** The OfflineAudioContext class to render with (tests pass node-web-audio-api's) */
  Offline: typeof OfflineAudioContext = OfflineAudioContext,
): Promise<PreviewSpeedMix> {
  const sr = buffers.from.sampleRate
  const preRoll = previewPreRoll(t, opts.preRoll)
  const st = stretched ?? {}
  // Same geometry as engine.preview with its start at ctx time 0
  const s = buildSchedule(t, {
    t0: preRoll, leadIn: preRoll, fromWindowStart: 0, toWindowStart: 0, sampleRate: sr,
    prerendered: { from: !!st.from, to: !!st.to },
  })
  const duration = s.overlapEnd + opts.postRoll

  const ctx = new Offline(4, Math.ceil(duration * sr), sr)
  const merger = ctx.createChannelMerger(4)
  merger.connect(ctx.destination)
  const stem = (first: number) => {
    // Explicit stereo, so a mono file still fills both channels of its stem
    const out = ctx.createGain()
    out.channelCount = 2
    out.channelCountMode = 'explicit'
    const split = ctx.createChannelSplitter(2)
    out.connect(split)
    split.connect(merger, 0, first)
    split.connect(merger, 1, first + 1)
    return out
  }
  buildTransitionGraph(ctx, { from: st.from ?? buffers.from, to: st.to ?? buffers.to }, s, stem(0), stem(2))
  const mix = await ctx.startRendering()

  const channels = [0, 1, 2, 3].map(c => mix.getChannelData(c).slice())
  const out = await render({
    channels, sampleRate: sr, sourceStart: 0, startPos: 0,
    points: [{ time: 0, rate: opts.speed }], duration: duration / opts.speed,
  })
  const stereo = (a: Float32Array, b: Float32Array) => {
    const buf = ctx.createBuffer(2, a.length, sr)
    buf.copyToChannel(a as Float32Array<ArrayBuffer>, 0)
    buf.copyToChannel(b as Float32Array<ArrayBuffer>, 1)
    return buf
  }
  return { speed: opts.speed, duration, preRoll, from: stereo(out[0], out[1]), to: stereo(out[2], out[3]) }
}
