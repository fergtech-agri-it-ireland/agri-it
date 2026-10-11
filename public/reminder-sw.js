/*
 * Agri-It reminder add-on for the service worker (pulled in with workbox importScripts).
 *
 * The app saves a "digest" in IndexedDB each time it opens: the reminder times and the
 * ready-made message for each of the next 7 days (see src/lib/reminders.ts). When the
 * browser wakes this worker with periodic background sync, it checks whether a reminder
 * time has passed today (within 3 hours) and not yet been shown, and shows it.
 * It never records anything: tapping the notification just opens Today.
 *
 * Also handles web push from the online build's server (edge function `push-reminders`):
 * a push with {title, body, url} is shown as is.
 *
 * The phone app (/agri-it/) and the online app (/agri-it/online/) share a web address, so
 * each worker uses its own database name, worked out from its scope, and opens its own app.
 */
const AGRI_SCOPE = self.registration.scope;
const AGRI_NS = new URL(AGRI_SCOPE).pathname.endsWith('/online/') ? 'agri-it-online' : 'agri-it';
const AGRI_DB = AGRI_NS + '-reminders';
const AGRI_ICON = new URL('icons/icon-192.png', AGRI_SCOPE).href;
/** A window of this app (the phone app's scope also covers online/, which is the other app). */
function agriOwn(c) {
  return c.url.startsWith(AGRI_SCOPE) && (AGRI_NS === 'agri-it-online' || !c.url.startsWith(AGRI_SCOPE + 'online/'));
}
const AGRI_STORE = 'kv';
const AGRI_WINDOW_MIN = 180;

function agriDb() {
  return new Promise((resolve) => {
    const req = indexedDB.open(AGRI_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(AGRI_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
async function agriGet(key) {
  const d = await agriDb();
  if (!d) return undefined;
  return new Promise((resolve) => {
    const r = d.transaction(AGRI_STORE).objectStore(AGRI_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });
}
async function agriSet(key, value) {
  const d = await agriDb();
  if (!d) return;
  return new Promise((resolve) => {
    const tx = d.transaction(AGRI_STORE, 'readwrite');
    tx.objectStore(AGRI_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
function agriLocalDay(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function agriMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

async function agriCheckReminders() {
  const digest = await agriGet('digest');
  if (!digest || !digest.prefs) return;
  const shown = (await agriGet('shown')) || {};
  const now = new Date();
  const day = agriLocalDay(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const slot of ['evening', 'morning']) {
    const t = digest.prefs[slot];
    if (!t || shown[slot] === day) continue;
    const at = agriMinutes(t);
    if (nowMin < at || nowMin >= at + AGRI_WINDOW_MIN) continue;
    await agriSet('shown', Object.assign({}, shown, { [slot]: day }));
    // Don't buzz if Agri-It is open on screen: the checklist is already in front of them
    const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(agriOwn);
    if (clients.some((c) => c.visibilityState === 'visible')) return;
    const today = (digest.days || []).find((d) => d.date === day);
    const msg = today && today.messages && today.messages[slot];
    if (msg) {
      await self.registration.showNotification(msg.title, {
        body: msg.body, tag: 'agri-it-reminder', icon: AGRI_ICON, badge: AGRI_ICON, data: { url: AGRI_SCOPE }
      });
    }
    return;
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'agri-it-reminders') event.waitUntil(agriCheckReminders());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Agri-It';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Open Agri-It to see what is due.', tag: data.tag || 'agri-it-reminder',
    icon: AGRI_ICON, badge: AGRI_ICON, data: { url: data.url ? new URL(data.url, AGRI_SCOPE).href : AGRI_SCOPE }
  }));
});

// The phone app's worker covers /agri-it/ and so also /agri-it/online/. Before 11 Oct 2026 it
// answered that address with the phone app. When this (newer) phone worker takes over, any
// window still showing the phone app at online/ is reloaded, so it loads the online app.
self.addEventListener('activate', (event) => {
  if (AGRI_NS !== 'agri-it') return;
  event.waitUntil((async () => {
    await self.clients.claim();
    const wins = await self.clients.matchAll({ type: 'window' });
    for (const c of wins) {
      if (c.url.startsWith(AGRI_SCOPE + 'online/') && 'navigate' in c) await c.navigate(c.url).catch(() => undefined);
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || AGRI_SCOPE;
  event.waitUntil((async () => {
    // Only this app's own windows (the other app on this address has its own worker)
    const clients = (await self.clients.matchAll({ type: 'window' })).filter(agriOwn);
    for (const c of clients) {
      if ('focus' in c) {
        if ('navigate' in c && url !== AGRI_SCOPE) await c.navigate(url).catch(() => undefined);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
