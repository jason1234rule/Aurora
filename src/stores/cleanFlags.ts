import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { songKey } from '@/utils/smartPlaylistMatcher'

/** A song flagged as the clean (censored) version, to re-download explicit */
export interface CleanFlag {
  key: string
  title: string
  artist: string
  album: string
  path: string
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

  const keys = computed(() => new Set(flags.value.map(f => f.key)))
  const isFlagged = (t: Track | null | undefined) => !!t && keys.value.has(songKey(t))

  async function toggle(t: Track): Promise<boolean> {
    await load()
    const key = songKey(t)
    flags.value = keys.value.has(key)
      ? flags.value.filter(f => f.key !== key)
      : [...flags.value, { key, title: t.title, artist: t.artist, album: t.album ?? '', path: t.path, flaggedAt: Date.now() }]
    await window.api.mergeSettings({ cleanFlags: flags.value })
    return keys.value.has(key)
  }

  async function remove(key: string) {
    flags.value = flags.value.filter(f => f.key !== key)
    await window.api.mergeSettings({ cleanFlags: flags.value })
  }

  /** The list as CSV, in the same columns as the download lists */
  function toCsv(): string {
    const q = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    return ['#,Title,Artist,Album', ...flags.value.map((f, i) => [i + 1, q(f.title), q(f.artist), q(f.album)].join(','))].join('\n')
  }

  return { flags, isFlagged, toggle, remove, toCsv }
})
