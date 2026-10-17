import { describe, it, expect } from 'vitest'
import { splitCredits, formatArtists, creditShares } from '@/utils/credits'

describe('splitCredits', () => {
  it('moves a bracketed feature out of the title', () => {
    expect(splitCredits('Kiss Me More (feat. SZA)', 'Doja Cat')).toEqual({ title: 'Kiss Me More', main: ['Doja Cat'], featured: ['SZA'] })
    expect(splitCredits('Finesse (Remix) [feat. Cardi B]', 'Bruno Mars')).toEqual({ title: 'Finesse (Remix)', main: ['Bruno Mars'], featured: ['Cardi B'] })
  })
  it('treats "with" as a co-artist', () => {
    expect(splitCredits('30 For 30 (with Kendrick Lamar)', 'SZA')).toEqual({ title: '30 For 30', main: ['SZA', 'Kendrick Lamar'], featured: [] })
    expect(splitCredits('Die For You (with Ariana Grande) - Remix', 'The Weeknd').title).toBe('Die For You - Remix')
  })
  it('handles several features and features in the artist tag', () => {
    expect(splitCredits('34+35 (Remix) [feat. Doja Cat & Megan Thee Stallion]', 'Ariana Grande').featured).toEqual(['Doja Cat', 'Megan Thee Stallion'])
    expect(splitCredits('Born Again', 'LISA feat. Doja Cat & RAYE')).toEqual({ title: 'Born Again', main: ['LISA'], featured: ['Doja Cat', 'RAYE'] })
  })
  it('does not double-credit someone already in the artist tag', () => {
    expect(splitCredits('Side To Side (feat. Nicki Minaj)', 'Ariana Grande, Nicki Minaj')).toEqual({ title: 'Side To Side', main: ['Ariana Grande', 'Nicki Minaj'], featured: [] })
  })
  it('leaves titles without credits alone', () => {
    expect(splitCredits('You Right - Extended', 'Doja Cat')).toEqual({ title: 'You Right - Extended', main: ['Doja Cat'], featured: [] })
    expect(splitCredits('With You', 'Someone').title).toBe('With You')
  })
})

describe('formatArtists / creditShares', () => {
  it('formats names', () => {
    expect(formatArtists(['A'])).toBe('A')
    expect(formatArtists(['A', 'B'])).toBe('A & B')
    expect(formatArtists(['A', 'B', 'C'])).toBe('A, B & C')
  })
  it('splits co-artists evenly and artist:feature 2:1', () => {
    expect([...creditShares(['A', 'B'], [])]).toEqual([['A', 0.5], ['B', 0.5]])
    const s = creditShares(['A'], ['F'])
    expect(s.get('A')).toBeCloseTo(2 / 3); expect(s.get('F')).toBeCloseTo(1 / 3)
  })
})
