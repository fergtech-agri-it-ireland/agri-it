-- Agri-It: finish setting up the hosted Supabase project `agri-it` (xgudpylxmrlywegpdvps).
-- Made by scripts/make_remote_setup.py. Paste all of it into the SQL editor and press Run.
-- Safe to run once. Stops at the first error and leaves that step unchanged.
-- Check the project name at the top of the SQL editor says agri-it, not gauntlet.

do $$ begin if exists (select 1 from pg_proc where proname = 'import_phone_backup') then raise exception 'Already set up: nothing to do'; end if; end $$;

-- 1. 20260929000200_security_and_functions.sql (rest: undo, head counts, animal sales, grants)
begin;
-- Undo a delivery (reopens a linked order; linked cost row cascades)
create or replace function public.undo_feed_delivery(p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_order uuid;
begin
  select linked_order_id into v_order from public.feed_transactions where id = p_id and txn_type = 'delivery';
  delete from public.feed_transactions where id = p_id and txn_type = 'delivery';
  if v_order is not null then
    update public.feed_transactions set order_status = 'open' where id = v_order;
  end if;
end $$;

-- Set head count with history (drives feed demand + forage demand)
create or replace function public.set_head_count(
  p_group_id uuid, p_head_count integer, p_reason text default 'manual', p_effective_on date default current_date
) returns void language plpgsql security invoker set search_path = public as $$
declare v_farm uuid;
begin
  if p_head_count < 0 then raise exception 'Head count cannot be negative'; end if;
  update public.animal_groups
     set head_count = p_head_count, head_count_updated_at = now()
   where id = p_group_id
  returning farm_id into v_farm;
  if v_farm is null then raise exception 'Group not found'; end if;
  insert into public.head_count_history (farm_id, animal_group_id, head_count, effective_on, reason)
  values (v_farm, p_group_id, p_head_count, p_effective_on, p_reason);
end $$;

-- Animal sale: income + head count + feed demand in one step
create or replace function public.record_animal_sale(
  p_id uuid, p_farm_id uuid, p_group_id uuid, p_head_count integer,
  p_amount_eur numeric, p_occurred_on date, p_counterparty text default null,
  p_reduce_group boolean default true
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_current integer; v_name text;
begin
  if exists (select 1 from public.income where id = p_id) then return p_id; end if;
  if p_head_count is null or p_head_count <= 0 then raise exception 'Enter how many were sold'; end if;
  select head_count, name into v_current, v_name from public.animal_groups where id = p_group_id and farm_id = p_farm_id;
  if v_current is null then raise exception 'Group not found'; end if;

  insert into public.income (id, farm_id, income_type, occurred_on, amount_eur, counterparty,
                             animal_group_id, head_count, description)
  values (p_id, p_farm_id, 'livestock', p_occurred_on, p_amount_eur, p_counterparty,
          p_group_id, p_head_count, p_head_count || ' sold from ' || v_name);

  if p_reduce_group then
    perform public.set_head_count(p_group_id, greatest(0, v_current - p_head_count), 'sale', p_occurred_on);
  end if;
  return p_id;
end $$;

create or replace function public.undo_animal_sale(p_income_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_group uuid; v_n integer; v_current integer;
begin
  select animal_group_id, head_count into v_group, v_n from public.income
   where id = p_income_id and income_type = 'livestock';
  delete from public.income where id = p_income_id;
  if v_group is not null and v_n is not null then
    select head_count into v_current from public.animal_groups where id = v_group;
    perform public.set_head_count(v_group, v_current + v_n, 'sale undone', current_date);
  end if;
end $$;

grant execute on function public.create_farm, public.record_feed_delivery, public.undo_feed_delivery,
  public.set_head_count, public.record_animal_sale, public.undo_animal_sale,
  public.is_farm_member, public.can_write_farm, public.is_farm_owner to authenticated;
commit;

-- 2. 20261006000100_feed_target.sql
begin;
-- Farmer-set comfort level for bought-in feed, in days of cover.
-- Drives the Feed dial on Today. It is the farmer's own target, never a recommendation.
alter table public.farms
  add column feed_target_days smallint not null default 30
  check (feed_target_days between 1 and 180);
commit;

-- 2. 20261006000200_routines.sql
begin;
-- Routines: recurring farm work that the farmer ticks off.
-- Reminder model (like accounting "reminder" transactions): nothing is recorded until the
-- farmer confirms it, and the amount can be changed or the occurrence skipped.

create type public.routine_kind as enum ('expense', 'income', 'job', 'count', 'order', 'silage');
create type public.routine_frequency as enum ('daily', 'weekly', 'monthly', 'every_n_days');
create type public.completion_status as enum ('done', 'skipped');
create type public.feed_log_status as enum ('fed', 'changed', 'skipped');

create table public.routines (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references public.farms(id) on delete cascade,
  kind             public.routine_kind not null,
  title            text not null,
  frequency        public.routine_frequency not null,
  interval_days    smallint check (interval_days between 1 and 366),   -- every_n_days
  weekday          smallint check (weekday between 0 and 6),           -- weekly, 0 = Sunday
  day_of_month     smallint check (day_of_month between 1 and 31),     -- monthly; past month end = last day
  start_date       date not null default current_date,
  end_date         date,
  amount           numeric(12,2) check (amount >= 0),  -- € (expense/income), kg (order), tonnes (silage)
  category         text,            -- cost_category or income_type
  counterparty     text,            -- payee or payer
  feed_product_id  uuid references public.feed_products(id) on delete cascade,
  silage_store_id  uuid references public.silage_stores(id) on delete cascade,
  supplier_id      uuid references public.suppliers(id) on delete set null,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (frequency <> 'every_n_days' or interval_days is not null),
  check (frequency <> 'weekly' or weekday is not null),
  check (frequency <> 'monthly' or day_of_month is not null),
  check (kind not in ('count', 'order') or feed_product_id is not null),
  check (kind <> 'silage' or silage_store_id is not null)
);
create index on public.routines (farm_id);

create table public.routine_completions (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms(id) on delete cascade,
  routine_id   uuid not null references public.routines(id) on delete cascade,
  due_date     date not null,
  status       public.completion_status not null,
  amount       numeric(12,2),           -- what actually happened (€, kg, t)
  record_table text,                    -- costs | income | feed_transactions, when a record was created
  record_id    uuid,
  done_on      date not null default current_date,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (routine_id, due_date)
);
create index on public.routine_completions (farm_id, due_date);

-- Confirmed daily feeding: actual amounts replace the plan in the stock ledger.
create table public.feed_use_logs (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references public.farms(id) on delete cascade,
  feeding_rule_id  uuid not null references public.feeding_rules(id) on delete cascade,
  feed_product_id  uuid not null references public.feed_products(id) on delete cascade,
  animal_group_id  uuid not null references public.animal_groups(id) on delete cascade,
  used_on          date not null,
  planned_kg       numeric(10,2) not null check (planned_kg >= 0),
  actual_kg        numeric(10,2) not null check (actual_kg >= 0),
  status           public.feed_log_status not null,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (feeding_rule_id, used_on),
  check (status <> 'skipped' or actual_kg = 0)
);
create index on public.feed_use_logs (feed_product_id, used_on);

-- Per feeding rule: show it on Today's checklist to tick off each day.
alter table public.feeding_rules add column confirm_daily boolean not null default true;

alter table public.routines            enable row level security;
alter table public.routine_completions enable row level security;
alter table public.feed_use_logs       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['routines', 'routine_completions', 'feed_use_logs'] loop
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_farm_member(farm_id))', t);
    execute format('create policy "writers insert %1$s" on public.%1$I for insert to authenticated with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers update %1$s" on public.%1$I for update to authenticated using (public.can_write_farm(farm_id)) with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers delete %1$s" on public.%1$I for delete to authenticated using (public.can_write_farm(farm_id))', t);
  end loop;
end $$;
commit;

-- 2. 20261007000100_farm_types.sql
begin;
-- Farms are rarely one thing. A farm can be dairy and sheep and tillage at once, so the
-- farm keeps a list of enterprises. The old single `enterprise` column stays for older
-- clients and reports: it is 'mixed' when the list holds more than one.
alter table public.farms
  add column enterprises text[] not null default '{}'
  check (enterprises <@ array['dairy', 'suckler', 'beef', 'calf_rearing', 'sheep', 'tillage', 'pigs', 'poultry', 'horses', 'goats', 'other']::text[]);

update public.farms set enterprises = case
  when enterprise = 'mixed' then array['dairy', 'suckler']
  else array[enterprise::text]
end;

-- Animal classes farmers actually use. Teagasc allowances exist only for some of them;
-- forage planning asks for a figure for the rest and never assumes one.
-- (New enum values are not used again in this file, so this is safe in one transaction.)
alter type public.animal_class add value if not exists 'heifer' after 'in_calf_heifer';
alter type public.animal_class add value if not exists 'bullock' after 'store_cattle';
alter type public.animal_class add value if not exists 'ram' after 'lamb';
alter type public.animal_class add value if not exists 'hogget' after 'ram';
alter type public.animal_class add value if not exists 'goat' before 'other';
alter type public.animal_class add value if not exists 'pig' before 'other';
alter type public.animal_class add value if not exists 'poultry' before 'other';
alter type public.animal_class add value if not exists 'horse' before 'other';

-- Breed is the farmer's own words (pick from a list or type it), so it is free text.
alter table public.animal_groups
  add column breed text check (breed is null or char_length(breed) between 1 and 60);

-- Tillage money: grain and straw sales, seed and sprays.
alter type public.income_type add value if not exists 'crop' after 'livestock';
alter type public.cost_category add value if not exists 'seed_sprays' after 'fertiliser';

-- Tillage crops: what is sown, how many acres, for which harvest.
create table public.crops (
  id            uuid primary key default gen_random_uuid(),
  farm_id       uuid not null references public.farms(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  variety       text check (variety is null or char_length(variety) <= 60),
  acres         numeric(8,2) check (acres > 0),
  harvest_year  smallint not null check (harvest_year between 2000 and 2100),
  sown_on       date,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index on public.crops (farm_id);
alter table public.crops enable row level security;
create policy "members read crops" on public.crops for select to authenticated using (public.is_farm_member(farm_id));
create policy "writers insert crops" on public.crops for insert to authenticated with check (public.can_write_farm(farm_id));
create policy "writers update crops" on public.crops for update to authenticated using (public.can_write_farm(farm_id)) with check (public.can_write_farm(farm_id));
create policy "writers delete crops" on public.crops for delete to authenticated using (public.can_write_farm(farm_id));

-- create_farm now takes the list. The single enterprise is worked out from it.
drop function if exists public.create_farm(text, text, text, public.jurisdiction, public.enterprise_type, smallint);
create or replace function public.create_farm(
  p_name text, p_county text, p_eircode text default null,
  p_jurisdiction public.jurisdiction default 'ROI',
  p_enterprises text[] default '{}',
  p_default_lead_time_days smallint default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_list text[] := coalesce(p_enterprises, '{}');
  v_one public.enterprise_type;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  v_one := case
    when cardinality(v_list) > 1 then 'mixed'
    when cardinality(v_list) = 0 then 'other'
    when v_list[1] in ('dairy', 'suckler', 'beef', 'sheep', 'tillage') then v_list[1]::public.enterprise_type
    else 'other'
  end;
  insert into public.farms (name, county, eircode, jurisdiction, enterprise, enterprises, default_lead_time_days, created_by)
  values (trim(p_name), p_county, nullif(upper(trim(p_eircode)), ''), p_jurisdiction, v_one, v_list, p_default_lead_time_days, auth.uid())
  returning id into v_id;
  insert into public.farm_members (farm_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;
grant execute on function public.create_farm(text, text, text, public.jurisdiction, text[], smallint) to authenticated;
commit;

-- 2. 20261011000100_review_enums.sql
begin;
-- New enum values for the review fixes (Oct 2026). Kept in their own migration because a
-- new enum value cannot be used in the same transaction that adds it.

-- Loans and capital purchases are cash going out but not running costs of the farm.
alter type public.cost_category add value if not exists 'loan_repayment' after 'other';
alter type public.cost_category add value if not exists 'capital' after 'loan_repayment';

-- A farm worker can record feeding, deliveries and jobs but does not see the farm's money.
alter type public.member_role add value if not exists 'worker' after 'member';

-- A routine occurrence put off to another day ("move to tomorrow").
alter type public.completion_status add value if not exists 'moved';
commit;

-- 2. 20261011000200_review_fixes.sql
begin;
-- Review fixes (third-party product review, 8 Oct 2026).
--
-- 1. Order, delivery, invoice and payment are separate events: costs carry a payment
--    status, paid and due dates, the invoice number and VAT. Cash moves on the paid date.
-- 2. Part deliveries leave an order open for what is still to come.
-- 3. Head counts are dated: each change keeps the count it replaced, the group's current
--    count is the one in force today, and animals can be moved between groups.
-- 4. Missed routines can be moved to another day; jobs can be taken off the list.
-- 5. Every editable row has updated_at, so an offline edit can tell when someone else
--    changed the same record in the meantime.
-- 6. Shared access: farm workers (no money), invitations, and an audit trail.
-- 7. Per-farm alert settings and enterprise tags on income and costs.

-- ---------------------------------------------------------------------------
-- 1. Bills
-- ---------------------------------------------------------------------------
alter table public.costs
  add column payment_status text not null default 'paid' check (payment_status in ('paid', 'owed')),
  add column paid_on        date,
  add column due_on         date,
  add column invoice_ref    text check (invoice_ref is null or char_length(invoice_ref) <= 60),
  add column vat_eur        numeric(12,2) check (vat_eur is null or vat_eur >= 0),
  add column enterprise     text,
  add column updated_at     timestamptz not null default now();

-- Everything recorded before today was entered as paid on the day it happened
update public.costs set paid_on = occurred_on where paid_on is null;

-- Keep paid_on and payment_status in step whatever the client sends: a paid cost always
-- has a paid date (the day it happened, unless given), an owed one never does.
create or replace function public.costs_payment_dates() returns trigger
language plpgsql as $$
begin
  if new.payment_status = 'owed' then
    new.paid_on := null;
  elsif new.paid_on is null then
    new.paid_on := new.occurred_on;
  end if;
  return new;
end $$;
create trigger costs_payment_dates before insert or update on public.costs
  for each row execute function public.costs_payment_dates();
create index on public.costs (farm_id, payment_status);

alter table public.income
  add column enterprise text,
  add column updated_at timestamptz not null default now();

do $$
declare t text;
begin
  foreach t in array array['costs', 'income'] loop
    execute format($f$alter table public.%1$I add constraint %1$s_enterprise_check check (enterprise is null or enterprise in
      ('dairy', 'suckler', 'beef', 'calf_rearing', 'sheep', 'tillage', 'pigs', 'poultry', 'horses', 'goats', 'other'))$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Alert settings
-- ---------------------------------------------------------------------------
alter table public.farms
  add column bill_warning_days  smallint not null default 7 check (bill_warning_days between 0 and 60),
  add column order_warning_days smallint not null default 7 check (order_warning_days between 0 and 60);

-- ---------------------------------------------------------------------------
-- 3. Dated head counts
-- ---------------------------------------------------------------------------
alter table public.head_count_history add column previous_count integer check (previous_count is null or previous_count >= 0);

-- Head count in force on a day: the latest change on or before it; before the first change,
-- the count it replaced; with no history, the group's own count.
create or replace function public.heads_on(p_group_id uuid, p_day date)
returns integer language sql stable security invoker set search_path = public as $$
  select coalesce(
    (select h.head_count from public.head_count_history h
      where h.animal_group_id = p_group_id and h.effective_on <= p_day
      order by h.effective_on desc, h.created_at desc limit 1),
    (select h.previous_count from public.head_count_history h
      where h.animal_group_id = p_group_id
      order by h.effective_on, h.created_at limit 1),
    (select g.head_count from public.animal_groups g where g.id = p_group_id)
  );
$$;

-- Set a head count from a date. A future date changes the forecast from that day only;
-- the group's current count is always the one in force today.
drop function if exists public.set_head_count(uuid, integer, text, date);
create or replace function public.set_head_count(
  p_group_id uuid, p_head_count integer, p_reason text default 'manual', p_effective_on date default current_date,
  p_id uuid default null
) returns void language plpgsql security invoker set search_path = public as $$
declare v_farm uuid; v_before integer; v_now integer;
begin
  if p_head_count < 0 then raise exception 'Head count cannot be negative'; end if;
  if p_id is not null and exists (select 1 from public.head_count_history where id = p_id) then return; end if;
  select farm_id into v_farm from public.animal_groups where id = p_group_id;
  if v_farm is null then raise exception 'Group not found'; end if;
  v_before := public.heads_on(p_group_id, p_effective_on);
  insert into public.head_count_history (id, farm_id, animal_group_id, head_count, previous_count, effective_on, reason)
  values (coalesce(p_id, gen_random_uuid()), v_farm, p_group_id, p_head_count, v_before, p_effective_on, p_reason);
  v_now := public.heads_on(p_group_id, current_date);
  update public.animal_groups set head_count = v_now, head_count_updated_at = now() where id = p_group_id;
end $$;

-- Move animals from one group to another on a day: both counts change together.
create or replace function public.move_animals(
  p_id uuid, p_farm_id uuid, p_from uuid, p_to uuid, p_count integer, p_effective_on date default current_date
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_from integer; v_to integer; v_from_name text; v_to_name text;
begin
  if exists (select 1 from public.head_count_history where id = p_id) then return p_id; end if;
  if p_from = p_to then raise exception 'Pick two different groups'; end if;
  if p_count is null or p_count <= 0 then raise exception 'Enter how many to move'; end if;
  select name into v_from_name from public.animal_groups where id = p_from and farm_id = p_farm_id;
  select name into v_to_name from public.animal_groups where id = p_to and farm_id = p_farm_id;
  if v_from_name is null or v_to_name is null then raise exception 'Group not found'; end if;
  v_from := public.heads_on(p_from, p_effective_on);
  v_to := public.heads_on(p_to, p_effective_on);
  if p_count > v_from then raise exception '% only has % head on that day', v_from_name, v_from; end if;
  perform public.set_head_count(p_from, v_from - p_count, 'moved to ' || v_to_name, p_effective_on, p_id);
  perform public.set_head_count(p_to, v_to + p_count, 'moved from ' || v_from_name, p_effective_on);
  return p_id;
end $$;

-- Sales take the animals off from the sale date, using the count in force that day
create or replace function public.record_animal_sale(
  p_id uuid, p_farm_id uuid, p_group_id uuid, p_head_count integer,
  p_amount_eur numeric, p_occurred_on date, p_counterparty text default null,
  p_reduce_group boolean default true
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_name text; v_then integer;
begin
  if exists (select 1 from public.income where id = p_id) then return p_id; end if;
  if p_head_count is null or p_head_count <= 0 then raise exception 'Enter how many were sold'; end if;
  select name into v_name from public.animal_groups where id = p_group_id and farm_id = p_farm_id;
  if v_name is null then raise exception 'Group not found'; end if;
  insert into public.income (id, farm_id, income_type, occurred_on, amount_eur, counterparty, animal_group_id, head_count, description)
  values (p_id, p_farm_id, 'livestock', p_occurred_on, p_amount_eur, p_counterparty, p_group_id, p_head_count, p_head_count || ' sold from ' || v_name);
  if p_reduce_group then
    v_then := public.heads_on(p_group_id, p_occurred_on);
    perform public.set_head_count(p_group_id, greatest(0, v_then - p_head_count), 'sale', p_occurred_on);
  end if;
  return p_id;
end $$;

create or replace function public.undo_animal_sale(p_income_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_group uuid; v_n integer; v_on date; v_then integer;
begin
  select animal_group_id, head_count, occurred_on into v_group, v_n, v_on from public.income
   where id = p_income_id and income_type = 'livestock';
  delete from public.income where id = p_income_id;
  if v_group is not null and v_n is not null then
    v_then := public.heads_on(v_group, v_on);
    perform public.set_head_count(v_group, v_then + v_n, 'sale undone', v_on);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Routines and jobs that stay until dealt with
-- ---------------------------------------------------------------------------
alter table public.routine_completions add column moved_to date;
alter table public.routine_completions add constraint moved_has_date check (status::text <> 'moved' or moved_to is not null);
alter table public.jobs add column dismissed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. updated_at everywhere a farmer can edit, for offline conflict checks
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['animal_groups', 'feed_products', 'feed_transactions', 'feeding_rules', 'silage_stores',
                           'budget_lines', 'farm_records', 'jobs', 'routines', 'crops', 'documents'] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
  end loop;
  foreach t in array array['animal_groups', 'feed_products', 'feed_transactions', 'feeding_rules', 'silage_stores',
                           'budget_lines', 'farm_records', 'jobs', 'routines', 'crops', 'documents', 'costs', 'income'] loop
    execute format('create trigger %1$s_touch before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Roles: workers record farm work but don't see money
-- ---------------------------------------------------------------------------
create or replace function public.member_role_of(p_farm_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role::text from public.farm_members m where m.farm_id = p_farm_id and m.user_id = auth.uid();
$$;

-- Owner, family/partner and farm worker can record farm work; advisers only read
create or replace function public.can_write_farm(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members m
                 where m.farm_id = p_farm_id and m.user_id = auth.uid()
                   and m.role::text in ('owner', 'member', 'worker'));
$$;

-- Money: owner and family/partner see and write it; advisers see it; workers don't
create or replace function public.can_see_money(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members m
                 where m.farm_id = p_farm_id and m.user_id = auth.uid()
                   and m.role::text in ('owner', 'member', 'advisor'));
$$;
create or replace function public.can_write_money(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members m
                 where m.farm_id = p_farm_id and m.user_id = auth.uid()
                   and m.role::text in ('owner', 'member'));
$$;

do $$
declare t text;
begin
  foreach t in array array['costs', 'income', 'budget_lines'] loop
    execute format('drop policy if exists "members read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "writers insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "writers update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "writers delete %1$s" on public.%1$I', t);
    execute format('create policy "money readers read %1$s" on public.%1$I for select to authenticated using (public.can_see_money(farm_id))', t);
    execute format('create policy "money writers insert %1$s" on public.%1$I for insert to authenticated with check (public.can_write_money(farm_id))', t);
    execute format('create policy "money writers update %1$s" on public.%1$I for update to authenticated using (public.can_write_money(farm_id)) with check (public.can_write_money(farm_id))', t);
    execute format('create policy "money writers delete %1$s" on public.%1$I for delete to authenticated using (public.can_write_money(farm_id))', t);
  end loop;
end $$;

-- People on a farm, with the email they signed in with (auth.users is not readable by clients)
alter table public.farm_members add column email text;
update public.farm_members m set email = u.email from auth.users u where u.id = m.user_id and m.email is null;

create or replace function public.create_farm(
  p_name text, p_county text, p_eircode text default null,
  p_jurisdiction public.jurisdiction default 'ROI',
  p_enterprises text[] default '{}',
  p_default_lead_time_days smallint default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_list text[] := coalesce(p_enterprises, '{}');
  v_one public.enterprise_type;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  v_one := case
    when cardinality(v_list) > 1 then 'mixed'
    when cardinality(v_list) = 0 then 'other'
    when v_list[1] in ('dairy', 'suckler', 'beef', 'sheep', 'tillage') then v_list[1]::public.enterprise_type
    else 'other'
  end;
  insert into public.farms (name, county, eircode, jurisdiction, enterprise, enterprises, default_lead_time_days, created_by)
  values (trim(p_name), p_county, nullif(upper(trim(p_eircode)), ''), p_jurisdiction, v_one, v_list, p_default_lead_time_days, auth.uid())
  returning id into v_id;
  insert into public.farm_members (farm_id, user_id, role, email)
  values (v_id, auth.uid(), 'owner', (select email from auth.users where id = auth.uid()));
  return v_id;
end $$;

-- Invitations: the owner invites by email and role; the person accepts once signed in
-- with that email. The link carries a random token; it expires after 14 days.
create table public.farm_invites (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms(id) on delete cascade,
  email       text not null check (position('@' in email) > 1),
  role        public.member_role not null check (role::text <> 'owner'),
  token       text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid
);
create index on public.farm_invites (farm_id);
alter table public.farm_invites enable row level security;
create policy "owner sees invites" on public.farm_invites for select to authenticated using (public.is_farm_owner(farm_id));
create policy "owner cancels invites" on public.farm_invites for delete to authenticated using (public.is_farm_owner(farm_id));
-- inserts go through create_farm_invite, acceptance through accept_farm_invite

create or replace function public.create_farm_invite(p_farm_id uuid, p_email text, p_role public.member_role)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.is_farm_owner(p_farm_id) then raise exception 'Only the farm owner can invite people'; end if;
  if p_role::text = 'owner' then raise exception 'A farm has one owner'; end if;
  insert into public.farm_invites (farm_id, email, role, created_by)
  values (p_farm_id, lower(trim(p_email)), p_role, auth.uid())
  returning token into v_token;
  return v_token;
end $$;

create or replace function public.accept_farm_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv public.farm_invites; v_email text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v_inv from public.farm_invites where token = p_token;
  if v_inv.id is null then raise exception 'That invitation was not found'; end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = auth.uid() then return v_inv.farm_id; end if;
    raise exception 'That invitation was already used';
  end if;
  if v_inv.expires_at < now() then raise exception 'That invitation has expired. Ask for a new one'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if lower(v_email) <> v_inv.email then raise exception 'That invitation is for %. Sign in with that email', v_inv.email; end if;
  insert into public.farm_members (farm_id, user_id, role, email) values (v_inv.farm_id, auth.uid(), v_inv.role, v_email)
  on conflict (farm_id, user_id) do update set role = excluded.role;
  update public.farm_invites set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.farm_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6b. Audit trail: who created, changed or removed a record, and when
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id               bigint generated always as identity primary key,
  farm_id          uuid not null references public.farms(id) on delete cascade,
  table_name       text not null,
  row_id           uuid not null,
  action           text not null check (action in ('insert', 'update', 'delete')),
  changed_by       uuid default auth.uid(),
  changed_by_label text,
  changed_at       timestamptz not null default now(),
  old_row          jsonb,
  new_row          jsonb
);
create index on public.audit_log (farm_id, changed_at desc);
create index on public.audit_log (row_id);
alter table public.audit_log enable row level security;
-- Owners and advisers read the trail (it includes money); nobody writes it directly
create policy "owner and adviser read audit" on public.audit_log for select to authenticated
  using (public.member_role_of(farm_id) in ('owner', 'advisor'));

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_row jsonb;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old) - 'updated_at'; end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new) - 'updated_at'; end if;
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  v_row := coalesce(v_new, v_old);
  -- A whole farm being deleted takes its trail with it
  if not exists (select 1 from public.farms where id = (v_row->>'farm_id')::uuid) then return coalesce(new, old); end if;
  insert into public.audit_log (farm_id, table_name, row_id, action, changed_by, changed_by_label, old_row, new_row)
  values ((v_row->>'farm_id')::uuid, tg_table_name, (v_row->>'id')::uuid, lower(tg_op), auth.uid(),
          coalesce((select email from public.farm_members where user_id = auth.uid() and farm_id = (v_row->>'farm_id')::uuid), 'Agri-It'),
          v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['costs', 'income', 'feed_transactions', 'animal_groups', 'feeding_rules', 'documents',
                           'farm_records', 'budget_lines', 'jobs', 'feed_products', 'silage_stores'] loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1b/2. Deliveries: paid now or on account; part deliveries keep the order open
-- ---------------------------------------------------------------------------
drop function if exists public.record_feed_delivery(uuid, uuid, uuid, numeric, date, uuid, date, numeric, numeric, public.evidence_source, uuid, uuid, text);
create or replace function public.record_feed_delivery(
  p_id uuid,
  p_farm_id uuid,
  p_feed_product_id uuid,
  p_quantity_kg numeric,
  p_delivery_date date,
  p_supplier_id uuid default null,
  p_order_date date default null,
  p_total_price_eur numeric default null,
  p_price_per_tonne_eur numeric default null,
  p_evidence public.evidence_source default 'confirmed_docket',
  p_linked_order_id uuid default null,
  p_document_id uuid default null,
  p_notes text default null,
  -- 'paid' = paid on delivery (older clients send nothing, which is what they did);
  -- 'account' = owed to the supplier until the invoice is paid
  p_payment text default 'paid',
  p_due_on date default null,
  -- true = nothing more is coming on the linked order; false = more to come
  p_close_order boolean default true
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_total numeric := p_total_price_eur;
  v_ppt   numeric := p_price_per_tonne_eur;
  v_product text;
  v_supplier_name text;
  v_ordered numeric;
  v_delivered numeric;
begin
  if exists (select 1 from public.feed_transactions where id = p_id) then
    return p_id; -- already synced
  end if;
  if p_quantity_kg is null or p_quantity_kg <= 0 then
    raise exception 'Quantity must be more than zero';
  end if;
  if p_payment not in ('paid', 'account') then raise exception 'Unknown payment choice'; end if;

  -- total <-> per tonne: calculate whichever is missing
  if v_total is null and v_ppt is not null then v_total := round(v_ppt * p_quantity_kg / 1000, 2); end if;
  if v_ppt is null and v_total is not null then v_ppt := round(v_total / (p_quantity_kg / 1000), 2); end if;

  insert into public.feed_transactions (
    id, farm_id, feed_product_id, txn_type, quantity_kg, order_date, delivery_date,
    effective_on, supplier_id, total_price_eur, price_per_tonne_eur, evidence,
    linked_order_id, document_id, notes)
  values (
    p_id, p_farm_id, p_feed_product_id, 'delivery', p_quantity_kg, p_order_date, p_delivery_date,
    p_delivery_date, p_supplier_id, v_total, v_ppt, p_evidence,
    p_linked_order_id, p_document_id, p_notes);

  if p_linked_order_id is not null then
    select quantity_kg into v_ordered from public.feed_transactions where id = p_linked_order_id and txn_type = 'order';
    select coalesce(sum(quantity_kg), 0) into v_delivered from public.feed_transactions
     where linked_order_id = p_linked_order_id and txn_type = 'delivery';
    if p_close_order or v_delivered >= v_ordered then
      update public.feed_transactions set order_status = 'delivered'
      where id = p_linked_order_id and txn_type = 'order';
    end if;
  end if;

  -- Workers record what arrived; the price goes on by someone who handles the money
  if v_total is not null and v_total > 0 and public.can_write_money(p_farm_id) then
    select name into v_product from public.feed_products where id = p_feed_product_id;
    select name into v_supplier_name from public.suppliers where id = p_supplier_id;
    insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_id, supplier_name,
                              feed_transaction_id, description, document_id, payment_status, due_on)
    values (p_farm_id, 'feed', p_delivery_date, v_total, p_supplier_id, v_supplier_name,
            p_id, coalesce(v_product, 'Feed') || ' ' || round(p_quantity_kg / 1000, 2) || ' t', p_document_id,
            case when p_payment = 'account' then 'owed' else 'paid' end,
            case when p_payment = 'account' then p_due_on end);
  end if;

  if p_supplier_id is not null then
    insert into public.farm_supplier_settings (farm_id, supplier_id, last_used_at)
    values (p_farm_id, p_supplier_id, now())
    on conflict (farm_id, supplier_id) do update set last_used_at = now();
    update public.feed_products set supplier_id = p_supplier_id
    where id = p_feed_product_id and supplier_id is null;
  end if;

  return p_id;
end $$;

-- Undo a delivery: the order is open again if anything is still to come on it
create or replace function public.undo_feed_delivery(p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_order uuid; v_ordered numeric; v_delivered numeric;
begin
  select linked_order_id into v_order from public.feed_transactions where id = p_id and txn_type = 'delivery';
  delete from public.feed_transactions where id = p_id and txn_type = 'delivery';
  if v_order is not null then
    select quantity_kg into v_ordered from public.feed_transactions where id = v_order;
    select coalesce(sum(quantity_kg), 0) into v_delivered from public.feed_transactions where linked_order_id = v_order and txn_type = 'delivery';
    if v_delivered < v_ordered then
      update public.feed_transactions set order_status = 'open' where id = v_order;
    end if;
  end if;
end $$;

grant execute on function public.record_feed_delivery, public.undo_feed_delivery, public.set_head_count, public.move_animals,
  public.heads_on, public.record_animal_sale, public.undo_animal_sale, public.create_farm_invite, public.accept_farm_invite,
  public.can_see_money, public.can_write_money, public.member_role_of to authenticated;
grant execute on function public.create_farm(text, text, text, public.jurisdiction, text[], smallint) to authenticated;
commit;

-- 2. 20261011000300_supplier_directory.sql
begin;
-- Supplier directory re-checked against each supplier's own contact page on 11 Oct 2026
-- (review gap P1: verified supplier coverage). Only numbers seen on the source page are
-- marked verified; anything that could not be checked shows as not verified in the app.

update public.suppliers set verified_on = '2026-10-11' where id in (
  '10000000-0000-0000-0000-000000000001', -- Tirlán: 0818 321 321 (FarmLife support / customer services)
  '10000000-0000-0000-0000-000000000004'  -- Aurivo: 071 9186500 (Aurivo Agribusiness)
);
update public.suppliers set verified_on = '2026-10-11', source_url = 'https://www.dairygoldagri.ie/contact-us/our-team/',
  local_contact_method = 'Dairygold publishes its dairy, beef and tillage sales advisers by team. Inside Sales can put you through to yours; save them as your rep once you know them.'
  where id = '10000000-0000-0000-0000-000000000002'; -- 025 24411 (contact page) and 022 31644 (team page)
update public.suppliers set verified_on = '2026-10-11', central_phone_label = 'Head office (Clonee)',
  local_contact_method = 'Branch phones are listed by county. If there is more than one branch in your county, pick yours with Set my rep.'
  where id = '10000000-0000-0000-0000-000000000006'; -- 01 825 5011
update public.suppliers set verified_on = '2026-10-11', central_phone_label = 'Fane Valley main line',
  local_contact_method = 'The Fane Valley site lists one main number and no separate Feeds line. Ask for Feeds, then save your adviser as your rep.'
  where id = '10000000-0000-0000-0000-000000000007'; -- 028 9261 9620
-- Lakeland's site blocks automated checks, so its numbers are shown as not verified until checked by hand
update public.suppliers set verified_on = null,
  local_contact_method = 'These numbers come from the September 2026 product document and could not be re-checked on 11 Oct 2026. Check them on the Lakeland contact page before relying on them.'
  where id = '10000000-0000-0000-0000-000000000003';

-- Drummonds branches, from drummonds.ie/contact-us (each branch serves its own county).
-- On a fresh database the directory comes from seed.sql after the migrations (which has the
-- same rows), so only add branches where the supplier is already there.
insert into public.supplier_branches (id, supplier_id, name, town, counties, phone, source_url, verified_on)
select v.id::uuid, v.supplier_id::uuid, v.name, v.town, v.counties::text[], v.phone, v.source_url, v.verified_on::date from (values
('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'Drummonds Ardee', 'Ardee', '{Louth}', '041 685 3332', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000006', 'Drummonds Drogheda', 'Drogheda', '{Louth}', '041 983 8986', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006', 'Drummonds Dromone', 'Oldcastle', '{Meath}', '044 967 2650', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000006', 'Drummonds Knockbridge', 'Dundalk', '{Louth}', '042 937 4480', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006', 'Drummonds Lusk', 'Lusk', '{Dublin}', '01 525 2903', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'Drummonds Mullingar', 'Mullingar', '{Westmeath}', '044 936 2022', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000006', 'Drummonds Navan', 'Navan', '{Meath}', '046 902 1641', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000006', 'Drummonds Rathcoffey', 'Rathcoffey', '{Kildare}', '087 400 3896', 'https://drummonds.ie/contact-us/', '2026-10-11')
) as v(id, supplier_id, name, town, counties, phone, source_url, verified_on)
where exists (select 1 from public.suppliers s where s.id = v.supplier_id::uuid)
on conflict (id) do nothing;
commit;

-- 2. 20261011000400_online.sql
begin;
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
commit;

-- 2. 20261011000500_silage_dm.sql
begin;
-- Silage dry matter help (11 Oct 2026, rule silage-dm@1.0, src/lib/forecast/silageDm.ts)
-- cut: which cut the silage is from (1 first, 2 second, 3 third or later)
-- dm_test: Teagasc yard test result when there is no lab figure (a band, the farmer's estimate)
-- density_basis: 'teagasc_25dm' when the pit density is Teagasc's published figure for silage
--   of about 25% DM; the winter budget then shows Medium confidence and says why.
alter table public.silage_stores
  add column if not exists cut smallint check (cut between 1 and 3),
  add column if not exists dm_test text check (dm_test in ('squeeze_lt20', 'squeeze_20_25', 'squeeze_25_30', 'ball_lt25', 'ball_25_30', 'ball_30_40', 'ball_gt40')),
  add column if not exists density_basis text check (density_basis in ('own', 'teagasc_25dm'));

insert into public.evidence_sources (code, title, publisher, url, published_on, accessed_on) values
('S16', 'A guide to storing silage and managing effluent collection (Today''s Farm, May-June 2024)', 'Teagasc', 'https://teagasc.ie/wp-content/uploads/media/website/publications/2024/A-guide-to-storing-silage-and-managing-effluent-collection.pdf', '2024-05-01', '2026-10-11'),
('S17', 'Visual Assessment of Silage (factsheet)', 'Teagasc', 'https://teagasc.ie/wp-content/uploads/2025/05/Visual-Assessment-of-Silage-Factsheet.pdf', null, '2026-10-11'),
('S18', 'First cut silage better quality than in 2024 (feed trade data)', 'Irish Farmers Journal', 'https://www.farmersjournal.ie/more/northern-ireland/first-cut-silage-better-quality-than-in-2024-890435', '2025-10-22', '2026-10-11'),
('S19', 'Northern Ireland: First-cut silage has average DM of just 24% (United Feeds analysis)', 'Agriland', 'https://www.agriland.ie/farming-news/northern-ireland-first-cut-silage-has-average-dm-of-just-24/', '2022-10-26', '2026-10-11')
on conflict (code) do nothing;
commit;

-- 2. 20261013000100_automation.sql
begin;
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
commit;

-- 2. 20261013000200_silage_best_guess.sql
begin;
-- Silage best guess (13 Oct 2026, rule silage-dm@1.2, src/lib/forecast/silageDm.ts)
-- Most farmers never test silage. A measured pit with no dry matter now gets tonnes from typical
-- silage (Teagasc S16 for ROI, 2025 cut averages S18 for NI), and unweighed bales a typical
-- 600 kg bale (S22). Both are labelled a best guess and the winter plan shows Low confidence.
-- Nothing is stored: the guess is worked out each time, so a squeeze test or weighed bale replaces it.
insert into public.evidence_sources (code, title, publisher, url, published_on, accessed_on) values
('S22', 'Have you enough silage on your suckler farm? (Aurivo advice: bale weights)', 'Agriland', 'https://www.agriland.ie/farming-news/have-you-enough-silage-on-your-suckler-farm/', '2018-01-05', '2026-10-13')
on conflict (code) do nothing;
commit;

-- 2. 20261013000300_at_grass.sql
begin;
-- Where each group is today (13 Oct 2026, rule forage-budget@1.2).
-- at_grass: out at grass now. housed_from: the day the group comes in (or came in), when it is
-- not the farm's housing date. The winter silage plan counts each group from the day it is in;
-- a group out at grass with no date is counted from today, so the plan errs short.
-- Older groups: at_grass false and no date = in with the herd from the farm's housing date (as before).
alter table public.animal_groups
  add column if not exists at_grass boolean not null default false,
  add column if not exists housed_from date;
commit;

-- 2. 20261014000100_order_to_place.sql
begin;
-- Advisory review G03 (14 Oct 2026): an order Agri-It drafts is an order TO PLACE until the
-- farmer says they have placed it with the supplier. Only placed orders count as on order
-- (committed money, the "run-out if it arrives" date, "did it arrive?").
-- Every order already recorded was entered by the farmer as ordered, so it stays placed.
alter table public.feed_transactions
  add column if not exists placed boolean not null default true,
  add column if not exists placed_on date;

comment on column public.feed_transactions.placed is
  'Orders only: false = drafted in Agri-It, still to be placed with the supplier. Placed orders count as on order.';
comment on column public.feed_transactions.placed_on is
  'Orders only: the day the farmer placed it with the supplier (null for older orders: order_date).';
commit;

-- 2. 20261014000200_breeds_list.sql
begin;
-- Breeds as a list (14 Oct 2026). One group often holds more than one breed
-- (dairy cows: Holstein Friesian and Jersey cross), so a group keeps a list.
-- The old single `breed` column stays for older code and reports: it holds the
-- list joined ("Holstein Friesian, Jersey cross"), cut to 60 characters.
-- Older groups: their one breed becomes a list of one, exactly as written.
-- No deletes or drops in this file, so the Supabase connector can apply it.

alter table public.animal_groups
  add column if not exists breeds text[] not null default '{}';

-- At most 8 breeds, each 1 to 60 characters (a check can't hold a subquery, so a function)
create or replace function public.breeds_ok(p text[]) returns boolean
language sql immutable set search_path = public as $$
  select cardinality(p) <= 8
     and coalesce((select bool_and(x is not null and char_length(btrim(x)) between 1 and 60) from unnest(p) x), true)
$$;

alter table public.animal_groups
  add constraint animal_groups_breeds_ok check (public.breeds_ok(breeds));

update public.animal_groups
   set breeds = array[btrim(breed)]
 where breed is not null and btrim(breed) <> '' and cardinality(breeds) = 0;

-- Keep the two in step whichever one a client writes:
--  * a newer client writes the list: `breed` becomes the list joined;
--  * an older client (or an older phone backup) writes only `breed`: the list becomes that one breed.
create or replace function public.animal_groups_breeds_in_step() returns trigger
language plpgsql set search_path = public as $$
declare
  v_joined text;
begin
  if tg_op = 'UPDATE' and new.breeds is not distinct from old.breeds and new.breed is distinct from old.breed then
    new.breeds := case when new.breed is null or btrim(new.breed) = '' then '{}'::text[] else array[btrim(new.breed)] end;
  elsif tg_op = 'INSERT' and cardinality(coalesce(new.breeds, '{}')) = 0 and new.breed is not null and btrim(new.breed) <> '' then
    new.breeds := array[btrim(new.breed)];
  end if;
  new.breeds := coalesce(new.breeds, '{}');
  if cardinality(new.breeds) = 0 then
    new.breed := null;
  else
    v_joined := array_to_string(new.breeds, ', ');
    new.breed := case when char_length(v_joined) <= 60 then v_joined else rtrim(left(v_joined, 57)) || '...' end;
  end if;
  return new;
end $$;

create trigger animal_groups_breeds_in_step before insert or update on public.animal_groups
  for each row execute function public.animal_groups_breeds_in_step();
commit;

-- 2. 20261014000300_supplier_directory_more.sql
begin;
-- More feed and farm supplies businesses in the directory (14 Oct 2026). Each one was
-- checked on its own website that day; only what was seen there is marked verified.
--  * Brett Brothers Ltd, Callan: four branches (brettbrothers.ie/contact).
--  * Roche's Feeds (J. H. Roche & Sons), Dock Road, Limerick: one number (rochesfeeds.com/contact).
--  * Howard Farms, Kilcanway, Mallow: head office and four area contacts named on its own
--    contact page (howardfarms.ie/contact-us).
--  * Star Fuels & Farm Supplies, Clonmel and Mitchelstown: a separate business from Roche's.
--    Its website showed "account suspended" on 14 Oct 2026, so nothing could be checked:
--    no number is loaded and it shows as not verified.
-- New column: where the supplier says it serves, in its own words. Null = not stated.
-- No deletes or drops, so the Supabase connector can apply it.

alter table public.suppliers add column if not exists area_served text;

-- On a fresh database the directory comes from seed.sql after the migrations (with the same
-- rows), so only add these where the directory is already loaded (the hosted project).
insert into public.suppliers (id, name, network, coverage, central_phone, central_phone_label,
  secondary_phone, secondary_phone_label, website, local_contact_method, area_served, source_url, verified_on, needs_live_directory)
select v.id::uuid, v.name, v.network, v.coverage::public.jurisdiction[], v.central_phone, v.central_phone_label,
  null, null, v.website, v.local_contact_method, v.area_served, v.source_url, v.verified_on::date, v.needs_live_directory
from (values
('10000000-0000-0000-0000-000000000008', 'Brett Brothers', null, '{ROI}', '056 775 5300', 'Head office (Callan)',
  'https://www.brettbrothers.ie',
  'Four branches, each with its own number. If more than one is near you, pick yours with Set my rep.',
  'Leinster and Munster (branches in Kilkenny, Tipperary and Waterford)',
  'https://www.brettbrothers.ie/contact/', '2026-10-14', false),
('10000000-0000-0000-0000-000000000009', 'Roche''s Feeds', 'J. H. Roche & Sons', '{ROI}', '061 308 111', 'Roche''s Feeds, Dock Road, Limerick',
  'https://www.rochesfeeds.com',
  'One number on its website, for the mill on the Dock Road in Limerick. It lists no branches or reps: save yours with Set my rep.',
  null,
  'https://www.rochesfeeds.com/contact', '2026-10-14', false),
('10000000-0000-0000-0000-00000000000a', 'Howard Farms', null, '{ROI}', '022 26184', 'Head office (Kilcanway, Mallow)',
  'https://www.howardfarms.ie',
  'Howard Farms names an area contact for each part of Munster on its website. Where two cover your county, pick yours with Set my rep.',
  'Clare, Cork, Kerry, Limerick, Tipperary and Waterford (from its area contacts)',
  'https://www.howardfarms.ie/contact-us/', '2026-10-14', false),
('10000000-0000-0000-0000-00000000000b', 'Star Fuels & Farm Supplies', null, '{ROI}', null, null,
  'https://starfuels.ie',
  'Its website was down when checked on 14 Oct 2026, so Agri-It has no checked number yet. Add the branch you use with Set my rep.',
  'Clonmel and Mitchelstown (not checked)',
  'https://starfuels.ie/', null, true)
) as v(id, name, network, coverage, central_phone, central_phone_label, website, local_contact_method, area_served, source_url, verified_on, needs_live_directory)
where exists (select 1 from public.suppliers s where s.id = '10000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.supplier_branches (id, supplier_id, name, town, counties, phone, contact_name, contact_role, source_url, verified_on)
select v.id::uuid, v.supplier_id::uuid, v.name, v.town, v.counties::text[], v.phone, v.contact_name, v.contact_role, v.source_url, v.verified_on::date from (values
('11000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Callan', 'Callan', '{Kilkenny}', '056 775 5300', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Windgap', 'Windgap', '{Kilkenny}', '051 648 204', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Ardfinnan', 'Ardfinnan', '{Tipperary}', '052 746 6208', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Portlaw', 'Portlaw', '{Waterford}', '051 387 396', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Clare and Limerick', null, '{Clare,Limerick}', '087 138 0693', 'Bryan King', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, East Cork, East Limerick, Tipperary and Waterford', null, '{Cork,Limerick,Tipperary,Waterford}', '087 218 8294', 'Robert Meagher', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Cork', null, '{Cork}', '087 288 6041', 'John McLoughlin', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Kerry', null, '{Kerry}', '087 131 5577', 'William O''Connor', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14')
) as v(id, supplier_id, name, town, counties, phone, contact_name, contact_role, source_url, verified_on)
where exists (select 1 from public.suppliers s where s.id = v.supplier_id::uuid)
on conflict (id) do nothing;
commit;

-- 2. 20261014000400_fields_fertiliser.sql
begin;
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
commit;

-- 2. 20261014000500_alert_load.sql
begin;
-- Alert load (advisory board G12, 14 Oct 2026).
-- "Not now" on a suggestion now says why (busy, done elsewhere, not relevant) and for how long
-- (the existing `until` date). Older rows have no reason. No deletes or drops.

alter table public.suggestion_decisions
  add column if not exists reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suggestion_decisions_reason_ok') then
    alter table public.suggestion_decisions
      add constraint suggestion_decisions_reason_ok
      check (reason is null or reason in ('busy', 'elsewhere', 'not_relevant'));
  end if;
end $$;

comment on column public.suggestion_decisions.reason is
  'Why the farmer put off or turned down a suggestion: busy, elsewhere (done elsewhere), not_relevant. Null on older rows.';
commit;

-- 2. 20261014000600_stock_reasons.sql
begin;
-- Forecast exceptions (advisory board G11, 14 Oct 2026).
-- A stock adjustment (feed or fertiliser) carries a reason, and a stock check that differs from
-- the forecast can say why. Agri-It never changes a feeding or spreading rate because of it.
--
-- Contains DROP CONSTRAINT (to let fertiliser_stock hold signed adjustments), so it goes to the
-- hosted project through the SQL editor paste (supabase/remote/setup_agri_it.sql), not the connector.

-- Feed: counts and adjustments already exist; they gain a reason.
alter table public.feed_transactions add column if not exists reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feed_transactions_reason_ok') then
    alter table public.feed_transactions add constraint feed_transactions_reason_ok check (
      reason is null or (
        txn_type in ('count', 'adjustment')
        and reason in ('wasted', 'fed_other_group', 'used_elsewhere', 'sold_returned', 'count_error', 'delivery_missing', 'not_known')
      )
    );
  end if;
end $$;

-- Fertiliser: a new kind 'adjustment' with a signed quantity, and a reason on checks and adjustments.
alter table public.fertiliser_stock add column if not exists reason text;
alter table public.fertiliser_stock drop constraint if exists fertiliser_stock_kind_check;
alter table public.fertiliser_stock drop constraint if exists fertiliser_stock_quantity_kg_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fertiliser_stock_kind_ok') then
    alter table public.fertiliser_stock add constraint fertiliser_stock_kind_ok
      check (kind in ('opening', 'delivery', 'count', 'adjustment', 'order'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fertiliser_stock_qty_ok') then
    alter table public.fertiliser_stock add constraint fertiliser_stock_qty_ok
      check ((kind = 'adjustment' and quantity_kg <> 0) or (kind <> 'adjustment' and quantity_kg >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fertiliser_stock_reason_ok') then
    alter table public.fertiliser_stock add constraint fertiliser_stock_reason_ok check (
      reason is null or (
        kind in ('count', 'adjustment')
        and reason in ('wasted', 'fed_other_group', 'used_elsewhere', 'sold_returned', 'count_error', 'delivery_missing', 'not_known')
      )
    );
  end if;
end $$;

comment on column public.feed_transactions.reason is 'Counts and adjustments: why stock differed from the forecast (G11). Null on older rows.';
comment on column public.fertiliser_stock.reason is 'Checks and adjustments: why stock differed from the records (G11). Null on older rows.';
commit;

-- 2. 20261014000700_supplier_recheck.sql
begin;
-- Supplier directory upkeep (advisory board G08, 14 Oct 2026).
-- Every directory supplier and branch is rechecked six months after verified_on; the app works
-- that date out (lib/suppliers.ts recheckBy) and the build fails 30 days after it. No new column:
-- verified_on stays the one date to keep right.
-- Lakeland was tried again on 14 Oct 2026; its website still blocks automated checks, so its
-- numbers stay not verified. Star Fuels' website still showed "account suspended": no number.
-- No deletes or drops.

update public.suppliers
   set local_contact_method = 'These numbers come from the September 2026 product document and could not be re-checked on 11 or 14 Oct 2026 (its website blocks automated checks). Check them on the Lakeland contact page before relying on them.'
 where id = '10000000-0000-0000-0000-000000000003' and verified_on is null;
commit;

-- 2. 20261014000800_fertiliser_orders.sql
begin;
-- Fertiliser orders (14 Oct 2026, like feed): order, part delivery, invoice, paid or on account.
-- An order is a row of kind 'order' in fertiliser_stock (the kind check in 20261014000600 allows it).
-- It is a commitment only: never stock, a cost or cash until a delivery is recorded against it.
-- No deletes or drops.

alter table public.fertiliser_stock add column if not exists order_status text;
alter table public.fertiliser_stock add column if not exists expected_on date;
alter table public.fertiliser_stock add column if not exists price_per_tonne_eur numeric(10,2);
alter table public.fertiliser_stock add column if not exists linked_order_id uuid references public.fertiliser_stock(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fertiliser_stock_order_ok') then
    alter table public.fertiliser_stock add constraint fertiliser_stock_order_ok check (
      (kind = 'order') = (order_status is not null)
      and (order_status is null or order_status in ('open', 'delivered', 'cancelled'))
      and (kind = 'order' or (expected_on is null and price_per_tonne_eur is null))
      and (linked_order_id is null or kind = 'delivery')
      and (price_per_tonne_eur is null or price_per_tonne_eur >= 0)
    );
  end if;
end $$;

create index if not exists fertiliser_stock_linked_order on public.fertiliser_stock (linked_order_id) where linked_order_id is not null;

comment on column public.fertiliser_stock.order_status is 'Orders only: open, delivered (in full, or closed with less) or cancelled.';
comment on column public.fertiliser_stock.expected_on is 'Orders only: when the supplier said it would come. Never guessed.';
comment on column public.fertiliser_stock.price_per_tonne_eur is 'Orders only: the agreed price, in the farm''s currency. A commitment, never a cost.';
comment on column public.fertiliser_stock.linked_order_id is 'Deliveries only: the order this load was against.';
commit;

-- 2. 20261016000100_setup_enums.sql
begin;
-- New cost categories for the financial planner and the accountant pack (16 Oct 2026).
-- Kept in their own migration because a new enum value cannot be used in the same
-- transaction that adds it. These are the lines a Teagasc cash flow budget lists apart
-- (land rent, labour, insurance, accountancy and advisory fees, household drawings).
alter type public.cost_category add value if not exists 'land_rent';
alter type public.cost_category add value if not exists 'labour';
alter type public.cost_category add value if not exists 'insurance';
alter type public.cost_category add value if not exists 'professional_fees';
-- Household drawings: cash out of the farm account, never a farm running cost
alter type public.cost_category add value if not exists 'household';
commit;

-- 2. 20261016000200_setup_planner.sql
begin;
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
commit;

-- 2. 20261021000100_reports_enums.sql
begin;
-- Reports module (21 Oct 2026): animals bought get their own cost category, so the profit report
-- can set purchases against sales and the stock movement. Kept in its own migration because a new
-- enum value cannot be used in the transaction that adds it.
alter type public.cost_category add value if not exists 'livestock_purchase';
commit;

-- 2. 20261021000200_year_end_values.sql
begin;
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
commit;

-- 2. 20261022000100_animals.sql
begin;
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
commit;

-- 2. 20261022000200_animal_stages.sql
begin;
-- Animals at scale (22 Oct 2026): what kind of animal it is, whether a male was castrated, and an
-- optional life stage set by hand. The stage normally comes from the animal's age (calf, weanling,
-- heifer, cow; lamb, hogget, ewe) and is worked out in the app, never stored, so it moves up on
-- its own as the animal gets older. `stage` is only for the farmer who overrides it (an in-calf
-- heifer, say). Indexes keep lists of thousands of animals quick.

alter table public.animals
  add column if not exists species   text not null default 'cattle' check (species in ('cattle', 'sheep', 'goat', 'pig', 'horse', 'other')),
  add column if not exists castrated boolean,
  add column if not exists stage     text check (stage is null or stage ~ '^[a-z_]{2,30}$');

create index if not exists animals_farm_status on public.animals (farm_id, status);
create index if not exists animals_farm_species on public.animals (farm_id, species) where status = 'on_farm';

-- No change history for animals: a farm can load or update thousands at once, which would bury
-- the history of money and feed records. Each animal still has created_at and updated_at.
drop trigger if exists animals_audit on public.animals;
commit;

-- 3. Reference data from seed.sql (top half only: no demo login, no demo farm)
begin;
-- Agri-It local seed. Runs on `supabase db reset` (and first `supabase start`).
-- 1) Reference data: evidence sources, forage benchmarks, supplier directory
-- 2) A demo login + demo farm so every screen has data to look at.
--
-- IMPORTANT: supplier phone numbers below are copied from the Agri-It MVP Overview
-- (September 2026, sources S7 to S15). They are stamped verified_on 2026-09-01 to
-- reflect that document. Re-verify against each source_url before any production use.

-- ---------------------------------------------------------------------------
-- Evidence sources
-- ---------------------------------------------------------------------------
insert into public.evidence_sources (code, title, publisher, url, published_on, accessed_on) values
('S1','Financial Analysis','Teagasc','https://teagasc.ie/rural-economy/farm-management/financial-analysis/',null,'2026-09-01'),
('S2','Irish Farm Report 2026','Ifac','https://www.ifac.ie/irish-farm-report-2026',null,'2026-09-01'),
('S3','Act Now to Assess Winter Feed Demand and Plan for the Winter Ahead','Teagasc','https://teagasc.ie/news--events/daily/act-now-to-assess-winter-feed-demand-and-plan-for-the-winter-ahead/',null,'2026-09-01'),
('S4','Making quality silage on beef farms','Teagasc','https://teagasc.ie/insights/making-quality-silage-on-beef-farms/',null,'2026-09-01'),
('S5','4 key winter housing considerations','Teagasc','https://teagasc.ie/news--events/daily/4-key-winter-housing-considerations/',null,'2026-09-01'),
('S6','Financial Analysis Tools','Teagasc','https://teagasc.ie/rural-economy/farm-management/financial-analysis/get-farm-financially-fit/tools/',null,'2026-09-01');

-- Teagasc winter planning allowances, fresh pit silage per head per month (S3)
insert into public.forage_benchmarks (animal_class, fresh_tonnes_per_month, source_code, valid_from, notes) values
('dairy_cow',      1.6, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('suckler_cow',    1.4, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('in_calf_heifer', 1.3, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('store_cattle',   1.3, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('weanling',       0.7, 'S3', '2026-09-01', 'Planning allowance; use farm history where available');

-- ---------------------------------------------------------------------------
-- Supplier directory (shared, farm_id null). Named reps are NOT seeded: none are
-- publicly mapped in the source data, so the app falls back to central numbers.
-- ---------------------------------------------------------------------------
insert into public.suppliers (id, name, network, coverage, central_phone, central_phone_label,
  secondary_phone, secondary_phone_label, website, local_contact_method, source_url, verified_on, needs_live_directory) values
('10000000-0000-0000-0000-000000000001','Tirlán FarmLife','GAIN Feeds','{ROI}','0818 321 321','Customer services',
  null,null,'https://www.tirlanfarmlife.com',
  'Customer services can connect you to your local Business Manager. Use the Tirlán store finder with your Eircode or town.',
  'https://www.tirlanfarmlife.com/about-us/contact-us/contact','2026-10-11',false),
('10000000-0000-0000-0000-000000000002','Dairygold Agri Business',null,'{ROI}','025 24411','Agri Business',
  '022 31644','Inside Sales','https://www.dairygoldagri.ie',
  'Dairygold publishes its dairy, beef and tillage sales advisers by team. Inside Sales can put you through to yours; save them as your rep once you know them.',
  'https://www.dairygoldagri.ie/contact-us/our-team/','2026-10-11',false),
('10000000-0000-0000-0000-000000000003','Lakeland Dairies Agribusiness',null,'{ROI,NI}','0818 474720','ROI agribusiness',
  '+44 28 3026 2311','NI agribusiness','https://lakelanddairies.com',
  'These numbers come from the September 2026 product document and could not be re-checked on 11 or 14 Oct 2026 (its website blocks automated checks). Check them on the Lakeland contact page before relying on them.',
  'https://lakelanddairies.com/contact-us',null,false),
('10000000-0000-0000-0000-000000000004','Aurivo Agribusiness','Nutrias','{ROI}','071 9186500','Agribusiness',
  null,null,'https://www.aurivo.ie',
  'Current Aurivo agribusiness contact or branch data; central number as fallback.',
  'https://www.aurivo.ie/overview/','2026-10-11',false),
('10000000-0000-0000-0000-000000000005','Arrabawn Tipperary Co-op','Dan O''Connor Feeds','{ROI}',null,null,
  null,null,null,
  'Arrabawn and Tipperary Co-op merged in Feb 2025. Contacts must come from the merged co-op''s live directory, not legacy Arrabawn data.',
  'https://www.rte.ie/news/business/2025/0228/1499516-arrabawn-tipperary-co-operative-society/',null,true),
('10000000-0000-0000-0000-000000000006','Drummonds',null,'{ROI}','01 825 5011','Head office (Clonee)',
  null,null,'https://drummonds.ie',
  'Branch phones are listed by county. If there is more than one branch in your county, pick yours with Set my rep.',
  'https://drummonds.ie/contact-us/','2026-10-11',false),
('10000000-0000-0000-0000-000000000007','Fane Valley Feeds',null,'{NI}','028 9261 9620','Fane Valley main line',
  null,null,'https://fanevalley.com',
  'The Fane Valley site lists one main number and no separate Feeds line. Ask for Feeds, then save your adviser as your rep.',
  'https://fanevalley.com/','2026-10-11',false);

-- Drummonds branches (drummonds.ie/contact-us, checked 11 Oct 2026). Each serves its own county.
insert into public.supplier_branches (id, supplier_id, name, town, counties, phone, source_url, verified_on) values
('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','Drummonds Ardee','Ardee','{Louth}','041 685 3332','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000006','Drummonds Drogheda','Drogheda','{Louth}','041 983 8986','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000006','Drummonds Dromone','Oldcastle','{Meath}','044 967 2650','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000006','Drummonds Knockbridge','Dundalk','{Louth}','042 937 4480','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000006','Drummonds Lusk','Lusk','{Dublin}','01 525 2903','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','Drummonds Mullingar','Mullingar','{Westmeath}','044 936 2022','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000006','Drummonds Navan','Navan','{Meath}','046 902 1641','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000006','Drummonds Rathcoffey','Rathcoffey','{Kildare}','087 400 3896','https://drummonds.ie/contact-us/','2026-10-11')
on conflict (id) do nothing;


-- Brett Brothers, Roche's Feeds, Howard Farms (checked on their own websites 14 Oct 2026) and
-- Star Fuels & Farm Supplies (website down that day: not verified, no number).
insert into public.suppliers (id, name, network, coverage, central_phone, central_phone_label,
  secondary_phone, secondary_phone_label, website, local_contact_method, area_served, source_url, verified_on, needs_live_directory)
select v.id::uuid, v.name, v.network, v.coverage::public.jurisdiction[], v.central_phone, v.central_phone_label,
  null, null, v.website, v.local_contact_method, v.area_served, v.source_url, v.verified_on::date, v.needs_live_directory
from (values
('10000000-0000-0000-0000-000000000008', 'Brett Brothers', null, '{ROI}', '056 775 5300', 'Head office (Callan)',
  'https://www.brettbrothers.ie',
  'Four branches, each with its own number. If more than one is near you, pick yours with Set my rep.',
  'Leinster and Munster (branches in Kilkenny, Tipperary and Waterford)',
  'https://www.brettbrothers.ie/contact/', '2026-10-14', false),
('10000000-0000-0000-0000-000000000009', 'Roche''s Feeds', 'J. H. Roche & Sons', '{ROI}', '061 308 111', 'Roche''s Feeds, Dock Road, Limerick',
  'https://www.rochesfeeds.com',
  'One number on its website, for the mill on the Dock Road in Limerick. It lists no branches or reps: save yours with Set my rep.',
  null,
  'https://www.rochesfeeds.com/contact', '2026-10-14', false),
('10000000-0000-0000-0000-00000000000a', 'Howard Farms', null, '{ROI}', '022 26184', 'Head office (Kilcanway, Mallow)',
  'https://www.howardfarms.ie',
  'Howard Farms names an area contact for each part of Munster on its website. Where two cover your county, pick yours with Set my rep.',
  'Clare, Cork, Kerry, Limerick, Tipperary and Waterford (from its area contacts)',
  'https://www.howardfarms.ie/contact-us/', '2026-10-14', false),
('10000000-0000-0000-0000-00000000000b', 'Star Fuels & Farm Supplies', null, '{ROI}', null, null,
  'https://starfuels.ie',
  'Its website was down when checked on 14 Oct 2026, so Agri-It has no checked number yet. Add the branch you use with Set my rep.',
  'Clonmel and Mitchelstown (not checked)',
  'https://starfuels.ie/', null, true)
) as v(id, name, network, coverage, central_phone, central_phone_label, website, local_contact_method, area_served, source_url, verified_on, needs_live_directory)
on conflict (id) do nothing;

insert into public.supplier_branches (id, supplier_id, name, town, counties, phone, contact_name, contact_role, source_url, verified_on)
select v.id::uuid, v.supplier_id::uuid, v.name, v.town, v.counties::text[], v.phone, v.contact_name, v.contact_role, v.source_url, v.verified_on::date from (values
('11000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Callan', 'Callan', '{Kilkenny}', '056 775 5300', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Windgap', 'Windgap', '{Kilkenny}', '051 648 204', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Ardfinnan', 'Ardfinnan', '{Tipperary}', '052 746 6208', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Portlaw', 'Portlaw', '{Waterford}', '051 387 396', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Clare and Limerick', null, '{Clare,Limerick}', '087 138 0693', 'Bryan King', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, East Cork, East Limerick, Tipperary and Waterford', null, '{Cork,Limerick,Tipperary,Waterford}', '087 218 8294', 'Robert Meagher', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Cork', null, '{Cork}', '087 288 6041', 'John McLoughlin', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Kerry', null, '{Kerry}', '087 131 5577', 'William O''Connor', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14')
) as v(id, supplier_id, name, town, counties, phone, contact_name, contact_role, source_url, verified_on)
on conflict (id) do nothing;
commit;

-- 4. Migration history: the nine migration files, by their own versions
begin;
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260929000100', 'schema'),
  ('20260929000200', 'security_and_functions'),
  ('20261006000100', 'feed_target'),
  ('20261006000200', 'routines'),
  ('20261007000100', 'farm_types'),
  ('20261011000100', 'review_enums'),
  ('20261011000200', 'review_fixes'),
  ('20261011000300', 'supplier_directory'),
  ('20261011000400', 'online'),
  ('20261011000500', 'silage_dm'),
  ('20261013000100', 'automation'),
  ('20261013000200', 'silage_best_guess'),
  ('20261013000300', 'at_grass'),
  ('20261014000100', 'order_to_place'),
  ('20261014000200', 'breeds_list'),
  ('20261014000300', 'supplier_directory_more'),
  ('20261014000400', 'fields_fertiliser'),
  ('20261014000500', 'alert_load'),
  ('20261014000600', 'stock_reasons'),
  ('20261014000700', 'supplier_recheck'),
  ('20261014000800', 'fertiliser_orders'),
  ('20261016000100', 'setup_enums'),
  ('20261016000200', 'setup_planner'),
  ('20261021000100', 'reports_enums'),
  ('20261021000200', 'year_end_values'),
  ('20261022000100', 'animals'),
  ('20261022000200', 'animal_stages');
commit;

-- 5. db_review.sql checks, run against the demo farm inside one transaction and rolled back.
--    Nothing from this step is kept. An error here names the check that failed.
begin;
-- ---------------------------------------------------------------------------
-- Demo login: demo@agri-it.local / agri-it-demo
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values (
  '00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'demo@agri-it.local', crypt('agri-it-demo', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"name":"Demo Farmer"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '{"sub":"20000000-0000-0000-0000-000000000001","email":"demo@agri-it.local","email_verified":true}',
  'email', now(), now(), now());

-- ---------------------------------------------------------------------------
-- Demo farm. Dates are relative to the day you reset, so the demo never goes stale.
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid := '20000000-0000-0000-0000-000000000001';
  f uuid := '30000000-0000-0000-0000-000000000001';
  g_cows uuid := '40000000-0000-0000-0000-000000000001';
  g_heif uuid := '40000000-0000-0000-0000-000000000002';
  g_wean uuid := '40000000-0000-0000-0000-000000000003';
  g_calf uuid := '40000000-0000-0000-0000-000000000004';
  p_nut  uuid := '50000000-0000-0000-0000-000000000001';
  p_calf uuid := '50000000-0000-0000-0000-000000000002';
  tirlan uuid := '10000000-0000-0000-0000-000000000001';
  d date := current_date;
  m int;
begin
  insert into public.farms (id, name, eircode, county, jurisdiction, enterprise, enterprises, financial_year_start_month,
    opening_cash_eur, opening_cash_date, default_lead_time_days, forage_reserve_percent,
    housing_start, turnout_date, created_by)
  values (f, 'Glenview Farm', 'E91 X000', 'Tipperary', 'ROI', 'dairy', array['dairy'], 1,
    38000, date_trunc('year', d)::date, 3, 15,
    make_date(extract(year from d)::int, 11, 1), make_date(extract(year from d)::int + 1, 2, 28), u);
  insert into public.farm_members (farm_id, user_id, role) values (f, u, 'owner');

  insert into public.animal_groups (id, farm_id, name, animal_class, breed, head_count, sort_order, housed) values
    (g_cows, f, 'Dairy cows', 'dairy_cow', 'Holstein Friesian', 120, 1, true),
    (g_heif, f, 'In-calf heifers', 'in_calf_heifer', 'Holstein Friesian', 40, 2, true),
    (g_wean, f, 'Weanlings', 'weanling', 'Aberdeen Angus', 30, 3, true),
    (g_calf, f, 'Calves', 'calf', 'Mixed', 18, 4, true);
  insert into public.head_count_history (farm_id, animal_group_id, head_count, effective_on, reason)
  select f, id, head_count, d - 20, 'opening' from public.animal_groups where farm_id = f;

  insert into public.farm_supplier_settings (farm_id, supplier_id, lead_time_days, last_used_at)
  values (f, tirlan, 3, now() - interval '4 days');

  insert into public.feed_products (id, farm_id, supplier_id, name, storage_location, safety_stock_mode, safety_stock_value)
  values (p_nut, f, tirlan, 'Dairy nut 16%', 'Bin 1', 'days', 3),
         (p_calf, f, tirlan, 'Calf ration', 'Shed store', 'kg', 150);

  -- Dairy nut: counted 20 days ago, then an 8 t delivery 4 days ago
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, effective_on, evidence, notes)
  values (f, p_nut, 'count', 6200, d - 20, 'measured', 'Bin dipped');
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, order_date, delivery_date,
    effective_on, supplier_id, total_price_eur, price_per_tonne_eur, evidence)
  values (f, p_nut, 'delivery', 8000, d - 7, d - 4, d - 4, tirlan, 3120, 390, 'confirmed_docket');
  insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_id, supplier_name, description)
  values (f, 'feed', d - 4, 3120, tirlan, 'Tirlán FarmLife', 'Dairy nut 16% 8 t');
  -- An open order not yet delivered: must NOT count as stock
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, order_date,
    expected_delivery_date, effective_on, order_status, supplier_id, evidence)
  values (f, p_calf, 'order', 1000, d - 1, d + 2, d + 2, 'open', tirlan, 'unconfirmed');

  -- Calf ration: estimated opening stock, so confidence should drop to low
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, effective_on, evidence, notes)
  values (f, p_calf, 'opening', 500, d - 6, 'farmer_estimate', 'Roughly 20 bags');

  -- Rules set up two mornings ago (when ticking began), so Today's checklist only reaches back that far
  insert into public.feeding_rules (id, farm_id, feed_product_id, animal_group_id, kg_per_head_per_feed, feeds_per_day, start_date, label, created_at)
  values ('60000000-0000-0000-0000-000000000001', f, p_nut, g_cows, 1.0, 2, d - 30, null, (d - 2)::timestamptz + interval '6 hours'),
         ('60000000-0000-0000-0000-000000000002', f, p_nut, g_heif, 1.0, 1, d - 30, null, (d - 2)::timestamptz + interval '6 hours'),
         ('60000000-0000-0000-0000-000000000003', f, p_calf, g_calf, 1.5, 1, d - 30, null, (d - 2)::timestamptz + interval '6 hours');
  -- temporary plan: replaces the cows' normal rate for 10 days, then reverts automatically
  insert into public.feeding_rules (farm_id, feed_product_id, animal_group_id, kg_per_head_per_feed, feeds_per_day,
    start_date, end_date, is_temporary, label)
  values (f, p_nut, g_cows, 1.5, 2, d + 3, d + 12, true, 'Higher rate while grass is short');

  -- Silage: pit measured, bales counted
  insert into public.silage_stores (id, farm_id, name, method, length_m, width_m, avg_height_m, density_kg_m3, dm_percent, dmd_percent, measured_on)
  values ('70000000-0000-0000-0000-000000000001', f, 'Main pit', 'pit_dimensions', 40, 12, 2.2, 700, 28, 72, d - 25);
  insert into public.silage_stores (farm_id, name, method, bale_count, bale_weight_kg, measured_on)
  values (f, 'Round bales (haggard)', 'bale_count', 220, 750, d - 25);

  -- Money: 8 months of milk cheques + typical costs
  for m in 1..8 loop
    insert into public.income (farm_id, income_type, occurred_on, amount_eur, counterparty, milk_litres, description)
    values (f, 'milk', (date_trunc('month', d) - make_interval(months => m))::date + 14,
            26000 + (m * 1300) % 7000, 'Tirlán', 56000 + (m * 3100) % 16000, 'Milk cheque');
    insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_name, description) values
      (f, 'feed', (date_trunc('month', d) - make_interval(months => m))::date + 3, 6800 + (m * 410) % 2500, 'Tirlán FarmLife', 'Meal'),
      (f, 'utilities', (date_trunc('month', d) - make_interval(months => m))::date + 20, 640 + (m * 37) % 200, 'Electricity supplier', 'ESB bill'),
      (f, 'vet_medicine', (date_trunc('month', d) - make_interval(months => m))::date + 9, 900 + (m * 173) % 1100, 'Local vet', 'Vet call-outs'),
      (f, 'other', (date_trunc('month', d) - make_interval(months => m))::date + 1, 5200, 'Bank', 'Loan repayment');
  end loop;
  insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_name, description) values
    (f, 'fertiliser', d - 150, 14200, 'Tirlán FarmLife', 'CAN and 18-6-12'),
    (f, 'contractor', d - 110, 9800, 'Local contractor', 'First cut silage'),
    (f, 'machinery_fuel', d - 45, 2300, 'Fuel supplier', 'Green diesel');
  insert into public.income (farm_id, income_type, occurred_on, amount_eur, counterparty, animal_group_id, head_count, description)
  values (f, 'livestock', d - 60, 7400, 'Mart', g_wean, 12, '12 weanlings sold');

  -- Budget: monthly feed and milk
  for m in 1..12 loop
    insert into public.budget_lines (farm_id, year, month, kind, category, amount_eur) values
      (f, extract(year from d)::int, m, 'income', 'milk', 29000),
      (f, extract(year from d)::int, m, 'cost', 'feed', 7500);
  end loop;

  -- Records and jobs
  insert into public.farm_records (farm_id, record_type, occurred_on, title, details, state) values
    (f, 'fertiliser', d - 150, 'CAN spread, paddocks 1 to 12', '{"product":"CAN","quantity_kg":6000,"area_ha":24}', 'confirmed'),
    (f, 'medicine', d - 12, 'Dosed weanlings', '{"product":"Wormer","animals":30,"withdrawal_days":14}', 'confirmed'),
    (f, 'movement', d - 60, '12 weanlings to mart', '{"direction":"out","animals":12}', 'confirmed');
  insert into public.jobs (farm_id, title, due_on) values
    (f, 'Book vet for TB test', d + 5),
    (f, 'Check silage pit cover', d + 1);

  -- Feeding ticked off on the last two days; calves got a little extra yesterday
  insert into public.feed_use_logs (farm_id, feeding_rule_id, feed_product_id, animal_group_id, used_on, planned_kg, actual_kg, status)
  select f, r.id, r.feed_product_id, r.animal_group_id, day, r.planned, r.planned, 'fed'
  from (values ('60000000-0000-0000-0000-000000000001'::uuid, p_nut, g_cows, 240),
               ('60000000-0000-0000-0000-000000000002'::uuid, p_nut, g_heif, 40)) as r(id, feed_product_id, animal_group_id, planned),
       (values (d - 2), (d - 1)) as days(day);
  insert into public.feed_use_logs (farm_id, feeding_rule_id, feed_product_id, animal_group_id, used_on, planned_kg, actual_kg, status) values
    (f, '60000000-0000-0000-0000-000000000003', p_calf, g_calf, d - 2, 27, 27, 'fed'),
    (f, '60000000-0000-0000-0000-000000000003', p_calf, g_calf, d - 1, 27, 30, 'changed');

  -- Routines: relative dates so there is always something due, overdue and done
  insert into public.routines (id, farm_id, kind, title, frequency, weekday, day_of_month, start_date, amount, category, counterparty, feed_product_id, silage_store_id, created_at) values
    (gen_random_uuid(), f, 'expense', 'Loan repayment', 'monthly', null, extract(day from d - 5)::int, d - 60, 5200, 'other', 'Bank', null, null, now() - interval '60 days'),
    (gen_random_uuid(), f, 'expense', 'ESB bill', 'monthly', null, extract(day from d + 14)::int, d - 60, 640, 'utilities', 'Electricity supplier', null, null, now() - interval '60 days'),
    (gen_random_uuid(), f, 'income', 'Milk cheque', 'monthly', null, extract(day from d + 9)::int, d - 60, 27000, 'milk', 'Tirlán', null, null, now() - interval '60 days'),
    ('80000000-0000-0000-0000-000000000001', f, 'count', 'Dip the nut bin', 'weekly', extract(dow from d - 1)::int, null, d - 60, null, null, null, p_nut, null, now() - interval '60 days'),
    ('80000000-0000-0000-0000-000000000002', f, 'job', 'Check water troughs', 'weekly', extract(dow from d - 2)::int, null, d - 60, null, null, null, null, null, now() - interval '60 days'),
    (gen_random_uuid(), f, 'silage', 'Feed out silage', 'daily', null, null, make_date(extract(year from d)::int, 11, 1), 6, null, null, null, '70000000-0000-0000-0000-000000000001', now() - interval '60 days');
  insert into public.routine_completions (farm_id, routine_id, due_date, status, done_on)
  values (f, '80000000-0000-0000-0000-000000000002', d - 2, 'done', d - 2);

  -- Set up your farm, loans and scheme payments (16 Oct 2026), as in src/lib/demo/seed.ts.
  -- The bank loan is the "Loan repayment" routine above; a tractor on HP and an overdraft show the rest.
  update public.farms set herd_number = 'P1234567', acres_owned = 110, acres_rented = 40, vat_status = 'flat_rate',
    accountant_name = 'Local accountant', milk_buyer = 'Tirlán',
    setup = '{"farm":"done","animals":"done","feeding":"done","jobs":"done","income":"done","bills":"done","loans":"done","yearend":"done","year":"done"}'
  where id = f;
  insert into public.loans (id, farm_id, lender, kind, purpose, balance_eur, balance_on, rate_percent, rate_type, repayment_eur, frequency, next_due, ends_on, notes) values
    ('a1000000-0000-0000-0000-000000000001', f, 'Finance company', 'hire_purchase', 'machinery', 38000, d - 20, 6.9, 'fixed', 3150, 'quarterly', d + 40, d + 1100, 'Tractor');
  insert into public.loans (id, farm_id, lender, kind, purpose, balance_eur, balance_on, rate_percent, credit_limit_eur) values
    ('a1000000-0000-0000-0000-000000000002', f, 'AIB', 'overdraft', 'working_capital', 0, d - 1, 9.5, 25000);
  insert into public.expected_income (farm_id, scheme, label, scheme_year, part, amount_eur, expected_on) values
    (f, 'biss', 'BISS and CRISS ' || extract(year from d)::int || ', advance', extract(year from d)::int, 'advance', 27750, d + 20),
    (f, 'biss', 'BISS and CRISS ' || extract(year from d)::int || ', balance', extract(year from d)::int, 'balance', 9250, d + 50);
end $$;
-- Database checks for the review fixes (Oct 2026). Run after the stub, all migrations and
-- seed.sql on a scratch Postgres 16 (see scripts/e2e/README or the handover):
--   psql -v ON_ERROR_STOP=1 -d agri_test -f scripts/e2e/db_review.sql
-- Every check raises an exception when it fails, so the run stops at the first problem.

-- Supabase grants table access to signed-in users by default; the stub does not
grant all on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- A second person (worker) and an adviser on the demo farm
insert into auth.users (id, aud, role, email) values
  ('20000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'worker@agri-it.local'),
  ('20000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'adviser@agri-it.local'),
  ('20000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 'family@agri-it.local');

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

-- ---------------------------------------------------------------------------
-- As the farm owner
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';

-- Paid and owed: every older insert path still lands as paid on the day
insert into public.costs (id, farm_id, category, occurred_on, amount_eur) values ('c0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'other', '2026-10-01', 10);
select pg_temp.check((select payment_status = 'paid' and paid_on = '2026-10-01' from public.costs where id = 'c0000000-0000-0000-0000-000000000001'), 'a cost with no payment fields is paid on the day');
update public.costs set payment_status = 'owed', paid_on = '2026-10-01' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.check((select paid_on is null from public.costs where id = 'c0000000-0000-0000-0000-000000000001'), 'an owed cost never keeps a paid date');
select pg_temp.check((select count(*) = 0 from public.costs where payment_status = 'paid' and paid_on is null), 'no paid cost is missing its paid date (backfill)');

-- Part delivery keeps the order open; the rest closes it; undo reopens it
insert into public.feed_transactions (id, farm_id, feed_product_id, txn_type, quantity_kg, order_date, expected_delivery_date, effective_on, order_status, evidence)
select 'e0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', id, 'order', 10000, current_date, current_date + 2, current_date + 2, 'open', 'unconfirmed'
from public.feed_products where farm_id = '30000000-0000-0000-0000-000000000001' order by name limit 1;
select pg_temp.check((select placed and placed_on is null from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 'an order saved without the new field counts as placed (advisory G03)');
-- An order Agri-It drafted is an order to place until the farmer places it
insert into public.feed_transactions (id, farm_id, feed_product_id, txn_type, quantity_kg, order_date, effective_on, order_status, evidence, placed)
select 'e0000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', id, 'order', 4000, current_date, current_date, 'open', 'unconfirmed', false
from public.feed_products where farm_id = '30000000-0000-0000-0000-000000000001' order by name limit 1;
update public.feed_transactions set placed = true, placed_on = current_date where id = 'e0000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select placed and placed_on = current_date from public.feed_transactions where id = 'e0000000-0000-0000-0000-0000000000a1'), 'a drafted order becomes placed, with the day');
delete from public.feed_transactions where id = 'e0000000-0000-0000-0000-0000000000a1';
select public.record_feed_delivery('e0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
  (select feed_product_id from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 6000, current_date,
  p_total_price_eur => 2400, p_linked_order_id => 'e0000000-0000-0000-0000-000000000001', p_payment => 'account', p_due_on => current_date + 30, p_close_order => false);
select pg_temp.check((select order_status = 'open' from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 'a part delivery leaves the order open');
select pg_temp.check((select payment_status = 'owed' and due_on = current_date + 30 and paid_on is null from public.costs where feed_transaction_id = 'e0000000-0000-0000-0000-000000000002'), 'on account: the cost is owed with its due date');
-- The same call again (an offline retry) changes nothing
select public.record_feed_delivery('e0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
  (select feed_product_id from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 6000, current_date, p_total_price_eur => 2400);
select pg_temp.check((select count(*) = 1 from public.costs where feed_transaction_id = 'e0000000-0000-0000-0000-000000000002'), 'a retried delivery adds no second cost');
select public.record_feed_delivery('e0000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001',
  (select feed_product_id from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 4000, current_date,
  p_linked_order_id => 'e0000000-0000-0000-0000-000000000001', p_close_order => false);
select pg_temp.check((select order_status = 'delivered' from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 'the rest of the order closes it');
select public.undo_feed_delivery('e0000000-0000-0000-0000-000000000003');
select pg_temp.check((select order_status = 'open' from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 'undoing a part delivery reopens the order');
-- Older clients (no payment argument) keep the old behaviour: paid on delivery
select public.record_feed_delivery('e0000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001',
  (select feed_product_id from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000001'), 1000, current_date, p_total_price_eur => 400);
select pg_temp.check((select payment_status = 'paid' and paid_on = current_date from public.costs where feed_transaction_id = 'e0000000-0000-0000-0000-000000000004'), 'a queued call from an older app is paid on delivery');

-- Dated head counts
select public.set_head_count('40000000-0000-0000-0000-000000000003', 20, 'sold', current_date - 5);
select pg_temp.check(public.heads_on('40000000-0000-0000-0000-000000000003', current_date - 6) = 30, 'the day before a change uses the old count');
select pg_temp.check(public.heads_on('40000000-0000-0000-0000-000000000003', current_date) = 20, 'from the change on, the new count');
select public.set_head_count('40000000-0000-0000-0000-000000000003', 5, 'to be sold', current_date + 7);
select pg_temp.check((select head_count = 20 from public.animal_groups where id = '40000000-0000-0000-0000-000000000003'), 'a future change is not today''s count yet');
select pg_temp.check((select previous_count = 20 from public.head_count_history where animal_group_id = '40000000-0000-0000-0000-000000000003' and effective_on = current_date + 7), 'each change keeps the count it replaced');
-- Move animals: both groups change together, and a retry does nothing
select public.move_animals('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 10, current_date);
select public.move_animals('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 10, current_date);
select pg_temp.check((select head_count from public.animal_groups where id = '40000000-0000-0000-0000-000000000001') = 110
  and (select head_count from public.animal_groups where id = '40000000-0000-0000-0000-000000000002') = 50, 'moving 10 cows to heifers changes both, once');

-- Moving a routine to another day
insert into public.routine_completions (farm_id, routine_id, due_date, status, moved_to)
select farm_id, id, current_date - 1, 'moved', current_date + 1 from public.routines where farm_id = '30000000-0000-0000-0000-000000000001' limit 1;
select pg_temp.check((select count(*) = 1 from public.routine_completions where status = 'moved'), 'a routine occurrence can be moved');

-- Audit trail records who changed what
select pg_temp.check((select count(*) > 0 from public.audit_log where table_name = 'costs' and action = 'update' and changed_by = '20000000-0000-0000-0000-000000000001'), 'edits to money are in the audit trail with who made them');

-- Invite a farm worker, an adviser and family
create temp table invite_tokens (role text, token text) on commit drop;
insert into invite_tokens values
  ('worker', public.create_farm_invite('30000000-0000-0000-0000-000000000001', 'Worker@agri-it.local', 'worker')),
  ('advisor', public.create_farm_invite('30000000-0000-0000-0000-000000000001', 'adviser@agri-it.local', 'advisor')),
  ('member', public.create_farm_invite('30000000-0000-0000-0000-000000000001', 'family@agri-it.local', 'member'));
select set_config('agri.worker_token', (select token from invite_tokens where role = 'worker'), false);
select set_config('agri.adviser_token', (select token from invite_tokens where role = 'advisor'), false);
select set_config('agri.family_token', (select token from invite_tokens where role = 'member'), false);

-- ---------------------------------------------------------------------------
-- The invited people accept, and see what their role allows
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b2';
do $$ begin perform public.accept_farm_invite(current_setting('agri.worker_token')); raise exception 'FAILED: someone else used the worker''s invitation'; exception when others then if sqlerrm like 'FAILED%' then raise; end if; end $$;
select public.accept_farm_invite(current_setting('agri.adviser_token'));
select pg_temp.check((select count(*) > 0 from public.costs), 'the adviser can read money');
select pg_temp.check((select count(*) > 0 from public.audit_log), 'the adviser can read the change history');
do $$ begin
  insert into public.jobs (farm_id, title) values ('30000000-0000-0000-0000-000000000001', 'Adviser job');
  raise exception 'FAILED: an adviser could write';
exception when insufficient_privilege then raise notice 'ok: an adviser cannot write'; end $$;
do $$ begin
  insert into public.calf_births (farm_id, born_on) values ('30000000-0000-0000-0000-000000000001', current_date);
  raise exception 'FAILED: an adviser could record a calf';
exception when insufficient_privilege then raise notice 'ok: an adviser cannot record calves'; end $$;

set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
select public.accept_farm_invite(current_setting('agri.worker_token'));
select pg_temp.check((select count(*) = 0 from public.costs), 'a farm worker sees no costs');
select pg_temp.check((select count(*) = 0 from public.income), 'a farm worker sees no income');
select pg_temp.check((select count(*) = 0 from public.audit_log), 'a farm worker does not see the change history');
select pg_temp.check((select count(*) > 0 from public.feed_transactions), 'a farm worker sees feed');
insert into public.jobs (farm_id, title) values ('30000000-0000-0000-0000-000000000001', 'Worker job');
-- A delivery with a price from a worker records the feed but not the money
select public.record_feed_delivery('e0000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000001',
  (select id from public.feed_products where farm_id = '30000000-0000-0000-0000-000000000001' order by name limit 1), 2000, current_date, p_total_price_eur => 800);
select pg_temp.check((select count(*) = 1 from public.feed_transactions where id = 'e0000000-0000-0000-0000-000000000009'), 'a worker can record a delivery');
do $$ begin
  insert into public.costs (farm_id, category, occurred_on, amount_eur) values ('30000000-0000-0000-0000-000000000001', 'other', current_date, 5);
  raise exception 'FAILED: a worker could add a cost';
exception when insufficient_privilege then raise notice 'ok: a worker cannot add costs'; end $$;
-- Calving is farm work: a worker plans the season, records calves and answers suggestions
insert into public.calving_seasons (id, farm_id, label, herd, calving_start, calving_end, cows_due)
values ('5e000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Spring calving', 'dairy', current_date + 100, current_date + 170, 110);
insert into public.calf_births (id, farm_id, season_id, born_on, calves) values ('cb000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', current_date, 2);
update public.calf_births set tagged_on = current_date where id = 'cb000000-0000-0000-0000-000000000001';
insert into public.suggestion_decisions (farm_id, key, decision, until) values ('30000000-0000-0000-0000-000000000001', 'season:5e000000-0000-0000-0000-000000000001:bcs', 'snoozed', current_date + 7);
select pg_temp.check((select count(*) = 1 from public.calf_births where tagged_on = current_date), 'a worker records calves and marks them tagged');
do $$ begin
  insert into public.calf_births (farm_id, born_on, tagged_on) values ('30000000-0000-0000-0000-000000000001', current_date, current_date - 1);
  raise exception 'FAILED: a calf tagged before it was born';
exception when check_violation then raise notice 'ok: no tagging before birth'; end $$;
do $$ begin
  insert into public.suggestion_decisions (farm_id, key, decision) values ('30000000-0000-0000-0000-000000000001', 'x', 'snoozed');
  raise exception 'FAILED: not now with no date';
exception when check_violation then raise notice 'ok: not now needs a date'; end $$;
-- Fields and fertiliser (14 Oct 2026) are farm work: a worker adds fields, stock and spreading
insert into public.fields (id, farm_id, name, acres, use, spread_every_days) values
  ('f1000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'Paddock 1', 8, 'grazing', 21),
  ('f1000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000001', 'Paddock 2', 10, 'grazing', 21);
insert into public.fertiliser_products (id, farm_id, name, catalogue_key, low_stock_kg) values ('f2000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'CAN (27% N)', 'can', 1000);
insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date) values ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'count', 2000, current_date - 10);
insert into public.fertiliser_spreads (id, farm_id, product_id, spread_on, kg_per_acre, total_kg) values ('f3000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', current_date - 2, 50, 900);
insert into public.fertiliser_spread_fields (farm_id, spread_id, field_id, acres, kg) values
  ('30000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000a1', 8, 400),
  ('30000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000a2', 10, 500);
select pg_temp.check((select count(*) = 2 from public.fertiliser_spread_fields), 'a worker records spreading on two fields at once');
do $$ begin
  update public.fields set spread_every_days = 3 where id = 'f1000000-0000-0000-0000-0000000000a1';
  raise exception 'FAILED: a 3-day round allowed';
exception when check_violation then raise notice 'ok: a round is 7 to 120 days'; end $$;
do $$ begin
  insert into public.fertiliser_spreads (farm_id, product_id, spread_on, total_kg) values ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', current_date, 0);
  raise exception 'FAILED: spreading nothing allowed';
exception when check_violation then raise notice 'ok: spreading must be more than 0 kg'; end $$;
-- G11 (14 Oct 2026): adjustments with a reason, and why a check differed
insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date, reason) values
  ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'adjustment', -100, current_date - 1, 'wasted'),
  ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'count', 1500, current_date, 'count_error');
select pg_temp.check((select count(*) = 2 from public.fertiliser_stock where reason is not null), 'a worker records a fertiliser adjustment and a check with reasons');
do $$ begin
  insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date) values ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'delivery', -5, current_date);
  raise exception 'FAILED: a negative delivery allowed';
exception when check_violation then raise notice 'ok: only an adjustment can take stock off'; end $$;
do $$ begin
  insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date, reason) values ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'delivery', 500, current_date, 'wasted');
  raise exception 'FAILED: a reason on a delivery allowed';
exception when check_violation then raise notice 'ok: reasons only on checks and adjustments'; end $$;
do $$ begin
  insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date, reason) values ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'adjustment', -5, current_date, 'eaten by goats');
  raise exception 'FAILED: an unknown reason allowed';
exception when check_violation then raise notice 'ok: only the listed reasons'; end $$;
insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, effective_on, reason)
  select '30000000-0000-0000-0000-000000000001', id, 'adjustment', -200, current_date, 'fed_other_group' from public.feed_products where farm_id = '30000000-0000-0000-0000-000000000001' order by name limit 1;
select pg_temp.check((select count(*) = 1 from public.feed_transactions where reason = 'fed_other_group' and quantity_kg = -200), 'a worker takes feed off the stock with a reason');
do $$ begin
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, effective_on, reason)
    select '30000000-0000-0000-0000-000000000001', id, 'delivery', 1000, current_date, 'wasted' from public.feed_products where farm_id = '30000000-0000-0000-0000-000000000001' order by name limit 1;
  raise exception 'FAILED: a reason on a feed delivery allowed';
exception when check_violation then raise notice 'ok: feed reasons only on counts and adjustments'; end $$;
-- Fertiliser orders (14 Oct 2026): an order is open until delivered; a delivery points at it
insert into public.fertiliser_stock (id, farm_id, product_id, kind, quantity_kg, on_date, order_status, expected_on, price_per_tonne_eur) values
  ('f4000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'order', 4000, current_date, 'open', current_date + 3, 400);
insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date, linked_order_id) values
  ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'delivery', 2000, current_date, 'f4000000-0000-0000-0000-0000000000a1');
select pg_temp.check((select count(*) = 1 from public.fertiliser_stock where linked_order_id = 'f4000000-0000-0000-0000-0000000000a1'), 'a part delivery is recorded against a fertiliser order');
do $$ begin
  insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date) values ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'order', 1000, current_date);
  raise exception 'FAILED: an order with no status allowed';
exception when check_violation then raise notice 'ok: an order has a status'; end $$;
do $$ begin
  insert into public.fertiliser_stock (farm_id, product_id, kind, quantity_kg, on_date, price_per_tonne_eur) values ('30000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'delivery', 1000, current_date, 400);
  raise exception 'FAILED: an order price on a delivery allowed';
exception when check_violation then raise notice 'ok: agreed prices only on orders (a delivery''s price is its bill)'; end $$;
update public.fertiliser_stock set order_status = 'delivered' where id = 'f4000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select order_status = 'delivered' from public.fertiliser_stock where id = 'f4000000-0000-0000-0000-0000000000a1'), 'a worker closes a fertiliser order');
-- G12: why a suggestion was put off
insert into public.suggestion_decisions (farm_id, key, decision, until, reason) values ('30000000-0000-0000-0000-000000000001', 'heads:test', 'snoozed', current_date + 3, 'elsewhere');
select pg_temp.check((select reason = 'elsewhere' from public.suggestion_decisions where key = 'heads:test'), 'Not now keeps why it was put off');
do $$ begin
  insert into public.suggestion_decisions (farm_id, key, decision, until, reason) values ('30000000-0000-0000-0000-000000000001', 'heads:test2', 'snoozed', current_date + 3, 'lazy');
  raise exception 'FAILED: an unknown Not now reason allowed';
exception when check_violation then raise notice 'ok: Not now reasons are busy, done elsewhere or not relevant'; end $$;
-- Taking a spreading back takes its fields with it; another farm sees none of it
delete from public.fertiliser_spreads where id = 'f3000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select count(*) = 0 from public.fertiliser_spread_fields where spread_id = 'f3000000-0000-0000-0000-0000000000a1'), 'undoing a spreading removes it from every field');
select pg_temp.check((select count(*) > 0 from public.audit_log where table_name = 'fertiliser_spreads'), 'spreading is in the change history');
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.fields) and (select count(*) = 0 from public.fertiliser_products) and (select count(*) = 0 from public.fertiliser_stock), 'someone outside the farm sees no fields or fertiliser');

set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b3';
select public.accept_farm_invite(current_setting('agri.family_token'));
select pg_temp.check((select count(*) > 0 from public.costs), 'family can read money');
insert into public.costs (farm_id, category, occurred_on, amount_eur) values ('30000000-0000-0000-0000-000000000001', 'other', current_date, 5);
do $$ begin perform public.create_farm_invite('30000000-0000-0000-0000-000000000001', 'x@y.ie', 'worker'); raise exception 'FAILED: family could invite'; exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: only the owner invites'; end $$;

-- The worker's delivery had no cost (it was not theirs to record)
select pg_temp.check((select count(*) = 0 from public.costs where feed_transaction_id = 'e0000000-0000-0000-0000-000000000009'), 'no cost was added by the worker''s delivery');
select pg_temp.check((select count(*) = 4 from public.farm_members where farm_id = '30000000-0000-0000-0000-000000000001'), 'four people on the farm');
select pg_temp.check((select email from public.farm_members where user_id = '20000000-0000-0000-0000-0000000000b1') = 'worker@agri-it.local', 'members keep the email they joined with');
select pg_temp.check((select count(*) >= 2 from public.audit_log where table_name in ('calving_seasons', 'calf_births')), 'calving entries are in the change history');
-- Another farm's owner sees none of it
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.calving_seasons) and (select count(*) = 0 from public.calf_births) and (select count(*) = 0 from public.suggestion_decisions), 'someone outside the farm sees no calving records');

-- Breeds as a list (14 Oct 2026): older clients write one breed, newer ones a list; the two stay in step
update public.animal_groups set breed = 'Holstein Friesian' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check((select breeds = array['Holstein Friesian'] from public.animal_groups where id = '40000000-0000-0000-0000-000000000001'), 'an older client''s single breed becomes a list of one');
update public.animal_groups set breeds = array['Holstein Friesian', 'Jersey cross'] where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check((select breed = 'Holstein Friesian, Jersey cross' from public.animal_groups where id = '40000000-0000-0000-0000-000000000001'), 'a list of breeds keeps the old breed column in step');
update public.animal_groups set breeds = '{}' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check((select breed is null from public.animal_groups where id = '40000000-0000-0000-0000-000000000001'), 'no breeds clears the old breed column');
do $$ begin
  update public.animal_groups set breeds = array['a','b','c','d','e','f','g','h','i'] where id = '40000000-0000-0000-0000-000000000001';
  raise exception 'FAILED: nine breeds allowed';
exception when check_violation then raise notice 'ok: at most eight breeds'; end $$;
do $$ begin
  update public.animal_groups set breeds = array['  '] where id = '40000000-0000-0000-0000-000000000001';
  raise exception 'FAILED: blank breed allowed';
exception when check_violation then raise notice 'ok: no blank breeds'; end $$;
insert into public.animal_groups (id, farm_id, name, animal_class, breed, head_count)
  values ('40000000-0000-0000-0000-0000000000b7', '30000000-0000-0000-0000-000000000001', 'Old phone group', 'ewe', 'Texel cross', 10);
select pg_temp.check((select breeds = array['Texel cross'] and breed = 'Texel cross' from public.animal_groups where id = '40000000-0000-0000-0000-0000000000b7'), 'a group added with only a breed (older phone backup) gets the list');
update public.animal_groups set breeds = array['Holstein Friesian', 'British Friesian', 'Jersey cross', 'Norwegian Red'] where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check((select char_length(breed) <= 60 and breed like '%...' from public.animal_groups where id = '40000000-0000-0000-0000-000000000001'), 'a long list fits the old 60-character breed column');

-- Loans, annual statements and scheme payments (16 Oct 2026): money tables
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
insert into public.loans (id, farm_id, lender, kind, balance_eur, balance_on, rate_percent, repayment_eur, frequency, next_due, skip_months)
  values ('a1000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000001', 'AIB', 'loan', 100000, current_date, 5, 1000, 'monthly', current_date + 10, '{12,1,2,3}');
select pg_temp.check((select count(*) = 1 from public.loans where id = 'a1000000-0000-0000-0000-0000000000c1'), 'the owner adds a loan with seasonal months off');
insert into public.costs (id, farm_id, category, occurred_on, amount_eur, loan_id, interest_eur)
  values ('c0000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000001', 'loan_repayment', current_date, 1000, 'a1000000-0000-0000-0000-0000000000c1', 410.96);
insert into public.loan_statements (farm_id, loan_id, period_end, balance_eur, interest_eur) values ('30000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000c1', current_date, 99000, 410.96);
insert into public.expected_income (id, farm_id, scheme, label, scheme_year, part, amount_eur, expected_on, rule)
  values ('e1000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000001', 'biss', 'BISS 2026, balance', 2026, 'balance', 2500, current_date + 50, 'schemes@1.0');
insert into public.routines (farm_id, kind, title, frequency, day_of_month, interval_months, start_date, amount, category)
  values ('30000000-0000-0000-0000-000000000001', 'expense', 'Insurance', 'monthly', 1, 12, current_date, 1800, 'insurance');
update public.farms set herd_number = 'P7654321', acres_owned = 80, vat_status = 'flat_rate', setup = '{"loans":"done"}' where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) > 0 from public.audit_log where table_name = 'loans'), 'loans are in the change history');
do $$ begin
  insert into public.loans (farm_id, lender, balance_eur, balance_on, repayment_eur) values ('30000000-0000-0000-0000-000000000001', 'X', 1, current_date, 100);
  raise exception 'FAILED: a repayment with no frequency or date allowed';
exception when check_violation then raise notice 'ok: a repaying loan needs how often and when'; end $$;
do $$ begin
  insert into public.loans (farm_id, lender, balance_eur, balance_on, skip_months) values ('30000000-0000-0000-0000-000000000001', 'X', 1, current_date, '{13}');
  raise exception 'FAILED: month 13 allowed';
exception when check_violation then raise notice 'ok: skip months are 1 to 12'; end $$;
do $$ begin
  insert into public.costs (farm_id, category, occurred_on, amount_eur, interest_eur) values ('30000000-0000-0000-0000-000000000001', 'loan_repayment', current_date, 100, 150);
  raise exception 'FAILED: interest more than the repayment allowed';
exception when check_violation then raise notice 'ok: interest is never more than the repayment'; end $$;
do $$ begin
  update public.farms set setup = '[]' where id = '30000000-0000-0000-0000-000000000001';
  raise exception 'FAILED: setup must be an object';
exception when check_violation then raise notice 'ok: setup marks are an object'; end $$;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) = 0 from public.loans) and (select count(*) = 0 from public.loan_statements) and (select count(*) = 0 from public.expected_income), 'a farm worker sees no loans or scheme payments');
do $$ begin
  insert into public.loans (farm_id, lender, balance_eur, balance_on) values ('30000000-0000-0000-0000-000000000001', 'Sneaky', 1, current_date);
  raise exception 'FAILED: a worker could add a loan';
exception when insufficient_privilege or check_violation or others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a worker cannot add a loan'; end $$;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) >= 1 from public.loans) and (select count(*) >= 1 from public.expected_income), 'an adviser reads loans and scheme payments');
update public.loans set balance_eur = 1 where id = 'a1000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select balance_eur = 100000 from public.loans where id = 'a1000000-0000-0000-0000-0000000000c1'), 'an adviser cannot change a loan');
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.loans) and (select count(*) = 0 from public.expected_income), 'someone outside the farm sees no loans');
-- Removing a loan keeps its repayments (they were real money) and takes its statements
delete from public.loans where id = 'a1000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select loan_id is null from public.costs where id = 'c0000000-0000-0000-0000-0000000000c1'), 'a removed loan leaves its repayments as costs');
select pg_temp.check((select count(*) = 0 from public.loan_statements where loan_id = 'a1000000-0000-0000-0000-0000000000c1'), 'a removed loan takes its statements');
-- A scheme payment that came in points at its income; removing the income re-opens it
insert into public.income (id, farm_id, income_type, occurred_on, amount_eur, description) values ('a2000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000001', 'grant', current_date, 2500, 'BISS 2026, balance');
update public.expected_income set income_id = 'a2000000-0000-0000-0000-0000000000c1' where id = 'e1000000-0000-0000-0000-0000000000c1';
delete from public.income where id = 'a2000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select income_id is null from public.expected_income where id = 'e1000000-0000-0000-0000-0000000000c1'), 'removing the income puts the payment back to expected');
select pg_temp.check((select interval_months = 12 from public.routines where title = 'Insurance'), 'a yearly bill is a routine every 12 months');
select pg_temp.check((select count(*) = 0 from public.routines where interval_months <> 1 and title <> 'Insurance'), 'older routines are every month');

-- Reports module (21 Oct 2026): year-end values, and animals bought as their own cost category
insert into public.year_end_values (id, farm_id, kind, as_at, label, animal_group_id, head_count, unit_value_eur, value_eur, basis)
  values ('a3000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-000000000001', 'livestock', '2025-12-31', 'Dairy cows', '40000000-0000-0000-0000-000000000001', 120, 1400, 168000, 'market_value');
insert into public.year_end_values (id, farm_id, kind, as_at, label, value_eur, basis, note)
  values ('a3000000-0000-0000-0000-0000000000d2', '30000000-0000-0000-0000-000000000001', 'debtors', '2025-12-31', 'December milk cheque', 22000, 'farmer_estimate', 'Paid in January');
select pg_temp.check((select count(*) = 2 from public.year_end_values), 'year-end values are saved');
do $$ begin
  insert into public.year_end_values (farm_id, kind, as_at, label, animal_group_id, value_eur) values ('30000000-0000-0000-0000-000000000001', 'livestock', '2025-12-31', 'Dairy cows', '40000000-0000-0000-0000-000000000001', 1);
  raise exception 'FAILED: the same group valued twice on one day';
exception when unique_violation then raise notice 'ok: one value per group per day'; end $$;
do $$ begin
  insert into public.year_end_values (farm_id, kind, as_at, label, value_eur) values ('30000000-0000-0000-0000-000000000001', 'debtors', '2025-12-31', 'DECEMBER MILK CHEQUE', 1);
  raise exception 'FAILED: the same item named twice on one day';
exception when unique_violation then raise notice 'ok: one value per named item per day (case ignored)'; end $$;
do $$ begin
  insert into public.year_end_values (farm_id, kind, as_at, label, value_eur) values ('30000000-0000-0000-0000-000000000001', 'land', '2025-12-31', 'Home farm', -5);
  raise exception 'FAILED: a negative value';
exception when check_violation then raise notice 'ok: a value cannot be negative'; end $$;
do $$ begin
  insert into public.year_end_values (farm_id, kind, as_at, label, value_eur, basis) values ('30000000-0000-0000-0000-000000000001', 'land', '2025-12-31', 'Home farm', 5, 'guess');
  raise exception 'FAILED: an unknown basis';
exception when check_violation then raise notice 'ok: the basis must be one of the listed ones'; end $$;
do $$ begin
  insert into public.year_end_values (farm_id, kind, as_at, label, value_eur) values ('30000000-0000-0000-0000-000000000001', 'cars', '2025-12-31', 'Van', 5);
  raise exception 'FAILED: an unknown kind';
exception when check_violation then raise notice 'ok: the kind must be one of the listed ones'; end $$;
select pg_temp.check((select count(*) >= 2 from public.audit_log where table_name = 'year_end_values'), 'year-end values are in the change history');
update public.year_end_values set value_eur = 23000 where id = 'a3000000-0000-0000-0000-0000000000d2';
select pg_temp.check((select updated_at > created_at from public.year_end_values where id = 'a3000000-0000-0000-0000-0000000000d2'), 'a changed value is time-stamped');
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) = 0 from public.year_end_values), 'a farm worker sees no year-end values');
do $$ begin
  insert into public.year_end_values (farm_id, kind, as_at, label, value_eur) values ('30000000-0000-0000-0000-000000000001', 'land', '2025-12-31', 'Sneaky', 1);
  raise exception 'FAILED: a worker could add a value';
exception when insufficient_privilege or check_violation or others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a worker cannot add a year-end value'; end $$;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) = 2 from public.year_end_values), 'an adviser reads year-end values');
update public.year_end_values set value_eur = 1 where id = 'a3000000-0000-0000-0000-0000000000d2';
select pg_temp.check((select value_eur = 23000 from public.year_end_values where id = 'a3000000-0000-0000-0000-0000000000d2'), 'an adviser cannot change a year-end value');
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.year_end_values), 'someone outside the farm sees no year-end values');
insert into public.costs (id, farm_id, category, occurred_on, amount_eur, description)
  values ('c0000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-000000000001', 'livestock_purchase', current_date, 4000, '10 weanlings bought');
