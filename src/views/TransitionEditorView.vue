<template>
  <div class="p-6 pb-10 max-w-[1400px]">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4 mb-5">
      <div class="min-w-0">
        <button
          @click="router.push('/transitions')"
          class="text-xs text-white/40 hover:text-white/70 transition-colors mb-2 flex items-center gap-1"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Transitions
        </button>
        <h1 class="text-2xl font-bold text-white truncate">
          {{ existing ? 'Edit transition' : 'New transition' }}
        </h1>
        <p v-if="fromTrack && toTrack" class="text-sm text-white/50 mt-1 truncate">
          <span class="text-white/80">{{ fromTrack.title }}</span>
          <span class="text-white/30"> · {{ fromTrack.artist }}</span>
          <span class="text-accent mx-2">→</span>
          <span class="text-white/80">{{ toTrack.title }}</span>
          <span class="text-white/30"> · {{ toTrack.artist }}</span>
        </p>
      </div>
      <div v-if="status === 'ready'" class="flex items-center gap-2 shrink-0">
        <button
          v-if="existing"
          @click="showDelete = true"
          class="px-3 py-2 rounded-lg text-sm text-white/40 hover:text-red-400 hover:bg-white/[0.06] transition-colors"
        >
          Delete
        </button>
        <button
          :disabled="!dirty"
          @click="revert"
          class="px-3 py-2 rounded-lg text-sm transition-colors"
          :class="dirty ? 'text-white/70 hover:text-white hover:bg-white/[0.06]' : 'text-white/20 cursor-default'"
        >
          Revert
        </button>
        <button
          @click="save"
          :disabled="saving"
          class="px-5 py-2 rounded-full text-sm font-medium transition-colors"
          :class="dirty || !existing ? 'bg-accent hover:bg-accent-hover text-white' : 'bg-white/[0.08] text-white/50'"
        >
          {{ existing ? (dirty ? 'Save changes' : 'Saved') : 'Save' }}
        </button>
      </div>
    </div>

    <!-- Needs review banner -->
    <div
      v-if="status === 'ready' && (existing?.needsReview || durationsChanged)"
      class="mb-4 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200/90"
    >
      One of these files has changed length since this transition was made, so it won't play until you
      check the alignment and save it again.
    </div>

    <!-- Loading / error -->
    <div v-if="status === 'loading'" class="flex items-center gap-3 text-sm text-white/40 py-16 justify-center">
      <div class="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      Decoding both songs…
    </div>
    <div v-else-if="status === 'error'" class="py-12 text-center">
      <p class="text-sm text-white/60">{{ errorMessage }}</p>
      <button
        v-if="existing"
        @click="showDelete = true"
        class="mt-4 px-4 py-2 rounded-lg text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
      >
        Delete this transition
      </button>
    </div>

    <template v-else-if="status === 'ready' && draft && fromTrack && toTrack">
      <!-- Transport + timeline tools -->
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <button
          @click="previewing ? pausePreview() : startPreview()"
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          :class="previewing ? 'bg-white/[0.12] text-white' : 'bg-accent hover:bg-accent-hover text-white'"
          :title="previewing ? 'Pause where it is (Space)' : 'Play from the start (Space resumes a paused preview)'"
        >
          <svg v-if="!previewing" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          {{ preparingPreview ? 'Preparing…' : previewing ? 'Pause' : 'Play transition' }}
        </button>
        <select v-model.number="preRoll" class="tx-select" title="How much of the first song to hear before the blend">
          <option :value="5">start 5 s before</option>
          <option :value="10">start 10 s before</option>
          <option :value="20">start 20 s before</option>
        </select>
        <label class="tx-chip" :class="loop ? 'tx-chip-on' : ''">
          <input type="checkbox" v-model="loop" class="hidden" /> Loop
        </label>
        <select v-model.number="speed" class="tx-select" title="How fast this preview plays, keeping the pitch. Only for listening: the transition itself doesn't change.">
          <option v-for="o in speedOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div class="flex rounded-lg overflow-hidden border border-white/[0.08]">
          <button
            v-for="opt in soloOptions"
            :key="opt.value"
            @click="setSolo(opt.value)"
            class="px-3 py-1.5 text-xs transition-colors"
            :class="solo === opt.value ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'"
          >{{ opt.label }}</button>
        </div>

        <div class="flex-1" />

        <span v-if="analysing" class="text-xs text-white/30 flex items-center gap-2">
          <span class="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" />
          Finding beats…
        </span>
        <span v-else-if="stretchState === 'pending'" class="text-xs text-white/30 flex items-center gap-2"
          title="Keeping the pitch while the speed changes takes a moment to prepare">
          <span class="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" />
          Preparing the speed change…
        </span>
        <label class="tx-chip" :class="snap ? 'tx-chip-solid' : ''" title="When on, dragged lines and points jump to the nearest beat (hold Alt / Option to drag freely)">
          <input type="checkbox" v-model="snap" class="hidden" /> Snap to beats
        </label>
        <button class="tx-icon-btn" title="Zoom out" @click="timelineRef?.zoom(1.5)">−</button>
        <button class="tx-icon-btn" title="Zoom in" @click="timelineRef?.zoom(1 / 1.5)">+</button>
        <button class="tx-chip" title="Fit the transition (double-click the timeline)" @click="timelineRef?.fit()">Fit</button>
      </div>

      <TransitionTimeline
        ref="timelineRef"
        :timing="timing"
        :from-peaks="fromPeaks"
        :to-peaks="toPeaks"
        :from-duration="fromDuration"
        :to-duration="toDuration"
        :from-grid="fromGrid"
        :to-grid="toGrid"
        :from-label="fromTrack.title"
        :to-label="toTrack.title"
        :snap="snap"
        :playhead="playhead"
        @update="update"
        @seek="seekPreview"
      />
      <p class="text-[11px] text-white/30 mt-2">
        Drag the lower waveform to line up the beats · drag the solid line to move where the blend starts and the dashed line to
        change its length · double-click a fade line to add a point · click the time ruler or drag the white line to jump ·
        scroll to zoom · Space plays / pauses
      </p>

      <!-- Basics + fades -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
        <section class="tx-card">
          <h2 class="tx-card-title">The basics</h2>

          <div class="flex rounded-lg overflow-hidden border border-white/[0.08] mb-1.5">
            <button
              v-for="opt in typeOptions"
              :key="opt.value"
              @click="update({ type: opt.value })"
              class="flex-1 px-3 py-2 text-sm transition-colors"
              :class="draft.type === opt.value ? 'bg-accent/20 text-accent' : 'text-white/50 hover:text-white/80'"
            >{{ opt.label }}</button>
          </div>
          <p class="tx-help mb-4">{{ typeHelp }}</p>

          <div class="tx-row">
            <span class="tx-label-wide">Leave <b class="tx-song">{{ fromName }}</b> at</span>
            <span class="text-sm text-white/80 tabular-nums w-20">{{ formatTimePrecise(draft.exitAt) }}</span>
            <button class="tx-chip" :title="barTitle" @click="shiftExit(-1)">−{{ barLabel }}</button>
            <button class="tx-chip" :title="barTitle" @click="shiftExit(1)">+{{ barLabel }}</button>
          </div>
          <p class="tx-help tx-indent">When the first song starts to leave. Or drag the solid line.</p>

          <div class="tx-row">
            <span class="tx-label-wide">Bring in <b class="tx-song">{{ toName }}</b> from</span>
            <span class="text-sm text-white/80 tabular-nums w-20">{{ formatTimePrecise(draft.entryAt) }}</span>
            <button class="tx-chip" :title="barTitle" @click="shiftEntry(-1)">−{{ barLabel }}</button>
            <button class="tx-chip" :title="barTitle" @click="shiftEntry(1)">+{{ barLabel }}</button>
          </div>
          <p class="tx-help tx-indent">The part of the second song you hear first. Or drag the lower waveform.</p>

          <template v-if="draft.type !== 'cut'">
            <div class="tx-row">
              <span class="tx-label-wide">{{ draft.type === 'echo-out' ? 'Echo tail length' : 'Blend length' }}</span>
              <template v-if="fromBeat">
                <button
                  v-for="b in [4, 8, 16, 32]"
                  :key="b"
                  class="tx-chip"
                  :class="Math.abs(draft.overlap / fromBeatHeard! - b) < 0.05 ? 'tx-chip-on' : ''"
                  @click="update({ overlap: clampOverlap(b * fromBeatHeard!) })"
                >{{ b }} beats</button>
              </template>
              <template v-else>
                <input type="number" min="0.05" step="0.5" class="tx-input w-20" :value="round(draft.overlap, 2)"
                  @change="update({ overlap: clampOverlap(+($event.target as HTMLInputElement).value) })" />
                <span class="text-xs text-white/40">s</span>
              </template>
            </div>
            <p class="tx-help tx-indent">
              How long both songs play together ({{ round(draft.overlap, 1) }} s). Or drag the dashed line.
            </p>
          </template>

          <template v-if="draft.type === 'echo-out'">
            <div class="tx-row">
              <span class="tx-label-wide">Echo repeats every</span>
              <select v-if="fromBeat" class="tx-select" :value="echoBeats" @change="setEchoBeats(+($event.target as HTMLSelectElement).value)">
                <option v-for="b in echoBeatOptions" :key="b.value" :value="b.value">{{ b.label }}</option>
              </select>
              <template v-else>
                <input type="number" min="0.05" max="2" step="0.01" class="tx-input w-20" :value="round(echo.delay, 3)"
                  @change="update({ echo: { ...echo, delay: +($event.target as HTMLInputElement).value } })" />
                <span class="text-xs text-white/40">s</span>
              </template>
            </div>
            <div class="tx-row">
              <span class="tx-label-wide">Echo fades</span>
              <input type="range" min="0" max="0.9" step="0.05" class="flex-1 accent-accent" :value="echo.feedback"
                @input="update({ echo: { ...echo, feedback: +($event.target as HTMLInputElement).value } })" />
              <span class="text-xs text-white/50 w-16 text-right">{{ echo.feedback < 0.3 ? 'quickly' : echo.feedback < 0.6 ? 'gradually' : 'slowly' }}</span>
            </div>
          </template>

          <div class="flex items-center gap-3 mt-3">
            <button class="tx-chip" :disabled="!fromGrid" @click="applySuggestion(true)">Auto-suggest timing</button>
            <span class="tx-help">Picks a musical spot to leave and enter, based on the beats. Keeps your fades.</span>
          </div>
        </section>

        <section class="tx-card" :class="draft.type === 'cut' ? 'opacity-40 pointer-events-none' : ''">
          <h2 class="tx-card-title">Fades</h2>
          <p v-if="draft.type === 'cut'" class="tx-help mb-3">A quick cut switches instantly, so there's nothing to fade.</p>

          <div v-for="dir in (['out', 'in'] as const)" :key="dir" class="mb-4 last:mb-0">
            <div class="tx-row">
              <span class="tx-label-wide">
                <b class="tx-song">{{ dir === 'out' ? fromName : toName }}</b> fades {{ dir }}
              </span>
              <select class="tx-select flex-1" :value="fadeOf(dir)" @change="setFade(dir, ($event.target as HTMLSelectElement).value as CurvePreset)">
                <option v-for="c in curveOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
              <button v-if="fadeOf(dir) !== 'equal-power'" class="tx-chip" title="Back to the smooth default" @click="resetFade(dir)">Reset</button>
            </div>
            <p class="tx-help tx-indent">{{ fadeHelp(dir) }}</p>
          </div>
        </section>
      </div>

      <!-- Advanced -->
      <button
        class="mt-5 flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors"
        @click="setAdvancedOpen(!advancedOpen)"
      >
        <svg class="w-3.5 h-3.5 transition-transform" :class="advancedOpen ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Advanced
        <span class="text-xs text-white/30">exact timing, tempo &amp; pitch, bass swap, filter</span>
      </button>

      <div v-if="advancedOpen" class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3">
        <section class="tx-card">
          <h2 class="tx-card-title">Exact timing</h2>
          <p class="tx-help mb-3">If the drums sound doubled, the beats are slightly off. Nudge the incoming song until they hit together.</p>
          <div class="tx-row">
            <span class="tx-label">Leave at</span>
            <input type="number" min="0" step="0.001" class="tx-input w-28" :value="round(draft.exitAt, 3)"
              @change="setExit(+($event.target as HTMLInputElement).value)" />
            <span class="text-xs text-white/40">s</span>
          </div>
          <div class="tx-row">
            <span class="tx-label">Enter from</span>
            <input type="number" min="0" step="0.001" class="tx-input w-28" :value="round(draft.entryAt, 3)"
              @change="update({ entryAt: clampEntry(+($event.target as HTMLInputElement).value) })" />
            <span class="text-xs text-white/40">s</span>
          </div>
          <div class="tx-row">
            <span class="tx-label">Nudge</span>
            <div class="flex gap-1">
              <button class="tx-chip" title="Incoming song 10 ms earlier" @click="nudge(-0.01)">−10ms</button>
              <button class="tx-chip" title="Incoming song 1 ms earlier" @click="nudge(-0.001)">−1</button>
              <button class="tx-chip" title="Incoming song 1 ms later" @click="nudge(0.001)">+1</button>
              <button class="tx-chip" title="Incoming song 10 ms later" @click="nudge(0.01)">+10ms</button>
            </div>
          </div>
          <p class="tx-help">Arrow keys nudge too (hold Alt for 1 ms steps).</p>
        </section>

        <section class="tx-card" :class="draft.type === 'cut' ? 'opacity-40 pointer-events-none' : ''">
          <h2 class="tx-card-title">Tempo</h2>
          <p class="tx-help mb-3">
            Songs at different speeds drift apart during a blend. Changing the speed slightly keeps the beats together.
          </p>
          <div class="tx-row">
            <span class="tx-label">Speeds</span>
            <span class="text-xs text-white/50 tabular-nums">
              {{ fromGrid?.bpm ? fromGrid.bpm.toFixed(1) : '—' }} → {{ toGrid?.bpm ? toGrid.bpm.toFixed(1) : '—' }} BPM
            </span>
          </div>

          <div class="tx-row">
            <span class="tx-label">Who adjusts</span>
            <select class="tx-select flex-1 min-w-0" :value="stretchMode" @change="setStretchMode(($event.target as HTMLSelectElement).value as StretchMode)">
              <option value="to">{{ toName }} matches</option>
              <option value="meet">Meet in the middle</option>
              <option value="from">{{ fromName }} matches</option>
            </select>
          </div>
          <p class="tx-help tx-indent">{{ stretchModeHelp }}</p>

          <div class="tx-row">
            <span class="tx-label">Adjust</span>
            <input type="range" :min="-MAX_RATE_DEVIATION * 100" :max="MAX_RATE_DEVIATION * 100" step="0.01" class="flex-1 min-w-0 accent-accent"
              :value="ratePercent" @input="setRatePercent(+($event.target as HTMLInputElement).value)" />
            <span class="text-xs text-white/60 tabular-nums w-14 text-right">{{ ratePercent >= 0 ? '+' : '' }}{{ ratePercent.toFixed(2) }}%</span>
          </div>
          <div class="flex items-center gap-2 ml-[88px] mb-1">
            <button class="tx-chip" :disabled="!canMatchTempo" @click="matchTempo" title="Follows the Meet in the middle setting in Settings → Playback">Match tempo</button>
            <button class="tx-chip" @click="setRates({ rateTo: undefined, rateFrom: undefined })">Reset</button>
          </div>
          <p class="tx-help mt-2 mb-3">{{ tempoSummary }}</p>

          <div class="tx-row">
            <span class="tx-label">Pitch</span>
            <div class="flex rounded-lg overflow-hidden border border-white/[0.08]">
              <button
                v-for="opt in pitchOptions"
                :key="opt.value"
                @click="update({ pitch: opt.value })"
                class="px-3 py-1.5 text-xs transition-colors"
                :class="pitchMode === opt.value ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'"
              >{{ opt.label }}</button>
            </div>
          </div>
          <p class="tx-help tx-indent">{{ pitchHelp }}</p>

          <div class="tx-row">
            <span class="tx-label">Ease back</span>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="opt in rampBackOptions"
                :key="opt.label"
                class="tx-chip"
                :class="Math.abs(rampBackSeconds - opt.seconds) < 0.05 ? 'tx-chip-on' : ''"
                @click="update({ rampBack: opt.seconds })"
              >{{ opt.label }}</button>
            </div>
          </div>
          <p class="tx-help tx-indent">{{ rampBackHelp }}</p>

          <p v-if="tempoTooFar" class="text-[11px] text-amber-300/70 mt-2">
            These tempos are more than {{ MAX_RATE_DEVIATION * 100 }}% apart, too far to match. A short blend, a quick cut or an echo out will
            sound cleaner.
          </p>
          <p v-else-if="stretchWarn" class="text-[11px] text-amber-300/70 mt-2">{{ stretchWarnText }}</p>
        </section>

        <section class="tx-card" :class="draft.type === 'cut' ? 'opacity-40 pointer-events-none' : ''">
          <h2 class="tx-card-title">Bass &amp; filter</h2>
          <div class="tx-row">
            <span class="tx-label">Bass swap</span>
            <button
              @click="toggleBassSwap"
              class="relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0"
              :class="draft.bassSwap ? 'bg-accent' : 'bg-white/15'"
            >
              <div class="absolute top-0.5 w-5 h-5 rounded-full bg-control shadow transition-transform duration-200"
                :class="draft.bassSwap ? 'translate-x-[22px]' : 'translate-x-0.5'" />
            </button>
          </div>
          <p class="tx-help mb-3">
            Two basslines at once sound muddy. This plays only the first song's bass until the diamond, then only the second's.
          </p>

          <div class="tx-row">
            <span class="tx-label">Filter</span>
            <select class="tx-select flex-1" :value="filterKey" @change="setFilterKey(($event.target as HTMLSelectElement).value)">
              <option value="none">None</option>
              <option value="from-lowpass">Muffle the first song away</option>
              <option value="from-highpass">Thin out the first song</option>
              <option value="to-lowpass">Open up the second song</option>
              <option value="to-highpass">Bring the second song's bass in</option>
            </select>
          </div>
          <template v-if="draft.filter">
            <div class="tx-row">
              <span class="tx-label">Start</span>
              <input type="range" min="0" max="1" step="0.001" class="flex-1 accent-accent" :value="hzToSlider(draft.filter.startHz)"
                @input="update({ filter: { ...draft.filter!, startHz: sliderToHz(+($event.target as HTMLInputElement).value) } })" />
              <span class="text-xs text-white/50 tabular-nums w-16 text-right">{{ formatHz(draft.filter.startHz) }}</span>
            </div>
            <div class="tx-row">
              <span class="tx-label">End</span>
              <input type="range" min="0" max="1" step="0.001" class="flex-1 accent-accent" :value="hzToSlider(draft.filter.endHz)"
                @input="update({ filter: { ...draft.filter!, endHz: sliderToHz(+($event.target as HTMLInputElement).value) } })" />
              <span class="text-xs text-white/50 tabular-nums w-16 text-right">{{ formatHz(draft.filter.endHz) }}</span>
            </div>
          </template>
          <p class="tx-help">Sweeps a filter across the blend, like the song is moving into another room.</p>
        </section>
      </div>

      <!-- Test in the real player -->
      <div class="mt-5 flex items-center gap-3">
        <button class="tx-chip" @click="audition" :disabled="!existing || dirty" :title="dirty ? 'Save first' : ''">
          Test in the player
        </button>
        <span class="tx-help">
          Plays the first song from 12 s before the blend, with the second queued next, through the real player.
          {{ dirty ? 'Save first.' : '' }}
        </span>
      </div>
    </template>

    <ConfirmDialog
      :show="showDelete"
      title="Delete transition?"
      message="This hand-made transition will be gone for good."
      confirm-label="Delete"
      variant="danger"
      @confirm="doDelete"
      @cancel="showDelete = false"
    />
    <ConfirmDialog
      :show="showLeave"
      title="Discard changes?"
      message="You have unsaved changes to this transition."
      confirm-label="Discard"
      variant="danger"
      @confirm="resolveLeave(true)"
      @cancel="resolveLeave(false)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useTransitionsStore } from '@/stores/transitions'
