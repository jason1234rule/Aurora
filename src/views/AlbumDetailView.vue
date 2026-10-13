<template>
  <div v-if="album" class="album-detail p-6">
    <!-- Album header -->
    <div class="flex items-end gap-6 mb-8">
      <div class="w-56 h-56 rounded-2xl overflow-hidden bg-white/[0.06] shrink-0 cover-shadow relative">
        <video
          v-show="animatedCoverActive"
          ref="animatedVideoEl"
          class="w-full h-full object-cover absolute inset-0 z-10"
          autoplay loop muted playsinline
        />
        <img v-if="album.coverArt" :src="coverUrl" class="w-full h-full object-cover" />
        <div v-else class="w-full h-full flex items-center justify-center">
          <svg class="w-20 h-20 text-white/10" fill="currentColor" viewBox="0 0 24 24">
            <path
              d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
            />
          </svg>
        </div>
      </div>

      <div class="min-w-0 pb-2">
        <p class="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">Album</p>
        <h1 class="text-4xl font-bold text-white mb-2 line-clamp-2">{{ album.name }}</h1>
        <p class="text-lg text-white/60 mb-4 cursor-pointer hover:text-accent transition-colors" @click="goToArtist">{{ album.artist }}</p>
        <div class="flex items-center gap-3 text-sm text-white/40">
          <span v-if="album.year" class="cursor-pointer hover:text-accent transition-colors" @click="goToYear">{{ album.year }}</span>
          <span v-if="album.year">&bull;</span>
          <span v-if="tracklist && missingCount > 0">{{ album.tracks.length }} of {{ tracklist.tracks.length }} songs</span>
          <span v-else>{{ album.tracks.length }} songs</span>
          <span>&bull;</span>
          <span>{{ totalDuration }}</span>
        </div>

        <div class="flex items-center gap-3 mt-5 flex-wrap">
          <button
            @click="player.playAll(album.tracks)"
            class="px-6 py-2.5 bg-accent hover:bg-accent-hover rounded-full text-sm font-medium text-white transition-all accent-glow hover:scale-105 active:scale-95 flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play
          </button>
          <button
            @click="player.addToQueue(album.tracks)"
            class="px-6 py-2.5 bg-white/[0.08] hover:bg-white/[0.12] rounded-full text-sm font-medium text-white/80 transition-all"
          >
            Add to Queue
          </button>
          <button
            @click="openAlbumInExplorer"
            class="w-10 h-10 bg-white/[0.08] hover:bg-white/[0.12] rounded-full flex items-center justify-center text-white/50 hover:text-white/80 transition-all"
            title="Show in File Explorer"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </button>
          <!-- Plugin slot — data-album-id is kept in sync with the viewed album -->
          <div id="aurora-album-detail-slot" :data-album-id="album.id" />
        </div>
      </div>
    </div>

    <!-- Track list: the official tracklist when known, with songs that aren't downloaded greyed out -->
    <div v-if="missingCount > 0" class="flex justify-end mb-2">
      <button
        @click="setShowMissing(!showMissing)"
        class="text-xs text-white/40 hover:text-white/70 transition-colors"
      >
        {{ showMissing ? 'Hide' : 'Show' }} {{ missingCount }} {{ missingCount === 1 ? 'song' : 'songs' }} not downloaded
      </button>
    </div>
    <div class="space-y-0.5">
      <template v-for="row in rows" :key="row.key">
        <SongRow
          v-if="row.local"
          :track="row.local"
          :index="row.number - 1"
          :selected="selection.isSelected(row.local.id)"
          :selectable="selection.hasSelection.value"
          @play="selection.hasSelection.value ? selection.handleSelect(row.localIndex, $event ?? { ctrlKey: true, metaKey: false, shiftKey: false }) : player.playAll(album.tracks, row.localIndex)"
          @select="selection.handleSelect(row.localIndex, $event)"
        />
        <div
          v-else
          class="flex items-center gap-3 px-4 rounded-lg select-none cursor-default"
          style="height: 56px;"
          title="Not downloaded"
        >
          <div class="w-8 text-center shrink-0 text-xs text-white/20">{{ row.number }}</div>
          <div class="w-10 h-10 rounded-md border border-dashed border-white/[0.12] shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate text-white/30">{{ row.title }}</p>
            <p class="text-xs text-white/20">Not downloaded</p>
          </div>
          <div class="w-48 min-w-0 hidden lg:block">
            <p class="text-xs text-white/20 truncate">{{ album.name }}</p>
          </div>
          <div class="w-14 text-right shrink-0">
            <span class="text-xs text-white/20 tabular-nums">{{ formatTime(row.duration) }}</span>
          </div>
          <div class="w-7 shrink-0" />
          <div class="w-7 shrink-0" />
        </div>
      </template>
    </div>

    <!-- Selection action bar -->
    <SelectionBar
      :count="selection.selectedCount.value"
      :track-ids="selection.selectedItems.value.map(t => t.id)"
      @play-next="onPlayNextSelected"
      @add-to-queue="onAddToQueueSelected"
      @select-all="selection.selectAll()"
      @clear="selection.clearSelection()"
    />
  </div>

  <div v-else class="flex items-center justify-center h-full">
    <p class="text-white/30">Album not found</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useSelection } from '@/composables/useSelection'
