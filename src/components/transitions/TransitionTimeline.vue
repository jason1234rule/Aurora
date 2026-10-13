<template>
  <div ref="wrapRef" class="relative select-none">
    <canvas
      ref="canvasRef"
      class="block w-full rounded-xl"
      :style="{ height: HEIGHT + 'px', cursor }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="hover = null"
      @wheel.prevent="onWheel"
      @dblclick="onDoubleClick"
      @contextmenu.prevent="onContextMenu"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Two stacked waveforms, FROM on top and TO below, on FROM's timeline.
 * Drag TO to align it, drag the exit / overlap-end lines and the bass-swap
 * diamond, drag FROM (or the ruler) to pan, wheel to zoom (horizontal wheel pans).
 * Hold Alt to drag without snapping to beats.
 *
 * Fade curves work like volume keyframes in a video editor: double-click a curve
 * to add a vertex, drag vertices, right-click (or select + Delete) to remove one.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { BeatGrid, FadePoint } from '@/types/transition'
import type { TransitionTiming } from '@/utils/transitions/schedule'
import { effectiveOverlap, transitionFade, fadeKnots, presetVertices } from '@/utils/transitions/schedule'
import { mixMapping, moveExit, slideTo, fromSpeed, type MixMapping } from '@/utils/transitions/timeline'
import type { PeakPyramid } from '@/utils/transitions/peaks'
import { beatTime, beatIndexAt, isDownbeat, nearestBeat } from '@/utils/transitions/beatgrid'

const props = defineProps<{
  timing: TransitionTiming
  fromPeaks: PeakPyramid | null
  toPeaks: PeakPyramid | null
  fromDuration: number
  toDuration: number
  fromGrid: BeatGrid | null
  toGrid: BeatGrid | null
  fromLabel: string
  toLabel: string
  snap: boolean
  /** FROM position of the preview playhead, or null */
  playhead: number | null
}>()

const emit = defineEmits<{
  (e: 'update', patch: Partial<TransitionTiming>): void
  /** A drag finished (one undo step for the parent, if it wants one) */
  (e: 'commit'): void
}>()

const HEIGHT = 300
const RULER = 24
const LANE = 124
const GAP = 8
const FROM_TOP = RULER + 4
const TO_TOP = FROM_TOP + LANE + GAP
const HANDLE_PX = 7
const GRID_MIN_CONFIDENCE = 0.2

const wrapRef = ref<HTMLElement>()
const canvasRef = ref<HTMLCanvasElement>()
const width = ref(800)

// View range in FROM seconds
const viewStart = ref(0)
const viewEnd = ref(30)
const spp = computed(() => (viewEnd.value - viewStart.value) / Math.max(1, width.value))

const mapping = computed<MixMapping | null>(() => {
  try { return mixMapping(props.timing) } catch { return null }
})
const overlap = computed(() => effectiveOverlap(props.timing))
/** FROM's speed during the blend, and how much of FROM's file the blend covers */
const rateF = computed(() => fromSpeed(props.timing))
const span = computed(() => overlap.value * rateF.value)
const usableFromGrid = computed(() => props.fromGrid && props.fromGrid.bpm > 0 && props.fromGrid.confidence >= GRID_MIN_CONFIDENCE ? props.fromGrid : null)
const usableToGrid = computed(() => props.toGrid && props.toGrid.bpm > 0 && props.toGrid.confidence >= GRID_MIN_CONFIDENCE ? props.toGrid : null)

const xOf = (t: number) => (t - viewStart.value) / spp.value
const tOf = (x: number) => viewStart.value + x * spp.value

// ── View control ───────────────────────────────────────────────────────────
function fit() {
  const t = props.timing
  const width = Math.max(16, span.value + 16)
  viewStart.value = t.exitAt - width * 0.35
  viewEnd.value = viewStart.value + width
}

function zoom(factor: number, centerT?: number) {
  const c = centerT ?? (viewStart.value + viewEnd.value) / 2
  const span = Math.min(Math.max((viewEnd.value - viewStart.value) * factor, 0.05), Math.max(60, props.fromDuration * 1.2))
  const frac = (c - viewStart.value) / (viewEnd.value - viewStart.value)
  viewStart.value = c - span * frac
  viewEnd.value = viewStart.value + span
}

