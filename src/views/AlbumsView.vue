<template>
  <div class="albums-view p-6" ref="viewRoot">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold text-white mb-1">Albums</h1>
        <p class="text-sm text-white/40">{{ filteredAlbumsByTag.length }} albums<span v-if="library.searchQuery"> matching "{{ library.searchQuery }}"</span></p>
      </div>

      <div class="flex items-center gap-2">
        <!-- Reload button -->
        <button
          @click="rescan"
          :disabled="library.isScanning"
          class="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/[0.15] text-white/50 hover:text-white transition-all border border-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed"
          title="Rescan library"
        >
          <svg class="w-4 h-4" :class="library.isScanning ? 'animate-spin' : ''" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.016 4.356v4.992" />
          </svg>
        </button>

        <!-- View options dropdown -->
        <SortDropdownMenu
          :options="albumSortOptions"
          :model-value="library.albumSortOrder"
          :label="`View: ${albumSortLabels[library.albumSortOrder]}`"
          :active-tags="activeAlbumTags.length || undefined"
          @update:model-value="selectSort"
        >
          <template #filter>
            <div class="border-t border-white/[0.06] my-1" />
            <div class="px-3.5 py-1">
              <div class="flex items-center justify-between mb-1.5">
                <p class="text-[10px] font-semibold uppercase tracking-wider text-white/30">Filter by Tags</p>
                <button v-if="activeAlbumTags.length" @click="activeAlbumTags = []" class="text-[10px] text-white/40 hover:text-white/70 transition-colors">Clear</button>
              </div>
              <input v-model="tagSearch" type="text" placeholder="Search tags..." class="w-full px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-xs text-white/80 placeholder:text-white/25 outline-none focus:border-accent/40" />
            </div>
            <div class="max-h-52 overflow-y-auto py-1">
              <button
                v-for="tag in filteredTagOptions"
                :key="tag"
                @click="toggleAlbumTag(tag)"
                class="w-full px-3.5 py-1.5 text-left text-xs transition-colors flex items-center justify-between"
                :class="activeAlbumTags.includes(tag) ? 'text-accent bg-white/[0.08]' : 'text-white/60 hover:text-white hover:bg-white/[0.06]'"
              >
                <span class="truncate pr-2">{{ tag }}</span>
                <svg v-if="activeAlbumTags.includes(tag)" class="w-3.5 h-3.5 text-accent shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
              </button>
              <p v-if="filteredTagOptions.length === 0" class="px-3.5 py-2 text-xs text-white/30">No matching tags</p>
            </div>
          </template>
        </SortDropdownMenu>
      </div>
    </div>

    <!-- No search results -->
    <EmptyState
      v-if="library.searchQuery && filteredAlbumsByTag.length === 0"
      title="No albums found"
      :description="`No albums match &quot;${library.searchQuery}&quot;`"
    >
      <template #icon>
        <svg class="w-16 h-16 text-white/[0.06]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
      </template>
    </EmptyState>

    <!-- Empty -->
    <EmptyState
      v-if="library.albums.length === 0 && !library.isScanning && !library.searchQuery"
      title="No albums yet"
      description="Add a music folder to see your albums"
      large
    >
      <template #icon>
        <svg class="w-20 h-20 text-white/[0.06]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
        </svg>
      </template>
      <button
        @click="library.addFolder()"
        class="px-6 py-2.5 bg-accent hover:bg-accent-hover rounded-full text-sm font-medium text-white transition-colors accent-glow"
      >
        Add Music Folder
      </button>
    </EmptyState>

    <!-- Loading skeleton -->
    <LoadingSkeleton v-if="!library.libraryReady" :count="24" />

    <!-- Album grid -->
    <div
      v-else
      class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5"
    >
      <div v-for="album in filteredAlbumsByTag" :key="album.id" class="relative">
        <AlbumCard
          :album="album"
          @click="$router.push(`/album/${album.id}`)"
          @play="player.playAll(album.tracks)"
        />
        <div v-if="getAlbumTags(album).length > 0" class="mt-1 px-0.5 relative">
          <button
            @click.stop="openAlbumTagMenu(album.id, $event)"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors bg-white/[0.06] text-white/40 hover:text-white/70"
          >
            <span>{{ getAlbumTags(album)[0] }}</span>
            <span v-if="getAlbumTags(album).length > 1" class="text-white/30">+{{ getAlbumTags(album).length - 1 }}</span>
          </button>
          <Teleport to="body">
            <div v-if="openTagMenuAlbum === album.id" class="fixed inset-0 z-[90]" @click="openTagMenuAlbum = null" />
            <div
              v-if="openTagMenuAlbum === album.id"
              class="fixed z-[100] w-44 rounded-lg menu-panel p-1.5 shadow-2xl"
              :style="tagMenuStyle"
              @click.stop
            >
              <button
                v-for="tag in getAlbumTags(album)"
                :key="tag"
                @click="openTagMenuAlbum = null"
                class="w-full px-2 py-1.5 text-left text-xs rounded-md text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                {{ tag }}
              </button>
            </div>
          </Teleport>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useScrollMemory } from '@/composables/useScrollMemory'
import { useLibraryStore, type AlbumSortOrder } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useTagsStore } from '@/stores/tags'
import { useTagFilter } from '@/composables/useTagFilter'
import AlbumCard from '@/components/AlbumCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import SortDropdownMenu from '@/components/SortDropdownMenu.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'

const library = useLibraryStore()
const player = usePlayerStore()
const tagsStore = useTagsStore()
const { tagSearch, activeTags: activeAlbumTags, filteredTagOptions, toggleTag: toggleAlbumTag } = useTagFilter()
const openTagMenuAlbum = ref<string | null>(null)
const tagMenuStyle = ref<Record<string, string>>({})

const filteredAlbumsByTag = computed(() => {
  if (activeAlbumTags.value.length === 0) return library.filteredAlbums
  return library.filteredAlbums.filter((album) => {
    const key = `${album.name}---${album.artist}`
    const albumTags = tagsStore.getAlbumTags(key)
    return activeAlbumTags.value.some(tag => albumTags.includes(tag))
  })
})

function getAlbumTags(album: { name: string; artist: string }): string[] {
  return tagsStore.getAlbumTags(`${album.name}---${album.artist}`)
}

function openAlbumTagMenu(albumId: string, event: MouseEvent) {
  if (openTagMenuAlbum.value === albumId) {
    openTagMenuAlbum.value = null
    return
  }
  const maxLeft = Math.max(12, window.innerWidth - 180)
  const maxTop = Math.max(12, window.innerHeight - 220)
  tagMenuStyle.value = {
    left: `${Math.min(event.clientX, maxLeft)}px`,
    top: `${Math.min(event.clientY, maxTop)}px`,
  }
  openTagMenuAlbum.value = albumId
}

const viewRoot = ref<HTMLElement | null>(null)

useScrollMemory(() => viewRoot.value?.closest('main'))

const albumSortOptions: { value: AlbumSortOrder; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'artist', label: 'Artist' },
  { value: 'year', label: 'Year' },
  { value: 'tracks', label: 'Track Count' },
  { value: 'color', label: 'Cover Color' },
]

const albumSortLabels: Record<AlbumSortOrder, string> = {
  name: 'Name',
  artist: 'Artist',
  year: 'Year',
  tracks: 'Track Count',
  color: 'Cover Color',
}

function selectSort(order: string) {
  library.setAlbumSortOrder(order as AlbumSortOrder)
}

function onClickOutside(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.albums-view')) {
    openTagMenuAlbum.value = null
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

function rescan() {
  library.rescanAll()
}
</script>