import { useToast } from '@/composables/useToast'
import { songKey } from '@/utils/smartPlaylistMatcher'
import { formatTime } from '@/utils/formatTime'
import { decodeWindow, previewStretchPlan, type PreviewHandle, type PreviewSolo } from '@/utils/transitions/engine'
import { renderPlan, planKey, type StretchPlan } from '@/utils/transitions/stretch/plan'
import { stretchInWorker } from '@/utils/transitions/stretch/client'
import { PeakPyramid } from '@/utils/transitions/peaks'
import { getBeatGrid } from '@/utils/transitions/analysis'
import { suggestTransition } from '@/utils/transitions/suggest'
import { moveExit, slideTo, fromSpeed, mixMapping } from '@/utils/transitions/timeline'
import { renderPreviewSpeed, type PreviewSpeedMix } from '@/utils/transitions/previewSpeed'
import {
  clampRate, presetVertices, rateRatio, splitRates, autoStretchMode, pitchOf, rampBackOf, fromPositionAt, fromTimeAt,
  MAX_RATE_DEVIATION, STRETCH_WARN_DEVIATION, DEFAULT_RAMP_BACK_BARS, MAX_FROM_RAMP, DEFAULT_ECHO, type TransitionTiming,
} from '@/utils/transitions/schedule'
import type { Transition, TransitionEndpoint, BeatGrid, CurvePreset, TransitionType, PitchMode, StretchMode } from '@/types/transition'
import TransitionTimeline from '@/components/transitions/TransitionTimeline.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const store = useTransitionsStore()
const toast = useToast()

