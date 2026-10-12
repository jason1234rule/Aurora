# Handoff: hand-made transitions ("mixes") for Aurora

You're picking up a feature for **Aurora**, an Electron + Vue 3 local music player
(fork of https://github.com/Wilk087/Aurora). The owner, Jason, runs it on an Apple
Silicon Mac. This doc is self-contained: everything you need is here or in the repo.
When you're done, write `RETURN_NOTES.md` (spec at the bottom) and push your branch.
The work will be brought back to a local session that can actually listen to it.

---

## 1. What we're building

Instead of an automatic "AutoMix", the user **authors transitions by hand** between
specific pairs of songs, reviews them by ear, and saves them. During playback, when
the current song has a saved transition to the next one, Aurora plays that exact
transition. Each song gets 3–5 outgoing transitions, so the library becomes a graph
of hand-made moves; a **Mix mode** walks that graph for an endless mix.

Why hand-made: Apple's AutoMix and similar on-the-fly systems guess beat positions and
transition points live and often get them wrong. A transition authored once and
replayed deterministically can be as good as a DJ's prepared set.

### Prior art (checked 2026-10-12, nothing to fork)
- **Spotify Mix** (Aug 2025, Premium): per-playlist custom transitions with dual
  waveforms, presets (Fade/Rise/Blend), volume/EQ/effects. Closest concept, closed source,
  Spotify streams only. Good UX reference.
- **MixPerfect Player** (github.com/martmix/MixPerfect-Player): manual intro/break/loop
  markers + automatic beatmatching. Windows/Linux, markers are per-track, not per-pair.
- **MixCanvas / MyDJ** (github.com/A-M-D-R-3-W/MyDJ): timeline mix editor with
  beatgrid correction and transition automation. Windows, renders whole mixes.
- **waveform-playlist** (npm `waveform-playlist`): Web Audio multitrack editor with
  cue in/out, fades, time-shift. Possible reference for the editor; probably too heavy
  to embed.
- **pycrossfade**, **Mix50** (Python): beatmatch + tempo ramp + EQ transition logic.
  Reference only.
- **web-audio-beat-detector** (npm, MIT): BPM + first-beat offset from an AudioBuffer.
  Reasonable starting point for the beat-grid analysis.

---

## 2. The codebase: what you need to know

**Stack:** Electron 33, Vue 3 `<script setup lang="ts">`, Pinia *setup* stores, Vue Router,
Tailwind 3, Vite 6 (`vite-plugin-electron`). No test runner yet.

**Commands**
- `npm install`
- `npm run build`: Vite build of renderer + main + preload (must pass)
- `npx vue-tsc --noEmit -p tsconfig.json`: type-check (must pass with zero errors)
- Do **not** run `electron-builder` for mac; packaging happens locally on the Mac.

**Process split**
- `electron/main.ts` (~3.4k lines): all IPC handlers (`ipcMain.handle('area:action', …)`),
  file I/O, network. Persistent JSON lives under `dataPath` (library, playlists, stats…)
  and `cachePath` (covers, waveform-cache, artist-cache). See the `artistInfoCache` /
  `loadArtistCache` / `saveArtistCache` pattern near line ~320 for how disk caches are done.
- `electron/preload.ts`: exposes `window.api.*` via `ipcRenderer.invoke`.
- `src/env.d.ts`: global types (`Track`, `ArtistInfo`, …) and the `window.api` typings.
  Every new IPC method needs: handler in main.ts, entry in preload.ts, typing in env.d.ts.

**Playback: `src/stores/player.ts` (~1.7k lines). Read it fully before changing it.**
- Uses `HTMLAudioElement`s routed into a Web Audio graph:
  `source → mainFadeGain → compressor → gain → analyser → destination`.
- A second element `audioNext` + `nextFadeGain` exist for the **existing crossfade**:
  `startCrossfade()` (~line 996) starts `audioNext` when `timeLeft <= crossfadeDuration`,
  ramps the two gains; `finalizeCrossfade()` then *reloads the main element at
  `audioNext.currentTime`* and swaps back. That handoff is a known glitch point.
- `audioStream` is a third element NOT in the graph (CORS-less external streams).
  Transitions should only apply to **local files** in v1 (skip `subsonic://` and http(s) paths).
- Queue/shuffle/repeat: `queue`, `originalQueue`, `currentIndex`, `isShuffle`, `repeatMode`,
  `playAll()`, `toggleShuffle()`, `addToQueue()`, `playNext()`.
- Settings persist via `window.api.mergeSettings({...})`, loaded in a settings-apply function (~line 640).

**Useful existing pieces**
- `songKey(track)` in `src/utils/smartPlaylistMatcher.ts`: stable song identity
  (`mbid:` or normalized `artist||title`). Use it to key transitions so they survive file moves.
- Waveforms: `window.api.generateWaveform(path) → number[]` (200 bars, uses ffmpeg if
  present, else a crude fallback) + `src/components/WaveformBar.vue`. **200 bars is too
  coarse for an editor**: you'll need your own higher-resolution peaks (decode in the renderer
  with `decodeAudioData` and compute peaks at the zoom level).
