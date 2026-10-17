<template>
  <div class="p-6 pb-10 max-w-6xl mx-auto">
    <!-- Header -->
    <div class="flex items-center gap-4 mb-4 flex-wrap">
      <button @click="router.push('/lights')" class="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.1] text-white/60 shrink-0" title="All light shows">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <div class="w-12 h-12 rounded-lg overflow-hidden bg-white/10 shrink-0">
        <img v-if="track?.coverArt" :src="mediaUrl(track.coverArt)" class="w-full h-full object-cover" />
      </div>
      <div class="min-w-0 flex-1">
        <h1 class="text-xl font-bold text-white truncate">{{ draft?.title ?? track?.title ?? 'Light show' }}</h1>
        <p class="text-sm text-white/45 truncate">
          {{ draft?.artist ?? track?.artist }}
          <template v-if="draft"> · {{ bpm }} BPM · {{ fmt(draft.duration) }} · {{ bars }} bars</template>
        </p>
      </div>
      <span v-if="draft?.needsReview" class="px-2 py-1 rounded-md text-xs bg-amber-500/15 text-amber-300/90">Needs review: the file changed, check and save</span>
      <button v-if="draft" class="lt-chip" :disabled="saving || (!dirty && !draft.needsReview)" @click="save" :class="{ 'lt-primary': dirty || draft.needsReview }">{{ saving ? 'Saving…' : dirty || draft.needsReview ? 'Save' : 'Saved' }}</button>
      <span class="flex items-center gap-1.5 text-xs text-white/50 px-2.5 py-1 rounded-full bg-white/[0.05]">
        <span class="w-1.5 h-1.5 rounded-full" :class="lights.enabled && lights.connected.length ? 'bg-green-400' : 'bg-white/25'" />
        {{ lights.enabled ? (lights.connected.length ? `Live on ${lights.connected.length} lights` : 'Lights connecting…') : 'Light sync is off (Settings → Integrations)' }}
      </span>
    </div>

    <div v-if="status === 'loading'" class="py-24 text-center text-white/40 text-sm">Listening to the song: finding its beats and energy…</div>
    <div v-else-if="status === 'missing'" class="py-24 text-center text-white/40 text-sm">This song isn't in your library any more.</div>

    <template v-else-if="draft">
      <!-- Transport + tools -->
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <button
          @click="togglePlay"
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          :class="playing ? 'bg-white/[0.12] text-white' : 'bg-accent hover:bg-accent-hover text-white'"
          title="Space"
        >
          <svg v-if="!playing" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          {{ playing ? 'Pause' : 'Play' }}
        </button>
        <span class="text-xs text-white/50 tabular-nums font-mono w-36">{{ timeLabel }}</span>
        <button class="lt-tog" :class="{ on: draft.beatFlash }" @click="draft.beatFlash = !draft.beatFlash" title="Flash every light on each beat, on top of the looks">Beat flash</button>
        <button class="lt-tog" :class="{ on: perLight }" @click="perLight = !perLight" title="A lane per light: a block there overrides the room-wide look for that light">Show each light</button>
        <span class="flex-1" />
        <button class="lt-chip" @click="askSuggest" title="Split the song into sections by energy and give each one a look">Suggest</button>
        <button class="lt-chip" :disabled="!selBlock || !inChorus(selBlock)" @click="copyToChoruses" title="Use the selected block's look for every chorus">Copy to every chorus</button>
        <label class="flex items-center gap-2 text-xs text-white/40">Zoom
          <input type="range" min="10" max="56" v-model.number="pxBar" class="!w-24 accent-accent" />
        </label>
      </div>

      <!-- Timeline -->
      <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] overflow-hidden mb-4">
        <div ref="scrollRef" class="overflow-x-auto">
          <div class="relative select-none" :style="{ width: timelineWidth + 'px' }">
            <!-- Ruler -->
            <div class="relative h-6 border-b border-white/[0.06] cursor-pointer" @click="seekFromEvent">
              <div v-for="b in rulerBars" :key="b" class="absolute top-0 bottom-0 border-l border-white/[0.08] pl-1 pt-1 text-[10px] font-mono text-white/35" :style="{ left: X(b) + 'px' }">{{ b + 1 }}</div>
              <template v-if="pxBar >= 30">
                <div v-for="k in beatDots" :key="'d' + k" class="absolute bottom-1 w-[3px] h-[3px] -ml-[1.5px] rounded-full bg-white/30" :style="{ left: X(k / 4) + 'px' }" />
              </template>
            </div>
            <!-- Sections -->
            <div class="relative h-6 border-b border-white/[0.06] cursor-pointer" @click="seekFromEvent">
              <div
                v-for="s in draft.sections" :key="s.start"
                class="absolute top-1 bottom-1 rounded-md px-2 text-[11px] font-semibold truncate"
                :class="s.name === 'Chorus' ? 'bg-accent/20 text-accent' : 'bg-white/[0.05] text-white/50'"
                :style="{ left: X(s.start) + 2 + 'px', width: s.len * pxBar - 4 + 'px' }"
              >{{ s.name }}</div>
            </div>
            <!-- Waveform + energy -->
            <div class="relative h-16 border-b border-white/[0.06] cursor-pointer" @click="seekFromEvent">
              <canvas ref="waveRef" class="absolute inset-0 h-full" :style="{ width: timelineWidth + 'px' }" />
            </div>
            <!-- Look lanes -->
            <div
              v-for="lane in lanes" :key="lane.target"
              class="lt-lane relative border-b border-white/[0.06]"
              :class="lane.target === 'all' ? 'h-[52px]' : 'h-9'"
              :data-target="lane.target"
              @dblclick="addBlock($event, lane.target)"
            >
              <span class="lt-label">{{ lane.label }}</span>
              <span v-if="lane.target === 'all' && !draft.blocks.length" class="absolute left-20 top-1/2 -translate-y-1/2 text-[11px] text-white/30 pointer-events-none">Double-click to add a look, or press Suggest</span>
              <div
                v-for="b in blocksIn(lane.target)" :key="b.id"
                class="lt-block absolute rounded-lg overflow-hidden border flex items-center touch-none cursor-grab"
                :class="[sel?.kind === 'block' && sel.id === b.id ? 'border-white ring-2 ring-accent' : 'border-white/15', lane.target === 'all' ? 'top-1.5 bottom-1.5' : 'top-1 bottom-1']"
                :style="{ left: X(b.start) + 'px', width: b.len * pxBar + 'px' }"
                @pointerdown="dragBlock($event, b)"
              >
                <div class="absolute inset-0 opacity-50" :style="{ background: blockFill(b) }" />
                <div class="relative px-2 text-[11.5px] font-semibold text-white truncate flex gap-1.5 items-baseline" style="text-shadow: 0 1px 2px rgba(0,0,0,.6)">
                  {{ b.look.name }}<small class="font-medium text-white/75">{{ motionLabel(b.look) }}</small>
                </div>
                <div class="lt-h absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize" data-edge="l" />
                <div class="lt-h absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize" data-edge="r" />
              </div>
            </div>
            <!-- Accents -->
            <div class="relative h-8" @dblclick="addAccent">
              <span class="lt-label">Accents</span>
              <button
                v-for="a in draft.accents" :key="a.id"
                class="absolute top-1.5 w-5 h-5 -ml-2.5 rounded-md border border-white/20 bg-white/[0.08] text-[11px] flex items-center justify-center"
                :class="{ 'ring-2 ring-accent': sel?.kind === 'accent' && sel.id === a.id }"
                :style="{ left: X(a.beat / 4) + 'px', color: a.type === 'hit' ? a.colour : undefined }"
                :title="accentNames[a.type]"
                @click.stop="sel = { kind: 'accent', id: a.id }"
                @dblclick.stop
              >
                <svg v-if="a.type === 'flash'" class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z" /></svg>
                <svg v-else-if="a.type === 'blackout'" class="w-2.5 h-2.5" viewBox="0 0 10 10"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
                <svg v-else class="w-2.5 h-2.5" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor" /></svg>
              </button>
            </div>
            <!-- Playhead -->
            <div class="absolute top-0 bottom-0 w-0.5 -ml-px bg-white pointer-events-none shadow-[0_0_8px_rgba(255,255,255,.6)]" :style="{ left: X(barAt(pos)) + 'px' }" />
          </div>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <!-- Room -->
        <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
          <h2 class="lt-h2">Room</h2>
          <RoomMap :colours="roomColours" :on="bulbNames" :focus="focusBulb" @pick="pickBulb" />
          <p class="text-xs text-white/35 mt-2">Top, Middle and Bottom are the arc lamp; Fan 1 and Fan 2 the ceiling fan. Lights that are off in Settings aren't part of the show. Click a light to pick its colour.</p>
        </div>

        <!-- Inspector -->
        <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 min-w-0">
          <template v-if="selBlock">
            <h2 class="lt-h2">{{ selBlock.target === 'all' ? 'Look' : `${labelOf(selBlock.target)} only` }} · bars {{ selBlock.start + 1 }}–{{ selBlock.start + selBlock.len }}</h2>
            <div class="lt-row">
              <label class="lt-k" for="lookName">Name</label>
              <input id="lookName" v-model="selBlock.look.name" class="px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/85 outline-none focus:border-accent/50 min-w-0" />
            </div>
            <div class="lt-row">
              <span class="lt-k">Motion</span>
              <div class="flex flex-wrap gap-1">
                <button v-for="m in MOTIONS" :key="m.id" class="lt-seg" :class="{ on: selBlock.look.motion === m.id }" @click="selBlock.look.motion = m.id">{{ m.label }}</button>
              </div>
            </div>
            <div class="lt-row">
              <span class="lt-k">Speed</span>
              <div class="flex flex-wrap gap-1 items-center">
                <button class="lt-seg" :class="{ on: !selBlock.look.half }" @click="selBlock.look.half = false">Every beat</button>
                <button class="lt-seg" :class="{ on: selBlock.look.half }" @click="selBlock.look.half = true">Half time</button>
                <span class="ml-1 text-xs px-2 py-0.5 rounded-full" :class="rate <= MAX_CHANGES_PER_SECOND ? 'text-green-400 bg-green-400/10' : 'text-amber-300 bg-amber-400/10'" title="The bulbs keep up with about 5 changes a second each">
                  {{ rate === 0 ? 'Steady' : `${rate.toFixed(1)} changes/s per light` }}{{ rate > MAX_CHANGES_PER_SECOND ? ' · too fast, try half time' : '' }}
                </span>
              </div>
            </div>
            <div class="lt-row">
              <span class="lt-k">Brightness</span>
              <div class="space-y-1">
                <div class="flex items-center gap-2"><input type="range" min="5" max="100" :value="selBlock.look.lo" @input="setLo(+($event.target as HTMLInputElement).value)" class="flex-1 accent-accent" /><span class="text-xs text-white/50 font-mono w-16 text-right">low {{ selBlock.look.lo }}%</span></div>
                <div class="flex items-center gap-2"><input type="range" min="5" max="100" :value="selBlock.look.hi" @input="setHi(+($event.target as HTMLInputElement).value)" class="flex-1 accent-accent" /><span class="text-xs text-white/50 font-mono w-16 text-right">high {{ selBlock.look.hi }}%</span></div>
              </div>
            </div>
            <div class="lt-row">
              <span class="lt-k">Colours</span>
              <div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="n in swatchBulbs" :key="n"
                    class="flex flex-col items-center gap-1"
                    @click="focusBulb = n"
                  >
                    <i class="block w-7 h-7 rounded-lg border border-white/25" :class="{ 'ring-2 ring-accent ring-offset-2 ring-offset-black': focusBulb === n }" :style="{ background: colourOf(selBlock, n) }" />
                    <span class="text-[10px] text-white/40">{{ labelOf(n) }}</span>
                  </button>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 mt-2.5">
                  <span class="text-[11px] text-white/40 mr-1">{{ selBlock.target === 'all' ? labelOf(focusBulb ?? '') : 'Colour' }} →</span>
                  <button v-for="c in swatchColours" :key="c" class="w-5 h-5 rounded-full border border-white/30" :style="{ background: c }" :title="c" @click="setColour(c)" />
                  <input type="color" :value="colourOf(selBlock, focusBulb ?? '')" @input="setColour(($event.target as HTMLInputElement).value)" class="w-7 h-6 bg-transparent" title="Any colour" />
                  <button v-if="selBlock.target === 'all'" class="lt-chip !py-0.5 !text-[11px]" @click="allSame">Use for all</button>
                </div>
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5 pt-3">
              <button class="lt-chip" @click="saveLook">Save to looks</button>
              <button class="lt-chip" @click="split">Split at playhead</button>
              <button class="lt-chip hover:!text-red-400" @click="deleteSelected">Delete</button>
            </div>
          </template>

          <template v-else-if="selAccent">
            <h2 class="lt-h2">Accent · bar {{ Math.floor(selAccent.beat / 4) + 1 }}, beat {{ (selAccent.beat % 4) + 1 }}</h2>
            <div class="lt-row">
              <span class="lt-k">Type</span>
              <div class="flex flex-wrap gap-1">
                <button v-for="(n, k) in accentNames" :key="k" class="lt-seg" :class="{ on: selAccent.type === k }" @click="setAccentType(k)">{{ n }}</button>
              </div>
            </div>
            <div v-if="selAccent.type === 'hit'" class="lt-row">
              <span class="lt-k">Colour</span>
              <div class="flex flex-wrap items-center gap-1.5">
                <button v-for="c in swatchColours" :key="c" class="w-5 h-5 rounded-full border border-white/30" :style="{ background: c }" @click="selAccent.colour = c" />
                <input type="color" :value="selAccent.colour ?? '#ffffff'" @input="selAccent.colour = ($event.target as HTMLInputElement).value" class="w-7 h-6 bg-transparent" />
              </div>
            </div>
            <p class="text-xs text-white/40 mt-2">{{ accentHelp[selAccent.type] }}</p>
            <div class="pt-3"><button class="lt-chip hover:!text-red-400" @click="deleteSelected">Delete accent</button></div>
          </template>

          <template v-else>
            <h2 class="lt-h2">Inspector</h2>
            <p class="text-sm text-white/35 py-6">Select a block or an accent on the timeline to edit it. Double-click a lane to add a block, or the Accents lane to add a flash.</p>
          </template>
        </div>
      </div>

      <!-- Saved looks -->
      <div class="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 mt-4">
        <h2 class="lt-h2">Looks</h2>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(l, i) in libraryLooks" :key="i"
            class="group flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-xs text-white/65 hover:text-white"
            :title="selBlock ? 'Use on the selected block' : 'Select a block first'"
            @click="applyLook(l)"
          >
            <span class="flex"><b v-for="(c, j) in previewColours(l)" :key="j" class="block w-2.5 h-3.5 first:rounded-l last:rounded-r" :style="{ background: c }" /></span>
            {{ l.name }} · {{ motionLabel(l) }}
            <span v-if="i >= builtInLooks.length" class="hidden group-hover:inline text-white/40 hover:text-red-400" title="Remove from saved looks" @click.stop="removeLook(i - builtInLooks.length)">✕</span>
          </button>
        </div>
        <p class="text-xs text-white/35 mt-2">The first few come from this song's cover. Looks you save are shared by every show.</p>
      </div>

      <div class="flex flex-wrap gap-4 text-xs text-white/35 mt-4">
        <span><kbd class="lt-kbd">Space</kbd> play / pause</span>
        <span>Drag a block to move it, its edges to resize (snaps to bars)</span>
        <span><kbd class="lt-kbd">Delete</kbd> removes the selection</span>
        <button v-if="existing" class="ml-auto text-white/35 hover:text-red-400" @click="showDelete = true">Delete this show</button>
      </div>
    </template>

    <ConfirmDialog :show="showSuggest" title="Replace this show?" message="Suggest lays out a fresh draft from the song's energy and replaces the blocks and accents you have." confirm-label="Replace" @confirm="doSuggest" @cancel="showSuggest = false" />
    <ConfirmDialog :show="showDelete" title="Delete light show?" :message="`${draft?.title ?? 'This song'} will go back to the automatic lights.`" confirm-label="Delete" variant="danger" @confirm="doDelete" @cancel="showDelete = false" />
    <ConfirmDialog :show="showLeave" title="Leave without saving?" message="Your changes to this light show will be lost." confirm-label="Leave" variant="danger" @confirm="resolveLeave(true)" @cancel="resolveLeave(false)" />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useLightShowsStore } from '@/stores/lightShows'