const status = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const fromTrack = ref<Track | null>(null)
const toTrack = ref<Track | null>(null)
const existing = ref<Transition | null>(null)
const draft = ref<Transition | null>(null)
const durationsChanged = ref(false)
const saving = ref(false)
/** The user has changed something since loading (stops the automatic suggestion) */
let touched = false

const fromBuf = shallowRef<AudioBuffer | null>(null)
const toBuf = shallowRef<AudioBuffer | null>(null)
const fromPeaks = shallowRef<PeakPyramid | null>(null)
const toPeaks = shallowRef<PeakPyramid | null>(null)
const fromGrid = ref<BeatGrid | null>(null)
const toGrid = ref<BeatGrid | null>(null)
const analysing = ref(false)
const snap = ref(true)

const timelineRef = ref<InstanceType<typeof TransitionTimeline>>()
let fallbackCtx: AudioContext | null = null
let loadToken = 0

const fromDuration = computed(() => fromBuf.value?.duration ?? 0)
const toDuration = computed(() => toBuf.value?.duration ?? 0)

const TIMING_KEYS = [
  'type', 'exitAt', 'entryAt', 'overlap', 'fadeOut', 'fadeIn', 'fadeOutPoints', 'fadeInPoints', 'bassSwap', 'filter', 'echo', 'rateTo',
  'rateFrom', 'pitch', 'stretch', 'rampBack',
] as const

