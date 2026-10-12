<template>
  <div class="p-6 h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5 gap-4">
      <div>
        <h1 class="text-3xl font-bold text-white mb-1">Transitions</h1>
        <p class="text-sm text-white/40">
          {{ store.list.length }} hand-made {{ store.list.length === 1 ? 'transition' : 'transitions' }}
          <template v-if="store.needsReviewCount"> · {{ store.needsReviewCount }} need review</template>
        </p>
      </div>
    </div>

    <div v-if="store.list.length" class="flex items-center gap-2 mb-3">
      <div class="flex rounded-lg overflow-hidden border border-white/[0.08]">
        <button
          v-for="f in filters"
          :key="f.value"
          @click="filter = f.value"
          class="px-3 py-1.5 text-xs transition-colors"
          :class="filter === f.value ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'"
        >{{ f.label }}</button>
      </div>
      <input
        v-model="query"
        placeholder="Filter by song or artist"
        class="ml-2 flex-1 max-w-xs px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder-white/25 outline-none focus:border-accent/50"
      />
    </div>

    <!-- Empty state -->
    <EmptyState
      v-if="!store.list.length"
      title="No transitions yet"
      description='Right-click a song and choose "Create transition to…", or use the ⇄ button between two songs in the queue.'
      large
    >
      <template #icon>
        <svg class="w-20 h-20 text-white/[0.06]" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
      </template>
    </EmptyState>

    <!-- List -->
    <div v-else class="flex-1 overflow-y-auto -mx-2 px-2 space-y-1">
      <p v-if="!rows.length" class="text-sm text-white/30 py-8 text-center">Nothing matches.</p>
      <div
        v-for="row in rows"
        :key="row.t.id"
        class="group flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-colors hover:bg-white/[0.05]"
        @click="edit(row.t)"
      >
        <div class="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div class="min-w-0">
            <p class="text-sm truncate" :class="row.from ? 'text-white/85' : 'text-white/30 line-through'">{{ row.t.from.title }}</p>
            <p class="text-xs text-white/35 truncate">{{ row.t.from.artist }}</p>
          </div>
          <svg class="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
          <div class="min-w-0">
            <p class="text-sm truncate" :class="row.to ? 'text-white/85' : 'text-white/30 line-through'">{{ row.t.to.title }}</p>
            <p class="text-xs text-white/35 truncate">{{ row.t.to.artist }}</p>
          </div>
        </div>

        <div class="hidden md:flex items-center gap-2 shrink-0 text-[11px] text-white/40 tabular-nums">
          <span class="px-2 py-0.5 rounded-md bg-white/[0.06]">{{ typeLabel[row.t.type] }}</span>
          <span v-if="row.t.type !== 'cut'">{{ row.t.overlap.toFixed(1) }} s</span>
          <span v-if="row.t.rateTo && row.t.type !== 'cut'">{{ ((row.t.rateTo - 1) * 100).toFixed(1) }}%</span>
        </div>
        <span
          v-if="row.t.needsReview"
          class="shrink-0 px-2 py-0.5 rounded-md text-[11px] bg-amber-500/15 text-amber-300/90"
          title="A file changed length since this was made; open it to check and re-save"
        >Needs review</span>
        <span v-else-if="!row.from || !row.to" class="shrink-0 px-2 py-0.5 rounded-md text-[11px] bg-white/[0.06] text-white/40">
          Song missing
        </span>

        <div class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            v-if="row.from && row.to"
            @click.stop="audition(row)"
            class="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-accent hover:bg-white/[0.06]"
            title="Hear it in the player (starts 12 s before the exit)"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <button
            @click.stop="pendingDelete = row.t"
            class="w-8 h-8 rounded-full flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-white/[0.06]"
            title="Delete"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :show="!!pendingDelete"
      title="Delete transition?"
      :message="pendingDelete ? `${pendingDelete.from.title} → ${pendingDelete.to.title}` : ''"
      confirm-label="Delete"
      variant="danger"
      @confirm="doDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTransitionsStore } from '@/stores/transitions'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useToast } from '@/composables/useToast'
import { songKey } from '@/utils/smartPlaylistMatcher'
import type { Transition, TransitionEndpoint, TransitionType } from '@/types/transition'
import EmptyState from '@/components/EmptyState.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const router = useRouter()
const store = useTransitionsStore()
const library = useLibraryStore()
const player = usePlayerStore()
const toast = useToast()

const filters = [
  { value: 'all', label: 'All' },
  { value: 'review', label: 'Needs review' },
] as const
const filter = ref<'all' | 'review'>('all')
const query = ref('')
const pendingDelete = ref<Transition | null>(null)

const typeLabel: Record<TransitionType, string> = { blend: 'Blend', cut: 'Cut', 'echo-out': 'Echo out' }

// path → track and songKey → track, so each row resolves in O(1)
const trackIndex = computed(() => {
  const byPath = new Map<string, Track>()
  const byKey = new Map<string, Track>()
  for (const t of library.tracks) {
    byPath.set(t.path, t)
    const k = songKey(t)
    if (!byKey.has(k)) byKey.set(k, t)
  }
  return { byPath, byKey }
})

function resolve(ep: TransitionEndpoint): Track | null {
  return trackIndex.value.byPath.get(ep.path) ?? trackIndex.value.byKey.get(ep.key) ?? null
}

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return store.list
    .filter(t => filter.value === 'all' || t.needsReview)
    .filter(t => !q || [t.from.title, t.from.artist, t.to.title, t.to.artist].some(s => s.toLowerCase().includes(q)))
    .map(t => ({ t, from: resolve(t.from), to: resolve(t.to) }))
})

function edit(t: Transition) {
  router.push({ path: '/transition/edit', query: { id: t.id } })
}

function audition(row: { t: Transition; from: Track | null; to: Track | null }) {
  if (!row.from || !row.to) return
  if (row.t.needsReview) toast.warning('This one needs review: it won\'t play until it\'s re-saved')
  player.auditionTransition(row.from, row.to, row.t.exitAt - 12)
}

async function doDelete() {
  const t = pendingDelete.value
  pendingDelete.value = null
  if (!t) return
  await store.remove(t.id)
  toast.success('Transition deleted')
}
</script>
