<template>
  <nav class="sidebar w-60 shrink-0 border-r border-white/[0.06] flex flex-col py-3 overflow-y-auto">
    <!-- Search -->
    <div class="px-3 mb-4">
      <div class="relative">
        <svg
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors"
          :class="library.searchQuery ? 'text-accent/70' : 'text-white/30'"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref="searchInputRef"
          v-model="library.searchQuery"
          type="text"
          placeholder="Search"
          @keydown.escape="onSearchEscape"
          class="w-full bg-white/[0.06] rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-white/30 outline-none focus:bg-white/[0.1] focus:ring-1 transition-all no-drag"
          :class="library.searchQuery ? 'ring-1 ring-accent/20 bg-white/[0.08]' : 'ring-white/10'"
        />
        <button
          v-if="library.searchQuery"
          @click="clearSearch"
          class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Navigation -->
    <div class="px-2 space-y-0.5">
      <p class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
        Library
      </p>

      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all no-drag"
        :class="
          $route.path === item.path
            ? 'bg-white/[0.1] text-white'
            : 'text-white/60 hover:text-white/80 hover:bg-white/[0.05]'
        "
      >
        <span class="w-5 h-5 flex items-center justify-center" v-html="item.icon" />
        <span>{{ item.label }}</span>
      </router-link>
    </div>

    <!-- Plugin sidebar items -->
    <div v-if="pluginSidebarItems.length > 0" class="px-2 mt-4 space-y-0.5">
      <p class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
        Plugins
      </p>
      <button
        v-for="(item, idx) in pluginSidebarItems"
        :key="'plugin-' + idx"
        @click="item.onClick()"
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all no-drag text-white/60 hover:text-white/80 hover:bg-white/[0.05]"
      >
        <span class="w-5 h-5 flex items-center justify-center" v-html="item.icon" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <!-- Now Playing shortcut -->
    <div v-if="player.currentTrack" class="px-2 mt-4 space-y-0.5">
      <p class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
        Now Playing
      </p>

      <router-link
        to="/now-playing"
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all no-drag"
        :class="
          $route.path === '/now-playing'
            ? 'bg-white/[0.1] text-white'
            : 'text-white/60 hover:text-white/80 hover:bg-white/[0.05]'
        "
      >
        <div class="w-8 h-8 rounded-md overflow-hidden bg-white/10 shrink-0">
          <img
            v-if="player.currentTrack.coverArt"
            :src="getCoverUrl(player.currentTrack.coverArt)"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center">
            <svg class="w-4 h-4 text-white/30" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        </div>
        <div class="min-w-0">
          <p class="text-xs font-medium truncate">{{ player.currentTrack.title }}</p>
          <p class="text-[10px] text-white/40 truncate">{{ player.currentTrack.artist }}</p>
        </div>
      </router-link>
    </div>

    <!-- Playlists list -->
    <div v-if="playlistStore.sortedPlaylists.length > 0" class="px-2 mt-4 space-y-0.5">
      <div class="flex items-center justify-between px-3 py-1">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-white/30">
          Playlists
        </p>
        <button
          @click="cycleSort"
          class="text-[10px] text-white/30 hover:text-white/60 transition-colors uppercase tracking-wider"
          :title="'Sort: ' + sortLabel"
        >
          {{ sortLabel }}
        </button>
      </div>

      <router-link
        v-for="pl in playlistStore.sortedPlaylists"
        :key="pl.id"
        :to="`/playlist/${pl.id}`"
        class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all no-drag truncate"
        :class="
          $route.path === `/playlist/${pl.id}`
            ? 'bg-white/[0.1] text-white'
            : 'text-white/50 hover:text-white/70 hover:bg-white/[0.05]'
        "
        @contextmenu.prevent="openPlaylistCtx($event, pl)"
      >
        <svg class="w-4 h-4 shrink-0 opacity-40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
        <span class="truncate">{{ pl.name }}</span>
      </router-link>
    </div>

    <!-- Playlist context menu -->
    <Teleport to="body">
      <div v-if="plCtx.show" class="fixed inset-0 z-[90]" @click="plCtx.show = false" @contextmenu.prevent="plCtx.show = false" />
      <div
        v-if="plCtx.show"
        class="fixed z-[100] w-48 rounded-xl menu-panel py-1.5 shadow-2xl"
        :style="{ top: plCtx.y + 'px', left: plCtx.x + 'px' }"
      >
        <button
          @click.stop="playPlaylist(false)"
          class="ctx-item w-full px-3.5 py-2 text-left text-sm transition-colors flex items-center gap-2.5"
        >
          <svg class="w-4 h-4 shrink-0 text-white/40" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          Play
        </button>
        <button
          @click.stop="playPlaylist(true)"
          class="ctx-item w-full px-3.5 py-2 text-left text-sm transition-colors flex items-center gap-2.5"
        >
          <svg class="w-4 h-4 shrink-0 text-white/40" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
          </svg>
          Shuffle
        </button>
        <div class="border-t border-white/[0.06] my-1" />
        <button
          @click.stop="openEditDialog"
          class="ctx-item w-full px-3.5 py-2 text-left text-sm transition-colors flex items-center gap-2.5"
        >
          <svg class="w-4 h-4 shrink-0 text-white/40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
          </svg>
          Edit
        </button>
        <div class="border-t border-white/[0.06] my-1" />
        <button
          @click.stop="deletePlaylistConfirm"
          class="w-full px-3.5 py-2 text-left text-sm text-red-400 hover:text-red-300 hover:bg-white/[0.06] transition-colors flex items-center gap-2.5"
        >
          <svg class="w-4 h-4 shrink-0 text-red-400/60" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          Delete
        </button>
      </div>
    </Teleport>

    <!-- Delete confirmation dialog -->
    <ConfirmDialog
      :show="deleteDialog.show"
      title="Delete Playlist"
      :message="`Are you sure you want to delete &quot;${deleteDialog.playlistName}&quot;? This action cannot be undone.`"
      confirm-label="Delete"
      cancel-label="Cancel"
      variant="danger"
      @confirm="onDeleteConfirm"
      @cancel="deleteDialog.show = false"
    />

    <!-- Edit playlist dialog -->
    <EditPlaylistDialog
      :show="editDialog.show"
      :playlist="editDialog.playlist"
      @close="editDialog.show = false"
      @save="onEditConfirm"
    />

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Settings -->
    <div class="px-2 mt-2">
      <router-link
        to="/settings"
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all no-drag"
        :class="
          $route.path === '/settings'
            ? 'bg-white/[0.1] text-white'
            : 'text-white/60 hover:text-white/80 hover:bg-white/[0.05]'
        "
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>Settings</span>
      </router-link>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { usePlaylistStore, type PlaylistSortOrder } from '@/stores/playlist'