function timingOf(t: Transition): TransitionTiming {
  const out: any = {}
  for (const k of TIMING_KEYS) if (t[k] !== undefined) out[k] = t[k]
  return out
}

const timing = computed<TransitionTiming>(() => (draft.value ? timingOf(draft.value) : ({} as TransitionTiming)))
const dirty = computed(() => {
  if (!draft.value) return false
  if (!existing.value) return true
  return JSON.stringify(timingOf(draft.value)) !== JSON.stringify(timingOf(existing.value))
})

// ── Options ────────────────────────────────────────────────────────────────
const typeOptions: { value: TransitionType; label: string; help: string }[] = [
  { value: 'blend', label: 'Smooth blend', help: 'Both songs play together for a while as one fades out and the other fades in.' },
  { value: 'cut', label: 'Quick cut', help: 'Switches instantly from one song to the other, right on the beat.' },
  { value: 'echo-out', label: 'Echo out', help: 'The first song stops and its last moment echoes away while the second comes in.' },
]
const curveOptions: { value: CurvePreset; label: string }[] = [
  { value: 'equal-power', label: 'Smooth (recommended)' },
  { value: 'linear', label: 'Straight line' },
  { value: 's-curve', label: 'Slow at the ends' },
  { value: 'none', label: 'No fade' },
  { value: 'custom', label: 'Custom (your points)' },
]
const soloOptions = computed<{ value: PreviewSolo; label: string }[]>(() => [
  { value: 'both', label: 'Both' },
  { value: 'from', label: `${fromName.value} only` },
  { value: 'to', label: `${toName.value} only` },
])

const typeHelp = computed(() => typeOptions.find(o => o.value === draft.value?.type)?.help ?? '')

/** Song titles short enough for labels */
const shortTitle = (s: string | undefined) => (!s ? '' : s.length > 22 ? s.slice(0, 21).trimEnd() + '…' : s)
const fromName = computed(() => shortTitle(fromTrack.value?.title))
const toName = computed(() => shortTitle(toTrack.value?.title))
const echoBeatOptions = [
  { value: 0.25, label: '1/4 beat' },
  { value: 0.5, label: '1/2 beat' },
  { value: 0.75, label: '3/4 beat' },
  { value: 1, label: '1 beat' },
  { value: 2, label: '2 beats' },
]

// ── Derived ────────────────────────────────────────────────────────────────
const usable = (g: BeatGrid | null) => (g && g.bpm > 0 && g.confidence >= 0.2 ? g : null)
const fromBeat = computed(() => usable(fromGrid.value)?.period ?? null)
const toBeat = computed(() => usable(toGrid.value)?.period ?? null)
/** Leave / enter points move by whole bars when the beats are known, else by 2 s */
const barLabel = computed(() => (fromBeat.value ? '1 bar' : '2 s'))
const barTitle = computed(() => (fromBeat.value ? 'Move by one bar (4 beats), which keeps the beats lined up' : 'Move by 2 seconds'))
/** How much faster the incoming song plays than the outgoing one during the blend */
const ratio = computed(() => (!draft.value || draft.value.type === 'cut' ? 1 : rateRatio(draft.value)))
const ratePercent = computed(() => (ratio.value - 1) * 100)
const toRate = computed(() => (draft.value?.type === 'cut' ? 1 : clampRate(draft.value?.rateTo)))
const fromRate = computed(() => (draft.value?.type === 'cut' ? 1 : clampRate(draft.value?.rateFrom)))
/** One beat of the outgoing song as heard during the blend (shorter when it speeds up) */
const fromBeatHeard = computed(() => (fromBeat.value ? fromBeat.value / fromRate.value : null))
const stretchMode = computed<StretchMode>(() => draft.value?.stretch ?? 'to')
const pitchMode = computed<PitchMode>(() => (draft.value ? pitchOf(draft.value) : 'keep'))
const rampBackSeconds = computed(() => (draft.value ? rampBackOf(draft.value) : 0))
const tempoRatio = computed(() => {
  const f = usable(fromGrid.value), t = usable(toGrid.value)
  return f && t ? f.bpm / t.bpm : null
})
const canMatchTempo = computed(() => tempoRatio.value !== null && Math.abs(tempoRatio.value - 1) <= MAX_RATE_DEVIATION)
const tempoTooFar = computed(() => tempoRatio.value !== null && Math.abs(tempoRatio.value - 1) > MAX_RATE_DEVIATION)
const echo = computed(() => draft.value?.echo ?? { ...DEFAULT_ECHO })
const echoBeats = computed(() => {
  if (!fromBeatHeard.value) return 0.75
  const beats = echo.value.delay / fromBeatHeard.value
  return echoBeatOptions.reduce((best, o) => (Math.abs(o.value - beats) < Math.abs(best - beats) ? o.value : best), 0.75)
})
const filterKey = computed(() => (draft.value?.filter ? `${draft.value.filter.target}-${draft.value.filter.kind}` : 'none'))

// ── Tempo wording ──────────────────────────────────────────────────────────
const pitchOptions: { value: PitchMode; label: string }[] = [
  { value: 'keep', label: 'Keep pitch' },
  { value: 'vinyl', label: 'Vinyl' },
]
const pct = (r: number) => `${Math.abs((r - 1) * 100).toFixed(1)}%`
const changes = (name: string, r: number) => `${name} ${r > 1 ? 'speeds up' : 'slows down'} ${pct(r)}`

