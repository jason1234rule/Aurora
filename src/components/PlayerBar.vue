<template>
  <div
    class="player-bar h-20 shrink-0 border-t border-white/[0.06] glass flex items-center px-4 gap-4 relative z-20"
  >
    <!-- ── Playback error toast ─────────────────────────────────────── -->
    <Transition name="fade">
      <div
        v-if="player.playbackError"
        class="absolute -top-12 left-1/2 -translate-x-1/2 bg-red-500/90 text-white text-xs px-4 py-2 rounded-lg shadow-lg backdrop-blur-sm whitespace-nowrap z-50"
      >
        {{ player.playbackError }}
      </div>
    </Transition>
    <!-- ── Track info (left) ────────────────────────────────────────── -->
    <div class="flex items-center gap-3 w-60 min-w-0">
      <div
        class="w-12 h-12 rounded-lg overflow-hidden bg-white/10 shrink-0 cursor-pointer cover-shadow transition-transform hover:scale-105"
        @click="$router.push('/now-playing')"
      >
        <img
          v-if="player.currentTrack?.coverArt"
          :src="coverUrl"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex items-center justify-center">
          <svg class="w-6 h-6 text-white/20" fill="currentColor" viewBox="0 0 24 24">
            <path
              d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
            />
          </svg>
        </div>
      </div>

      <div class="min-w-0">
        <p class="text-sm font-medium truncate text-white">{{ player.currentTrack?.title }}</p>
        <p class="text-xs text-white/50 truncate">
          <ArtistLinks
            v-if="player.currentTrack?.artist"
            :artist="player.currentTrack.artist"
            :album-artist="player.currentTrack.albumArtist"
            hover-class="hover:text-white/80"
          />
        </p>
      </div>

      <!-- Flag to re-download (clean version, wrong mix, wrong credits...), listed in Settings → Library -->
      <button
        v-if="player.currentTrack"
        @click="showFlagDialog = true"
        class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors"
        :class="cleanFlags.isFlagged(player.currentTrack) ? 'text-amber-400' : 'text-white/25 hover:text-white/70'"
        :title="cleanFlags.isFlagged(player.currentTrack) ? 'Flagged: ' + cleanFlags.noteOf(cleanFlags.flagOf(player.currentTrack)!) : 'Flag to re-download'"
      >
        <svg class="w-4 h-4" :fill="cleanFlags.isFlagged(player.currentTrack) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18M3 4.5h11.25l-1.5 3.75 1.5 3.75H3" />
        </svg>
      </button>
      <FlagDialog :show="showFlagDialog" :track="player.currentTrack" @close="showFlagDialog = false" />
    </div>

    <!-- ── Plugin slot (left of transport) ─────────────────────────── -->
    <div id="aurora-playerbar-left-slot" class="flex items-center shrink-0" />

    <!-- ── Transport controls (centre) ──────────────────────────────── -->
    <div class="flex-1 flex flex-col items-center gap-1">
      <div class="flex items-center gap-3">
        <!-- Shuffle -->
        <button
          @click="player.toggleShuffle()"
          class="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
          :class="player.isShuffle ? 'text-accent' : 'text-white/40 hover:text-white/70'"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path
              d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
            />
          </svg>
        </button>

        <!-- Previous -->
        <button
          @click="player.previous()"
          class="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:text-white transition-colors"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>

        <!-- Play / Pause -->
        <button
          @click="player.togglePlay()"
          class="w-10 h-10 flex items-center justify-center rounded-full bg-control text-control-fg hover:scale-105 active:scale-95 transition-all"
        >
          <svg v-if="player.isPlaying" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
          <svg v-else class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>

        <!-- Next -->
        <button
          @click="player.next()"
          class="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:text-white transition-colors"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>

        <!-- Repeat -->
        <button
          @click="player.cycleRepeat()"
          class="w-8 h-8 flex items-center justify-center rounded-full transition-colors relative"
          :class="
            player.repeatMode !== 'off'
              ? 'text-accent'
              : 'text-white/40 hover:text-white/70'
          "
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path
              d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
            />
          </svg>
          <span
            v-if="player.repeatMode === 'one'"
            class="absolute -top-0.5 -right-0.5 text-[8px] font-bold text-accent"
          >
            1
          </span>
        </button>
      </div>

      <!-- Progress -->
      <div class="w-full flex items-center gap-2">
        <span class="text-[10px] text-white/40 w-10 text-right tabular-nums">
          {{ formatTime(player.currentTime) }}
        </span>

        <!-- Progress bar (fixed-height wrapper keeps layout stable between modes) -->
        <div class="flex-1 flex items-center h-3">
          <div v-if="!player.iosSliders" class="flex-1 relative group">
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              :value="player.progress"
              @input="onProgressInput"
              class="progress-bar w-full h-1 rounded-full cursor-pointer relative z-10"
            />
            <div
              class="absolute top-1/2 left-0 -translate-y-1/2 h-1 rounded-full bg-white/15 w-full pointer-events-none"
            />
            <div
              class="absolute top-1/2 left-0 -translate-y-1/2 h-1 rounded-full bg-white/80 pointer-events-none transition-all"
              :style="{ width: player.progress + '%' }"
            />
          </div>
          <IOSSlider
            v-else
            :value="player.progress"
            :min="0"
            :max="100"
            :step="0.1"
            size="sm"
            fill-color="bg-white/80"
            class="flex-1"
            @update="(v: number) => player.seekPercent(v)"
          />
        </div>

        <span class="text-[10px] text-white/40 w-10 tabular-nums">
          {{ formatTime(player.duration) }}
        </span>
      </div>
    </div>

    <!-- ── Plugin slot (right of transport) ────────────────────────── -->
    <div id="aurora-playerbar-right-slot" class="flex items-center shrink-0 gap-3" />

    <!-- ── Volume & fullscreen (right) ───────────────────────────────────── -->
    <div class="flex items-center gap-2 w-60 shrink-0 justify-end" @wheel.prevent="onVolumeWheel">
      <!-- Queue toggle -->
      <button
        @click="showQueue = !showQueue"
        class="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
        :class="showQueue ? 'text-accent' : 'text-white/40 hover:text-white/70'"
        title="Queue"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
      </button>

      <!-- Mini player toggle 
      <button
        @click="enterMini"
        class="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white/70 transition-colors"
        title="Mini player"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
        </svg>
      </button>