select pg_temp.check((select category = 'livestock_purchase' from public.costs where id = 'c0000000-0000-0000-0000-0000000000d1'), 'animals bought is a cost category');
-- Animal tags (22 Oct 2026): each animal as its own record
insert into public.animals (id, farm_id, tag_number, tag_source, animal_group_id, sex, breed, born_on)
  values ('a4000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-000000000001', '372123456781234', 'card_photo', '40000000-0000-0000-0000-000000000001', 'female', 'Holstein Friesian', '2024-02-05');
insert into public.animals (id, farm_id, tag_number) values ('a4000000-0000-0000-0000-0000000000e2', '30000000-0000-0000-0000-000000000001', 'IE041234567890');
select pg_temp.check((select count(*) = 2 from public.animals), 'animals are saved');
select pg_temp.check((select status = 'on_farm' and tag_source = 'typed' and left_on is null from public.animals where id = 'a4000000-0000-0000-0000-0000000000e2'), 'an animal added with just a tag is on the farm and typed');
do $$ begin
  insert into public.animals (farm_id, tag_number) values ('30000000-0000-0000-0000-000000000001', '372123456781234');
  raise exception 'FAILED: the same tag on the farm twice';
exception when unique_violation then raise notice 'ok: a tag number is one animal on a farm'; end $$;
do $$ begin
  insert into public.animals (farm_id, tag_number) values ('30000000-0000-0000-0000-000000000001', 'ie041234567891');
  raise exception 'FAILED: a lower case tag';
