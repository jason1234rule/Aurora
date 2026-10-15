/**
 * Dominant colour of an album cover, for the "Cover Color" album sort.
 *
 * Covers are shrunk to 32×32 and every pixel votes for its hue, weighted by how
 * vivid it is (saturated and not near black or white). The winning hue band is the
 * cover's colour. Covers with too little colour overall (black & white photos,
 * white sleeves) count as grey and sort by lightness instead.
 */

export interface CoverColor {
  /** 0–360, or -1 for a grey cover */
  hue: number
  /** 0–1 */
  lightness: number
}

const SIZE = 32
const BANDS = 24
/** Pixels less vivid than this don't vote for a hue */
const MIN_PIXEL_VIVIDNESS = 0.08
/**
 * Covers whose average vividness is below this count as grey. Measured on real
 * covers: black & white photos and white sleeves score under 0.06, pastel covers
 * like "thank u, next" around 0.09, bold colour 0.2+.
 */
const MIN_COVER_VIVIDNESS = 0.06

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

/** Dominant colour of RGBA pixel data */
export function dominantColor(rgba: Uint8ClampedArray): CoverColor {
  const weight = new Float64Array(BANDS)
  const sinSum = new Float64Array(BANDS), cosSum = new Float64Array(BANDS), lightSum = new Float64Array(BANDS)
  let vividSum = 0, lightAll = 0, pixels = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const [h, s, l] = rgbToHsl(rgba[i], rgba[i + 1], rgba[i + 2])
    pixels++
    lightAll += l
    // Vivid = saturated and not near black or white; the square root keeps dark
    // colours (Starboy's navy) and pastels in the running against small bright accents
    const w = s * Math.sqrt(Math.max(0, 1 - Math.abs(2 * l - 1)))
    vividSum += w
    if (w < MIN_PIXEL_VIVIDNESS) continue
    const band = Math.floor(h / (360 / BANDS)) % BANDS
    const rad = h * Math.PI / 180
    weight[band] += w
    sinSum[band] += Math.sin(rad) * w
    cosSum[band] += Math.cos(rad) * w
    lightSum[band] += l * w
  }
  if (!pixels) return { hue: -1, lightness: 0 }
  if (vividSum / pixels < MIN_COVER_VIVIDNESS) return { hue: -1, lightness: lightAll / pixels }

  // Neighbouring bands count together so a hue on a band edge isn't split in two
  let best = 0, bestScore = -1
  for (let b = 0; b < BANDS; b++) {
    const score = weight[(b + BANDS - 1) % BANDS] * 0.5 + weight[b] + weight[(b + 1) % BANDS] * 0.5
    if (score > bestScore) { bestScore = score; best = b }
  }
  let sin = 0, cos = 0, light = 0, w = 0
  for (const b of [(best + BANDS - 1) % BANDS, best, (best + 1) % BANDS]) {
    sin += sinSum[b]; cos += cosSum[b]; light += lightSum[b]; w += weight[b]
  }
  const hue = (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360
  return { hue, lightness: light / w }
}

/**
 * Sort key: colourful covers around the colour wheel starting at red
 * (pinks wrap round to the end), then grey covers from white to black.
 */
export function colorSortKey(c: CoverColor | undefined): number {
  if (!c) return 3000 // not analysed yet / no cover: last
  if (c.hue < 0) return 2000 + (1 - c.lightness) * 100
  return ((c.hue + 15) % 360) + (1 - c.lightness) * 0.5
}

// ── Cache ────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'aurora-cover-colors-v2'
const cache = new Map<string, CoverColor>()
let loaded = false

function loadCache() {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) cache.set(k, v as CoverColor)
  } catch { /* storage unavailable */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveCache() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache))) } catch { /* storage unavailable */ }
  }, 500)
}

export function cachedCoverColor(coverPath: string): CoverColor | undefined {
  loadCache()
  return cache.get(coverPath)
}

/** Analyse a cover file (cached by path). Returns null if it can't be read. */
export async function coverColor(coverPath: string): Promise<CoverColor | null> {
  loadCache()
  const hit = cache.get(coverPath)
  if (hit) return hit
  try {
    const blob = await (await fetch(window.api.getMediaUrl(coverPath))).blob()
    const bitmap = await createImageBitmap(blob, { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'medium' })
    const canvas = new OffscreenCanvas(SIZE, SIZE)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const color = dominantColor(ctx.getImageData(0, 0, SIZE, SIZE).data)
    cache.set(coverPath, color)
    saveCache()
    return color
  } catch {
    return null
  }
}