import { useLightsStore } from '@/stores/lights'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useToast } from '@/composables/useToast'
import { songKey } from '@/utils/smartPlaylistMatcher'
import { analyseSong, PEAK_STEP, type SongAnalysis } from '@/utils/lights/analyse'
import {
  MOTIONS, MAX_CHANGES_PER_SECOND, changesPerSecond, timingFromGrid, barsIn, showFrame, barEnergy,
  detectSections, suggestShow, paletteLook, lookColour, lightId,
} from '@/utils/lights/handmade'
import { ROOM_LIGHTS } from '@/utils/lights/room'
import type { LightShow, LightBlock, LightAccent, LightLook, LightAccentType } from '@/types/lightShow'
import type { RGB } from '@/utils/lights/govee'
import RoomMap from '@/components/lights/RoomMap.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const store = useLightShowsStore()
const lights = useLightsStore()
const library = useLibraryStore()
const player = usePlayerStore()
const toast = useToast()
const mediaUrl = (p: string) => window.api.getMediaUrl(p)

// ── Loading ──────────────────────────────────────────────────────────────────
const status = ref<'loading' | 'ready' | 'missing'>('loading')
const track = shallowRef<Track | null>(null)
const analysis = shallowRef<SongAnalysis | null>(null)
const existing = shallowRef<LightShow | null>(null)
const draft = ref<LightShow | null>(null)
const dirty = ref(false)
const saving = ref(false)
let loadToken = 0

