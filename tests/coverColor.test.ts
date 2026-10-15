import { describe, it, expect } from 'vitest'
import { dominantColor, colorOrder, rgbToLab, hue, chroma, type CoverColor } from '@/utils/coverColor'

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
  it('converts rgb to lab', () => {
    const white = rgbToLab(255, 255, 255)
    expect(white.l).toBeCloseTo(100, 0); expect(chroma(white)).toBeLessThan(1)
    expect(hue(rgbToLab(255, 0, 0))).toBeLessThan(60)
  })
  it('picks the colour that covers the cover, not a small bright accent', () => {
    // Peach background with a small saturated red block (like a logo)
    const c = dominantColor(image(32, (x, y) => (x < 6 && y < 6 ? [230, 20, 20] : [214, 160, 130])))
    expect(Math.abs(hue(c) - hue(rgbToLab(214, 160, 130)))).toBeLessThan(10)
  })
  it('lets a strong colour beat a slightly bigger dark shadow', () => {
    // 55% near-black, 45% saturated blue (Starboy-like)
    const c = dominantColor(image(32, (x) => (x < 18 ? [8, 8, 12] : [30, 60, 220])))
    expect(chroma(c)).toBeGreaterThan(30)
  })
  it('calls black & white covers grey', () => {
    const c = dominantColor(image(32, (x, y) => { const v = (x * 8 + y) % 256; return [v, v, v] }))
    expect(chroma(c)).toBeLessThan(8)
  })
  it('chains similar colours together, then grey from white to black', () => {
    const lab = (r: number, g: number, b: number) => rgbToLab(r, g, b)
    const items: [string, CoverColor][] = [
      ['black', lab(10, 10, 10)], ['peach', lab(214, 160, 130)], ['blue', lab(30, 60, 220)],
      ['white', lab(250, 250, 250)], ['pale peach', lab(240, 205, 180)], ['orange', lab(220, 120, 40)],
      ['navy', lab(20, 30, 120)], ['red', lab(200, 30, 30)],
    ]
    const order = colorOrder(items, ([, c]) => c).map(([n]) => n)
    expect(order[0]).toBe('red')
    const at = (n: string) => order.indexOf(n)
    expect(Math.abs(at('peach') - at('pale peach'))).toBe(1)
    expect(Math.abs(at('blue') - at('navy'))).toBe(1)
    expect(order.slice(-2)).toEqual(['white', 'black'])
  })
})
