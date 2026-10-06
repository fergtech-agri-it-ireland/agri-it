import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';
import { ToastProvider } from './components/Toast';
import { FarmProvider } from './lib/data/farm';

// Cached farm data survives reloads and dead zones: screens open instantly offline.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'offlineFirst', gcTime: 1000 * 60 * 60 * 24 * 7, retry: 1, refetchOnWindowFocus: true }
  }
});
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'agri-it:cache' });

if (localStorage.getItem('agri-it:sunlight') === '1') document.documentElement.classList.add('sunlight');
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7, buster: 'v1' }}>
      <BrowserRouter>
        <ToastProvider>
          <FarmProvider>
            <App />
          </FarmProvider>
        </ToastProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>
);
