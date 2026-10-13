/**
 * Console helpers for testing transitions by ear without the editor.
 * Installed in dev builds, or in any build after `localStorage.setItem('aurora-dev', '1')` + reload.
 *
 *   __aurora.addTransition({ exitAt: 182.5, entryAt: 12.3, overlap: 16 })   // current → next in queue
 *   __aurora.jumpToTransition(10)                                           // seek to 10 s before exitAt
 *   __aurora.transitionState()                                              // engine phase + alignment stats
 */
import type { Transition } from '@/types/transition'
import { usePlayerStore } from '@/stores/player'
import { useTransitionsStore } from '@/stores/transitions'
import { useLibraryStore } from '@/stores/library'

type AddOptions = Partial<Pick<Transition,
  'type' | 'exitAt' | 'entryAt' | 'overlap' | 'fadeOut' | 'fadeIn' | 'fadeOutPoints' | 'fadeInPoints'
  | 'bassSwap' | 'filter' | 'echo' | 'rateTo'>> & {
  /** 'next' (default) = the track after the current one in the queue; otherwise a track id or "Artist - Title" */
  to?: string
}

async function decodedDuration(path: string): Promise<number> {
  const ctx = new OfflineAudioContext(1, 1, 44100)
  const res = await fetch(window.api.getMediaUrl(path))
  const buf = await ctx.decodeAudioData(await res.arrayBuffer())
  return buf.duration
}

export function installTransitionDevHook() {
  const player = usePlayerStore()
  const transitions = useTransitionsStore()
  const library = useLibraryStore()

  function findTrack(query: string): Track | undefined {
    const q = query.toLowerCase()
    return library.tracks.find(t => t.id === query)
      ?? library.tracks.find(t => `${t.artist} - ${t.title}`.toLowerCase() === q)
      ?? library.tracks.find(t => t.title.toLowerCase() === q)
  }

  function currentPair(): { from: Track; to: Track } | null {
    const from = player.currentTrack
    const to = player.upcomingTrack()
    return from && to ? { from, to } : null
  }

  const api = {
    async addTransition(opts: AddOptions = {}) {
      const from = player.currentTrack
      if (!from) throw new Error('Nothing is playing')
      const to = !opts.to || opts.to === 'next' ? player.upcomingTrack() : findTrack(opts.to)
      if (!to) throw new Error(`No target track (${opts.to ?? 'next'})`)
      const [fromDur, toDur] = await Promise.all([decodedDuration(from.path), decodedDuration(to.path)])
      const { to: _to, ...fields } = opts
      const existing = transitions.find(from, to)
      const t = transitions.create(from, to, { from: fromDur, to: toDur }, {
        exitAt: Math.max(0, fromDur - 20),
        ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
        ...fields,
      })
      const saved = await transitions.save(t)
      console.log(`[Transitions] Saved "${from.title}" → "${to.title}"`, saved)
      return saved
    },
    listTransitions: () => transitions.list,
    removeTransition: (id: string) => transitions.remove(id),
    /** The saved transition from the current track into the next one, if any */
    currentTransition: () => {
      const pair = currentPair()
      return pair ? transitions.find(pair.from, pair.to) : null
    },
    /** Seek the current track to `secondsBefore` its transition's exit point */
    jumpToTransition(secondsBefore = 10) {
      const t = api.currentTransition()
      if (!t) throw new Error('No transition from the current track into the next one')
      player.seek(Math.max(0, t.exitAt - secondsBefore))
      if (!player.isPlaying) player.play()
    },
    transitionState: () => player.transitionDebug(),
  }

  ;(window as any).__aurora = { ...((window as any).__aurora || {}), ...api }
  console.info('[Transitions] Dev hook installed: window.__aurora.addTransition({...})')
}
