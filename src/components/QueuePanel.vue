<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-[80] bg-black/50" @click="$emit('close')" />
    </Transition>

    <!-- Panel -->
    <Transition name="slide">
      <div
        v-if="show"
        class="queue-panel fixed top-0 right-0 bottom-0 z-[85] w-[380px] max-w-[85vw] flex flex-col shadow-2xl"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <div>
            <h2 class="text-base font-bold" style="color: rgb(var(--app-text) / 0.95)">Queue</h2>
            <p class="text-[11px] mt-0.5" style="color: rgb(var(--app-text) / 0.30)">{{ player.queue.length }} tracks</p>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              v-if="player.queue.length > 0"
              @click="player.clearQueue()"
              class="q-clear-btn px-3 py-1.5 text-[11px] rounded-lg transition-colors font-medium"
            >
              Clear
            </button>
            <button
              @click="$emit('close')"
              class="q-close-btn w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Queue list -->
        <div v-if="player.queue.length > 0" class="flex-1 overflow-y-auto px-3 pb-3">
          <!-- Now Playing -->
          <div v-if="currentTrack" class="mb-3">
            <p class="px-2 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: rgb(var(--app-text) / 0.25)">
              Now Playing
            </p>
            <div
              class="flex items-center gap-3 px-3 py-3 rounded-xl"
              style="background: rgb(var(--app-text) / 0.06); border: 1px solid rgb(var(--app-text) / 0.06)"
            >
              <div class="w-11 h-11 rounded-lg overflow-hidden shrink-0" style="background: rgb(var(--app-text) / 0.10); box-shadow: 0 0 0 1px rgb(var(--app-text) / 0.06)">
                <img v-if="currentTrack.coverArt" :src="getCoverUrl(currentTrack.coverArt)" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full flex items-center justify-center">
                  <svg class="w-4 h-4 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-accent truncate">{{ currentTrack.title }}</p>
                <p class="text-[11px] text-white/35 truncate mt-0.5">
                  <ArtistLinks
                    :artist="currentTrack.artist"
                    :album-artist="currentTrack.albumArtist"
                    hover-class="hover:text-white/60"
                  />
                  <template v-if="currentTrack.album">
                    <span class="text-white/20"> · </span>
                    <span
                      class="text-white/20 hover:text-white/50 hover:underline underline-offset-2 cursor-pointer transition-colors"
                      @click.stop="goToAlbum(currentTrack)"
                    >{{ currentTrack.album }}</span>
                  </template>
                </p>
              </div>
              <div class="flex items-center justify-center gap-[2px] shrink-0 w-5">
                <span class="w-[2px] h-2.5 bg-accent rounded-full animate-bounce" style="animation-delay: 0s" />
                <span class="w-[2px] h-3.5 bg-accent rounded-full animate-bounce" style="animation-delay: 0.15s" />
                <span class="w-[2px] h-2 bg-accent rounded-full animate-bounce" style="animation-delay: 0.3s" />
              </div>
            </div>
          </div>

          <!-- Up Next -->
          <div v-if="upNext.length > 0">
            <p class="px-2 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider" style="color: rgb(var(--app-text) / 0.25)">
              Up Next &middot; {{ upNext.length }}
            </p>

            <div ref="upNextListRef" class="space-y-0.5">
              <div
                v-for="item in upNext"
                :key="item.track.id + '-' + item.queueIndex"
                :data-queue-index="item.queueIndex"
                class="queue-item group flex items-center gap-2 pl-1.5 pr-3 py-2 rounded-lg transition-colors"
                :class="[
                  dragOverIndex === item.queueIndex ? 'ring-1 ring-accent/40 bg-accent/[0.05]' : '',
                  draggedIndex === item.queueIndex ? 'opacity-30' : 'q-item-hover',
                ]"
                @click="player.playFromQueue(item.queueIndex)"
                draggable="true"
                @dragstart="onDragStart($event, item.queueIndex)"
                @dragover.prevent="onDragOver($event, item.queueIndex)"
                @dragleave="onDragLeave"
                @drop.prevent="onDrop($event, item.queueIndex)"
                @dragend="onDragEnd"
              >
                <!-- Drag handle -->
                <div
                  class="q-drag-handle w-5 h-8 flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors shrink-0"
                  @mousedown.stop
                >
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                  </svg>
                </div>

                <div class="w-9 h-9 rounded-md overflow-hidden bg-white/[0.06] shrink-0 ring-1 ring-white/[0.04]">
                  <img v-if="item.track.coverArt" :src="getCoverUrl(item.track.coverArt)" class="w-full h-full object-cover" loading="lazy" />
                  <div v-else class="w-full h-full flex items-center justify-center">
                    <svg class="w-3.5 h-3.5 text-white/15" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-[13px] text-white/80 truncate">{{ item.track.title }}</p>
                  <p class="text-[11px] text-white/30 truncate">
                    <ArtistLinks
                      :artist="item.track.artist"
                      :album-artist="item.track.albumArtist"
                      hover-class="hover:text-white/50"
                    />
                    <template v-if="item.track.album">
                      <span class="text-white/15"> · </span>
                      <span
                        class="text-white/15 hover:text-white/40 hover:underline underline-offset-2 cursor-pointer transition-colors"
                        @click.stop="goToAlbum(item.track)"
                      >{{ item.track.album }}</span>
                    </template>
                  </p>
                </div>
                <!-- Hand-made transition from the previous track -->
                <button
                  v-if="item.prev && isLocal(item.prev) && isLocal(item.track)"
                  @click.stop="openTransition(item.prev, item.track)"
                  class="q-tx-btn w-6 h-6 flex items-center justify-center rounded-full transition-colors shrink-0"
                  :class="item.transition ? 'q-tx-on' : ''"
                  :title="item.transition
                    ? `Hand-made transition from “${item.prev.title}” (click to edit)`
                    : `Create a transition from “${item.prev.title}”`"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                </button>
                <span class="text-[10px] text-white/20 tabular-nums shrink-0 font-mono">{{ formatTime(item.track.duration) }}</span>
                <button
                  @click.stop="player.removeFromQueue(item.queueIndex)"
                  class="q-remove-btn w-6 h-6 flex items-center justify-center rounded-full transition-colors shrink-0"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Previous tracks (collapsed) -->
          <div v-if="previousTracks.length > 0" class="mt-3">
            <button
              @click="showPrevious = !showPrevious"
              class="q-prev-btn w-full px-2 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1"
            >
              Previously Played &middot; {{ previousTracks.length }}
              <svg class="w-3 h-3 transition-transform" :class="showPrevious ? 'rotate-180' : ''" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div v-if="showPrevious" class="space-y-0.5 mt-1">
              <div
                v-for="item in previousTracks"
                :key="item.track.id + '-prev-' + item.queueIndex"
                class="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors opacity-40 hover:opacity-60"
                @click="player.playFromQueue(item.queueIndex)"
              >
                <div class="w-9 h-9 rounded-md overflow-hidden bg-white/[0.06] shrink-0">
                  <img v-if="item.track.coverArt" :src="getCoverUrl(item.track.coverArt)" class="w-full h-full object-cover" loading="lazy" />
                  <div v-else class="w-full h-full flex items-center justify-center">
                    <svg class="w-3.5 h-3.5 text-white/15" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-[13px] text-white/70 truncate">{{ item.track.title }}</p>
                  <p class="text-[11px] text-white/30 truncate">
                    <ArtistLinks
                      :artist="item.track.artist"
                      :album-artist="item.track.albumArtist"
                      hover-class="hover:text-white/50"
                    />
                    <template v-if="item.track.album">
                      <span class="text-white/15"> · </span>
                      <span
                        class="text-white/15 hover:text-white/40 hover:underline underline-offset-2 cursor-pointer transition-colors"
                        @click.stop="goToAlbum(item.track)"
                      >{{ item.track.album }}</span>
                    </template>
                  </p>
                </div>
                <span class="text-[10px] text-white/20 tabular-nums shrink-0 font-mono">{{ formatTime(item.track.duration) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="flex-1 flex flex-col items-center justify-center px-6" style="color: rgb(var(--app-text) / 0.20)">
          <svg class="w-14 h-14 mb-4 opacity-20" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
          </svg>
          <p class="text-sm font-medium text-white/25">Queue is empty</p>
          <p class="text-[11px] mt-1 text-white/15">Play something to get started</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useTransitionsStore } from '@/stores/transitions'
import { formatTime } from '@/utils/formatTime'
import ArtistLinks from '@/components/ArtistLinks.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits(['close'])

// ── Close on Escape ────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.show) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

watch(() => props.show, (visible) => {
  if (visible) {
    document.addEventListener('keydown', onKeydown, { capture: true })
  } else {
    document.removeEventListener('keydown', onKeydown, { capture: true })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, { capture: true })
})

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const transitions = useTransitionsStore()
const showPrevious = ref(false)

// ── Drag & drop state ──────────────────────────────────────
const draggedIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const upNextListRef = ref<HTMLElement>()

function onDragStart(e: DragEvent, queueIndex: number) {
  draggedIndex.value = queueIndex
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(queueIndex))
  }
}

