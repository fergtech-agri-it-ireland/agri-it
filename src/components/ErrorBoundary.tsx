import { Component, type ErrorInfo, type ReactNode } from 'react';
import { IS_DEMO, IS_LOCAL } from '../lib/env';

/**
 * Last line of defence: if a screen crashes, show a way out instead of a blank page.
 * "Reload" drops only the cached copy of farm data (it is fetched again). Saves still
 * waiting to sync are kept, except in the demo where everything is reset to the seed.
 */
export function clearCachedData() {
  try {
    const s = window.localStorage;
    s.removeItem('agri-it:cache');
    if (IS_DEMO) {
      s.removeItem('agri-it:demo-db');
      s.removeItem('agri-it:outbox');
    }
  } catch { /* storage blocked: nothing cached to clear */ }
  try { window.sessionStorage.removeItem('agri-it:snapshots'); } catch { /* ignore */ }
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Agri-It screen error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-pasture p-6 text-ink">
        <h1 className="text-2xl font-extrabold">Something went wrong on this screen</h1>
        <p className="text-lg">
          {IS_DEMO
            ? 'The demo had data saved from an older version. Reset it to start again on the sample farm.'
            : IS_LOCAL ? 'Your records are safe on this phone. Reloading rebuilds the screens from them.'
            : 'Your records are safe. Reloading fetches a fresh copy of your farm data. Anything waiting to sync is kept.'}
        </p>
        <button
          className="min-h-[3.5rem] rounded-2xl bg-field px-5 text-lg font-bold text-white"
          onClick={() => { clearCachedData(); window.location.hash = '#/'; window.location.reload(); }}>
          {IS_DEMO ? 'Reset demo and reload' : 'Reload'}
        </button>
        <p className="text-sm text-muted">Details: {this.state.error.message}</p>
      </main>
    );
  }
}