const stretchModeHelp = computed(() => {
  switch (stretchMode.value) {
    case 'meet': return `Both songs change speed by about half as much: ${fromName.value} eases into the shared tempo before the blend, ${toName.value} eases back to its own afterwards.`
    case 'from': return `${fromName.value} eases into ${toName.value}'s tempo before the blend. ${toName.value} plays at its own speed.`
    default: return `${toName.value} changes speed to match ${fromName.value}, then eases back to its own speed.`
  }
})
const tempoSummary = computed(() => {
  const parts: string[] = []
  if (Math.abs(fromRate.value - 1) > 1e-4) parts.push(changes(fromName.value, fromRate.value))
  if (Math.abs(toRate.value - 1) > 1e-4) parts.push(changes(toName.value, toRate.value))
  return parts.length ? `During the blend, ${parts.join(' and ')}.` : 'Both songs play at their own speed.'
})
const pitchHelp = computed(() => pitchMode.value === 'keep'
  ? 'Each song stays in its own key while its speed changes (time-stretching). Takes a moment to prepare.'
  : 'Like nudging a record: the pitch rises and falls with the speed. The cleanest sound, but the key shifts slightly.')
const rampBackOptions = computed(() => {
  const bar = toBeat.value ? toBeat.value * 4 : null
  return bar
    ? [2, 4, 8, 16].map(b => ({ label: `${b} bars`, seconds: b * bar }))
    : [2, 4, 8, 16].map(sec => ({ label: `${sec} s`, seconds: sec }))
})
const rampBackHelp = computed(() => {
  const secs = `${rampBackSeconds.value.toFixed(1)} s`
  const into = Math.abs(fromRate.value - 1) > 1e-4
    ? ` ${fromName.value} takes the same time to ease into the new speed before the blend (at most ${MAX_FROM_RAMP} s).`
    : ''
  return `How gently ${toName.value} returns to its own speed after the blend (${secs}). Longer is smoother.${into}`
})
/** The bigger of the two speed changes */
const biggestChange = computed(() => Math.max(Math.abs(toRate.value - 1), Math.abs(fromRate.value - 1)))
const stretchWarn = computed(() => biggestChange.value > STRETCH_WARN_DEVIATION + 1e-9)
const stretchWarnText = computed(() => {
  const big = `That's a big speed change (${(biggestChange.value * 100).toFixed(1)}%).`
  if (pitchMode.value === 'vinyl') return `${big} With Vinyl the key moves by about a semitone or more, which can clash. Keep pitch avoids that.`
  if (stretchMode.value !== 'meet') return `${big} Stretching this far can sound a little smeared. Meet in the middle halves it.`
  return `${big} Stretching this far can sound a little smeared on some songs. Have a listen.`
})

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits

// ── Loading ────────────────────────────────────────────────────────────────
function findTrack(ep: TransitionEndpoint): Track | null {
  return library.tracks.find(t => t.path === ep.path) ?? library.tracks.find(t => songKey(t) === ep.key) ?? null
}

function isLocal(t: Track) {
  return t.source !== 'subsonic' && (t.path.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(t.path))
}

async function load() {
  const token = ++loadToken
  stopPreview()
  // Stretched previews belong to the songs that were open
  stretchCache.clear()
  stretchDone.clear()
  speedCache.clear()
  status.value = 'loading'
  fromGrid.value = toGrid.value = null
  fromBuf.value = toBuf.value = fromPeaks.value = toPeaks.value = null
  touched = false

  const q = route.query
  let t: Transition | null = null
  let from: Track | null = null
  let to: Track | null = null
  if (typeof q.id === 'string') {
    t = store.getById(q.id)
    if (t) { from = findTrack(t.from); to = findTrack(t.to) }
  } else {
    from = library.tracks.find(x => x.id === q.from) ?? null
    to = library.tracks.find(x => x.id === q.to) ?? null
    if (from && to) t = store.find(from, to)
  }
  existing.value = t
  fromTrack.value = from
  toTrack.value = to

  if (!from || !to) {
    status.value = 'error'
    const missing = t ? [!from && `"${t.from.title}"`, !to && `"${t.to.title}"`].filter(Boolean).join(' and ') : 'The song'
    errorMessage.value = t || q.from ? `${missing} isn't in your library any more.` : 'Transition not found.'
    return
  }
  if (!isLocal(from) || !isLocal(to)) {
    status.value = 'error'
    errorMessage.value = 'Transitions only work between local files for now.'
    return
  }

  try {
    const ctx = player.getAudioContext() ?? (fallbackCtx ??= new AudioContext())
    const [fd, td] = await Promise.all([
      decodeWindow(ctx, window.api.getMediaUrl(from.path)),
      decodeWindow(ctx, window.api.getMediaUrl(to.path)),
    ])
    if (token !== loadToken) return
    fromBuf.value = fd.buffer
    toBuf.value = td.buffer
    fromPeaks.value = new PeakPyramid(fd.buffer)
    toPeaks.value = new PeakPyramid(td.buffer)
    durationsChanged.value = !!t && (Math.abs(t.from.duration - fd.duration) > 0.5 || Math.abs(t.to.duration - td.duration) > 0.5)
    draft.value = t
      ? JSON.parse(JSON.stringify(t))
      : store.create(from, to, { from: fd.duration, to: td.duration })
    status.value = 'ready'
  } catch (err) {
    if (token !== loadToken) return
    status.value = 'error'
    errorMessage.value = /\b404\b/.test(String(err))
      ? "One of these songs' files can't be found. It may have been moved or deleted. Rescan your library in Settings, then try again."
      : `Couldn't decode the audio: ${err}`
    return
  }

  await nextTick()
  timelineRef.value?.fit()

  analysing.value = true
  const [fg, tg] = await Promise.all([
    getBeatGrid(from.path, fromBuf.value!),
    getBeatGrid(to.path, toBuf.value!),
  ])
  if (token !== loadToken) return
  fromGrid.value = fg
  toGrid.value = tg
  analysing.value = false
  if (!existing.value && !touched) {
    applySuggestion(false)
    // New transitions ease back over 8 bars of the incoming song when its beats are known
    if (toBeat.value && draft.value) draft.value.rampBack = DEFAULT_RAMP_BACK_BARS * 4 * toBeat.value
  }
}

watch(() => route.fullPath, () => {
  if (route.path !== '/transition/edit') return
  // Saving a new transition rewrites the URL to its id: nothing to reload
  if (typeof route.query.id === 'string' && route.query.id === existing.value?.id && draft.value) return
  load()
})

onMounted(load)

// ── Editing ────────────────────────────────────────────────────────────────
function update(patch: Partial<Transition>) {
  if (!draft.value) return
  touched = true
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (draft.value as any)[k]
    else (draft.value as any)[k] = v
  }
  if (draft.value.bassSwap && draft.value.bassSwap.at > draft.value.overlap) {
    draft.value.bassSwap = { at: draft.value.overlap }
  }
}

function clampOverlap(v: number) {
  const d = draft.value!
  return Math.max(0.05, Math.min(isFinite(v) ? v : 8, (fromDuration.value - d.exitAt) / fromRate.value))
}

