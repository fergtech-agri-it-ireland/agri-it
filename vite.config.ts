/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

// Normal build: installable, offline-capable PWA (farmers record in the yard with poor signal).
// `--mode demo`: one self-contained HTML file with in-browser sample data, for sharing a preview.
// `--mode phone`: the same one-file build, starting with no farm, keeping the farmer's records on the phone.
// `--mode pages`: the phone-only app as an installable, offline web app for GitHub Pages
//   (https://fergtech-ireland.github.io/agri-it/). Records stay on each phone; no server.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo' || mode === 'phone'; // one self-contained HTML file
  const pages = mode === 'pages';
  const base = demo ? './' : pages ? '/agri-it/' : '/';
  return {
    base,
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [
      react(),
      VitePWA({
        disable: demo,
        registerType: 'autoUpdate',
        includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Agri-It',
          short_name: 'Agri-It',
          description: 'Feed run-out, cash flow and farm records in one place',
          theme_color: '#1D4D36',
          background_color: '#EEF2EE',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          navigateFallback: `${base}index.html`,
          // Daily reminders (periodic sync), notification taps and future web push
          importScripts: ['reminder-sw.js'],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // The photo reader (about 7 MB) is not precached: it is cached the first time it
          // loads (the Record screen warms it up with signal), then reads offline in the yard.
          globIgnores: ['ocr/**'],
          runtimeCaching: [{
            urlPattern: ({ url }) => url.pathname.startsWith(`${base}ocr/`),
            handler: 'CacheFirst',
            options: { cacheName: 'agri-it-ocr', expiration: { maxEntries: 12 } }
          }]
        }
      }),
      ...(demo ? [viteSingleFile()] : [])
    ],
    build: demo
      ? { outDir: mode === 'phone' ? 'dist-phone' : 'dist-demo', emptyOutDir: true }
      : {
          ...(pages ? { outDir: 'dist-pages', emptyOutDir: true } : {}),
          rollupOptions: {
            output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], supabase: ['@supabase/supabase-js'], query: ['@tanstack/react-query', '@tanstack/react-query-persist-client', '@tanstack/query-sync-storage-persister'] } }
          }
        },
    test: { environment: 'node', include: ['src/**/*.test.ts'] }
  };
});
