<template>
  <div
    class="app-container h-screen flex flex-col overflow-hidden"
    :class="appContainerClasses"
  >
    <!-- Dynamic ambient glow derived from album art -->
    <div
      v-if="dynamicColor && !isFullscreen"
      class="fixed inset-0 pointer-events-none z-0 transition-all duration-1000"
      :style="{
        background: `radial-gradient(ellipse at 20% 50%, ${dynamicColor}15 0%, transparent 60%),
                      radial-gradient(ellipse at 80% 20%, ${dynamicColor}10 0%, transparent 50%)`,
      }"
    />

    <!-- Titlebar -->
    <Titlebar v-if="!isFullscreen && !isMini" />

    <!-- Main layout -->
    <div class="flex flex-1 overflow-hidden relative z-10">
      <Sidebar v-if="!isFullscreen && !isMini" />

      <main class="flex-1 overflow-y-auto overflow-x-hidden">
        <router-view v-slot="{ Component }">
          <keep-alive :max="5" :exclude="['FullscreenView', 'MiniPlayerView']">
            <component :is="Component" :key="$route.path" />
          </keep-alive>
        </router-view>
      </main>
    </div>

    <!-- Bottom player bar -->
    <PlayerBar v-if="player.currentTrack && !isFullscreen && !isMini" />

    <!-- First-time setup wizard -->
    <SetupWizard v-if="showSetupWizard" @complete="showSetupWizard = false" />

    <!-- Toast notifications -->
    <ToastContainer />

    <!-- Update available banner (shown once per version) -->
    <UpdateBanner />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, watchEffect, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useSearchFocus } from '@/composables/useSearchFocus'
import { usePlaylistStore } from '@/stores/playlist'
import { useFavoritesStore } from '@/stores/favorites'
import { useTagsStore } from '@/stores/tags'
import { useThemeStore } from '@/stores/theme'
import { usePluginStore } from '@/stores/plugins'
import { useStatsStore } from '@/stores/stats'
import { useSyncStore } from '@/stores/sync'
import { useTransitionsStore } from '@/stores/transitions'
import { installTransitionDevHook } from '@/utils/transitions/devHook'
import Titlebar from '@/components/Titlebar.vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import SetupWizard from '@/components/SetupWizard.vue'

const router = useRouter()
const route = useRoute()
const player = usePlayerStore()
const library = useLibraryStore()
const playlistStore = usePlaylistStore()
const favoritesStore = useFavoritesStore()
const tagsStore = useTagsStore()
const themeStore = useThemeStore()
const pluginStore = usePluginStore()
const statsStore = useStatsStore()
const syncStore = useSyncStore()
const transitionsStore = useTransitionsStore()
const { focusSearch } = useSearchFocus()

// Expose stores globally for cross-store lazy access (avoids circular require issues)
;(window as any).__auroraLibStore = library
;(window as any).__auroraPlaylistStore = playlistStore
;(window as any).__auroraStatsStore = statsStore
;(window as any).__auroraFavoritesStore = favoritesStore
;(window as any).__auroraRouter = router

const dynamicColor = ref<string | null>(null)
const isWindowMaximized = ref(false)
const isWindowFullscreen = ref(false)
const showSetupWizard = ref(false)

const isFullscreen = computed(() => route.path === '/fullscreen')
const isMini = computed(() => route.path === '/mini')

// Determine whether to show rounded corners & glass styling
const appContainerClasses = computed(() => {
  if (isFullscreen.value) return 'bg-black'
  if (isMini.value) {
    const glass = player.transparencyEnabled ? 'glass-heavy' : 'bg-solid'
    return `${glass} rounded-xl border border-white/[0.06]`
  }
  const noRounding = isWindowMaximized.value || isWindowFullscreen.value
  const glass = player.transparencyEnabled ? 'glass-heavy' : 'bg-solid'
  const border = 'border border-white/[0.06]'
  const rounding = noRounding ? '' : 'rounded-xl'
  return `${glass} ${rounding} ${border}`
})

