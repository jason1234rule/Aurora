import { defineStore } from 'pinia'
import { ref } from 'vue'
import { songKey } from '@/utils/smartPlaylistMatcher'
import { splitCredits, creditShares } from '@/utils/credits'
import { splitArtists } from '@/utils/splitArtists'
import { useLibraryStore } from './library'

export type StatsPeriod = '7d' | '30d' | '3mo' | '1y' | 'all'

export interface TrackStat {
  key: string
  title: string
  artist: string
  album: string
  count: number
  totalTime: number
}

export interface ArtistStat {
  artist: string
  count: number
  totalTime: number
}

export interface AlbumStat {
  album: string
  artist: string
  count: number
}

export const useStatsStore = defineStore('stats', () => {
  const plays = ref<PlayEvent[]>([])
  const loaded = ref(false)
  const deviceId = ref('')

  async function loadStats() {
    try {
      const result = await window.api.statsLoad()
      // Keys are re-derived so history recorded before feature credits stopped counting
      // ("Kiss Me More (feat. SZA)") matches the song's current key ("Kiss Me More")
      plays.value = result.events.map((e: PlayEvent) => (e.key.startsWith('mbid:') ? e : { ...e, key: songKey(e) }))
      deviceId.value = result.deviceId
    } catch { /* stats not critical */ }
    loaded.value = true
  }

  async function recordPlay(track: Track, playedFor: number) {
    const dur = track.duration || 0
    // Require at least 50% listened, or 30 s for very long tracks
    if (playedFor < Math.min(dur * 0.5, dur)) return
    const event: PlayEvent = {
      ts: Date.now(),
      key: songKey(track),
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      duration: dur,
      playedFor,
    }
    plays.value.push(event)
    try { await window.api.statsAppend(event) } catch { /* ignore */ }
  }

  function getPeriodCutoff(period: StatsPeriod): number {
    const now = Date.now()
    switch (period) {
      case '7d':  return now - 7   * 86400000
      case '30d': return now - 30  * 86400000
      case '3mo': return now - 90  * 86400000
      case '1y':  return now - 365 * 86400000
      case 'all': return 0
    }
  }

  function topTracks(period: StatsPeriod = 'all', limit = 20): TrackStat[] {
    const cutoff = getPeriodCutoff(period)
    const map = new Map<string, TrackStat>()
    for (const e of plays.value) {
      if (e.ts < cutoff) continue
      if (!map.has(e.key)) {
        map.set(e.key, { key: e.key, title: e.title, artist: e.artist, album: e.album, count: 0, totalTime: 0 })
      }
      const entry = map.get(e.key)!
      entry.count++
      entry.totalTime += e.playedFor
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit)
  }

  /**
   * Who is credited on a play, main vs featured. Prefers the current library track
   * (its tags know who is featured); falls back to parsing the play's own title and
   * artist, which still has "(feat. …)" for plays recorded before credits moved.
   */
  function creditsOf(e: PlayEvent): { main: string[]; featured: string[] } {
    const t = tracksByKey().get(e.key)
    if (t) {
      const featured = t.featuredArtists ?? []
      const main = splitArtists(t.artist).filter(a => !featured.some(f => f.toLowerCase() === a.toLowerCase()))
      return { main: main.length ? main : [t.artist], featured }
    }
    const { main, featured } = splitCredits(e.title, e.artist)
    return { main: main.length ? main : [e.artist], featured }
  }

  let keyIndex: { tracks: Track[]; map: Map<string, Track> } | null = null
  function tracksByKey(): Map<string, Track> {
    const tracks = useLibraryStore().tracks
    if (keyIndex?.tracks !== tracks) keyIndex = { tracks, map: new Map(tracks.map(t => [songKey(t), t])) }
    return keyIndex.map
  }

  /**
   * Plays per artist. Each play is shared between its credited artists: co-artists
   * equally, a main artist twice a featured one (artist + feature = 2/3 + 1/3).
   * Counts are rounded to whole plays for display; the order uses the exact shares.
   */
  function topArtists(period: StatsPeriod = 'all', limit = 20): ArtistStat[] {
    const cutoff = getPeriodCutoff(period)
    const map = new Map<string, ArtistStat>()
    for (const e of plays.value) {
      if (e.ts < cutoff) continue
      const { main, featured } = creditsOf(e)
      for (const [name, share] of creditShares(main, featured)) {
        const key = name.toLowerCase()
        if (!map.has(key)) map.set(key, { artist: name, count: 0, totalTime: 0 })
        const entry = map.get(key)!
        entry.count += share
        entry.totalTime += e.playedFor * share
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(a => ({ ...a, count: Math.round(a.count) }))
  }

  function topAlbums(period: StatsPeriod = 'all', limit = 20): AlbumStat[] {
    const cutoff = getPeriodCutoff(period)
    const map = new Map<string, AlbumStat>()
    for (const e of plays.value) {
      if (e.ts < cutoff) continue
      // Group by the album's main artist, so features don't split an album
      const artist = creditsOf(e).main[0]
      const key = `${e.album.toLowerCase()}||${artist.toLowerCase()}`
      if (!map.has(key)) map.set(key, { album: e.album, artist, count: 0 })
      map.get(key)!.count++
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit)
  }

  function playCount(key: string, period: StatsPeriod = 'all'): number {
    const cutoff = getPeriodCutoff(period)
    return plays.value.filter(e => e.key === key && e.ts >= cutoff).length
  }

  function totalListeningTime(period: StatsPeriod = 'all'): number {
    const cutoff = getPeriodCutoff(period)
    return plays.value.filter(e => e.ts >= cutoff).reduce((sum, e) => sum + e.playedFor, 0)
  }

  function dailyActivity(period: StatsPeriod = 'all'): { date: string; count: number }[] {
    const cutoff = getPeriodCutoff(period)
    const map = new Map<string, number>()
    for (const e of plays.value) {
      if (e.ts < cutoff) continue
      const date = new Date(e.ts).toISOString().slice(0, 10)
      map.set(date, (map.get(date) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  function listeningStreak(): number {
    const activitySet = new Set(dailyActivity('all').map(a => a.date))
    if (activitySet.size === 0) return 0
    let streak = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      if (activitySet.has(d.toISOString().slice(0, 10))) {
        streak++
      } else if (i > 0) {
        break
      }
    }
    return streak
  }

  return {
    plays,
    loaded,
    deviceId,
    loadStats,
    recordPlay,
    topTracks,
    topArtists,
    topAlbums,
    playCount,
    totalListeningTime,
    dailyActivity,
    listeningStreak,
  }
})
