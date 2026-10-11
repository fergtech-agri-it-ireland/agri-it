import './lib/demo/safeStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FarmProvider } from './lib/data/farm';
import { IN_BROWSER, IS_LOCAL, IS_ONLINE, key } from './lib/env';
import { startThemeClock } from './lib/theme';
import { repairOfflineCopy } from './lib/offlineHeal';

// The one-file builds are published as hosted pages whose links only keep a bare #, so they route on the hash.
// The online build is on GitHub Pages, which can't answer deep links, so it routes on the hash too.
const Router = IN_BROWSER || IS_ONLINE ? HashRouter : BrowserRouter;

// Cached farm data survives reloads and dead zones: screens open instantly offline.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'offlineFirst', gcTime: 1000 * 60 * 60 * 24 * 7, retry: 1, refetchOnWindowFocus: true }
  }
});
// Bump when the shape of cached farm data changes, so an older cache is thrown away instead of crashing screens.
const CACHE_VERSION = 'v5-review';
const persister = createSyncStoragePersister({ storage: window.localStorage, key: key('cache') });

startThemeClock();
// An older phone app worker (before 11 Oct 2026) answered for the online app's address with the
// phone app. Fetch the new phone worker, which leaves online/ alone, then load the online app.
const PHONE_AT_ONLINE = import.meta.env.MODE === 'pages' && location.pathname.startsWith(`${import.meta.env.BASE_URL}online/`);
if (PHONE_AT_ONLINE) {
  let once = false;
  try { once = sessionStorage.getItem('agri-it:online-hop') === '1'; sessionStorage.setItem('agri-it:online-hop', '1'); } catch { /* ignore */ }
  if (!once) {
    const go = () => location.reload();
    navigator.serviceWorker?.addEventListener('controllerchange', go);
    void navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL).then((r) => r?.update()).catch(() => undefined);
    setTimeout(go, 8000);
  }
}
// The one-file builds can't register a service worker; the normal and GitHub Pages builds can.
if (!IN_BROWSER || import.meta.env.MODE === 'pages') registerSW({ immediate: true });
if (import.meta.env.MODE === 'pages') {
  const heal = () => void repairOfflineCopy(import.meta.env.BASE_URL).then((r) => { (window as unknown as { __offlineRepair?: string }).__offlineRepair = r; });
  window.addEventListener('load', () => setTimeout(heal, 3000));
  window.addEventListener('online', heal);
}
// Phone-only build: the records live only here, so ask the browser not to clear them when space runs low
if (IS_LOCAL) void navigator.storage?.persist?.().catch(() => false);

ReactDOM.createRoot(document.getElementById('root')!).render(PHONE_AT_ONLINE ? <p style={{ padding: 24, fontFamily: 'sans-serif' }}>Opening Agri-It Online…</p> : (
  <React.StrictMode>
    <ErrorBoundary>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7, buster: CACHE_VERSION }}>
      <Router>
        <ToastProvider>
          <FarmProvider>
            <App />
          </FarmProvider>
        </ToastProvider>
      </Router>
    </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
));
