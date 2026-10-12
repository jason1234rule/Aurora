<template>
  <div v-if="artist" class="artist-view px-6 pt-6 pb-10 max-w-6xl mx-auto">
    <!-- Hero banner. Text sits on a photo, so it uses fixed light colours
         instead of the theme-aware white/black utilities. -->
    <header class="hero relative h-[340px] rounded-2xl overflow-hidden mb-10 cover-shadow">
      <template v-if="artistInfo?.imageUrl">
        <img :src="artistInfo.imageUrl" class="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60" aria-hidden="true" />
        <img :src="artistInfo.imageUrl" class="absolute inset-y-0 right-0 h-full w-2/3 object-cover object-[center_20%] hero-photo-fade" alt="" />
      </template>
      <div v-else class="absolute inset-0 bg-gradient-to-br from-accent-dark via-accent/60 to-[#111]" />
      <div class="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.85)] via-[rgba(0,0,0,0.35)] to-transparent" />

      <div class="relative h-full flex flex-col justify-end p-8 text-[#fff]">
        <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.6)] mb-2">Artist</p>
        <h1 class="text-6xl font-bold tracking-tight mb-3 truncate">{{ artist.name }}</h1>
        <p class="text-sm text-[rgba(255,255,255,0.7)] mb-6 flex flex-wrap items-center gap-x-2">
          <template v-for="(part, i) in heroMeta" :key="part">
            <span v-if="i > 0" aria-hidden="true">·</span>
            <span>{{ part }}</span>
          </template>
        </p>

        <div class="flex items-center gap-3">
          <button
            @click="playAll(false)"
            :disabled="!allArtistTracks.length"
            class="h-11 px-7 bg-accent hover:bg-accent-hover rounded-full text-sm font-semibold text-[#fff] transition-all accent-glow hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-40"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            Play
          </button>
          <button
            @click="playAll(true)"
            :disabled="!allArtistTracks.length"
            class="h-11 px-6 bg-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.25)] backdrop-blur rounded-full text-sm font-semibold text-[#fff] transition-all flex items-center gap-2 disabled:opacity-40"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            Shuffle
          </button>
          <button
            @click="player.addToQueue(allArtistTracks)"
            :disabled="!allArtistTracks.length"
            class="w-11 h-11 flex items-center justify-center bg-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.25)] backdrop-blur rounded-full text-[#fff] transition-all disabled:opacity-40"
            title="Add to queue"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 6h13M3 12h13M3 18h8M18 15v6M15 18h6" />
            </svg>
          </button>
          <button
            @click="refresh"
            :disabled="loadingInfo"
            class="w-11 h-11 flex items-center justify-center bg-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.25)] backdrop-blur rounded-full text-[#fff] transition-all disabled:opacity-40"
            title="Refresh artist info"
          >
            <svg class="w-4 h-4" :class="{ 'animate-spin': loadingInfo }" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Latest release + Top songs -->
    <div class="grid gap-8 mb-12" :class="latestRelease ? 'md:grid-cols-[240px_1fr]' : ''">
      <section v-if="latestRelease">
        <h2 class="section-title">Latest Release</h2>
        <div
          class="group cursor-pointer"
          @click="openLatestRelease"
          :title="latestInLibrary ? 'Open album' : 'Open on Deezer'"
        >
          <div class="aspect-square rounded-xl overflow-hidden bg-white/[0.06] mb-3 cover-shadow transition-transform group-hover:scale-[1.02]">
            <img v-if="latestRelease.coverUrl" :src="latestRelease.coverUrl" class="w-full h-full object-cover" loading="lazy" alt="" />
          </div>
          <p class="text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-1">{{ formatDate(latestRelease.releaseDate) }}</p>
          <p class="text-sm font-semibold text-white truncate">
            {{ latestRelease.title }}
            <span v-if="latestRelease.explicit" class="explicit-badge" title="Explicit">E</span>
          </p>
          <p class="text-xs text-white/40 mb-2">{{ releaseTypeLabel(latestRelease.type) }}</p>
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
            :class="latestInLibrary ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-white/50'"
          >
            {{ latestInLibrary ? 'In your library' : 'Not in your library' }}
          </span>
        </div>
      </section>

      <section v-if="topTracks.length" class="min-w-0">
        <div class="flex items-baseline justify-between mb-4">
          <h2 class="section-title !mb-0">Top Songs</h2>
          <span class="text-xs text-white/30">{{ topTracksLabel }}</span>
        </div>
        <div class="space-y-0.5">
          <div v-for="(track, i) in visibleTopTracks" :key="track.id" class="flex items-center">
            <SongRow
              class="flex-1 min-w-0"
              :track="track"
              :index="i"
              @play="player.playAll(topTracks, i)"
            />
            <span
              v-if="streamsByTrack.size"
              class="w-20 shrink-0 text-right pr-4 text-xs tabular-nums text-white/35"
              :title="streamsByTrack.get(track.id) ? `${streamsByTrack.get(track.id)!.toLocaleString()} Spotify streams` : 'Not found on kworb.net'"
            >
              {{ streamsByTrack.get(track.id) ? compactNumber(streamsByTrack.get(track.id)!) : '—' }}
            </span>
          </div>
        </div>
        <button
          v-if="topTracks.length > TOP_TRACKS_COLLAPSED"
          @click="showAllTop = !showAllTop"
          class="mt-2 ml-4 text-xs font-medium text-accent hover:text-accent-hover transition-colors"
        >
          {{ showAllTop ? 'Show less' : `Show all ${topTracks.length}` }}
        </button>
      </section>
    </div>

    <!-- Everything by this artist that's in the library -->
    <section v-if="libraryAlbums.length" class="mb-12">
      <h2 class="section-title">In Your Library</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
        <AlbumCard
          v-for="album in libraryAlbums"
          :key="album.id"
          :album="album"
          @click="$router.push(`/album/${album.id}`)"
        />
      </div>
    </section>

    <!-- Features on other artists' tracks -->
    <section v-if="featuredTracks.length" class="mb-12">
      <h2 class="section-title">Appears On</h2>
      <div class="space-y-0.5">
        <SongRow
          v-for="(track, i) in featuredTracks"
          :key="track.id"
          :track="track"
          :index="i"
          @play="player.playAll(featuredTracks, i)"
        />
      </div>
    </section>

    <!-- About -->
    <section v-if="artistInfo && (artistInfo.bio || facts.length || links.length)" class="mb-12">
      <h2 class="section-title">About</h2>
      <div class="grid gap-8 md:grid-cols-[1fr_260px] p-6 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
        <div v-if="artistInfo.bio" class="min-w-0">
          <p v-if="artistInfo.disambiguation" class="text-xs text-white/40 italic mb-2">{{ artistInfo.disambiguation }}</p>
          <p class="text-sm text-white/70 leading-relaxed whitespace-pre-line" :class="{ 'line-clamp-5': !bioExpanded }">{{ artistInfo.bio }}</p>
          <button
            v-if="artistInfo.bio.length > BIO_CLAMP_CHARS"
            @click="bioExpanded = !bioExpanded"
            class="mt-2 text-xs font-medium text-accent hover:text-accent-hover transition-colors"
          >
            {{ bioExpanded ? 'Show less' : 'Read more' }}
          </button>
        </div>

        <div class="space-y-5 text-sm">
          <dl v-if="facts.length" class="space-y-3">
            <div v-for="fact in facts" :key="fact.label">
              <dt class="text-[11px] font-semibold uppercase tracking-wider text-white/35">{{ fact.label }}</dt>
              <dd class="text-white/80">{{ fact.value }}</dd>
            </div>
          </dl>

          <div v-if="links.length">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-white/35 mb-2">Links</p>
            <ul class="space-y-1">
              <li v-for="link in links" :key="link.url">
                <a
                  href="#"
                  @click.prevent="openExternal(link.url)"
                  class="group flex items-center justify-between gap-3 -mx-2 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors"
                >
                  <span class="text-white/80">{{ link.name }}</span>
                  <span class="text-xs text-white/35 truncate group-hover:text-white/55">{{ link.handle }}</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Band members -->
    <section v-if="artistInfo?.members?.length" class="mb-12">
      <h2 class="section-title">Members</h2>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="member in artistInfo.members"
          :key="member"
          @click="goToArtist(member)"
          class="px-3 py-1.5 text-sm text-white/70 bg-white/[0.06] hover:bg-white/[0.10] rounded-full transition-colors"
        >
          {{ member }}
        </button>
      </div>
    </section>

    <!-- Similar artists that are also in the library -->
    <section v-if="similarArtistsInLibrary.length" class="mb-12">
      <h2 class="section-title">Similar Artists in Your Library</h2>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="similar in similarArtistsInLibrary"
          :key="similar"
          @click="goToArtist(similar)"
          class="px-3 py-1.5 text-sm text-white/70 bg-white/[0.06] hover:bg-white/[0.10] rounded-full transition-colors"
        >
          {{ similar }}
        </button>
      </div>
    </section>
  </div>

  <!-- Not found -->
  <div v-else class="flex items-center justify-center h-full">
    <p class="text-white/30">Artist not found</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibraryStore, type Album } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useStatsStore } from '@/stores/stats'
