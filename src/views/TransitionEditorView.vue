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
          @click="previewing ? stopPreview() : startPreview()"
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          :class="previewing ? 'bg-white/[0.12] text-white' : 'bg-accent hover:bg-accent-hover text-white'"
          title="Space"
        >
          <svg v-if="!previewing" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
          {{ previewing ? 'Stop' : 'Play transition' }}
        </button>
        <select v-model.number="preRoll" class="tx-select" title="How much of FROM to hear first">
          <option :value="5">from −5 s</option>
          <option :value="10">from −10 s</option>
          <option :value="20">from −20 s</option>
        </select>
        <label class="tx-chip" :class="loop ? 'tx-chip-on' : ''">
          <input type="checkbox" v-model="loop" class="hidden" /> Loop
        </label>
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
        <label class="tx-chip" :class="snap ? 'tx-chip-on' : ''" title="Snap handles to beats (hold Alt while dragging to override)">
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
      />
      <p class="text-[11px] text-white/25 mt-2">
        Drag the lower waveform to line TO up with FROM · drag the solid line to move the exit, the dashed line to set the overlap,
        the diamond for the bass swap · drag the top lane to scroll, wheel to zoom · ←/→ nudge TO by 10 ms (Alt: 1 ms) · Space plays
      </p>

      <!-- Controls -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
        <!-- Shape -->
        <section class="tx-card">
          <h2 class="tx-card-title">Shape</h2>
          <div class="flex rounded-lg overflow-hidden border border-white/[0.08] mb-4">
            <button
              v-for="opt in typeOptions"
              :key="opt.value"
              @click="update({ type: opt.value })"
              class="flex-1 px-3 py-2 text-sm transition-colors"
              :class="draft.type === opt.value ? 'bg-accent/20 text-accent' : 'text-white/50 hover:text-white/80'"
            >{{ opt.label }}</button>
          </div>

          <div v-if="draft.type !== 'cut'" class="tx-row">
            <span class="tx-label">Overlap</span>
            <input type="number" min="0.05" step="0.1" class="tx-input w-24" :value="round(draft.overlap, 3)"
              @change="update({ overlap: clampOverlap(+($event.target as HTMLInputElement).value) })" />
            <span class="text-xs text-white/40">s</span>
            <span v-if="fromBeat" class="text-xs text-white/40 tabular-nums">{{ round(draft.overlap / fromBeat, 1) }} beats</span>
          </div>
          <div v-if="draft.type !== 'cut' && fromBeat" class="flex gap-1.5 mb-3 ml-[88px]">
            <button v-for="b in [4, 8, 16, 32]" :key="b" class="tx-chip" @click="update({ overlap: clampOverlap(b * fromBeat!) })">{{ b }}</button>
          </div>

          <div v-if="draft.type !== 'cut'" class="tx-row">
            <span class="tx-label">Fade out</span>
            <select class="tx-select flex-1" :value="draft.fadeOut" @change="update({ fadeOut: ($event.target as HTMLSelectElement).value as CurvePreset })">
              <option v-for="c in curveOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>
          <div v-if="draft.type !== 'cut'" class="tx-row">
            <span class="tx-label">Fade in</span>
            <select class="tx-select flex-1" :value="draft.fadeIn" @change="update({ fadeIn: ($event.target as HTMLSelectElement).value as CurvePreset })">
              <option v-for="c in curveOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>

          <template v-if="draft.type === 'echo-out'">
            <div class="tx-row">
              <span class="tx-label">Echo</span>
              <select v-if="fromBeat" class="tx-select flex-1" :value="echoBeats" @change="setEchoBeats(+($event.target as HTMLSelectElement).value)">
                <option v-for="b in echoBeatOptions" :key="b.value" :value="b.value">{{ b.label }}</option>
              </select>
              <template v-else>
                <input type="number" min="0.05" max="2" step="0.01" class="tx-input w-24" :value="round(echo.delay, 3)"
                  @change="update({ echo: { ...echo, delay: +($event.target as HTMLInputElement).value } })" />
                <span class="text-xs text-white/40">s</span>
              </template>
            </div>
            <div class="tx-row">
              <span class="tx-label">Feedback</span>
              <input type="range" min="0" max="0.9" step="0.05" class="flex-1 accent-accent" :value="echo.feedback"
                @input="update({ echo: { ...echo, feedback: +($event.target as HTMLInputElement).value } })" />
              <span class="text-xs text-white/50 tabular-nums w-10 text-right">{{ Math.round(echo.feedback * 100) }}%</span>
            </div>
          </template>

          <button class="tx-chip mt-2" :disabled="!fromGrid" @click="applySuggestion(true)"
            title="Exit on a phrase boundary near FROM's end, enter on TO's first downbeat, match tempo">
            Suggest from beats
          </button>
        </section>

        <!-- Timing -->
        <section class="tx-card">
          <h2 class="tx-card-title">Timing</h2>
          <div class="tx-row">
            <span class="tx-label">Exit FROM at</span>
            <input type="number" min="0" step="0.001" class="tx-input w-28" :value="round(draft.exitAt, 3)"
              @change="setExit(+($event.target as HTMLInputElement).value)" />
            <span class="text-xs text-white/40 tabular-nums">{{ formatTime(draft.exitAt) }}</span>
          </div>
          <div class="tx-row">
            <span class="tx-label">Enter TO at</span>
            <input type="number" min="0" step="0.001" class="tx-input w-28" :value="round(draft.entryAt, 3)"
              @change="update({ entryAt: clampEntry(+($event.target as HTMLInputElement).value) })" />
            <span class="text-xs text-white/40 tabular-nums">{{ formatTime(draft.entryAt) }}</span>
          </div>
          <div class="tx-row">
            <span class="tx-label">Nudge TO</span>
            <div class="flex gap-1">
              <button class="tx-chip" title="TO 10 ms earlier" @click="nudge(-0.01)">−10ms</button>
              <button class="tx-chip" title="TO 1 ms earlier" @click="nudge(-0.001)">−1</button>
              <button class="tx-chip" title="TO 1 ms later" @click="nudge(0.001)">+1</button>
              <button class="tx-chip" title="TO 10 ms later" @click="nudge(0.01)">+10ms</button>
            </div>
          </div>

          <div class="border-t border-white/[0.06] my-3" />

          <div class="tx-row">
            <span class="tx-label">Tempo</span>
            <span class="text-xs text-white/50 tabular-nums">
              FROM {{ fromGrid?.bpm ? fromGrid.bpm.toFixed(2) : '—' }} · TO {{ toGrid?.bpm ? toGrid.bpm.toFixed(2) : '—' }} BPM
            </span>
          </div>
          <div class="tx-row" :class="draft.type === 'cut' ? 'opacity-40 pointer-events-none' : ''">
            <span class="tx-label">TO speed</span>
            <input type="range" :min="-MAX_RATE_DEVIATION * 100" :max="MAX_RATE_DEVIATION * 100" step="0.01" class="flex-1 accent-accent"
              :value="ratePercent" @input="setRatePercent(+($event.target as HTMLInputElement).value)" />
            <span class="text-xs text-white/60 tabular-nums w-14 text-right">{{ ratePercent >= 0 ? '+' : '' }}{{ ratePercent.toFixed(2) }}%</span>
          </div>
          <div class="flex items-center gap-2 ml-[88px] mb-1" :class="draft.type === 'cut' ? 'opacity-40 pointer-events-none' : ''">
            <button class="tx-chip" :disabled="!canMatchTempo" @click="matchTempo">Match tempo</button>
            <button class="tx-chip" @click="update({ rateTo: undefined })">Reset</button>
            <span v-if="toGrid?.bpm" class="text-[11px] text-white/30 tabular-nums">TO plays at {{ (toGrid.bpm * rate).toFixed(2) }} BPM</span>
          </div>
          <p v-if="tempoTooFar" class="text-[11px] text-amber-300/70 ml-[88px]">
            Tempos differ by more than 3%; v1 only nudges up to ±3% (it changes pitch slightly).
          </p>
        </section>

        <!-- EQ / filter -->
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
            <span v-if="draft.bassSwap" class="text-xs text-white/50 tabular-nums">
              at {{ round(draft.bassSwap.at, 2) }} s<template v-if="fromBeat"> · beat {{ round(draft.bassSwap.at / fromBeat, 1) }}</template>
            </span>
          </div>
          <p class="text-[11px] text-white/30 mb-3 ml-[88px]">TO's lows stay out until the swap, then FROM's go.</p>

          <div class="tx-row">
            <span class="tx-label">Filter</span>
            <select class="tx-select flex-1" :value="filterKey" @change="setFilterKey(($event.target as HTMLSelectElement).value)">
              <option value="none">None</option>
              <option value="from-highpass">FROM high-pass (thin it out)</option>
              <option value="from-lowpass">FROM low-pass (muffle it)</option>
              <option value="to-highpass">TO high-pass (bring lows in)</option>
              <option value="to-lowpass">TO low-pass (open it up)</option>
            </select>
          </div>
          <template v-if="draft.filter">
            <div class="tx-row">
              <span class="tx-label">From</span>
              <input type="range" min="0" max="1" step="0.001" class="flex-1 accent-accent" :value="hzToSlider(draft.filter.startHz)"
                @input="update({ filter: { ...draft.filter!, startHz: sliderToHz(+($event.target as HTMLInputElement).value) } })" />
              <span class="text-xs text-white/50 tabular-nums w-16 text-right">{{ formatHz(draft.filter.startHz) }}</span>
            </div>
            <div class="tx-row">
              <span class="tx-label">To</span>
              <input type="range" min="0" max="1" step="0.001" class="flex-1 accent-accent" :value="hzToSlider(draft.filter.endHz)"
                @input="update({ filter: { ...draft.filter!, endHz: sliderToHz(+($event.target as HTMLInputElement).value) } })" />
              <span class="text-xs text-white/50 tabular-nums w-16 text-right">{{ formatHz(draft.filter.endHz) }}</span>
            </div>
          </template>
        </section>
      </div>

      <!-- Test in the real player -->
      <div class="mt-5 flex items-center gap-3">
        <button class="tx-chip" @click="audition" :disabled="!existing || dirty" :title="dirty ? 'Save first' : ''">
          Test in the player
        </button>
        <span class="text-[11px] text-white/30">
          Plays FROM from 12 s before the exit with TO queued next, through the real playback engine.
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
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useTransitionsStore } from '@/stores/transitions'
import { useToast } from '@/composables/useToast'
import { songKey } from '@/utils/smartPlaylistMatcher'
import { formatTime } from '@/utils/formatTime'
import { decodeWindow, type PreviewHandle, type PreviewSolo } from '@/utils/transitions/engine'
import { PeakPyramid } from '@/utils/transitions/peaks'
import { getBeatGrid } from '@/utils/transitions/analysis'
import { suggestTransition } from '@/utils/transitions/suggest'
import { moveExit, slideTo } from '@/utils/transitions/timeline'
import { clampRate, MAX_RATE_DEVIATION, DEFAULT_ECHO, type TransitionTiming } from '@/utils/transitions/schedule'
import type { Transition, TransitionEndpoint, BeatGrid, CurvePreset, TransitionType } from '@/types/transition'
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