// Expose --win-radius on :root so teleported panels (QueuePanel, etc.) can inherit it
watchEffect(() => {
  const noRounding = isWindowMaximized.value || isWindowFullscreen.value || isFullscreen.value
  document.documentElement.style.setProperty('--win-radius', noRounding ? '0px' : '0.75rem')
})

onMounted(async () => {
  // Listen for OS-level window state changes (maximize / fullscreen)
  window.api.onWindowStateChange((state: { maximized: boolean; fullscreen: boolean }) => {
    isWindowMaximized.value = state.maximized
    isWindowFullscreen.value = state.fullscreen
  })

  // Load stats (non-blocking)
  statsStore.loadStats()

  // Load saved settings
  const settings = await window.api.getSettings()
  if (settings.volume !== undefined) player.setVolume(settings.volume)
  if (settings.sortOrder) library.sortOrder = settings.sortOrder
  if (settings.albumSortOrder) library.albumSortOrder = settings.albumSortOrder

  // Show first-time setup wizard if not completed
  if (!settings.setupComplete) {
    showSetupWizard.value = true
  }

  // Restore last open tab
  if (settings.lastTab && settings.lastTab !== '/') {
    router.replace(settings.lastTab)
  }

  await library.loadLibrary()
  await playlistStore.loadPlaylists()
  await favoritesStore.load()
  await tagsStore.load()
  await transitionsStore.load()

  let devFlag = false
  try { devFlag = localStorage.getItem('aurora-dev') === '1' } catch { /* storage unavailable */ }
  if (import.meta.env.DEV || devFlag) installTransitionDevHook()

  if (settings.autoTagAlbumsFromApi === true) {
    tagsStore.autoTagAlbumsFromFetchedData().catch(() => {})
  }

  // Init sync (non-blocking — pull after data loaded)
  await syncStore.loadConfig()
  syncStore.pull()

  // Restore user theme and load plugins
  await themeStore.restoreTheme()
  themeStore.watchThemesDirectory()
  await pluginStore.init()

  // Handle files opened via right-click "Open with" or double-click
  const openFiles = await window.api.getOpenFiles()
  if (openFiles.length > 0) {
    handleOpenFiles(openFiles)
  }
  window.api.onOpenFiles((paths: string[]) => {
    if (paths.length > 0) handleOpenFiles(paths)
  })
})

async function handleOpenFiles(paths: string[]) {
  const tracks = await Promise.all(paths.map((p: string) => window.api.parseFile(p)))
  // Replace queue with opened files and play immediately
  player.clearQueue()
  await player.addToQueue(tracks)
}

// Auto-push to sync folder when playlists, favorites, or tags change
watch(() => playlistStore.playlists, () => syncStore.schedulePush(), { deep: true })
watch(() => favoritesStore.ids, () => syncStore.schedulePush(), { deep: true })
watch(() => tagsStore.trackTags, () => syncStore.schedulePush(), { deep: true })
watch(() => tagsStore.albumTags, () => syncStore.schedulePush(), { deep: true })

// Sync before the app closes
window.api.onBeforeQuit(async () => {
  try {
    if (syncStore.config.enabled && syncStore.config.folder) {
      await syncStore.push()
    }
  } finally {
    window.api.quitReady()
  }
})

