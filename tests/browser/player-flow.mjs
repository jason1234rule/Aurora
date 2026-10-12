#!/usr/bin/env node
/**
 * End-to-end check of the player store with a saved transition: serves the
 * built renderer (run `npm run build` first) with a mocked window.api, plays
 * two generated house loops (124 → 127 BPM) and drives the real player through
 * a transition and every cancel path, asserting track / play state / position.
 *
 *   node tests/browser/player-flow.mjs            # all scenarios
 *   node tests/browser/player-flow.mjs pause-post # one
 *
 * Needs Playwright with Chromium (PLAYWRIGHT_MODULE=<path to playwright> if not resolvable).
 */
import http from 'http'
import { readFileSync, writeFileSync, statSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, extname, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '../../dist')
const music = mkdtempSync(join(tmpdir(), 'aurora-flow-'))

// ── Two synthetic house loops: 8-beat pad intro, then kick / offbeat hat / bass ──
function writeLoop(file, seconds, bpm, seed, root) {
  const SR = 44100, n = seconds * SR
  const L = new Float32Array(n), R = new Float32Array(n)
  let s = seed >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1 }
  const beat = 60 / bpm, intro = 8 * beat
  for (let t = 0.2, k = 0; t < seconds; t += beat, k++) {
    if (t <= intro) continue
    const i0 = Math.round(t * SR), h0 = Math.round((t + beat / 2) * SR)
    for (let i = 0; i < 0.25 * SR && i0 + i < n; i++) {
      const x = i / SR, v = Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-x * 30)) * x) * Math.exp(-x * 9) * 0.8
      L[i0 + i] += v; R[i0 + i] += v
    }
    for (let i = 0; i < 0.04 * SR && h0 + i < n; i++) {
      const v = rnd() * Math.exp(-i / SR * 120) * 0.15
      L[h0 + i] += v; R[h0 + i] += v * 0.8
    }
    const note = root * [1, 1, 1.5, 1.335][k % 4]
    for (let i = 0; i < beat * 0.45 * SR && i0 + i < n; i++) {
      const x = i / SR, v = Math.sign(Math.sin(2 * Math.PI * note * x)) * 0.12 * Math.min(1, x * 200) * Math.exp(-x * 3)
      L[i0 + i] += v; R[i0 + i] += v
    }
  }
  for (let i = 0; i < n; i++) { const x = i / SR, v = 0.05 * Math.sin(2 * Math.PI * root * 4 * x) * (0.6 + 0.4 * Math.sin(x)); L[i] += v; R[i] += v * 0.9 }
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 30000))), 44 + i * 4)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 30000))), 46 + i * 4)
  }
  writeFileSync(file, buf)
}
writeLoop(join(music, 'a.wav'), 90, 124, 1, 55)
writeLoop(join(music, 'b.wav'), 90, 127, 2, 49)

// A transition like the editor suggests for these two: 16 beats, rate matched, bass swap halfway
const EXIT = 66.007
const transition = {
  id: 'tx1', type: 'blend', exitAt: EXIT, entryAt: 5.398, overlap: 7.742, fadeOut: 'equal-power', fadeIn: 'equal-power',
  bassSwap: { at: 3.87 }, rateTo: 124 / 127, needsReview: false, createdAt: 1, updatedAt: 1,
  from: { key: 'norm:test artist||night drive', path: '/music/a.wav', duration: 90, title: 'Night Drive', artist: 'Test Artist' },
  to: { key: 'norm:other artist||morning run', path: '/music/b.wav', duration: 90, title: 'Morning Run', artist: 'Other Artist' },
}

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wav': 'audio/wav' }
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname
  const file = p.startsWith('/music/') ? join(music, p.slice(7)) : join(dist, p === '/' ? 'index.html' : p)
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
const base = `http://127.0.0.1:${server.address().port}`

