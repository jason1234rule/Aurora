import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Library
  scanFolder: (path: string) => ipcRenderer.invoke('library:scan-folder', path),
  getLibrary: () => ipcRenderer.invoke('library:get-data'),
  getFolders: () => ipcRenderer.invoke('library:get-folders'),
  removeFolder: (path: string) => ipcRenderer.invoke('library:remove-folder', path),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),

  // Lyrics
  getLyrics: (trackPath: string) => ipcRenderer.invoke('lyrics:get', trackPath),
  fetchOnlineLyrics: (trackInfo: { path: string; title: string; artist: string; album: string; duration: number }) =>
    ipcRenderer.invoke('lyrics:fetch-online', trackInfo),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  enterFullscreen: () => ipcRenderer.send('window:enter-fullscreen'),
  exitFullscreen: () => ipcRenderer.send('window:exit-fullscreen'),
  setWindowOpacity: (value: number) => ipcRenderer.send('window:set-opacity', value),
  enterMiniPlayer: () => ipcRenderer.send('window:enter-mini'),
  exitMiniPlayer: () => ipcRenderer.send('window:exit-mini'),
  resizeMiniPlayer: (height: number) => ipcRenderer.send('window:resize-mini', height),

  // Window state events (OS-level maximize/fullscreen)
  onWindowStateChange: (callback: (state: { maximized: boolean; fullscreen: boolean }) => void) => {
    ipcRenderer.on('window:state-changed', (_, state) => callback(state))
  },
  removeWindowStateChangeListener: () => {
    ipcRenderer.removeAllListeners('window:state-changed')
  },

  // App lifecycle
  relaunchApp: () => ipcRenderer.send('app:relaunch'),

  // Audio exclusive mode
  getExclusiveStatus: (): Promise<{ active: boolean; alsaDevice: string; platform: string }> =>
    ipcRenderer.invoke('audio:exclusive-status'),
  listAlsaDevices: (): Promise<{ id: string; name: string; label: string }[]> =>
    ipcRenderer.invoke('audio:list-alsa-devices'),

  // App paths
  getAppPaths: (): Promise<{ config: string; data: string; cache: string; state: string }> =>
    ipcRenderer.invoke('app:get-paths'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:set', settings),
  mergeSettings: (partial: Record<string, any>) => ipcRenderer.invoke('settings:merge', partial),

  // Favorites
  getFavorites: (): Promise<{ ids: string[]; meta: Record<string, { title: string; artist: string; album: string }> }> => ipcRenderer.invoke('favorites:get'),
  toggleFavorite: (trackId: string, meta?: { title: string; artist: string; album: string }): Promise<{ ids: string[]; meta: Record<string, { title: string; artist: string; album: string }> }> => ipcRenderer.invoke('favorites:toggle', trackId, meta),
  setFavorites: (ids: string[], meta?: Record<string, { title: string; artist: string; album: string }>): Promise<{ ids: string[]; meta: Record<string, { title: string; artist: string; album: string }> }> => ipcRenderer.invoke('favorites:set', ids, meta),

  // Tags
  getTags: (): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:get'),
  setTrackTags: (ids: string[], tags: string[]): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:set-track-tags', ids, tags),
  setAlbumTags: (albumKeys: string[], tags: string[]): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:set-album-tags', albumKeys, tags),
  addTrackTags: (ids: string[], tagsToAdd: string[]): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:add-track-tags', ids, tagsToAdd),
  addAlbumTags: (albumKeys: string[], tagsToAdd: string[]): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:add-album-tags', albumKeys, tagsToAdd),
  removeTrackTags: (ids: string[], tagsToRemove: string[]): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:remove-track-tags', ids, tagsToRemove),
  removeAlbumTags: (albumKeys: string[], tagsToRemove: string[]): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:remove-album-tags', albumKeys, tagsToRemove),
  applyTagsSync: (merged: { trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> => ipcRenderer.invoke('tags:apply-sync', merged),

  // Hand-made transitions
  getTransitions: () => ipcRenderer.invoke('transitions:get'),
  saveTransition: (transition: any) => ipcRenderer.invoke('transitions:save', transition),
  deleteTransition: (id: string) => ipcRenderer.invoke('transitions:delete', id),
  getBeatGrid: (filePath: string) => ipcRenderer.invoke('beatgrid:get', filePath),
  lightsConnect: (names: string[]) => ipcRenderer.invoke('lights:connect', names),
  lightsKeepRunning: (on: boolean) => ipcRenderer.invoke('lights:keep-running', on),
  lightsKeystone: (action: 'claim' | 'update' | 'release', body?: any) => ipcRenderer.invoke('lights:keystone', action, body),
  saveBeatGrid: (filePath: string, grid: any) => ipcRenderer.invoke('beatgrid:set', filePath, grid),

  // Discord RPC
  updateDiscordPresence: (data: any) => ipcRenderer.invoke('discord:update-presence', data),
  toggleDiscordRPC: (enabled: boolean, clientId?: string) => ipcRenderer.invoke('discord:toggle', enabled, clientId),
  setTrayEnabled: (enabled: boolean) => ipcRenderer.invoke('tray:set-enabled', enabled),

  // Open-with / file association
  getOpenFiles: (): Promise<string[]> => ipcRenderer.invoke('app:get-open-files'),
  parseFile: (filePath: string): Promise<any> => ipcRenderer.invoke('library:parse-file', filePath),
  onOpenFiles: (callback: (paths: string[]) => void) => {
    ipcRenderer.on('app:open-files', (_, paths) => callback(paths))
  },
  removeOpenFilesListener: () => {
    ipcRenderer.removeAllListeners('app:open-files')
  },

  // Playlists
  getPlaylists: () => ipcRenderer.invoke('playlists:get-all'),
  getPlaylist: (id: string) => ipcRenderer.invoke('playlists:get', id),
  createPlaylist: (name: string) => ipcRenderer.invoke('playlists:create', name),
  deletePlaylist: (id: string) => ipcRenderer.invoke('playlists:delete', id),
  renamePlaylist: (id: string, name: string) => ipcRenderer.invoke('playlists:rename', id, name),
  editPlaylist: (id: string, data: { name?: string; description?: string; customImage?: string | null }) => ipcRenderer.invoke('playlists:edit', id, data),
  addTracksToPlaylist: (id: string, trackIds: string[], trackMeta?: Record<string, { title: string; artist: string; album: string }>) => ipcRenderer.invoke('playlists:add-tracks', id, trackIds, trackMeta),
  removeTrackFromPlaylist: (id: string, trackId: string) => ipcRenderer.invoke('playlists:remove-track', id, trackId),

  // Credits / extended metadata
  getTrackCredits: (trackPath: string) => ipcRenderer.invoke('track:get-credits', trackPath),

  // Waveform generation
  generateWaveform: (trackPath: string): Promise<number[]> => ipcRenderer.invoke('track:generate-waveform', trackPath),
  generateWaveformSubsonic: (songId: string): Promise<number[]> => ipcRenderer.invoke('track:generate-waveform-subsonic', songId),

  // Artist info
  getArtistInfo: (artistName: string, forceRefresh = false) => ipcRenderer.invoke('artist:get-info', artistName, forceRefresh),
  getArtistReleases: (artistName: string, forceRefresh = false) => ipcRenderer.invoke('artist:get-releases', artistName, forceRefresh),
  getArtistStreams: (artistName: string, forceRefresh = false) => ipcRenderer.invoke('artist:get-streams', artistName, forceRefresh),
  getAlbumTracklist: (album: string, artist: string, localTitles: string[]) => ipcRenderer.invoke('album:get-tracklist', album, artist, localTitles),

  // Folder tree
  getFolderTree: (folderPath: string) => ipcRenderer.invoke('folder:get-tree', folderPath),

  // Scrobbling
  scrobbleTrack: (data: { title: string; artist: string; album: string; duration: number; timestamp: number }) =>
    ipcRenderer.invoke('scrobble:track', data),
  updateNowPlaying: (data: { title: string; artist: string; album: string; duration: number }) =>
    ipcRenderer.invoke('scrobble:now-playing', data),

  // Smart playlists
  createSmartPlaylist: (name: string, rules: any[], ruleMatch: string) =>
    ipcRenderer.invoke('playlists:create-smart', name, rules, ruleMatch),
  updateSmartPlaylist: (id: string, rules: any[], ruleMatch: string) =>
    ipcRenderer.invoke('playlists:update-smart', id, rules, ruleMatch),

  // Playlist reorder & M3U
  reorderPlaylistTracks: (id: string, fromIndex: number, toIndex: number) =>
    ipcRenderer.invoke('playlists:reorder-tracks', id, fromIndex, toIndex),
  exportPlaylistM3U: (id: string) =>
    ipcRenderer.invoke('playlists:export-m3u', id),
  importPlaylistM3U: () =>
    ipcRenderer.invoke('playlists:import-m3u'),

  // Stats
  statsLoad: () => ipcRenderer.invoke('stats:load'),
  statsAppend: (event: any) => ipcRenderer.invoke('stats:append', event),

  // Sync
  syncGetConfig: () => ipcRenderer.invoke('sync:get-config'),
  syncSetConfig: (config: any) => ipcRenderer.invoke('sync:set-config', config),
  syncPush: (data: any) => ipcRenderer.invoke('sync:push', data),
  syncPull: () => ipcRenderer.invoke('sync:pull'),
  syncPickFolder: () => ipcRenderer.invoke('sync:pick-folder'),
  syncWatch: (folder: string) => ipcRenderer.invoke('sync:watch', folder),
  syncUnwatch: () => ipcRenderer.invoke('sync:unwatch'),
  syncApplyPlaylists: (playlists: any[]) => ipcRenderer.invoke('sync:apply-playlists', playlists),
  syncGetState: () => ipcRenderer.invoke('sync:get-state'),
  syncGetStatsEvents: () => ipcRenderer.invoke('sync:get-stats-events'),
  syncPushStats: (deviceId: string, events: any[]) => ipcRenderer.invoke('sync:push-stats', deviceId, events),
  syncPullStats: (ownDeviceId: string) => ipcRenderer.invoke('sync:pull-stats', ownDeviceId),
  syncApplyRemoteStats: (remoteDeviceId: string, events: any[]) => ipcRenderer.invoke('sync:apply-remote-stats', remoteDeviceId, events),
  onSyncFileChanged: (callback: () => void) => {
    ipcRenderer.on('sync:file-changed', callback)
  },
  removeSyncFileChangedListener: () => {
    ipcRenderer.removeAllListeners('sync:file-changed')
  },

  // Cache management
  resetCache: (targets: string[]): Promise<Record<string, boolean>> => ipcRenderer.invoke('cache:reset', targets),

  // File explorer
  showInExplorer: (filePath: string) => ipcRenderer.invoke('shell:show-in-explorer', filePath),
  openPath: (dirPath: string) => ipcRenderer.invoke('shell:open-path', dirPath),

  // Export / Import
  exportRun: (customPath?: string): Promise<string> => ipcRenderer.invoke('export:run', customPath),
  exportImport: (): Promise<{ settings: boolean; favorites: number; playlists: number } | null> => ipcRenderer.invoke('export:import'),
  exportImportFile: (filePath: string): Promise<{ settings: boolean; favorites: number; playlists: number } | null> => ipcRenderer.invoke('export:import-file', filePath),
  exportChooseDir: (): Promise<string | null> => ipcRenderer.invoke('export:choose-dir'),
  exportGetDefaultPath: (): Promise<string> => ipcRenderer.invoke('export:get-default-path'),

  // Subsonic / Navidrome
  subsonicTest: (config: { url: string; username: string; password: string; useLegacyAuth: boolean }) =>
    ipcRenderer.invoke('subsonic:test', config),
  subsonicFetchLibrary: (): Promise<any[]> => ipcRenderer.invoke('subsonic:fetch-library'),
  subsonicGetStreamUrl: (songId: string): Promise<string> => ipcRenderer.invoke('subsonic:stream-url', songId),
  subsonicGetCoverUrl: (coverArtId: string): Promise<string> => ipcRenderer.invoke('subsonic:cover-url', coverArtId),

  // Save lyrics
  saveLyrics: (trackPath: string, lrcContent: string) => ipcRenderer.invoke('lyrics:save', trackPath, lrcContent),
  searchLyrics: (query: string, tracks: { id: string; path: string }[]) => ipcRenderer.invoke('lyrics:search', query, tracks),

  // App version & update checking
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  checkForUpdate: (): Promise<{ currentVersion: string; latestVersion: string; url: string } | null> => ipcRenderer.invoke('app:check-update'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),

  // Utility – build a localfile:// URL for local file playback (pass through http(s) URLs)
  getMediaUrl: (filePath: string) => {
    if (!filePath) return ''
    // Pass through HTTP(S) URLs (e.g. subsonic cover art or streams)
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
    // Normalize Windows backslashes to forward slashes
    let normalized = filePath.replace(/\\/g, '/')
    // Ensure path starts with / so drive letters aren't parsed as URL host
    // (Windows: C:/Users/... → /C:/Users/..., Linux already starts with /)
    if (!normalized.startsWith('/')) normalized = '/' + normalized
    // encodeURI doesn't encode #, ?, &, =, +, etc. which break URL parsing
    const encoded = encodeURI(normalized)
      .replace(/#/g, '%23')
      .replace(/\?/g, '%3F')
      .replace(/&/g, '%26')
      .replace(/\+/g, '%2B')
      .replace(/=/g, '%3D')
    return `localfile://${encoded}`
  },

  // Events
  onScanProgress: (callback: (data: { current: number; total: number }) => void) => {
    ipcRenderer.on('library:scan-progress', (_, data) => callback(data))
  },
  removeScanProgressListener: () => {
    ipcRenderer.removeAllListeners('library:scan-progress')
  },
  onFoundMissingMetadata: (callback: (count: number) => void) => {
    ipcRenderer.on('library:found-missing-metadata', (_, count) => callback(count))
  },
  removeFoundMissingMetadataListener: () => {
    ipcRenderer.removeAllListeners('library:found-missing-metadata')
  },

  // MPRIS (renderer → main)
  mprisSendMetadata: (data: { title?: string; artist?: string; album?: string; artUrl?: string; length?: number; trackId?: string }) =>
    ipcRenderer.send('mpris:metadata', data),
  mprisSendPlaybackStatus: (status: 'Playing' | 'Paused' | 'Stopped') =>
    ipcRenderer.send('mpris:playback-status', status),
  mprisSendPosition: (seconds: number) =>
    ipcRenderer.send('mpris:position', seconds),
  mprisSendVolume: (vol: number) =>
    ipcRenderer.send('mpris:volume', vol),
  mprisSendLoopStatus: (mode: string) =>
    ipcRenderer.send('mpris:loop-status', mode),
  mprisSendShuffle: (enabled: boolean) =>
    ipcRenderer.send('mpris:shuffle', enabled),
  mprisSendSeeked: (seconds: number) =>
    ipcRenderer.send('mpris:seeked', seconds),
  getCoverFileUrl: (coverPath: string): Promise<string> =>
    ipcRenderer.invoke('mpris:cover-path', coverPath),

  // MPRIS commands (main → renderer)
  onMprisCommand: (callback: (command: string, data?: any) => void) => {
    ipcRenderer.on('mpris:command', (_, command, data) => callback(command, data))
  },
  removeMprisCommandListener: () => {
    ipcRenderer.removeAllListeners('mpris:command')
  },

  // Animated covers
  getAnimatedCover: (album: string, artist: string): Promise<string | null> =>
    ipcRenderer.invoke('animated-cover:get', album, artist),
  getAnimatedCoverCacheStats: (): Promise<{ count: number }> =>
    ipcRenderer.invoke('animated-cover:cache-stats'),
  clearAnimatedCoverCache: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('animated-cover:clear-cache'),

  // Logging
  getLogPath: (): Promise<string> => ipcRenderer.invoke('logger:get-path'),
  log: (level: 'info' | 'warn' | 'error' | 'debug', message: string) =>
    ipcRenderer.send('logger:write', level, message),

  // App lifecycle
  onBeforeQuit: (callback: () => void) => {
    ipcRenderer.on('app:before-quit', () => callback())
  },
  quitReady: () => ipcRenderer.send('app:quit-ready'),

  // Remote control
  onRemoteCommand: (callback: (command: string, data?: any) => void) => {
    ipcRenderer.on('remote:command', (_, command, data) => callback(command, data))
  },
  removeRemoteCommandListener: () => {
    ipcRenderer.removeAllListeners('remote:command')
  },
  onRemoteRequest: (callback: (requestType: string) => void) => {
    ipcRenderer.on('remote:request', (_, requestType) => callback(requestType))
  },
  removeRemoteRequestListener: () => {
    ipcRenderer.removeAllListeners('remote:request')
  },
  sendRemoteResponse: (requestType: string, data: any) => ipcRenderer.send(`remote:response:${requestType}`, data),
  sendRemoteState: (state: any) => ipcRenderer.send('remote:state-update', state),
  onRemoteDeviceAdded: (callback: (device: { name: string; ip: string }) => void) => {
    ipcRenderer.on('remote:device-added', (_, device) => callback(device))
  },
  removeRemoteDeviceAddedListener: () => {
    ipcRenderer.removeAllListeners('remote:device-added')
  },
  onRemotePinChanged: (callback: (pin: string) => void) => {
    ipcRenderer.on('remote:pin-changed', (_, pin) => callback(pin))
  },
  removeRemotePinChangedListener: () => {
    ipcRenderer.removeAllListeners('remote:pin-changed')
  },
  getRemoteConfig: () => ipcRenderer.invoke('remote:get-config'),
  setRemoteEnabled: (enabled: boolean) => ipcRenderer.invoke('remote:set-enabled', enabled),
  remoteRegeneratePin: () => ipcRenderer.invoke('remote:regenerate-pin'),
  remoteRemoveDevice: (index: number) => ipcRenderer.invoke('remote:remove-device', index),
  remoteRemoveAllDevices: () => ipcRenderer.invoke('remote:remove-all-devices'),
  remoteStartServer: () => ipcRenderer.invoke('remote:start-server'),
  remoteStopServer: () => ipcRenderer.invoke('remote:stop-server'),

  // Themes
  themesGetAll: (): Promise<any[]> => ipcRenderer.invoke('themes:get-all'),
  themesInstall: (theme: any): Promise<void> => ipcRenderer.invoke('themes:install', theme),
  themesRemove: (themeId: string): Promise<void> => ipcRenderer.invoke('themes:remove', themeId),
  themesOpenFolder: (): Promise<void> => ipcRenderer.invoke('themes:open-folder'),
  onThemesDirectoryChanged: (callback: () => void) => {
    ipcRenderer.on('themes:directory-changed', callback)
  },
  removeThemesDirectoryChangedListener: () => {
    ipcRenderer.removeAllListeners('themes:directory-changed')
  },

  // Plugins
  pluginsGetAll: (): Promise<any[]> => ipcRenderer.invoke('plugins:get-all'),
  pluginsReadFile: (pluginId: string, fileName: string): Promise<string> => ipcRenderer.invoke('plugins:read-file', pluginId, fileName),
  pluginsInstall: (sourcePath: string): Promise<void> => ipcRenderer.invoke('plugins:install', sourcePath),
  pluginsRemove: (pluginId: string): Promise<void> => ipcRenderer.invoke('plugins:remove', pluginId),
  pluginsGetSettings: (pluginId: string): Promise<any> => ipcRenderer.invoke('plugins:get-settings', pluginId),
  pluginsSaveSettings: (pluginId: string, data: any): Promise<void> => ipcRenderer.invoke('plugins:save-settings', pluginId, data),
  pluginsOpenFolder: (): Promise<void> => ipcRenderer.invoke('plugins:open-folder'),
  pluginsIpcInvoke: (channel: string, ...args: any[]): Promise<any> => ipcRenderer.invoke(channel, ...args),
  pluginsIpcSend: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  onPluginEvent: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // Playlist custom image — uses a DOM file input so Chromium routes through
  // XDG portals on Linux, giving the proper system-native file picker.
  openImageDialog: (): Promise<string | null> => new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif'
    input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none'
    document.body.appendChild(input)
    const cleanup = () => { if (document.body.contains(input)) document.body.removeChild(input) }
    input.onchange = () => { const file = input.files?.[0]; cleanup(); resolve(file ? webUtils.getPathForFile(file) : null) }
    input.oncancel = () => { cleanup(); resolve(null) }
    input.click()
  }),
  setPlaylistCustomImage: (id: string, imagePath: string | null): Promise<any> => ipcRenderer.invoke('playlists:set-custom-image', id, imagePath),

  // Plugin HTTP helper — use instead of fetch() to avoid renderer CORS blocks.
  // Returns { ok, status, text }; parse JSON yourself with JSON.parse(result.text).
  netFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }):
    Promise<{ ok: boolean; status: number; text: string }> =>
    ipcRenderer.invoke('net:fetch', url, options),
})
