#!/usr/bin/env node
/**
 * Browser integration test for the transition engine.
 *
 * Plays synthetic click tracks through a real <audio> element in Chromium and
 * lets the real TransitionEngine take over and hand back, then checks the
 * recorded output: FROM and TO clicks must stay on their scheduled grids
 * across the element→buffer swap, the overlap, and the handback.
 *
 *   node tests/browser/run.mjs                  # all scenarios
 *   node tests/browser/run.mjs "type=cut"       # one scenario (query string)
 *
 * Needs Playwright with a Chromium build. Not part of `npm test`; set
 * PLAYWRIGHT_MODULE to the playwright package path if it isn't resolvable.
 */
import http from 'http'
import { readFileSync, writeFileSync, mkdtempSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, extname, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'aurora-tx-'))
const SR = 48000
const TOLERANCE_MS = 1.5

const SCENARIOS = [
  'sr=48000',
  'sr=44100',
  'sr=48000&type=cut',
  'sr=48000&type=echo-out&overlap=4',
  'sr=48000&scenario=next-mid',
  'sr=44100&scenario=next-mid',
  'sr=48000&scenario=collapse',
  // Pitch-preserving stretch (pre-rendered in the worker)
  'sr=48000&pitch=keep&rampBack=4',
  'sr=44100&pitch=keep&rampBack=4',
  'sr=48000&pitch=keep&stretch=meet&rampBack=4',
  'sr=44100&pitch=keep&stretch=meet&rampBack=4',
  'sr=48000&pitch=keep&rampBack=4&scenario=next-mid',
  'sr=48000&pitch=keep&stretch=meet&rampBack=4&scenario=collapse',
  'sr=48000&pitch=vinyl&stretch=meet&rampBack=4',
]

// ── Test material ─────────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/** 16-bit stereo WAV: raised-cosine clicks + a quiet noise bed on one channel, silence on the other */
function writeClickWav(file, seconds, bpm, offset, side, seed) {
  const n = seconds * SR
  const ch = new Float32Array(n)
  const r = rng(seed)
  for (let i = 0; i < n; i++) ch[i] = r() * 0.05
  const beats = []
  const w = 0.0008 * SR
  for (let t = offset; t < seconds; t += 60 / bpm) {
    beats.push(t)
    const c = t * SR
    for (let i = Math.ceil(c - w); i <= Math.floor(c + w); i++) {
      if (i >= 0 && i < n) ch[i] += 0.4 * (1 + Math.cos(Math.PI * (i - c) / w))
    }
  }
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36)
  buf.writeUInt32LE(n * 4, 40)
  const off = side === 'L' ? 0 : 2
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767))), 44 + i * 4 + off)
  writeFileSync(file, buf)
  return beats
}

const toBpm = 123
const fromBeats = writeClickWav(join(work, 'from.wav'), 40, 120, 0.37, 'L', 7)
const toBeats = writeClickWav(join(work, 'to.wav'), 40, toBpm, 0.11, 'R', 9)
writeFileSync(join(work, 'beats.json'), JSON.stringify({ fromBeats, toBeats, toBpm }))
writeFileSync(join(work, 'index.html'), '<!doctype html><html><body><script src="/harness.js"></script></body></html>')
// Vite's `?worker&inline` imports, rebuilt for esbuild: bundle the worker and start it from a blob
const inlineWorkers = {
  name: 'inline-workers',
  setup(b) {
    b.onResolve({ filter: /\?worker&inline$/ }, args => ({
      path: join(args.resolveDir, args.path.replace(/\?worker&inline$/, '') + '.ts'), namespace: 'inline-worker',
    }))
    b.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async args => {
      const r = await build({ entryPoints: [args.path], bundle: true, format: 'iife', write: false, logLevel: 'error' })
      return {
        contents: `const code = ${JSON.stringify(r.outputFiles[0].text)}
export default class InlineWorker extends Worker {
  constructor() { super(URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))) }
}`,
        loader: 'js',
      }
    })
  },
}
await build({ entryPoints: [join(here, 'harness.ts')], bundle: true, format: 'iife', outfile: join(work, 'harness.js'), logLevel: 'error', plugins: [inlineWorkers] })

// ── Static server with Range support (media elements need it to seek) ─────
const types = { '.html': 'text/html', '.js': 'application/javascript', '.wav': 'audio/wav', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const file = join(work, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'))
  let size
  try { size = statSync(file).size } catch { res.writeHead(404); return res.end() }
  const data = readFileSync(file)
  const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' }
  const m = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range)
  if (m) {
    const s = +m[1], e = m[2] ? +m[2] : size - 1
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 })
    return res.end(data.subarray(s, e + 1))
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  res.end(data)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

// ── Analysis ──────────────────────────────────────────────────────────────
function clickPeaks(x, startTime, sampleRate) {
  const out = []
  for (let i = 1; i < x.length - 1; i++) {
    const v = Math.abs(x[i])
    if (v > 0.2 && v >= Math.abs(x[i - 1]) && v > Math.abs(x[i + 1])) {
      // A time-stretched click can ring a little before its main peak: take the largest within 2 ms
      for (let j = i + 1; j < Math.min(x.length - 1, i + 0.002 * sampleRate); j++) if (Math.abs(x[j]) > Math.abs(x[i])) i = j
      const v = Math.abs(x[i])
      const a = Math.abs(x[i - 1]), c = Math.abs(x[i + 1]), d = a - 2 * v + c
      out.push(startTime + (i + (d ? 0.5 * (a - c) / d : 0)) / sampleRate)
      i += Math.round(0.05 * sampleRate)
    }
  }
  return out
}