function clampEntry(v: number) {
  return Math.max(0, Math.min(isFinite(v) ? v : 0, toDuration.value - 0.5))
}

function setExit(v: number) {
  const d = draft.value!
  const exit = Math.max(0, Math.min(isFinite(v) ? v : d.exitAt, fromDuration.value - Math.min(d.overlap, 1)))
  const next = moveExit(timingOf(d), exit)
  update({ exitAt: next.exitAt, entryAt: clampEntry(next.entryAt), overlap: Math.min(d.overlap, fromDuration.value - exit) })
  timelineRef.value?.ensureVisible()
}

/** Move where the first song leaves by whole bars (the incoming song moves with it) */
function shiftExit(bars: number) {
  const d = draft.value
  if (!d) return
  setExit(d.exitAt + bars * (fromBeat.value ? fromBeat.value * 4 : 2))
}

/** Move which part of the incoming song is heard first, by whole bars of its own beat */
function shiftEntry(bars: number) {
  const d = draft.value
  if (!d) return
  update({ entryAt: clampEntry(d.entryAt + bars * (toBeat.value ? toBeat.value * 4 : 2)) })
}

/** m:ss.s, precise enough to tell bar moves apart */
function formatTimePrecise(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

// ── Fades ──────────────────────────────────────────────────────────────────
const fadeOf = (dir: 'out' | 'in') => (dir === 'out' ? draft.value!.fadeOut : draft.value!.fadeIn)

function setFade(dir: 'out' | 'in', preset: CurvePreset) {
  const d = draft.value
  if (!d) return
  const pointsKey = dir === 'out' ? 'fadeOutPoints' : 'fadeInPoints'
  const patch: Partial<Transition> = dir === 'out' ? { fadeOut: preset } : { fadeIn: preset }
  // A new custom fade starts from the shape that was selected, so nothing jumps
  if (preset === 'custom' && !d[pointsKey]?.length) patch[pointsKey] = presetVertices(fadeOf(dir), dir)
  update(patch)
}

function resetFade(dir: 'out' | 'in') {
  update(dir === 'out'
    ? { fadeOut: 'equal-power', fadeOutPoints: undefined }
    : { fadeIn: 'equal-power', fadeInPoints: undefined })
}

function fadeHelp(dir: 'out' | 'in') {
  const out = dir === 'out'
  switch (fadeOf(dir)) {
    case 'equal-power': return 'Keeps the overall volume even through the blend. Sounds right most of the time.'
    case 'linear': return 'Changes volume at a steady rate. Can sound like a slight dip in the middle.'
    case 's-curve': return out ? 'Stays loud longer, drops fast in the middle, then eases out.' : 'Stays quiet longer, rises fast in the middle, then eases in.'
    case 'none': return out ? 'Stays at full volume for the whole blend, then stops.' : 'Comes in at full volume straight away.'
    case 'custom': return 'Double-click the line to add a point, drag points to shape it, right-click (or select + Delete) to remove one.'
    default: return ''
  }
}

// ── Advanced panel (remembered between visits) ─────────────────────────────
const ADVANCED_KEY = 'aurora-tx-advanced'
const advancedOpen = ref(false)
try { advancedOpen.value = localStorage.getItem(ADVANCED_KEY) === '1' } catch { /* storage unavailable */ }
function setAdvancedOpen(open: boolean) {
  advancedOpen.value = open
  try { localStorage.setItem(ADVANCED_KEY, open ? '1' : '0') } catch { /* storage unavailable */ }
}

/** Positive = TO heard later against FROM */
function nudge(seconds: number) {
  const d = draft.value
  if (!d) return
  update({ entryAt: clampEntry(slideTo(timingOf(d), seconds)) })
}

/**
 * Change the songs' speeds. Lengths set in the outgoing song's beats (blend, bass swap, echo)
 * are kept in its beats, so a 16-beat blend stays 16 beats when that song changes speed.
 */
function setRates(rates: Pick<Transition, 'rateTo' | 'rateFrom'>, extra: Partial<Transition> = {}) {
  const d = draft.value
  if (!d) return
  const k = fromSpeed(timingOf(d)) / (d.type === 'cut' ? 1 : clampRate(rates.rateFrom))
  const patch: Partial<Transition> = { ...extra, ...rates }
  if (Math.abs(k - 1) > 1e-9) {
    patch.overlap = clampOverlapFor(d.overlap * k, clampRate(rates.rateFrom))
    if (d.bassSwap) patch.bassSwap = { at: Math.min(d.bassSwap.at * k, patch.overlap) }
    if (d.echo) patch.echo = { ...d.echo, delay: d.echo.delay * k }
  }
  update(patch)
}

function clampOverlapFor(v: number, rateFrom: number) {
  return Math.max(0.05, Math.min(v, (fromDuration.value - draft.value!.exitAt) / rateFrom))
}

function setRatePercent(pct: number) {
  setRates(splitRates(1 + pct / 100, stretchMode.value))
}

/** Stretch mode for a match of `r`, following the "Meet in the middle" setting */
function autoModeFor(r: number): StretchMode {
  return autoStretchMode(r, stretchMode.value, player.autoMeet, player.autoMeetPercent / 100)
}

function matchTempo() {
  if (tempoRatio.value === null) return
  const mode = autoModeFor(tempoRatio.value)
  setRates(splitRates(tempoRatio.value, mode), mode !== stretchMode.value ? { stretch: mode } : {})
}

function setStretchMode(mode: StretchMode) {
  setRates(splitRates(ratio.value, mode), { stretch: mode })
}

function toggleBassSwap() {
  const d = draft.value!
  if (d.bassSwap) { update({ bassSwap: undefined }); return }
  let at = d.overlap / 2
  if (fromBeatHeard.value) at = Math.round(at / fromBeatHeard.value) * fromBeatHeard.value
  update({ bassSwap: { at: Math.min(at, d.overlap) } })
}

function setEchoBeats(beats: number) {
  if (fromBeatHeard.value) update({ echo: { ...echo.value, delay: beats * fromBeatHeard.value } })
}

const FILTER_DEFAULTS: Record<string, { startHz: number; endHz: number }> = {
  'from-highpass': { startHz: 20, endHz: 1000 },
  'from-lowpass': { startHz: 20000, endHz: 400 },
  'to-highpass': { startHz: 1000, endHz: 20 },
  'to-lowpass': { startHz: 400, endHz: 20000 },
}

function setFilterKey(key: string) {
  if (key === 'none') { update({ filter: undefined }); return }
  const [target, kind] = key.split('-') as ['from' | 'to', 'highpass' | 'lowpass']
  update({ filter: { target, kind, ...FILTER_DEFAULTS[key] } })
}

// Log-scale slider for 20 Hz – 20 kHz
const hzToSlider = (hz: number) => Math.log(Math.max(20, hz) / 20) / Math.log(1000)
const sliderToHz = (v: number) => Math.round(20 * Math.pow(1000, v))
const formatHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`)

function applySuggestion(userAsked: boolean) {
  if (!draft.value) return
  const s = suggestTransition({
    from: { grid: fromGrid.value, duration: fromDuration.value },
    to: { grid: toGrid.value, duration: toDuration.value },
  })
  const keep = { type: draft.value.type, fadeOut: draft.value.fadeOut, fadeIn: draft.value.fadeIn }
  const mode = autoModeFor(s.rateTo ?? 1)
  if (mode !== stretchMode.value) draft.value.stretch = mode
  for (const k of ['bassSwap', 'rateTo', 'rateFrom'] as const) delete draft.value[k]
  Object.assign(draft.value, s)
  // The suggestion matches by changing the incoming song; share that out as the user prefers.
  // Its lengths are in the outgoing song's beats, which last 1/rateFrom as long once it changes speed.
  const rates = splitRates(s.rateTo ?? 1, mode)
  if (rates.rateTo === undefined) delete draft.value.rateTo
  else draft.value.rateTo = rates.rateTo
  if (rates.rateFrom !== undefined) {
    draft.value.rateFrom = rates.rateFrom
    draft.value.overlap = clampOverlapFor(draft.value.overlap / rates.rateFrom, rates.rateFrom)
    if (draft.value.bassSwap) draft.value.bassSwap = { at: Math.min(draft.value.bassSwap.at / rates.rateFrom, draft.value.overlap) }
  }
  // Re-suggesting is about timing: keep the style and any fades the user shaped
  if (userAsked) Object.assign(draft.value, keep)
  if (userAsked) touched = true
  nextTick(() => timelineRef.value?.fit())
}

function revert() {
  if (existing.value) draft.value = JSON.parse(JSON.stringify(existing.value))
}

async function save(): Promise<boolean> {
  const d = draft.value, from = fromTrack.value, to = toTrack.value
  if (!d || !from || !to || !fromBuf.value || !toBuf.value) return false
  saving.value = true
  try {
    const saved = await store.save({
      ...d,
      from: { key: songKey(from), path: from.path, duration: fromBuf.value.duration, title: from.title, artist: from.artist },
      to: { key: songKey(to), path: to.path, duration: toBuf.value.duration, title: to.title, artist: to.artist },
      needsReview: false,
    })
    existing.value = saved
    draft.value = JSON.parse(JSON.stringify(saved))
    durationsChanged.value = false
    toast.success('Transition saved')
    if (route.query.id !== saved.id) router.replace({ path: '/transition/edit', query: { id: saved.id } })
    return true
  } catch (err) {
    toast.error(`Couldn't save: ${err}`)
    return false
  } finally {
    saving.value = false
  }
}

