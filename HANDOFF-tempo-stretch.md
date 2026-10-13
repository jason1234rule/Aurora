# Handoff: pitch-preserving tempo matching for transitions

Follow-up to `HANDOFF-transitions.md` and `RETURN_NOTES.md` (read both first; the
architecture, constraints and style rules there all still apply). Work on a new branch
`feature/tempo-stretch` created from `feature/hand-made-transitions`, commit per phase,
push it, and add a section to `RETURN_NOTES.md` (same format as before) when done.

## Why
Jason wants to recreate transitions he sees in Spotify's Mix editor, e.g. Megan Thee
Stallion "Cocky AF" (130 BPM) → Doja Cat "Tia Tamera" (120 BPM), an 8% gap. Today
`rateTo` is plain resampling via `AudioBufferSourceNode.playbackRate`, capped at ±3%
(`MAX_RATE_DEVIATION`), which also shifts pitch. Spotify time-stretches instead.

## What exists (since your last session)
- Commit `1777b61` added `fadeOut`/`fadeIn` presets `'none'` and `'custom'` with
  `fadeOutPoints`/`fadeInPoints` vertices, a beginner-friendly editor layout (Basics /
  Fades / collapsible Advanced) and vertex editing on the timeline. Don't regress these.
- After the overlap, TO's rate ramps back to 1 over `DEFAULT_RATE_RAMP` (2 s), so pitch
  audibly glides. With stretching, that glide must keep pitch constant.

## Goal
1. **Pitch-preserving stretch** for TO during the transition, up to **±10%** tempo
   (make the cap a constant; warn in the UI above ~6% that artifacts may be audible).
2. **Ramp back to native tempo after the overlap**, pitch unchanged, over a configurable
   length. Default **8 bars of TO** (fall back to 8 s if no grid). Store as e.g.
   `rampBack?: number` (seconds) on the Transition.
3. **Who adjusts** (stretch option on the transition, default `'to'`):
   `'to'` = TO matches FROM (current behaviour), `'meet'` = both move halfway (halves the
   stretch each song gets; FROM must then be stretched too during the overlap and the
   element→buffer swap-in must account for it), `'from'` optional if cheap.
   If `'meet'` makes the engine much riskier, ship `'to'` only and say so.
4. **Keep the old resampling mode** as an option (`pitch: 'keep' | 'vinyl'`). Missing
   field on existing transitions = `'vinyl'` so saved transitions sound unchanged; new
   transitions default to `'keep'`.

## Recommended approach
- Transitions are authored ahead and prepared ~30 s before `exitAt`, so **pre-render**:
  produce a stretched AudioBuffer of TO covering `entryAt` → end of the ramp-back (plus
  margin), following the exact tempo envelope, then play it at playbackRate 1. The existing
  envelope math (`positionAt` / `timeAtPosition` in `schedule.ts`) already maps ctx time ↔
  file position; reuse it so handback still lands on the right TO position.
- Run the stretcher in a **Worker** (WASM), never on the main thread. The editor preview must
  use the same render (debounce re-renders while dragging; cache by envelope params).
- Library options, all license-compatible with GPL-3.0-or-later (verify current versions):
  **Signalsmith Stretch** (MIT, high quality, has a JS/WASM build), **Rubber Band** WASM builds
  (GPL-2.0+, excellent quality, R3 engine), **SoundTouch** / `soundtouchjs` (LGPL, simpler
  WSOLA, more transient smearing). Evaluate quality on transient-heavy material (drums)
  and pick one; justify the choice in RETURN_NOTES.
- Stretchers have **latency / time offset**. Compensate exactly; beat alignment is the whole
  point. Measure, don't assume.
- Handback: the media element plays TO at native rate after the ramp, same convergence
  approach as today.

## Acceptance
- Unit/offline-render tests: synthetic click tracks at 120 and 130 BPM, TO stretched to match
  FROM: FROM and TO clicks align within **2 ms** through the overlap (looser than 1 ms because
  stretching smears transients; report the measured worst case), and TO is back on its own
  grid after the ramp. A sustained sine in TO keeps its frequency within ±0.5% throughout
  (proves pitch is preserved).
- Existing 84 tests keep passing; `vue-tsc` and `npm run build` stay green.
- Editor: speed slider and "Match tempo" work up to ±10% with a pitch mode toggle
  ("Keep pitch" / "Vinyl"), ramp-back length control in Advanced, plain-language help text
  matching the current editor style (song names, not FROM/TO).
- Render time and memory for a 30–60 s stretched window reported in RETURN_NOTES.

## Constraints
Same as before: can't hear audio in the cloud, local files only, surgical changes to
`player.ts`/`engine.ts`, note any new dependency with its license, don't touch the artist
page work, don't run electron-builder.
