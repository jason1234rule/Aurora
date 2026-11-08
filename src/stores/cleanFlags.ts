import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { songKey } from '@/utils/smartPlaylistMatcher'

/** A song flagged to re-download: the clean version, the wrong mix, wrong credits... */
export interface CleanFlag {
  key: string
  title: string
  artist: string
  album: string
  path: string
  /** What's wrong with it. Flags from before notes existed have none and were all clean versions */
  note?: string
  flaggedAt: number
}

/** Kept in settings.json under `cleanFlags`, by songKey so a rescan or re-tag doesn't lose them */
export const useCleanFlagsStore = defineStore('cleanFlags', () => {
  const flags = ref<CleanFlag[]>([])
  let loading: Promise<void> | null = null

  function load() {
    loading ??= window.api.getSettings().then((s: any) => {
      if (Array.isArray(s?.cleanFlags)) flags.value = s.cleanFlags
    })
    return loading
  }
  load()

  const byKey = computed(() => new Map(flags.value.map(f => [f.key, f])))
  const flagOf = (t: Track | null | undefined) => (t ? byKey.value.get(songKey(t)) : undefined)
  const isFlagged = (t: Track | null | undefined) => !!flagOf(t)

  // A plain copy: IPC can't clone Vue's reactive proxies
  const persist = () => window.api.mergeSettings({ cleanFlags: JSON.parse(JSON.stringify(flags.value)) })

  /** Flag a song, or update the note on one already flagged */
  async function save(t: Track, note: string) {
    await load()
    const key = songKey(t), old = byKey.value.get(key)
    const flag: CleanFlag = { key, title: t.title, artist: t.artist, album: t.album ?? '', path: t.path, note, flaggedAt: old?.flaggedAt ?? Date.now() }
    flags.value = old ? flags.value.map(f => (f.key === key ? flag : f)) : [...flags.value, flag]
    await persist()
  }

  async function setNote(key: string, note: string) {
    flags.value = flags.value.map(f => (f.key === key ? { ...f, note } : f))
    await persist()
  }

  async function remove(key: string) {
    flags.value = flags.value.filter(f => f.key !== key)
    await persist()
  }

  const noteOf = (f: CleanFlag) => f.note ?? 'Clean version'

  /** The list as CSV, in the same columns as the download lists plus the note */
  function toCsv(): string {
    const q = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    return ['#,Title,Artist,Album,Note', ...flags.value.map((f, i) => [i + 1, q(f.title), q(f.artist), q(f.album), q(noteOf(f))].join(','))].join('\n')
  }

  return { flags, flagOf, isFlagged, noteOf, save, setNote, remove, toCsv }
})