import SongRow from '@/components/SongRow.vue'
import SelectionBar from '@/components/SelectionBar.vue'
import Hls from 'hls.js'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()

const album = computed(() => library.getAlbumById(route.params.id as string))
const selection = useSelection(() => album.value?.tracks ?? [])

const coverUrl = computed(() =>
  album.value?.coverArt ? window.api.getMediaUrl(album.value.coverArt) : '',
)

// ── Full official tracklist (songs that aren't downloaded) ─────────────────
const tracklist = ref<AlbumTracklist | null>(null)

const SHOW_MISSING_KEY = 'aurora-album-show-missing'
const showMissing = ref(true)
try { showMissing.value = localStorage.getItem(SHOW_MISSING_KEY) !== '0' } catch { /* storage unavailable */ }
function setShowMissing(show: boolean) {
  showMissing.value = show
  try { localStorage.setItem(SHOW_MISSING_KEY, show ? '1' : '0') } catch { /* storage unavailable */ }
}

/** Same rules as the main process, so "30 For 30 (with Kendrick Lamar)" matches "30 for 30" */
const normTitle = (s: string) => s.toLowerCase()
  .replace(/[([](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, '')

interface Row { key: string; number: number; title: string; duration: number; local?: Track; localIndex: number }

/** Catalog order with local tracks slotted in; local tracks the catalog doesn't list go last */
const merged = computed(() => {
  const a = album.value
  if (!a) return { rows: [] as Row[], missing: 0 }
  const tl = tracklist.value
  if (!tl) {
    return { rows: a.tracks.map((t, i) => ({ key: t.id, number: i + 1, title: t.title, duration: t.duration, local: t, localIndex: i })), missing: 0 }
  }
  const byTitle = new Map<string, number[]>()
  a.tracks.forEach((t, i) => {
    const k = normTitle(t.title)
    byTitle.set(k, [...(byTitle.get(k) ?? []), i])
  })
  const used = new Set<number>()
  const multiDisc = new Set(tl.tracks.map(t => t.disc)).size > 1
  const rows: Row[] = []
  let missing = 0
  // A title spelt differently (censored, re-punctuated) still matches on same slot and length
  const bySlot = (c: AlbumTracklist['tracks'][number]) => a.tracks.findIndex((t, i) =>
    !used.has(i) && t.track === c.track && (t.disc || 1) === c.disc && Math.abs(t.duration - c.duration) < 3)
  tl.tracks.forEach((c, ci) => {
    const number = multiDisc ? ci + 1 : c.track || ci + 1
    let li: number | undefined = (byTitle.get(normTitle(c.title)) ?? []).find(i => !used.has(i))
    if (li === undefined && c.track) li = bySlot(c) >= 0 ? bySlot(c) : undefined
    if (li !== undefined) {
      used.add(li)
      rows.push({ key: a.tracks[li].id, number, title: a.tracks[li].title, duration: a.tracks[li].duration, local: a.tracks[li], localIndex: li })
    } else {
      missing++
      rows.push({ key: `missing-${ci}`, number, title: c.title, duration: c.duration, localIndex: -1 })
    }
  })
  a.tracks.forEach((t, i) => {
    if (!used.has(i)) rows.push({ key: t.id, number: rows.length + 1, title: t.title, duration: t.duration, local: t, localIndex: i })
  })
  return { rows, missing }
})

const missingCount = computed(() => merged.value.missing)
const rows = computed(() => (showMissing.value ? merged.value.rows : merged.value.rows.filter(r => r.local)))

function formatTime(seconds: number) {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

watch(
  () => album.value?.id,
  async () => {
    tracklist.value = null
    const a = album.value
    // Remote (Navidrome) albums are complete already; only local folders can be partial
    if (!a || a.tracks.some(t => t.source === 'subsonic')) return
    const id = a.id
    try {
      const tl = await window.api.getAlbumTracklist(a.name, a.artist, a.tracks.map(t => t.title))
      if (album.value?.id === id) tracklist.value = tl
    } catch { /* offline: just show what's on disk */ }
  },
  { immediate: true },
)

// ── Animated cover (HLS stream) ─────────────────────────────────────────
const animatedVideoEl = ref<HTMLVideoElement | null>(null)
const animatedCoverActive = ref(false)
let hlsInstance: Hls | null = null

function destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy()
    hlsInstance = null
  }
  animatedCoverActive.value = false
}

function attachHls(url: string) {
  destroyHls()
  const videoEl = animatedVideoEl.value
  if (!videoEl) return

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: false,
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
    })
    hls.loadSource(url)
    hls.attachMedia(videoEl)
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      const avcLevels = data.levels
        .map((l: any, i: number) => ({ idx: i, codec: l.codecSet || '' }))
        .filter((l: any) => !l.codec.includes('hvc') && !l.codec.includes('hev'))
      if (avcLevels.length > 0) {
        hls.currentLevel = avcLevels[avcLevels.length - 1].idx
      }
      videoEl.play().catch(() => {})
      animatedCoverActive.value = true
    })
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) destroyHls()
    })
    hlsInstance = hls
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = url
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.play().catch(() => {})
      animatedCoverActive.value = true
    }, { once: true })
  }
}

