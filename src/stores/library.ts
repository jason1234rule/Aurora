import { defineStore } from 'pinia'
import { ref, shallowRef, computed, markRaw, watch } from 'vue'
import { splitArtists } from '@/utils/splitArtists'
import { useTagsStore } from './tags'
import { coverColor, cachedCoverColor, colorOrder, type CoverColor } from '@/utils/coverColor'

export type SortOrder = 'title' | 'artist' | 'album' | 'year' | 'duration'
export type AlbumSortOrder = 'name' | 'artist' | 'year' | 'tracks' | 'color'

export interface Album {
  id: string
  name: string
  artist: string
  coverArt: string | null
  year: number
  tracks: Track[]
}

export interface Artist {
  name: string
  albums: Album[]
  trackCount: number
}

/** Strip diacritics for lenient matching: bôa → boa, Ñ → N, etc. */
function normalize(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export const useLibraryStore = defineStore('library', () => {
  const localTracks = shallowRef<Track[]>([])
  const subsonicTracks = shallowRef<Track[]>([])
  const pluginTracks = shallowRef<Track[]>([])
  const tracks = computed<Track[]>(() => [...localTracks.value, ...subsonicTracks.value, ...pluginTracks.value])
  const folders = ref<string[]>([])
  const isScanning = ref(false)
  const libraryReady = ref(false)
  const scanProgress = ref({ current: 0, total: 0 })
  const searchQuery = ref('')
  const sortOrder = ref<SortOrder>('title')
  const albumSortOrder = ref<AlbumSortOrder>('name')
  /** Cover colours for the 'color' sort, filled in lazily (cover path → colour) */
  const coverColors = ref<Record<string, CoverColor>>({})
  const searchLyricsEnabled = ref(false)
  const separateSoundtracks = ref(true)
  const includeSinglesInAlbums = ref(false)
  const soundtrackTags = ref<string[]>(['soundtrack'])

  const soundtrackTagSet = computed(() => new Set(soundtrackTags.value))

  // ── Computed ─────────────────────────────────────────────────────────────
  const albums = computed<Album[]>(() => {
    const map = new Map<string, Album>()

    for (const track of tracks.value) {
      const key = `${track.album}---${track.albumArtist}`
      if (!map.has(key)) {
        map.set(key, {
          id: key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
          name: track.album,
          artist: track.albumArtist,
          coverArt: track.coverArt,
          year: track.year,
          tracks: [],
        })
      }
      map.get(key)!.tracks.push(track)
    }

    for (const album of map.values()) {
      album.tracks.sort((a, b) => (a.disc !== b.disc ? a.disc - b.disc : a.track - b.track))
    }

    const list = Array.from(map.values())
    switch (albumSortOrder.value) {
      case 'artist':
        return list.sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name))
      case 'year':
        return list.sort((a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name))
      case 'tracks':
        return list.sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name))
      case 'color':
        return colorOrder(list.sort((a, b) => a.name.localeCompare(b.name)), albumColor)
      case 'name':
      default:
        return list.sort((a, b) => a.name.localeCompare(b.name))
    }
  })

  function albumColor(a: Album): CoverColor | undefined {
    return a.coverArt ? coverColors.value[a.coverArt] ?? cachedCoverColor(a.coverArt) : undefined
  }

  const visibleAlbums = computed<Album[]>(() => {
    const tagsStore = useTagsStore()
    const visible = albums.value.filter((album) => {
      if (!includeSinglesInAlbums.value && album.tracks.length <= 1) return false
      if (!separateSoundtracks.value) return true
      const key = `${album.name}---${album.artist}`
      const tags = tagsStore.getAlbumTags(key)
      return !tags.some(tag => soundtrackTagSet.value.has(tag))
    })
    // The colour chain links each cover to its nearest neighbour, so it has to be built
    // from the albums actually shown: hidden singles would otherwise sit between look-alikes
    return albumSortOrder.value === 'color' ? colorOrder(visible, albumColor) : visible
  })

  const filteredAlbums = computed<Album[]>(() => {
    if (!searchQuery.value) return visibleAlbums.value
    const q = normalize(searchQuery.value)
    return visibleAlbums.value.filter(
      (a) =>
        normalize(a.name).includes(q) ||
        normalize(a.artist).includes(q) ||
        a.tracks.some((t) => normalize(t.title).includes(q)),
    )
  })

  const searchAlbums = computed<Album[]>(() => {
    if (!searchQuery.value) return []
    const q = normalize(searchQuery.value)
    return albums.value.filter(
      (a) =>
        normalize(a.name).includes(q) ||
        normalize(a.artist).includes(q) ||
        a.tracks.some((t) => normalize(t.title).includes(q)),
    )
  })

  const artists = computed<Artist[]>(() => {
    const map = new Map<string, Artist>()

    function ensureArtist(name: string): Artist {
      if (!map.has(name)) {
        map.set(name, { name, albums: [], trackCount: 0 })
      }
      return map.get(name)!
    }

    // Add albums to each individual artist from the album artist field
    for (const album of albums.value) {
      const names = splitArtists(album.artist)
      const added = new Set<string>()
      for (const name of names) {
        const artist = ensureArtist(name)
        if (!added.has(name)) {
          artist.albums.push(album)
          artist.trackCount += album.tracks.length
          added.add(name)
        }
      }
    }

    // Recompute trackCount from actual tracks for main artists only.
    // Do NOT call ensureArtist here — that would create entries for featured
    // artists who appear in track.artist but are not any album's albumArtist.
    for (const artist of map.values()) artist.trackCount = 0

    for (const track of tracks.value) {
      const names = new Set([
        ...splitArtists(track.artist),
        ...splitArtists(track.albumArtist || ''),
      ])
      for (const name of names) {
        // Only increment for artists already in the map (i.e. they own at least one album)
        const a = map.get(name)
        if (a) a.trackCount++
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  const filteredTracks = computed(() => {
    if (!searchQuery.value) return tracks.value
    const q = normalize(searchQuery.value)
    return tracks.value.filter(
      (t) =>
        normalize(t.title).includes(q) ||
        normalize(t.artist).includes(q) ||
        normalize(t.album).includes(q),
    )
  })

  const sortedTracks = computed(() => {
    const list = [...filteredTracks.value]
    switch (sortOrder.value) {
      case 'artist':
        return list.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || a.track - b.track)
      case 'album':
        return list.sort((a, b) => a.album.localeCompare(b.album) || a.disc - b.disc || a.track - b.track)
      case 'year':
        return list.sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title))
      case 'duration':
        return list.sort((a, b) => a.duration - b.duration)
      case 'title':
      default:
        return list.sort((a, b) => a.title.localeCompare(b.title))
    }
  })

  /** Returns 'albums' if albums match best, 'songs' if only songs match, null if no results */
  const bestSearchTab = computed<'albums' | 'songs' | null>(() => {
    if (!searchQuery.value) return null
    const albumCount = filteredAlbums.value.length
    const trackCount = filteredTracks.value.length
    if (albumCount === 0 && trackCount === 0) return null
    if (albumCount > 0) return 'albums'
    return 'songs'
  })

  function setSortOrder(order: SortOrder) {
    sortOrder.value = order
    window.api.mergeSettings({ sortOrder: order })
  }

  // Analyse covers that haven't been yet whenever the colour sort is on. The source is
  // the sorted set of cover paths, so re-sorting as colours arrive doesn't retrigger it.
  let colorRun = 0
  watch(
    () => albumSortOrder.value === 'color'
      ? [...new Set(albums.value.map(a => a.coverArt).filter((c): c is string => !!c))].sort().join('\n')
      : '',
    async (joined) => {
      const run = ++colorRun
      const todo = joined ? joined.split('\n').filter(c => !coverColors.value[c] && !cachedCoverColor(c)) : []
      for (let i = 0; i < todo.length; i += 8) {
        const batch = todo.slice(i, i + 8)
        const results = await Promise.all(batch.map(coverColor))
        if (run !== colorRun) return // the cover set changed; a newer run carries on
        const next = { ...coverColors.value }
        batch.forEach((c, j) => { if (results[j]) next[c] = results[j]! })
        coverColors.value = next
      }
    },
    { immediate: true },
  )

  function setAlbumSortOrder(order: AlbumSortOrder) {
    albumSortOrder.value = order
    window.api.mergeSettings({ albumSortOrder: order })
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async function loadLibrary() {
    const [rawTracks, rawFolders, settings] = await Promise.all([
      window.api.getLibrary(),
      window.api.getFolders(),
      window.api.getSettings(),
    ])
    localTracks.value = rawTracks.map((t: Track) => markRaw(t))
    folders.value = rawFolders
    searchLyricsEnabled.value = settings.searchLyricsEnabled === true
    separateSoundtracks.value = settings.separateSoundtracks !== false
    includeSinglesInAlbums.value = settings.includeSinglesInAlbums === true
    soundtrackTags.value = parseTagList(settings.soundtrackTags, ['soundtrack'])
    libraryReady.value = true

    // Auto-load subsonic library if configured
    autoLoadSubsonic()
  }

  function setSearchLyricsEnabled(enabled: boolean) {
    searchLyricsEnabled.value = enabled
    window.api.mergeSettings({ searchLyricsEnabled: enabled })
  }

  function setSeparateSoundtracks(enabled: boolean) {
    separateSoundtracks.value = enabled
    window.api.mergeSettings({ separateSoundtracks: enabled })
  }

  function setIncludeSinglesInAlbums(enabled: boolean) {
    includeSinglesInAlbums.value = enabled
    window.api.mergeSettings({ includeSinglesInAlbums: enabled })
  }

  function parseTagList(input: unknown, fallback: string[]): string[] {
    if (Array.isArray(input)) {
      const normalized = input
        .map(v => String(v).toLowerCase().trim())
        .filter(Boolean)
      return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback
    }
    if (typeof input === 'string') {
      const normalized = input
        .split(',')
        .map(v => v.toLowerCase().trim())
        .filter(Boolean)
      return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback
    }
    return fallback
  }

  function setSoundtrackTags(tags: string[]) {
    const normalized = parseTagList(tags, ['soundtrack'])
    soundtrackTags.value = normalized
    window.api.mergeSettings({ soundtrackTags: normalized })
  }

  async function addFolder() {
    const folderPath = await window.api.openFolderDialog()
    if (!folderPath) return

    isScanning.value = true
    scanProgress.value = { current: 0, total: 0 }

    window.api.onScanProgress((data) => {
      scanProgress.value = data
    })

    try {
      const rawTracks = await window.api.scanFolder(folderPath)
      localTracks.value = rawTracks.map((t: Track) => markRaw(t))
      folders.value = await window.api.getFolders()
    } finally {
      isScanning.value = false
      window.api.removeScanProgressListener()
    }
  }

  async function removeFolder(folderPath: string) {
    const result = await window.api.removeFolder(folderPath)
    localTracks.value = result.tracks.map((t: Track) => markRaw(t))
    folders.value = result.folders
  }

  async function rescanAll() {
    isScanning.value = true
    scanProgress.value = { current: 0, total: 0 }
    window.api.onScanProgress((data) => {
      scanProgress.value = data
    })

    try {
      for (const folder of folders.value) {
        const rawTracks = await window.api.scanFolder(folder)
        localTracks.value = rawTracks.map((t: Track) => markRaw(t))
      }
      // Also re-fetch subsonic library if connected
      await autoLoadSubsonic()
    } finally {
      isScanning.value = false
      window.api.removeScanProgressListener()
    }
  }

  function getAlbumById(id: string): Album | undefined {
    return albums.value.find((a) => a.id === id)
  }

  /** Merge Subsonic tracks from server into the library */
  function mergeSubsonicTracks(rawTracks: Track[]) {
    subsonicTracks.value = rawTracks.map((t: Track) => markRaw({ ...t, source: 'subsonic' as const }))
  }

  /** Remove all subsonic tracks from the library */
  function clearSubsonicTracks() {
    subsonicTracks.value = []
  }

  /** Add or replace plugin-injected tracks (e.g. saved stream URLs from plugins) */
  function addPluginTracks(newTracks: Track[]) {
    const existing = pluginTracks.value.filter(t => !newTracks.some(n => n.id === t.id))
    pluginTracks.value = [...existing, ...newTracks.map(t => markRaw(t))]
  }

  /** Remove plugin-injected tracks by ID */
  function removePluginTracks(ids: string[]) {
    const set = new Set(ids)
    pluginTracks.value = pluginTracks.value.filter(t => !set.has(t.id))
  }

  /** Auto-load subsonic library if previously connected */
  async function autoLoadSubsonic() {
    try {
      const settings = await window.api.getSettings()
      if (settings.subsonicConnected && settings.subsonicUrl && settings.subsonicUsername && settings.subsonicPassword) {
        // Re-authenticate
        const ok = await window.api.subsonicTest({
          url: settings.subsonicUrl,
          username: settings.subsonicUsername,
          password: settings.subsonicPassword,
          useLegacyAuth: settings.subsonicLegacyAuth === true,
        })
        if (ok) {
          const remoteTracks = await window.api.subsonicFetchLibrary()
          mergeSubsonicTracks(remoteTracks)
        }
      }
    } catch {
      // Silently ignore — subsonic is optional
    }
  }

  // ── Remote control: respond to library data requests ────────────────
  window.api.onRemoteRequest((requestType: string) => {
    if (requestType === 'getTracks') {
      const trackData = tracks.value.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumArtist: t.albumArtist,
        coverArt: t.coverArt,
        duration: t.duration,
        trackNumber: t.track,
      }))
      window.api.sendRemoteResponse('getTracks', trackData)
    }

    if (requestType === 'getAlbums') {
      const albumData = albums.value.map(a => ({
        key: `${a.name}---${a.artist}`,
        name: a.name,
        artist: a.artist,
        coverArt: a.coverArt,
        trackCount: a.tracks.length,
        year: a.year,
      }))
      window.api.sendRemoteResponse('getAlbums', albumData)
    }

    if (requestType === 'getPlaylists') {
      // Forward to playlist store — access via global to avoid require('@/') in Vite bundle
      const playlistStore = (window as any).__auroraPlaylistStore
      const playlistData = playlistStore.sortedPlaylists.map((p: any) => ({
        id: p.id,
        name: p.name,
        trackCount: p.trackIds.length,
        coverArt: p.customImage || null,
      }))
      window.api.sendRemoteResponse('getPlaylists', playlistData)
    }

    if (requestType.startsWith('getPlaylistTracks:')) {
      const playlistId = requestType.slice('getPlaylistTracks:'.length)
      const playlistStore = (window as any).__auroraPlaylistStore
      const trackData = playlistStore ? playlistStore.getPlaylistTracks(playlistId).map((t: Track) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumArtist: t.albumArtist,
        coverArt: t.coverArt,
        duration: t.duration,
        trackNumber: t.track,
      })) : []
      window.api.sendRemoteResponse(requestType, trackData)
    }

    if (requestType === 'getFavorites') {
      const favoritesStore = (window as any).__auroraFavoritesStore
      const trackData = favoritesStore ? favoritesStore.favoriteTracks.map((t: Track) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumArtist: t.albumArtist,
        coverArt: t.coverArt,
        duration: t.duration,
        trackNumber: t.track,
      })) : []
      window.api.sendRemoteResponse('getFavorites', trackData)
    }
  })

  return {
    tracks,
    folders,
    isScanning,
    libraryReady,
    scanProgress,
    searchQuery,
    sortOrder,
    albumSortOrder,
    searchLyricsEnabled,
    separateSoundtracks,
    includeSinglesInAlbums,
    soundtrackTags,
    albums,
    visibleAlbums,
    filteredAlbums,
    searchAlbums,
    artists,
    filteredTracks,
    sortedTracks,
    bestSearchTab,
    loadLibrary,
    addFolder,
    removeFolder,
    rescanAll,
    getAlbumById,
    setSortOrder,
    setAlbumSortOrder,
    setSearchLyricsEnabled,
    setSeparateSoundtracks,
    setIncludeSinglesInAlbums,
    setSoundtrackTags,
    mergeSubsonicTracks,
    clearSubsonicTracks,
    addPluginTracks,
    removePluginTracks,
  }
})
