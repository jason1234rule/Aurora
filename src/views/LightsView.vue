<template>
  <div class="p-6 h-full flex flex-col overflow-hidden">
    <div class="flex items-center justify-between mb-5 gap-4">
      <div>
        <h1 class="text-3xl font-bold text-white mb-1">Lights</h1>
        <p class="text-sm text-white/40">
          {{ store.list.length }} hand-made light {{ store.list.length === 1 ? 'show' : 'shows' }}.
          Songs without one use the automatic style from Settings.
        </p>
      </div>
      <button
        @click="picking = !picking"
        class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors shrink-0"
        :class="picking ? 'bg-white/[0.12] text-white' : 'bg-accent hover:bg-accent-hover text-white'"
      >{{ picking ? 'Cancel' : 'New light show' }}</button>
    </div>

    <!-- Pick a song for a new show -->
    <div v-if="picking" class="mb-4 rounded-xl bg-white/[0.04] border border-white/[0.06] p-3">
      <input
        ref="searchRef"
        v-model="query"
        placeholder="Find a song"
        class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white placeholder-white/25 outline-none focus:border-accent/50"
      />
      <div class="mt-2 max-h-72 overflow-y-auto">
        <button
          v-for="t in matches"
          :key="t.id"
          @click="openTrack(t)"
          class="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.06]"
        >
          <div class="w-8 h-8 rounded overflow-hidden bg-white/10 shrink-0">
            <img v-if="t.coverArt" :src="mediaUrl(t.coverArt)" class="w-full h-full object-cover" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-white/85 truncate">{{ t.title }}</p>
            <p class="text-xs text-white/35 truncate">{{ t.artist }}</p>
          </div>
          <span v-if="store.find(t)" class="text-[11px] text-accent shrink-0">Has a show</span>
        </button>
        <p v-if="query && !matches.length" class="text-sm text-white/30 py-4 text-center">No songs match.</p>
      </div>
    </div>

    <EmptyState
      v-if="!store.list.length && !picking"
      title="No light shows yet"
      description="Press New light show and pick a song. Suggest lays out a first draft from the song's energy; you shape it from there."
      large
    >
      <template #icon>
        <svg class="w-20 h-20 text-white/[0.06]" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      </template>
    </EmptyState>

    <div v-else-if="store.list.length" class="flex-1 overflow-y-auto -mx-2 px-2 space-y-1">
      <div
        v-for="row in rows"
        :key="row.show.id"
        class="group flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-colors hover:bg-white/[0.05]"
        @click="router.push({ path: '/lights/edit', query: { id: row.show.id } })"
      >
        <div class="w-10 h-10 rounded-lg overflow-hidden bg-white/10 shrink-0">
          <img v-if="row.track?.coverArt" :src="mediaUrl(row.track.coverArt)" class="w-full h-full object-cover" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm truncate" :class="row.track ? 'text-white/85' : 'text-white/30 line-through'">{{ row.show.title }}</p>
          <p class="text-xs text-white/35 truncate">{{ row.show.artist }}</p>
        </div>
        <!-- The show's looks as a strip, in song order -->
        <div class="hidden md:flex h-3 w-48 rounded-full overflow-hidden bg-white/[0.04] shrink-0">
          <div
            v-for="b in row.strip" :key="b.id"
            :style="{ width: b.width + '%', background: b.background }"
          />
        </div>
        <span v-if="row.show.needsReview" class="shrink-0 px-2 py-0.5 rounded-md text-[11px] bg-amber-500/15 text-amber-300/90">Needs review</span>
        <span v-else-if="!row.track" class="shrink-0 px-2 py-0.5 rounded-md text-[11px] bg-white/[0.06] text-white/40">Song missing</span>
        <button
          @click.stop="pendingDelete = row.show"
          class="w-8 h-8 rounded-full flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>

    <ConfirmDialog
      :show="!!pendingDelete"
      title="Delete light show?"
      :message="pendingDelete ? `${pendingDelete.title} will go back to the automatic lights.` : ''"
      confirm-label="Delete"
      variant="danger"
      @confirm="doDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useLightShowsStore } from '@/stores/lightShows'
import { useLibraryStore } from '@/stores/library'
import { useToast } from '@/composables/useToast'
import { songKey } from '@/utils/smartPlaylistMatcher'
import { barsIn } from '@/utils/lights/handmade'
import type { LightShow } from '@/types/lightShow'
import EmptyState from '@/components/EmptyState.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const router = useRouter()
const store = useLightShowsStore()
const library = useLibraryStore()
const toast = useToast()
const mediaUrl = (p: string) => window.api.getMediaUrl(p)

const picking = ref(false)
const query = ref('')
const searchRef = ref<HTMLInputElement>()
watch(picking, async on => { if (on) { query.value = ''; await nextTick(); searchRef.value?.focus() } })

const matches = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return []
  return library.tracks
    .filter(t => t.path && `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q))
    .slice(0, 40)
})

function openTrack(t: Track) {
  const existing = store.find(t)
  router.push({ path: '/lights/edit', query: existing ? { id: existing.id } : { track: t.id } })
}

const trackByKey = computed(() => {
  const m = new Map<string, Track>()
  for (const t of library.tracks) if (!m.has(songKey(t))) m.set(songKey(t), t)
  return m
})

const rows = computed(() => store.list.map(show => {
  const bars = barsIn(show)
  const strip = show.blocks
    .filter(b => b.target === 'all')
    .sort((a, b) => a.start - b.start)
    .map(b => {
      const cols = [...new Set(Object.values(b.look.colours))]
      return { id: b.id, width: (b.len / bars) * 100, background: cols.length > 1 ? `linear-gradient(90deg, ${cols.join(',')})` : b.look.colour }
    })
  return { show, track: trackByKey.value.get(show.key) ?? null, strip }
}))

const pendingDelete = ref<LightShow | null>(null)
async function doDelete() {
  const s = pendingDelete.value
  pendingDelete.value = null
  if (!s) return
  await store.remove(s.id)
  toast.success('Light show deleted')
}
</script>