const TIMING_KEYS = ['type', 'exitAt', 'entryAt', 'overlap', 'fadeOut', 'fadeIn', 'bassSwap', 'filter', 'echo', 'rateTo'] as const

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
const typeOptions: { value: TransitionType; label: string }[] = [
  { value: 'blend', label: 'Blend' },
  { value: 'cut', label: 'Cut' },
  { value: 'echo-out', label: 'Echo out' },
]
const curveOptions: { value: CurvePreset; label: string }[] = [
  { value: 'equal-power', label: 'Equal power (smooth)' },
  { value: 'linear', label: 'Linear' },
  { value: 's-curve', label: 'S-curve (late swap)' },
]
const soloOptions: { value: PreviewSolo; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'from', label: 'FROM' },
  { value: 'to', label: 'TO' },
]
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
const rate = computed(() => (draft.value?.type === 'cut' ? 1 : clampRate(draft.value?.rateTo)))
const ratePercent = computed(() => (rate.value - 1) * 100)
const tempoRatio = computed(() => {
  const f = usable(fromGrid.value), t = usable(toGrid.value)
  return f && t ? f.bpm / t.bpm : null
})
const canMatchTempo = computed(() => tempoRatio.value !== null && Math.abs(tempoRatio.value - 1) <= MAX_RATE_DEVIATION)
const tempoTooFar = computed(() => tempoRatio.value !== null && Math.abs(tempoRatio.value - 1) > MAX_RATE_DEVIATION)
const echo = computed(() => draft.value?.echo ?? { ...DEFAULT_ECHO })
const echoBeats = computed(() => {
  if (!fromBeat.value) return 0.75
  const beats = echo.value.delay / fromBeat.value
  return echoBeatOptions.reduce((best, o) => (Math.abs(o.value - beats) < Math.abs(best - beats) ? o.value : best), 0.75)
})
const filterKey = computed(() => (draft.value?.filter ? `${draft.value.filter.target}-${draft.value.filter.kind}` : 'none'))

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
    errorMessage.value = `Couldn't decode the audio: ${err}`
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
  if (!existing.value && !touched) applySuggestion(false)
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
  return Math.max(0.05, Math.min(isFinite(v) ? v : 8, fromDuration.value - d.exitAt))
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

