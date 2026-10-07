/**
 * GitHub Pages build only. Agri-It used to share its web address (fergtech-ireland.github.io)
 * with Gauntlet; since 7 Oct 2026 it has its own (fergtech-agri-it-ireland.github.io), and this
 * stays as a safety net. Two apps on one address share the phone's offline file store.
 * Gauntlet's service worker clears every offline cache it does not own when it updates,
 * which removes Agri-It's offline copy (records are never touched: they live elsewhere
 * and each app only removes its own keys).
 *
 * So each time Agri-It opens with signal it checks its offline copy is still there,
 * and if it is gone it installs its service worker afresh, which downloads the copy again.
 * Agri-It never deletes anything that belongs to Gauntlet.
 */
export async function repairOfflineCopy(base: string): Promise<'ok' | 'repaired' | 'skipped'> {
  try {
    if (!navigator.onLine || !('serviceWorker' in navigator) || !('caches' in window)) return 'skipped';
    const reg = await navigator.serviceWorker.getRegistration(base);
    if (!reg?.active) return 'skipped'; // first visit: the worker is still installing
    const name = `workbox-precache-v2-${reg.scope}`;
    if (await caches.has(name)) {
      const cache = await caches.open(name);
      if ((await cache.keys()).length > 0) return 'ok';
    }
    // Re-registering the same worker is ignored by the browser, so ask for a fresh install.
    // The new worker downloads the offline copy again; records are not touched.
    await navigator.serviceWorker.register(`${base}sw.js?repair=${Date.now()}`, { scope: base });
    return 'repaired';
  } catch {
    return 'skipped';
  }
}