import SongRow from '@/components/SongRow.vue'
import AlbumCard from '@/components/AlbumCard.vue'
import { splitArtists } from '@/utils/splitArtists'
import { songKey } from '@/utils/smartPlaylistMatcher'

const TOP_TRACKS_COLLAPSED = 5
const BIO_CLAMP_CHARS = 400

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const stats = useStatsStore()

const artistInfo = ref<ArtistInfo | null>(null)
const releases = ref<ArtistRelease[]>([])
const streams = ref<ArtistStreams | null>(null)
const loadingInfo = ref(false)
const bioExpanded = ref(false)
const showAllTop = ref(false)

const artistName = computed(() => decodeURIComponent(route.params.name as string))

const artist = computed(() => library.artists.find(a => a.name === artistName.value) || null)

// Newest first; single-track albums are shown too (most loose files are one song from a bigger album)
const libraryAlbums = computed<Album[]>(() => {
  if (!artist.value) return []
  return [...artist.value.albums].sort((a, b) => (b.year || 0) - (a.year || 0))
})

const ownTracks = computed(() => libraryAlbums.value.flatMap(a => a.tracks))

// Tracks where this artist is credited but isn't the album artist
const featuredTracks = computed(() => {
  const name = artistName.value
  if (!name) return []
  const ownIds = new Set(ownTracks.value.map(t => t.id))
  return library.tracks.filter(t => !ownIds.has(t.id) && splitArtists(t.artist).some(a => a === name))
})