/** Positive = TO heard later against FROM */
function nudge(seconds: number) {
  const d = draft.value
  if (!d) return
  update({ entryAt: clampEntry(slideTo(timingOf(d), seconds)) })
}

function setRatePercent(pct: number) {
  const r = 1 + pct / 100
  update({ rateTo: Math.abs(r - 1) < 1e-5 ? undefined : r })
}

function matchTempo() {
  if (tempoRatio.value !== null) update({ rateTo: clampRate(tempoRatio.value) })
}

function toggleBassSwap() {
  const d = draft.value!
  if (d.bassSwap) { update({ bassSwap: undefined }); return }
  let at = d.overlap / 2
  if (fromBeat.value) at = Math.round(at / fromBeat.value) * fromBeat.value
  update({ bassSwap: { at: Math.min(at, d.overlap) } })
}

function setEchoBeats(beats: number) {
  if (fromBeat.value) update({ echo: { ...echo.value, delay: beats * fromBeat.value } })
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
  const keepType = draft.value.type
  for (const k of ['bassSwap', 'rateTo'] as const) delete draft.value[k]
  Object.assign(draft.value, s)
  if (userAsked) draft.value.type = keepType
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
const previewing = computed(() => !!preview.value)
const playhead = ref<number | null>(null)
const preRoll = ref(10)
const loop = ref(false)
const solo = ref<PreviewSolo>('both')
let rafId = 0

function startPreview() {
  const d = draft.value
  if (!d || !fromBuf.value || !toBuf.value) return
  stopPreview()
  const exitAt = d.exitAt
  const handle = player.previewTransition({ from: fromBuf.value, to: toBuf.value }, timingOf(d), {
    preRoll: preRoll.value,
    postRoll: 5,
    solo: solo.value,
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
    playhead.value = exitAt + (ctx.currentTime - handle.t0)
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopPreview() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  preview.value?.stop()
  preview.value = null
  playhead.value = null
}

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
    previewing.value ? stopPreview() : startPreview()
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

onBeforeRouteLeave(async () => {
  stopPreview()
  if (!dirty.value || status.value !== 'ready') return true
  showLeave.value = true
  return new Promise<boolean>(resolve => { leaveResolver = resolve })
})
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