- Local file URLs: `window.api.getMediaUrl(path)` (custom `localfile://` scheme, fetchable).
- Song context menu: `src/components/SongRow.vue` (`openContextMenu`), the place to add
  "Create transition to…".

**Style rules (match the codebase)**
- Tailwind's `white` and `black` are remapped to theme variables (`--app-text`,
  `--app-overlay`), so `text-white/50`, `bg-white/[0.06]` are theme-aware. Use them; don't
  hardcode colors except on top of photos/waveforms where contrast must be fixed.
- `accent` color = `bg-accent`, `text-accent`, `accent-glow` utility.
- Comments: sparse, explain *why*. Section headers in main.ts look like `// ── IPC: Thing ──`.

**Already-uncommitted/recent work on this branch (don't undo it):** artist page redesign
(`src/views/ArtistView.vue`), Deezer releases + kworb.net Spotify streams IPC
(`artist:get-releases`, `artist:get-streams` in main.ts), and `splitArtists` no longer
splitting on a bare `/` (so "HUNTR/X", "AC/DC" stay whole).

---

## 3. Design

### 3.1 Data model
Store in `dataPath/transitions.json` (user data, not cache). Keyed by ordered pair
`${songKey(from)}→${songKey(to)}`. Suggested shape (adjust if you find better):

```ts
interface Transition {
  id: string
  from: { key: string; path: string; duration: number }  // duration detects swapped files
  to:   { key: string; path: string; duration: number }
  type: 'blend' | 'cut' | 'echo-out'   // 'blend' = overlapped mix
  exitAt: number        // seconds into FROM where the transition begins
  entryAt: number       // seconds into TO that is heard at exitAt
  overlap: number       // seconds both play together (0 for 'cut')
  fadeOut: CurvePreset  // 'linear' | 'equal-power' | 's-curve'
  fadeIn: CurvePreset
  bassSwap?: { at: number }               // seconds into the overlap; low-shelf swap
  filter?: { target: 'from' | 'to'; kind: 'highpass' | 'lowpass'; startHz: number; endHz: number }
  rateTo?: number       // playbackRate for TO during overlap (±3% max in v1), ramps to 1 after
  needsReview: boolean  // set when either file's duration changes by > 0.5 s
  createdAt: number; updatedAt: number
}
```

### 3.2 Playback engine (the hard part, so do it first)
Beat alignment only needs **FROM and TO aligned to each other**, sample-accurately. Media
elements drift by tens of ms, which is enough to flam kicks. Recommended approach:

1. Before `exitAt`, decode the needed windows of both files (`fetch(getMediaUrl) →
   decodeAudioData`; decoding whole local files is fine, ~40 MB/4 min stereo).
2. A few hundred ms before `exitAt`, start an `AudioBufferSourceNode` of FROM's tail at the
   exact matching offset and do a ~30–50 ms gain swap from the FROM media element to that
   buffer (same audio content, so the swap is inaudible if offsets agree within a few ms).
3. Run the transition entirely on buffers, scheduled on `audioCtx.currentTime`: FROM tail +
   TO head, gain curves via `setValueCurveAtTime`, bass swap via two `BiquadFilterNode`
   low-shelves, filter sweeps via `frequency` automation, `rateTo` via `playbackRate`.
4. After the overlap, hand TO back to the normal media-element path: start the main element
   at the buffer's current position (integrate playbackRate if used) and do another short
   gain swap. Then update queue state exactly as a normal track change would (scrobble,
   stats, `currentIndex`, plugin bus events).
5. Must cancel cleanly to a normal track change on: skip, previous, seek, pause, queue edit,
   repeat-one, shuffle toggle, or decode failure. Never leave two sources playing.
6. If no transition exists for current→next, fall back to the existing crossfade (if enabled)
   or normal behavior. Don't break existing crossfade.

Keep the scheduling math in **pure functions** (e.g. `src/utils/transitions/schedule.ts`):
input transition + clock times → list of node start times/offsets/param automation events.
That's what you can unit test without audio hardware.

`AudioBufferSourceNode.playbackRate` changes pitch too. In v1 cap `rateTo` at ±3% (sounds
like a slight vinyl nudge). Pitch-preserving time-stretch (e.g. SoundTouch/Rubber Band
WASM) is a stretch goal, not v1.

### 3.3 Analysis (supports the editor; not required for playback)
Per-file BPM + beat grid (first-beat offset, beat period; downbeats if feasible), cached in
`cachePath/beatgrid-cache.json` keyed by path + mtime + size. Run off the UI thread if it's
slow. Used to snap editor handles to beats and to **suggest** a starting transition: exit at
a 16/32-beat phrase boundary near FROM's outro, entry on the first downbeat after TO's
intro, overlap = 8/16 beats. Suggestions must always be editable.

### 3.4 Editor UI
- Route `/transitions` lists all transitions (filter: needs review), plus edit/delete.
- Route/view to edit one pair. Entry points: song context menu "Create transition to…"
  (pick target song), and from the queue between two adjacent songs.
- Two stacked, zoomable waveforms (FROM on top, TO below) around the transition region,
  beat-grid ticks, drag TO horizontally to align, handles for exitAt / overlap, type
  selector, fade-curve presets, bass-swap toggle + position, filter sweep, rate nudge.
- Preview: "Play transition" (from `exitAt − 10 s` to `exitAt + overlap + 5 s`) through the
  **same engine** used in playback, a loop toggle, and solo FROM/TO. Save / Revert.

### 3.5 Mix mode
A toggle (player bar or queue panel). When on, the next track is chosen from saved
transitions out of the current song: prefer targets in the current playlist/queue context,
avoid anything played in the last N tracks, weighted random. If there's none, fall back to
the normal queue. Show in the queue which upcoming track is a "mixed" transition.

---

## 4. Plan: phases and acceptance criteria
Commit at the end of each phase; each phase must leave the app building and working.

**Phase 1: data + engine (priority)**
- Transitions store (Pinia) + IPC load/save of `transitions.json`.
- Engine integrated into `player.ts` per §3.2, with all cancel paths.
- A dev hook to create a transition without the editor, e.g. `window.__aurora.addTransition({...})`
  exposed in dev builds, so it can be tested by ear locally.
- Add `vitest` (dev dependency) and unit-test the pure scheduling math. Best test: two
  synthetic click tracks at 120 BPM with known offsets → assert the computed schedule puts
  FROM and TO clicks within 1 ms of each other through the overlap, including with `rateTo`.
  If `node-web-audio-api` (OfflineAudioContext in Node) installs cleanly, an offline render
  test that measures click alignment in the output is even better.

**Phase 2: analysis + editor** per §3.3 and §3.4.

**Phase 3: Mix mode** per §3.5.

**Stretch:** pitch-preserving tempo matching; "needs review" detection surfaced in the UI.

If you run low on budget, a fully working Phase 1 beats a half-done Phase 1–3.

---

## 5. Constraints
- You can't hear anything in the cloud. Don't claim audio quality; claim what tests prove.
- Don't refactor unrelated code. `player.ts` is large and fragile; change it surgically.
- Don't change existing dependency versions; adding small, well-maintained, permissively
  licensed deps is fine (note each in RETURN_NOTES). Project license is GPL-3.0.
- Local files only for transitions in v1.
- Keep `npm run build` and `vue-tsc` green at every commit.

---

## 6. When you finish: `RETURN_NOTES.md`
Create it at the repo root with:
1. **Status per phase:** done / partial / not started.
2. **Files changed** with one line each on what and why.
3. **How to test by ear locally:** exact steps, including how to create a test transition
   (dev hook or editor) and which situations to try (skip mid-transition, seek, pause,
   shuffle, repeat-one, a ±3% rate nudge).
4. **What's untested** and **known issues / risks**, honestly.
5. **Open design questions** for Jason.
6. Test results (vitest output summary, build + type-check status).
