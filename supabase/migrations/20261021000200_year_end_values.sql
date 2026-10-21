-- Reports module (21 Oct 2026): the values a farmer or their accountant puts on things at a year end.
-- Agri-It never invents these. Livestock, crops in store, money owed to the farm, machinery,
-- buildings and land are the farmer's figure with the basis they used (cost, market value, deemed
-- cost, the accountant's figure ...). Feed and fertiliser are valued by the app from priced
-- deliveries and are not stored here.

create table if not exists public.year_end_values (
  id                    uuid primary key default gen_random_uuid(),
  farm_id               uuid not null references public.farms(id) on delete cascade,
  kind                  text not null check (kind in ('livestock', 'crops_in_store', 'debtors', 'machinery', 'buildings', 'land', 'other_asset')),
  as_at                 date not null,
  label                 text not null check (char_length(btrim(label)) between 1 and 80),
  animal_group_id       uuid references public.animal_groups(id) on delete set null,
  head_count            integer check (head_count is null or head_count >= 0),
  unit_value_eur        numeric(12,2) check (unit_value_eur is null or unit_value_eur >= 0),
  value_eur             numeric(12,2) not null check (value_eur >= 0),
  basis                 text not null default 'farmer_estimate'
                        check (basis in ('market_value', 'cost', 'net_realisable_value', 'deemed_cost', 'accountant', 'farmer_estimate')),
  -- Deemed cost only: the market value per head it was worked from
  market_unit_value_eur numeric(12,2) check (market_unit_value_eur is null or market_unit_value_eur >= 0),
  note                  text check (note is null or char_length(note) <= 300),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- One value per thing per day: a group, or a labelled item
create unique index if not exists year_end_values_one
  on public.year_end_values (farm_id, as_at, kind, coalesce(animal_group_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(label));
create index if not exists year_end_values_farm on public.year_end_values (farm_id, as_at);

alter table public.year_end_values enable row level security;
-- Money: owner and family see and write it; advisers read it; farm workers don't see it
create policy "money readers read year_end_values" on public.year_end_values for select to authenticated using (public.can_see_money(farm_id));
create policy "money writers insert year_end_values" on public.year_end_values for insert to authenticated with check (public.can_write_money(farm_id));
create policy "money writers update year_end_values" on public.year_end_values for update to authenticated using (public.can_write_money(farm_id)) with check (public.can_write_money(farm_id));
create policy "money writers remove year_end_values" on public.year_end_values for delete to authenticated using (public.can_write_money(farm_id));
create trigger year_end_values_touch before update on public.year_end_values for each row execute function public.touch_updated_at();
create trigger year_end_values_audit after insert or update or delete on public.year_end_values for each row execute function public.audit_row();

-- Move my phone data: the new table comes across too (after the animal groups it points at)
create or replace function public.import_id_taken(p_table text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_table not in ('suppliers', 'animal_groups', 'head_count_history', 'crops', 'documents', 'feed_products',
                     'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines', 'income',
                     'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs', 'calving_seasons', 'calf_births',
                     'suggestion_decisions', 'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads',
                     'fertiliser_spread_fields', 'loans', 'loan_statements', 'expected_income', 'year_end_values') then
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
    'loans', 'loan_statements',
    'income', 'costs', 'expected_income', 'routine_completions', 'budget_lines', 'farm_records', 'jobs',
    'calving_seasons', 'calf_births', 'suggestion_decisions',
    'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads', 'fertiliser_spread_fields',
    'year_end_values'];
  v_settings text[] := array['enterprises', 'enterprise', 'financial_year_start_month', 'opening_cash_eur',
    'opening_cash_date', 'default_lead_time_days', 'forage_reserve_percent', 'housing_start', 'turnout_date',
    'feed_target_days', 'bill_warning_days', 'order_warning_days',
    'herd_number', 'acres_owned', 'acres_rented', 'vat_status', 'accountant_name', 'accountant_contact',
    'milk_buyer', 'setup'];
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

comment on table public.year_end_values is 'Values the farmer or accountant puts on livestock, crops in store, money owed, machinery, buildings and land at a year end, with the basis used. Never made up by Agri-It.';
