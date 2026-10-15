import { describe, it, expect } from 'vitest'
import { dominantColor, colorSortKey, rgbToHsl } from '@/utils/coverColor'

/** n×n RGBA image filled by fn(x, y) → [r, g, b] */
function image(n: number, fn: (x: number, y: number) => [number, number, number]) {
  const a = new Uint8ClampedArray(n * n * 4)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const [r, g, b] = fn(x, y); const i = (y * n + x) * 4
    a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255
  }
  return a
}

describe('cover colour', () => {
  it('converts rgb to hsl', () => {
    expect(rgbToHsl(255, 0, 0)[0]).toBeCloseTo(0)
    expect(rgbToHsl(0, 0, 255)[0]).toBeCloseTo(240)
  })
  it('finds the dominant hue, ignoring a big black background', () => {
    const c = dominantColor(image(32, (x) => (x < 22 ? [5, 5, 5] : [20, 60, 230])))
    expect(c.hue).toBeGreaterThan(220); expect(c.hue).toBeLessThan(240)
  })
  it('calls black & white covers grey, with their lightness', () => {
    const c = dominantColor(image(32, (x, y) => { const v = (x * 8 + y) % 256; return [v, v, v] }))
    expect(c.hue).toBe(-1)
  })
  it('sorts round the colour wheel, then grey from white to black', () => {
    const red = { hue: 2, lightness: 0.5 }, yellow = { hue: 55, lightness: 0.5 }, blue = { hue: 230, lightness: 0.5 }
    const pink = { hue: 330, lightness: 0.6 }, white = { hue: -1, lightness: 0.95 }, black = { hue: -1, lightness: 0.05 }
    const sorted = [black, pink, blue, white, yellow, red].sort((a, b) => colorSortKey(a) - colorSortKey(b))
    expect(sorted).toEqual([red, yellow, blue, pink, white, black])
  })
})
