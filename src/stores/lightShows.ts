import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { songKey } from '@/utils/smartPlaylistMatcher'
import type { LightShow, LightLook } from '@/types/lightShow'

/** Hand-made light shows, one per song, plus the saved looks they share */
export const useLightShowsStore = defineStore('lightShows', () => {
  const byKey = ref<Record<string, LightShow>>({})
  const looks = ref<LightLook[]>([])
  const loaded = ref(false)

  const list = computed(() => Object.values(byKey.value).sort((a, b) => b.updatedAt - a.updatedAt))

  async function load() {
    try {
      const file = await window.api.getLightShows()
      byKey.value = file?.shows ?? {}
      looks.value = file?.looks ?? []
    } catch (err) {
      console.error('Failed to load light shows:', err)
    }
    loaded.value = true
  }

  function find(track: Pick<Track, 'title' | 'artist'> & { mbid?: string }): LightShow | null {
    return byKey.value[songKey(track)] ?? null
  }

  function getById(id: string): LightShow | null {
    return list.value.find(s => s.id === id) ?? null
  }

  async function save(show: LightShow): Promise<LightShow> {
    // IPC can't clone reactive proxies
    const clean: LightShow = JSON.parse(JSON.stringify({ ...show, updatedAt: Date.now() }))
    byKey.value = (await window.api.saveLightShow(clean)).shows
    return clean
  }

  async function remove(id: string) {
    byKey.value = (await window.api.deleteLightShow(id)).shows
  }

  async function saveLooks(next: LightLook[]) {
    looks.value = (await window.api.saveLightLooks(JSON.parse(JSON.stringify(next)))).looks
  }

  return { byKey, looks, loaded, list, load, find, getById, save, remove, saveLooks }
})