const allArtistTracks = computed(() => [...ownTracks.value, ...featuredTracks.value])

const playCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const t of allArtistTracks.value) counts.set(t.id, stats.playCount(songKey(t)))
  return counts
})

const hasPlayHistory = computed(() => [...playCounts.value.values()].some(c => c > 0))

// "Paint The Town Red", "Born Again (feat. Doja Cat & RAYE)" → comparable keys without feature credits
function songMatchKey(title: string) {
  return title
    .toLowerCase()
    .replace(/[([](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Library track id → Spotify streams (kworb), for tracks that could be matched by title
const streamsByTrack = computed(() => {
  const out = new Map<string, number>()
  if (!streams.value?.songs.length) return out
  const byKey = new Map<string, number>()
  for (const s of streams.value.songs) {
    const key = songMatchKey(s.title)
    // kworb lists the most streamed version first; keep that one for duplicate titles
    if (!byKey.has(key)) byKey.set(key, s.streams)
  }
  for (const t of allArtistTracks.value) {
    const n = byKey.get(songMatchKey(t.title))
    if (n) out.set(t.id, n)
  }
  return out
})

// Most played first; without play history, most streamed on Spotify, then newest
const topTracks = computed(() =>
  [...allArtistTracks.value].sort((a, b) =>
    (playCounts.value.get(b.id) || 0) - (playCounts.value.get(a.id) || 0)
    || (streamsByTrack.value.get(b.id) || 0) - (streamsByTrack.value.get(a.id) || 0)
    || (b.year || 0) - (a.year || 0)
  )
)

const topTracksLabel = computed(() => {
  if (hasPlayHistory.value) return 'Your most played'
  if (streamsByTrack.value.size) return 'Most streamed on Spotify'
  return 'From your library'
})

const visibleTopTracks = computed(() =>
  showAllTop.value ? topTracks.value : topTracks.value.slice(0, TOP_TRACKS_COLLAPSED)
)

const today = new Date().toISOString().slice(0, 10)
// Deezer can list announced releases ahead of time, so skip anything not out yet
const latestRelease = computed(() => releases.value.find(r => r.releaseDate && r.releaseDate <= today) || null)

function normalizeTitle(s: string) {
  return s.toLowerCase().replace(/\s+-\s+(single|ep)$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const latestInLibraryAlbum = computed<Album | null>(() => {
  if (!latestRelease.value) return null
  const target = normalizeTitle(latestRelease.value.title)
  return library.albums.find(a => normalizeTitle(a.name) === target
    && a.tracks.some(t => splitArtists(t.artist).includes(artistName.value) || a.artist === artistName.value)) || null
})
const latestInLibrary = computed(() => !!latestInLibraryAlbum.value)

const heroMeta = computed(() => {
  const parts: string[] = []
  const genres = (artistInfo.value?.tags || []).slice(0, 3).map(capitalize)
  if (genres.length) parts.push(genres.join(', '))
  const n = allArtistTracks.value.length
  parts.push(`${n} ${n === 1 ? 'song' : 'songs'} in your library`)
  if (streams.value?.totalStreams) parts.push(`${compactNumber(streams.value.totalStreams)} Spotify streams`)
  if (artistInfo.value?.fans) parts.push(`${compactNumber(artistInfo.value.fans)} fans on Deezer`)
  return parts
})

const facts = computed(() => {
  const info = artistInfo.value
  if (!info) return []
  const out: { label: string; value: string }[] = []
  const isPerson = info.type === 'Person'
  if (info.beginDate) {
    out.push({ label: isPerson ? 'Born' : 'Formed', value: formatDate(info.beginDate) })
  }
  if (info.endDate) out.push({ label: isPerson ? 'Died' : 'Disbanded', value: formatDate(info.endDate) })
  if (info.country) out.push({ label: 'From', value: countryName(info.country) })
  if (info.tags?.length) out.push({ label: 'Genres', value: info.tags.map(capitalize).join(', ') })
  if (streams.value?.totalStreams) {
    const s = streams.value
    const updated = s.lastUpdated ? ` · updated ${formatDate(s.lastUpdated.replace(/\//g, '-'))}` : ''
    out.push({
      label: 'Spotify',
      value: `${s.totalStreams.toLocaleString()} streams (${compactNumber(s.dailyStreams)}/day)${updated}`,
    })
  }
  return out
})

// Website first, then socials, each labelled with the account handle so duplicates are distinguishable
const links = computed(() => {
  const info = artistInfo.value
  if (!info) return []
  const out: { name: string; url: string; handle: string }[] = []
  if (info.website) out.push({ name: 'Website', url: info.website, handle: hostOf(info.website) })
  for (const s of info.socials || []) out.push({ name: s.name, url: s.url, handle: handleOf(s.url) })
  return out
})

const localArtistNames = computed(() => new Set(library.artists.map(a => a.name)))

const similarArtistsInLibrary = computed(() =>
  (artistInfo.value?.similarArtists ?? []).filter(name => localArtistNames.value.has(name) && name !== artistName.value)
)

function capitalize(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

function compactNumber(n: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function countryName(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return code
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

// MusicBrainz / Deezer dates can be YYYY, YYYY-MM or YYYY-MM-DD
function formatDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  if (!m) return String(y)
  const opts: Intl.DateTimeFormatOptions = d
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'long' }
  return new Date(y, m - 1, d || 1).toLocaleDateString(undefined, opts)
}

function releaseTypeLabel(type: string) {
  switch (type) {
    case 'single': return 'Single'
    case 'ep': return 'EP'
    case 'compile': return 'Compilation'
    default: return 'Album'
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// "https://www.instagram.com/dojidoj/" → "@dojidoj"; numeric IDs (e.g. Weibo) fall back to the host
function handleOf(url: string) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean)[0]?.replace(/^@/, '')
    if (!segment || /^\d+$/.test(segment)) return hostOf(url)
    return `@${segment}`
  } catch {
    return url
  }
}

function openExternal(url: string) {
  window.api.openExternal(url)
}

function goToArtist(name: string) {
  router.push(`/artist/${encodeURIComponent(name)}`)
}

function openLatestRelease() {
  if (latestInLibraryAlbum.value) {
    router.push(`/album/${latestInLibraryAlbum.value.id}`)
  } else if (latestRelease.value?.url) {
    openExternal(latestRelease.value.url)
  }
}

function playAll(shuffle: boolean) {
  const tracks = allArtistTracks.value
  if (!tracks.length) return
  player.isShuffle = shuffle
  player.playAll(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0)
}

async function fetchArtistInfo(forceRefresh = false) {
  if (!artistName.value) return
  const name = artistName.value
  loadingInfo.value = true
  // Not awaited: a cold Spotify ID lookup waits on MusicBrainz rate limits
  window.api.getArtistStreams(name, forceRefresh)
    .then(s => { if (name === artistName.value) streams.value = s })
    .catch(err => console.error('Failed to fetch artist streams:', err))
  try {
    const [info, rel] = await Promise.all([
      window.api.getArtistInfo(name, forceRefresh),
      window.api.getArtistReleases(name, forceRefresh),
    ])
    // Ignore results for an artist we've since navigated away from
    if (name !== artistName.value) return
    artistInfo.value = info
    releases.value = rel
  } catch (err) {
    console.error('Failed to fetch artist info:', err)
  } finally {
    loadingInfo.value = false
  }
}

function refresh() {
  fetchArtistInfo(true)
}

onMounted(() => fetchArtistInfo())
onActivated(() => fetchArtistInfo())

watch(artistName, () => {
  artistInfo.value = null
  releases.value = []
  streams.value = null
  bioExpanded.value = false
  showAllTop.value = false
  fetchArtistInfo()
})
</script>

<style scoped>
.section-title {
  @apply text-xl font-bold text-white mb-4;
}

.explicit-badge {
  @apply inline-flex items-center justify-center w-4 h-4 ml-1 rounded-sm bg-white/20 text-[9px] font-bold text-white/70 align-middle;
}

/* Fade the photo's left edge into the blurred backdrop so the name stays readable */
.hero-photo-fade {
  mask-image: linear-gradient(to right, transparent 0%, black 45%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 45%);
}
</style>