import { pluginSidebarItems } from '@/plugins/api'
import { useSearchFocus } from '@/composables/useSearchFocus'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EditPlaylistDialog from '@/components/EditPlaylistDialog.vue'
const router = useRouter()
const route = useRoute()
const { searchInputRef } = useSearchFocus()
const player = usePlayerStore()
const library = useLibraryStore()
const playlistStore = usePlaylistStore()

// pluginSidebarItems is a reactive shallowRef imported from the plugin API

// ── Delete confirmation dialog ─────────────────────────────────────────
const deleteDialog = reactive({ show: false, playlistName: '', playlistId: '' })

function onDeleteConfirm() {
  playlistStore.deletePlaylist(deleteDialog.playlistId)
  if (route.path === `/playlist/${deleteDialog.playlistId}`) {
    router.replace('/playlists')
  }
  deleteDialog.show = false
}

// ── Playlist context menu ──────────────────────────────────────────────
const plCtx = reactive({ show: false, x: 0, y: 0, playlist: null as Playlist | null })

function openPlaylistCtx(e: MouseEvent, pl: Playlist) {
  plCtx.x = Math.min(e.clientX, window.innerWidth - 200)
  plCtx.y = Math.min(e.clientY, window.innerHeight - 120)
  plCtx.playlist = pl
  plCtx.show = true
}

