-- Set up your farm, loans and the year plan (16 Oct 2026).
-- * farms: the key details a farmer is asked during setup (land, herd number, VAT, accountant,
--   milk buyer) and which setup stages are done or skipped.
-- * routines.interval_months: bills that come every 2, 3, 6 or 12 months (ESB, insurance, rent).
-- * loans, loan_statements: what the farm owes, how it is repaid, and the bank's annual
--   statement (the interest figure the accountant needs). Money tables: workers can't see them.
-- * costs.loan_id, costs.interest_eur: a repayment, and how much of it was interest.
-- * expected_income: scheme payments expected (BISS, Eco, ANC, ACRES...), on published dates.
--   Never income until the farmer says it came in.
-- Nothing here is created for the farmer: every row comes from them saving it.
-- No deletes or drops, so the Supabase connector can apply it.

alter table public.farms add column if not exists herd_number text
  check (herd_number is null or char_length(btrim(herd_number)) between 1 and 20);
alter table public.farms add column if not exists acres_owned numeric(8,2)
  check (acres_owned is null or (acres_owned >= 0 and acres_owned < 100000));
alter table public.farms add column if not exists acres_rented numeric(8,2)
  check (acres_rented is null or (acres_rented >= 0 and acres_rented < 100000));
alter table public.farms add column if not exists vat_status text
  check (vat_status is null or vat_status in ('flat_rate', 'registered'));
alter table public.farms add column if not exists accountant_name text
  check (accountant_name is null or char_length(accountant_name) <= 80);
alter table public.farms add column if not exists accountant_contact text
  check (accountant_contact is null or char_length(accountant_contact) <= 120);
alter table public.farms add column if not exists milk_buyer text
  check (milk_buyer is null or char_length(milk_buyer) <= 80);
alter table public.farms add column if not exists setup jsonb not null default '{}'
  check (jsonb_typeof(setup) = 'object');

alter table public.routines add column if not exists interval_months smallint not null default 1
  check (interval_months between 1 and 12);

create table if not exists public.loans (
  id                  uuid primary key default gen_random_uuid(),
  farm_id             uuid not null references public.farms(id) on delete cascade,
  lender              text not null check (char_length(btrim(lender)) between 1 and 80),
  kind                text not null default 'loan' check (kind in ('loan', 'hire_purchase', 'lease', 'overdraft', 'other')),
  purpose             text check (purpose is null or purpose in ('land', 'buildings', 'machinery', 'stock', 'working_capital', 'other')),
  -- What is owed on balance_on, from the farmer's latest statement
  balance_eur         numeric(12,2) not null check (balance_eur >= 0),
  balance_on          date not null,
  rate_percent        numeric(6,3) check (rate_percent is null or (rate_percent >= 0 and rate_percent <= 50)),
  rate_type           text check (rate_type is null or rate_type in ('fixed', 'variable')),
  repayment_eur       numeric(12,2) check (repayment_eur is null or repayment_eur > 0),
  frequency           text check (frequency is null or frequency in ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  next_due            date,
  -- Months with no repayment (seasonal loans, e.g. nothing from December to March)
  skip_months         smallint[] not null default '{}' check (skip_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  interest_only_until date,
  ends_on             date,
  credit_limit_eur    numeric(12,2) check (credit_limit_eur is null or credit_limit_eur >= 0),
  notes               text check (notes is null or char_length(notes) <= 300),
  archived            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A repaying loan needs an amount, how often, and when the next one is
  check (kind = 'overdraft' or repayment_eur is null or (frequency is not null and next_due is not null))
);
create index if not exists loans_farm on public.loans (farm_id);

create table if not exists public.loan_statements (
  id            uuid primary key default gen_random_uuid(),
  farm_id       uuid not null references public.farms(id) on delete cascade,
  loan_id       uuid not null references public.loans(id) on delete cascade,
  period_end    date not null,
  balance_eur   numeric(12,2) check (balance_eur is null or balance_eur >= 0),
  interest_eur  numeric(12,2) check (interest_eur is null or interest_eur >= 0),
  document_id   uuid references public.documents(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (loan_id, period_end)
);
create index if not exists loan_statements_farm on public.loan_statements (farm_id, loan_id);

alter table public.costs add column if not exists loan_id uuid references public.loans(id) on delete set null;
alter table public.costs add column if not exists interest_eur numeric(12,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'costs_interest_ok') then
    alter table public.costs add constraint costs_interest_ok check (
      interest_eur is null or (interest_eur >= 0 and interest_eur <= amount_eur)
    );
  end if;
end $$;
create index if not exists costs_loan on public.costs (loan_id) where loan_id is not null;

create table if not exists public.expected_income (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms(id) on delete cascade,
  scheme       text not null check (char_length(scheme) between 1 and 40),
  label        text not null check (char_length(btrim(label)) between 1 and 80),
  scheme_year  smallint not null check (scheme_year between 2000 and 2100),
  part         text not null default 'full' check (part in ('advance', 'balance', 'full')),
  amount_eur   numeric(12,2) not null check (amount_eur > 0),
  expected_on  date not null,
  -- The published timing it came from (src/lib/schemes.ts), or null for the farmer's own date
  rule         text check (rule is null or char_length(rule) <= 40),
  income_id    uuid references public.income(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists expected_income_farm on public.expected_income (farm_id, expected_on);

do $$
declare t text;
begin
  foreach t in array array['loans', 'loan_statements', 'expected_income'] loop
    execute format('alter table public.%I enable row level security', t);
    -- Money: owner and family see and write it; advisers read it; farm workers don't see it
    execute format('create policy "money readers read %1$s" on public.%1$I for select to authenticated using (public.can_see_money(farm_id))', t);
    execute format('create policy "money writers insert %1$s" on public.%1$I for insert to authenticated with check (public.can_write_money(farm_id))', t);
    execute format('create policy "money writers update %1$s" on public.%1$I for update to authenticated using (public.can_write_money(farm_id)) with check (public.can_write_money(farm_id))', t);
    execute format('create policy "money writers remove %1$s" on public.%1$I for delete to authenticated using (public.can_write_money(farm_id))', t);
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Move my phone data: the new tables come across too (loans before the repayments that point at them)
create or replace function public.import_id_taken(p_table text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_table not in ('suppliers', 'animal_groups', 'head_count_history', 'crops', 'documents', 'feed_products',
                     'feed_transactions', 'feeding_rules', 'feed_use_logs', 'silage_stores', 'routines', 'income',
                     'costs', 'routine_completions', 'budget_lines', 'farm_records', 'jobs', 'calving_seasons', 'calf_births',
                     'suggestion_decisions', 'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads',
                     'fertiliser_spread_fields', 'loans', 'loan_statements', 'expected_income') then
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
    'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads', 'fertiliser_spread_fields'];
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

comment on table public.loans is 'Loans, hire purchase, leases and overdrafts. Figures are the farmer''s own; Agri-It never quotes a rate.';
comment on table public.loan_statements is 'The bank''s annual loan statement: balance and interest charged for the period.';
comment on table public.expected_income is 'Scheme payments expected on published dates. Not income until it arrives (income_id).';
