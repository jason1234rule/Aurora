// Stand-in for Electron's preload API so the built renderer (dist/) runs in plain Chromium.
// Used by player-flow.mjs. Library = two generated WAVs served at /music/.
(() => {
  const origin = location.origin
  const tracks = [
    { id: 'ta', path: '/music/a.wav', title: 'Night Drive', artist: 'Test Artist', album: 'Synth Tests', albumArtist: 'Test Artist', track: 1, disc: 1, duration: 90, genre: 'House', year: 2026, coverArt: null, source: 'local' },
    { id: 'tb', path: '/music/b.wav', title: 'Morning Run', artist: 'Other Artist', album: 'Synth Tests', albumArtist: 'Test Artist', track: 2, disc: 1, duration: 90, genre: 'House', year: 2026, coverArt: null, source: 'local' },
  ]
  let transitions = JSON.parse(localStorage.getItem('mock-transitions') || '{}')
  const persist = () => localStorage.setItem('mock-transitions', JSON.stringify(transitions))
  const specific = {
    getSettings: async () => ({ setupComplete: true, normalization: false, volume: 0.8, lastTab: '/' }),
    getLibrary: async () => tracks,
    getFolders: async () => ['/music'],
    getFavorites: async () => ({ ids: [], meta: {} }),
    getTags: async () => ({ trackTags: {}, albumTags: {} }),
    getPlaylists: async () => [],
    getExclusiveStatus: async () => ({ active: false, alsaDevice: '', platform: 'linux' }),
    statsLoad: async () => ({ deviceId: 'mock', events: [] }),
    syncGetConfig: async () => ({ enabled: false, folder: '', syncPlaylists: false, syncFavorites: false, syncStats: false, syncTags: false }),
    themesGetAll: async () => [],
    pluginsGetAll: async () => [],
    getOpenFiles: async () => [],
    getAppVersion: async () => '2.8.0',
    checkForUpdate: async () => null,
    getTransitions: async () => transitions,
    saveTransition: async (t) => {
      for (const [k, v] of Object.entries(transitions)) if (v.id === t.id) delete transitions[k]
      transitions[`${t.from.key}→${t.to.key}`] = t
      persist()
      return transitions
    },
    deleteTransition: async (id) => {
      for (const [k, v] of Object.entries(transitions)) if (v.id === id) delete transitions[k]
      persist()
      return transitions
    },
    getBeatGrid: async () => null,
    saveBeatGrid: async () => {},
    getMediaUrl: (p) => (p.startsWith('http') ? p : origin + p),
    getCoverFileUrl: async () => '',
  }
  window.__mockCalls = []
  window.api = new Proxy(specific, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {}
      if (typeof prop === 'string' && /^(mpris|send|log|minimize|maximize|close|enter|exit|set|resize|remove|relaunch|quit)/.test(prop)) {
        return (...args) => { window.__mockCalls.push(prop); return Promise.resolve() }
      }
      return (...args) => { window.__mockCalls.push(prop); return Promise.resolve(undefined) }
    },
  })
})()
