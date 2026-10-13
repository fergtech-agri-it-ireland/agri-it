-- Automation (13 Oct 2026): calving seasons, calves born, and answers to Agri-It's suggestions.
-- src/lib/season.ts (season-plan@1.0), src/lib/suggestions.ts (suggestions@1.0).
-- Nothing in these tables is created for the farmer: every row comes from them planning a season,
-- recording a calf, or answering a suggestion (done, not now, no).
-- Also: silage density worked out from dry matter (silage-dm@1.1) adds sources S20 and S21.

create table if not exists public.calving_seasons (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references public.farms(id) on delete cascade,
  label            text not null check (length(label) between 1 and 80),
  herd             text not null check (herd in ('dairy', 'suckler')),
  calving_start    date not null,
  calving_end      date,
  cows_due         integer check (cows_due >= 0),
  thin_count       integer check (thin_count >= 0),
  dry_weeks        smallint not null default 8 check (dry_weeks between 4 and 20),
  dry_weeks_thin   smallint not null default 10 check (dry_weeks_thin between 4 and 20),
  milking_group_id uuid references public.animal_groups(id) on delete set null,
  dry_group_id     uuid references public.animal_groups(id) on delete set null,
  calf_group_id    uuid references public.animal_groups(id) on delete set null,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (calving_end is null or calving_end >= calving_start)
);
create index if not exists calving_seasons_farm on public.calving_seasons (farm_id);

create table if not exists public.calf_births (
  id             uuid primary key default gen_random_uuid(),
  farm_id        uuid not null references public.farms(id) on delete cascade,
  season_id      uuid references public.calving_seasons(id) on delete set null,
  born_on        date not null,
  calves         smallint not null default 1 check (calves between 1 and 4),
  calf_group_id  uuid references public.animal_groups(id) on delete set null,
  tagged_on      date,
  registered_on  date,
  notes          text check (length(notes) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (tagged_on is null or tagged_on >= born_on),
  check (registered_on is null or registered_on >= born_on)
);
create index if not exists calf_births_farm on public.calf_births (farm_id, born_on);

create table if not exists public.suggestion_decisions (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms(id) on delete cascade,
  key         text not null check (length(key) between 1 and 400),
  decision    text not null check (decision in ('done', 'snoozed', 'dismissed')),
  until       date,
  decided_at  timestamptz not null default now(),
  decided_by  uuid default auth.uid(),
  check (decision <> 'snoozed' or until is not null)
);
create index if not exists suggestion_decisions_farm on public.suggestion_decisions (farm_id, key);

alter table public.calving_seasons      enable row level security;
alter table public.calf_births          enable row level security;
alter table public.suggestion_decisions enable row level security;

-- Calving work is farm work: owner, family and farm worker record it; advisers read it.
do $$
declare t text;
begin
  foreach t in array array['calving_seasons', 'calf_births', 'suggestion_decisions'] loop
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_farm_member(farm_id))', t);
    execute format('create policy "writers insert %1$s" on public.%1$I for insert to authenticated with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers update %1$s" on public.%1$I for update to authenticated using (public.can_write_farm(farm_id)) with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers remove %1$s" on public.%1$I for delete to authenticated using (public.can_write_farm(farm_id))', t);
  end loop;
  foreach t in array array['calving_seasons', 'calf_births'] loop
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

insert into public.evidence_sources (code, title, publisher, url, published_on, accessed_on) values
('S20', 'Winter feed planning (silage conversion factors, Table 1)', 'DAERA', 'https://www.daera-ni.gov.uk/news/winter-feed-planning', '2017-09-14', '2026-10-13'),
('S21', 'Taking stock of winter forage supplies', 'Irish Farmers Journal', 'https://www.farmersjournal.ie/beef/grass-and-feeding/taking-stock-of-winter-forage-supplies-930599', '2026-09-02', '2026-10-13')
on conflict (code) do nothing;

-- Move my phone data: the new tables come across too (seasons after groups, calves after seasons)
-- Says nothing else about the row. Used to tell "already here" from "belongs to another farm".
create or replace function public.import_id_taken(p_table text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_table not in ('suppliers', 'animal_groups', 'head_count_history', 'crops', 'documents', 'feed_products',
                     'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines', 'income',
                     'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs', 'calving_seasons', 'calf_births',
                     'suggestion_decisions') then
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
    'income', 'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs',
    'calving_seasons', 'calf_births', 'suggestion_decisions'];
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
