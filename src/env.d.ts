/// <reference types="vite/client" />

declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Track {
  id: string
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  track: number
  disc: number
  duration: number
  genre: string
  year: number
  coverArt: string | null
  source?: 'local' | 'subsonic'
  // Extended metadata for credits
  composer?: string
  lyricist?: string
  conductor?: string
  producer?: string
  engineer?: string
  mixer?: string
  remixer?: string
  label?: string
  copyright?: string
  encodedBy?: string
  comment?: string
  bpm?: number
  // Stats / smart playlist fields
  mbid?: string
  addedAt?: number
  bitrate?: number
}

interface PlayEvent {
  ts: number
  key: string
  title: string
  artist: string
  album: string
  duration: number
  playedFor: number
}

interface TrackCredits {
  composer: string[]
  lyricist: string[]
  conductor: string[]
  producer: string[]
  engineer: string[]
  mixer: string[]
  remixer: string[]
  writer: string[]
  label: string[]
  copyright: string
  encodedBy: string
  comment: string
  bpm: number | null
  bitrate: number | null
  sampleRate: number | null
  bitsPerSample: number | null
  codec: string
  lossless: boolean
}

interface ArtistInfo {
  name: string
  disambiguation?: string
  type?: string
  country?: string
  beginDate?: string
  endDate?: string
  tags?: string[]
  bio?: string
  imageUrl?: string | null
  website?: string
  socials?: { name: string; url: string }[]
  members?: string[]
  similarArtists?: string[]
  /** Deezer fan count (0 when unknown) */
  fans?: number
  /** Spotify artist ID from MusicBrainz ('' when unknown) */
  spotifyId?: string
}

/** Spotify stream counts scraped from kworb.net */
interface ArtistStreams {
  spotifyId: string
  /** As printed by kworb, e.g. "2026/10/11" */
  lastUpdated: string
  totalStreams: number
  dailyStreams: number
  /** `feature` is true for tracks where the artist is only featured */
  songs: { title: string; streams: number; daily: number; feature: boolean }[]
}

interface ArtistRelease {
  title: string
  /** Deezer record type: 'album' | 'single' | 'ep' | 'compile' */
  type: string
  /** YYYY-MM-DD */
  releaseDate: string
  coverUrl: string | null
  url: string
  explicit: boolean
}

interface SmartPlaylistRule {
  field: 'genre' | 'year' | 'artist' | 'album' | 'duration' | 'title' | 'bpm' | 'playCount' | 'recentlyAdded' | 'format' | 'bitrate' | 'tag'
  operator: 'is' | 'contains' | 'not_contains' | 'gt' | 'lt' | 'between' | 'equals' | 'greater' | 'less' | 'starts' | 'has_tag' | 'not_has_tag'
  value: string
  value2?: string // for 'between'
}

interface TrackMetaSnapshot {
  title: string
  artist: string
  album: string
}

interface Playlist {
  id: string
  name: string
  description?: string
  trackIds: string[]
  trackMeta?: Record<string, TrackMetaSnapshot>
  createdAt: number
  updatedAt: number
  smart?: boolean
  rules?: SmartPlaylistRule[]
  ruleMatch?: 'all' | 'any'
  customImage?: string
}

interface SyncConfig {
  enabled: boolean
  folder: string
  syncPlaylists: boolean
  syncFavorites: boolean
  syncStats: boolean
  syncTags: boolean
}

interface FolderEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FolderEntry[]
  trackCount?: number
}