const showDelete = ref(false)
async function doDelete() {
  showDelete.value = false
  if (!existing.value) return
  await store.remove(existing.value.id)
  existing.value = null
  draft.value = null
  toast.success('Transition deleted')
  router.push('/transitions')
}

function audition() {
  const d = existing.value
  if (!d || !fromTrack.value || !toTrack.value) return
  stopPreview()
  player.auditionTransition(fromTrack.value, toTrack.value, d.exitAt - 12)
}

// ── Preview ────────────────────────────────────────────────────────────────
const preview = shallowRef<PreviewHandle | null>(null)
/** Waiting for the time-stretched audio before the preview can start */
const preparingPreview = ref(false)
const previewing = computed(() => !!preview.value || preparingPreview.value)
const playhead = ref<number | null>(null)
const preRoll = ref(10)
const loop = ref(false)
const solo = ref<PreviewSolo>('both')
const POST_ROLL = 5
let rafId = 0
let previewToken = 0

// With "Keep pitch" the parts that change speed are time-stretched in a worker first. Renders
// are cached by what they depend on, and started shortly after the settings stop changing so
// pressing play is usually instant.
type Stretched = { from?: AudioBuffer; to?: AudioBuffer }
const stretchCache = new Map<string, Promise<Stretched>>()
const stretchDone = new Set<string>()
const stretchState = ref<'none' | 'pending' | 'ready'>('none')
let stretchTimer: ReturnType<typeof setTimeout> | undefined

function previewPlan(): StretchPlan {
  return draft.value ? previewStretchPlan(timingOf(draft.value), { preRoll: preRoll.value, postRoll: POST_ROLL }) : {}
}

function stretchedFor(plan: StretchPlan): Promise<Stretched> | null {
  if (!plan.from && !plan.to) return null
  if (!fromBuf.value || !toBuf.value) return null
  const key = planKey(plan)
  let p = stretchCache.get(key)
  if (!p) {
    const ctx = player.getAudioContext() ?? (fallbackCtx ??= new AudioContext())
    p = renderPlan(ctx, plan, { from: { buffer: fromBuf.value, start: 0 }, to: { buffer: toBuf.value, start: 0 } }, stretchInWorker)
    stretchCache.set(key, p)
    p.then(() => {
      stretchDone.add(key)
      if (stretchKey.value === key) stretchState.value = 'ready'
    }, () => { stretchCache.delete(key) })
    // Keep only the last few renders (each holds tens of seconds of audio)
    while (stretchCache.size > 4) {
      const oldest = stretchCache.keys().next().value!
      stretchCache.delete(oldest)
      stretchDone.delete(oldest)
    }
  }
  return p
}

const stretchKey = computed(() => {
  if (status.value !== 'ready' || !draft.value) return ''
  const plan = previewPlan()
  return plan.from || plan.to ? planKey(plan) : ''
})

watch(stretchKey, (key) => {
  clearTimeout(stretchTimer)
  if (!key) { stretchState.value = 'none'; return }
  if (stretchDone.has(key)) { stretchState.value = 'ready'; return }
  stretchState.value = 'pending'
  stretchTimer = setTimeout(() => { stretchedFor(previewPlan())?.catch(() => {}) }, 400)
})

