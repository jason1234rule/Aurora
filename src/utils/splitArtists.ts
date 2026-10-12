/**
 * Split a potentially multi-artist string into individual artist names.
 *
 * Handles common delimiters: "; ", " / ", " feat. ", " ft. ", " featuring "
 * For ", " splitting, uses heuristics to avoid breaking names like
 * "Tyler, The Creator" — if the part after the comma starts with a common
 * continuation word (the, and, of, etc.), it stays merged.
 */

const CONTINUATION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'from',
  'with', 'for', 'to', 'by', 'as', 'into', 'not', 'no',
  'his', 'her', 'their', 'my', 'our', 'your', 'its',
  'el', 'la', 'las', 'los', 'le', 'les', 'de', 'del', 'das', 'die', 'der',
])

function smartCommaSplit(str: string): string[] {
  const segments = str.split(', ')
  if (segments.length <= 1) return [str]

  const result: string[] = []
  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase()

    // Merge into previous only if:
    //   1. The segment starts with a continuation word ("The", "and", etc.)
    //   2. AND the previous segment is a bare single word (looks like a first
    //      name, e.g. "Tyler") — not a complete multi-word name like "Kanye West".
    //
    // This preserves "Tyler, The Creator" while correctly splitting
    // "Kanye West, The Game" into two separate artists.
    const prevWordCount = result.length > 0
      ? result[result.length - 1].split(/\s+/).length
      : 0

    // Also require the continuation segment itself to be short (≤ 2 words).
    // Long segments like "The Boys Choir of Harlem" or "A Boogie Wit da Hoodie"
    // are clearly standalone artist names, not continuations.
    const segWordCount = trimmed.split(/\s+/).length

    if (result.length > 0 && CONTINUATION_WORDS.has(firstWord) && prevWordCount === 1 && segWordCount <= 2) {
      result[result.length - 1] += ', ' + trimmed
    } else {
      result.push(trimmed)
    }
  }

  return result
}

export function splitArtists(artistStr: string): string[] {
  if (!artistStr) return []

  // Normalize feature-style delimiters to semicolons
  let normalized = artistStr
    .replace(/\s+featuring\s+/gi, ' ; ')
    .replace(/\s+feat\.?\s+/gi, ' ; ')
    .replace(/\s+ft\.?\s+/gi, ' ; ')

  // Also normalize " & " to semicolons
  normalized = normalized.replace(/\s+&\s+/g, ' ; ')

  // Split on unambiguous delimiters: ";" and a spaced " / ". A bare "/" is part
  // of the name ("AC/DC", "HUNTR/X"); ID3v2.3 slash-separated values are already
  // split by the tag reader before they get here.
  const parts = normalized.split(/\s*;\s*|\s+\/\s+/)

  // For each part, try smart comma splitting
  const result: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    if (trimmed.includes(', ')) {
      result.push(...smartCommaSplit(trimmed))
    } else {
      result.push(trimmed)
    }
  }

  return result.filter(s => s.length > 0)
}
