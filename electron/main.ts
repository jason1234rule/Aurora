import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, screen, Menu, Tray, nativeImage } from 'electron'
import { join, extname, basename, dirname, sep } from 'path'
import { readdir, readFile, writeFile, rename, mkdir, stat, rm, copyFile, unlink, appendFile } from 'fs/promises'
import { existsSync, createReadStream, readFileSync, watch as fsWatch } from 'fs'
import { createHash } from 'crypto'
import { request as httpsRequest, get as httpsGet } from 'https'
import { execFile, spawn } from 'child_process'
import {
  initMpris, destroyMpris, updateMprisMetadata, updateMprisPlaybackStatus,
  updateMprisPosition, updateMprisVolume, updateMprisLoopStatus, updateMprisShuffle,
  emitMprisSeeked,
} from './mpris'
import {
  setSubsonicConfig, subsonicPing, subsonicGetAllSongs,
  getStreamUrl, getCoverArtUrl,
} from './subsonic'
import { startRemoteServer, stopRemoteServer, registerRemoteIPC, isRemoteEnabled } from './remote'
import { registerAnimatedCoverIPC, getAlbumArtworkUrl } from './animated-covers'
import { logger, installGlobalLogHandlers, initLogger, getLogPath } from './logger'
import { getAppPaths } from './paths'
import { splitCredits, formatArtists } from '../src/utils/credits'

// Compute XDG-compliant paths and initialise the logger before anything else
const appPaths = getAppPaths()
initLogger(appPaths.state)

// Install global error handlers and write startup info
installGlobalLogHandlers()

// ── Discord Rich Presence ──────────────────────────────────────────────────
// Uses discord-rpc to show what's currently playing
// Default client ID – users can create their own Discord App at discord.com/developers
let discordClientId = '1338909498498850836'
let rpcClient: any = null
let rpcReady = false

async function initDiscordRPC(clientId?: string) {
  if (clientId) discordClientId = clientId
  // Destroy existing connection if any
  await destroyDiscordRPC()

  try {
    const { Client } = await import('@xhayper/discord-rpc')
    rpcClient = new Client({ clientId: discordClientId })

    rpcClient.on('ready', () => {
      rpcReady = true
      logger.info('Discord RPC connected')
    })

    rpcClient.on('disconnected', () => {
      rpcReady = false
    })

    await rpcClient.login()
  } catch (err) {
    logger.info('Discord RPC not available (Discord not running?):', (err as Error).message)
    rpcReady = false
  }
}

// ── Album art URL lookup (for Discord RPC) ────────────────────────────────
// Delegated to animated-covers.ts (Apple Music catalog, same token + multi-storefront logic)

function fetchJSON(url: string, retries = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, {
      headers: {
        'User-Agent': `AuroraPlayer/${app.getVersion()} (https://github.com/Wilk087/Aurora)`,
        'Accept': 'application/json',
      },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location, retries).then(resolve, reject)
      }
      if (res.statusCode && res.statusCode === 503 && retries > 0) {
        // Rate limited — wait and retry
        setTimeout(() => fetchJSON(url, retries - 1).then(resolve, reject), 1500)
        res.resume()
        return
      }
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
      res.on('error', (err) => {
        if (retries > 0) {
          setTimeout(() => fetchJSON(url, retries - 1).then(resolve, reject), 1000)
        } else {
          reject(err)
        }
      })
    })
    req.on('error', (err) => {
      if (retries > 0) {
        setTimeout(() => fetchJSON(url, retries - 1).then(resolve, reject), 1000)
      } else {
        reject(err)
      }
    })
    req.on('timeout', () => {
      req.destroy()
      if (retries > 0) {
        setTimeout(() => fetchJSON(url, retries - 1).then(resolve, reject), 1000)
      } else {
        reject(new Error('Request timeout'))
      }
    })
  })
}

