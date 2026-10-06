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