function onDragOver(_e: DragEvent, queueIndex: number) {
  if (draggedIndex.value === null) return
  if (draggedIndex.value === queueIndex) {
    dragOverIndex.value = null
    return
  }
  dragOverIndex.value = queueIndex
}

function onDragLeave() {
  dragOverIndex.value = null
}

function onDrop(_e: DragEvent, toQueueIndex: number) {
  const fromQueueIndex = draggedIndex.value
  dragOverIndex.value = null
  draggedIndex.value = null
  if (fromQueueIndex === null || fromQueueIndex === toQueueIndex) return
  player.moveInQueue(fromQueueIndex, toQueueIndex)
}

function onDragEnd() {
  draggedIndex.value = null
  dragOverIndex.value = null
}

// ── Computed sections ──────────────────────────────────────
const currentTrack = computed(() => {
  if (player.currentIndex < 0 || player.currentIndex >= player.queue.length) return null
  return player.queue[player.currentIndex]
})

const upNext = computed(() => {
  const items: { track: Track; queueIndex: number; prev: Track | null; transition: boolean }[] = []
  for (let i = player.currentIndex + 1; i < player.queue.length; i++) {
    const prev = i > 0 ? player.queue[i - 1] : null
    const track = player.queue[i]
    items.push({ track, queueIndex: i, prev, transition: !!prev && !!transitions.find(prev, track) })
  }
  return items
})