/** Play the preview, from `cue` seconds after the exit if given (else from the pre-roll) */
async function startPreview(cue?: number) {
  const d = draft.value
  if (!d || !fromBuf.value || !toBuf.value) return
  stopPreview()
  const token = ++previewToken
  const t = timingOf(d)
  const exitAt = d.exitAt
  const buffers = { from: fromBuf.value, to: toBuf.value }
  pendingCue = cue
  // While the audio is prepared, keep the playhead where playback will start
  if (cue !== undefined) {
    const m = mixMapping(t).schedule
    playhead.value = fromPositionAt(exitAt, m, m.t0 + cue)
  }
  let stretched: Stretched | undefined
  const plan = previewPlan()
  const pending = stretchedFor(plan)
  if (pending) {
    preparingPreview.value = true
    try {
      stretched = await pending
    } catch (err) {
      console.warn('[Transitions] Time-stretch failed:', err)
      toast.error('Couldn\'t prepare the pitch-kept speed change, so this preview changes pitch like vinyl.')
    }
    if (token !== previewToken) return
  }
  let speedMix: PreviewSpeedMix | undefined
  if (speed.value !== 1) {
    preparingPreview.value = true
    try {
      speedMix = await speedMixFor(t, buffers, stretched, plan)
    } catch (err) {
      console.warn('[Transitions] Preview speed failed:', err)
      toast.error('Couldn\'t prepare that playback speed, so this preview plays at normal speed.')
    }
    if (token !== previewToken) return
  }
  preparingPreview.value = false
  const handle = player.previewTransition(buffers, t, {
    preRoll: preRoll.value,
    postRoll: POST_ROLL,
    solo: solo.value,
    stretched,
    cue,
    speedMix,
    onEnded: () => {
      if (preview.value !== handle) return
      preview.value = null
      playhead.value = null
      if (loop.value) startPreview()
    },
  })
  if (!handle) { toast.error('Audio engine not ready'); return }
  preview.value = handle
  const ctx = player.getAudioContext()!
  const tick = () => {
    if (preview.value !== handle) return
    // Something else (e.g. pressing play in the player bar) stopped the preview
    if (!player.isTransitionPreviewing()) { preview.value = null; playhead.value = null; return }
    // Where the outgoing song is (it may be changing speed): the timeline's x-axis
    playhead.value = fromPositionAt(exitAt, handle.schedule, handle.schedule.t0 + handle.heardAt(ctx.currentTime))
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

/** Where a paused preview resumes (seconds after the exit); the playhead stays there */
let pausedCue: number | undefined

/** Pause in place: Space resumes from here, "Play transition" starts over */
function pausePreview() {
  const at = previewPosition()
  const head = playhead.value
  stopPreview()
  if (at === undefined) return
  pausedCue = at
  playhead.value = head
}

function stopPreview() {
  pausedCue = undefined
  previewToken++
  preparingPreview.value = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  preview.value?.stop()
  preview.value = null
  playhead.value = null
}

/** Play from FROM position `x` (the playhead was dragged or the ruler clicked) */
function seekPreview(x: number) {
  const d = draft.value
  if (!d) return
  const m = mixMapping(timingOf(d)).schedule
  startPreview(fromTimeAt(d.exitAt, m, x) - m.t0)
}

/** Seconds after the exit the preview is at now (or will start from, while it prepares) */
function previewPosition(): number | undefined {
  const ctx = player.getAudioContext()
  return preview.value && ctx ? preview.value.heardAt(ctx.currentTime) : pendingCue
}

// ── Preview speed (listening only) ─────────────────────────────────────────
const speed = ref(1)
const speedOptions = [
  { value: 0.5, label: '0.5× speed' },
  { value: 0.75, label: '0.75× speed' },
  { value: 1, label: 'Normal speed' },
  { value: 1.25, label: '1.25× speed' },
  { value: 1.5, label: '1.5× speed' },
]
let pendingCue: number | undefined
const speedCache = new Map<string, Promise<PreviewSpeedMix>>()

function speedMixFor(t: TransitionTiming, buffers: { from: AudioBuffer; to: AudioBuffer }, stretched: Stretched | undefined, plan: StretchPlan) {
  const key = JSON.stringify([t, preRoll.value, POST_ROLL, speed.value, plan.from || plan.to ? planKey(plan) : '', !!stretched])
  let p = speedCache.get(key)
  if (!p) {
    p = renderPreviewSpeed(buffers, stretched, t, { preRoll: preRoll.value, postRoll: POST_ROLL, speed: speed.value }, stretchInWorker)
    speedCache.set(key, p)
    p.catch(() => speedCache.delete(key))
    // Each one holds the whole preview as four channels: keep only the last two
    while (speedCache.size > 2) speedCache.delete(speedCache.keys().next().value!)
  }
  return p
}

// Changing the speed mid-preview carries on from the same spot
watch(speed, () => {
  if (previewing.value) startPreview(previewPosition())
})

function setSolo(value: PreviewSolo) {
  solo.value = value
  preview.value?.setSolo(value)
}

// ── Keyboard ───────────────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (status.value !== 'ready' || showDelete.value || showLeave.value) return
  const el = e.target as HTMLElement
  if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return
  if (e.ctrlKey || e.metaKey) return
  if (e.key === ' ') {
    previewing.value ? pausePreview() : startPreview(pausedCue)
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    nudge((e.key === 'ArrowRight' ? 1 : -1) * (e.altKey ? 0.001 : 0.01))
  } else {
    return
  }
  // Keep the app-wide shortcuts (play/pause, seek) from also firing
  e.preventDefault()
  e.stopPropagation()
}

onMounted(() => document.addEventListener('keydown', onKeydown, { capture: true }))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, { capture: true })
  stopPreview()
  clearTimeout(stretchTimer)
  stretchCache.clear()
  speedCache.clear()
  fallbackCtx?.close().catch(() => {})
})

// ── Leaving with unsaved changes ───────────────────────────────────────────
const showLeave = ref(false)
let leaveResolver: ((ok: boolean) => void) | null = null
function resolveLeave(ok: boolean) {
  showLeave.value = false
  leaveResolver?.(ok)
  leaveResolver = null
}

function confirmDiscard(): boolean | Promise<boolean> {
  stopPreview()
  if (!dirty.value || status.value !== 'ready') return true
  showLeave.value = true
  return new Promise<boolean>(resolve => { leaveResolver = resolve })
}

onBeforeRouteLeave(confirmDiscard)
// Opening another transition from the queue panel reuses this view
onBeforeRouteUpdate(confirmDiscard)
</script>

<style scoped>
.tx-card {
  padding: 1rem 1.1rem;
  border-radius: 0.9rem;
  background: rgb(var(--app-text) / 0.04);
}
.tx-card-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--app-text) / 0.35);
  margin-bottom: 0.75rem;
}
.tx-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}
.tx-label {
  width: 80px;
  flex-shrink: 0;
  font-size: 0.75rem;
  color: rgb(var(--app-text) / 0.5);
}
.tx-label-wide {
  width: 210px;
  flex-shrink: 0;
  font-size: 0.8rem;
  color: rgb(var(--app-text) / 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx-song {
  font-weight: 600;
  color: rgb(var(--app-text) / 0.9);
}
.tx-help {
  font-size: 0.7rem;
  line-height: 1.4;
  color: rgb(var(--app-text) / 0.35);
}
.tx-indent {
  margin: -0.35rem 0 0.75rem;
}
.tx-input, .tx-select {
  background: rgb(var(--app-text) / 0.06);
  border: 1px solid rgb(var(--app-text) / 0.08);
  border-radius: 0.5rem;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  color: rgb(var(--app-text) / 0.85);
  outline: none;
}
.tx-input:focus, .tx-select:focus { border-color: rgb(var(--accent) / 0.6); }
.tx-select option { background: var(--bg-solid, #0c0c0c); }
.tx-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.65rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  color: rgb(var(--app-text) / 0.55);
  background: rgb(var(--app-text) / 0.05);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tx-chip:hover:not(:disabled) { color: rgb(var(--app-text) / 0.9); background: rgb(var(--app-text) / 0.09); }
.tx-chip:disabled { opacity: 0.35; cursor: default; }
.tx-chip-on { color: rgb(var(--accent)); background: rgb(var(--accent) / 0.15); }
/* An on/off switch that's on: unmistakably filled */
.tx-chip.tx-chip-solid,
.tx-chip.tx-chip-solid:hover:not(:disabled) { color: #fff; background: rgb(var(--accent)); }
.tx-chip.tx-chip-solid:hover:not(:disabled) { filter: brightness(1.1); }
.tx-icon-btn {
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.5rem;
  font-size: 1rem;
  color: rgb(var(--app-text) / 0.55);
  background: rgb(var(--app-text) / 0.05);
}
.tx-icon-btn:hover { color: rgb(var(--app-text) / 0.9); background: rgb(var(--app-text) / 0.09); }
</style>