// Extract a dominant colour from the current track's cover art
watch(
  () => player.currentTrack?.coverArt,
  (coverArt) => {
    if (!coverArt) {
      dynamicColor.value = null
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = window.api.getMediaUrl(coverArt)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      ctx.drawImage(img, 0, 0, 16, 16)
      let data: Uint8ClampedArray
      try {
        data = ctx.getImageData(0, 0, 16, 16).data
      } catch {
        // Canvas tainted — can't extract colors
        dynamicColor.value = null
        return
      }

      // Collect all pixels, weighted by saturation
      let r = 0, g = 0, b = 0, count = 0
      let satR = 0, satG = 0, satB = 0, satCount = 0
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2]
        const brightness = (pr + pg + pb) / 3
        if (brightness > 15 && brightness < 240) {
          r += pr; g += pg; b += pb; count++
          // Track saturated pixels separately
          const mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb)
          if (mx - mn > 25) {
            satR += pr; satG += pg; satB += pb; satCount++
          }
        }
      }

      if (count === 0) {
        dynamicColor.value = null
        return
      }

      // Prefer saturated pixels for the accent; fall back to overall average
      let avgR: number, avgG: number, avgB: number
      if (satCount > count * 0.15) {
        avgR = Math.round(satR / satCount)
        avgG = Math.round(satG / satCount)
        avgB = Math.round(satB / satCount)
      } else {
        avgR = Math.round(r / count)
        avgG = Math.round(g / count)
        avgB = Math.round(b / count)
      }
      dynamicColor.value = `rgb(${avgR}, ${avgG}, ${avgB})`

      // Adaptive accent: update CSS variables with extracted color
      if (player.adaptiveAccent) {
        let accentR = avgR, accentG = avgG, accentB = avgB
        const max = Math.max(accentR, accentG, accentB)
        const min = Math.min(accentR, accentG, accentB)
        const l = (max + min) / 2 / 255

        // Boost saturation: push channels apart from the mean
        if (max - min < 60 && max - min > 10) {
          const mid = (accentR + accentG + accentB) / 3
          const boostFactor = 1.8
          accentR = Math.min(255, Math.max(0, Math.round(mid + (accentR - mid) * boostFactor)))
          accentG = Math.min(255, Math.max(0, Math.round(mid + (accentG - mid) * boostFactor)))
          accentB = Math.min(255, Math.max(0, Math.round(mid + (accentB - mid) * boostFactor)))
        }

        // Brighten if too dark, darken if too bright
        const factor = l < 0.25 ? 1.8 : l < 0.35 ? 1.4 : l > 0.75 ? 0.6 : l > 0.65 ? 0.8 : 1.0
        accentR = Math.min(255, Math.round(accentR * factor))
        accentG = Math.min(255, Math.round(accentG * factor))
        accentB = Math.min(255, Math.round(accentB * factor))

        document.documentElement.style.setProperty('--accent', `${accentR} ${accentG} ${accentB}`)
        document.documentElement.style.setProperty('--accent-hover', `${Math.min(255, accentR + 20)} ${Math.min(255, accentG + 20)} ${Math.min(255, accentB + 20)}`)
        document.documentElement.style.setProperty('--accent-dark', `${Math.max(0, accentR - 30)} ${Math.max(0, accentG - 30)} ${Math.max(0, accentB - 30)}`)
        player.currentAccentColor = `rgb(${accentR}, ${accentG}, ${accentB})`
      }
    }

    img.onerror = () => {
      dynamicColor.value = null
    }
  },
)

// Revert accent when adaptive is turned off
watch(
  () => player.adaptiveAccent,
  (enabled) => {
    if (!enabled) {
      const t = themeStore.currentTheme
      document.documentElement.style.setProperty('--accent', t.colors.accent)
      document.documentElement.style.setProperty('--accent-hover', t.colors.accentHover)
      document.documentElement.style.setProperty('--accent-dark', t.colors.accentDark)
      player.currentAccentColor = null
    } else {
      // Re-extract from current cover art by re-triggering the coverArt watcher
      const coverArt = player.currentTrack?.coverArt
      if (coverArt) {
        // Force re-trigger: temporarily clear and re-set to invoke the watcher
        const saved = player.currentTrack
        player.currentTrack = { ...saved!, coverArt: null }
        nextTick(() => { player.currentTrack = saved })
      }
    }
  },
)

// Re-extract adaptive accent when the theme changes (new base colors may change the palette)
watch(
  () => themeStore.currentTheme,
  () => {
    if (!player.adaptiveAccent) return
    const coverArt = player.currentTrack?.coverArt
    if (coverArt) {
      const saved = player.currentTrack
      player.currentTrack = { ...saved!, coverArt: null }
      nextTick(() => { player.currentTrack = saved })
    }
  },
)