async function load() {
  const token = ++loadToken
  status.value = 'loading'
  draft.value = null
  existing.value = null
  sel.value = null
  if (!store.loaded) await store.load()
  const show = typeof route.query.id === 'string' ? store.getById(route.query.id) : null
  const t = show
    ? library.tracks.find(x => x.path === show.path) ?? library.tracks.find(x => songKey(x) === show.key) ?? null
    : library.tracks.find(x => x.id === route.query.track) ?? null
  track.value = t
  if (!t) { status.value = 'missing'; return }
  const a = await analyseSong(t)
  if (token !== loadToken) return
  analysis.value = a
  if (show) {
    existing.value = show
    draft.value = JSON.parse(JSON.stringify(show))
    // The file changed length: the bars may have moved
    if (a && Math.abs(a.duration - show.duration) > 1) draft.value!.needsReview = true
    dirty.value = false
  } else {
    const timing = a?.grid ? timingFromGrid(a.grid) : { origin: 0, period: 0.5 }
    draft.value = {
      id: lightId(), key: songKey(t), path: t.path, title: t.title, artist: t.artist,
      duration: a?.duration ?? t.duration, ...timing,
      blocks: [], accents: [], sections: [], beatFlash: true, needsReview: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    doSuggest()
    if (!a?.grid) toast.error('Couldn\'t find a steady beat in this song: bars are a guess at 120 BPM.')
  }
  // Park the playhead on the selected block so the room map shows something
  const first = selBlock.value ?? draft.value?.blocks[0]
  if (first && !isCurrent.value) pos.value = draft.value!.origin + (first.start + 0.1) * draft.value!.period * 4
  status.value = 'ready'
  await nextTick()
  // A new show starts unsaved
  if (!show) dirty.value = true
  drawWave()
}

onMounted(load)
watch(() => [route.query.id, route.query.track], () => { if (route.path === '/lights/edit') load() })

// Unsaved edits play on the real lights while editing
watch(draft, (d, old) => {
  lights.setDraft(d)
  if (d && old && d === old) dirty.value = true
}, { deep: true })
onBeforeUnmount(() => lights.setDraft(null))

// ── Bulbs ────────────────────────────────────────────────────────────────────
const bulbNames = computed(() => lights.bulbs.filter(b => b.on).map(b => b.name))
const labelOf = (name: string) => lights.bulbs.find(b => b.name === name)?.label ?? ROOM_LIGHTS.find(l => l.name === name)?.label ?? name
const perLight = ref(false)
const lanes = computed(() => [
  { target: 'all', label: perLight.value ? 'All lights' : 'Looks' },
  ...(perLight.value ? bulbNames.value.map(n => ({ target: n, label: labelOf(n) })) : []),
])
const focusBulb = ref<string | null>(null)
watch(bulbNames, n => { if (!focusBulb.value || !n.includes(focusBulb.value)) focusBulb.value = n[0] ?? null }, { immediate: true })

// ── Geometry ─────────────────────────────────────────────────────────────────
const pxBar = ref(22)
const scrollRef = ref<HTMLElement>()
const waveRef = ref<HTMLCanvasElement>()
const barSec = computed(() => (draft.value?.period ?? 0.5) * 4)
const lead = computed(() => (draft.value?.origin ?? 0) / barSec.value)
const bars = computed(() => (draft.value ? barsIn(draft.value) : 0))
const bpm = computed(() => (draft.value ? Math.round(60 / draft.value.period) : 0))
const X = (bar: number) => (bar + lead.value) * pxBar.value
const barAt = (t: number) => (t - (draft.value?.origin ?? 0)) / barSec.value
const timelineWidth = computed(() => Math.ceil(X(bars.value) + 12))
const rulerBars = computed(() => { const step = pxBar.value < 18 ? 8 : 4; return Array.from({ length: Math.ceil(bars.value / step) }, (_, i) => i * step) })
const beatDots = computed(() => Array.from({ length: bars.value * 4 }, (_, k) => k).filter(k => k % 4))

function drawWave() {
  const c = waveRef.value, a = analysis.value, d = draft.value
  if (!c || !d) return
  const W = timelineWidth.value, H = 64, dpr = Math.min(2, window.devicePixelRatio || 1)
  c.width = W * dpr; c.height = H * dpr
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  g.clearRect(0, 0, W, H)
  if (!a) return
  g.fillStyle = 'rgba(255,255,255,.28)'
  const w = Math.max(1, (PEAK_STEP / barSec.value) * pxBar.value * 0.8)
  for (let i = 0; i < a.peaks.length; i++) {
    const x = X(barAt(i * PEAK_STEP)), h = Math.max(0.5, a.peaks[i] * 29)
    g.fillRect(x, 32 - h, w, h * 2)
  }
  const per = barEnergy(a.energy, d.origin, d.period, bars.value)
  g.strokeStyle = 'rgba(154,107,255,.85)'
  g.lineWidth = 1.5
  g.beginPath()
  per.forEach((e, b) => { const x = X(b + 0.5), y = 60 - e * 50; b ? g.lineTo(x, y) : g.moveTo(x, y) })
  g.stroke()
}
watch([pxBar, () => draft.value?.origin], () => nextTick(drawWave))

// ── Playback (through Aurora's player, so the real lights follow) ────────────
const pos = ref(0)
let rafId = 0
const isCurrent = computed(() => !!track.value && player.currentTrack?.path === track.value.path)
const playing = computed(() => isCurrent.value && player.isPlaying)

function frameLoop() {
  if (isCurrent.value) pos.value = player.lightsClock().pos
  if (playing.value) {
    const sc = scrollRef.value, x = X(barAt(pos.value))
    if (sc && (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft)) sc.scrollLeft = x - 80
  }
  rafId = requestAnimationFrame(frameLoop)
}
onMounted(() => { rafId = requestAnimationFrame(frameLoop) })
onBeforeUnmount(() => cancelAnimationFrame(rafId))

async function togglePlay() {
  if (!track.value) return
  if (isCurrent.value) { player.togglePlay(); return }
  const at = pos.value
  await player.play(track.value)
  if (at > 0.5) player.seek(at)
}
function seek(t: number) {
  const d = draft.value
  if (!d) return
  pos.value = Math.max(0, Math.min(d.duration - 0.05, t))
  if (isCurrent.value) player.seek(pos.value)
}
function seekFromEvent(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const bar = (e.clientX - el.getBoundingClientRect().left) / pxBar.value - lead.value
  seek((draft.value?.origin ?? 0) + bar * barSec.value)
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const timeLabel = computed(() => {
  const d = draft.value
  if (!d) return ''
  const beat = Math.floor((pos.value - d.origin) / d.period)
  return beat < 0 ? `${fmt(pos.value)} · before bar 1` : `${fmt(pos.value)} · bar ${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}`
})

// The room map: the draft at the playhead
const roomColours = computed<Record<string, RGB>>(() => {
  const d = draft.value
  if (!d) return {}
  const names = bulbNames.value
  const f = showFrame(d, pos.value, names)
  return Object.fromEntries(names.map((n, i) => [n, f[i]]))
})

// ── Selection ────────────────────────────────────────────────────────────────
const sel = ref<{ kind: 'block' | 'accent'; id: string } | null>(null)
const selBlock = computed(() => (sel.value?.kind === 'block' ? draft.value?.blocks.find(b => b.id === sel.value!.id) ?? null : null))
const selAccent = computed(() => (sel.value?.kind === 'accent' ? draft.value?.accents.find(a => a.id === sel.value!.id) ?? null : null))
watch(selBlock, b => { if (b && b.target !== 'all') focusBulb.value = b.target })
const rate = computed(() => (selBlock.value && draft.value ? changesPerSecond(selBlock.value.look, draft.value.period) : 0))

const blocksIn = (target: string) => draft.value?.blocks.filter(b => b.target === target) ?? []
const motionLabel = (l: LightLook) => `${MOTIONS.find(m => m.id === l.motion)?.label ?? ''}${l.half ? ' ½' : ''}`
function blockFill(b: LightBlock) {
  const cols = b.target === 'all' ? bulbNames.value.map(n => lookColour(b.look, n, false)) : [b.look.colour, b.look.colour]
  return cols.length > 1 ? `linear-gradient(90deg, ${cols.join(',')})` : cols[0] ?? b.look.colour
}
const colourOf = (b: LightBlock, n: string) => lookColour(b.look, n, b.target !== 'all')
const swatchBulbs = computed(() => (selBlock.value?.target === 'all' ? bulbNames.value : selBlock.value ? [selBlock.value.target] : []))

// ── Editing blocks ───────────────────────────────────────────────────────────
function free(target: string, start: number, len: number, except?: LightBlock) {
  return blocksIn(target).every(o => o === except || start + len <= o.start || start >= o.start + o.len)
}

function dragBlock(e: PointerEvent, b: LightBlock) {
  sel.value = { kind: 'block', id: b.id }
  const edge = (e.target as HTMLElement).dataset.edge
  const el = e.currentTarget as HTMLElement
  const x0 = e.clientX, s0 = b.start, l0 = b.len
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    const d = Math.round((ev.clientX - x0) / pxBar.value)
    if (!edge) {
      const s = Math.max(0, Math.min(bars.value - l0, s0 + d))
      if (free(b.target, s, l0, b)) b.start = s
    } else if (edge === 'l') {
      const s = Math.max(0, Math.min(s0 + l0 - 1, s0 + d))
      if (free(b.target, s, s0 + l0 - s, b)) { b.len = s0 + l0 - s; b.start = s }
    } else {
      const l = Math.max(1, Math.min(bars.value - s0, l0 + d))
      if (free(b.target, s0, l, b)) b.len = l
    }
  }
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function addBlock(e: MouseEvent, target: string) {
  const d = draft.value
  if (!d || (e.target as HTMLElement).closest('.lt-block')) return
  const lane = e.currentTarget as HTMLElement
  const bar = Math.floor((e.clientX - lane.getBoundingClientRect().left) / pxBar.value - lead.value)
  if (bar < 0 || bar >= bars.value) return
  let len = 4
  while (len > 0 && !free(target, bar, len)) len--
  if (!len) return
  const look: LightLook = target === 'all'
    ? JSON.parse(JSON.stringify(builtInLooks.value[0]))
    : { ...paletteLook(`${labelOf(target)} solo`, palette.value, bulbNames.value, 'pulse', 20, 100), colour: palette.value[0] ?? '#ffffff' }
  const b: LightBlock = { id: lightId(), target, start: bar, len, look }
  d.blocks.push(b)
  sel.value = { kind: 'block', id: b.id }
}

function setLo(v: number) { const l = selBlock.value!.look; l.lo = Math.min(v, l.hi) }
function setHi(v: number) { const l = selBlock.value!.look; l.hi = Math.max(v, l.lo) }
function setColour(c: string) {
  const b = selBlock.value
  if (!b) return
  if (b.target !== 'all') { b.look.colour = c; return }
  if (focusBulb.value) b.look.colours[focusBulb.value] = c
}
function allSame() {
  const b = selBlock.value
  if (!b || !focusBulb.value) return
  const c = colourOf(b, focusBulb.value)
  b.look.colour = c
  for (const n of bulbNames.value) b.look.colours[n] = c
}
function pickBulb(name: string) {
  if (!bulbNames.value.includes(name)) return
  focusBulb.value = name
}
function split() {
  const b = selBlock.value, d = draft.value
  if (!b || !d) return
  const at = Math.round(barAt(pos.value))
  if (at <= b.start || at >= b.start + b.len) { toast.info('Move the playhead inside the block to split it'); return }
  d.blocks.push({ id: lightId(), target: b.target, start: at, len: b.start + b.len - at, look: JSON.parse(JSON.stringify(b.look)) })
  b.len = at - b.start
}
function deleteSelected() {
  const d = draft.value
  if (!d || !sel.value) return
  if (sel.value.kind === 'block') d.blocks = d.blocks.filter(b => b.id !== sel.value!.id)
  else d.accents = d.accents.filter(a => a.id !== sel.value!.id)
  sel.value = null
}

const inChorus = (b: LightBlock) => !!draft.value?.sections.some(s => s.name === 'Chorus' && b.start >= s.start && b.start < s.start + s.len)
function copyToChoruses() {
  const b = selBlock.value, d = draft.value
  if (!b || !d) return
  for (const s of d.sections) {
    if (s.name !== 'Chorus') continue
    d.blocks = d.blocks.filter(o => o === b || o.target !== b.target || o.start + o.len <= s.start || o.start >= s.start + s.len)
    if (!(b.start === s.start && b.len === s.len)) d.blocks.push({ id: lightId(), target: b.target, start: s.start, len: s.len, look: JSON.parse(JSON.stringify(b.look)) })
  }
  toast.success('Copied to every chorus')
}

// ── Accents ──────────────────────────────────────────────────────────────────
const accentNames: Record<LightAccentType, string> = { flash: 'White flash', blackout: 'Blackout', hit: 'Colour hit' }
const accentHelp: Record<LightAccentType, string> = {
  flash: 'Every light jumps to white and fades back over half a second.',
  blackout: 'Lights go dark for one beat. Good right before a drop.',
  hit: 'Every light takes one colour for a beat.',
}
function addAccent(e: MouseEvent) {
  const d = draft.value
  if (!d) return
  const el = e.currentTarget as HTMLElement
  const beat = Math.round(((e.clientX - el.getBoundingClientRect().left) / pxBar.value - lead.value) * 4)
  if (beat < 0) return
  const a: LightAccent = { id: lightId(), beat, type: 'flash' }
  d.accents.push(a)
  sel.value = { kind: 'accent', id: a.id }
}
function setAccentType(k: LightAccentType) {
  const a = selAccent.value
  if (!a) return
  a.type = k
  if (k === 'hit' && !a.colour) a.colour = swatchColours.value[0]
}

// ── Looks ────────────────────────────────────────────────────────────────────
const rgbHex = (c: RGB) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
const palette = computed(() => (analysis.value?.palette ?? []).map(rgbHex))
const swatchColours = computed(() => [...new Set([...palette.value, '#ffffff', '#ff9a4a'])])
const builtInLooks = computed<LightLook[]>(() => {
  const p = palette.value, n = bulbNames.value
  const rot = (k: number) => (p.length ? [...p.slice(k % p.length), ...p.slice(0, k % p.length)] : p)
  return [
    paletteLook('Cover glow', p, n, 'breathe', 35, 75),
    paletteLook('Chorus pulse', p, n, 'pulse', 30, 100),
    paletteLook('Calm', p, n, 'hold', 45, 45),
    paletteLook('Bar hits', rot(1), n, 'barhit', 35, 100),
    paletteLook('Room chase', rot(2), n, 'chase', 20, 90, true),
    paletteLook('Split hits', p, n, 'alternate', 25, 100),
  ]
})
const libraryLooks = computed(() => [...builtInLooks.value, ...store.looks])
const previewColours = (l: LightLook) => (bulbNames.value.slice(0, 4).map(n => lookColour(l, n, false)))
function applyLook(l: LightLook) {
  const b = selBlock.value
  if (!b) { toast.info('Select a block first'); return }
  b.look = JSON.parse(JSON.stringify(l))
}
async function saveLook() {
  const b = selBlock.value
  if (!b) return
  await store.saveLooks([...store.looks, JSON.parse(JSON.stringify(b.look))])
  toast.success(`Saved "${b.look.name}" to looks`)
}
async function removeLook(i: number) {
  await store.saveLooks(store.looks.filter((_, k) => k !== i))
}

// ── Suggest / save / delete ──────────────────────────────────────────────────
const showSuggest = ref(false)
function askSuggest() {
  if (draft.value?.blocks.length) showSuggest.value = true
  else doSuggest()
}
function doSuggest() {
  showSuggest.value = false
  const d = draft.value, a = analysis.value
  if (!d) return
  const per = a ? barEnergy(a.energy, d.origin, d.period, bars.value) : Array(bars.value).fill(0.5)
  d.sections = detectSections(per)
  const s = suggestShow(d.sections, palette.value, bulbNames.value)
  d.blocks = s.blocks
  d.accents = s.accents
  sel.value = s.blocks.length ? { kind: 'block', id: (s.blocks.find(b => b.look.motion === 'pulse') ?? s.blocks[0]).id } : null
}

async function save(): Promise<boolean> {
  const d = draft.value
  if (!d) return false
  saving.value = true
  try {
    const saved = await store.save({ ...d, duration: analysis.value?.duration ?? d.duration, needsReview: false })
    existing.value = saved
    draft.value = JSON.parse(JSON.stringify(saved))
    await nextTick()
    dirty.value = false
    toast.success('Light show saved')
    if (route.query.id !== saved.id) router.replace({ path: '/lights/edit', query: { id: saved.id } })
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
  dirty.value = false
  toast.success('Light show deleted')
  router.push('/lights')
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (status.value !== 'ready' || showSuggest.value || showDelete.value || showLeave.value) return
  const el = e.target as HTMLElement
  if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return
  if (e.ctrlKey || e.metaKey) return
  if (e.key === ' ') togglePlay()
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.value) deleteSelected()
  else return
  e.preventDefault()
  e.stopPropagation()
}
onMounted(() => document.addEventListener('keydown', onKeydown, { capture: true }))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, { capture: true }))

