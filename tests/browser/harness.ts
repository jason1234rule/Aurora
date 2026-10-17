/**
 * Runs inside Chromium (see run.mjs). Plays FROM through a real <audio> element
 * wired like the player store, lets the real TransitionEngine take over, and
 * records the output with frame timestamps so run.mjs can measure alignment.
 * FROM's clicks are on the left channel, TO's on the right.
 */
import { TransitionEngine, leadInFor, MEASURE_LEAD } from '../../src/utils/transitions/engine'
import { toTimeAt, fromTimeAt } from '../../src/utils/transitions/schedule'

const RECORDER = `
class Rec extends AudioWorkletProcessor {
  constructor() {
    super()
    this.on = true
    this.chunks = []
    this.port.onmessage = () => { this.on = false; this.port.postMessage(this.chunks) }
  }
  process(inputs) {
    const inp = inputs[0]
    if (this.on && inp && inp.length) {
      const L = inp[0], R = inp[1] || inp[0]
      const c = new Float32Array(L.length * 2 + 1)
      c[0] = currentFrame
      c.set(L, 1)
      c.set(R, L.length + 1)
      this.chunks.push(c)
    }
    return true
  }
}
registerProcessor('rec', Rec)`

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const params = new URLSearchParams(location.search)

async function main() {
  const beats = await (await fetch('/beats.json')).json()
  const scenario = params.get('scenario') || 'normal'
  const ctx = new AudioContext({ sampleRate: Number(params.get('sr') || 48000) })
  await ctx.resume()

  // Same wiring as the player store's bypass chain: element → fade gain → analyser → out
  const audio = new Audio()
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'
  const src = ctx.createMediaElementSource(audio)
  const mainFade = ctx.createGain()
  const analyser = ctx.createAnalyser()
  src.connect(mainFade).connect(analyser).connect(ctx.destination)

  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER], { type: 'application/javascript' })))
  const rec = new AudioWorkletNode(ctx, 'rec', { channelCount: 2, channelCountMode: 'explicit' })
  const sink = ctx.createGain()
  sink.gain.value = 0
  analyser.connect(rec).connect(sink).connect(ctx.destination)

  const log: string[] = []
  let settled!: () => void
  const settledP = new Promise<void>(r => { settled = r })
  let settleCtx = 0, collapseAt = 0
  const engine = new TransitionEngine({
    ctx, bus: analyser, element: audio, elementSource: src, elementGain: mainFade,
    mediaUrl: (p) => p,
    onCommit: () => { log.push('commit @' + ctx.currentTime.toFixed(3)) },
    onSettled: () => { settleCtx = ctx.currentTime; log.push('settled @' + ctx.currentTime.toFixed(3)); settled() },
    onHandbackFailed: (_to, pos) => { log.push('handback FAILED at ' + pos); settled() },
  })

  const exitAt = beats.fromBeats[48]
  // stretch=meet: both songs move halfway to a shared tempo (FROM eases in over rampBack before the exit)
  const meet = params.get('stretch') === 'meet'
  const shared = meet ? Math.sqrt(120 * beats.toBpm) : 120
  const t: any = {
    id: 't1', type: params.get('type') || 'blend', exitAt, entryAt: beats.toBeats[8],
    overlap: Number(params.get('overlap') || 8), fadeOut: 'linear', fadeIn: 'linear',
    rateTo: shared / beats.toBpm, ...(meet ? { rateFrom: shared / 120 } : {}),
    ...(params.get('pitch') ? { pitch: params.get('pitch') } : {}),
    ...(params.get('rampBack') ? { rampBack: Number(params.get('rampBack')) } : {}),
    needsReview: false, createdAt: 0, updatedAt: 0,
    from: { key: 'a', path: '/from.wav', duration: 40, title: 'from', artist: 'x' },
    to: { key: 'b', path: '/to.wav', duration: 40, title: 'to', artist: 'y' },
  }
  audio.src = '/from.wav'
  await new Promise(r => audio.addEventListener('canplay', r, { once: true }))
  audio.currentTime = exitAt - (leadInFor(t) + MEASURE_LEAD + 3)
  await new Promise(r => audio.addEventListener('seeked', r, { once: true }))
  await audio.play()
  const prepStarted = performance.now()
  log.push('prepare ' + JSON.stringify(await engine.prepare(t, { id: 'f', path: '/from.wav' } as any, { id: 't', path: '/to.wav' } as any)))
  log.push(`prepare took ${(performance.now() - prepStarted).toFixed(0)} ms`)

  // What the player's timeupdate tick does
  while (exitAt - audio.currentTime > leadInFor(t) + MEASURE_LEAD) await sleep(50)
  log.push('armed ' + await engine.arm())
  const schedule = engine.schedule!

  if (scenario === 'collapse') {
    await sleep((schedule.t0 + 2 - ctx.currentTime) * 1000)
    collapseAt = ctx.currentTime + 0.05
    // A FROM that has started changing speed is re-seeked on the element: not on the old grid
    ;(window as any).__diverged = collapseAt > schedule.fromRampStart || !!t.rateFrom
    log.push('collapse ' + engine.collapseToFrom())
    await sleep(4000)
  } else if (scenario === 'next-mid') {
    await sleep((schedule.t0 + 2 - ctx.currentTime) * 1000)
    log.push('finishNow ' + engine.finishNow())
    await settledP
  } else {
    await settledP
  }
  await sleep(4000)

  const chunks: Float32Array[] = await new Promise(r => { rec.port.onmessage = (e) => r(e.data); rec.port.postMessage('stop') })
  ;(window as any).__result = {
    log, type: t.type, debug: engine.debug, sampleRate: ctx.sampleRate, settleCtx, collapseAt, exitAt,
    diverged: !!(window as any).__diverged,
    schedule: { t0: schedule.t0, overlapEnd: schedule.overlapEnd, fromStartAt: schedule.from.startAt },
    fromBeatTimes: beats.fromBeats.map((b: number) => fromTimeAt(exitAt, schedule, b)),
    // Final rate envelope (finishNow rewrites it), so TO beats map to their true ctx times
    toBeatTimes: beats.toBeats.map((b: number) => toTimeAt(schedule, b)),
    // One contiguous Float32 buffer (frame, L…, R… per block), base64 to keep the transfer small
    chunks: toBase64(chunks),
  }
}

function toBase64(chunks: Float32Array[]): string {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const all = new Float32Array(total)
  let off = 0
  for (const c of chunks) { all.set(c, off); off += c.length }
  const bytes = new Uint8Array(all.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

main().catch(e => { (window as any).__result = { error: String(e?.stack || e) } })