exception when check_violation then raise notice 'ok: tags are stored upper case'; end $$;
do $$ begin
  insert into public.animals (farm_id, tag_number) values ('30000000-0000-0000-0000-000000000001', '372 12 34567 8 1235');
  raise exception 'FAILED: a tag with spaces';
exception when check_violation then raise notice 'ok: tags are stored with no spaces'; end $$;
do $$ begin
  insert into public.animals (farm_id, tag_number, status) values ('30000000-0000-0000-0000-000000000001', 'IE041234567899', 'cow');
  raise exception 'FAILED: an unknown status';
exception when check_violation then raise notice 'ok: the status must be one of the listed ones'; end $$;
do $$ begin
  insert into public.animals (farm_id, tag_number, status, left_on) values ('30000000-0000-0000-0000-000000000001', 'IE041234567898', 'on_farm', '2026-01-01');
  raise exception 'FAILED: an animal on the farm with a leaving date';
exception when check_violation then raise notice 'ok: an animal on the farm has no leaving date'; end $$;
do $$ begin
  insert into public.animals (farm_id, tag_number, born_on, status, left_on) values ('30000000-0000-0000-0000-000000000001', 'IE041234567897', '2026-05-01', 'sold', '2026-01-01');
  raise exception 'FAILED: sold before it was born';
