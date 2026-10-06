/**
 * Browser side of daily reminders.
 *
 * How a reminder reaches the farmer, best first:
 * 1. App open in the background: a minute clock shows a phone notification at the set time.
 * 2. App closed, installed on Android Chrome: periodic background sync wakes the service
 *    worker (public/reminder-sw.js), which reads the digest saved here and notifies.
 *    The browser decides how often this runs, so it can be late.
 * 3. Any phone: "Add to phone calendar" puts a daily alarm in the phone's own calendar.
 * True push to a closed app on iPhone needs a server (web push), which comes with hosting.
 *
 * Preferences are per phone, like dawn mode. The digest and "already shown" marks live in
 * IndexedDB so the service worker can read them.
 */
import { useEffect, useState } from 'react';
import type { FarmBundle } from './types';
import { IS_DEMO } from './env';
import { todayISO } from './format';
import { buildDigest, parsePrefs, slotDue, type Digest, type ReminderPrefs, type SlotId } from './reminders';

const PREFS_KEY = 'agri-it:reminders';
const EVENT = 'agri-it:reminders';
export const SYNC_TAG = 'agri-it-reminders';
const DB = 'agri-it-reminders';
const STORE = 'kv';

// ---------------------------------------------------------------------------
// Preferences (localStorage, per device)
// ---------------------------------------------------------------------------
export function getPrefs(): ReminderPrefs {
  try { return parsePrefs(localStorage.getItem(PREFS_KEY)); } catch { return parsePrefs(null); }
}
export function setPrefs(p: ReminderPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* won't persist */ }
  window.dispatchEvent(new Event(EVENT));
}
export function useReminderPrefs(): [ReminderPrefs, (p: ReminderPrefs) => void] {
  const [p, set] = useState(getPrefs);
  useEffect(() => {
    const on = () => set(getPrefs());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [p, setPrefs];
}

// ---------------------------------------------------------------------------
// Tiny IndexedDB key/value (shared with the service worker)
// ---------------------------------------------------------------------------
function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    const r = d.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => resolve(undefined);
  });
}
async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ---------------------------------------------------------------------------
// Permission and capability
// ---------------------------------------------------------------------------
export type NotifyState = 'demo' | 'unsupported' | 'default' | 'granted' | 'denied';

export function notifyState(): NotifyState {
  if (IS_DEMO) return 'demo';
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission as NotifyState;
}

/** Ask the phone for permission (must come from a tap), then register background checks. */
export async function enableNotifications(): Promise<NotifyState> {
  const s = notifyState();
  if (s === 'demo' || s === 'unsupported') return s;
  const result = (await Notification.requestPermission()) as NotifyState;
  if (result === 'granted') await registerBackgroundCheck();
  return result;
}

/** Periodic background sync (Chromium, installed app only). Silently does nothing elsewhere. */
export async function registerBackgroundCheck() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const ps = (reg as ServiceWorkerRegistration & { periodicSync?: { register: (tag: string, o: { minInterval: number }) => Promise<void> } })?.periodicSync;
    if (!ps) return;
    const perm = await navigator.permissions?.query({ name: 'periodic-background-sync' as PermissionName }).catch(() => null);
    if (perm && perm.state !== 'granted') return;
    await ps.register(SYNC_TAG, { minInterval: 60 * 60 * 1000 });
  } catch { /* best effort */ }
}

async function show(title: string, body: string) {
  const opts: NotificationOptions = { body, tag: 'agri-it-reminder', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: '/' } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return void (await reg.showNotification(title, opts));
    new Notification(title, opts);
  } catch { /* nothing more we can do */ }
}

// ---------------------------------------------------------------------------
// The clock: saves the digest, and notifies while the app is alive in the background
// ---------------------------------------------------------------------------
export async function checkNow(now = new Date()) {
  const digest = await kvGet<Digest>('digest');
  if (!digest) return;
  const shown = (await kvGet<Partial<Record<SlotId, string>>>('shown')) ?? {};
  const due = slotDue(digest.prefs, now, shown);
  if (!due) return;
  await kvSet('shown', { ...shown, [due.slot]: due.day });
  // The farmer is looking at the app (and so at the checklist): no need to buzz the phone
  if (document.visibilityState === 'visible') return;
  if (notifyState() !== 'granted') return;
  const msg = digest.days.find((d) => d.date === due.day)?.messages[due.slot];
  if (msg) await show(msg.title, msg.body);
}

export function useReminderClock(b: FarmBundle | undefined, urgentToday: string[]) {
  const [prefs] = useReminderPrefs();
  const urgentKey = urgentToday.join('|');
  useEffect(() => {
    if (!b || IS_DEMO) return;
    const digest = buildDigest(b, todayISO(), prefs, urgentToday);
    void kvSet('digest', digest);
  }, [b, prefs, urgentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (IS_DEMO || !(prefs.morning || prefs.evening)) return;
    const tick = () => void checkNow();
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    if (notifyState() === 'granted') void registerBackgroundCheck();
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [prefs]);
}

/** Download the calendar file (works without notification permission, on any phone). */
export function downloadIcs(ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'agri-it-reminders.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