// ── Auto-fullscreen on mouse idle ──────────────────────────────────────
let idleTimer: ReturnType<typeof setTimeout> | null = null
const autoFullscreenTriggered = ref(false)
let previousRoute: string | null = null

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }

  // If auto-fullscreen was triggered and mouse moved, exit fullscreen
  if (autoFullscreenTriggered.value && isFullscreen.value) {
    autoFullscreenTriggered.value = false
    router.replace(previousRoute || '/')
    previousRoute = null
    return
  }

  // Start a new idle timer if conditions are met
  if (player.autoFullscreen && player.isPlaying && !isFullscreen.value) {
    idleTimer = setTimeout(() => {
      if (player.autoFullscreen && player.isPlaying && !isFullscreen.value) {
        previousRoute = route.path
        autoFullscreenTriggered.value = true
        router.push('/fullscreen')
      }
    }, player.autoFullscreenDelay * 1000)
  }
}

function onMouseMove() {
  resetIdleTimer()
}

// ── Global keyboard shortcuts ──────────────────────────────────────────
function onGlobalKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable

  // Ctrl+F / Cmd+F always focuses search (even from fullscreen)
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    focusSearch()
    return
  }

  // Don't intercept when typing in inputs
  if (inInput) return

  // Don't intercept when LrcSyncer overlay is visible
  if (document.querySelector('[data-lrc-syncer-active]')) return

  // '/' focuses search (when not in fullscreen)
  if (e.key === '/' && route.path !== '/fullscreen') {
    e.preventDefault()
    focusSearch()
    return
  }

  // Don't intercept in fullscreen view (it has its own handler)
  if (route.path === '/fullscreen') return

  switch (e.key) {
    case ' ':
      e.preventDefault()
      player.togglePlay()
      break
    case 'ArrowRight':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        player.next()
      } else {
        e.preventDefault()
        player.seek(Math.min(player.duration, player.currentTime + 5))
      }
      break
    case 'ArrowLeft':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        player.previous()
      } else {
        e.preventDefault()
        player.seek(Math.max(0, player.currentTime - 5))
      }
      break
    case 'ArrowUp':
      e.preventDefault()
      player.setVolume(Math.min(1, player.volume + 0.05))
      break
    case 'ArrowDown':
      e.preventDefault()
      player.setVolume(Math.max(0, player.volume - 0.05))
      break
    case 'm':
    case 'M':
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        player.toggleMute()
      }
      break
  }
}

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mousedown', onMouseMove)
  document.addEventListener('keydown', onMouseMove)
  document.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mousedown', onMouseMove)
  document.removeEventListener('keydown', onMouseMove)
  document.removeEventListener('keydown', onGlobalKeydown)
  if (idleTimer) clearTimeout(idleTimer)
  window.api.removeWindowStateChangeListener()
  window.api.removeOpenFilesListener()
  themeStore.unwatchThemesDirectory()
})

// Re-evaluate idle timer when playback state or setting changes
watch(
  [() => player.isPlaying, () => player.autoFullscreen, () => player.autoFullscreenDelay],
  () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    // If auto-fullscreen is disabled while we're in auto-triggered fullscreen, exit
    if (!player.autoFullscreen && autoFullscreenTriggered.value && isFullscreen.value) {
      autoFullscreenTriggered.value = false
      router.replace(previousRoute || '/')
      previousRoute = null
      return
    }
    // Start timer if conditions are met
    if (player.autoFullscreen && player.isPlaying && !isFullscreen.value) {
      idleTimer = setTimeout(() => {
        if (player.autoFullscreen && player.isPlaying && !isFullscreen.value) {
          previousRoute = route.path
          autoFullscreenTriggered.value = true
          router.push('/fullscreen')
        }
      }, player.autoFullscreenDelay * 1000)
    }
  },
)
</script>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
