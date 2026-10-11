-- Server reminders schedule: hosted project `agri-it` only (never run on a local stack or in CI).
-- Every 15 minutes pg_cron asks the push-reminders edge function to send whatever reminders
-- are due. The function checks the x-cron-secret header against the vault secret below, so
-- nobody else can make it send.
--
-- Before running this once in the SQL editor (or through the Supabase connector):
--   1. Deploy supabase/functions/push-reminders with verify_jwt = false (it checks its own secret).
--   2. Set the Edge Function secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.
--   3. Store a long random cron secret in the vault (never in the repo):
--        select vault.create_secret('<64 random hex characters>', 'push_cron_secret', 'Agri-It push-reminders cron');
-- Running this file again is safe: cron.schedule replaces a job with the same name.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'agri-it-push-reminders',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://xgudpylxmrlywegpdvps.supabase.co/functions/v1/push-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- To stop server reminders: select cron.unschedule('agri-it-push-reminders');
