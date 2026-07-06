import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the build works at any URL (GitHub Pages serves
  // project sites from /<repo-name>/).
  base: './',
  // Expose the real package.json version to the app (About card in Settings).
  // Declared for TS in src/vite-env.d.ts.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': never auto-reload under the user; src/lib/pwa.ts shows an
      // update bar and applies the new SW only when the user taps Refresh.
      registerType: 'prompt',
      manifest: {
        name: 'Raed Tracker',
        short_name: 'Raed',
        description: 'Track TV shows and movies, episode by episode.',
        display: 'standalone',
        // Relative so the app installs correctly under /raed-tracker/ on
        // GitHub Pages (resolved against the deployed manifest URL).
        start_url: './',
        scope: './',
        background_color: '#1a1a1a',
        theme_color: '#1a1a1a',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // SPA under hash routing: every navigation serves the precached shell.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // TMDB poster/backdrop CDN: immutable images, cache hard.
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              // purgeOnQuotaError: opaque (no-cors) image responses are padded
              // heavily for quota accounting; self-purge this cache instead of
              // letting the browser evict the whole origin's storage.
              expiration: {
                // A 150-show library easily exceeds 300 poster/still/backdrop
                // URLs; too-small caps mean constant re-downloads.
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // TMDB API: serve from cache INSTANTLY and revalidate in the
            // background. NetworkFirst (the old handler) made every request
            // wait up to 4s on the network before touching the cache — the
            // single biggest source of perceived lag. Staleness is bounded
            // (6h) and the background refresh updates the cache for the next
            // render; air-date-sensitive data is re-fetched by the freshness
            // engine anyway.
            urlPattern: /^https:\/\/api\.themoviedb\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'tmdb-api',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 6 * 3600,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase auth + sync must NEVER be served from cache.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
