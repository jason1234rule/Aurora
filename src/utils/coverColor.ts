/**
 * Album covers ordered by colour, for the "Cover Color" album sort.
 *
 * Each cover's colour is the main colour a person would name for it: the cover is
 * shrunk to 32×32, its pixels are grouped into 6 colour clusters (k-means in CIELAB,
 * where distances match how different colours look), and the biggest cluster wins,
 * with a boost for colourful clusters so a dark shadow doesn't beat a strong colour
 * (Starboy reads blue, not black). Clusters close to grey make the cover grey.
 *
 * Colourful covers are then chained so each sits next to its most similar neighbour
 * (nearest-neighbour path tidied with 2-opt), starting from the reddest. Grey covers
 * follow from white to black. A plain hue sort put look-alike covers far apart
 * whenever another cover's hue fell between theirs.
 */

/** CIELAB colour: l 0–100, a/b roughly −128…127 */
export interface CoverColor {
  l: number
  a: number
  b: number
}

const SIZE = 32
const CLUSTERS = 6
const ITERATIONS = 12
/** Weight a cluster's size by BASE + colourfulness (capped), so colour beats shadow */
const COLOUR_BOOST_BASE = 0.25
const COLOUR_BOOST_CAP = 30
/** Below this chroma a cover counts as grey */
const GREY_CHROMA = 8
/**
 * A "grey" winner is overruled when at least this share of the cover is clearly
 * coloured (chroma ≥ COLOURED_CHROMA). Measured: eternal sunshine 56%, Positions' teal
 * tint 11%, black & white covers 0%.
 */
const COLOURED_CHROMA = 12
const MIN_COLOURED_SHARE = 0.3
/** Coloured clusters within this many degrees of hue count as one colour */
const SAME_HUE_DEGREES = 30

export const chroma = (c: CoverColor) => Math.hypot(c.a, c.b)
export const hue = (c: CoverColor) => (Math.atan2(c.b, c.a) * 180 / Math.PI + 360) % 360
const distance = (p: CoverColor, q: CoverColor) => Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b)

export function rgbToLab(r: number, g: number, b: number): CoverColor {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const R = lin(r), G = lin(g), B = lin(b)
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) }
}

/** Main colour of RGBA pixel data */
export function dominantColor(rgba: Uint8ClampedArray): CoverColor {
  const pts: CoverColor[] = []
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] >= 128) pts.push(rgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]))
  }
  if (!pts.length) return { l: 0, a: 0, b: 0 }

  // k-means, seeded deterministically from evenly spaced pixels
  let centres = Array.from({ length: Math.min(CLUSTERS, pts.length) }, (_, i) => pts[Math.floor(i * pts.length / CLUSTERS)])
  let counts: number[] = []
  for (let it = 0; it < ITERATIONS; it++) {
    const sums = centres.map(() => ({ l: 0, a: 0, b: 0 }))
    counts = centres.map(() => 0)
    for (const p of pts) {
      let best = 0, bestD = Infinity
      for (let k = 0; k < centres.length; k++) {
        const d = (p.l - centres[k].l) ** 2 + (p.a - centres[k].a) ** 2 + (p.b - centres[k].b) ** 2
        if (d < bestD) { bestD = d; best = k }
      }
      sums[best].l += p.l; sums[best].a += p.a; sums[best].b += p.b; counts[best]++
    }
    centres = centres.map((c, k) => (counts[k] ? { l: sums[k].l / counts[k], a: sums[k].a / counts[k], b: sums[k].b / counts[k] } : c))
  }

  let best = 0, bestScore = -1
  centres.forEach((c, k) => {
    const score = counts[k] * (COLOUR_BOOST_BASE + Math.min(chroma(c), COLOUR_BOOST_CAP) / COLOUR_BOOST_CAP)
    if (score > bestScore) { bestScore = score; best = k }
  })
  if (chroma(centres[best]) >= GREY_CHROMA) return centres[best]

  // A dark or pale cluster won, but the cover may still be largely coloured, just split
  // across several shades (eternal sunshine: 56% warm browns in four clusters, each
  // smaller than its shadows). If enough of it is coloured, use those shades together.
  const coloured = centres.map((c, k) => ({ c, n: counts[k] })).filter(x => x.n && chroma(x.c) >= COLOURED_CHROMA)
  const share = coloured.reduce((s, x) => s + x.n, 0) / pts.length
  if (share < MIN_COLOURED_SHARE) return centres[best]
  const anchor = coloured.reduce((m, x) => (x.n * chroma(x.c) > m.n * chroma(m.c) ? x : m))
  const near = coloured.filter(x => Math.abs(((hue(x.c) - hue(anchor.c) + 540) % 360) - 180) <= SAME_HUE_DEGREES)
  const total = near.reduce((s, x) => s + x.n, 0)
  return {
    l: near.reduce((s, x) => s + x.c.l * x.n, 0) / total,
    a: near.reduce((s, x) => s + x.c.a * x.n, 0) / total,
    b: near.reduce((s, x) => s + x.c.b * x.n, 0) / total,
  }
}

/**
 * Order items by their cover colour: colourful ones as a smooth chain starting from
 * the reddest, then grey ones from white to black, then those without a colour.
 */
export function colorOrder<T>(items: T[], colorOf: (item: T) => CoverColor | undefined): T[] {
  const colourful: { item: T; c: CoverColor }[] = []
  const grey: { item: T; c: CoverColor }[] = []
  const unknown: T[] = []
  for (const item of items) {
    const c = colorOf(item)
    if (!c) unknown.push(item)
    else (chroma(c) < GREY_CHROMA ? grey : colourful).push({ item, c })
  }

  // Greedy nearest-neighbour chain from the reddest colour (pinks sort just before red)
  const path: typeof colourful = []
  const rest = [...colourful]
  if (rest.length) {
    let start = 0
    rest.forEach((x, i) => { if ((hue(x.c) + 20) % 360 < (hue(rest[start].c) + 20) % 360) start = i })
    path.push(rest.splice(start, 1)[0])
    while (rest.length) {
      const last = path[path.length - 1].c
      let next = 0
      rest.forEach((x, i) => { if (distance(last, x.c) < distance(last, rest[next].c)) next = i })
      path.push(rest.splice(next, 1)[0])
    }
  }
  // 2-opt: reverse stretches of the chain while that shortens it (start stays fixed)
  const d = (i: number, j: number) => distance(path[i].c, path[j].c)
  for (let pass = 0, improved = true; improved && pass < 8; pass++) {
    improved = false
    for (let i = 1; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const end = j + 1 < path.length
        const before = d(i - 1, i) + (end ? d(j, j + 1) : 0)
        const after = d(i - 1, j) + (end ? d(i, j + 1) : 0)
        if (after < before - 1e-9) {
          const rev = path.slice(i, j + 1).reverse()
          path.splice(i, rev.length, ...rev)
          improved = true
        }
      }
    }
  }

  grey.sort((x, y) => y.c.l - x.c.l)
  return [...path.map(x => x.item), ...grey.map(x => x.item), ...unknown]
}

// ── Cache ────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'aurora-cover-colors-v4'
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
