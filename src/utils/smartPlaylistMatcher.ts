import { splitCredits } from './credits'

/**
 * Stable identity of a song for play history, transitions and smart playlists.
 * Feature credits are ignored, so "Kiss Me More (feat. SZA)" by "Doja Cat" and
 * "Kiss Me More" by "Doja Cat & SZA" are the same song: it uses the first main
 * artist and the title without "(feat. …)" / "(with …)".
 */
export function songKey(track: Pick<Track, 'title' | 'artist'> & { mbid?: string }): string {
  if (track.mbid) return `mbid:${track.mbid}`
  const { title, main } = splitCredits(track.title || '', track.artist || '')
  const a = (main[0] ?? track.artist ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
  const t = title.toLowerCase().trim().replace(/\s+/g, ' ')
  return `norm:${a}||${t}`
}

export function matchRule(
  track: Track,
  rule: SmartPlaylistRule,
  getPlayCount?: (key: string) => number,
  getTrackTags?: (trackId: string) => string[],
): boolean {
  if (rule.field === 'tag') {
    const tags = getTrackTags ? getTrackTags(track.id) : []
    const ruleValue = rule.value.toLowerCase().trim()
    if (rule.operator === 'has_tag' || rule.operator === 'is') return tags.some(t => t.toLowerCase() === ruleValue)
    if (rule.operator === 'not_has_tag' || rule.operator === 'not_contains') return !tags.some(t => t.toLowerCase() === ruleValue)
    if (rule.operator === 'contains') return tags.some(t => t.toLowerCase().includes(ruleValue))
    return false
  }

  if (rule.field === 'playCount') {
    const count = getPlayCount ? getPlayCount(songKey(track)) : 0
    const rv = Number(rule.value)
    switch (rule.operator) {
      case 'equals': return count === rv
      case 'greater': return count > rv
      case 'less': return count < rv
      case 'between': return count >= rv && count <= Number(rule.value2 ?? 0)
      default: return false
    }
  }

  if (rule.field === 'recentlyAdded') {
    const days = Number(rule.value)
    const cutoff = Date.now() - days * 86400000
    const addedAt = track.addedAt ?? 0
    if (rule.operator === 'less') return addedAt >= cutoff   // within last N days
    if (rule.operator === 'greater') return addedAt < cutoff // older than N days
    return false
  }

  if (rule.field === 'format') {
    const parts = (track.path || '').split('.')
    const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
    const rv = rule.value.toLowerCase().trim().replace(/^\./, '')
    if (rule.operator === 'is' || rule.operator === 'equals') return ext === rv
    if (rule.operator === 'contains') return ext.includes(rv)
    return false
  }

  if (rule.field === 'bitrate') {
    const bps = track.bitrate ?? 0
    const kbps = Math.round(bps / 1000)
    const rv = Number(rule.value)
    switch (rule.operator) {
      case 'equals': return kbps === rv
      case 'greater': return kbps > rv
      case 'less': return kbps < rv
      case 'between': return kbps >= rv && kbps <= Number(rule.value2 ?? 0)
      default: return false
    }
  }

  if (rule.field === 'duration') {
    const secs = track.duration ?? 0
    const rv = Number(rule.value)
    switch (rule.operator) {
      case 'equals': return secs === rv
      case 'greater': return secs > rv
      case 'less': return secs < rv
      case 'between': return secs >= rv && secs <= Number(rule.value2 ?? 0)
      default: return false
    }
  }

  // Text / generic fields
  const fieldValue = String((track as unknown as Record<string, unknown>)[rule.field] ?? '').toLowerCase()
  const ruleValue = rule.value.toLowerCase()

  switch (rule.operator) {
    case 'is':
    case 'equals':      return fieldValue === ruleValue
    case 'contains':    return fieldValue.includes(ruleValue)
    case 'not_contains': return !fieldValue.includes(ruleValue)
    case 'starts':      return fieldValue.startsWith(ruleValue)
    case 'greater':     return Number(fieldValue) > Number(rule.value)
    case 'less':        return Number(fieldValue) < Number(rule.value)
    case 'between':     return Number(fieldValue) >= Number(rule.value) && Number(fieldValue) <= Number(rule.value2 ?? 0)
    default:            return false
  }
}

export function evaluateSmartPlaylist(
  tracks: Track[],
  rules: SmartPlaylistRule[],
  ruleMatch: 'all' | 'any',
  getPlayCount?: (key: string) => number,
  getTrackTags?: (trackId: string) => string[],
): Track[] {
  const validRules = rules.filter(r => r.value.toString().trim() !== '')
  if (validRules.length === 0) return []
  return tracks.filter(track => {
    const results = validRules.map(rule => matchRule(track, rule, getPlayCount, getTrackTags))
    return ruleMatch === 'all' ? results.every(Boolean) : results.some(Boolean)
  })
}
