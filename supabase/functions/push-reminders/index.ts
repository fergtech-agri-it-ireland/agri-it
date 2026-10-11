/**
 * push-reminders: sends each signed-in farmer's daily reminder as a web push, so it reaches
 * the phone even when Agri-It Online is closed (needed on iPhone, where background checks
 * don't run).
 *
 * - GET  ?key=1  returns the public VAPID key, so the app can subscribe (not a secret).
 * - POST         runs one round of sends. Called every 15 minutes by pg_cron
 *                (supabase/remote/push_schedule.sql) with the header x-cron-secret, which must
 *                match the vault secret `push_cron_secret`. Anyone else gets 401.
 *
 * The words come from the app itself: each time the app opens it saves its 7-day reminder
 * digest to the subscription (save_push_digest), and this sends that day's message at the
 * farmer's chosen time in their time zone (rules in due.ts). It never records anything.
 *
 * Secrets (Edge Function secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 * (mailto: or https: contact). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
 */
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { dueMessage } from './due.ts';

const PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://fergtech-agri-it-ireland.github.io/agri-it/online/';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    return PUBLIC ? json({ publicKey: PUBLIC }) : json({ error: 'Server reminders are not set up yet' }, 503);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = req.headers.get('x-cron-secret') ?? '';
  const { data: allowed } = await admin.rpc('push_cron_secret_ok', { p_secret: secret });
  if (allowed !== true) return json({ error: 'Not allowed' }, 401);
  if (!PUBLIC || !PRIVATE) return json({ error: 'VAPID keys are not set' }, 503);
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);

  const now = new Date();
  const { data: subs, error } = await admin.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, time_zone, digest, last_sent, failures').not('digest', 'is', null);
  if (error) return json({ error: error.message }, 500);

  let sent = 0; let gone = 0; let failed = 0;
  for (const s of subs ?? []) {
    const due = dueMessage(s, now);
    if (!due) continue;
    // Mark first, so a slow or repeated run can't send the same reminder twice
    await admin.from('push_subscriptions').update({ last_sent: { ...(s.last_sent ?? {}), [due.slot]: due.day } }).eq('id', s.id);
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: due.message.title, body: due.message.body, tag: 'agri-it-reminder' }),
        { TTL: 3 * 60 * 60, urgency: 'normal' }
      );
      sent++;
      if (s.failures) await admin.from('push_subscriptions').update({ failures: 0 }).eq('id', s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        // The phone unsubscribed or the app was removed: forget this subscription
        await admin.from('push_subscriptions').delete().eq('id', s.id);
        gone++;
      } else {
        await admin.from('push_subscriptions').update({ failures: (s.failures ?? 0) + 1 }).eq('id', s.id);
        failed++;
      }
    }
  }
  return json({ checked: subs?.length ?? 0, sent, gone, failed });
});