watch(
  () => album.value,
  async (a) => {
    destroyHls()
    if (!a || !player.animatedCoversEnabled) return
    try {
      const hlsUrl = await window.api.getAnimatedCover(a.name || '', a.artist || '')
      if (hlsUrl && album.value?.id === a.id) {
        await nextTick()
        attachHls(hlsUrl)
      }
    } catch {}
  },
  { immediate: true },
)

watch(
  () => player.animatedCoversEnabled,
  (enabled) => {
    if (!enabled) {
      destroyHls()
    } else if (album.value) {
      const a = album.value
      window.api.getAnimatedCover(a.name || '', a.artist || '').then((hlsUrl) => {
        if (hlsUrl && album.value?.id === a.id) {
          nextTick().then(() => attachHls(hlsUrl))
        }
      }).catch(() => {})
    }
  },
)

const totalDuration = computed(() => {
  if (!album.value) return ''
  const total = album.value.tracks.reduce((s, t) => s + t.duration, 0)
  const mins = Math.floor(total / 60)
  if (mins >= 60) {
    return `${Math.floor(mins / 60)} hr ${mins % 60} min`
  }
  return `${mins} min`
})

function goToArtist() {
  if (album.value) {
    router.push(`/artist/${encodeURIComponent(album.value.artist)}`)
  }
}

function goToYear() {
  if (album.value?.year) {
    router.push(`/year/${album.value.year}`)
  }
}

function openAlbumInExplorer() {
  if (album.value && album.value.tracks.length > 0) {
    window.api.showInExplorer(album.value.tracks[0].path)
  }
}

function onPlayNextSelected() {
  player.playNext(selection.selectedItems.value)
  selection.clearSelection()
}

function onAddToQueueSelected() {
  player.addToQueue(selection.selectedItems.value)
  selection.clearSelection()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && selection.hasSelection.value) {
    selection.clearSelection()
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && album.value) {
    e.preventDefault()
    selection.selectAll()
  }
}

// Pause animated cover when the app is backgrounded.
// document.visibilitychange catches minimisation, but on Linux it does NOT
// fire when another window goes fullscreen over Aurora.  Window blur/focus
// events reliably detect that scenario on all platforms, but can be too
// aggressive on multi-monitor setups — so they are opt-in via a setting.
function pauseAnimatedCover() {
  const videoEl = animatedVideoEl.value
  if (videoEl && animatedCoverActive.value) videoEl.pause()
}
function resumeAnimatedCover() {
  const videoEl = animatedVideoEl.value
  if (videoEl && animatedCoverActive.value && !document.hidden) {
    videoEl.play().catch(() => {})
  }
}
function onVisibilityChange() {
  if (document.hidden) pauseAnimatedCover()
  else resumeAnimatedCover()
}

watch(() => player.pauseAnimatedOnBlur, (enabled) => {
  if (enabled) {
    window.addEventListener('blur', pauseAnimatedCover)
    window.addEventListener('focus', resumeAnimatedCover)
  } else {
    window.removeEventListener('blur', pauseAnimatedCover)
    window.removeEventListener('focus', resumeAnimatedCover)
  }
})

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (player.pauseAnimatedOnBlur) {
    window.addEventListener('blur', pauseAnimatedCover)
    window.addEventListener('focus', resumeAnimatedCover)
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('blur', pauseAnimatedCover)
  window.removeEventListener('focus', resumeAnimatedCover)
  destroyHls()
})
</script>