/** Compare two semver strings. Returns > 0 if a > b, < 0 if a < b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va !== vb) return va - vb
  }
  return 0
}

async function getAlbumArtUrl(artist: string, album: string): Promise<string | null> {
  return getAlbumArtworkUrl(artist, album)
}

async function updateDiscordPresence(data: {
  title: string
  artist: string
  album: string
  isPlaying: boolean
  duration: number
  elapsed: number
  format: string
} | null) {
  if (!rpcClient || !rpcReady) return

  try {
    if (!data || !data.isPlaying) {
      await rpcClient.user?.clearActivity()
      return
    }

    // Build display strings based on format
    let details = ''
    let state = ''

    switch (data.format) {
      case 'title-artist':
        details = data.title
        state = `by ${data.artist}`
        break
      case 'artist-title':
        details = data.artist
        state = data.title
        break
      case 'title-album':
        details = data.title
        state = `on ${data.album}`
        break
      case 'full':
        details = `${data.title} by ${data.artist}`
        state = data.album
        break
      case 'minimal':
        details = data.title
        state = ''
        break
      default:
        details = data.title
        state = `by ${data.artist}`
    }

    const now = Date.now()
    const endTimestamp = data.duration > 0
      ? now + (data.duration - data.elapsed) * 1000
      : undefined

    // Look up album cover art URL for Discord to display
    let imageKey = 'aurora_icon'
    let imageText = 'Aurora Player'
    try {
      const artUrl = await getAlbumArtUrl(data.artist, data.album)
      if (artUrl) {
        imageKey = artUrl
        imageText = data.album || 'Aurora Player'
      }
    } catch {}

    const startTimestamp = data.duration > 0
      ? now - data.elapsed * 1000
      : undefined

    const activity: any = {
      type: 2,
      name: `${data.title} by ${data.artist}`,
      details: details.substring(0, 128),
      largeImageKey: imageKey,
      largeImageText: imageText.substring(0, 128),
      instance: false,
    }

    if (state) activity.state = state.substring(0, 128)
    if (data.isPlaying && startTimestamp) activity.startTimestamp = startTimestamp
    if (data.isPlaying && endTimestamp) activity.endTimestamp = endTimestamp

    await rpcClient.user?.setActivity(activity)
  } catch (err) {
    logger.error('Discord RPC update error:', err)
  }
}

async function destroyDiscordRPC() {
  if (rpcClient) {
    try {
      await rpcClient.destroy()
    } catch {}
    rpcClient = null
    rpcReady = false
  }
}

// ── Custom protocol for serving local media files ──────────────────────────
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localfile',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
])

// ── Exclusive audio mode (disabled for 2.6.0 — will revisit later) ──────────
// Chromium only respects the *last* --disable-features switch, so we collect
// all features to disable and apply them in one call at the end.
let exclusiveModeActive = false
let exclusiveAlsaDevice = ''
const disabledFeatures: string[] = []

// NOTE: Exclusive mode startup logic is intentionally skipped for 2.6.0.
// The code below is kept for reference and future re-enablement.
// {
//   const earlySettingsPath = join(app.getPath('userData'), 'settings.json')
//   try {
//     if (existsSync(earlySettingsPath)) {
//       const earlySettings = JSON.parse(readFileSync(earlySettingsPath, 'utf-8'))
//       if (earlySettings.exclusiveMode === true) {
//         exclusiveModeActive = true
//         if (process.platform === 'win32') {
//           app.commandLine.appendSwitch('enable-exclusive-audio')
//         }
//         disabledFeatures.push('AudioServiceSandbox')
//         app.commandLine.appendSwitch('disable-audio-output-resampler')
//         if (process.platform === 'linux') {
//           const alsaDev = earlySettings.exclusiveAlsaDevice || ''
//           if (alsaDev) {
//             exclusiveAlsaDevice = alsaDev
//             app.commandLine.appendSwitch('audio-backend', 'alsa')
//             app.commandLine.appendSwitch('alsa-output-device', alsaDev)
//             console.log(`Exclusive audio: ALSA backend, device=${alsaDev}`)
//           } else {
//             process.env.PIPEWIRE_LATENCY = '256/48000'
//             process.env.PIPEWIRE_PROPS = 'media.role=Music'
//             console.log('Exclusive audio: PipeWire optimized mode (no ALSA device selected)')
//           }
//         } else {
//           console.log('Exclusive audio mode enabled')
//         }
//       }
//     }
//   } catch (e) {
//     console.error('Failed to read settings for exclusive mode:', e)
//   }
// }

// ── MPRIS / Desktop identity ───────────────────────────────────────────────
app.setName('Aurora Player')
if (process.platform === 'linux') {
  // Disable Chromium's built-in MPRIS so our custom D-Bus service is the only one
  disabledFeatures.push('HardwareMediaKeyHandling', 'MediaSessionService')
  process.env.BAMF_DESKTOP_FILE_HINT = 'aurora-player.desktop'
}

// Apply all collected --disable-features in a single call
if (disabledFeatures.length > 0) {
  app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','))
}

// ── Globals ────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let isRelaunching = false
let isQuitting = false // prevents before-quit re-entry after sync completes
let tray: Tray | null = null

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.ogg', '.opus', '.wav', '.m4a', '.aac', '.wma', '.alac',
])

// ── XDG Base Directory paths ───────────────────────────────────────────────
// On Linux these fan out across ~/.config / ~/.local/share / ~/.cache / ~/.local/state.
// On other platforms all four dirs equal Electron's userData.
const configPath   = appPaths.config   // settings.json
const dataPath     = appPaths.data     // library, playlists, favorites, stats, themes, plugins…
const cachePath    = appPaths.cache    // cover-cache, waveform-cache, artist-cache, tmp
// appPaths.state is used by the logger (aurora.log)

const settingsPath      = join(configPath, 'settings.json')
const storePath         = join(dataPath,   'library.json')
const playlistsPath     = join(dataPath,   'playlists.json')
const coverCachePath    = join(cachePath,  'cover-cache')
const artistCachePath   = join(cachePath,  'artist-cache.json')
const waveformCachePath = join(cachePath,  'waveform-cache.json')

// ── Artist info disk cache ─────────────────────────────────────────────────
let artistInfoCache: Record<string, { data: any; ts: number }> = {}
const ARTIST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

// Discography is cached in memory only, so a restart always picks up new releases
const artistReleasesCache = new Map<string, { data: ArtistRelease[]; ts: number }>()
const ARTIST_RELEASES_TTL = 12 * 60 * 60 * 1000 // 12 hours
interface ArtistRelease {
  title: string
  type: string
  releaseDate: string
  coverUrl: string | null
  url: string
  explicit: boolean
}

async function loadArtistCache() {
  try {
    if (existsSync(artistCachePath)) {
      artistInfoCache = JSON.parse(await readFile(artistCachePath, 'utf-8'))
    }
  } catch { artistInfoCache = {} }
}

async function saveArtistCache() {
  try {
    await writeFile(artistCachePath, JSON.stringify(artistInfoCache))
  } catch {}
}

// ── Spotify stream counts (kworb.net) ──────────────────────────────────────
// kworb publishes daily Spotify stream totals per artist. It has no API, so we
// read its plain-HTML songs table. Cached on disk for 3 days.
interface ArtistStreams {
  spotifyId: string
  lastUpdated: string       // as printed by kworb, e.g. "2026/10/11"
  totalStreams: number
  dailyStreams: number
  songs: { title: string; streams: number; daily: number; feature: boolean }[]
}

// ── Official album tracklists (Apple's public iTunes catalog) ──────────────
// Lets the album page show songs that aren't downloaded. Tracklists rarely
// change, so hits are kept for 30 days; misses are retried after 3.
interface CatalogTrack { title: string; disc: number; track: number; duration: number }
interface AlbumTracklist { name: string; tracks: CatalogTrack[] }

const tracklistCachePath = join(cachePath, 'album-tracklist-cache.json')
const TRACKLIST_TTL = 30 * 24 * 60 * 60 * 1000
const TRACKLIST_MISS_TTL = 3 * 24 * 60 * 60 * 1000
let tracklistCache: Record<string, { data: AlbumTracklist | null; ts: number }> | null = null

async function getTracklistCache() {
  if (!tracklistCache) {
    try {
      tracklistCache = existsSync(tracklistCachePath) ? JSON.parse(await readFile(tracklistCachePath, 'utf-8')) : {}
    } catch { tracklistCache = {} }
  }
  return tracklistCache!
}

/** "30 For 30 (with Kendrick Lamar)" and "30 for 30" compare equal */
function normTitle(s: string): string {
  return s.toLowerCase()
    .replace(/[([](feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+(single|ep)$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const streamsCachePath = join(cachePath, 'artist-streams-cache.json')
const ARTIST_STREAMS_TTL = 3 * 24 * 60 * 60 * 1000 // 3 days
let artistStreamsCache: Record<string, { data: ArtistStreams | null; ts: number }> = {}

async function loadStreamsCache() {
  try {
    if (existsSync(streamsCachePath)) {
      artistStreamsCache = JSON.parse(await readFile(streamsCachePath, 'utf-8'))
    }
  } catch { artistStreamsCache = {} }
}

async function saveStreamsCache() {
  try {
    await writeFile(streamsCachePath, JSON.stringify(artistStreamsCache))
  } catch {}
}

function spotifyIdFromRelations(relations: any[]): string {
  for (const r of relations) {
    const m = (r.url?.resource || '').match(/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/)
    if (m) return m[1]
  }
  return ''
}

function parseKworbSongs(html: string, spotifyId: string): ArtistStreams | null {
  const toNum = (s: string) => Number(s.replace(/,/g, '')) || 0
  const decode = (s: string) => s
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

  const streamsRow = html.match(/<td class="text">Streams<\/td><td>([\d,]+)<\/td>/)
  const dailyRow = html.match(/<td class="text">Daily<\/td><td>([\d,]+)<\/td>/)
  if (!streamsRow) return null

  const songs: ArtistStreams['songs'] = []
  // Song rows look like: <td class="text"><div>[* ]<a href="https://open.spotify.com/track/…">Title</a></div></td><td>1,234</td><td>56</td>
  // A leading "* " marks tracks where the artist is only featured.
  const rowRe = /<td class="text"><div>(\*\s*)?<a href="https:\/\/open\.spotify\.com\/track\/[^"]+"[^>]*>([^<]+)<\/a><\/div><\/td><td>([\d,]+)<\/td><td>([\d,]*)<\/td>/g
  for (const m of html.matchAll(rowRe)) {
    songs.push({ title: decode(m[2]), streams: toNum(m[3]), daily: toNum(m[4]), feature: !!m[1] })
  }

  return {
    spotifyId,
    lastUpdated: html.match(/Last updated: ([\d/]+)/)?.[1] || '',
    totalStreams: toNum(streamsRow[1]),
    dailyStreams: dailyRow ? toNum(dailyRow[1]) : 0,
    songs,
  }
}

// ── Waveform disk cache ────────────────────────────────────────────────────
let waveformDiskCache: Record<string, number[]> = {}

async function loadWaveformCache() {
  try {
    if (existsSync(waveformCachePath)) {
      waveformDiskCache = JSON.parse(await readFile(waveformCachePath, 'utf-8'))
    }
  } catch { waveformDiskCache = {} }
}

let waveformFlushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleWaveformFlush() {
  if (waveformFlushTimer) return
  waveformFlushTimer = setTimeout(async () => {
    waveformFlushTimer = null
    try { await writeFile(waveformCachePath, JSON.stringify(waveformDiskCache)) } catch {}
  }, 5000)
}

// ── Beat grid disk cache (hand-made transitions editor) ────────────────────
// Keyed by path; an entry only counts while the file's mtime and size match.
const beatgridCachePath = join(cachePath, 'beatgrid-cache.json')
let beatgridCache: Record<string, { mtimeMs: number; size: number; grid: any }> | null = null
let beatgridFlushTimer: ReturnType<typeof setTimeout> | null = null

async function getBeatgridCache() {
  if (beatgridCache) return beatgridCache
  try {
    beatgridCache = existsSync(beatgridCachePath) ? JSON.parse(await readFile(beatgridCachePath, 'utf-8')) : {}
  } catch { beatgridCache = {} }
  return beatgridCache!
}

function scheduleBeatgridFlush() {
  if (beatgridFlushTimer) return
  beatgridFlushTimer = setTimeout(async () => {
    beatgridFlushTimer = null
    try { await writeFile(beatgridCachePath, JSON.stringify(beatgridCache)) } catch {}
  }, 3000)
}

// ── In-memory library cache ────────────────────────────────────────────────
// Loaded once at startup, mutated in place, flushed to disk on changes.
// This eliminates repeated disk reads on every IPC call.
interface LibraryCache {
  folders: string[]
  tracks: any[]
  trackMap: Map<string, any>   // path → track for O(1) lookups
  albumMap: Map<string, any>   // albumKey → album object
  artistMap: Map<string, any>  // artistName → artist object
  dirty: boolean
}

const cache: LibraryCache = {
  folders: [],
  tracks: [],
  trackMap: new Map(),
  albumMap: new Map(),
  artistMap: new Map(),
  dirty: false,
}

function rebuildIndexes() {
  cache.trackMap.clear()
  cache.albumMap.clear()
  cache.artistMap.clear()

  for (const track of cache.tracks) {
    // Ensure duration is always a valid number
    if (!track.duration || typeof track.duration !== 'number' || isNaN(track.duration)) {
      track.duration = 0
    }
    cache.trackMap.set(track.path, track)

    // Build album index
    const albumKey = `${track.album}---${track.albumArtist}`
    if (!cache.albumMap.has(albumKey)) {
      cache.albumMap.set(albumKey, {
        id: albumKey.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
        name: track.album,
        artist: track.albumArtist,
        coverArt: track.coverArt,
        year: track.year,
        trackCount: 0,
        totalDuration: 0,
      })
    }
    const album = cache.albumMap.get(albumKey)!
    album.trackCount++
    album.totalDuration += track.duration
    if (!album.coverArt && track.coverArt) album.coverArt = track.coverArt
    if ((!album.year || album.year === 0) && track.year) album.year = track.year

    // Build artist index
    const artistName = track.albumArtist || track.artist || 'Unknown Artist'
    if (!cache.artistMap.has(artistName)) {
      cache.artistMap.set(artistName, {
        name: artistName,
        albumCount: 0,
        trackCount: 0,
      })
    }
    cache.artistMap.get(artistName)!.trackCount++
  }

  // Count albums per artist
  for (const album of Array.from(cache.albumMap.values())) {
    const artist = cache.artistMap.get(album.artist)
    if (artist) artist.albumCount++
  }
}

async function loadCache(): Promise<void> {
  try {
    if (existsSync(storePath)) {
      const data = JSON.parse(await readFile(storePath, 'utf-8'))
      cache.folders = data.folders || []
      cache.tracks = data.tracks || []
    }
  } catch (e) {
    logger.error('Failed to load library cache:', e)
    cache.folders = []
    cache.tracks = []
  }
  rebuildIndexes()
  cache.dirty = false
}

let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  cache.dirty = true
  if (flushTimer) return // already scheduled
  flushTimer = setTimeout(async () => {
    flushTimer = null
    if (!cache.dirty) return
    try {
      await writeFile(storePath, JSON.stringify({ folders: cache.folders, tracks: cache.tracks }, null, 2))
      cache.dirty = false
    } catch (e) {
      logger.error('Failed to flush library cache:', e)
    }
  }, 2000) // debounce writes to 2 seconds
}

async function forceFlush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (cache.dirty) {
    await writeFile(storePath, JSON.stringify({ folders: cache.folders, tracks: cache.tracks }, null, 2))
    cache.dirty = false
  }
}

// ── Simple JSON persistence (settings only) ────────────────────────────────
// ── Simple JSON persistence (settings only) ────────────────────────────────
async function loadSettings(): Promise<any> {
  const defaults = { volume: 0.8, folders: [] }
  if (!existsSync(settingsPath)) return defaults
  try {
    return JSON.parse(await readFile(settingsPath, 'utf-8'))
  } catch (err) {
    console.error('[settings] Failed to parse settings file, trying backup:', err)
    // Try the backup written before each save
    const backupPath = settingsPath + '.bak'
    if (existsSync(backupPath)) {
      try {
        return JSON.parse(await readFile(backupPath, 'utf-8'))
      } catch {
        console.error('[settings] Backup also unreadable, using defaults')
      }
    }
    return defaults
  }
}

// Serialise all settings writes — concurrent settings:merge calls share the
// same .tmp filename, so without a queue the second rename hits ENOENT.
let _settingsSaveQueue: Promise<void> = Promise.resolve()

function saveSettings(settings: any): Promise<void> {
  _settingsSaveQueue = _settingsSaveQueue.then(() => _doSaveSettings(settings))
  return _settingsSaveQueue
}

async function _doSaveSettings(settings: any): Promise<void> {
  const tmp = settingsPath + '.tmp'
  const data = JSON.stringify(settings, null, 2)
  // Write to a temp file first, then atomically rename so a crash mid-write
  // never leaves a partial/corrupt settings.json
  await writeFile(tmp, data)
  // Snapshot the previous good file as a backup before replacing it
  if (existsSync(settingsPath)) {
    try { await writeFile(settingsPath + '.bak', await readFile(settingsPath, 'utf-8')) } catch {}
  }
  await rename(tmp, settingsPath)
  scheduleAutoExport()
}


async function mergeSettingsFile(partial: Record<string, any>): Promise<void> {
  const current = await loadSettings()
  for (const [key, value] of Object.entries(partial)) {
    if (value === null || value === undefined) delete current[key]
    else current[key] = value
  }
  await saveSettings(current)
}

// ── Auto-export / backup ───────────────────────────────────────────────────
const defaultExportPath = join(dataPath, 'backups')
let autoExportTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutoExport() {
  if (autoExportTimer) return
  autoExportTimer = setTimeout(async () => {
    autoExportTimer = null
    try {
      const settings = await loadSettings()
      if (settings.autoExport === false) return
      const exportDir = settings.exportPath || defaultExportPath
      await performExport(exportDir, true) // silent auto-export
    } catch {}
  }, 10_000) // debounce 10 seconds
}

async function performExport(exportDir: string, isAuto = false): Promise<string> {
  await mkdir(exportDir, { recursive: true })

  const timestamp = isAuto ? 'latest' : new Date().toISOString().replace(/[:.]/g, '-')
  const exportFile = join(exportDir, `aurora-backup-${timestamp}.json`)

  const settings = await loadSettings()
  const favorites = [...favoriteIds]
  const playlistData = [...playlists]

  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    favorites,
    favoriteMeta: { ...favoriteMeta },
    playlists: playlistData,
  }

  await writeFile(exportFile, JSON.stringify(bundle, null, 2))
  return exportFile
}

async function performImport(importPath: string): Promise<{ settings: boolean; favorites: number; playlists: number }> {
  const raw = await readFile(importPath, 'utf-8')
  const bundle = JSON.parse(raw)

  const result = { settings: false, favorites: 0, playlists: 0 }

  if (bundle.settings && typeof bundle.settings === 'object') {
    // Merge — preserve device-specific settings from current install
    const current = await loadSettings()
    const merged = {
      ...bundle.settings,
      // These are device-specific and should not be overwritten
      folders: current.folders,
      outputDeviceId: current.outputDeviceId,
      exportPath: current.exportPath,
      autoExport: current.autoExport,
    }
    await writeFile(settingsPath, JSON.stringify(merged, null, 2))
    result.settings = true
  }

  if (Array.isArray(bundle.favorites)) {
    favoriteIds = bundle.favorites
    favoriteMeta = (bundle.favoriteMeta && typeof bundle.favoriteMeta === 'object')
      ? bundle.favoriteMeta
      : {}
    await writeFile(favoritesPath, JSON.stringify({ ids: favoriteIds, meta: favoriteMeta }, null, 2))
    result.favorites = favoriteIds.length
  }

  if (Array.isArray(bundle.playlists)) {
    playlists = bundle.playlists
    await writeFile(playlistsPath, JSON.stringify(playlists, null, 2))
    result.playlists = playlists.length
  }

  return result
}

// ── Favorites persistence ──────────────────────────────────────────────────
const favoritesPath = join(dataPath, 'favorites.json')
let favoriteIds: string[] = []
let favoriteMeta: Record<string, TrackMetaSnapshot> = {}
let favoritesUpdatedAt = 0

async function loadFavorites(): Promise<{ ids: string[]; meta: Record<string, TrackMetaSnapshot> }> {
  try {
    if (existsSync(favoritesPath)) {
      const raw = JSON.parse(await readFile(favoritesPath, 'utf-8'))
      if (Array.isArray(raw)) {
        // Old format: plain string array — no metadata stored yet
        favoriteIds = raw
        favoriteMeta = {}
      } else {
        // New format: { ids, meta, updatedAt }
        favoriteIds = raw.ids || []
        favoriteMeta = raw.meta || {}
        favoritesUpdatedAt = raw.updatedAt ?? 0
      }
    }
  } catch { favoriteIds = []; favoriteMeta = {} }
  return { ids: favoriteIds, meta: favoriteMeta }
}

async function saveFavorites(): Promise<void> {
  favoritesUpdatedAt = Date.now()
  await writeFile(favoritesPath, JSON.stringify({ ids: favoriteIds, meta: favoriteMeta, updatedAt: favoritesUpdatedAt }, null, 2))
  scheduleAutoExport()
}

// ── Tags persistence ───────────────────────────────────────────────────────
const tagsPath = join(dataPath, 'tags.json')
let trackTagsData: Record<string, string[]> = {}  // trackId → tags[]
let albumTagsData: Record<string, string[]> = {}   // albumKey → tags[]

async function loadTags(): Promise<{ trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }> {
  try {
    if (existsSync(tagsPath)) {
      const raw = JSON.parse(await readFile(tagsPath, 'utf-8'))
      trackTagsData = raw.trackTags || {}
      albumTagsData = raw.albumTags || {}
    }
  } catch { trackTagsData = {}; albumTagsData = {} }
  return { trackTags: trackTagsData, albumTags: albumTagsData }
}

async function saveTags(): Promise<void> {
  await writeFile(tagsPath, JSON.stringify({ trackTags: trackTagsData, albumTags: albumTagsData }, null, 2))
}

// ── Hand-made transitions persistence ──────────────────────────────────────
// User-authored song→song transitions, keyed by "fromSongKey→toSongKey".
const transitionsPath = join(dataPath, 'transitions.json')
let transitionsData: Record<string, any> = {}
let transitionsLoaded = false

async function loadTransitions(): Promise<Record<string, any>> {
  if (transitionsLoaded) return transitionsData
  try {
    if (existsSync(transitionsPath)) {
      const raw = JSON.parse(await readFile(transitionsPath, 'utf-8'))
      transitionsData = raw.transitions || {}
    }
  } catch (err) {
    logger.error('Failed to read transitions.json:', err)
    transitionsData = {}
    // Keep the unreadable file so hand-made work isn't lost to the next save
    try { await rename(transitionsPath, `${transitionsPath}.corrupt-${Date.now()}`) } catch {}
  }
  transitionsLoaded = true
  return transitionsData
}

// Hand-made work is expensive to redo, so write via a temp file + rename (serialised,
// like settings, because concurrent saves would share the .tmp name)
let _transitionsSaveQueue: Promise<void> = Promise.resolve()

function saveTransitions(): Promise<void> {
  const run = _transitionsSaveQueue.then(async () => {
    const tmp = transitionsPath + '.tmp'
    await writeFile(tmp, JSON.stringify({ version: 1, transitions: transitionsData }, null, 2))
    await rename(tmp, transitionsPath)
  })
  // A failed write must not wedge every later one
  _transitionsSaveQueue = run.catch(() => {})
  return run
}

function isValidTransition(t: any): boolean {
  const num = (v: any) => typeof v === 'number' && isFinite(v)
  return !!t && typeof t.id === 'string'
    && typeof t.from?.key === 'string' && typeof t.to?.key === 'string'
    && ['blend', 'cut', 'echo-out'].includes(t.type)
    && num(t.exitAt) && num(t.entryAt) && num(t.overlap)
}

// ── Playlist persistence ───────────────────────────────────────────────────
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
  rules?: any[]
  ruleMatch?: 'all' | 'any'
  customImage?: string
}

let playlists: Playlist[] = []

async function loadPlaylists(): Promise<Playlist[]> {
  try {
    if (existsSync(playlistsPath)) {
      playlists = JSON.parse(await readFile(playlistsPath, 'utf-8'))
    }
  } catch {
    playlists = []
  }
  return playlists
}

async function savePlaylists(): Promise<void> {
  await writeFile(playlistsPath, JSON.stringify(playlists, null, 2))
  scheduleAutoExport()
}

// ── Helpers ────────────────────────────────────────────────────────────────
function generateId(str: string): string {
  return createHash('md5').update(str).digest('hex').substring(0, 12)
}

async function ensureCoverCacheDir() {
  if (!existsSync(coverCachePath)) {
    await mkdir(coverCachePath, { recursive: true })
  }
}

// ── Library scanning ───────────────────────────────────────────────────────
async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          files.push(fullPath)
        }
      }
    } catch (err) {
      logger.error(`Error scanning ${dir}:`, err)
    }
  }

  await walk(dirPath)
  return files
}

async function parseTrack(filePath: string): Promise<any> {
  try {
    const mm = await import('music-metadata')
    const metadata = await mm.parseFile(filePath)
    const id = generateId(filePath)

    // Extract & cache cover art
    let coverArtPath: string | null = null
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      await ensureCoverCacheDir()
      const pic = metadata.common.picture[0]
      const ext = pic.format === 'image/png' ? 'png' : 'jpg'
      const albumId = generateId(metadata.common.album || filePath)
      const coverFile = `${albumId}.${ext}`
      coverArtPath = join(coverCachePath, coverFile)
      if (!existsSync(coverArtPath)) {
        await writeFile(coverArtPath, pic.data)
      }
    }

    // "Kiss Me More (feat. SZA)" by "Doja Cat" → "Kiss Me More" by "Doja Cat & SZA";
    // featured artists are remembered so listening stats can weight them
    const credits = splitCredits(metadata.common.title || basename(filePath, extname(filePath)), metadata.common.artist || '')
    const mainArtists = formatArtists(credits.main)

    return {
      id,
      path: filePath,
      title: credits.title,
      artist: formatArtists([...credits.main, ...credits.featured]) || 'Unknown Artist',
      ...(credits.featured.length ? { featuredArtists: credits.featured } : {}),
      album: metadata.common.album || 'Unknown Album',
      albumArtist: metadata.common.albumartist || mainArtists || 'Unknown Artist',
      track: metadata.common.track?.no || 0,
      disc: metadata.common.disk?.no || 1,
      duration: metadata.format.duration && !isNaN(metadata.format.duration) ? Math.round(metadata.format.duration * 1000) / 1000 : 0,
      genre: metadata.common.genre?.[0] || '',
      year: metadata.common.year || 0,
      coverArt: coverArtPath,
      composer: (metadata.common.composer || []).join(', '),
      label: (metadata.common.label || []).join(', '),
      comment: metadata.common.comment ? metadata.common.comment[0] || '' : '',
    }
  } catch (err) {
    logger.error(`Error parsing ${filePath}:`, err)
    return {
      id: generateId(filePath),
      path: filePath,
      title: basename(filePath, extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      albumArtist: 'Unknown Artist',
      track: 0,
      disc: 1,
      duration: 0,
      genre: '',
      year: 0,
      coverArt: null,
    }
  }
}

