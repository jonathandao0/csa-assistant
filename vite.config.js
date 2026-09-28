import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Local proxy so the browser can reach the Nexus API without cross-origin
// problems during development (`npm run dev`) and preview (`npm run preview`).
const nexusProxy = {
  '/nexus-api': {
    target: 'https://frc.nexus',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/nexus-api/, '/api/v1'),
  },
};

export default defineConfig({
  // Relative base so the same build works at the root or at a GitHub Pages sub-path.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'CSA Assistant',
        short_name: 'CSA',
        description: 'Control System Advisor companion for FIRST Robotics Competition events',
        theme_color: '#0B5CAD',
        background_color: '#EDF0F3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Robot photos from TBA media sources, cached for offline use in the venue.
            urlPattern: ({ url, request }) =>
              request.destination === 'image' ||
              /imgur\.com|chiefdelphi\.com|cdninstagram\.com|fbcdn\.net/.test(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'robot-photos',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { host: true, proxy: nexusProxy },
  preview: { proxy: nexusProxy },
});
