/**
 * Song credits: moves "(feat. X)" / "(with X)" out of titles and into the artist
 * credit, and remembers who is featured so listening stats can weight them.
 *
 *   splitCredits('Kiss Me More (feat. SZA)', 'Doja Cat')
 *     → { title: 'Kiss Me More', main: ['Doja Cat'], featured: ['SZA'] }
 *
 * "with" counts as a co-artist (that's how streaming services bill it), "feat." /
 * "ft." / "featuring" as a featured artist. Pure and import-light so the main
 * process (tag reading) and the renderer (stats, song identity) share it.
 */
import { splitArtists } from './splitArtists'

export interface Credits {
  title: string
  main: string[]
  featured: string[]
}

// "(feat. X)", "[ft. X]", "(featuring X)", "(with X)" anywhere in the title
const BRACKETED = /\s*[([]\s*(feat\.?|ft\.?|featuring|with)\s+([^)\]]+?)\s*[)\]]/gi
// Bare " feat. X" at the end of a title or artist
const TRAILING = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function addUnique(list: string[], names: string[]) {
  for (const n of names) {
    const name = n.trim()
    if (name && !list.some(x => same(x, name))) list.push(name)
  }
}

export function splitCredits(rawTitle: string, rawArtist: string): Credits {
  const main: string[] = []
  const featured: string[] = []

  // Artist tag first: "A feat. B" credits B as featured
  let artist = rawArtist || ''
  const artistFeat = artist.match(TRAILING)
  if (artistFeat) {
    addUnique(featured, splitArtists(artistFeat[1]))
    artist = artist.slice(0, artistFeat.index)
  }
  addUnique(main, splitArtists(artist))

  let title = rawTitle || ''
  title = title.replace(BRACKETED, (_, kind: string, names: string) => {
    addUnique(kind.toLowerCase() === 'with' ? main : featured, splitArtists(names))
    return ''
  })
  const titleFeat = title.match(TRAILING)
  if (titleFeat) {
    addUnique(featured, splitArtists(titleFeat[1]))
    title = title.slice(0, titleFeat.index)
  }

  title = title.replace(/\s{2,}/g, ' ').trim() || (rawTitle || '').trim()
  // Someone credited as a main artist isn't also a feature
  const feats = featured.filter(f => !main.some(m => same(m, f)))
  return { title, main, featured: feats }
}

/** "A", "A & B", "A, B & C" */
export function formatArtists(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

/**
 * Share of one listen per credited artist: main artists weigh 2, featured artists 1,
 * normalised to a total of 1. Two co-artists split 50/50; artist + feature 2:1.
 */
export function creditShares(main: string[], featured: string[]): Map<string, number> {
  const shares = new Map<string, number>()
  const total = main.length * 2 + featured.length
  if (!total) return shares
  for (const m of main) shares.set(m, 2 / total)
  for (const f of featured) shares.set(f, (shares.get(f) ?? 0) + 1 / total)
  return shares
}
