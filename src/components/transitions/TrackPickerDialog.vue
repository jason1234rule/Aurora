<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-[80] bg-black/50" @click="$emit('close')" />
    </Transition>
    <Transition name="dialog-slide">
      <div
        v-if="show"
        class="fixed top-[12vh] left-1/2 -translate-x-1/2 z-[90] w-[520px] max-w-[92vw] rounded-2xl menu-panel shadow-2xl flex flex-col max-h-[70vh]"
        @keydown.esc.stop="$emit('close')"
      >
        <div class="p-4 pb-3 border-b border-white/[0.06]">
          <p class="text-xs text-white/40 mb-2 truncate">
            Transition from <span class="text-white/80">{{ from.title }}</span> to…
          </p>
          <input
            ref="inputRef"
            v-model="query"
            placeholder="Search songs"
            class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white placeholder-white/25 outline-none focus:border-accent/50"
            @keydown.enter.prevent="results[0] && pick(results[0])"
          />
        </div>
        <div class="overflow-y-auto p-2">
          <p v-if="!results.length" class="text-sm text-white/30 text-center py-6">No local songs match.</p>
          <button
            v-for="t in results"
            :key="t.id"
            @click="pick(t)"
            class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-white/[0.06] transition-colors"
          >
            <div class="flex-1 min-w-0">
              <p class="text-sm text-white/85 truncate">{{ t.title }}</p>
              <p class="text-xs text-white/35 truncate">{{ t.artist }}<template v-if="t.album"> · {{ t.album }}</template></p>
            </div>
            <span
              v-if="transitions.find(from, t)"
              class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0"
              title="A transition already exists; picking opens it"
            >exists</span>
            <span class="text-[11px] text-white/25 tabular-nums shrink-0">{{ formatTime(t.duration) }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { useTransitionsStore } from '@/stores/transitions'
import { formatTime } from '@/utils/formatTime'

const props = defineProps<{ show: boolean; from: Track }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'pick', track: Track): void }>()

const library = useLibraryStore()
const transitions = useTransitionsStore()
const query = ref('')
const inputRef = ref<HTMLInputElement>()

const isLocal = (t: Track) => t.source !== 'subsonic' && (t.path.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(t.path))

const results = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  const out: Track[] = []
  for (const t of library.tracks) {
    if (t.id === props.from.id || !isLocal(t)) continue
    const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase()
    if (words.every(w => hay.includes(w))) out.push(t)
    if (out.length >= 80) break
  }
  return out
})

watch(() => props.show, (open) => {
  if (!open) return
  query.value = ''
  nextTick(() => inputRef.value?.focus())
}, { immediate: true })

function pick(t: Track) {
  emit('pick', t)
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.dialog-slide-enter-active { transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.dialog-slide-leave-active { transition: all 0.15s ease-in; }
.dialog-slide-enter-from, .dialog-slide-leave-to { opacity: 0; transform: translate(-50%, -8px); }
</style>