const isLocal = (t: Track) => t.source !== 'subsonic' && (t.path.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(t.path))

function openTransition(from: Track, to: Track) {
  emit('close')
  const existing = transitions.find(from, to)
  router.push(existing
    ? { path: '/transition/edit', query: { id: existing.id } }
    : { path: '/transition/edit', query: { from: from.id, to: to.id } })
}

const previousTracks = computed(() => {
  const items: { track: Track; queueIndex: number }[] = []
  for (let i = 0; i < player.currentIndex; i++) {
    items.push({ track: player.queue[i], queueIndex: i })
  }
  return items
})

function getCoverUrl(path: string) {
  return window.api.getMediaUrl(path)
}

function goToAlbum(track: Track) {
  const album = library.albums.find(a =>
    a.name === track.album && a.artist === (track.albumArtist || track.artist)
  )
  if (album) {
    router.push(`/album/${album.id}`)
  }
}
</script>

<style scoped>
/* Themed panel background + border */
.queue-panel {
  background: var(--glass-heavy-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-left: 1px solid var(--border);
  border-radius: var(--win-radius, 0);
  overflow: hidden;
}

/* Themed interactive elements */
.q-clear-btn { color: rgb(var(--app-text) / 0.30); }
.q-clear-btn:hover { color: #f87171; background: rgb(var(--app-text) / 0.06); }
.q-close-btn { color: rgb(var(--app-text) / 0.30); }
.q-close-btn:hover { color: rgb(var(--app-text) / 0.90); background: rgb(var(--app-text) / 0.08); }
.q-prev-btn { color: rgb(var(--app-text) / 0.20); }
.q-prev-btn:hover { color: rgb(var(--app-text) / 0.40); }
.q-item-hover:hover { background: rgb(var(--app-text) / 0.05); }
.q-drag-handle { color: transparent; }
.queue-item:hover .q-drag-handle { color: rgb(var(--app-text) / 0.15); }
.q-drag-handle:hover { color: rgb(var(--app-text) / 0.30) !important; }
.q-remove-btn { color: transparent; }
.q-tx-btn { color: transparent; }
.queue-item:hover .q-tx-btn { color: rgb(var(--app-text) / 0.20); }
.q-tx-btn:hover { color: rgb(var(--accent)) !important; background: rgb(var(--app-text) / 0.06); }
.q-tx-btn.q-tx-on { color: rgb(var(--accent) / 0.85); }
.queue-item:hover .q-remove-btn { color: rgb(var(--app-text) / 0.20); }
.q-remove-btn:hover { color: #f87171 !important; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-enter-active { transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.slide-leave-active { transition: transform 0.2s ease-in; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }

.queue-item {
  user-select: none;
}
</style>