function pan(dt: number) {
  viewStart.value += dt
  viewEnd.value += dt
}

/** Keep the view on the transition when it moves off-screen (e.g. after Suggest). */
function ensureVisible() {
  const t = props.timing
  if (t.exitAt < viewStart.value || t.exitAt > viewEnd.value) fit()
}

defineExpose({ fit, zoom, ensureVisible })

// ── Drawing ────────────────────────────────────────────────────────────────
let raf = 0
function scheduleDraw() {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; draw() })
}

function cssTriplet(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = width.value
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, HEIGHT)

  const text = cssTriplet('--app-text', '255 255 255')
  const accent = cssTriplet('--accent', '139 92 246')
  const ink = (a: number) => `rgb(${text} / ${a})`
  const acc = (a: number) => `rgb(${accent} / ${a})`
  const t = props.timing
  const m = mapping.value
  const ov = overlap.value
  const xExit = xOf(t.exitAt)
  const xEnd = xOf(t.exitAt + span.value)

  // Lanes
  ctx.fillStyle = ink(0.035)
  ctx.fillRect(0, FROM_TOP, w, LANE)
  ctx.fillRect(0, TO_TOP, w, LANE)

  // Overlap region
  if (ov > 0) {
    ctx.fillStyle = acc(0.10)
    ctx.fillRect(xExit, FROM_TOP, xEnd - xExit, TO_TOP + LANE - FROM_TOP)
  }

  // Beat ticks (drawn under the waveforms)
  const drawBeats = (grid: BeatGrid, top: number, toX: (beatT: number) => number, tFrom: number, tTo: number) => {
    const pxPerBeat = grid.period / spp.value
    if (pxPerBeat < 4) return
    const i0 = Math.floor(beatIndexAt(grid, tFrom)) - 1
    const i1 = Math.ceil(beatIndexAt(grid, tTo)) + 1
    for (let i = i0; i <= i1; i++) {
      const x = toX(beatTime(grid, i))
      if (x < -1 || x > w + 1) continue
      const down = isDownbeat(grid, i)
      if (!down && pxPerBeat < 10) continue
      ctx.fillStyle = down ? ink(0.22) : ink(0.08)
      ctx.fillRect(Math.round(x), top, 1, LANE)
    }
  }
  if (usableFromGrid.value) drawBeats(usableFromGrid.value, FROM_TOP, xOf, viewStart.value, viewEnd.value)
  if (usableToGrid.value && m) {
    drawBeats(usableToGrid.value, TO_TOP, (q) => xOf(m.xForToPos(q)), m.toPosAt(viewStart.value), m.toPosAt(viewEnd.value))
  }

  // Waveforms
  const midF = FROM_TOP + LANE / 2, midT = TO_TOP + LANE / 2
  const amp = LANE / 2 - 4
  const step = spp.value
  if (props.fromPeaks) {
    for (let x = 0; x < w; x++) {
      const a = tOf(x)
      if (a + step < 0 || a > props.fromDuration) continue
      const [lo, hi] = props.fromPeaks.range(a, a + step)
      const heard = a < t.exitAt + span.value
      ctx.fillStyle = heard ? ink(0.55) : ink(0.18)
      const y0 = midF - hi * amp, y1 = midF - lo * amp
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
  }
  if (props.toPeaks && m) {
    for (let x = 0; x < w; x++) {
      const a = tOf(x)
      const q0 = m.toPosAt(a), q1 = m.toPosAt(a + step)
      if (q1 < 0 || q0 > props.toDuration) continue
      const [lo, hi] = props.toPeaks.range(q0, q1)
      ctx.fillStyle = a >= t.exitAt ? acc(0.8) : acc(0.25)
      const y0 = midT - hi * amp, y1 = midT - lo * amp
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
  }

  // Fade curves over the overlap
  if (ov > 0 && xEnd - xExit > 4) {
    const drawCurve = (fade: Fade, values: Float32Array) => {
      const top = laneTop(fade)
      const hot = hover.value?.fade === fade || drag?.fade === fade
      ctx.beginPath()
      for (let i = 0; i < values.length; i++) {
        const x = xExit + (xEnd - xExit) * (i / (values.length - 1))
        const y = top + LANE - values[i] * (LANE - 2) - 1
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = hot ? ink(0.9) : ink(0.6)
      ctx.lineWidth = hot ? 2 : 1.5
      ctx.stroke()

      if (!isCustom(fade)) return
      // Vertices: fixed ends hollow, movable ones filled; the active one gets its level
      const knots = fadeKnots(fade, pointsOf(fade))
      knots.forEach((k, i) => {
        const { x, y } = knotXY(fade, k)
        const fixed = i === 0 || i === knots.length - 1
        const active = !fixed && (activeVertex()?.fade === fade && activeVertex()?.index === i - 1)
        ctx.beginPath()
        ctx.arc(x, y, active ? 5.5 : 4, 0, Math.PI * 2)
        if (fixed) {
          ctx.strokeStyle = ink(0.5)
          ctx.lineWidth = 1.5
          ctx.stroke()
        } else {
          ctx.fillStyle = active ? acc(1) : ink(0.95)
          ctx.fill()
        }
        if (active) {
          ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
          ctx.textBaseline = 'bottom'
          ctx.fillStyle = ink(0.9)
          const label = `${formatDb(k.y)} · +${(k.x * ov).toFixed(2)}s`
          const lx = Math.min(x + 8, w - ctx.measureText(label).width - 4)
          ctx.fillText(label, lx, Math.max(top + 12, y - 6))
        }
      })
    }
    drawCurve('out', transitionFade(t, 'out', 256))
    drawCurve('in', transitionFade(t, 'in', 256))
  }

  // Exit / overlap-end lines
  ctx.fillStyle = acc(1)
  ctx.fillRect(Math.round(xExit) - 1, RULER, 2, HEIGHT - RULER)
  if (ov > 0) {
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = acc(0.9)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(Math.round(xEnd) + 0.5, RULER)
    ctx.lineTo(Math.round(xEnd) + 0.5, HEIGHT)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Bass swap marker
  if (t.bassSwap && ov > 0) {
    const xb = xOf(t.exitAt + t.bassSwap.at * rateF.value)
    const yb = TO_TOP - GAP / 2
    ctx.fillStyle = acc(1)
    ctx.beginPath()
    ctx.moveTo(xb, yb - 7); ctx.lineTo(xb + 7, yb); ctx.lineTo(xb, yb + 7); ctx.lineTo(xb - 7, yb)
    ctx.closePath()
    ctx.fill()
  }

  // Ruler: seconds relative to the exit point
  ctx.fillStyle = ink(0.04)
  ctx.fillRect(0, 0, w, RULER)
  const tickStep = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find(s => s / spp.value >= 70) ?? 300
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const first = Math.ceil((viewStart.value - t.exitAt) / tickStep) * tickStep
  for (let rel = first; rel <= viewEnd.value - t.exitAt; rel += tickStep) {
    const x = xOf(t.exitAt + rel)
    ctx.fillStyle = ink(0.25)
    ctx.fillRect(Math.round(x), RULER - 6, 1, 6)
    ctx.fillStyle = ink(0.45)
    const label = Math.abs(rel) < 1e-6 ? 'exit' : `${rel > 0 ? '+' : '−'}${Math.abs(rel).toFixed(tickStep < 1 ? 2 : 0)}s`
    ctx.fillText(label, x + 3, RULER / 2)
  }

  // Lane labels
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillStyle = ink(0.55)
  ctx.fillText(`Outgoing · ${props.fromLabel}`, 8, FROM_TOP + 6)
  ctx.fillStyle = acc(0.9)
  ctx.fillText(`Incoming · ${props.toLabel}`, 8, TO_TOP + 6)

  // Hover guide
  if (hover.value?.target === 'exit' || hover.value?.target === 'overlapEnd' || hover.value?.target === 'bass') {
    ctx.fillStyle = ink(0.08)
    ctx.fillRect(hover.value.x - 6, RULER, 12, HEIGHT - RULER)
  }

  // Preview playhead
  if (props.playhead !== null) {
    const xp = xOf(props.playhead)
    if (xp >= 0 && xp <= w) {
      ctx.fillStyle = ink(0.95)
      ctx.fillRect(Math.round(xp), 0, 1.5, HEIGHT)
    }
  }
}

// ── Fade vertices ──────────────────────────────────────────────────────────
type Fade = 'out' | 'in'
const VERTEX_PX = 7
const CURVE_PX = 6

const laneTop = (fade: Fade) => (fade === 'out' ? FROM_TOP : TO_TOP)
const isCustom = (fade: Fade) => (fade === 'out' ? props.timing.fadeOut : props.timing.fadeIn) === 'custom'
const pointsOf = (fade: Fade): FadePoint[] =>
  (fade === 'out' ? props.timing.fadeOutPoints : props.timing.fadeInPoints) ?? []

function knotXY(fade: Fade, k: FadePoint) {
  const xExit = xOf(props.timing.exitAt), xEnd = xOf(props.timing.exitAt + span.value)
  return { x: xExit + (xEnd - xExit) * k.x, y: laneTop(fade) + LANE - k.y * (LANE - 2) - 1 }
}

function gainAtY(fade: Fade, y: number) {
  return Math.max(0, Math.min(1, (laneTop(fade) + LANE - 1 - y) / (LANE - 2)))
}

const formatDb = (g: number) => (g <= 0.0001 ? '−∞ dB' : `${(20 * Math.log10(g)).toFixed(1)} dB`)

function emitPoints(fade: Fade, points: FadePoint[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x)
  emit('update', fade === 'out'
    ? { fadeOut: 'custom', fadeOutPoints: sorted }
    : { fadeIn: 'custom', fadeInPoints: sorted })
}

/** Vertex currently selected (last clicked), as an index into the interior points */
const selected = ref<{ fade: Fade; index: number } | null>(null)
const activeVertex = () => (drag?.fade !== undefined && drag.index !== undefined
  ? { fade: drag.fade, index: drag.index }
  : hover.value?.target === 'vertex' ? { fade: hover.value.fade!, index: hover.value.index! } : selected.value)

// ── Interaction ────────────────────────────────────────────────────────────
type Target = 'exit' | 'overlapEnd' | 'bass' | 'to' | 'pan' | 'vertex' | 'curve'
interface Hit { target: Target; fade?: Fade; index?: number }
const hover = ref<(Hit & { x: number }) | null>(null)
let drag: (Hit & { startX: number; startTiming: TransitionTiming; startView: [number, number]; moved: boolean }) | null = null

const cursor = computed(() => {
  const target = drag?.target ?? hover.value?.target
  if (target === 'vertex') return drag ? 'grabbing' : 'move'
  if (target === 'curve') return 'copy'
  if (target === 'exit' || target === 'overlapEnd' || target === 'bass') return 'ew-resize'
  if (target === 'to') return drag ? 'grabbing' : 'grab'
  return drag ? 'grabbing' : 'default'
})

function hitTest(x: number, y: number): Hit {
  const t = props.timing
  const ov = overlap.value
  if (ov > 0) {
    // Vertices win over everything so they stay grabbable near the exit / overlap-end lines
    for (const fade of ['out', 'in'] as const) {
      if (!isCustom(fade)) continue
      const pts = [...pointsOf(fade)].sort((a, b) => a.x - b.x)
      for (let i = 0; i < pts.length; i++) {
        const p = knotXY(fade, pts[i])
        if (Math.hypot(x - p.x, y - p.y) <= VERTEX_PX) return { target: 'vertex', fade, index: i }
      }
    }
  }
  if (t.bassSwap && ov > 0) {
    const xb = xOf(t.exitAt + t.bassSwap.at * rateF.value)
    if (Math.abs(x - xb) <= HANDLE_PX + 2 && Math.abs(y - (TO_TOP - GAP / 2)) <= 12) return { target: 'bass' }
  }
  if (ov > 0 && Math.abs(x - xOf(t.exitAt + span.value)) <= HANDLE_PX) return { target: 'overlapEnd' }
  if (Math.abs(x - xOf(t.exitAt)) <= HANDLE_PX) return { target: 'exit' }
  const curve = curveAt(x, y)
  if (curve) return { target: 'curve', fade: curve }
  if (y >= TO_TOP) return { target: 'to' }
  return { target: 'pan' }
}

/** The fade whose curve passes within a few px of (x, y), if any */
function curveAt(x: number, y: number): Fade | null {
  const ov = overlap.value
  const xExit = xOf(props.timing.exitAt), xEnd = xOf(props.timing.exitAt + span.value)
  if (ov <= 0 || x <= xExit || x >= xEnd) return null
  const frac = (x - xExit) / (xEnd - xExit)
  for (const fade of ['out', 'in'] as const) {
    const top = laneTop(fade)
    if (y < top || y > top + LANE) continue
    const values = transitionFade(props.timing, fade, 512)
    const v = values[Math.round(frac * (values.length - 1))]
    if (Math.abs(y - (top + LANE - v * (LANE - 2) - 1)) <= CURVE_PX) return fade
  }
  return null
}

function onDoubleClick(e: MouseEvent) {
  const r = canvasRef.value!.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  const hit = hitTest(x, y)
  if (hit.target !== 'curve' || !hit.fade) { fit(); return }
  const fade = hit.fade
  const xExit = xOf(props.timing.exitAt), xEnd = xOf(props.timing.exitAt + span.value)
  const point = { x: (x - xExit) / (xEnd - xExit), y: gainAtY(fade, y) }
  // Turning a preset into a custom fade starts from the preset's shape
  const base = isCustom(fade) ? pointsOf(fade) : presetVertices(fade === 'out' ? props.timing.fadeOut : props.timing.fadeIn, fade)
  const points = [...base.filter(p => Math.abs(p.x - point.x) > 0.01), point].sort((a, b) => a.x - b.x)
  emitPoints(fade, points)
  selected.value = { fade, index: points.indexOf(point) }
  emit('commit')
}

function removeVertex(fade: Fade, index: number) {
  const pts = [...pointsOf(fade)].sort((a, b) => a.x - b.x)
  pts.splice(index, 1)
  emitPoints(fade, pts)
  selected.value = null
  emit('commit')
}

function onContextMenu(e: MouseEvent) {
  const r = canvasRef.value!.getBoundingClientRect()
  const hit = hitTest(e.clientX - r.left, e.clientY - r.top)
  if (hit.target === 'vertex') removeVertex(hit.fade!, hit.index!)
}

function onKeydown(e: KeyboardEvent) {
  if (!selected.value || (e.key !== 'Delete' && e.key !== 'Backspace')) return
  const { fade, index } = selected.value
  if (!isCustom(fade) || index >= pointsOf(fade).length) { selected.value = null; return }
  const el = e.target as HTMLElement
  if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return
  e.preventDefault()
  e.stopPropagation()
  removeVertex(fade, index)
}

function localXY(e: PointerEvent | WheelEvent) {
  const r = canvasRef.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function snapFrom(tm: number, e: PointerEvent): number {
  const g = usableFromGrid.value
  return props.snap && g && !e.altKey ? nearestBeat(g, tm) : tm
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const { x, y } = localXY(e)
  let hit = hitTest(x, y)
  selected.value = hit.target === 'vertex' ? { fade: hit.fade!, index: hit.index! } : null
  // Curves only react to double-clicks; dragging one behaves like dragging its lane
  if (hit.target === 'curve') hit = { target: hit.fade === 'in' ? 'to' : 'pan' }
  drag = { ...hit, startX: x, startTiming: { ...props.timing }, startView: [viewStart.value, viewEnd.value], moved: false }
  canvasRef.value!.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  const { x, y } = localXY(e)
  if (!drag) {
    hover.value = { ...hitTest(x, y), x }
    return
  }
  const dx = x - drag.startX
  if (Math.abs(dx) > 1 || drag.target === 'vertex') drag.moved = true
  if (!drag.moved) return
  const t0 = drag.startTiming
  const ov = effectiveOverlap(t0)
  // The blend measured along FROM's file (it differs from ov when FROM changes speed)
  const rF = fromSpeed(t0)
  const sp = ov * rF

  switch (drag.target) {
    case 'vertex': {
      const fade = drag.fade!
      const pts = [...((fade === 'out' ? t0.fadeOutPoints : t0.fadeInPoints) ?? [])].sort((a, b) => a.x - b.x)
      const i = drag.index!
      // Stay between the neighbouring vertices (or the fixed ends)
      const lo = (i > 0 ? pts[i - 1].x : 0) + 0.001
      const hi = (i < pts.length - 1 ? pts[i + 1].x : 1) - 0.001
      let pos = t0.exitAt + ((x - xOf(t0.exitAt)) / (xOf(t0.exitAt + sp) - xOf(t0.exitAt))) * sp
      pos = snapFrom(pos, e)
      pts[i] = { x: Math.max(lo, Math.min(hi, (pos - t0.exitAt) / sp)), y: gainAtY(fade, y) }
      emitPoints(fade, pts)
      break
    }
    case 'pan': {
      const dt = dx * spp.value
      viewStart.value = drag.startView[0] - dt
      viewEnd.value = drag.startView[1] - dt
      break
    }
    case 'exit': {
      let exit = snapFrom(t0.exitAt + dx * spp.value, e)
      exit = Math.max(0, Math.min(exit, props.fromDuration - Math.max(sp, 0.05)))
      const next = moveExit(t0, exit)
      if (next.entryAt < 0 || next.entryAt >= props.toDuration) break
      emit('update', next)
      break
    }
    case 'overlapEnd': {
      const end = snapFrom(t0.exitAt + sp + dx * spp.value, e)
      const overlapNew = Math.max(0.05, Math.min(end - t0.exitAt, props.fromDuration - t0.exitAt) / rF)
      const patch: Partial<TransitionTiming> = { overlap: overlapNew }
      if (t0.bassSwap) patch.bassSwap = { at: Math.min(t0.bassSwap.at, overlapNew) }
      emit('update', patch)
      break
    }
    case 'bass': {
      const at = (snapFrom(t0.exitAt + (t0.bassSwap?.at ?? 0) * rF + dx * spp.value, e) - t0.exitAt) / rF
      emit('update', { bassSwap: { at: Math.max(0, Math.min(at, ov)) } })
      break
    }
    case 'to': {
      let entry = slideTo(t0, dx * spp.value)
      const g = usableToGrid.value
      if (props.snap && g && !e.altKey) entry = nearestBeat(g, entry)
      entry = Math.max(0, Math.min(entry, props.toDuration - 0.5))
      emit('update', { entryAt: entry })
      break
    }
  }
}

function onPointerUp(e: PointerEvent) {
  if (!drag) return
  const moved = drag.moved && drag.target !== 'pan' && drag.target !== 'curve'
  drag = null
  try { canvasRef.value!.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  if (moved) emit('commit')
}

function onWheel(e: WheelEvent) {
  const { x } = localXY(e)
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    pan(e.deltaX * spp.value)
  } else if (e.shiftKey) {
    pan(e.deltaY * spp.value)
  } else {
    zoom(Math.exp(e.deltaY * 0.0015), tOf(x))
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
let resizeObs: ResizeObserver | null = null
onMounted(() => {
  resizeObs = new ResizeObserver(() => {
    width.value = wrapRef.value?.clientWidth || 800
    scheduleDraw()
  })
  if (wrapRef.value) resizeObs.observe(wrapRef.value)
  width.value = wrapRef.value?.clientWidth || 800
  fit()
  scheduleDraw()
  document.addEventListener('keydown', onKeydown, { capture: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, { capture: true })
  resizeObs?.disconnect()
  if (raf) cancelAnimationFrame(raf)
})

watch(
  () => [props.timing, props.fromPeaks, props.toPeaks, props.fromGrid, props.toGrid, props.playhead, viewStart.value, viewEnd.value, width.value, hover.value, selected.value],
  scheduleDraw,
  { deep: true },
)
</script>