// ── Edit dialog ────────────────────────────────────────────────────────
const editDialog = reactive({ show: false, playlist: null as Playlist | null })

function openEditDialog() {
  if (!plCtx.playlist) return
  editDialog.playlist = plCtx.playlist
  plCtx.show = false
  editDialog.show = true
}

async function onEditConfirm(data: { id: string; name: string; description: string; customImage: string | null }) {
  await playlistStore.editPlaylist(data.id, {
    name: data.name,
    description: data.description,
    customImage: data.customImage,
  })
  editDialog.show = false
}

function deletePlaylistConfirm() {
  plCtx.show = false
  if (!plCtx.playlist) return
  deleteDialog.playlistName = plCtx.playlist.name
  deleteDialog.playlistId = plCtx.playlist.id
  deleteDialog.show = true
}

function playPlaylist(shuffle: boolean) {
  plCtx.show = false
  if (!plCtx.playlist) return
  const tracks = playlistStore.getPlaylistTracks(plCtx.playlist.id)
  if (tracks.length === 0) return
  if (shuffle) {
    player.isShuffle = true
  }
  player.playAll(tracks)
}

function getCoverUrl(path: string) {
  return window.api.getMediaUrl(path)
}

const sortOrders: PlaylistSortOrder[] = ['updated', 'created', 'name', 'tracks']
const sortLabels: Record<PlaylistSortOrder, string> = {
  updated: 'Recent',
  created: 'Created',
  name: 'A–Z',
  tracks: 'Count',
}
const sortLabel = computed(() => sortLabels[playlistStore.playlistSortOrder])
function cycleSort() {
  const idx = sortOrders.indexOf(playlistStore.playlistSortOrder)
  playlistStore.playlistSortOrder = sortOrders[(idx + 1) % sortOrders.length]
}

function onSearchEscape() {
  if (library.searchQuery) {
    library.searchQuery = ''
  } else {
    searchInputRef.value?.blur()
  }
}

function clearSearch() {
  library.searchQuery = ''
  searchInputRef.value?.blur()
}

// Navigate to the dedicated search view when the user types, and back when they clear.
let searchNavTimer: ReturnType<typeof setTimeout> | null = null
watch(() => library.searchQuery, (q) => {
  if (searchNavTimer) clearTimeout(searchNavTimer)
  // Clearing the query while on the search page → go back to songs
  if (!q) {
    if (route.path === '/search') router.push('/')
    return
  }
  // Already on the search page — results update reactively
  if (route.path === '/search') return
  // Don't navigate from fullscreen
  if (route.path === '/fullscreen') return
  // Navigate to search view after a short debounce
  searchNavTimer = setTimeout(() => {
    if (route.path !== '/search') router.push('/search')
  }, 200)
})

const navItems = [
  {
    label: 'Songs',
    path: '/',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" /></svg>',
  },
  {
    label: 'Albums',
    path: '/albums',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>',
  },
  {
    label: 'Artists',
    path: '/artists',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>',
  },
  {
    label: 'Soundtracks',
    path: '/soundtracks',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></svg>',
  },
  {
    label: 'Playlists',
    path: '/playlists',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5h11M3 9h8M3 13h7M3 17h6" /><path stroke-linecap="round" stroke-linejoin="round" d="M17 6v8.5" /><path stroke-linecap="round" stroke-linejoin="round" d="M17 6l3.5-1v3L17 9" /><circle cx="15.5" cy="14.5" r="2" /></svg>',
  },
  {
    label: 'Favorites',
    path: '/favorites',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>',
  },
  {
    label: 'Folders',
    path: '/folders',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>',
  },
  {
    label: 'Transitions',
    path: '/transitions',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>',
  },
  {
    label: 'Lights',
    path: '/lights',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" /></svg>',
  },
  {
    label: 'Stats',
    path: '/stats',
    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>',
  },
]
</script>

<!-- fade / dialog-slide transitions are global in main.css -->