// ── Lyrics ─────────────────────────────────────────────────────────────────
async function findLocalLyrics(audioPath: string): Promise<string | null> {
  const dir = dirname(audioPath)
  const name = basename(audioPath, extname(audioPath))
  const lrcPath = join(dir, `${name}.lrc`)

  try {
    if (existsSync(lrcPath)) {
      return await readFile(lrcPath, 'utf-8')
    }
  } catch {}

  return null
}

function lrclibFetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    httpsRequest(url, { headers: { 'User-Agent': `AuroraPlayer/${app.getVersion()}` } }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject).end()
  })
}

async function fetchLRCLIB(track: { title: string; artist: string; album: string; duration: number }): Promise<string | null> {
  try {
    // Lyrics sites list songs under the main artist, not "Doja Cat & SZA"
    const artist = splitCredits(track.title, track.artist).main[0] || track.artist
    // Try exact match first
    const params = new URLSearchParams({
      track_name: track.title,
      artist_name: artist,
      album_name: track.album,
      duration: Math.round(track.duration).toString(),
    })
    const exactUrl = `https://lrclib.net/api/get?${params.toString()}`
    const exactRes = await lrclibFetch(exactUrl)
    const exactData = JSON.parse(exactRes)

    if (exactData.syncedLyrics) return exactData.syncedLyrics
    if (exactData.plainLyrics) return exactData.plainLyrics

    // Fallback: search
    const searchParams = new URLSearchParams({
      track_name: track.title,
      artist_name: artist,
    })
    const searchUrl = `https://lrclib.net/api/search?${searchParams.toString()}`
    const searchRes = await lrclibFetch(searchUrl)
    const results = JSON.parse(searchRes)

    if (Array.isArray(results) && results.length > 0) {
      // Prefer synced lyrics
      const synced = results.find((r: any) => r.syncedLyrics)
      if (synced) return synced.syncedLyrics
      if (results[0].plainLyrics) return results[0].plainLyrics
    }
  } catch (err) {
    logger.error('LRCLIB fetch error:', err)
  }
  return null
}

async function saveLyricsFile(audioPath: string, lrcContent: string): Promise<void> {
  const dir = dirname(audioPath)
  const name = basename(audioPath, extname(audioPath))
  const lrcPath = join(dir, `${name}.lrc`)
  try {
    await writeFile(lrcPath, lrcContent, 'utf-8')
  } catch (err) {
    logger.error('Failed to save .lrc file:', err)
  }
}

// ── Background lyrics fetcher ─────────────────────────────────────────────
// Crawls all local library tracks and fetches lyrics from LRCLIB for any that
// don't have a .lrc file yet.  Instrumental sentinels are retried after 7 days.
// Rate-limited to one request per 500 ms to avoid hammering LRCLIB.

const LYRICS_BG_DELAY_MS        = 500                          // ms between LRCLIB requests
const LYRICS_BG_RETRY_INTERVAL  = 7 * 24 * 60 * 60 * 1000    // 7 days in ms

let lyricsBgRunning = false
let lyricsBgPending = false

function lrcPathFor(audioPath: string): string {
  return join(dirname(audioPath), `${basename(audioPath, extname(audioPath))}.lrc`)
}

async function runLyricsBackgroundFetch() {
  if (lyricsBgRunning) { lyricsBgPending = true; return }
  lyricsBgRunning = true
  lyricsBgPending = false

  try {
    const localTracks = cache.tracks.filter(
      (t: any) => t.path && !t.path.startsWith('subsonic://')
    )

    let fetched = 0
    let skipped = 0

    for (const track of localTracks) {
      const lrcPath = lrcPathFor(track.path)
      let needsFetch = false

      if (!existsSync(lrcPath)) {
        needsFetch = true
      } else {
        try {
          const content = await readFile(lrcPath, 'utf-8')
          if (content.trim() === '[instrumental]') {
            const { mtime } = await stat(lrcPath)
            if (Date.now() - mtime.getTime() > LYRICS_BG_RETRY_INTERVAL) {
              needsFetch = true
            }
          }
        } catch { /* unreadable lrc – skip */ }
      }

      if (!needsFetch) { skipped++; continue }

      // Throttle requests
      await new Promise<void>(r => setTimeout(r, LYRICS_BG_DELAY_MS))

      // Abort if a fresh scan kicked off a new run; it will re-queue us
      if (lyricsBgPending) break

      try {
        const online = await fetchLRCLIB(track)
        if (online) {
          await saveLyricsFile(track.path, online)
          fetched++
          logger.info(`[lyrics-bg] fetched: ${track.artist} – ${track.title}`)
        } else {
          await saveLyricsFile(track.path, '[instrumental]')
          logger.info(`[lyrics-bg] no lyrics (instrumental): ${track.artist} – ${track.title}`)
        }
      } catch (err) {
        logger.error(`[lyrics-bg] error fetching ${track.title}:`, err)
      }
    }

    if (fetched > 0 || skipped > 0) {
      logger.info(`[lyrics-bg] done — fetched: ${fetched}, skipped: ${skipped}`)
    }
  } finally {
    lyricsBgRunning = false
    if (lyricsBgPending) {
      setTimeout(runLyricsBackgroundFetch, 2000)
    }
  }
}

// ── Last.fm scrobbling helpers ─────────────────────────────────────────────
function md5(str: string): string {
  return createHash('md5').update(str, 'utf-8').digest('hex')
}

function lastfmApiSign(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params).sort()
  let sig = ''
  for (const k of keys) sig += k + params[k]
  sig += secret
  return md5(sig)
}

function httpPost(url: string, body: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = httpsRequest(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve(data))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function lastfmScrobble(apiKey: string, apiSecret: string, sessionKey: string, data: { title: string; artist: string; album: string; timestamp: number }) {
  const params: Record<string, string> = {
    method: 'track.scrobble',
    api_key: apiKey,
    sk: sessionKey,
    artist: data.artist,
    track: data.title,
    album: data.album,
    timestamp: String(Math.floor(data.timestamp / 1000)),
  }
  params.api_sig = lastfmApiSign(params, apiSecret)
  params.format = 'json'
  const body = new URLSearchParams(params).toString()
  await httpPost('https://ws.audioscrobbler.com/2.0/', body)
}

async function lastfmUpdateNowPlaying(apiKey: string, apiSecret: string, sessionKey: string, data: { title: string; artist: string; album: string; duration: number }) {
  const params: Record<string, string> = {
    method: 'track.updateNowPlaying',
    api_key: apiKey,
    sk: sessionKey,
    artist: data.artist,
    track: data.title,
    album: data.album,
    duration: String(Math.round(data.duration)),
  }
  params.api_sig = lastfmApiSign(params, apiSecret)
  params.format = 'json'
  const body = new URLSearchParams(params).toString()
  await httpPost('https://ws.audioscrobbler.com/2.0/', body)
}

async function listenbrainzSubmit(token: string, listenType: 'single' | 'playing_now', data: { title: string; artist: string; album: string; duration?: number; timestamp?: number }) {
  const payload: any = {
    listen_type: listenType === 'single' ? 'single' : 'playing_now',
    payload: [
      {
        track_metadata: {
          artist_name: data.artist,
          track_name: data.title,
          release_name: data.album,
          additional_info: {
            duration_ms: data.duration ? Math.round(data.duration * 1000) : undefined,
          },
        },
      },
    ],
  }
  if (listenType === 'single' && data.timestamp) {
    payload.payload[0].listened_at = Math.floor(data.timestamp / 1000)
  }
  const body = JSON.stringify(payload)
  const urlObj = new URL('https://api.listenbrainz.org/1/submit-listens')
  return new Promise<void>((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = ''
        res.on('data', (chunk) => (d += chunk))
        res.on('end', () => resolve())
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Window ─────────────────────────────────────────────────────────────────
async function createWindow() {
  // Load settings to check transparency preference
  const settings = await loadSettings()
  const isTransparent = settings.transparencyEnabled !== false // default true

  // Center window on the primary display (fixes Wayland multi-monitor placement)
  const primary = screen.getPrimaryDisplay()
  const { x, y, width: areaW, height: areaH } = primary.workArea
  const winW = 1280
  const winH = 800

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round(x + (areaW - winW) / 2),
    y: Math.round(y + (areaH - winH) / 2),
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: isTransparent,
    backgroundColor: isTransparent ? '#00000000' : '#0c0c0c',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })

  // Send window state changes (maximize/fullscreen) to the renderer
  function sendWindowState() {
    if (!mainWindow) return
    mainWindow.webContents.send('window:state-changed', {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    })
  }
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)
  mainWindow.on('enter-full-screen', sendWindowState)
  mainWindow.on('leave-full-screen', sendWindowState)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  // Prevent Ctrl+click / middle-click on router-links from opening a blank Electron window
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Forward renderer console logs to the log file
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const src = sourceId ? ` (${sourceId}:${line})` : ''
    const msg = `[renderer]${src} ${message}`
    if (level === 3) logger.error(msg)
    else if (level === 2) logger.warn(msg)
    else logger.info(msg)
  })

  // Initialize custom MPRIS service (Linux only)
  initMpris(mainWindow)
  logger.info('Window created')
}

// ── System tray ───────────────────────────────────────────────────────────
function createTray() {
  if (tray) return
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../build/icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Aurora')
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Aurora',
      click: () => {
        if (!mainWindow) return
        mainWindow.show()
        mainWindow.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function destroyTray() {
  tray?.destroy()
  tray = null
}

// ── Single-instance lock + file-open handling ──────────────────────────────
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.opus', '.wav', '.m4a', '.aac', '.wma'])

function extractAudioFiles(argv: string[]): string[] {
  // Skip the first two entries (electron binary + app path / '--' separator)
  return argv.slice(app.isPackaged ? 1 : 2).filter((arg) => {
    if (arg.startsWith('--') || arg.startsWith('-')) return false
    const ext = extname(arg).toLowerCase()
    return AUDIO_EXTS.has(ext) && existsSync(arg)
  })
}

// Files passed via CLI on initial launch
let pendingOpenFiles: string[] = extractAudioFiles(process.argv)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // Another instance is already running — it will receive our files via second-instance
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // A second instance was opened — bring the window to front and open the files
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const files = extractAudioFiles(argv)
    if (files.length > 0 && mainWindow) {
      mainWindow.webContents.send('app:open-files', files)
    }
  })
}

// ── Remove default menu to prevent accelerator interference ───────────────
// The default Electron application menu registers Ctrl+Z/X/C/V etc. at the
// OS level.  On KDE those can be consumed before the renderer sees the keydown
// event.  Since Aurora is a frameless app with its own UI, the menu bar is
// unused anyway.
Menu.setApplicationMenu(null)

// ── Linux display server detection (must run before app.whenReady) ─────────
// Use ozone-platform-hint=auto so Electron 28 picks Wayland or X11 automatically.
// We still log which session type was detected for debugging purposes.
if (process.platform === 'linux') {
  // Force all GTK file-chooser dialogs to go through the XDG desktop portal
  // (xdg-desktop-portal-kde / -gnome) so the native KDE/GNOME picker is used
  // consistently instead of whichever GTK widget Electron happens to load.
  process.env.GTK_USE_PORTAL = '1'
  const waylandDisplay = process.env.WAYLAND_DISPLAY
  const sessionType = process.env.XDG_SESSION_TYPE
  const isWayland = !!waylandDisplay || sessionType === 'wayland'

  // ozone-platform-hint=auto lets Electron choose the right backend without
  // us needing to manipulate enable-features (which can break compositors).
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

  // GTK4 uses XDG portals for file dialogs, giving the proper system-native
  // file picker (GNOME, KDE, etc.) instead of the old GTK3 chooser widget.
  app.commandLine.appendSwitch('gtk-version', '4')

  if (isWayland) {
    // hls.js uses MediaSource with hardware H.264 decoding, which crashes the
    // Wayland GPU sub-process. Forcing software decode prevents the crash.
    app.commandLine.appendSwitch('disable-accelerated-video-decode')
  }

  logger.info(`Display server: ${isWayland ? 'Wayland' : 'X11'} (WAYLAND_DISPLAY=${waylandDisplay ?? 'unset'}, XDG_SESSION_TYPE=${sessionType ?? 'unset'}, DISPLAY=${process.env.DISPLAY ?? 'unset'})`)
}