// ── Scenarios: each returns a list of failed expectations ──────────────────
const SCENARIOS = {
  async normal(h) {
    await h.until(s => s.phase === 'running', 15000)
    const committed = await h.until(s => s.committed, 10000)
    const settled = await h.until(s => s.phase === 'idle' && s.track === 'Morning Run', 20000)
    await h.wait(1000)
    const after = await h.snap()
    return [
      h.expect(committed?.track === 'Morning Run', 'TO becomes current at the commit point'),
      h.expect(!!settled, 'handback settles'),
      h.expect(after.playing && after.t > settled?.t, 'TO keeps playing on the element'),
      h.expect((await h.debug()).handback?.converged, 'handback converged'),
    ]
  },
  async 'pause-pre'(h) {
    await h.until(s => s.phase === 'running', 15000)
    await h.wait(1500)
    await h.call('pause')
    await h.wait(1000)
    const paused = await h.snap()
    await h.wait(1000)
    const still = await h.snap()
    await h.call('play')
    await h.wait(1500)
    const resumed = await h.snap()
    return [
      h.expect(paused.track === 'Night Drive' && !paused.playing && paused.phase === 'idle', 'pausing before the commit backs out to FROM'),
      h.expect(still.t === paused.t, 'stays paused'),
      h.expect(resumed.playing && resumed.track === 'Night Drive' && resumed.t > paused.t, 'resumes FROM'),
    ]
  },
  async 'pause-post'(h) {
    await h.until(s => s.committed, 20000)
    await h.wait(800)
    await h.call('pause')
    await h.wait(1000)
    const paused = await h.snap()
    await h.call('play')
    await h.wait(1500)
    const resumed = await h.snap()
    return [
      h.expect(paused.track === 'Morning Run' && !paused.playing && paused.phase === 'idle', 'pausing after the commit parks TO, paused'),
      h.expect(resumed.playing && resumed.t > paused.t && resumed.t < paused.t + 3, 'resumes TO where it was'),
    ]
  },
  async 'next-early'(h) {
    await h.until(s => s.phase === 'running', 15000)
    await h.call('next')
    await h.wait(1500)
    const s = await h.snap()
    return [h.expect(s.track === 'Morning Run' && s.playing && s.t < 3 && s.phase === 'idle', '"next" before TO starts is a normal skip')]
  },
  async 'next-overlap'(h) {
    await h.until(s => s.phase === 'running' && s.t >= EXIT + 1.2, 20000)
    await h.call('next')
    const next = await h.snap()
    const settled = await h.until(s => s.phase === 'idle', 10000)
    return [
      h.expect(next.track === 'Morning Run' && next.t > 5, '"next" mid-overlap jumps to TO where it is'),
      h.expect(!!settled && settled.playing && settled.t > next.t, 'and hands back without restarting it'),
    ]
  },
  async 'seek-pre'(h) {
    await h.until(s => s.phase === 'running', 15000)
    await h.wait(1500)
    await h.call('seek', 40)
    await h.wait(1500)
    const s = await h.snap()
    return [h.expect(s.track === 'Night Drive' && s.playing && s.t > 40 && s.t < 43 && s.phase === 'ready', 'seeking FROM backs out and re-arms')]
  },
  async 'seek-post'(h) {
    await h.until(s => s.committed, 20000)
    await h.wait(500)
    await h.call('seek', 30)
    await h.wait(1500)
    const s = await h.snap()
    return [h.expect(s.track === 'Morning Run' && s.playing && s.t > 30 && s.t < 33, 'seeking after the commit seeks TO')]
  },
  async 'prev-post'(h) {
    await h.until(s => s.committed, 20000)
    await h.wait(500)
    await h.call('previous')
    await h.wait(1500)
    const s = await h.snap()
    return [h.expect(s.track === 'Morning Run' && s.playing && s.t < 3, '"previous" after the commit restarts TO')]
  },
}

const pwPath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(pwPath ? pathToFileURL(join(pwPath, 'index.mjs')).href : 'playwright')
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const mock = readFileSync(join(here, 'mock-api.js'), 'utf8')
const pairKey = `${transition.from.key}→${transition.to.key}`
let failures = 0

for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(SCENARIOS)) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.addInitScript({ content: `localStorage.setItem('mock-transitions', ${JSON.stringify(JSON.stringify({ [pairKey]: transition }))}); localStorage.setItem('aurora-dev', '1');\n${mock}` })
  await page.goto(`${base}/#/`)
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__, null, { timeout: 10000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const P = pinia._s.get('player')
    const lib = pinia._s.get('library')
    window.__flow = {
      P,
      snap: () => ({ t: +P.currentTime.toFixed(2), track: P.currentTrack?.title, playing: P.isPlaying, phase: P.transitionDebug().phase, committed: P.transitionDebug().committed }),
      start: () => P.auditionTransition(lib.tracks.find(t => t.id === 'ta'), lib.tracks.find(t => t.id === 'tb'), 66.007 - 8),
    }
  })
  await page.evaluate(() => window.__flow.start())
  const h = {
    wait: (ms) => page.waitForTimeout(ms),
    snap: () => page.evaluate(() => window.__flow.snap()),
    call: (fn, ...args) => page.evaluate(([f, a]) => window.__flow.P[f](...a), [fn, args]),
    debug: () => page.evaluate(() => window.__flow.P.transitionDebug()),
    until: async (pred, ms) => {
      const end = Date.now() + ms
      while (Date.now() < end) { const s = await h.snap(); if (pred(s)) return s; await page.waitForTimeout(200) }
      return null
    },
    expect: (ok, what) => (ok ? null : what),
  }
  const failed = (await SCENARIOS[name](h)).filter(Boolean)
  if (errors.length) failed.push(`page errors: ${errors.join(' | ')}`)
  await page.close()
  if (failed.length) failures++
  console.log(`${failed.length ? '✗' : '✓'} ${name}${failed.length ? '\n  - ' + failed.join('\n  - ') : ''}`)
}
await browser.close()
server.close()
process.exit(failures ? 1 : 0)
