import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createReadStream, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// OCR (pit map from an image) runs Tesseract.js entirely in the browser. Its worker, engine
// and English model are served from this site under tesseract/ rather than a CDN, so OCR
// works offline once used and doesn't depend on third-party hosts. They're ~10 MB, so the
// service worker doesn't precache them (see globIgnores); they're cached on first use.
const TESSERACT_FILES = {
  'tesseract/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
function tesseractAssets() {
  return {
    name: 'tesseract-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const src = TESSERACT_FILES[path];
        if (!src) return next();
        res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        createReadStream(resolve(src)).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(TESSERACT_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(src)) });
      }
    },
  };
}

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
    tesseractAssets(),
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
        globIgnores: ['tesseract/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // OCR engine + language model, cached the first time a pit map image is read.
            urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-engine', expiration: { maxEntries: 10 }, cacheableResponse: { statuses: [0, 200] } },
          },
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
