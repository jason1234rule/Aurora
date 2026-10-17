<template>
  <div class="room relative w-full rounded-xl overflow-hidden bg-black/30 border border-white/[0.08]" :style="{ aspectRatio: `${PLAN_W} / ${PLAN_H}` }">
    <div class="absolute inset-0" :style="{ background: glow }" />
    <svg class="plan absolute inset-0 w-full h-full" :viewBox="`0 0 ${PLAN_W} ${PLAN_H}`" preserveAspectRatio="none" aria-hidden="true" v-html="PLAN_SVG" />
    <button
      v-for="l in lights"
      :key="l.label"
      class="bulb absolute flex items-center gap-1.5"
      :class="[l.labelSide === 'right' ? 'flex-row' : l.labelSide === 'left' ? 'flex-row-reverse' : 'flex-col', { 'cursor-default': !l.name }]"
      :style="bulbStyle(l)"
      :title="`${l.label} · ${l.where}`"
      @click="l.name && emit('pick', l.name)"
    >
      <i
        class="block w-5 h-5 rounded-full border transition-[background,box-shadow] duration-75"
        :class="[
          !l.name ? 'border-dashed border-white/40 bg-transparent' : 'border-white/25',
          l.name && l.name === focus ? 'ring-2 ring-accent ring-offset-2 ring-offset-black' : '',
        ]"
        :style="dotStyle(l)"
      />
      <span class="text-[10.5px] whitespace-nowrap" :class="!l.name || !isOn(l) ? 'text-white/35' : 'text-white/65'">
        {{ l.label }}{{ !l.name ? ' · planned' : !isOn(l) ? ' · off' : '' }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ROOM_LIGHTS, PLAN_SVG, PLAN_W, PLAN_H, type RoomLight } from '@/utils/lights/room'
import type { RGB } from '@/utils/lights/govee'

const props = defineProps<{
  /** Colour of each bulb (by Bluetooth name) right now */
  colours: Record<string, RGB>
  /** Bulbs in use (others are drawn as off) */
  on: string[]
  /** The bulb being edited */
  focus?: string | null
}>()
const emit = defineEmits<{ (e: 'pick', name: string): void }>()

const lights = ROOM_LIGHTS
const isOn = (l: RoomLight) => !!l.name && props.on.includes(l.name)

function bulbStyle(l: RoomLight) {
  const x = (l.x / PLAN_W) * 100, y = (l.y / PLAN_H) * 100
  const tx = l.labelSide === 'right' ? '-10px' : l.labelSide === 'left' ? 'calc(-100% + 10px)' : '-50%'
  const ty = l.labelSide ? '-50%' : '-10px'
  return { left: `${x}%`, top: `${y}%`, transform: `translate(${tx}, ${ty})` }
}

function dotStyle(l: RoomLight) {
  if (!l.name || !isOn(l)) return { background: l.name ? '#1a1a1d' : 'transparent' }
  const c = props.colours[l.name] ?? [0, 0, 0]
  const lum = Math.max(...c) / 255
  return {
    background: `rgb(${c.join(',')})`,
    boxShadow: `0 0 ${8 + lum * 22}px ${2 + lum * 8}px rgba(${c.join(',')},${0.3 + lum * 0.5})`,
  }
}

const glow = computed(() => lights
  .filter(l => l.name && isOn(l))
  .map(l => {
    const c = props.colours[l.name!] ?? [0, 0, 0]
    const lum = Math.max(...c) / 255
    return `radial-gradient(circle at ${(l.x / PLAN_W) * 100}% ${(l.y / PLAN_H) * 100}%, rgba(${c.join(',')},${0.06 + lum * 0.3}), transparent ${l.reach}%)`
  })
  .join(','))
</script>

<style scoped>
.plan :deep(.wall) { fill: none; stroke: rgba(255, 255, 255, 0.3); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.plan :deep(.win) { stroke: rgba(150, 200, 255, 0.55); stroke-width: 3; vector-effect: non-scaling-stroke; }
.plan :deep(.furn) { fill: rgba(255, 255, 255, 0.035); stroke: rgba(255, 255, 255, 0.13); stroke-width: 1; vector-effect: non-scaling-stroke; }
.plan :deep(.fan) { fill: none; stroke: rgba(255, 255, 255, 0.16); stroke-width: 1; vector-effect: non-scaling-stroke; }
.plan :deep(text) { fill: rgba(255, 255, 255, 0.3); font-size: 3px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
</style>
