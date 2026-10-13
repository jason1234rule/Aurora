# Return notes: hand-made transitions

Branch `feature/hand-made-transitions` (PR #1), on top of `artist-page-redesign`.
Nothing here has been listened to. Everything below is what tests and
headless-Chromium measurements prove, nothing more.

---

## 1. Status per phase

| Phase | Status |
|---|---|
| 1. Data + engine | **Done.** Store, IPC, engine in `player.ts` with all cancel paths, dev hook, vitest + offline-render tests. |
| 2. Analysis + editor | **Done.** Beat grids (worker + disk cache), suggestions, `/transitions` list, editor with preview. |
| 3. Mix mode | **Done.** Toggle in queue panel, Transitions page and Settings; queue shows which next songs are mixed. |
| Stretch: "needs review" in the UI | **Done.** Flagged on playback when a file's length changes; badge, filter and banner in the UI. |
| Stretch: pitch-preserving tempo | **Done later** on `feature/tempo-stretch`: see "Pitch-preserving tempo matching" at the end. |

Commits: phase 1 `07db307`, phase 2 `c39cbcc`, phase 3 `aeb44d5`, review fixes `5f2823d`.

---

## 2. How it works (short version)

1. ~30 s before `exitAt`, both songs are decoded (`decodeAudioData`). Only the
   needed windows are kept.
2. ~3 s before, the engine **records what the `<audio>` element is actually
   playing** (an AudioWorklet tap). It finds that snippet in the decoded FROM
   buffer by cross-correlation. That gives FROM's true position on the
   AudioContext clock, so nothing relies on `currentTime` (tens of ms of slop)
   or on decoders agreeing about encoder delay.
3. 1 s before `exitAt`, a 40 ms gain swap moves FROM from the element to its
   buffer. It's the same audio, so the swap should be silent. The element keeps
   playing FROM muted and in sync, so backing out is just the swap in reverse.
4. The transition runs entirely on buffers, scheduled on the AudioContext clock
   (fades, bass swap, filter sweep, echo, rate). `schedule.ts` holds the pure math.
5. At the overlap midpoint (at `exitAt` for cut/echo) TO becomes the current
   track: queue index, scrobble/stats reset, OS metadata, plugin `trackChange`.
6. Handback: once TO is alone at rate 1, the element loads TO (muted). It is
   measured against the TO buffer the same way and **re-seeked until it lines
   up within 1 ms** (the tolerance loosens to 3 ms after many tries). A 40 ms
   swap then returns TO to the normal element path.

Things learnt by measuring in Chromium (they shaped the design):
- `cancelAndHoldAtTime` is unreliable: about 5 ms of drift on `playbackRate`
  ramps and about a 3% step on gains. Every interruption therefore uses
  curve-free trim gains and explicit set + ramp, scheduled 50 ms ahead.
- A seek lands about ±8 ms off at random.
- `playbackRate` nudges move the element in whole 128-frame (~2.7 ms) jumps,
  so re-seeking is the dependable way to converge.

---

## 3. Files changed

**Electron / IPC**
- `electron/main.ts`:
  - `transitions.json` in the data dir: atomic, serialised writes; an unreadable file is renamed aside.
  - `transitions:get/save/delete` IPC.
  - `beatgrid-cache.json` in the cache dir, keyed by path and checked against mtime + size.
  - `beatgrid:get/set` IPC.
  - `cache:reset` accepts `'beatgrid'`.
- `electron/preload.ts`: exposes the five new `window.api` methods.
- `src/env.d.ts`: typings for them.

**Types, store, playback**
- `src/types/transition.ts`: `Transition`, `TransitionEndpoint`, `BeatGrid`, etc.
- `src/stores/transitions.ts`: Pinia store.
  - Lookup by `songKey` pair, outgoing / incoming lists.
  - `create`, `save`, `remove`, `setNeedsReview`.
- `src/stores/player.ts`: integration, all additive.
  - Element-event guards while the engine owns the element.
  - `transitionTick` arms the transition from `timeupdate`.
  - Commit and park logic; pause / seek / next / previous / queue-edit / shuffle / repeat-one / sleep-timer handling.
  - Editor preview and "test in player" helpers; Mix mode.
  - `announceTrack()` is moved out of `loadTrack` as-is so a committed transition can reuse it.
  - OS relative seeks now use `currentTime`.
- `src/utils/transitions/schedule.ts`: pure scheduling math.
  - Fade curves.
  - Exactly integrated piecewise-linear rate envelope.
  - Bass swap, filter and echo automation.
  - Plan-value evaluation.
- `src/utils/transitions/graph.ts`: builds the node graph. Shared by playback, preview and the offline tests.
- `src/utils/transitions/align.ts`: normalised cross-correlation, a coarse pass then a sample-accurate pass.
- `src/utils/transitions/engine.ts`: the live engine:
  - prepare / arm / commit / handback;
  - back out, finish early, stop / park;
  - editor preview;
  - the AudioWorklet tap.
- `src/utils/transitions/devHook.ts`: `window.__aurora` console helpers.

**Analysis + editor**
- `src/utils/transitions/beatgrid.ts`: tempo, grid, downbeat and confidence analyser, plus beat helpers. Written by a sub-agent, reviewed and tested.
- `src/utils/transitions/beatgrid.worker.ts`: runs the analyser in an inline worker (`?worker&inline`), so it also works from `file://`.
- `src/utils/transitions/analysis.ts`: cache first, otherwise analyse in the worker. Cache entries carry an analyser version.
- `src/utils/transitions/suggest.ts`: the starting suggestion:
  - exit on a 32/16-beat phrase boundary near FROM's end;
  - enter on TO's first downbeat;
  - 8/16-beat overlap;
  - tempo match within ±3%.
- `src/utils/transitions/peaks.ts`: min/max peak pyramid, for fast zoomable waveforms.
- `src/utils/transitions/timeline.ts`: editor coordinate math, reusing the playback schedule.
- `src/components/transitions/TransitionTimeline.vue`: canvas timeline:
  - two lanes, beat ticks, fade curves;
  - drag handles, snap to beats, zoom and pan, playhead.
- `src/components/transitions/TrackPickerDialog.vue`: "Create transition to…" song search.
- `src/views/TransitionEditorView.vue`: the editor.
- `src/views/TransitionsView.vue`: the list, with a needs-review filter, play and delete.
- `src/router/index.ts`: `/transitions` and `/transition/edit`.
- `src/App.vue`: loads the store, installs the dev hook, keeps the editor out of keep-alive (it holds two decoded songs).
- `src/components/Sidebar.vue`: "Transitions" entry.
- `src/components/SongRow.vue`: "Create Transition To…" in the context menu.
- `src/components/QueuePanel.vue`: ⇄ button between consecutive songs (accent = a transition exists), and the Mix toggle.
- `src/views/SettingsView.vue`: "Hand-made transitions" and "Mix mode" toggles.
- `src/utils/transitions/mix.ts`: Mix-mode picker (pure).

**Tests / tooling**
- `vitest.config.ts`, `tsconfig.node.json`, `package.json`: vitest setup and an `npm test` script.
- `tests/transitions/*.test.ts`: 79 tests. Covers schedule math, alignment, offline renders, beat analysis, suggester, peaks/timeline and the Mix picker.
- `tests/browser/run.mjs` + `harness.ts`: the real engine in Chromium with click tracks, measuring alignment in the recorded output.
- `tests/browser/player-flow.mjs` + `mock-api.js`: the real player store (built `dist/`, mocked preload) through a transition and its cancel paths.

**New dev dependencies** (dev only, permissively licensed):
- `vitest@^3.2.7` (MIT)
- `node-web-audio-api@^2.2.0` (BSD-3-Clause, prebuilt binaries incl. darwin-arm64, needs Node ≥ 22). The render tests skip themselves if it can't load.

⚠️ **`flake.nix` `npmDepsHash` is now stale** because of the new dev deps. Regenerate it on a machine with Nix.

---

## 4. How to test by ear (on the Mac)

```bash
git checkout feature/hand-made-transitions
npm install
npm test          # 79 tests, ~5 s
npm run dev       # or build/package as usual
```

### A. With the editor (recommended)
1. Right-click a song, then **Create Transition To…**, then pick the next song.
2. Wait for "Finding beats…". A new transition gets a suggestion automatically: exit, entry, 16-beat overlap, tempo match, bass swap.
3. Press **Space** (or ▶ Play transition) to preview. Use **Loop**, and **FROM** / **TO** solo to check alignment.
4. Align by ear:
   - drag the purple lane, or use **←/→** (10 ms, **Alt**: 1 ms);
   - drag the solid line to move the exit;
   - drag the dashed line to change the overlap;
   - drag the diamond to move the bass swap;
   - hold **Alt** while dragging to ignore beat snapping.
5. **Save**, then **Test in the player**. That plays FROM from 12 s before the exit with TO queued next, through the real playback engine.

### B. With the dev hook (no editor)
Dev builds have it. In a packaged build, run `localStorage.setItem('aurora-dev','1')` and reload. Then, with song A playing and song B next in the queue:
```js
await __aurora.addTransition({ exitAt: 182.5, entryAt: 12.3, overlap: 16, rateTo: 0.985, bassSwap: { at: 8 } })
__aurora.jumpToTransition(10)   // seek to 10 s before the exit
__aurora.transitionState()      // phase, arm method/score, handback convergence
```
Other options: `type: 'cut' | 'echo-out'`, `filter: { target: 'to', kind: 'lowpass', startHz: 300, endHz: 20000 }`, `echo: { delay: 0.48, feedback: 0.5 }`, `to: 'Artist - Title'`.

### What to listen for
- **Swap-in at `exitAt − 1 s`.** FROM moves from the element to the buffer. It should be completely inaudible.
- **The overlap.** Kicks should not flam. Try a ±3% rate nudge: TO's pitch shifts slightly, and the beats should stay locked.
- **Handback.** Shortly after the overlap ends (+2 s if the rate was nudged, then up to a few seconds while the element is re-seeked silently). Listen for a click, phasing or a tiny stutter. Afterwards, `__aurora.transitionState().handback` should say `converged: true` with a `finalDeltaMs` under 1–3.
- **`arm.method`** should be `measured`. `estimated` means the tap failed or the output was muted or at volume 0 at that moment.

### Situations to try
- **Skip** at three points:
  - before `exitAt` (normal skip to TO from the start);
  - during the overlap (jumps to TO where it is, seamlessly);
  - after the midpoint (skips TO).
- **Previous** before and after the midpoint. Before: FROM restarts. After: TO restarts, or within 3 s you go back to FROM.
- **Seek** within FROM before the midpoint (backs out; re-arms if you seek back before the exit) and after it (seeks TO).
- **Pause / resume** before the midpoint (backs out to FROM) and after it (TO parked where it was).
- **Shuffle on/off** and **repeat-one** mid-transition (repeat-one backs out to FROM).
- **Remove TO from the queue** mid-transition, and **Play Next** another song mid-transition.
- **Volume / mute** changes during the overlap.
- **Normalization on** (compressor chain) and off.
- **Mix mode** with a few songs that have 2–3 outgoing transitions each, started from a playlist.
- **Needs review:** re-encode or trim a file so its length changes. The transition then skips during playback and shows "Needs review" until re-saved.
- **Leave the app minimised** through a transition.
- **MP3 and AAC files**, not just FLAC/WAV.

---

## 5. What's untested, known issues, risks

**Never tested**
- Not heard by anyone.
- Not run in Electron, not on macOS / CoreAudio.
- Every browser test ran in headless Playwright Chromium on Linux (fake audio sink) or in node-web-audio-api.
- Only synthetic material: click tracks and generated house loops. No real recordings, no MP3/AAC. Encoder-delay differences between the element and `decodeAudioData` are measured rather than assumed, so they *should* be handled.

**Accuracy edge cases**
- **Muted or volume 0 when the transition arms:** alignment falls back to an estimate from `currentTime`. FROM and TO stay perfectly aligned with each other, but the element↔buffer swaps could be off by tens of ms (audible only if you unmute right then).
- **Handback that doesn't converge before its deadline** (~15 s of TO kept decoded): it swaps anyway, which could give a jump of a few ms. It never failed to converge in testing (1–5 seeks).

**Memory, CPU, timing**
- **Memory:**
  - Preparing briefly holds two full decodes (~85 MB each for 4 min of float32 stereo), then keeps only windows.
  - The editor holds both decoded songs while it's open (more for long tracks). It's excluded from keep-alive, so leaving frees them.
- **CPU:** each alignment measurement is ~10–30 ms of correlation on the main thread (UI only; audio is unaffected).
- **Timers:** commit and handback are `setTimeout`s. Chromium exempts audible pages from background throttling. Not verified while minimised in Electron.
- **Exclusive mode** (`latencyHint: 'playback'`, currently disabled in `main.ts`) might need a larger lookahead than 50 ms.

**Behaviour you might not expect**
- **Shuffle toggled during an audible transition:** TO is moved to right after FROM in the new order.
- **Same `songKey`, different file** (e.g. album vs live version with identical artist + title): the transition is skipped if lengths differ. It's only flagged for review if it's the *same* file, or the original file is gone.
- **Mix mode grows the queue:** picks are inserted, and the rest of the playlist is pushed later.
- **Beat analysis** assumes one tempo per track:
  - live or drifting tempo gets low confidence, so you get the no-grid suggestion;
  - 170+ BPM can read as half tempo;
  - downbeat is a best guess from low-frequency accents.
- **Editor:** no undo.

**Test-only**
- node-web-audio-api holds a slightly wrong value (~0.997) in the gap before a `setValueCurveAtTime`. The offline swap test uses a cut to avoid it; Chromium doesn't do this.

---

## 6. Open design questions for Jason

1. **When should "now playing" switch to TO?** Currently at the overlap midpoint (at the exit for cut / echo-out). Alternatives: at `exitAt`, or when FROM is fully gone.
2. **Skip during the overlap.** It currently jumps to TO where it is. Restart TO from 0 instead?
3. **Same song, different file** (album vs live, same artist + title). Currently skipped if lengths differ. Play it anyway, or key transitions by file instead of song?
4. **Mix mode tuning.**
   - Currently: context ×4, never repeat the last 8 tracks.
   - Also avoid the same artist twice in a row?
   - Remove Mix picks from the queue when Mix mode is turned off?
5. **Backups and sync.** Should `transitions.json` be part of Export/Import backups and the sync folder? It isn't yet.
6. ~~**Pitch-preserving tempo matching**~~: done, see the section at the end.
7. **Suggester phrase rule.** With beats counted from FROM's first downbeat, "fall back to 16 if no 32-beat boundary fits" could never trigger. It now triggers when the only 32-beat boundary that fits is the very first downbeat. Keep it?
8. **Editor gestures:** wheel zooms, horizontal wheel or shift-wheel pans, drag the top lane to scroll. Does that feel right on the trackpad?

---

## 7. Test results

| Check | Result |
|---|---|
| `npx vitest run` | **79 / 79 passed**, 6 files, ~5 s |
| `npx vue-tsc --noEmit -p tsconfig.json` | 0 errors |
| `npm run build` | passes (renderer, main, preload) |
| `node tests/browser/run.mjs` | **7 / 7** (see below) |
| `node tests/browser/player-flow.mjs` | **8 / 8**: normal, pause before / after commit, next before TO starts, next mid-overlap, seek before / after commit, previous after commit |
| `electron-builder` / running Electron | not run (per handoff) |

**Unit and offline-render tests (vitest)**
- Synthetic click tracks at 120 BPM, plus 117/123 BPM with `rateTo`: FROM and TO clicks land **within 1 ms through the whole overlap**.
- After the rate ramp, TO is back on its own grid within 1 ms.
- The element→buffer swap is sample-identical.
- Beat analyser: BPM exact and every beat within 0.5 ms on clicks, over a 3-minute drift check; 5 min of audio analysed in ~0.2 s.

**Browser engine suite (`run.mjs`)**
- Covers 48 / 44.1 kHz, cut, echo-out, skip mid-overlap at both sample rates, and backing out.
- Measured from the recorded output against the schedule:
  - FROM before / after the swap-in: worst **0.51 ms**;
  - TO during the overlap: worst **0.52 ms**;
  - TO after handback: worst **0.22 ms**.
- About 0.5 ms of that is peak-picking bias, the same on all segments.
- Requires Playwright with Chromium; use the `PLAYWRIGHT_MODULE` env var if it isn't resolvable.

---
---

# Return notes: pitch-preserving tempo matching

Branch `feature/tempo-stretch`, on top of `feature/hand-made-transitions`. Follows
`HANDOFF-tempo-stretch.md`. Still not listened to by anyone: everything below comes from
tests and headless-Chromium measurements.

---

## 1. Status per goal

| Goal | Status |
|---|---|
| 1. Keep pitch, up to ±10% | **Done.** Signalsmith Stretch (MIT) in a Web Worker. Cap: `MAX_RATE_DEVIATION` = 0.10. The editor warns above 6% per song (`STRETCH_WARN_DEVIATION`). |
| 2. Ease back to the song's own tempo, pitch unchanged | **Done.** `rampBack` (seconds). New transitions: 8 bars of TO, or 8 s without a beat grid. Missing (older transitions) = 2 s, as before. |
| 3. Who adjusts | **Done, all three.** `stretch`: `'to'` (default), `'meet'`, `'from'`. When FROM changes speed it eases in over `rampBack` (max 16 s) *before* the exit. |
| 4. Resampling still available | **Done.** `pitch: 'keep' \| 'vinyl'`. Missing = `'vinyl'`, so saved transitions sound exactly as before. New ones default to `'keep'`. |

Commits: phase 1 `d84ff44` (renderer + schedule), phase 2 `d628afd` (engine + player),
phase 3 `771a31b` (editor), then these notes.

---

## 2. How it works (short version)

1. **Data.** `rateTo` / `rateFrom` are each song's speed during the overlap. `stretch` only
   remembers the editor choice: the engine just plays the two rates. The editor's slider
   sets how much faster TO is than FROM, and `splitRates()` shares that out
   (`'meet'` = square root each way).
2. **Tempo envelopes.** TO: `rateTo` through the overlap, then a straight ramp to 1 over
   `rampBack`. FROM: a ramp from 1 to `rateFrom` before the exit, then held.
   `positionAt` / `timeAtPosition` now integrate in both directions, because FROM's
   ramp is before `t0`.
3. **Pre-rendering ('keep').** `prepare` renders only the parts that change speed:
   TO from `t0` to the end of the handback budget, and FROM from its buffer start to its
   stop. This runs in a worker, never on the UI thread.
4. **Exact envelope following.** The stretcher is fed block by block (128 frames).
   Before each block, the input head is moved to where the envelope says the song should
   be one output-latency later, plus the input latency. The target comes from the
   envelope every block, so rounding never adds up into drift.
5. **Latency is measured, not assumed.** The library reports 60 ms in and 60 ms out
   (44.1 / 48 kHz). The click tests confirm the output lands within ±0.5 ms.
6. **Nothing else changes.** Stretched buffers play at rate 1 from their first sample.
   Positions, measuring, commit and handback all work as before.
7. **Swaps with the element are equal-power.** Stretched audio lines up with the
   original in time, but not sample for sample: the phase differs. A plain linear 40 ms
   swap measured a ~2 dB dip. So wherever a stretched buffer meets the `<audio>` element,
   the swap is equal-power: FROM's swap-in for 'meet' / 'from', and the handback. It is
   built from linear segments, so it stays safe to cancel.
8. **Arming with a FROM ramp.**
   - `t0` is solved from the element measurement against FROM's envelope.
   - The lead-in grows by the ramp length.
   - Preparing starts at least 12 s before arming (`prepWindowFor`).
9. **Editor preview uses the same code.** `previewStretchPlan()`, then `renderPlan()` in
   the worker, then `preview({ stretched })`. Rendering starts 400 ms after the settings
   stop changing and is cached by what it depends on (last 4 renders).

**Library choice.** Compared on synthetic drum loops and a sustained chord, at
0.923–1.10 and on a ramp:

| | Beat timing vs envelope (worst) | Speed (30 s mono) | Licence | Notes |
|---|---|---|---|---|
| **Signalsmith Stretch 1.3.2** | **0.2 ms** | 0.5 s | MIT | **Chosen.** Sets the input position explicitly and reports its latency. 114 KB with the WASM inlined. |
| Rubber Band R3 (`rubberband-wasm` 3.3.0) | 3.3 ms, drifts on ramps | 3.8 s | GPLv2 only as published: not compatible with Aurora's GPL-3.0-or-later | ~3 dB less pre-echo when slowing down. A phase glitch every ~2.4 s above rate 1. |
| SoundTouch (`soundtouchjs` 0.3.0) | 21 ms | 0.1 s | LGPL-2.1+ | Crispest drums, but chords wobble by up to 28 cents, even at rate 1. |

- Signalsmith's cost is transient smearing. At 0.923, kick pre-echo is −28 dB and snare
  −29 dB (source: −41 / −37 dB). Kick attack goes from 3.5 to 6.3 ms.
- The comparison scripts and WAVs are in this session's scratchpad (`stretch-eval/`),
  not in the repo.

---

## 3. Files changed

**New**
- `src/utils/transitions/stretch/core.ts`: the stretch driver (`renderStretch`).
- `src/utils/transitions/stretch/signalsmithShim.ts`: stand-ins that let the
  library's AudioWorklet build run offline. It uses library internals, so the version is
  pinned exactly.
- `src/utils/transitions/stretch/plan.ts`: works out what to stretch from a schedule;
  `renderPlan`, `planKey`.
- `src/utils/transitions/stretch/stretch.worker.ts` and `client.ts`: the worker
  (`?worker&inline`, so it also works from `file://`) and its main-thread side.
- `tests/transitions/stretch.test.ts`.

**Changed**
- `src/types/transition.ts`: optional `rateFrom`, `pitch`, `stretch`, `rampBack`.
- `schedule.ts`:
  - ±10% cap;
  - envelopes for both songs, with backward integration;
  - `prerendered` option;
  - helpers `fromRampIn`, `equalPowerEvents`, `splitRates`, `rateRatio`.
- `graph.ts`: FROM's playbackRate envelope (one line).
- `engine.ts`:
  - stretching in `prepare`;
  - arming with a FROM ramp;
  - backing out after FROM has changed speed (re-seeks the element);
  - skip-ahead with a stretched TO;
  - equal-power swaps;
  - `stretched` preview option, `prepWindowFor`, `debug.stretch`.
- `player.ts` (two lines): the prepare window is per transition, and the progress bar
  shows FROM's heard position during a transition.
- `timeline.ts`, `TransitionTimeline.vue`: follow FROM when it changes speed.
- `TransitionEditorView.vue`: Tempo card and stretched preview. The Basics / Fades /
  Advanced layout and custom fades from `1777b61` are unchanged.
- `stores/transitions.ts`: defaults for new transitions.
- `devHook.ts`: the new fields, plus `__aurora.stretchTimings()`.
- Tests:
  - `schedule` and `beatgrid` now use ±10%;
  - new `editor` cases;
  - browser `run.mjs` / `harness.ts`: 7 new scenarios, an esbuild plugin for inline
    workers, and a peak picker that ignores pre-ringing;
  - `player-flow.mjs`: `TX_VARIANT=keep|meet`.
- `package.json`: **new dependency `signalsmith-stretch` 1.3.2, MIT, no dependencies of
  its own.** The main chunk grows from 308 KB to 416 KB (100 → 147 KB gzipped): the WASM is inlined
  in the worker.

---

## 4. How to test by ear (on the Mac)

**A. In the editor**
1. Open a transition between songs 5–10% apart, e.g. "Cocky AF" (130) → "Tia Tamera" (120).
2. Advanced → Tempo → **Match tempo**.
3. Play it with **Keep pitch**, then with **Vinyl**.
4. Switch "Who adjusts" to **Meet in the middle** and play it again.
5. Change "Ease back" (2 / 4 / 8 / 16 bars) and listen to the end of the preview.
   "Preparing…" shows while the stretch renders, usually about 1–2 s.

**B. In the real player:** save, then **Test in the player**.

**C. With the dev hook**
- `__aurora.addTransition({ pitch: 'keep', rateTo: 0.94, rampBack: 8 })`
- `__aurora.transitionState().stretch`: which sides were stretched, and how long it took.
- `__aurora.stretchTimings()`

**What to listen for**
- With Keep pitch, the incoming song stays in its key. With Vinyl it goes slightly flat
  or sharp.
- Smearing or "phasiness" on drums and vocals during the blend. Expect more at 6–10%.
- Meet / outgoing-adjusts: about 1 s before the outgoing song starts easing, it swaps to
  its stretched copy. That swap should be inaudible.
- The handback after the ease-back (a 40 ms equal-power swap): listen for a tiny flam
  or a phase blip.
- The ease-back should feel like a gentle drift, not a step.
- Transitions saved before this branch should sound exactly as before (Vinyl, 2 s).

---

## 5. What's untested, known issues, risks

**Never tested**
- Not heard. Not run in Electron or on macOS.
- Synthetic material only: click tracks, sines, generated house loops.
- Signalsmith's quality on real music is unknown.

**Behaviour you might not expect**
- **Backing out after FROM has started changing speed** (pause, seek, queue change):
  - the element is re-seeked to where FROM is heard, with a 120 ms crossfade;
  - not sample-exact (seeks land ±8 ms);
  - FROM jumps back to its own tempo.
- **"Next" during the overlap with Keep pitch.** TO is pre-rendered, so it can't change
  course: it eases back as planned. The handback happens at the normal time, up to
  overlap + ease-back later. With Vinyl it still ramps back in 0.5 s.
- **FROM's ease-in** is capped at 16 s. It is shortened when the exit is within the
  first ~20 s of a song.
- **Preparing takes longer:** decode plus 1–2.5 s of stretching. Seek to just before a
  transition and it may not be ready; it's then skipped for that play-through (as before).

**Memory, CPU**
- The stretched copies are kept alongside the decoded windows while a transition is
  prepared:
  - TO's covers about overlap + ease-back + 15 s;
  - FROM's covers about lead-in + overlap.
- Stereo float32: 30 s = 11 MB, 60 s = 23 MB (numbers in §7).
- The source slice is copied once and moved to the worker, so the peak is about twice
  the output size.
- The worker runs one job at a time. The UI thread does no stretching.

**Fragile spots**
- `signalsmithShim.ts` depends on how signalsmith-stretch 1.3.2 registers its
  AudioWorklet processor. The version is pinned exactly; re-run the tests after any bump.
- Handback seek loop: in about 1 run in 20 it needed 6+ seeks, and the tolerance
  loosened to ~2 ms. Seen with both Vinyl and Keep pitch, so not new.
- `flake.nix` `npmDepsHash` is stale (new dependency). Regenerate it on a Nix machine.

---

## 6. Open design questions for Jason

1. **Default pitch for new transitions** is Keep pitch. OK, or start on Vinyl?
2. **Who adjusts** defaults to the incoming song. Should Match tempo switch to Meet in
   the middle automatically when a song would move more than 6%?
3. **Ease back** also sets how long the outgoing song takes to ease *in* (Meet /
   outgoing). One control, or two?
4. **Skip during the overlap with Keep pitch.** It currently eases back as planned.
   Alternative: switch to a quick Vinyl glide back (pitch moves briefly).
5. **Stretch quality setting.** The comparison found a larger Signalsmith block
   (160–200 ms, 40 ms interval) cut noise between chord partials from −48 dB to
   −64…−78 dB, at ~1.5× CPU. Worth an A/B by ear?
6. **Warning threshold:** 6% per song. Right?

---

## 7. Test results

| Check | Result |
|---|---|
| `npx vitest run` | **104 / 104 passed**, 7 files |
| `npx vue-tsc --noEmit -p tsconfig.json` | 0 errors |
| `npm run build` | passes (renderer, main, preload) |
| `node tests/browser/run.mjs` | **14 / 14** (7 old + 7 stretch scenarios) |
| `node tests/browser/player-flow.mjs` | **8 / 8** in each of Vinyl, `TX_VARIANT=keep`, `TX_VARIANT=meet` |
| `electron-builder` / running Electron | not run (per handoff) |

**Acceptance (offline render through the real graph, vitest)**
- **130 → 120 BPM click tracks, TO stretched, pitch kept:**
  - FROM and TO clicks within **0.52 ms** through the overlap (limit 2 ms);
  - TO on its own grid through and after the 8-bar ease-back: worst **0.51 ms**;
  - beats exactly one TO beat apart once settled.
- **Meet in the middle:** clicks within **0.70 ms** through the overlap. FROM through its
  ease-in: worst **0.33 ms**.
- **440 Hz sine in TO** through the overlap and ease-back: worst deviation
  **0.034%** (limit ±0.5%).
- **Renderer alone** (±10%, constant and ramped): every click within 1 ms; measured
  −0.5…+0.2 ms.
- **Vinyl still resamples:** the tone drops to 0.95× and returns to 1.00×.

**Browser (Chromium, real `<audio>` element, real worker)**
- Stretched TO during the overlap: worst **0.59–0.75 ms**.
- Stretched FROM (Meet): worst **0.52–0.73 ms**.
- After the equal-power handback: worst **0.10–0.33 ms**.
- Back-out after FROM changed speed: FROM steady on its own grid (0.67 ms), TO silent.
- In-app prepare, decode plus stretch of both songs (Meet): **1.6–2.0 s**.
- The built app was checked to stretch in the worker (`debug.stretch`).
- An editor smoke test (scratchpad script) passed: Meet + Keep pitch preview (~1 s per
  song), Vinyl preview instant, fields saved, no console errors.

**Render time and memory (Signalsmith, stereo, Node, single thread)**

| Window | 44.1 kHz | 48 kHz | Output size |
|---|---|---|---|
| 30 s | 1.21 s (25× real time) | 1.29 s (23×) | 10.6 / 11.5 MB |
| 60 s | 2.35 s (26×) | 2.67 s (23×) | 21.2 / 23.0 MB |

- WASM heap per stretcher: 1.2 MB.
- The source slice sent to the worker is about the size of the output and is freed after
  rendering.