function errorsMs(peaks, expected, lo, hi) {
  return peaks.filter(p => p >= lo && p <= hi).map(p => {
    const e = expected.reduce((best, x) => Math.abs(x - p) < Math.abs(best - p) ? x : best, Infinity)
    return (p - e) * 1000
  })
}

/** Split the harness's flat buffer back into [frame, L(128), R(128)] blocks */
function decodeChunks(b64) {
  const buf = Buffer.from(b64, 'base64')
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const chunks = []
  for (let i = 0; i < all.length; i += 257) chunks.push(all.subarray(i, i + 257))
  return chunks
}

function analyze(r) {
  r.chunks = decodeChunks(r.chunks)
  const sr = r.sampleRate
  const first = r.chunks[0][0], last = r.chunks[r.chunks.length - 1]
  const n = last[0] + (last.length - 1) / 2 - first
  const L = new Float32Array(n), R = new Float32Array(n)
  for (const c of r.chunks) {
    const h = (c.length - 1) / 2, off = c[0] - first
    for (let i = 0; i < h; i++) { L[off + i] = c[1 + i]; R[off + i] = c[1 + h + i] }
  }
  const start = first / sr
  const s = r.schedule
  // Where FROM's clicks are heard, following its tempo envelope (rate 1 unless it changes speed)
  const fromExpected = r.fromBeatTimes
  const Lp = clickPeaks(L, start, sr), Rp = clickPeaks(R, start, sr)
  const segments = {
    'FROM on element, before swap-in': errorsMs(Lp, fromExpected, start, s.fromStartAt - 0.01),
  }
  if (r.collapseAt) {
    segments['FROM on buffer, before back-out'] = errorsMs(Lp, fromExpected, s.fromStartAt + 0.05, r.collapseAt)
    if (r.diverged) {
      // FROM had changed speed, so the element was re-seeked: it only has to be steady on its own grid
      const after = Lp.filter(p => p > r.collapseAt + 0.3)
      segments['FROM on element, after back-out (own grid)'] = errorsMs(after, after.map((_, i) => after[0] + i * 0.5), -Infinity, Infinity)
    } else {
      segments['FROM on element, after back-out'] = errorsMs(Lp, fromExpected, r.collapseAt + 0.1, Infinity)
    }
  } else {
    // Echo-out: after the dry cut the left channel is echo repeats, which are off-grid by design
    segments['FROM on buffer'] = errorsMs(Lp, fromExpected, s.fromStartAt + 0.05, r.type === 'echo-out' ? s.t0 : s.overlapEnd)
    segments['TO on buffer'] = errorsMs(Rp, r.toBeatTimes, s.t0, r.settleCtx - 0.05)
    segments['TO on element, after handback'] = errorsMs(Rp, r.toBeatTimes, r.settleCtx + 0.01, Infinity)
  }
  // Peak picking has a small constant bias; judge everything against the untouched element
  const base = segments['FROM on element, before swap-in']
  const ref = base.reduce((a, b) => a + b, 0) / base.length
  let ok = true
  const lines = []
  for (const [name, errs] of Object.entries(segments)) {
    if (!errs.length) { lines.push(`  ${name}: no clicks found`); ok = false; continue }
    const worst = Math.max(...errs.map(e => Math.abs(e - ref)))
    const pass = worst <= TOLERANCE_MS
    ok &&= pass
    lines.push(`  ${pass ? '✓' : '✗'} ${name}: ${errs.length} clicks, worst ${worst.toFixed(2)} ms`)
  }
  if (r.collapseAt) {
    let mx = 0
    // The re-seek path fades over a little longer
    const quietFrom = r.collapseAt + (r.diverged ? 0.3 : 0.1)
    for (let i = Math.round((quietFrom - start) * sr); i < n; i++) mx = Math.max(mx, Math.abs(R[i]))
    const pass = mx < 1e-4
    ok &&= pass
    lines.push(`  ${pass ? '✓' : '✗'} TO silent after back-out (peak ${mx.toExponential(1)})`)
  }
  return { ok, lines }
}

// ── Run ───────────────────────────────────────────────────────────────────
const pwPath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(pwPath ? pathToFileURL(join(pwPath, 'index.mjs')).href : 'playwright')
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
let failures = 0
for (const q of process.argv[2] ? [process.argv[2]] : SCENARIOS) {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/?${q}`)
  await page.waitForFunction(() => window.__result, null, { timeout: 90_000 })
  const r = await page.evaluate(() => window.__result)
  await page.close()
  if (r.error) { console.log(`✗ ${q}\n  ${r.error}`); failures++; continue }
  const { ok, lines } = analyze(r)
  if (!ok) failures++
  const hb = r.debug.handback
  const prep = r.log.find(l => l.startsWith('prepare took'))
  console.log(`${ok ? '✓' : '✗'} ${q}  (arm: ${r.debug.arm?.method}${hb ? `, handback: ${hb.converged ? 'converged' : 'NOT converged'} in ${hb.iterations} seeks` : ''}${prep ? `, ${prep}` : ''})`)
  console.log(lines.join('\n'))
}
await browser.close()
server.close()
process.exit(failures ? 1 : 0)
