-- Agri-It Online (11 Oct 2026)
-- 1. Move my phone data to my account: import_phone_backup()
-- 2. Server push for reminders: push_subscriptions and the functions the app and the
--    push-reminders edge function use. The 15-minute schedule itself is created on the hosted
--    project only (supabase/remote/push_schedule.sql), so local stacks never call out.

-- ---------------------------------------------------------------------------
-- 1. Phone backup import
-- ---------------------------------------------------------------------------

-- True when a row with this id exists in one of the import tables, whoever's farm it is in.
-- Says nothing else about the row. Used to tell "already here" from "belongs to another farm".
create or replace function public.import_id_taken(p_table text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_table not in ('suppliers', 'animal_groups', 'head_count_history', 'crops', 'documents', 'feed_products',
                     'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines', 'income',
                     'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs') then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1)', p_table) into v using p_id;
  return v;
end $$;
revoke all on function public.import_id_taken(text, uuid) from public, anon;
grant execute on function public.import_id_taken(text, uuid) to authenticated;

-- Copy a phone backup (planned by src/lib/phoneImport.ts) into a farm the caller owns.
-- Every row keeps its id, dates and paid/owed state; running it again adds nothing.
-- security invoker: row level security applies to every insert, exactly as for typed entries.
-- p_farm: the phone's farm settings (opening cash, financial year, feed settings...).
-- p_rows: { table: [rows] } for the tables in the order below.
create or replace function public.import_phone_backup(p_farm_id uuid, p_farm jsonb default '{}', p_rows jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_tables text[] := array['suppliers', 'farm_supplier_settings', 'animal_groups', 'head_count_history', 'crops',
    'documents', 'feed_products', 'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines',
    'income', 'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs'];
  v_settings text[] := array['enterprises', 'enterprise', 'financial_year_start_month', 'opening_cash_eur',
    'opening_cash_date', 'default_lead_time_days', 'forage_reserve_percent', 'housing_start', 'turnout_date',
    'feed_target_days', 'bill_warning_days', 'order_warning_days'];
  t text; k text; r jsonb; v_cols text[]; v_use text; v_n int; v_here boolean;
  v_added int := 0; v_already int := 0; v_blocked int := 0; v_failed int := 0; v_err text;
  v_by jsonb := '{}';
begin
  if not public.is_farm_owner(p_farm_id) then
    raise exception 'Only the farm owner can move phone records into this farm';
  end if;

  -- Farm settings from the phone (name, county and Eircode stay as set online)
  foreach k in array v_settings loop
    if p_farm ? k then
      execute format('update public.farms set %1$I = (jsonb_populate_record(null::public.farms, $1)).%1$I where id = $2', k)
        using p_farm, p_farm_id;
    end if;
  end loop;

  foreach t in array v_tables loop
    continue when jsonb_typeof(p_rows -> t) is distinct from 'array';
    select array_agg(column_name::text) into v_cols from information_schema.columns
     where table_schema = 'public' and table_name = t and is_generated = 'NEVER' and is_identity = 'NO';
    for r in select value from jsonb_array_elements(p_rows -> t) loop
      r := r || jsonb_build_object('farm_id', p_farm_id);
      select string_agg(quote_ident(c), ', ') into v_use from unnest(v_cols) c where r ? c;
      begin
        execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict do nothing', t, v_use)
          using r;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_added := v_added + 1;
          v_by := jsonb_set(v_by, array[t], to_jsonb(coalesce((v_by ->> t)::int, 0) + 1));
        elsif t <> 'farm_supplier_settings' and (r ? 'id') and public.import_id_taken(t, (r ->> 'id')::uuid) then
          -- Same id: here already (a second run) or in someone else's farm
          execute format('select exists (select 1 from public.%I where id = $1 and farm_id = $2)', t)
            into v_here using (r ->> 'id')::uuid, p_farm_id;
          if v_here then v_already := v_already + 1; else v_blocked := v_blocked + 1; end if;
        else
          v_already := v_already + 1; -- the same day, budget line or supplier setting is already here
        end if;
      exception when others then
        v_failed := v_failed + 1;
        v_err := coalesce(v_err, t || ': ' || sqlerrm);
      end;
    end loop;
  end loop;

  return jsonb_build_object('added', v_added, 'already', v_already, 'blocked', v_blocked,
                            'failed', v_failed, 'firstError', v_err, 'byTable', v_by);
end $$;
revoke all on function public.import_phone_backup(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.import_phone_backup(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Web push subscriptions for reminders
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  farm_id         uuid not null references public.farms(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  time_zone       text not null default 'Europe/Dublin',
  -- The 7-day reminder digest the app built on this phone (times and ready-made words)
  digest          jsonb,
  digest_saved_at timestamptz,
  -- Local day each slot was last sent, e.g. {"morning": "2026-10-11"}
  last_sent       jsonb not null default '{}',
  failures        integer not null default 0,
  user_agent      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);
create index on public.push_subscriptions (farm_id);
create trigger push_subscriptions_touch before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();
alter table public.push_subscriptions enable row level security;
-- People see and remove their own phones' subscriptions; saving goes through the functions below
create policy "own push subscriptions read" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own push subscriptions delete" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Save this phone's subscription for a farm the caller is on. A phone's endpoint belongs to
-- the phone, so if someone else signed in on it before, it moves to whoever is signed in now.
create or replace function public.save_push_subscription(
  p_farm_id uuid, p_endpoint text, p_p256dh text, p_auth text,
  p_time_zone text default 'Europe/Dublin', p_user_agent text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_farm_member(p_farm_id) then raise exception 'Not a member of that farm'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Not a push address'; end if;
  insert into public.push_subscriptions (user_id, farm_id, endpoint, p256dh, auth, time_zone, user_agent)
  values (auth.uid(), p_farm_id, p_endpoint, p_p256dh, p_auth, coalesce(nullif(p_time_zone, ''), 'Europe/Dublin'), left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id, farm_id = excluded.farm_id, p256dh = excluded.p256dh, auth = excluded.auth,
    time_zone = excluded.time_zone, user_agent = excluded.user_agent, failures = 0,
    -- a different person or farm: start again with their own digest
    digest = case when push_subscriptions.user_id = excluded.user_id and push_subscriptions.farm_id = excluded.farm_id then push_subscriptions.digest end,
    last_sent = case when push_subscriptions.user_id = excluded.user_id then push_subscriptions.last_sent else '{}'::jsonb end
  returning id into v_id;
  return v_id;
end $$;

-- The app saves its reminder digest each time it changes (times, words, time zone)
create or replace function public.save_push_digest(p_endpoint text, p_digest jsonb, p_time_zone text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if pg_column_size(p_digest) > 65536 then raise exception 'Reminder digest too large'; end if;
  update public.push_subscriptions
     set digest = p_digest, digest_saved_at = now(), time_zone = coalesce(nullif(p_time_zone, ''), time_zone)
   where endpoint = p_endpoint and user_id = auth.uid();
  return found;
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.save_push_subscription(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.save_push_digest(text, jsonb, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(uuid, text, text, text, text, text),
  public.save_push_digest(text, jsonb, text), public.remove_push_subscription(text) to authenticated;

-- The edge function checks the scheduler's secret against the vault without ever seeing it stored
-- anywhere else. Only the service role (the edge function) can ask.
create or replace function public.push_cron_secret_ok(p_secret text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''push_cron_secret'' limit 1' into v;
  exception when others then
    return false; -- no vault here (plain Postgres test runs)
  end;
  return v is not null and length(p_secret) >= 32 and v = p_secret;
end $$;
revoke all on function public.push_cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.push_cron_secret_ok(text) to service_role;