// ── XDG migration ─────────────────────────────────────────────────────────
// On Linux, data that used to live entirely in the config dir (~/.config/aurora-player)
// is migrated to the proper XDG directories on first run with the new layout.
async function migrateToXdg(): Promise<void> {
  if (process.platform !== 'linux') return

  const oldBase = app.getPath('userData') // ~/.config/aurora-player (unchanged)

  // Nothing to do if new paths == old path (e.g. XDG_DATA_HOME == ~/.config)
  if (appPaths.data === oldBase && appPaths.cache === oldBase) return

  // [source-subpath, dest-dir] pairs to attempt moving
  const moves: [string, string][] = [
    // data
    ['library.json',     appPaths.data],
    ['playlists.json',   appPaths.data],
    ['favorites.json',   appPaths.data],
    ['backups',          appPaths.data],
    ['stats',            appPaths.data],
    ['themes',           appPaths.data],
    ['plugins',          appPaths.data],
    ['plugin-settings',  appPaths.data],
    ['plugin-data',      appPaths.data],
    // cache
    ['cover-cache',      appPaths.cache],
    ['waveform-cache.json', appPaths.cache],
    ['artist-cache.json',   appPaths.cache],
    // state (logs are written to the new location from the start; only rotate old ones)
    ['aurora.log',     appPaths.state],
    ['aurora.log.1',   appPaths.state],
    ['aurora.log.2',   appPaths.state],
  ]

  for (const [name, destDir] of moves) {
    const src = join(oldBase, name)
    const dest = join(destDir, name)
    if (!existsSync(src) || existsSync(dest)) continue
    try {
      await mkdir(destDir, { recursive: true })
      await rename(src, dest)
      logger.info(`XDG migration: moved ${name} → ${destDir}`)
    } catch (err: any) {
      // EXDEV = cross-device rename (different filesystems) — log and skip
      logger.warn(`XDG migration: could not move ${name}: ${err?.message}`)
    }
  }
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Migrate existing data to XDG directories (no-op on first run or non-Linux)
  await migrateToXdg()

  // Register localfile:// protocol to serve local files with range-request
  // support so that <audio> seeking works correctly.
  const mimeByExt: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
    '.opus': 'audio/opus', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma', '.alac': 'audio/mp4',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif',
  }

  protocol.handle('localfile', async (request) => {
    try {
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)
      if (!filePath || filePath === '/') {
        return new Response('Not found', { status: 404 })
      }
      // On Windows, strip leading / from /C:/... paths
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) {
        filePath = filePath.slice(1)
      }

      const fileStat = await stat(filePath)
      const fileSize = fileStat.size
      const ext = extname(filePath).toLowerCase()
      const contentType = mimeByExt[ext] || 'application/octet-stream'

      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1
          if (start >= fileSize) {
            return new Response('Range Not Satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${fileSize}` },
            })
          }
          const chunkSize = end - start + 1
          const nodeStream = createReadStream(filePath, { start, end })
          const body = new ReadableStream({
            start(controller) {
              nodeStream.on('data', (chunk: string | Buffer) => controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
              nodeStream.on('end', () => controller.close())
              nodeStream.on('error', (err) => controller.error(err))
            },
            cancel() { nodeStream.destroy() },
          })
          return new Response(body, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunkSize),
              'Content-Type': contentType,
            },
          })
        }
      }

      // Full-file response — include Content-Length & Accept-Ranges so the
      // browser knows it can seek.
      const nodeStream = createReadStream(filePath)
      const body = new ReadableStream({
        start(controller) {
          nodeStream.on('data', (chunk: string | Buffer) => controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
          nodeStream.on('end', () => controller.close())
          nodeStream.on('error', (err) => controller.error(err))
        },
        cancel() { nodeStream.destroy() },
      })
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Length': String(fileSize),
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  await createWindow()

  // ── Tray icon ──────────────────────────────────────────────────────────
  loadSettings().then((s) => {
    if (s.trayEnabled !== false) createTray()
  })

  // ── Animated covers ────────────────────────────────────────────────────
  registerAnimatedCoverIPC()

  // ── Remote control server ──────────────────────────────────────────────
  registerRemoteIPC(() => app.getPath('userData'))
  if (isRemoteEnabled(app.getPath('userData'))) {
    startRemoteServer(mainWindow!, () => app.getPath('userData'))
  }

  ipcMain.handle('remote:start-server', () => {
    startRemoteServer(mainWindow!, () => app.getPath('userData'))
  })

  ipcMain.handle('remote:stop-server', () => {
    stopRemoteServer()
  })

  // Load library into memory cache on startup
  await loadCache()
  await loadArtistCache()
  await loadStreamsCache()
  await loadWaveformCache()
  logger.info(`Library cache loaded: ${cache.tracks.length} tracks, ${cache.folders.length} folders`)
  // Start background lyrics fetch 30 s after startup so the UI can settle first
  setTimeout(runLyricsBackgroundFetch, 30_000)

  // Initialize Discord Rich Presence
  loadSettings().then((settings) => {
    if (settings.discordRPC !== false) {
      initDiscordRPC(settings.discordClientId)
    }

    // Restore Subsonic config if previously connected
    if (settings.subsonicUrl && settings.subsonicUsername && settings.subsonicPassword) {
      setSubsonicConfig({
        url: settings.subsonicUrl,
        username: settings.subsonicUsername,
        password: settings.subsonicPassword,
        useLegacyAuth: settings.subsonicLegacyAuth === true,
      })
    }
  })

  // ── IPC: Dialogs ──
  ipcMain.handle('dialog:open-folder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Music Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── IPC: Open files (right-click / file association) ──
  ipcMain.handle('app:get-open-files', () => {
    const files = pendingOpenFiles
    pendingOpenFiles = []
    return files
  })

  ipcMain.handle('library:parse-file', async (_, filePath: string) => {
    return await parseTrack(filePath)
  })

  // ── IPC: Library ──
  ipcMain.handle('library:scan-folder', async (_, folderPath: string) => {
    const audioFiles = await scanDirectory(folderPath)
    const newTracks: any[] = []

    const batchSize = 10
    for (let i = 0; i < audioFiles.length; i += batchSize) {
      const batch = audioFiles.slice(i, i + batchSize)
      const parsed = await Promise.all(batch.map(parseTrack))
      newTracks.push(...parsed)

      if (mainWindow) {
        mainWindow.webContents.send('library:scan-progress', {
          current: Math.min(i + batchSize, audioFiles.length),
          total: audioFiles.length,
        })
      }
    }

    if (!cache.folders.includes(folderPath)) {
      cache.folders.push(folderPath)
    }

    // Merge into cache – replace existing by path
    const previousIds = new Set(cache.tracks.map((t: any) => t.id))
    for (const track of newTracks) {
      cache.trackMap.set(track.path, track)
    }

    // Drop tracks under this folder whose files are gone (deleted, moved or renamed).
    // Skipped when the folder itself is missing, e.g. an unplugged drive, so its
    // tracks come back when it does instead of being wiped.
    if (existsSync(folderPath)) {
      const found = new Set(audioFiles)
      const prefix = folderPath.endsWith(sep) ? folderPath : folderPath + sep
      for (const path of [...cache.trackMap.keys()]) {
        if (path.startsWith(prefix) && !found.has(path)) cache.trackMap.delete(path)
      }
    }
    cache.tracks = Array.from(cache.trackMap.values())
    rebuildIndexes()
    scheduleFlush()

    // Notify renderer of tracks with missing essential metadata (new tracks only)
    const genuinelyNew = newTracks.filter((t: any) => !previousIds.has(t.id))
    const missingMeta = genuinelyNew.filter((t: any) =>
      (!t.title || t.title === t.path.split('/').pop()?.replace(/\.[^.]+$/, '') || t.title === 'Unknown') &&
      (!t.artist || t.artist === 'Unknown Artist')
    )
    if (missingMeta.length > 0 && mainWindow) {
      mainWindow.webContents.send('library:found-missing-metadata', missingMeta.length)
    }

    // Kick off background lyrics fetch for any newly added tracks (5 s delay
    // lets the renderer finish processing the scan result first)
    setTimeout(runLyricsBackgroundFetch, 5_000)

    return cache.tracks
  })

  ipcMain.handle('library:get-data', async () => {
    return cache.tracks
  })

  ipcMain.handle('library:get-folders', async () => {
    return cache.folders
  })

  ipcMain.handle('library:remove-folder', async (_, folderPath: string) => {
    cache.folders = cache.folders.filter((f: string) => f !== folderPath)
    cache.tracks = cache.tracks.filter((t: any) => !t.path.startsWith(folderPath))
    rebuildIndexes()
    scheduleFlush()
    return { folders: cache.folders, tracks: cache.tracks }
  })

  // ── IPC: Lyrics ──
  ipcMain.handle('lyrics:get', async (_, trackPath: string) => {
    // Skip local lyrics lookup for remote/subsonic tracks
    if (trackPath.startsWith('subsonic://')) return null
    return await findLocalLyrics(trackPath)
  })

  ipcMain.handle('lyrics:fetch-online', async (_, trackInfo: { path: string; title: string; artist: string; album: string; duration: number }) => {
    const online = await fetchLRCLIB(trackInfo)
    if (trackInfo.path && !trackInfo.path.startsWith('subsonic://')) {
      if (online) {
        // Save the fetched lyrics as .lrc file next to the audio
        await saveLyricsFile(trackInfo.path, online)
      } else {
        // Save a sentinel so we don't hit LRCLIB again for this instrumental track
        await saveLyricsFile(trackInfo.path, '[instrumental]')
      }
    }
    return online
  })

  // ── IPC: App paths (for Settings display) ──
  ipcMain.handle('app:get-paths', () => ({
    config: appPaths.config,
    data:   appPaths.data,
    cache:  appPaths.cache,
    state:  appPaths.state,
  }))

  // ── IPC: Settings ──
  ipcMain.handle('settings:get', async () => await loadSettings())
  ipcMain.handle('settings:set', async (_, settings: any) => await saveSettings(settings))
  // Atomic merge — reads current settings, merges partial on top, writes back.
  // Keys set to null are deleted. This avoids race conditions between concurrent callers.
  ipcMain.handle('settings:merge', async (_, partial: Record<string, any>) => {
    const current = await loadSettings()
    for (const [key, value] of Object.entries(partial)) {
      if (value === null || value === undefined) {
        delete current[key]
      } else {
        current[key] = value
      }
    }
    await saveSettings(current)
  })

  // ── IPC: Logging ──
  ipcMain.handle('logger:get-path', () => getLogPath())
  ipcMain.on('logger:write', (_, level: string, message: string) => {
    switch (level) {
      case 'error': logger.error('[renderer]', message); break
      case 'warn':  logger.warn('[renderer]', message); break
      case 'info':  logger.info('[renderer]', message); break
      default:      logger.debug('[renderer]', message); break
    }
  })

  // ── IPC: Exclusive audio mode status ──
  ipcMain.handle('audio:exclusive-status', () => ({
    active: exclusiveModeActive,
    alsaDevice: exclusiveAlsaDevice,
    platform: process.platform,
  }))

  // ── IPC: Enumerate ALSA hardware devices (Linux only) ──
  ipcMain.handle('audio:list-alsa-devices', () => {
    if (process.platform !== 'linux') return []
    return new Promise<{ id: string; name: string; label: string }[]>((resolve) => {
      execFile('aplay', ['-l'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          logger.error('Failed to enumerate ALSA devices:', err.message)
          resolve([])
          return
        }
        // Parse output like:
        // card 0: PCH [HDA Intel PCH], device 0: ALC892 Analog [ALC892 Analog]
        const devices: { id: string; name: string; label: string }[] = []
        const lines = stdout.split('\n')
        for (const line of lines) {
          const match = line.match(/^card\s+(\d+):\s+\S+\s+\[([^\]]+)\],\s+device\s+(\d+):\s+(.+?)\s+\[([^\]]+)\]/)
          if (match) {
            const cardNum = match[1]
            const cardName = match[2]
            const devNum = match[3]
            const devName = match[5]
            devices.push({
              id: `hw:${cardNum},${devNum}`,
              name: `${cardName} - ${devName}`,
              label: `hw:${cardNum},${devNum} — ${cardName} - ${devName}`,
            })
          }
        }
        resolve(devices)
      })
    })
  })

  // ── IPC: Update checker ──
  ipcMain.handle('app:check-update', async () => {
    try {
      const currentVersion = app.getVersion()
      const raw = await fetchJSON('https://api.github.com/repos/Wilk087/Aurora/releases/latest')
      const data = JSON.parse(raw)
      const latestTag: string = data.tag_name || ''
      // Strip leading 'v' from tag (e.g. "v2.2.0" → "2.2.0")
      const latestVersion = latestTag.replace(/^v/, '')
      if (!latestVersion) return null
      const isNewer = compareVersions(latestVersion, currentVersion) > 0
      return isNewer ? { currentVersion, latestVersion, url: data.html_url || `https://github.com/Wilk087/Aurora/releases/tag/${latestTag}` } : null
    } catch {
      return null
    }
  })

  ipcMain.handle('app:get-version', () => app.getVersion())

  // ── IPC: Open external URL in system browser ──
  ipcMain.handle('app:open-external', async (_, url: string) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      const { shell } = await import('electron')
      await shell.openExternal(url)
    }
  })

  // ── IPC: Plugin-safe HTTP fetch (bypasses renderer CORS restrictions) ──
  // Plugins call window.api.netFetch(url, options) instead of fetch() to avoid
  // CORS blocks — requests go through Electron's net module in the main process.
  ipcMain.handle('net:fetch', async (_, url: string, options?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }) => {
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('net:fetch only supports http/https URLs')
    }
    const resp = await net.fetch(url, options as RequestInit)
    const text = await resp.text()
    return { ok: resp.ok, status: resp.status, text }
  })

  // ── IPC: Favorites ──
  ipcMain.handle('favorites:get', async () => await loadFavorites())
  ipcMain.handle('favorites:toggle', async (_, trackId: string, meta?: TrackMetaSnapshot) => {
    const idx = favoriteIds.indexOf(trackId)
    if (idx >= 0) {
      favoriteIds.splice(idx, 1)
      delete favoriteMeta[trackId]
    } else {
      favoriteIds.push(trackId)
      if (meta) favoriteMeta[trackId] = meta
    }
    await saveFavorites()
    return { ids: favoriteIds, meta: favoriteMeta }
  })
  ipcMain.handle('favorites:set', async (_, ids: string[], meta?: Record<string, TrackMetaSnapshot>) => {
    favoriteIds = ids
    if (meta) favoriteMeta = meta
    await saveFavorites()
    return { ids: favoriteIds, meta: favoriteMeta }
  })

  // ── IPC: Tags ──
  ipcMain.handle('tags:get', async () => await loadTags())

  ipcMain.handle('tags:set-track-tags', async (_, ids: string[], tags: string[]) => {
    for (const id of ids) {
      if (tags.length === 0) {
        delete trackTagsData[id]
      } else {
        trackTagsData[id] = tags
      }
    }
    await saveTags()
    return { trackTags: trackTagsData, albumTags: albumTagsData }
  })

  ipcMain.handle('tags:set-album-tags', async (_, albumKeys: string[], tags: string[]) => {
    for (const key of albumKeys) {
      if (tags.length === 0) {
        delete albumTagsData[key]
      } else {
        albumTagsData[key] = tags
      }
    }
    await saveTags()
    return { trackTags: trackTagsData, albumTags: albumTagsData }
  })

  ipcMain.handle('tags:add-track-tags', async (_, ids: string[], tagsToAdd: string[]) => {
    for (const id of ids) {
      const current = new Set(trackTagsData[id] || [])
      for (const t of tagsToAdd) current.add(t.toLowerCase().trim())
      trackTagsData[id] = Array.from(current)
    }
    await saveTags()
    return { trackTags: trackTagsData, albumTags: albumTagsData }
  })

  ipcMain.handle('tags:add-album-tags', async (_, albumKeys: string[], tagsToAdd: string[]) => {
    for (const key of albumKeys) {
      const current = new Set(albumTagsData[key] || [])
      for (const t of tagsToAdd) current.add(t.toLowerCase().trim())
      albumTagsData[key] = Array.from(current)
    }
    await saveTags()
    return { trackTags: trackTagsData, albumTags: albumTagsData }
  })

  ipcMain.handle('tags:remove-track-tags', async (_, ids: string[], tagsToRemove: string[]) => {
    const removeSet = new Set(tagsToRemove.map(t => t.toLowerCase().trim()))
    for (const id of ids) {
      if (trackTagsData[id]) {
        trackTagsData[id] = trackTagsData[id].filter(t => !removeSet.has(t))
        if (trackTagsData[id].length === 0) delete trackTagsData[id]
      }
    }
    await saveTags()
    return { trackTags: trackTagsData, albumTags: albumTagsData }
  })

  ipcMain.handle('tags:remove-album-tags', async (_, albumKeys: string[], tagsToRemove: string[]) => {
    const removeSet = new Set(tagsToRemove.map(t => t.toLowerCase().trim()))
    for (const key of albumKeys) {
      if (albumTagsData[key]) {
        albumTagsData[key] = albumTagsData[key].filter(t => !removeSet.has(t))
        if (albumTagsData[key].length === 0) delete albumTagsData[key]
      }
    }
    await saveTags()
    return { trackTags: trackTagsData, albumTags: albumTagsData }
  })

  ipcMain.handle('tags:apply-sync', async (_, merged: { trackTags: Record<string, string[]>; albumTags: Record<string, string[]> }) => {
    trackTagsData = merged.trackTags
    albumTagsData = merged.albumTags
    await saveTags()
    return { trackTags: trackTagsData, albumTags: albumTagsData }
  })

  // ── IPC: Transitions ──
  ipcMain.handle('transitions:get', async () => await loadTransitions())
  ipcMain.handle('transitions:save', async (_, t: any) => {
    await loadTransitions()
    if (!isValidTransition(t)) throw new Error('Invalid transition')
    // A pair holds one transition; drop any older copy of this id (e.g. its songKey changed)
    for (const [k, v] of Object.entries(transitionsData)) {
      if (v?.id === t.id) delete transitionsData[k]
    }
    transitionsData[`${t.from.key}→${t.to.key}`] = t
    await saveTransitions()
    return transitionsData
  })
  ipcMain.handle('transitions:delete', async (_, id: string) => {
    await loadTransitions()
    for (const [k, v] of Object.entries(transitionsData)) {
      if (v?.id === id) delete transitionsData[k]
    }
    await saveTransitions()
    return transitionsData
  })

  // ── IPC: Beat grid cache ──
  ipcMain.handle('beatgrid:get', async (_, filePath: string) => {
    try {
      const entry = (await getBeatgridCache())[filePath]
      if (!entry) return null
      const st = await stat(filePath)
      return entry.mtimeMs === st.mtimeMs && entry.size === st.size ? entry.grid : null
    } catch { return null }
  })
  ipcMain.handle('beatgrid:set', async (_, filePath: string, grid: any) => {
    try {
      const st = await stat(filePath)
      ;(await getBeatgridCache())[filePath] = { mtimeMs: st.mtimeMs, size: st.size, grid }
      scheduleBeatgridFlush()
    } catch (err) {
      logger.error('beatgrid:set failed:', err)
    }
  })

  // ── IPC: Discord RPC ──
  ipcMain.handle('discord:update-presence', async (_, data) => {
    await updateDiscordPresence(data)
  })

  ipcMain.handle('discord:toggle', async (_, enabled: boolean, clientId?: string) => {
    if (enabled) {
      if (!rpcReady) await initDiscordRPC(clientId)
    } else {
      await updateDiscordPresence(null)
      await destroyDiscordRPC()
    }
  })

  // ── IPC: Playlists ──
  await loadPlaylists()

  ipcMain.handle('playlists:get-all', async () => {
    return playlists
  })

  ipcMain.handle('playlists:get', async (_, id: string) => {
    return playlists.find(p => p.id === id) || null
  })

  ipcMain.handle('playlists:create', async (_, name: string) => {
    const now = Date.now()
    const playlist: Playlist = {
      id: generateId(`playlist-${name}-${now}`),
      name,
      trackIds: [],
      createdAt: now,
      updatedAt: now,
    }
    playlists.push(playlist)
    await savePlaylists()
    return playlist
  })

  ipcMain.handle('playlists:delete', async (_, id: string) => {
    playlists = playlists.filter(p => p.id !== id)
    await savePlaylists()
    // Track tombstone for cross-device sync
    const s = await loadSettings()
    const cutoff = Date.now() - 30 * 86400000
    const deletedIds: { id: string; deletedAt: number }[] = (s.syncDeletedIds ?? []).filter((d: any) => d.deletedAt > cutoff)
    deletedIds.push({ id, deletedAt: Date.now() })
    await mergeSettingsFile({ syncDeletedIds: deletedIds })
    return playlists
  })

  ipcMain.handle('playlists:rename', async (_, id: string, name: string) => {
    const pl = playlists.find(p => p.id === id)
    if (pl) {
      pl.name = name
      pl.updatedAt = Date.now()
      await savePlaylists()
    }
    return pl || null
  })

  ipcMain.handle('playlists:edit', async (_, id: string, data: { name?: string; description?: string; customImage?: string | null }) => {
    const pl = playlists.find(p => p.id === id)
    if (pl) {
      if (data.name !== undefined && data.name.trim()) pl.name = data.name.trim()
      if (data.description !== undefined) {
        if (data.description.trim()) {
          pl.description = data.description.trim()
        } else {
          delete pl.description
        }
      }
      if ('customImage' in data) {
        if (data.customImage === null) {
          delete pl.customImage
        } else if (data.customImage) {
          pl.customImage = data.customImage
        }
      }
      pl.updatedAt = Date.now()
      await savePlaylists()
    }
    return pl || null
  })

  ipcMain.handle('playlists:set-custom-image', async (_, id: string, imagePath: string | null) => {
    const pl = playlists.find(p => p.id === id)
    if (pl) {
      if (imagePath === null) {
        delete pl.customImage
      } else {
        pl.customImage = imagePath
      }
      pl.updatedAt = Date.now()
      await savePlaylists()
    }
    return pl || null
  })

  ipcMain.handle('playlists:add-tracks', async (_, id: string, trackIds: string[], trackMeta?: Record<string, TrackMetaSnapshot>) => {
    const pl = playlists.find(p => p.id === id)
    if (pl) {
      for (const tid of trackIds) {
        if (!pl.trackIds.includes(tid)) pl.trackIds.push(tid)
      }
      // Merge metadata snapshots
      if (trackMeta) {
        if (!pl.trackMeta) pl.trackMeta = {}
        Object.assign(pl.trackMeta, trackMeta)
      }
      pl.updatedAt = Date.now()
      await savePlaylists()
    }
    return pl || null
  })

  ipcMain.handle('playlists:remove-track', async (_, id: string, trackId: string) => {
    const pl = playlists.find(p => p.id === id)
    if (pl) {
      pl.trackIds = pl.trackIds.filter(t => t !== trackId)
      if (pl.trackMeta) delete pl.trackMeta[trackId]
      pl.updatedAt = Date.now()
      await savePlaylists()
    }
    return pl || null
  })

  ipcMain.handle('playlists:reorder-tracks', async (_, id: string, fromIndex: number, toIndex: number) => {
    const pl = playlists.find(p => p.id === id)
    if (pl && !pl.smart) {
      const [removed] = pl.trackIds.splice(fromIndex, 1)
      pl.trackIds.splice(toIndex, 0, removed)
      pl.updatedAt = Date.now()
      await savePlaylists()
    }
    return pl || null
  })

  ipcMain.handle('playlists:export-m3u', async (_, id: string) => {
    const pl = playlists.find(p => p.id === id)
    if (!pl) return { success: false }
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `${pl.name}.m3u`,
      filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }],
    })
    if (result.canceled || !result.filePath) return { success: false }
    const trackMap = new Map(cache.tracks.map((t: any) => [t.id, t]))
    const lines = ['#EXTM3U']
    for (const tid of pl.trackIds) {
      const track = trackMap.get(tid)
      if (!track || !track.path || track.source === 'subsonic') continue
      lines.push(`#EXTINF:${Math.round(track.duration || 0)},${track.artist} - ${track.title}`)
      lines.push(track.path)
    }
    await writeFile(result.filePath, lines.join('\n'), 'utf-8')
    return { success: true, path: result.filePath }
  })

  ipcMain.handle('playlists:import-m3u', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: 'M3U Playlist', extensions: ['m3u', 'm3u8'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)
    // Parse EXTINF + path pairs
    const parsedPaths: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || line.startsWith('#EXTM3U') || line.startsWith('#EXTINFO')) continue
      if (line.startsWith('#EXTINF')) {
        const nextLine = lines[i + 1]?.trim()
        if (nextLine && !nextLine.startsWith('#')) { parsedPaths.push(nextLine); i++ }
      } else if (!line.startsWith('#')) {
        parsedPaths.push(line)
      }
    }
    // Match paths against library
    const m3uDir = dirname(filePath)
    const pathMap = new Map(cache.tracks.map((t: any) => [t.path.replace(/\\/g, '/'), t]))
    const matched: any[] = []
    const unmatched: string[] = []
    for (const rawPath of parsedPaths) {
      const normalized = rawPath.replace(/\\/g, '/')
      const absPath = normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
        ? normalized
        : join(m3uDir, rawPath).replace(/\\/g, '/')
      const track = pathMap.get(absPath)
      if (track) matched.push(track)
      else unmatched.push(rawPath)
    }
    // Create new playlist
    const name = basename(filePath, extname(filePath))
    const now = Date.now()
    const pl: Playlist = {
      id: generateId(`playlist-${name}-${now}`),
      name,
      trackIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const trackMeta: Record<string, TrackMetaSnapshot> = {}
    for (const t of matched) {
      pl.trackIds.push(t.id)
      trackMeta[t.id] = { title: t.title, artist: t.artist, album: t.album }
    }
    pl.trackMeta = trackMeta
    playlists.push(pl)
    await savePlaylists()
    return { playlistId: pl.id, matched: matched.length, unmatched }
  })

  // ── IPC: Window controls ──
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => {
    if (tray) {
      mainWindow?.hide()
    } else {
      mainWindow?.close()
    }
  })
  ipcMain.handle('tray:set-enabled', (_, enabled: boolean) => {
    if (enabled) {
      createTray()
    } else {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show()
        mainWindow.focus()
      }
      destroyTray()
    }
  })
  ipcMain.on('app:relaunch', () => {
    isRelaunching = true
    app.relaunch()
    app.quit()
  })
  ipcMain.on('window:enter-fullscreen', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(true)
  })
  ipcMain.on('window:exit-fullscreen', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(false)
  })
  ipcMain.on('window:set-opacity', (_, value: number) => {
    if (!mainWindow) return
    mainWindow.setOpacity(Math.max(0.1, Math.min(1, value)))
  })

  let normalBounds: Electron.Rectangle | null = null
  ipcMain.on('window:enter-mini', () => {
    if (!mainWindow) return
    normalBounds = mainWindow.getBounds()
    mainWindow.setMinimumSize(360, 90)
    mainWindow.setResizable(false)
    mainWindow.setAlwaysOnTop(true)
    mainWindow.setBounds({ width: 360, height: 90 })
  })
  ipcMain.on('window:exit-mini', () => {
    if (!mainWindow) return
    mainWindow.setResizable(true)
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setMinimumSize(900, 600)
    if (normalBounds) {
      mainWindow.setBounds(normalBounds)
      normalBounds = null
    }
  })
  ipcMain.on('window:resize-mini', (_, height: number) => {
    if (!mainWindow) return
    const b = mainWindow.getBounds()
    mainWindow.setMinimumSize(360, height)
    mainWindow.setBounds({ x: b.x, y: b.y, width: 360, height })
  })

  // ── IPC: MPRIS updates (renderer → main → D-Bus) ──
  ipcMain.on('mpris:metadata', (_, data) => updateMprisMetadata(data))
  ipcMain.on('mpris:playback-status', (_, status) => updateMprisPlaybackStatus(status))
  ipcMain.on('mpris:position', (_, seconds) => updateMprisPosition(seconds))
  ipcMain.on('mpris:volume', (_, vol) => updateMprisVolume(vol))
  ipcMain.on('mpris:loop-status', (_, mode) => updateMprisLoopStatus(mode))
  ipcMain.on('mpris:shuffle', (_, enabled) => updateMprisShuffle(enabled))
  ipcMain.on('mpris:seeked', (_, seconds) => emitMprisSeeked(seconds))
  ipcMain.handle('mpris:cover-path', (_, coverArt: string) => {
    // Return a file:// URL for the cover art path (used for MPRIS artwork)
    if (!coverArt) return ''
    return `file://${coverArt}`
  })

  // ── IPC: Track credits / extended metadata ──
  ipcMain.handle('track:get-credits', async (_, trackPath: string) => {
    try {
      if (trackPath.startsWith('http://') || trackPath.startsWith('https://')) return null
      const mm = await import('music-metadata')
      const metadata = await mm.parseFile(trackPath)
      const c = metadata.common
      const f = metadata.format
      return {
        composer: c.composer || [],
        lyricist: c.lyricist || [],
        conductor: c.conductor || [],
        producer: (c as any).producer || [],
        engineer: (c as any).engineer || [],
        mixer: (c as any).mixer || [],
        remixer: (c as any).remixer || [],
        writer: (c as any).writer || [],
        label: c.label || [],
        copyright: c.copyright || '',
        encodedBy: c.encodedby || '',
        comment: c.comment ? c.comment[0] || '' : '',
        bpm: c.bpm || null,
        bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
        sampleRate: f.sampleRate || null,
        bitsPerSample: f.bitsPerSample || null,
        codec: f.codec || '',
        lossless: f.lossless || false,
      }
    } catch (err) {
      logger.error('Failed to read track credits:', err)
      return {
        composer: [], lyricist: [], conductor: [], producer: [],
        engineer: [], mixer: [], remixer: [], writer: [], label: [],
        copyright: '', encodedBy: '', comment: '',
        bpm: null, bitrate: null, sampleRate: null, bitsPerSample: null, codec: '', lossless: false,
      }
    }
  })

  // ── IPC: Waveform generation (runs in main process to avoid renderer OOM) ──
  ipcMain.handle('track:generate-waveform', async (_, trackPath: string) => {
    // Check disk cache first
    const cacheKey = generateId(trackPath)
    if (waveformDiskCache[cacheKey]) {
      return waveformDiskCache[cacheKey]
    }

    let result: number[] = []
    try {
      const mm = await import('music-metadata')
      const fstat = await stat(trackPath)
      const fileSize = fstat.size
      const BARS = 200
      const MAX_MEMORY = 50 * 1024 * 1024

      const metadata = await mm.parseFile(trackPath, { duration: true })
      const sampleRate = metadata.format.sampleRate || 44100
      const channels = metadata.format.numberOfChannels || 2
      const bitsPerSample = metadata.format.bitsPerSample || 16
      const bytesPerSample = bitsPerSample / 8
      const duration = metadata.format.duration || 0

      if (duration === 0) return []

      const ext = extname(trackPath).toLowerCase()
      const isPCM = ['.wav', '.aif', '.aiff'].includes(ext)

      if (isPCM && fileSize <= MAX_MEMORY * 2) {
        const buffer = await readFile(trackPath)
        const headerSize = ext === '.wav' ? 44 : 0
        const dataLen = buffer.length - headerSize
        const totalSamples = Math.floor(dataLen / (bytesPerSample * channels))
        const samplesPerBar = Math.floor(totalSamples / BARS)
        const peaks: number[] = []
        for (let bar = 0; bar < BARS; bar++) {
          let sum = 0
          const startSample = bar * samplesPerBar
          const step = Math.max(1, Math.floor(samplesPerBar / 100))
          let count = 0
          for (let s = startSample; s < startSample + samplesPerBar && s < totalSamples; s += step) {
            const byteOffset = headerSize + s * bytesPerSample * channels
            if (byteOffset + bytesPerSample > buffer.length) break
            let value: number
            if (bytesPerSample === 2) { value = Math.abs(buffer.readInt16LE(byteOffset)) / 32768 }
            else if (bytesPerSample === 3) {
              value = buffer[byteOffset] | (buffer[byteOffset + 1] << 8) | (buffer[byteOffset + 2] << 16)
              if (value > 0x7FFFFF) value -= 0x1000000
              value = Math.abs(value) / 8388608
            } else { value = Math.abs(buffer.readInt8(byteOffset)) / 128 }
            sum += value; count++
          }
          peaks.push(count > 0 ? sum / count : 0)
        }
        const max = Math.max(...peaks, 0.001)
        result = peaks.map(p => p / max)
      } else {
        // Try ffmpeg for compressed formats
        try {
          const { execFile } = await import('child_process')
          const { promisify } = await import('util')
          const execFileAsync = promisify(execFile)
          const targetSampleRate = Math.min(8000, sampleRate)
          const ffResult = await execFileAsync('ffmpeg', [
            '-i', trackPath, '-ac', '1', '-ar', String(targetSampleRate),
            '-f', 's16le', '-v', 'quiet', 'pipe:1'
          ], { maxBuffer: targetSampleRate * 2 * Math.ceil(duration) + 1024, encoding: 'buffer' as any })
          const pcmBuffer = ffResult.stdout as unknown as Buffer
          const totalSamples = Math.floor(pcmBuffer.length / 2)
          const samplesPerBar = Math.floor(totalSamples / BARS)
          const peaks: number[] = []
          for (let bar = 0; bar < BARS; bar++) {
            let sum = 0, count = 0
            const startSample = bar * samplesPerBar
            for (let s = startSample; s < startSample + samplesPerBar && s < totalSamples; s++) {
              sum += Math.abs(pcmBuffer.readInt16LE(s * 2)) / 32768; count++
            }
            peaks.push(count > 0 ? sum / count : 0)
          }
          const max = Math.max(...peaks, 0.001)
          result = peaks.map(p => p / max)
        } catch {
          // ffmpeg not available — generate approximate waveform from file bytes
          const CHUNK_SIZE = 4096
          const chunkSpacing = Math.floor(fileSize / BARS)
          const peaks: number[] = []
          const { open, close, read: fsRead } = await import('fs')
          const { promisify } = await import('util')
          const openAsync = promisify(open)
          const readAsync = promisify(fsRead)
          const closeAsync = promisify(close)
          const fd = await openAsync(trackPath, 'r')
          try {
            for (let i = 0; i < BARS; i++) {
              const pos = Math.min(i * chunkSpacing, fileSize - CHUNK_SIZE)
              const buf = Buffer.alloc(CHUNK_SIZE)
              const { bytesRead } = await readAsync(fd, buf, 0, CHUNK_SIZE, pos)
              let sum = 0
              for (let j = 0; j < bytesRead; j += 2) {
                if (j + 1 < bytesRead) sum += Math.abs(buf.readInt16LE(j))
              }
              peaks.push(sum / (bytesRead / 2))
            }
          } finally { await closeAsync(fd) }
          const max = Math.max(...peaks, 0.001)
          result = peaks.map(p => p / max)
        }
      }
    } catch (err) {
      logger.error('Waveform generation error:', err)
      return []
    }

    // Save to disk cache
    if (result.length > 0) {
      waveformDiskCache[cacheKey] = result
      scheduleWaveformFlush()
    }
    return result
  })

  // ── IPC: Waveform generation for subsonic/Navidrome streams ──
  ipcMain.handle('track:generate-waveform-subsonic', async (_, songId: string) => {
    const cacheKey = `subsonic-${songId}`
    if (waveformDiskCache[cacheKey]) {
      return waveformDiskCache[cacheKey]
    }

    let tmpFile = ''
    try {
      const streamUrl = getStreamUrl(songId)
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileAsync = promisify(execFile)

      // Download the stream to a temp file first (avoids ffmpeg HTTPS/protocol issues)
      const tmpDir = join(cachePath, 'tmp')
      if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true })
      tmpFile = join(tmpDir, `waveform-${songId}`)

      const response = await fetch(streamUrl)
      if (!response.ok) throw new Error(`Stream fetch failed: ${response.status}`)
      const arrayBuf = await response.arrayBuffer()
      await writeFile(tmpFile, Buffer.from(arrayBuf))

      const BARS = 200
      const ffResult = await execFileAsync('ffmpeg', [
        '-i', tmpFile, '-ac', '1', '-ar', '8000',
        '-f', 's16le', '-v', 'quiet', 'pipe:1'
      ], { maxBuffer: 8000 * 2 * 600 + 1024, encoding: 'buffer' as any })

      const pcmBuffer = ffResult.stdout as unknown as Buffer
      const totalSamples = Math.floor(pcmBuffer.length / 2)
      if (totalSamples === 0) return []
      const samplesPerBar = Math.floor(totalSamples / BARS)
      if (samplesPerBar === 0) return []
      const peaks: number[] = []

      for (let bar = 0; bar < BARS; bar++) {
        let sum = 0, count = 0
        const startSample = bar * samplesPerBar
        for (let s = startSample; s < startSample + samplesPerBar && s < totalSamples; s++) {
          sum += Math.abs(pcmBuffer.readInt16LE(s * 2)) / 32768; count++
        }
        peaks.push(count > 0 ? sum / count : 0)
      }
      const max = Math.max(...peaks, 0.001)
      const result = peaks.map(p => p / max)

      if (result.length > 0) {
        waveformDiskCache[cacheKey] = result
        scheduleWaveformFlush()
      }
      return result
    } catch (err) {
      logger.error('Subsonic waveform generation error:', err)
      return []
    } finally {
      // Clean up temp file
      if (tmpFile) {
        try { await unlink(tmpFile) } catch {}
      }
    }
  })

  // ── IPC: Artist info (MusicBrainz + Wikipedia + TheAudioDB + Last.fm) ──
  ipcMain.handle('artist:get-info', async (_, artistName: string, forceRefresh = false) => {
    // Check disk cache first. Entries without an image expire much faster
    // so we can pick up images that become available later.
    const cached = artistInfoCache[artistName]
    const age = cached ? Date.now() - cached.ts : Infinity
    const ttlWithImage = 7 * 24 * 60 * 60 * 1000
    const ttlWithoutImage = 6 * 60 * 60 * 1000
    if (!forceRefresh && cached && age < (cached.data?.imageUrl ? ttlWithImage : ttlWithoutImage)) {
      return cached.data
    }

    // Social network domains to include (exclude streaming platforms)
    const STREAMING_DOMAINS = ['youtube.com', 'youtu.be', 'spotify.com', 'soundcloud.com',
      'bandcamp.com', 'deezer.com', 'tidal.com', 'music.apple.com', 'music.amazon.com',
      'napster.com', 'pandora.com', 'last.fm', 'lastfm.com', 'listenbrainz.org',
      'musicbrainz.org', 'discogs.com', 'allmusic.com', 'imdb.com', 'amazon.com']
    const SOCIAL_NAMES: Record<string, string> = {
      'twitter.com': 'Twitter', 'x.com': 'X', 'instagram.com': 'Instagram',
      'facebook.com': 'Facebook', 'tiktok.com': 'TikTok', 'threads.net': 'Threads',
      'bsky.app': 'Bluesky', 'vk.com': 'VK', 'weibo.com': 'Weibo',
      'tumblr.com': 'Tumblr', 'myspace.com': 'Myspace',
    }
    const classifySocialUrl = (url: string): { name: string; url: string } | null => {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '')
        if (STREAMING_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return null
        const name = SOCIAL_NAMES[host] || (host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1))
        return { name, url }
      } catch { return null }
    }

    try {
      const settings = await loadSettings()
      // Use quoted exact match to avoid e.g. "bôa" returning "BoA"
      const exactQuery = encodeURIComponent(`"${artistName}"`)
      const mbUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${exactQuery}&fmt=json&limit=5`
      const mbRaw = await fetchJSON(mbUrl)
      const mbData = JSON.parse(mbRaw)

      if (!mbData.artists || mbData.artists.length === 0) return null

      // Pick the best match: prefer exact name match (case-insensitive, accent-sensitive)
      const normalize = (s: string) => s.toLowerCase().trim()
      const target = normalize(artistName)
      const artist = mbData.artists.find((a: any) => normalize(a.name) === target)
        || mbData.artists.find((a: any) => normalize(a['sort-name'] || '') === target)
        || mbData.artists[0]
      const info: any = {
        name: artist.name || artistName,
        disambiguation: artist.disambiguation || '',
        type: artist.type || '',
        country: artist.country || artist.area?.name || '',
        beginDate: artist['life-span']?.begin || '',
        endDate: artist['life-span']?.end || '',
        // Only keep tags more than one MusicBrainz user agreed on, most-voted first
        tags: (artist.tags || [])
          .filter((t: any) => (t.count || 0) >= 2)
          .sort((a: any, b: any) => (b.count || 0) - (a.count || 0))
          .slice(0, 5)
          .map((t: any) => t.name),
        fans: 0,
        bio: '',
        imageUrl: null,
        website: '',
        socials: [],
        members: [],
        similarArtists: [],
      }

      // Deezer: try first for a clean promo/press photo; save ID for related artists fallback
      let deezerArtistId: number | null = null
      try {
        const deezerUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=5`
        const deezerRaw = await fetchJSON(deezerUrl)
        const deezerData = JSON.parse(deezerRaw)
        const deezerArtist = deezerData.data?.find(
          (a: any) => normalize(a.name) === target
        ) || deezerData.data?.[0]
        if (deezerArtist?.picture_xl) {
          info.imageUrl = deezerArtist.picture_xl
        }
        if (deezerArtist?.id) {
          deezerArtistId = deezerArtist.id
        }
        if (deezerArtist?.nb_fan) {
          info.fans = deezerArtist.nb_fan
        }
      } catch { /* Deezer lookup failed */ }

      // Helper to fetch Wikipedia summary + thumbnail for a given page title/lang
      // Only sets imageUrl if Deezer didn't already provide one
      const fetchWikiSummary = async (pageTitle: string, lang = 'en') => {
        const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`
        const summaryRaw = await fetchJSON(summaryUrl)
        const summaryData = JSON.parse(summaryRaw)
        if (summaryData.extract) info.bio = summaryData.extract
        if (!info.imageUrl && summaryData.originalimage?.source) {
          info.imageUrl = summaryData.originalimage.source
        } else if (!info.imageUrl && summaryData.thumbnail?.source) {
          info.imageUrl = summaryData.thumbnail.source
        }
      }

      // Fetch MusicBrainz relations (URL relations for links + artist relations for members)
      if (artist.id) {
        try {
          // Rate limit: MusicBrainz requires max 1 req/sec
          await new Promise(r => setTimeout(r, 1200))
          const relUrl = `https://musicbrainz.org/ws/2/artist/${artist.id}?inc=url-rels+artist-rels&fmt=json`
          const relRaw = await fetchJSON(relUrl)
          const relData = JSON.parse(relRaw)
          const relations = relData.relations || []

          // Try Wikipedia link first
          const wikiRel = relations.find((r: any) => r.type === 'wikipedia')
          if (wikiRel?.url?.resource) {
            const wikiUrl = wikiRel.url.resource
            const match = wikiUrl.match(/\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/)
            if (match) {
              const lang = match[1]
              const pageTitle = decodeURIComponent(match[2])
              await fetchWikiSummary(pageTitle, lang)
            }
          }

          // If no bio yet, try Wikidata → find English Wikipedia page
          if (!info.bio) {
            const wikidataRel = relations.find((r: any) => r.type === 'wikidata')
            if (wikidataRel?.url?.resource) {
              const wdMatch = wikidataRel.url.resource.match(/wikidata\.org\/wiki\/(Q\d+)/)
              if (wdMatch) {
                try {
                  const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdMatch[1]}&props=sitelinks&format=json`
                  const wdRaw = await fetchJSON(wdUrl)
                  const wdData = JSON.parse(wdRaw)
                  const entity = wdData.entities?.[wdMatch[1]]
                  const enWikiTitle = entity?.sitelinks?.enwiki?.title
                  if (enWikiTitle) {
                    await fetchWikiSummary(enWikiTitle, 'en')
                  }
                } catch { /* wikidata fallback failed */ }
              }
            }
          }

          // Look for an image from MusicBrainz image relation
          if (!info.imageUrl) {
            const imgRel = relations.find((r: any) => r.type === 'image')
            if (imgRel?.url?.resource) {
              const commonsMatch = imgRel.url.resource.match(/commons\.wikimedia\.org\/wiki\/File:(.+)/)
              if (commonsMatch) {
                const filename = decodeURIComponent(commonsMatch[1])
                info.imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=400`
              }
            }
          }

          // Extract official homepage
          const homepageRel = relations.find((r: any) => r.type === 'official homepage')
          if (homepageRel?.url?.resource) {
            info.website = homepageRel.url.resource
          }

          // Spotify artist ID (used to look up stream counts on kworb.net)
          info.spotifyId = spotifyIdFromRelations(relations)

          // Extract social network links (excluding streaming platforms)
          const socialRels = relations.filter((r: any) => r.type === 'social network' && r.url?.resource)
          for (const rel of socialRels) {
            const social = classifySocialUrl(rel.url.resource)
            if (social) info.socials.push(social)
          }

          // Extract band members (artist-rels where this artist is the band)
          const memberRels = relations.filter((r: any) =>
            r.type === 'member of band' && r.direction === 'backward' && r.artist?.name
          )
          if (memberRels.length > 0) {
            info.members = memberRels.map((r: any) => r.artist.name)
          }
        } catch (wikiErr) {
          logger.error('Wikipedia fetch error:', wikiErr)
        }
      }

      // Final fallback: try direct Wikipedia search if still no bio
      if (!info.bio) {
        try {
          const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`
          const searchRaw = await fetchJSON(searchUrl)
          const searchData = JSON.parse(searchRaw)
          if (searchData.extract && searchData.type !== 'disambiguation') {
            info.bio = searchData.extract
            if (!info.imageUrl && searchData.thumbnail?.source) {
              info.imageUrl = searchData.thumbnail.source
            }
          }
        } catch { /* direct search failed */ }
      }

      // TheAudioDB fallback for missing image (free, no key required)
      if (!info.imageUrl) {
        try {
          const tadbUrl = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(artistName)}`
          const tadbRaw = await fetchJSON(tadbUrl)
          const tadbData = JSON.parse(tadbRaw)
          const tadbArtist = tadbData.artists?.[0]
          if (tadbArtist?.strArtistThumb) {
            info.imageUrl = tadbArtist.strArtistThumb
          }
        } catch { /* TheAudioDB fallback failed */ }
      }

      // Last.fm: similar artists (+ bio fallback) when API key is configured
      if (settings.lastfmApiKey) {
        try {
          const lfmUrl = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${settings.lastfmApiKey}&format=json`
          const lfmRaw = await fetchJSON(lfmUrl)
          const lfmData = JSON.parse(lfmRaw)
          if (lfmData.artist) {
            const similar = lfmData.artist.similar?.artist || []
            if (similar.length > 0) {
              info.similarArtists = similar.slice(0, 20).map((a: any) => a.name)
            }
            // Use Last.fm bio as fallback if no bio yet (strip HTML tags)
            if (!info.bio && lfmData.artist.bio?.summary) {
              info.bio = lfmData.artist.bio.summary
                .replace(/<a\b[^>]*>.*?<\/a>/gi, '')
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim()
            }
          }
        } catch { /* Last.fm fallback failed */ }
      }

      // Deezer related artists: fallback if Last.fm didn't provide any
      if (info.similarArtists.length === 0 && deezerArtistId) {
        try {
          const relatedUrl = `https://api.deezer.com/artist/${deezerArtistId}/related?limit=20`
          const relatedRaw = await fetchJSON(relatedUrl)
          const relatedData = JSON.parse(relatedRaw)
          if (relatedData.data?.length) {
            info.similarArtists = relatedData.data.map((a: any) => a.name)
          }
        } catch { /* Deezer related artists failed */ }
      }

      // Cache and return
      artistInfoCache[artistName] = { data: info, ts: Date.now() }
      saveArtistCache()
      return info
    } catch (err) {
      logger.error('Artist info fetch error:', err)
      return null
    }
  })

  // ── IPC: Album tracklist (full official tracklist, to show missing songs) ──
  // `localTitles` picks the right edition: the catalog album whose tracklist
  // contains the most of the songs the user has wins.
  ipcMain.handle('album:get-tracklist', async (_, album: string, artist: string, localTitles: string[] = []) => {
    const cache = await getTracklistCache()
    const key = `${normTitle(album)}|${normTitle(artist)}`
    const hit = cache[key]
    if (hit && Date.now() - hit.ts < (hit.data ? TRACKLIST_TTL : TRACKLIST_MISS_TTL)) return hit.data

    try {
      const search = JSON.parse(await fetchJSON(`https://itunes.apple.com/search?${new URLSearchParams({
        term: `${album} ${artist}`, entity: 'album', limit: '25', country: 'US',
      })}`)).results || []
      const wantArtist = normTitle(artist.split(/,| & /)[0])
      const wantAlbum = normTitle(album)
      const candidates = search
        .filter((a: any) => normTitle(a.artistName || '').includes(wantArtist))
        // Same name first, then closest track count to what's on disk
        .sort((a: any, b: any) => Number(normTitle(b.collectionName) === wantAlbum) - Number(normTitle(a.collectionName) === wantAlbum))
        .slice(0, 5)

      const local = new Set(localTitles.map(normTitle))
      let best: { data: AlbumTracklist; score: number; matched: number } | null = null
      for (const c of candidates) {
        const songs = JSON.parse(await fetchJSON(`https://itunes.apple.com/lookup?id=${c.collectionId}&entity=song&country=US`)).results || []
        const tracks: CatalogTrack[] = songs
          .filter((s: any) => s.wrapperType === 'track')
          .map((s: any) => ({ title: s.trackName, disc: s.discNumber || 1, track: s.trackNumber || 0, duration: (s.trackTimeMillis || 0) / 1000 }))
          .sort((a: CatalogTrack, b: CatalogTrack) => a.disc - b.disc || a.track - b.track)
        const matched = tracks.filter(t => local.has(normTitle(t.title))).length
        const sameName = normTitle(c.collectionName) === wantAlbum
        // Songs on disk count most; then the edition with the same name (one title spelt
        // differently mustn't hand "Scarlet" to "Scarlet 2 CLAUDE"); then fewer extra tracks
        const score = matched * 10 + (sameName ? 25 : 0) - (tracks.length - matched)
        if (!best || score > best.score) best = { data: { name: c.collectionName, tracks }, score, matched }
        if (matched === local.size && sameName) break
      }

      // Only trust it if it really is this album: most of the local songs must be on it
      const needed = Math.max(1, Math.ceil(local.size / 2))
      const data = best && best.matched >= needed ? best.data : null
      cache[key] = { data, ts: Date.now() }
      writeFile(tracklistCachePath, JSON.stringify(cache)).catch(() => {})
      return data
    } catch (err) {
      logger.error('Album tracklist fetch error:', err)
      return hit?.data ?? null
    }
  })

  // ── IPC: Artist releases (Deezer discography, newest first) ──
  // Kept separate from artist:get-info so new releases show up within hours
  // rather than waiting out the 7-day artist info cache.
  ipcMain.handle('artist:get-releases', async (_, artistName: string, forceRefresh = false) => {
    const cached = artistReleasesCache.get(artistName)
    if (!forceRefresh && cached && Date.now() - cached.ts < ARTIST_RELEASES_TTL) return cached.data

    try {
      const normalize = (s: string) => s.toLowerCase().trim()
      const searchRaw = await fetchJSON(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=5`)
      const match = JSON.parse(searchRaw).data?.find((a: any) => normalize(a.name) === normalize(artistName))
      if (!match?.id) return []

      const albumsRaw = await fetchJSON(`https://api.deezer.com/artist/${match.id}/albums?limit=100`)
      const releases = (JSON.parse(albumsRaw).data || [])
        .map((a: any) => ({
          title: a.title as string,
          type: (a.record_type || 'album') as string,
          releaseDate: (a.release_date || '') as string,
          coverUrl: (a.cover_xl || a.cover_big || null) as string | null,
          url: (a.link || '') as string,
          explicit: !!a.explicit_lyrics,
        }))
        .sort((a: any, b: any) => b.releaseDate.localeCompare(a.releaseDate))

      artistReleasesCache.set(artistName, { data: releases, ts: Date.now() })
      return releases
    } catch (err) {
      logger.error('Artist releases fetch error:', err)
      return cached?.data ?? []
    }
  })

  // ── IPC: Artist Spotify stream counts (kworb.net) ──
  ipcMain.handle('artist:get-streams', async (_, artistName: string, forceRefresh = false) => {
    const cached = artistStreamsCache[artistName]
    if (!forceRefresh && cached && Date.now() - cached.ts < ARTIST_STREAMS_TTL) return cached.data

    try {
      let spotifyId: string = artistInfoCache[artistName]?.data?.spotifyId || ''
      if (!spotifyId) {
        // Artist info cached before spotifyId existed: look it up directly
        const normalize = (s: string) => s.toLowerCase().trim()
        const search = JSON.parse(await fetchJSON(
          `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(`"${artistName}"`)}&fmt=json&limit=5`
        ))
        const mbArtist = search.artists?.find((a: any) => normalize(a.name) === normalize(artistName))
        if (mbArtist?.id) {
          await new Promise(r => setTimeout(r, 1200)) // MusicBrainz rate limit
          const rels = JSON.parse(await fetchJSON(`https://musicbrainz.org/ws/2/artist/${mbArtist.id}?inc=url-rels&fmt=json`))
          spotifyId = spotifyIdFromRelations(rels.relations || [])
        }
      }

      // No Spotify ID or no kworb page are "known unknowns": cache them too so we don't keep asking
      const data = spotifyId
        ? parseKworbSongs(await fetchJSON(`https://kworb.net/spotify/artist/${spotifyId}_songs.html`), spotifyId)
        : null
      artistStreamsCache[artistName] = { data, ts: Date.now() }
      saveStreamsCache()
      return data
    } catch (err) {
      logger.error('Artist streams fetch error:', err)
      return cached?.data ?? null
    }
  })

  // ── IPC: Show in file explorer ──
  ipcMain.handle('shell:show-in-explorer', async (_, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:open-path', async (_, dirPath: string) => {
    await shell.openPath(dirPath)
  })

  // ── IPC: Subsonic / Navidrome ──
  ipcMain.handle('subsonic:test', async (_, cfg: { url: string; username: string; password: string; useLegacyAuth: boolean }) => {
    setSubsonicConfig(cfg)
    return await subsonicPing()
  })

  ipcMain.handle('subsonic:fetch-library', async () => {
    return await subsonicGetAllSongs()
  })

  ipcMain.handle('subsonic:stream-url', async (_, songId: string) => {
    return getStreamUrl(songId)
  })

  ipcMain.handle('subsonic:cover-url', async (_, coverArtId: string) => {
    return getCoverArtUrl(coverArtId)
  })

  // ── IPC: Save lyrics ──
  ipcMain.handle('lyrics:save', async (_, trackPath: string, lrcContent: string) => {
    if (trackPath.startsWith('subsonic://')) return // Can't save to remote paths
    await saveLyricsFile(trackPath, lrcContent)
  })

  ipcMain.handle('lyrics:search', async (_, query: string, tracks: { id: string; path: string }[]) => {
    if (!query || !tracks.length) return []
    const q = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const matchingIds: string[] = []
    for (const track of tracks) {
      if (track.path.startsWith('subsonic://')) continue
      try {
        const lyrics = await findLocalLyrics(track.path)
        if (lyrics) {
          const normalized = lyrics.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          // Strip LRC timestamps so we only search the lyric text itself
          const clean = normalized.replace(/\[\d+:\d+[\.\:]\d+\]/g, ' ')
          if (clean.includes(q)) matchingIds.push(track.id)
        }
      } catch {}
    }
    return matchingIds
  })

  // ── IPC: Export / Import ──
  ipcMain.handle('export:run', async (_, customPath?: string) => {
    const settings = await loadSettings()
    const exportDir = customPath || settings.exportPath || defaultExportPath
    const filePath = await performExport(exportDir, false)
    return filePath
  })

  ipcMain.handle('export:import', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Aurora Backup',
      filters: [{ name: 'Aurora Backup', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return await performImport(result.filePaths[0])
  })

  ipcMain.handle('export:import-file', async (_, filePath: string) => {
    try {
      return await performImport(filePath)
    } catch {
      return null
    }
  })

  ipcMain.handle('export:choose-dir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Export Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('export:get-default-path', async () => {
    return defaultExportPath
  })

  // ── IPC: Reset caches ──
  ipcMain.handle('cache:reset', async (_, targets: string[]) => {
    const results: Record<string, boolean> = {}

    if (targets.includes('library')) {
      try {
        cache.tracks = []
        cache.trackMap.clear()
        cache.folders = []
        if (existsSync(storePath)) await rm(storePath)
        results.library = true
      } catch { results.library = false }
    }

    if (targets.includes('covers')) {
      try {
        if (existsSync(coverCachePath)) {
          await rm(coverCachePath, { recursive: true })
          await mkdir(coverCachePath, { recursive: true })
        }
        results.covers = true
      } catch { results.covers = false }
    }

    if (targets.includes('artist')) {
      try {
        artistInfoCache = {}
        if (existsSync(artistCachePath)) await rm(artistCachePath)
        results.artist = true
      } catch { results.artist = false }
    }

    if (targets.includes('waveform')) {
      try {
        waveformDiskCache = {}
        if (existsSync(waveformCachePath)) await rm(waveformCachePath)
        results.waveform = true
      } catch { results.waveform = false }
    }

    if (targets.includes('beatgrid')) {
      try {
        beatgridCache = {}
        if (existsSync(beatgridCachePath)) await rm(beatgridCachePath)
        results.beatgrid = true
      } catch { results.beatgrid = false }
    }

    return results
  })

  // ── IPC: Folder tree ──
  ipcMain.handle('folder:get-tree', async (_, folderPath: string) => {
    async function buildTree(dir: string, depth = 0): Promise<any[]> {
      if (depth > 10) return [] // prevent infinite recursion
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        const result: any[] = []
        for (const entry of entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })) {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            const children = await buildTree(fullPath, depth + 1)
            const trackCount = children.reduce(
              (sum, c) => sum + (c.isDirectory ? (c.trackCount || 0) : (AUDIO_EXTENSIONS.has(extname(c.name).toLowerCase()) ? 1 : 0)),
              0
            )
            result.push({
              name: entry.name, path: fullPath, isDirectory: true,
              children, trackCount,
            })
          } else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            result.push({ name: entry.name, path: fullPath, isDirectory: false })
          }
        }
        return result
      } catch {
        return []
      }
    }
    return buildTree(folderPath)
  })

  // ── IPC: Scrobbling (Last.fm + ListenBrainz) ──
  ipcMain.handle('scrobble:track', async (_, data: { title: string; artist: string; album: string; duration: number; timestamp: number }) => {
    const settings = await loadSettings()

    // Last.fm scrobble
    if (settings.lastfmSessionKey && settings.lastfmApiKey) {
      try {
        await lastfmScrobble(settings.lastfmApiKey, settings.lastfmApiSecret, settings.lastfmSessionKey, data)
      } catch (err) {
        logger.error('Last.fm scrobble error:', err)
      }
    }

    // ListenBrainz scrobble
    if (settings.listenbrainzToken) {
      try {
        await listenbrainzSubmit(settings.listenbrainzToken, 'single', data)
      } catch (err) {
        logger.error('ListenBrainz scrobble error:', err)
      }
    }

    return true
  })

  ipcMain.handle('scrobble:now-playing', async (_, data: { title: string; artist: string; album: string; duration: number }) => {
    const settings = await loadSettings()

    if (settings.lastfmSessionKey && settings.lastfmApiKey) {
      try {
        await lastfmUpdateNowPlaying(settings.lastfmApiKey, settings.lastfmApiSecret, settings.lastfmSessionKey, data)
      } catch (err) {
        logger.error('Last.fm now-playing error:', err)
      }
    }

    if (settings.listenbrainzToken) {
      try {
        await listenbrainzSubmit(settings.listenbrainzToken, 'playing_now', data)
      } catch (err) {
        logger.error('ListenBrainz now-playing error:', err)
      }
    }

    return true
  })

  // ── IPC: Smart playlists ──
  ipcMain.handle('playlists:create-smart', async (_, name: string, rules: any[], ruleMatch: string) => {
    const now = Date.now()
    const playlist: Playlist = {
      id: generateId(`smart-${name}-${now}`),
      name,
      trackIds: [],
      createdAt: now,
      updatedAt: now,
      smart: true,
      rules,
      ruleMatch: ruleMatch as 'all' | 'any',
    }
    playlists.push(playlist)
    await savePlaylists()
    return playlist
  })

  ipcMain.handle('playlists:update-smart', async (_, id: string, rules: any[], ruleMatch: string) => {
    const pl = playlists.find(p => p.id === id)
    if (pl && pl.smart) {
      pl.rules = rules
      pl.ruleMatch = ruleMatch as 'all' | 'any'
      pl.updatedAt = Date.now()
      await savePlaylists()
    }
    return pl || null
  })

  // ── IPC: Stats ──
  const statsDir = join(dataPath, 'stats')
  const deviceIdPath = join(statsDir, 'device-id.txt')

  async function getOrCreateDeviceId(): Promise<string> {
    await mkdir(statsDir, { recursive: true })
    if (existsSync(deviceIdPath)) {
      return (await readFile(deviceIdPath, 'utf-8')).trim()
    }
    const id = createHash('md5').update(dataPath + Date.now()).digest('hex').slice(0, 12)
    await writeFile(deviceIdPath, id, 'utf-8')
    return id
  }

  ipcMain.handle('stats:load', async () => {
    const deviceId = await getOrCreateDeviceId()
    const events: any[] = []
    try {
      const files = await readdir(statsDir)
      for (const file of files) {
        if (!file.startsWith('plays-') || !file.endsWith('.jsonl')) continue
        const raw = await readFile(join(statsDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try { events.push(JSON.parse(trimmed)) } catch { /* skip corrupted lines */ }
        }
      }
    } catch { /* stats dir may not exist yet */ }
    events.sort((a, b) => a.ts - b.ts)
    return { deviceId, events }
  })

  ipcMain.handle('stats:append', async (_, event: any) => {
    const deviceId = await getOrCreateDeviceId()
    const statsFile = join(statsDir, `plays-${deviceId}.jsonl`)
    await appendFile(statsFile, JSON.stringify(event) + '\n', 'utf-8')
    return true
  })

  // ── IPC: Sync ──────────────────────────────────────────────────────────────
  let syncWatcher: ReturnType<typeof fsWatch> | null = null

  ipcMain.handle('sync:get-config', async () => {
    const s = await loadSettings()
    return {
      enabled: s.syncEnabled ?? false,
      folder: s.syncFolder ?? '',
      syncPlaylists: s.syncPlaylists ?? true,
      syncFavorites: s.syncFavorites ?? true,
      syncStats: s.syncStats ?? true,
      syncTags: s.syncTags ?? true,
    }
  })

  ipcMain.handle('sync:set-config', async (_, config: any) => {
    await mergeSettingsFile({
      syncEnabled: config.enabled,
      syncFolder: config.folder,
      syncPlaylists: config.syncPlaylists,
      syncFavorites: config.syncFavorites,
      syncStats: config.syncStats,
      syncTags: config.syncTags,
    })
  })

  // Atomic write: write to .tmp then rename. Falls back to direct write on network FS
  // (e.g. Tailscale Drive / WebDAV) that doesn't support rename-over-existing.
  async function atomicWrite(targetPath: string, content: string) {
    const tmpPath = targetPath + '.tmp'
    await writeFile(tmpPath, content, 'utf-8')
    try {
      await rename(tmpPath, targetPath)
    } catch {
      // Network FS fallback: rename failed, write directly then clean up tmp
      await writeFile(targetPath, content, 'utf-8')
      await unlink(tmpPath).catch(() => {})
    }
  }

  ipcMain.handle('sync:push', async (_, data: any) => {
    try {
      const s = await loadSettings()
      const folder = s.syncFolder
      if (!folder || !existsSync(folder)) return { ok: false, error: 'Sync folder not found' }
      await atomicWrite(join(folder, 'aurora-sync.json'), JSON.stringify(data, null, 2))
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('sync:pull', async () => {
    try {
      const s = await loadSettings()
      const folder = s.syncFolder
      if (!folder || !existsSync(folder)) return { data: null, error: 'Sync folder not found' }
      const syncPath = join(folder, 'aurora-sync.json')
      if (!existsSync(syncPath)) return { data: null, error: null }
      const raw = await readFile(syncPath, 'utf-8')
      return { data: JSON.parse(raw), error: null }
    } catch (e: any) {
      return { data: null, error: e.message }
    }
  })

  ipcMain.handle('sync:pick-folder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Sync Folder',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('sync:watch', async (_, folder: string) => {
    if (syncWatcher) { syncWatcher.close(); syncWatcher = null }
    if (!folder || !existsSync(folder)) return
    try {
      syncWatcher = fsWatch(folder, (_, filename) => {
        if (filename === 'aurora-sync.json' && !filename.endsWith('.tmp')) {
          mainWindow?.webContents.send('sync:file-changed')
        }
      })
    } catch { /* folder may not be watchable */ }
  })

  ipcMain.handle('sync:unwatch', async () => {
    if (syncWatcher) { syncWatcher.close(); syncWatcher = null }
  })

  ipcMain.handle('sync:apply-playlists', async (_, newPlaylists: any[]) => {
    playlists = newPlaylists
    await savePlaylists()
  })

  ipcMain.handle('sync:get-state', async () => {
    const deviceId = await getOrCreateDeviceId()
    const s = await loadSettings()
    const cutoff = Date.now() - 30 * 86400000
    const deletedPlaylistIds = (s.syncDeletedIds ?? []).filter((d: any) => d.deletedAt > cutoff)
    return { deviceId, favoritesUpdatedAt, deletedPlaylistIds }
  })

  ipcMain.handle('sync:get-stats-events', async () => {
    const deviceId = await getOrCreateDeviceId()
    const statsFile = join(statsDir, `plays-${deviceId}.jsonl`)
    if (!existsSync(statsFile)) return []
    const raw = await readFile(statsFile, 'utf-8')
    return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  })

  ipcMain.handle('sync:push-stats', async (_, deviceId: string, events: any[]) => {
    try {
      const s = await loadSettings()
      const folder = s.syncFolder
      if (!folder || !existsSync(folder)) return { ok: false, error: 'Sync folder not found' }
      await atomicWrite(join(folder, `aurora-stats-${deviceId}.json`), JSON.stringify(events))
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('sync:pull-stats', async (_, ownDeviceId: string) => {
    try {
      const s = await loadSettings()
      const folder = s.syncFolder
      if (!folder || !existsSync(folder)) return []
      const files = await readdir(folder)
      const result: { remoteDeviceId: string; events: any[] }[] = []
      for (const file of files) {
        if (!file.startsWith('aurora-stats-') || !file.endsWith('.json') || file.endsWith('.tmp')) continue
        const remoteDeviceId = file.slice('aurora-stats-'.length, -'.json'.length)
        if (remoteDeviceId === ownDeviceId) continue
        try {
          const raw = await readFile(join(folder, file), 'utf-8')
          result.push({ remoteDeviceId, events: JSON.parse(raw) })
        } catch { /* skip corrupted */ }
      }
      return result
    } catch {
      return []
    }
  })

  ipcMain.handle('sync:apply-remote-stats', async (_, remoteDeviceId: string, events: any[]) => {
    await mkdir(statsDir, { recursive: true })
    const statsFile = join(statsDir, `plays-${remoteDeviceId}.jsonl`)
    await writeFile(statsFile, events.map((e: any) => JSON.stringify(e)).join('\n') + '\n', 'utf-8')
  })

  // ── IPC: Themes ──
  const themesDir = join(dataPath, 'themes')

  ipcMain.handle('themes:get-all', async () => {
    try {
      await mkdir(themesDir, { recursive: true })
      const files = await readdir(themesDir)
      const themes: any[] = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = await readFile(join(themesDir, f), 'utf-8')
          themes.push(JSON.parse(raw))
        } catch {}
      }
      return themes
    } catch {
      return []
    }
  })

  ipcMain.handle('themes:install', async (_, theme: any) => {
    await mkdir(themesDir, { recursive: true })
    const filePath = join(themesDir, `${theme.id}.json`)
    await writeFile(filePath, JSON.stringify(theme, null, 2))
  })

  ipcMain.handle('themes:remove', async (_, themeId: string) => {
    const filePath = join(themesDir, `${themeId}.json`)
    try { await rm(filePath) } catch {}
  })

  ipcMain.handle('themes:open-folder', async () => {
    await mkdir(themesDir, { recursive: true })
    shell.openPath(themesDir)
  })

  // Watch themes directory for changes and notify the renderer
  ;(async () => {
    await mkdir(themesDir, { recursive: true })
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    fsWatch(themesDir, (_eventType, filename) => {
      if (filename && !filename.endsWith('.json')) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        mainWindow?.webContents.send('themes:directory-changed')
      }, 300)
    })
  })()

  // ── IPC: Plugins ──
  const pluginsDir = join(dataPath, 'plugins')
  const pluginSettingsDir = join(dataPath, 'plugin-settings')

  // Map from manifest id → relative path from pluginsDir to the actual plugin root (for file reads)
  const pluginFolderMap = new Map<string, string>()
  // Map from manifest id → top-level entry name in pluginsDir (for removal)
  const pluginTopLevelMap = new Map<string, string>()

  /** Recursively find the directory containing manifest.json within searchDir.
   *  Returns the absolute path to that directory, or null if not found. */
  async function findPluginRoot(searchDir: string, depth = 0): Promise<string | null> {
    if (depth > 5) return null // guard against deeply nested or circular structures
    if (existsSync(join(searchDir, 'manifest.json'))) return searchDir
    try {
      const subEntries = await readdir(searchDir, { withFileTypes: true })
      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue
        const found = await findPluginRoot(join(searchDir, sub.name), depth + 1)
        if (found) return found
      }
    } catch {}
    return null
  }

  ipcMain.handle('plugins:get-all', async () => {
    try {
      await mkdir(pluginsDir, { recursive: true })
      const entries = await readdir(pluginsDir, { withFileTypes: true })
      const manifests: any[] = []
      pluginFolderMap.clear()
      pluginTopLevelMap.clear()
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const rootAbs = await findPluginRoot(join(pluginsDir, entry.name))
          if (!rootAbs) continue
          const raw = await readFile(join(rootAbs, 'manifest.json'), 'utf-8')
          const manifest = JSON.parse(raw)
          // Relative path from pluginsDir → used by read-file
          const relRoot = rootAbs.slice(pluginsDir.length + 1) // e.g. "my-plugin" or "my-plugin/inner"
          pluginFolderMap.set(manifest.id, relRoot)
          // Top-level folder → used by remove
          pluginTopLevelMap.set(manifest.id, entry.name)
          manifest._folderName = relRoot
          manifests.push(manifest)
        } catch {}
      }
      return manifests
    } catch {
      return []
    }
  })

  ipcMain.handle('plugins:read-file', async (_, pluginId: string, fileName: string) => {
    // Prevent directory traversal
    const safeName = basename(fileName)
    // Resolve actual folder name from the map (falls back to pluginId)
    const folderName = pluginFolderMap.get(pluginId) || pluginId
    const filePath = join(pluginsDir, folderName, safeName)
    return await readFile(filePath, 'utf-8')
  })

  ipcMain.handle('plugins:install', async (_, sourcePath: string) => {
    // Copy a plugin folder to the plugins directory
    const folderName = basename(sourcePath)
    const destDir = join(pluginsDir, folderName)
    await mkdir(destDir, { recursive: true })
    const files = await readdir(sourcePath)
    for (const f of files) {
      const srcFile = join(sourcePath, f)
      const destFile = join(destDir, f)
      const s = await stat(srcFile)
      if (s.isFile()) {
        await copyFile(srcFile, destFile)
      }
    }
  })

  ipcMain.handle('plugins:remove', async (_, pluginId: string) => {
    // Use the top-level folder so we remove the whole entry (even if manifest was nested)
    const topLevel = pluginTopLevelMap.get(pluginId) || pluginFolderMap.get(pluginId) || pluginId
    const pluginDir = join(pluginsDir, topLevel)
    try { await rm(pluginDir, { recursive: true, force: true }) } catch {}
    pluginFolderMap.delete(pluginId)
    pluginTopLevelMap.delete(pluginId)
    // Also remove settings
    const settingsFile = join(pluginSettingsDir, `${pluginId}.json`)
    try { await rm(settingsFile) } catch {}
  })

  ipcMain.handle('plugins:get-settings', async (_, pluginId: string) => {
    await mkdir(pluginSettingsDir, { recursive: true })
    const settingsFile = join(pluginSettingsDir, `${pluginId}.json`)
    try {
      if (existsSync(settingsFile)) {
        return JSON.parse(await readFile(settingsFile, 'utf-8'))
      }
    } catch {}
    return {}
  })

  ipcMain.handle('plugins:save-settings', async (_, pluginId: string, data: any) => {
    await mkdir(pluginSettingsDir, { recursive: true })
    const settingsFile = join(pluginSettingsDir, `${pluginId}.json`)
    await writeFile(settingsFile, JSON.stringify(data, null, 2))
  })

  ipcMain.handle('plugins:open-folder', async () => {
    await mkdir(pluginsDir, { recursive: true })
    shell.openPath(pluginsDir)
  })

  // ── IPC: Audio fingerprint via fpcalc (chromaprint) ─────────────────────
  ipcMain.handle('track:fingerprint', async (_, trackPath: string) => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const { access } = await import('fs/promises')
    const execFileAsync = promisify(execFile)

    // Verify file exists before invoking fpcalc (gives a clearer error)
    try {
      await access(trackPath)
    } catch {
      throw new Error('File not found: ' + trackPath)
    }

    try {
      const { stdout, stderr } = await execFileAsync('fpcalc', ['-json', trackPath], { timeout: 30000 })
      if (!stdout.trim()) throw new Error(stderr || 'fpcalc produced no output')
      return JSON.parse(stdout) // { duration: number, fingerprint: string }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error('fpcalc not found — install chromaprint (e.g. sudo pacman -S chromaprint)')
      }
      throw new Error('fpcalc failed: ' + err.message)
    }
  })

  // ── IPC: Write track tags using ffmpeg ──────────────────────────────────
  ipcMain.handle('track:write-tags', async (_, trackPath: string, tags: {
    title?: string
    artist?: string
    albumArtist?: string
    album?: string
    year?: string
    trackNumber?: string
    genre?: string
    /** Base64-encoded JPEG image data for cover art */
    coverData?: string
  }) => {
    const { promisify } = await import('util')
    const { rename, unlink, writeFile } = await import('fs/promises')
    const path = await import('path')
    const { execFile } = await import('child_process')
    const execFileAsync = promisify(execFile)

    const ext = path.extname(trackPath).toLowerCase()
    const tmpPath = trackPath + '.aurora-meta-tmp' + ext
    const coverTmpPath = trackPath + '.aurora-cover-tmp.jpg'

    const args: string[] = ['-y', '-i', trackPath]

    if (tags.coverData) {
      await writeFile(coverTmpPath, Buffer.from(tags.coverData, 'base64'))
      args.push('-i', coverTmpPath)
      args.push('-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:0', 'attached_pic')
    } else {
      args.push('-map', '0', '-c', 'copy')
    }

    if (tags.title !== undefined)       args.push('-metadata', `title=${tags.title}`)
    if (tags.artist !== undefined)      args.push('-metadata', `artist=${tags.artist}`)
    if (tags.albumArtist !== undefined) args.push('-metadata', `album_artist=${tags.albumArtist}`)
    if (tags.album !== undefined)       args.push('-metadata', `album=${tags.album}`)
    if (tags.year !== undefined)        args.push('-metadata', `date=${tags.year}`)
    if (tags.trackNumber !== undefined) args.push('-metadata', `track=${tags.trackNumber}`)
    if (tags.genre !== undefined)       args.push('-metadata', `genre=${tags.genre}`)

    if (ext === '.mp3') args.push('-id3v2_version', '3')
    // M4A/MP4: force 'mov' muxer — the default 'ipod' profile rejects FLAC audio
    if (ext === '.m4a' || ext === '.mp4') args.push('-f', 'mov')

    args.push(tmpPath)

    try {
      await execFileAsync('ffmpeg', args)
      await rename(tmpPath, trackPath)
      return { ok: true }
    } catch (err: any) {
      await unlink(tmpPath).catch(() => {})
      throw new Error(`ffmpeg tag write failed: ${err.message}`)
    } finally {
      if (tags.coverData) await unlink(coverTmpPath).catch(() => {})
    }
  })

  // Passthrough IPC for plugins (full trust — plugins can invoke any IPC channel)
  ipcMain.handle('plugins:ipc-invoke', async (_, channel: string, ...args: any[]) => {
    // This is intentionally unrestricted — plugins run at the user's own risk
    return await ipcMain.emit(channel, ...args)
  })

  // ── Generic Plugin Utilities ────────────────────────────────────────────────
  ipcMain.handle('plugins:get-data-dir', async (_, pluginId: string) => {
    const dir = join(dataPath, 'plugin-data', pluginId)
    await mkdir(dir, { recursive: true })
    return dir
  })

  ipcMain.handle('plugins:write-file', async (_, filePath: string, content: string, options: any = {}) => {
    await writeFile(filePath, content, 'utf-8')
    if (options.executable) {
      const { chmod } = await import('fs/promises')
      await chmod(filePath, 0o755).catch(() => {})
    }
    return filePath
  })

  ipcMain.handle('plugins:execute', async (_, command: string, args: string[] = [], options: any = {}) => {
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    try {
      const { stdout, stderr } = await execFileAsync(command, args, options)
      return { stdout, stderr, error: null }
    } catch (err: any) {
      return { stdout: err?.stdout, stderr: err?.stderr, error: err?.message, code: err?.code }
    }
  })

  ipcMain.handle('plugins:spawn', async (event, id: string, command: string, args: string[] = [], options: any = {}) => {
    return new Promise<{ code: number | null; error?: string }>((resolve) => {
      try {
        const child = spawn(command, args, options)
        
        child.stdout.on('data', (chunk: Buffer) => {
          event.sender.send(`plugins:spawn-stdout:${id}`, chunk.toString())
        })
        
        child.stderr.on('data', (chunk: Buffer) => {
          event.sender.send(`plugins:spawn-stderr:${id}`, chunk.toString())
        })
        
        child.on('close', (code) => resolve({ code }))
        child.on('error', (err) => resolve({ code: null, error: err.message }))
      } catch (err: any) {
        resolve({ code: null, error: err.message })
      }
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (e) => {
  if (isQuitting || isRelaunching) return // already handled, let quit proceed
  if (!mainWindow || mainWindow.isDestroyed()) return
  e.preventDefault()
  mainWindow.webContents.send('app:before-quit')
  // Give renderer up to 6s to finish syncing, then force-quit regardless
  const timeout = setTimeout(() => {
    isQuitting = true
    app.quit()
  }, 6000)
  ipcMain.once('app:quit-ready', () => {
    clearTimeout(timeout)
    isQuitting = true
    app.quit()
  })
})

app.on('window-all-closed', async () => {
  logger.info('All windows closed, shutting down')
  await forceFlush()
  stopRemoteServer()
  destroyDiscordRPC()
  destroyMpris()
  destroyTray()
  if (!isRelaunching) app.quit()
})
