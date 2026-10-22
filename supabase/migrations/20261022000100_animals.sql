-- Animal tags (22 Oct 2026): each animal as its own record, with the tag number from its identity
-- card (the blue card). Cattle tags are 372 and 12 digits (issued since 1 Nov 2016) or IE and 12
-- digits (older); the app checks that shape and stores the tag with no spaces. Agri-It does not
-- know the tag's check digit rule, so the database checks length and form only. Other animals
-- (sheep, pigs, horses) can carry any tag or number the farmer types.
-- Group head counts stay as they are: they drive the feed and silage forecasts. Tagged animals
-- are records on top of the group, not a second count.

create table if not exists public.animals (
  id              uuid primary key default gen_random_uuid(),
  farm_id         uuid not null references public.farms(id) on delete cascade,
  -- No spaces, upper case: 372123456781234 or IE123456781234
  tag_number      text not null check (char_length(tag_number) between 3 and 30 and tag_number = upper(tag_number) and tag_number !~ '\s'),
  -- How it got here: read from a photo of the card (and checked by the farmer), or typed
  tag_source      text not null default 'typed' check (tag_source in ('card_photo', 'typed')),
  animal_group_id uuid references public.animal_groups(id) on delete set null,
  sex             text check (sex in ('female', 'male')),
  breed           text check (breed is null or char_length(breed) between 1 and 60),
  born_on         date,
  status          text not null default 'on_farm' check (status in ('on_farm', 'sold', 'died', 'moved_off')),
  left_on         date,
  note            text check (note is null or char_length(note) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status <> 'on_farm' or left_on is null),
  check (born_on is null or left_on is null or left_on >= born_on)
);
-- A tag number belongs to one animal on a farm
create unique index if not exists animals_tag_one on public.animals (farm_id, tag_number);
create index if not exists animals_farm_group on public.animals (farm_id, animal_group_id);

alter table public.animals enable row level security;
create policy "members read animals" on public.animals for select to authenticated using (public.is_farm_member(farm_id));
create policy "writers insert animals" on public.animals for insert to authenticated with check (public.can_write_farm(farm_id));
create policy "writers update animals" on public.animals for update to authenticated using (public.can_write_farm(farm_id)) with check (public.can_write_farm(farm_id));
create policy "writers remove animals" on public.animals for delete to authenticated using (public.can_write_farm(farm_id));
create trigger animals_touch before update on public.animals for each row execute function public.touch_updated_at();
create trigger animals_audit after insert or update or delete on public.animals for each row execute function public.audit_row();

-- Move my phone data: the animals come across too (after the animal groups they point at)
create or replace function public.import_id_taken(p_table text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_table not in ('suppliers', 'animal_groups', 'head_count_history', 'crops', 'documents', 'feed_products',
                     'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines', 'income',
                     'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs', 'calving_seasons', 'calf_births',
                     'suggestion_decisions', 'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads',
                     'fertiliser_spread_fields', 'loans', 'loan_statements', 'expected_income', 'year_end_values', 'animals') then
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
  v_tables text[] := array['suppliers', 'farm_supplier_settings', 'animal_groups', 'head_count_history', 'animals', 'crops',
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

comment on table public.animals is 'One row per animal the farmer has recorded: tag number (from the animal identity card or typed), group, sex, breed, born, and when it left. Not the official herd register.';
