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
//   (https://fergtech-agri-it-ireland.github.io/agri-it/). Records stay on each phone; no server.
// `--mode online`: the hosted app signed in to Supabase, published next to it at /agri-it/online/
//   as a separate installable app (own manifest id, own service worker scope, own storage names).
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo' || mode === 'phone'; // one self-contained HTML file
  const pages = mode === 'pages';
  const online = mode === 'online';
  // Pages: CI passes the site's path (e.g. '/' for its own address, '/agri-it/' for a project page)
  const pagesBase = (process.env.PAGES_BASE || '/agri-it/').replace(/\/?$/, '/');
  const base = demo ? './' : pages ? pagesBase : online ? `${pagesBase}online/` : '/';
  // The phone app's worker covers its whole folder, which includes online/: it must leave that
  // address alone so the online app (and its own worker) loads there.
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const onlineDeny = pages ? [new RegExp(`^${esc(pagesBase)}online/`)] : [];
  const ns = online ? 'agri-it-online' : 'agri-it';
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
          name: online ? 'Agri-It Online' : 'Agri-It',
          short_name: online ? 'Agri-It Online' : 'Agri-It',
          description: online
            ? 'Feed run-out, cash flow and farm records, kept in your account and shared with your farm'
            : 'Feed run-out, cash flow and farm records in one place',
          theme_color: '#0B7A55',
          background_color: '#F1F4F2',
          display: 'standalone',
          orientation: 'portrait',
          // Fixed app identity. Without one, Chrome on Android left a broken "already installed"
          // record after a failed first install; a new id lets phones install it cleanly.
          id: `${base}app`,
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
          navigateFallbackDenylist: onlineDeny,
          // Daily reminders (periodic sync), notification taps and future web push
          importScripts: ['reminder-sw.js'],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // The photo reader (about 7 MB) is not precached: it is cached the first time it
          // loads (the Record screen warms it up with signal), then reads offline in the yard.
          globIgnores: ['ocr/**'],
          runtimeCaching: [{
            // A RegExp, not a function: a function is copied into the worker as text, where `base` doesn't exist
            urlPattern: new RegExp(`${esc(base)}ocr/`),
            handler: 'CacheFirst',
            options: { cacheName: `${ns}-ocr`, expiration: { maxEntries: 12 } }
          }]
        }
      }),
      ...(demo ? [viteSingleFile()] : [])
    ],
    build: demo
      ? { outDir: mode === 'phone' ? 'dist-phone' : 'dist-demo', emptyOutDir: true }
      : {
          ...(pages ? { outDir: 'dist-pages', emptyOutDir: true } : {}),
          ...(online ? { outDir: 'dist-online', emptyOutDir: true } : {}),
          rollupOptions: {
            output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], supabase: ['@supabase/supabase-js'], query: ['@tanstack/react-query', '@tanstack/react-query-persist-client', '@tanstack/query-sync-storage-persister'] } }
          }
        },
    test: { environment: 'node', include: ['src/**/*.test.ts'] }
  };
});
