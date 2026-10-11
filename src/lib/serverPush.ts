/**
 * Server reminders (online build only).
 *
 * The phone's own reminders (reminderClock.ts) need the app alive or Android's background
 * checks. On iPhone, and on any phone where Agri-It Online is closed, only a web push from a
 * server gets through. This module subscribes this phone to the `push-reminders` edge function
 * and keeps the server's copy of the 7-day reminder digest up to date, so the push carries
 * exactly the words the app built (the same message the phone would show). It never records
 * anything.
 *
 * Server side: public.push_subscriptions, save_push_subscription, save_push_digest,
 * remove_push_subscription (migration 20261011000400_online.sql) and
 * supabase/functions/push-reminders.
 */
import { supabase } from './supabase';
import { IS_ONLINE, key } from './env';
import type { Digest } from './reminders';

export type ServerPushState = 'off' | 'on' | 'unsupported' | 'denied' | 'needs-install';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/push-reminders`;
const SAVED_KEY = key('push-digest-hash');

function supported(): boolean {
  return IS_ONLINE && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

/** iPhone only allows web push for an app added to the home screen. */
function isIosBrowserTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)) ?? (await navigator.serviceWorker.ready);
  } catch { return null; }
}

/** Is this phone getting server reminders right now? */
export async function serverPushState(): Promise<ServerPushState> {
  if (!supported()) return isIosBrowserTab() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub ? 'on' : 'off';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function publicKey(): Promise<string> {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  const res = await fetch(`${FN_URL}?key=1`, { headers: { apikey: anon } });
  const body = await res.json().catch(() => ({})) as { publicKey?: string; error?: string };
  if (!res.ok || !body.publicKey) throw new Error(body.error ?? 'Server reminders are not available right now. Try again later.');
  return body.publicKey;
}

const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Dublin'; } catch { return 'Europe/Dublin'; } };

/** Turn on server reminders for this phone (must come from a tap). */
export async function enableServerPush(farmId: string, digest: Digest): Promise<ServerPushState> {
  if (!supported()) return isIosBrowserTab() ? 'needs-install' : 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  if (!reg) throw new Error('Agri-It is still getting ready on this phone. Try again in a moment.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(await publicKey()) as BufferSource });
  }
  const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  const { error } = await supabase.rpc('save_push_subscription', {
    p_farm_id: farmId, p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '',
    p_time_zone: timeZone(), p_user_agent: navigator.userAgent
  });
  if (error) throw new Error(error.message);
  try { localStorage.removeItem(SAVED_KEY); } catch { /* ignore */ }
  await saveDigest(digest, true);
  return 'on';
}

/** Turn server reminders off for this phone. */
export async function disableServerPush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => false);
  }
  try { localStorage.removeItem(SAVED_KEY); } catch { /* ignore */ }
}

/**
 * Send the latest digest to the server when it has changed (and only then). Called by the
 * reminder clock whenever the farm or the times change. Quietly does nothing offline or when
 * this phone isn't subscribed.
 */
export async function saveDigest(digest: Digest, force = false): Promise<void> {
  if (!supported() || !navigator.onLine) return;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  // generatedAt changes every time, so compare what the server actually uses
  const hash = JSON.stringify([digest.prefs, digest.days.map((d) => [d.date, d.messages])]);
  let last: string | null = null;
  try { last = localStorage.getItem(SAVED_KEY); } catch { /* ignore */ }
  if (!force && last === hash) return;
  const { data, error } = await supabase.rpc('save_push_digest', { p_endpoint: sub.endpoint, p_digest: digest, p_time_zone: timeZone() });
  // false: the server no longer has this phone (e.g. someone else signed in on it); the card offers to turn it on again
  if (!error && data === true) { try { localStorage.setItem(SAVED_KEY, hash); } catch { /* ignore */ } }
}
