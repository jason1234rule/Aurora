import { createRouter, createWebHashHistory } from 'vue-router'

const PERSIST_ROUTES = ['/', '/albums', '/artists', '/soundtracks', '/playlists', '/settings', '/folders', '/favorites', '/stats', '/transitions']

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'songs',
      component: () => import('@/views/SongsView.vue'),
    },
    {
      path: '/albums',
      name: 'albums',
      component: () => import('@/views/AlbumsView.vue'),
    },
    {
      path: '/artists',
      name: 'artists',
      component: () => import('@/views/ArtistsView.vue'),
    },
    {
      path: '/soundtracks',
      name: 'soundtracks',
      component: () => import('@/views/SoundtracksView.vue'),
    },
    {
      path: '/album/:id',
      name: 'album-detail',
      component: () => import('@/views/AlbumDetailView.vue'),
    },
    {
      path: '/artist/:name',
      name: 'artist-detail',
      component: () => import('@/views/ArtistView.vue'),
    },
    {
      path: '/year/:year',
      name: 'year-detail',
      component: () => import('@/views/YearView.vue'),
    },
    {
      path: '/folders',
      name: 'folders',
      component: () => import('@/views/FolderView.vue'),
    },
    {
      path: '/favorites',
      name: 'favorites',
      component: () => import('@/views/FavoritesView.vue'),
    },
    {
      path: '/playlists',
      name: 'playlists',
      component: () => import('@/views/PlaylistsView.vue'),
    },
    {
      path: '/playlist/:id',
      name: 'playlist-detail',
      component: () => import('@/views/PlaylistDetailView.vue'),
    },
    {
      path: '/now-playing',
      name: 'now-playing',
      component: () => import('@/views/NowPlayingView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('@/views/StatsView.vue'),
    },
    {
      path: '/transitions',
      name: 'transitions',
      component: () => import('@/views/TransitionsView.vue'),
    },
    {
      // ?id=<transition id>, or ?from=<track id>&to=<track id> for a new one
      path: '/transition/edit',
      name: 'transition-edit',
      component: () => import('@/views/TransitionEditorView.vue'),
    },
    {
      path: '/lights',
      name: 'lights',
      component: () => import('@/views/LightsView.vue'),
    },
    {
      // ?id=<show id>, or ?track=<track id> for a new one
      path: '/lights/edit',
      name: 'light-edit',
      component: () => import('@/views/LightShowEditorView.vue'),
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('@/views/SearchView.vue'),
    },
    {
      path: '/fullscreen',
      name: 'fullscreen',
      component: () => import('@/views/FullscreenView.vue'),
    },
    {
      path: '/mini',
      name: 'mini',
      component: () => import('@/views/MiniPlayerView.vue'),
    },
  ],
})

// Persist tab on navigation & scroll to top for detail views
router.afterEach((to) => {
  if (PERSIST_ROUTES.includes(to.path)) {
    window.api.mergeSettings({ lastTab: to.path })
  } else {
    // Detail views (album, artist, playlist, now-playing): scroll main to top
    const main = document.querySelector('main')
    if (main) main.scrollTop = 0
  }
})

export default router