// ── Leaving with unsaved changes ─────────────────────────────────────────────
const showLeave = ref(false)
let leaveResolver: ((ok: boolean) => void) | null = null
function resolveLeave(ok: boolean) {
  showLeave.value = false
  leaveResolver?.(ok)
  leaveResolver = null
}
function confirmDiscard(): boolean | Promise<boolean> {
  if (!dirty.value || status.value !== 'ready') return true
  showLeave.value = true
  return new Promise<boolean>(resolve => { leaveResolver = resolve })
}
onBeforeRouteLeave(confirmDiscard)
onBeforeRouteUpdate(confirmDiscard)
</script>

<style scoped>
.lt-h2 { @apply text-xs font-bold uppercase tracking-wider text-white/55 mb-2.5; }
.lt-row { @apply grid items-center gap-2.5 py-2 border-t border-white/[0.06]; grid-template-columns: 92px minmax(0, 1fr); }
.lt-row:first-of-type { @apply border-t-0; }
.lt-k { @apply text-sm text-white/60; }
.lt-chip { @apply px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.05] text-sm text-white/85 transition-colors; }
.lt-chip:hover:not(:disabled) { @apply bg-white/[0.09]; }
.lt-chip:disabled { @apply opacity-35; }
.lt-primary { @apply bg-accent/20 border-accent/45 text-white; }
.lt-seg { @apply px-2.5 py-1 rounded-lg border border-white/[0.08] bg-white/[0.04] text-[12.5px] text-white/60; }
.lt-seg.on { @apply bg-accent/20 border-accent/50 text-white; }
.lt-tog { @apply inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] text-sm text-white/60; }
.lt-tog::before { content: ''; @apply w-6 h-3.5 rounded-full bg-white/20; }
.lt-tog.on { @apply text-white border-accent/45; }
.lt-tog.on::before { @apply bg-accent; }
.lt-label { @apply absolute top-0.5 left-0 z-[2] px-2 text-[10px] uppercase tracking-wider text-white/40 pointer-events-none; }
.lt-kbd { @apply font-mono text-[11px] px-1.5 rounded border border-white/[0.12]; }
</style>