-->
      <!-- Fullscreen toggle -->
      <button
        @click="$router.push('/fullscreen')"
        class="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white/70 transition-colors"
        title="Fullscreen mode"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
      </button>

      <!-- Sleep timer -->
      <SleepTimerMenu />

      <button
        @click="player.toggleMute()"
        class="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white/70 transition-colors"
      >
        <!-- Muted -->
        <svg
          v-if="player.isMuted || player.volume === 0"
          class="w-4 h-4"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
          />
        </svg>
        <!-- Low -->
        <svg
          v-else-if="player.volume < 0.5"
          class="w-4 h-4"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"
          />
        </svg>
        <!-- High -->
        <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path
            d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
          />
        </svg>
      </button>

      <!-- Volume slider (fixed-height wrapper keeps layout stable between modes) -->
      <div class="w-24 flex items-center h-3">
        <div v-if="!player.iosSliders" class="flex-1 relative group">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="player.volume"
            @input="onVolumeInput"
            class="volume-slider w-full cursor-pointer relative z-10"
          />
          <div
            class="absolute top-1/2 left-0 -translate-y-1/2 h-[3px] rounded-full bg-white/15 w-full pointer-events-none"
          />
          <div
            class="absolute top-1/2 left-0 -translate-y-1/2 h-[3px] rounded-full bg-white/70 pointer-events-none"
            :style="{ width: player.volume * 100 + '%' }"
          />
        </div>
        <IOSSlider
          v-else
          :value="player.volume"
          :min="0"
          :max="1"
          :step="0.01"
          size="sm"
          class="flex-1"
          @update="(v: number) => player.setVolume(v)"
        />
      </div>
    </div>

    <!-- Queue Panel -->
    <QueuePanel :show="showQueue" @close="showQueue = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useLibraryStore } from '@/stores/library'
import { useCleanFlagsStore } from '@/stores/cleanFlags'
import FlagDialog from '@/components/FlagDialog.vue'
import { formatTime } from '@/utils/formatTime'
import QueuePanel from '@/components/QueuePanel.vue'
import IOSSlider from '@/components/IOSSlider.vue'
import ArtistLinks from '@/components/ArtistLinks.vue'
import SleepTimerMenu from '@/components/SleepTimerMenu.vue'

const router = useRouter()
const player = usePlayerStore()
const cleanFlags = useCleanFlagsStore()
const showFlagDialog = ref(false)
const library = useLibraryStore()
const showQueue = ref(false)

function enterMini() {
  window.api.enterMiniPlayer()
  router.push('/mini')
}

const coverUrl = computed(() =>
  player.currentTrack?.coverArt ? window.api.getMediaUrl(player.currentTrack.coverArt) : '',
)

function onProgressInput(e: Event) {
  player.seekPercent(parseFloat((e.target as HTMLInputElement).value))
}

function onVolumeInput(e: Event) {
  player.setVolume(parseFloat((e.target as HTMLInputElement).value))
}

function onVolumeWheel(e: WheelEvent) {
  const delta = e.deltaY < 0 ? 0.05 : -0.05
  player.setVolume(Math.min(1, Math.max(0, player.volume + delta)))
}
</script>
