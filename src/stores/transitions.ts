import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { songKey } from '@/utils/smartPlaylistMatcher'
import type { Transition } from '@/types/transition'
import { DEFAULT_RAMP_BACK_SECONDS } from '@/utils/transitions/schedule'

export function pairKey(fromKey: string, toKey: string): string {
  return `${fromKey}→${toKey}`
}

function newId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

export const useTransitionsStore = defineStore('transitions', () => {
  const byPair = ref<Record<string, Transition>>({})
  const loaded = ref(false)

  const list = computed<Transition[]>(() =>
    Object.values(byPair.value).sort((a, b) => b.updatedAt - a.updatedAt),
  )

  const needsReviewCount = computed(() => list.value.filter(t => t.needsReview).length)

  /** fromKey → its outgoing transitions */
  const outgoingIndex = computed(() => {
    const map = new Map<string, Transition[]>()
    for (const t of list.value) {
      const arr = map.get(t.from.key)
      if (arr) arr.push(t)
      else map.set(t.from.key, [t])
    }
    return map
  })

  async function load() {
    try {
      byPair.value = (await window.api.getTransitions()) || {}
    } catch (err) {
      console.error('Failed to load transitions:', err)
      byPair.value = {}
    }
    loaded.value = true
  }

  function find(from: Track, to: Track): Transition | null {
    return byPair.value[pairKey(songKey(from), songKey(to))] ?? null
  }

  function getById(id: string): Transition | null {
    return list.value.find(t => t.id === id) ?? null
  }

  function outgoing(from: Track): Transition[] {
    return outgoingIndex.value.get(songKey(from)) ?? []
  }

  function incoming(to: Track): Transition[] {
    const key = songKey(to)
    return list.value.filter(t => t.to.key === key)
  }

  /** A new, unsaved transition with sensible defaults. Durations are the decoded file lengths. */
  function create(from: Track, to: Track, durations: { from: number; to: number }, fields: Partial<Transition> = {}): Transition {
    const now = Date.now()
    return {
      id: newId(),
      from: { key: songKey(from), path: from.path, duration: durations.from, title: from.title, artist: from.artist },
      to: { key: songKey(to), path: to.path, duration: durations.to, title: to.title, artist: to.artist },
      type: 'blend',
      exitAt: Math.max(0, durations.from - 30),
      entryAt: 0,
      overlap: 8,
      fadeOut: 'equal-power',
      fadeIn: 'equal-power',
      // New transitions keep each song's key while matching tempo (older ones stay 'vinyl')
      pitch: 'keep',
      stretch: 'to',
      rampBack: DEFAULT_RAMP_BACK_SECONDS,
      needsReview: false,
      createdAt: now,
      updatedAt: now,
      ...fields,
    }
  }

  async function save(t: Transition): Promise<Transition> {
    // IPC can't clone reactive proxies; a JSON round-trip also drops undefined optionals
    const clean: Transition = JSON.parse(JSON.stringify({ ...t, updatedAt: Date.now() }))
    byPair.value = await window.api.saveTransition(clean)
    return clean
  }

  async function remove(id: string) {
    byPair.value = await window.api.deleteTransition(id)
  }

  async function setNeedsReview(id: string, value: boolean) {
    const t = getById(id)
    if (!t || t.needsReview === value) return
    await save({ ...t, needsReview: value })
  }

  return {
    byPair,
    loaded,
    list,
    needsReviewCount,
    load,
    find,
    getById,
    outgoing,
    incoming,
    create,
    save,
    remove,
    setNeedsReview,
  }
})