exception when check_violation then raise notice 'ok: an animal cannot leave before it was born'; end $$;
do $$ begin
  insert into public.animals (farm_id, tag_number, tag_source) values ('30000000-0000-0000-0000-000000000001', 'IE041234567896', 'guessed');
  raise exception 'FAILED: an unknown source';
exception when check_violation then raise notice 'ok: the source must be card photo or typed'; end $$;
update public.animals set status = 'sold', left_on = '2026-09-30' where id = 'a4000000-0000-0000-0000-0000000000e1';
select pg_temp.check((select updated_at > created_at from public.animals where id = 'a4000000-0000-0000-0000-0000000000e1'), 'a changed animal is time-stamped');
select pg_temp.check((select count(*) = 0 from public.audit_log where table_name = 'animals'), 'animals stay out of the change history, so a bulk load cannot bury the rest');
-- Species, castrated and a stage set by hand (22 Oct 2026)
select pg_temp.check((select species = 'cattle' and castrated is null and stage is null from public.animals where id = 'a4000000-0000-0000-0000-0000000000e2'), 'a new animal is cattle with no stage set by hand');
update public.animals set species = 'sheep', castrated = true, stage = 'wether' where id = 'a4000000-0000-0000-0000-0000000000e2';
select pg_temp.check((select species = 'sheep' and castrated and stage = 'wether' from public.animals where id = 'a4000000-0000-0000-0000-0000000000e2'), 'species, castrated and a stage can be set');
do $$ begin
  update public.animals set species = 'dragon' where id = 'a4000000-0000-0000-0000-0000000000e2';
  raise exception 'a made-up species was accepted';