interface Window {
  api: {
    scanFolder: (path: string) => Promise<Track[]>
    getLibrary: () => Promise<Track[]>
    getFolders: () => Promise<string[]>
    removeFolder: (path: string) => Promise<{ folders: string[]; tracks: Track[] }>
    openFolderDialog: () => Promise<string | null>
    getLyrics: (trackPath: string) => Promise<string | null>
    fetchOnlineLyrics: (trackInfo: { path: string; title: string; artist: string; album: string; duration: number }) => Promise<string | null>
    minimize: () => void
    maximize: () => void
    close: () => void
    enterFullscreen: () => void
    exitFullscreen: () => void
    setWindowOpacity: (value: number) => void
    enterMiniPlayer: () => void
    exitMiniPlayer: () => void
    resizeMiniPlayer: (height: number) => void
    // Window state events
    onWindowStateChange: (callback: (state: { maximized: boolean; fullscreen: boolean }) => void) => void
    removeWindowStateChangeListener: () => void
    // App lifecycle
    relaunchApp: () => void
    // Audio exclusive mode
    getExclusiveStatus: () => Promise<{ active: boolean; alsaDevice: string; platform: string }>
    listAlsaDevices: () => Promise<{ id: string; name: string; label: string }[]>
    getSettings: () => Promise<any>
    saveSettings: (settings: any) => Promise<void>
    mergeSettings: (partial: Record<string, any>) => Promise<void>
    // Favorites
    getFavorites: () => Promise<{ ids: string[]; meta: Record<string, TrackMetaSnapshot> }>
    toggleFavorite: (trackId: string, meta?: TrackMetaSnapshot) => Promise<{ ids: string[]; meta: Record<string, TrackMetaSnapshot> }>
    setFavorites: (ids: string[], meta?: Record<string, TrackMetaSnapshot>) => Promise<{ ids: string[]; meta: Record<string, TrackMetaSnapshot> }>
    // Tags
    getTags: () => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    setTrackTags: (ids: string[], tags: string[]) => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    setAlbumTags: (albumKeys: string[], tags: string[]) => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    addTrackTags: (ids: string[], tagsToAdd: string[]) => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    addAlbumTags: (albumKeys: string[], tagsToAdd: string[]) => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    removeTrackTags: (ids: string[], tagsToRemove: string[]) => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    removeAlbumTags: (albumKeys: string[], tagsToRemove: string[]) => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    applyTagsSync: (merged: { trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }) => Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }>
    updateDiscordPresence: (data: any) => Promise<void>
    toggleDiscordRPC: (enabled: boolean, clientId?: string) => Promise<void>
    setTrayEnabled: (enabled: boolean) => Promise<void>
    getPlaylists: () => Promise<Playlist[]>
    getPlaylist: (id: string) => Promise<Playlist | null>
    createPlaylist: (name: string) => Promise<Playlist>
    deletePlaylist: (id: string) => Promise<Playlist[]>
    renamePlaylist: (id: string, name: string) => Promise<Playlist | null>
    editPlaylist: (id: string, data: { name?: string; description?: string; customImage?: string | null }) => Promise<Playlist | null>
    addTracksToPlaylist: (id: string, trackIds: string[], trackMeta?: Record<string, TrackMetaSnapshot>) => Promise<Playlist | null>
    removeTrackFromPlaylist: (id: string, trackId: string) => Promise<Playlist | null>
    getMediaUrl: (filePath: string) => string
    onScanProgress: (callback: (data: { current: number; total: number }) => void) => void
    removeScanProgressListener: () => void
    // Credits
    getTrackCredits: (trackPath: string) => Promise<TrackCredits>
    // Waveform
    generateWaveform: (trackPath: string) => Promise<number[]>
    generateWaveformSubsonic: (songId: string) => Promise<number[]>
    // Artist info
    getArtistInfo: (artistName: string, forceRefresh?: boolean) => Promise<ArtistInfo | null>
    getArtistReleases: (artistName: string, forceRefresh?: boolean) => Promise<ArtistRelease[]>
    getArtistStreams: (artistName: string, forceRefresh?: boolean) => Promise<ArtistStreams | null>
    // Folder structure
    getFolderTree: (folderPath: string) => Promise<FolderEntry[]>
    // Scrobbling
    scrobbleTrack: (data: { title: string; artist: string; album: string; duration: number; timestamp: number }) => Promise<boolean>
    updateNowPlaying: (data: { title: string; artist: string; album: string; duration: number }) => Promise<boolean>
    // Smart playlists
    createSmartPlaylist: (name: string, rules: SmartPlaylistRule[], ruleMatch: 'all' | 'any') => Promise<Playlist>
    updateSmartPlaylist: (id: string, rules: SmartPlaylistRule[], ruleMatch: 'all' | 'any') => Promise<Playlist | null>
    // Playlist reorder & M3U
    reorderPlaylistTracks: (id: string, fromIndex: number, toIndex: number) => Promise<Playlist | null>
    exportPlaylistM3U: (id: string) => Promise<{ success: boolean; path?: string }>
    importPlaylistM3U: () => Promise<{ playlistId: string; matched: number; unmatched: string[] } | null>
    // Stats
    statsLoad: () => Promise<{ deviceId: string; events: PlayEvent[] }>
    statsAppend: (event: PlayEvent) => Promise<boolean>
    // Sync
    syncGetConfig: () => Promise<SyncConfig>
    syncSetConfig: (config: SyncConfig) => Promise<void>
    syncPush: (data: any) => Promise<{ ok: boolean; error?: string }>
    syncPull: () => Promise<{ data: any | null; error: string | null }>
    syncPickFolder: () => Promise<string | null>
    syncWatch: (folder: string) => Promise<void>
    syncUnwatch: () => Promise<void>
    syncApplyPlaylists: (playlists: Playlist[]) => Promise<void>
    syncGetState: () => Promise<{ deviceId: string; favoritesUpdatedAt: number; deletedPlaylistIds: { id: string; deletedAt: number }[] }>
    syncGetStatsEvents: () => Promise<PlayEvent[]>
    syncPushStats: (deviceId: string, events: PlayEvent[]) => Promise<{ ok: boolean; error?: string }>
    syncPullStats: (ownDeviceId: string) => Promise<{ remoteDeviceId: string; events: PlayEvent[] }[]>
    syncApplyRemoteStats: (remoteDeviceId: string, events: PlayEvent[]) => Promise<void>
    onSyncFileChanged: (callback: () => void) => void
    removeSyncFileChangedListener: () => void
    // Cache management
    resetCache: (targets: string[]) => Promise<Record<string, boolean>>
    // File explorer
    showInExplorer: (filePath: string) => Promise<void>
    openPath: (dirPath: string) => Promise<void>
    // MPRIS (renderer → main)
    mprisSendMetadata: (data: { title?: string; artist?: string; album?: string; artUrl?: string; length?: number; trackId?: string }) => void
    mprisSendPlaybackStatus: (status: 'Playing' | 'Paused' | 'Stopped') => void
    mprisSendPosition: (seconds: number) => void
    mprisSendVolume: (vol: number) => void
    mprisSendLoopStatus: (mode: string) => void
    mprisSendShuffle: (enabled: boolean) => void
    mprisSendSeeked: (seconds: number) => void
    getCoverFileUrl: (coverPath: string) => Promise<string>
    // MPRIS commands (main → renderer)
    onMprisCommand: (callback: (command: string, data?: any) => void) => void
    removeMprisCommandListener: () => void
    // Export / Import
    exportRun: (customPath?: string) => Promise<string>
    exportImport: () => Promise<{ settings: boolean; favorites: number; playlists: number } | null>
    exportImportFile: (filePath: string) => Promise<{ settings: boolean; favorites: number; playlists: number } | null>
    exportChooseDir: () => Promise<string | null>
    exportGetDefaultPath: () => Promise<string>
    // Subsonic / Navidrome
    subsonicTest: (config: { url: string; username: string; password: string; useLegacyAuth: boolean }) => Promise<boolean>
    subsonicFetchLibrary: () => Promise<Track[]>
    subsonicGetStreamUrl: (songId: string) => Promise<string>
    subsonicGetCoverUrl: (coverArtId: string) => Promise<string>
    // LRC save / search
    saveLyrics: (trackPath: string, lrcContent: string) => Promise<void>
    searchLyrics: (query: string, tracks: { id: string; path: string }[]) => Promise<string[]>
    // App version & update checking
    getAppVersion: () => Promise<string>
    checkForUpdate: () => Promise<{ currentVersion: string; latestVersion: string; url: string } | null>
    openExternal: (url: string) => Promise<void>
    // Animated covers
    getAnimatedCover: (album: string, artist: string) => Promise<string | null>
    getAnimatedCoverCacheStats: () => Promise<{ count: number }>
    clearAnimatedCoverCache: () => Promise<{ ok: boolean }>
    // Logging
    getLogPath: () => Promise<string>
    log: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => void
    // App lifecycle
    onBeforeQuit: (callback: () => void) => void
    quitReady: () => void
    // Remote control
    onRemoteCommand: (callback: (command: string, data?: any) => void) => void
    removeRemoteCommandListener: () => void
    onRemoteRequest: (callback: (requestType: string) => void) => void
    removeRemoteRequestListener: () => void
    sendRemoteResponse: (requestType: string, data: any) => void
    sendRemoteState: (state: any) => void
    onRemoteDeviceAdded: (callback: (device: { name: string; ip: string }) => void) => void
    removeRemoteDeviceAddedListener: () => void
    onRemotePinChanged: (callback: (pin: string) => void) => void
    removeRemotePinChangedListener: () => void
    getRemoteConfig: () => Promise<{ enabled: boolean; pin: string; trustedDevices: { name: string; ip: string; createdAt: number; lastSeen: number }[]; lanIp: string; lanIps: string[]; port: number }>
    setRemoteEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>
    remoteRegeneratePin: () => Promise<{ pin: string }>
    remoteRemoveDevice: (index: number) => Promise<{ name: string; ip: string; createdAt: number; lastSeen: number }[]>
    remoteRemoveAllDevices: () => Promise<[]>
    remoteStartServer: () => Promise<void>
    remoteStopServer: () => Promise<void>
    // Themes
    themesGetAll: () => Promise<any[]>
    themesInstall: (theme: any) => Promise<void>
    themesRemove: (themeId: string) => Promise<void>
    themesOpenFolder: () => Promise<void>
    onThemesDirectoryChanged: (callback: () => void) => void
    removeThemesDirectoryChangedListener: () => void
    // Plugins
    pluginsGetAll: () => Promise<any[]>
    pluginsReadFile: (pluginId: string, fileName: string) => Promise<string>
    pluginsInstall: (sourcePath: string) => Promise<void>
    pluginsRemove: (pluginId: string) => Promise<void>
    pluginsGetSettings: (pluginId: string) => Promise<any>
    pluginsSaveSettings: (pluginId: string, data: any) => Promise<void>
    pluginsOpenFolder: () => Promise<void>
    pluginsIpcInvoke: (channel: string, ...args: any[]) => Promise<any>
    pluginsIpcSend: (channel: string, ...args: any[]) => void
    onPluginEvent: (channel: string, callback: (...args: any[]) => void) => () => void
    // Playlist custom image
    openImageDialog: () => Promise<string | null>
    setPlaylistCustomImage: (id: string, imagePath: string | null) => Promise<Playlist | null>
    // Open-with / file association
    getOpenFiles: () => Promise<string[]>
    parseFile: (filePath: string) => Promise<Track>
    onOpenFiles: (callback: (paths: string[]) => void) => void
    removeOpenFilesListener: () => void
  }
}
