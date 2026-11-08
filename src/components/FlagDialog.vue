<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-[80] bg-black/50" @click="$emit('close')" />
    </Transition>

    <Transition name="dialog-slide">
      <div
        v-if="show && track"
        class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[90] w-[400px] max-w-[90vw] rounded-2xl bg-[#12121f]/95 backdrop-blur-2xl border border-white/[0.08] shadow-2xl"
        @keydown.esc="$emit('close')"
      >
        <div class="p-6">
          <h3 class="text-base font-semibold text-white mb-1">{{ existing ? 'Edit Flag' : 'Flag Song' }}</h3>
          <p class="text-sm text-white/50 truncate mb-4">{{ track.title }} · {{ track.artist }}</p>

          <!-- Quick reasons -->
          <div class="flex flex-wrap gap-1.5 mb-3">
            <button
              v-for="r in REASONS"
              :key="r"
              @click="pickReason(r)"
              class="px-2.5 py-1 rounded-full text-xs transition-colors border"
              :class="note.includes(r) ? 'bg-amber-400/15 border-amber-400/40 text-amber-300' : 'border-white/[0.1] text-white/60 hover:text-white hover:bg-white/[0.06]'"
            >
              {{ r }}
            </button>
          </div>

          <textarea
            ref="noteEl"
            v-model="note"
            rows="3"
            placeholder="What's wrong with it? e.g. this is the remix, the original is the one with Nicki"
            class="ctx-input w-full rounded-lg px-3 py-2 text-sm resize-none"
            @keydown.meta.enter="save"
            @keydown.ctrl.enter="save"
          />

          <div class="flex items-center gap-2.5 mt-5">
            <button
              v-if="existing"
              @click="unflag"
              class="px-3 py-2 rounded-lg text-sm font-medium text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Remove Flag
            </button>
            <div class="flex-1" />
            <button
              @click="$emit('close')"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Cancel
            </button>
            <button
              @click="save"
              class="px-4 py-2 rounded-lg text-sm font-medium bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 border border-amber-400/30 transition-colors"
            >
              {{ existing ? 'Save' : 'Flag' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useCleanFlagsStore } from '@/stores/cleanFlags'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ show: boolean; track: Track | null }>()
const emit = defineEmits<{ close: [] }>()

const REASONS = ['Clean version', 'Wrong version', 'Wrong featured artists', 'Bad audio']

const flags = useCleanFlagsStore()
const toast = useToast()
const note = ref('')
const noteEl = ref<HTMLTextAreaElement>()
const existing = computed(() => flags.flagOf(props.track))

watch(() => props.show, open => {
  if (!open) return
  note.value = existing.value?.note ?? ''
  nextTick(() => noteEl.value?.focus())
})

/** Toggle a quick reason in the note, keeping whatever else was typed */
function pickReason(r: string) {
  const parts = note.value.split(/\s*;\s*/).filter(Boolean)
  note.value = parts.includes(r) ? parts.filter(p => p !== r).join('; ') : [r, ...parts].join('; ')
}

async function save() {
  if (!props.track) return
  const wasFlagged = !!existing.value
  await flags.save(props.track, note.value.trim())
  toast.success(wasFlagged ? 'Flag updated' : `Flagged "${props.track.title}"`)
  emit('close')
}

async function unflag() {
  if (!props.track) return
  await flags.remove(flags.flagOf(props.track)!.key)
  toast.success(`Unflagged "${props.track.title}"`)
  emit('close')
}
</script>