exception when check_violation then null; end $$;
do $$ begin
  update public.animals set stage = 'Not A Stage' where id = 'a4000000-0000-0000-0000-0000000000e2';
  raise exception 'a stage with capitals and spaces was accepted';
exception when check_violation then null; end $$;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) = 2 from public.animals), 'a farm worker sees the animals');
insert into public.animals (id, farm_id, tag_number) values ('a4000000-0000-0000-0000-0000000000e3', '30000000-0000-0000-0000-000000000001', 'IE041234567895');
select pg_temp.check((select count(*) = 1 from public.animals where id = 'a4000000-0000-0000-0000-0000000000e3'), 'a farm worker can add an animal');
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) = 3 from public.animals), 'an adviser reads the animals');
update public.animals set note = 'changed' where id = 'a4000000-0000-0000-0000-0000000000e3';
select pg_temp.check((select note is null from public.animals where id = 'a4000000-0000-0000-0000-0000000000e3'), 'an adviser cannot change an animal');
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.animals), 'someone outside the farm sees no animals');
delete from public.animal_groups where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) = 1 and bool_and(animal_group_id is null) from public.animals where id = 'a4000000-0000-0000-0000-0000000000e1'), 'removing a group keeps its animals, with no group');
-- Deleting a farm takes its trail with it (no orphan audit rows, no FK errors)
delete from public.farms where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) = 0 from public.audit_log where farm_id = '30000000-0000-0000-0000-000000000001'), 'deleting a farm removes its audit trail cleanly');
select pg_temp.check((select count(*) = 0 from public.year_end_values where farm_id = '30000000-0000-0000-0000-000000000001'), 'deleting a farm removes its year-end values');
select pg_temp.check((select count(*) = 0 from public.animals where farm_id = '30000000-0000-0000-0000-000000000001'), 'deleting a farm removes its animals');
reset role;
rollback;

select 'Agri-It set up: ' || (select count(*) from pg_policies where schemaname = 'public') || ' security rules, '
  || (select count(*) from public.suppliers where farm_id is null) || ' directory suppliers, '
  || (select count(*) from public.supplier_branches) || ' branches, demo farm left out: '
  || (not exists (select 1 from public.farms))::text as result;
