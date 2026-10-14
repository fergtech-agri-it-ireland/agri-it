-- Fields and fertiliser (14 Oct 2026). src/lib/forecast/fertiliser.ts (fertiliser@1.0),
-- src/lib/spreading.ts (closed periods, with sources and checked dates).
-- * fields: the farm's own fields (name, acres, what they're used for). Spreading is per field.
-- * fertiliser_products: fertiliser and lime the farm keeps in stock.
-- * fertiliser_stock: opening stock, stock checks and deliveries (kg). A delivery's cost is a
--   normal row in costs (category fertiliser, paid or on account), linked by cost_id, so bills,
--   cash and the year-end pack work as for feed. Workers see no money: the price lives only
--   in costs, which they can't read.
-- * fertiliser_spreads + fertiliser_spread_fields: one spreading, on one field or several at
--   once; the kg on each field. Stock = last count or opening + deliveries - spreading since.
-- Nothing here is created for the farmer: every row comes from them saving it.
-- No deletes or drops, so the Supabase connector can apply it.

create table if not exists public.fields (
  id                 uuid primary key default gen_random_uuid(),
  farm_id            uuid not null references public.farms(id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 60),
  acres              numeric(8,2) check (acres > 0 and acres < 10000),
  use                text not null default 'grazing' check (use in ('grazing', 'silage', 'tillage', 'other')),
  -- The farmer's own round: flag the field again this many days after it was last spread
  spread_every_days  smallint check (spread_every_days between 7 and 120),
  -- Silage fields: the day the farmer plans to cut (Teagasc: N on at least 50 days before)
  cut_on             date,
  archived           boolean not null default false,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists fields_farm on public.fields (farm_id);

create table if not exists public.fertiliser_products (
  id             uuid primary key default gen_random_uuid(),
  farm_id        uuid not null references public.farms(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  -- What kind of product it is, from Agri-It's pick list (src/lib/catalogue.ts); null = typed by the farmer
  catalogue_key  text check (catalogue_key is null or char_length(catalogue_key) between 1 and 60),
  supplier_id    uuid references public.suppliers(id) on delete set null,
  -- Warn when stock falls to this (the farmer's own level)
  low_stock_kg   numeric(10,1) check (low_stock_kg >= 0),
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fertiliser_products_farm on public.fertiliser_products (farm_id);

create table if not exists public.fertiliser_stock (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms(id) on delete cascade,
  product_id   uuid not null references public.fertiliser_products(id) on delete cascade,
  kind         text not null check (kind in ('opening', 'delivery', 'count')),
  quantity_kg  numeric(12,1) not null check (quantity_kg >= 0),
  on_date      date not null,
  evidence     text not null default 'measured' check (evidence in ('measured', 'farmer_estimate', 'docket')),
  supplier_id  uuid references public.suppliers(id) on delete set null,
  cost_id      uuid references public.costs(id) on delete set null,
  notes        text check (notes is null or char_length(notes) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists fertiliser_stock_farm on public.fertiliser_stock (farm_id, product_id, on_date);

create table if not exists public.fertiliser_spreads (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms(id) on delete cascade,
  product_id   uuid not null references public.fertiliser_products(id) on delete cascade,
  spread_on    date not null,
  kg_per_acre  numeric(8,1) check (kg_per_acre > 0),
  total_kg     numeric(12,1) not null check (total_kg > 0),
  notes        text check (notes is null or char_length(notes) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists fertiliser_spreads_farm on public.fertiliser_spreads (farm_id, spread_on);

create table if not exists public.fertiliser_spread_fields (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms(id) on delete cascade,
  spread_id   uuid not null references public.fertiliser_spreads(id) on delete cascade,
  field_id    uuid not null references public.fields(id) on delete cascade,
  acres       numeric(8,2) check (acres > 0),
  kg          numeric(12,1) not null check (kg >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (spread_id, field_id)
);
create index if not exists fertiliser_spread_fields_farm on public.fertiliser_spread_fields (farm_id, field_id);

-- Feeds can carry the same pick-list key, so a feed bought by its plain name can be compared
-- with the CSO's national average for that kind of feed.
alter table public.feed_products add column if not exists catalogue_key text
  check (catalogue_key is null or char_length(catalogue_key) between 1 and 60);

do $$
declare t text;
begin
  foreach t in array array['fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads', 'fertiliser_spread_fields'] loop
    execute format('alter table public.%I enable row level security', t);
    -- Spreading and stock are farm work: owner, family and farm worker record them; advisers read them
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_farm_member(farm_id))', t);
    execute format('create policy "writers insert %1$s" on public.%1$I for insert to authenticated with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers update %1$s" on public.%1$I for update to authenticated using (public.can_write_farm(farm_id)) with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers remove %1$s" on public.%1$I for delete to authenticated using (public.can_write_farm(farm_id))', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Move my phone data: the new tables come across too (fields and products before what points at them)
create or replace function public.import_id_taken(p_table text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_table not in ('suppliers', 'animal_groups', 'head_count_history', 'crops', 'documents', 'feed_products',
                     'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines', 'income',
                     'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs', 'calving_seasons', 'calf_births',
                     'suggestion_decisions', 'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads',
                     'fertiliser_spread_fields') then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1)', p_table) into v using p_id;
  return v;
end $$;
revoke all on function public.import_id_taken(text, uuid) from public, anon;
grant execute on function public.import_id_taken(text, uuid) to authenticated;

create or replace function public.import_phone_backup(p_farm_id uuid, p_farm jsonb default '{}', p_rows jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_tables text[] := array['suppliers', 'farm_supplier_settings', 'animal_groups', 'head_count_history', 'crops',
    'documents', 'feed_products', 'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines',
    'income', 'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs',
    'calving_seasons', 'calf_births', 'suggestion_decisions',
    'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads', 'fertiliser_spread_fields'];
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
