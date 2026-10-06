/*
 * Agri-It reminder add-on for the service worker (pulled in with workbox importScripts).
 *
 * The app saves a "digest" in IndexedDB each time it opens: the reminder times and the
 * ready-made message for each of the next 7 days (see src/lib/reminders.ts). When the
 * browser wakes this worker with periodic background sync, it checks whether a reminder
 * time has passed today (within 3 hours) and not yet been shown, and shows it.
 * It never records anything: tapping the notification just opens Today.
 *
 * Also handles web push (when a server is added later): a push with {title, body, url}
 * is shown as is.
 */
const AGRI_DB = 'agri-it-reminders';
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
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.some((c) => c.visibilityState === 'visible')) return;
    const today = (digest.days || []).find((d) => d.date === day);
    const msg = today && today.messages && today.messages[slot];
    if (msg) {
      await self.registration.showNotification(msg.title, {
        body: msg.body, tag: 'agri-it-reminder', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: '/' }
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
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if ('focus' in c) {
        if ('navigate' in c && url !== '/') await c.navigate(url).catch(() => undefined);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
