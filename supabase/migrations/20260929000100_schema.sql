-- Agri-It MVP schema
-- Money is numeric(12,2) euro so exported figures read cleanly for accountants.
-- Feed quantities are always stored in kg (spec 4.1).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.enterprise_type as enum ('dairy', 'suckler', 'beef', 'mixed', 'sheep', 'tillage', 'other');
create type public.jurisdiction as enum ('ROI', 'NI');
create type public.animal_class as enum (
  'dairy_cow', 'suckler_cow', 'in_calf_heifer', 'store_cattle', 'weanling',
  'calf', 'bull', 'finishing_cattle', 'ewe', 'lamb', 'other'
);
create type public.feed_txn_type as enum ('opening', 'order', 'delivery', 'count', 'adjustment');
create type public.feed_order_status as enum ('open', 'delivered', 'cancelled');
-- Evidence hierarchy (spec 1): measured > farm history > published research > scenario
create type public.evidence_source as enum ('measured', 'confirmed_docket', 'invoice_derived', 'farmer_estimate', 'unconfirmed');
create type public.safety_stock_mode as enum ('days', 'kg');
create type public.income_type as enum ('milk', 'livestock', 'grant', 'other');
create type public.cost_category as enum (
  'feed', 'fertiliser', 'contractor', 'vet_medicine', 'machinery_fuel', 'utilities', 'other'
);
create type public.record_type as enum ('feed_docket', 'invoice', 'fertiliser', 'medicine', 'movement', 'other');
create type public.confirmation_state as enum ('unconfirmed', 'confirmed');
create type public.silage_method as enum ('acreage', 'pit_dimensions', 'bale_count', 'measured_tonnes');
create type public.confidence_level as enum ('high', 'medium', 'low', 'scenario');
create type public.member_role as enum ('owner', 'member', 'advisor');

-- ---------------------------------------------------------------------------
-- Reference data: published evidence (spec 10: source + date for every benchmark)
-- ---------------------------------------------------------------------------
create table public.evidence_sources (
  code          text primary key,           -- e.g. 'S3'
  title         text not null,
  publisher     text not null,
  url           text not null,
  published_on  date,
  accessed_on   date not null
);

create table public.forage_benchmarks (
  id                  uuid primary key default gen_random_uuid(),
  animal_class        public.animal_class not null,
  fresh_tonnes_per_month numeric(6,2) not null check (fresh_tonnes_per_month > 0),
  source_code         text not null references public.evidence_sources(code),
  valid_from          date not null,
  notes               text,
  unique (animal_class, valid_from)
);

-- ---------------------------------------------------------------------------
-- Farm + membership (multi-user farm: farmer, family, advisor)
-- ---------------------------------------------------------------------------
create table public.farms (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  eircode                   text,              -- ROI; NI farms use postcode
  county                    text not null,
  jurisdiction              public.jurisdiction not null default 'ROI',
  enterprise                public.enterprise_type not null default 'dairy',
  financial_year_start_month smallint not null default 1 check (financial_year_start_month between 1 and 12),
  opening_cash_eur          numeric(12,2),
  opening_cash_date         date,
  default_lead_time_days    smallint check (default_lead_time_days between 0 and 60),
  forage_reserve_percent    smallint not null default 15 check (forage_reserve_percent between 0 and 50),
  housing_start             date,
  turnout_date              date,
  created_by                uuid not null default auth.uid() references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table public.farm_members (
  farm_id   uuid not null references public.farms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      public.member_role not null default 'member',
  added_at  timestamptz not null default now(),
  primary key (farm_id, user_id)
);
create index on public.farm_members (user_id);

-- ---------------------------------------------------------------------------
-- Animal groups
-- ---------------------------------------------------------------------------
create table public.animal_groups (
  id                    uuid primary key default gen_random_uuid(),
  farm_id               uuid not null references public.farms(id) on delete cascade,
  name                  text not null,
  animal_class          public.animal_class not null,
  head_count            integer not null default 0 check (head_count >= 0),
  head_count_updated_at timestamptz not null default now(),
  -- farm-history override for forage planning (t fresh silage / head / month)
  forage_t_per_head_month numeric(6,2) check (forage_t_per_head_month > 0),
  housed                boolean not null default true,
  archived              boolean not null default false,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now()
);
create index on public.animal_groups (farm_id);

create table public.head_count_history (
  id             uuid primary key default gen_random_uuid(),
  farm_id        uuid not null references public.farms(id) on delete cascade,
  animal_group_id uuid not null references public.animal_groups(id) on delete cascade,
  head_count     integer not null check (head_count >= 0),
  effective_on   date not null default current_date,
  reason         text not null default 'manual',
  created_at     timestamptz not null default now()
);
create index on public.head_count_history (animal_group_id, effective_on);

-- ---------------------------------------------------------------------------
-- Suppliers: global verified directory (farm_id null) + farm-added local suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  farm_id         uuid references public.farms(id) on delete cascade, -- null = shared directory
  name            text not null,
  network         text,
  coverage        public.jurisdiction[] not null default '{ROI}',
  central_phone   text,
  central_phone_label text,
  secondary_phone text,
  secondary_phone_label text,
  website         text,
  local_contact_method text,   -- how Agri-It resolves local contact (spec 7)
  source_url      text,
  verified_on     date,        -- null = not verified, UI must say so
  needs_live_directory boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on public.suppliers (farm_id);

create table public.supplier_branches (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  name         text not null,
  town         text,
  counties     text[] not null default '{}',   -- territory / catchment
  phone        text,
  contact_name text,                           -- only if publicly verified
  contact_role text,
  source_url   text not null,
  verified_on  date not null
);
create index on public.supplier_branches (supplier_id);

-- "My rep": farmer override. Commercial territories don't follow nearest-distance.
create table public.farm_supplier_settings (
  farm_id        uuid not null references public.farms(id) on delete cascade,
  supplier_id    uuid not null references public.suppliers(id) on delete cascade,
  rep_name       text,
  rep_phone      text,
  lead_time_days smallint check (lead_time_days between 0 and 60),
  account_number text,
  last_used_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (farm_id, supplier_id)
);

-- ---------------------------------------------------------------------------
-- Documents (dockets, invoices, photos) held in storage bucket 'records'
-- ---------------------------------------------------------------------------
create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  farm_id         uuid not null references public.farms(id) on delete cascade,
  record_type     public.record_type not null default 'other',
  storage_path    text,
  file_name       text,
  mime_type       text,
  extracted       jsonb,   -- OCR output (P1); never trusted until confirmed
  state           public.confirmation_state not null default 'unconfirmed',
  created_at      timestamptz not null default now()
);
create index on public.documents (farm_id);

-- ---------------------------------------------------------------------------
-- Purchased feed
-- ---------------------------------------------------------------------------
create table public.feed_products (
  id                 uuid primary key default gen_random_uuid(),
  farm_id            uuid not null references public.farms(id) on delete cascade,
  supplier_id        uuid references public.suppliers(id) on delete set null,
  name               text not null,          -- never infer nutrition from name
  storage_location   text,                   -- bin / silo / store
  safety_stock_mode  public.safety_stock_mode not null default 'days',
  safety_stock_value numeric(10,2) not null default 3 check (safety_stock_value >= 0),
  lead_time_days     smallint check (lead_time_days between 0 and 60), -- null = use supplier/farm setting
  analysis           jsonb,                  -- optional lab/declared analysis
  archived           boolean not null default false,
  created_at         timestamptz not null default now()
);
create index on public.feed_products (farm_id);

create table public.feed_transactions (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references public.farms(id) on delete cascade,
  feed_product_id  uuid not null references public.feed_products(id) on delete cascade,
  txn_type         public.feed_txn_type not null,
  quantity_kg      numeric(12,2) not null,
  -- stock only counts once delivered; order_date and delivery_date are distinct (spec 4.1)
  order_date       date,
  delivery_date    date,
  expected_delivery_date date,
  effective_on     date not null,     -- date the stock position changes (delivery/count date)
  order_status     public.feed_order_status,
  linked_order_id  uuid references public.feed_transactions(id) on delete set null,
  supplier_id      uuid references public.suppliers(id) on delete set null,
  total_price_eur  numeric(12,2) check (total_price_eur >= 0),
  price_per_tonne_eur numeric(10,2) check (price_per_tonne_eur >= 0),
  evidence         public.evidence_source not null default 'farmer_estimate',
  document_id      uuid references public.documents(id) on delete set null,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint qty_sign check (
    (txn_type in ('opening','order','delivery','count') and quantity_kg >= 0)
    or txn_type = 'adjustment'
  ),
  constraint order_has_status check ((txn_type = 'order') = (order_status is not null))
);
create index on public.feed_transactions (feed_product_id, effective_on);
create index on public.feed_transactions (farm_id, txn_type);

create table public.feeding_rules (
  id                   uuid primary key default gen_random_uuid(),
  farm_id              uuid not null references public.farms(id) on delete cascade,
  feed_product_id      uuid not null references public.feed_products(id) on delete cascade,
  animal_group_id      uuid not null references public.animal_groups(id) on delete cascade,
  head_count_override  integer check (head_count_override >= 0), -- null = follow group count
  kg_per_head_per_feed numeric(8,3) not null check (kg_per_head_per_feed >= 0),
  feeds_per_day        numeric(4,1) not null check (feeds_per_day > 0),
  start_date           date not null default current_date,
  end_date             date,
  is_temporary         boolean not null default false,
  label                text,
  created_at           timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index on public.feeding_rules (feed_product_id);

-- ---------------------------------------------------------------------------
-- Forage (silage / bales)
-- ---------------------------------------------------------------------------
create table public.silage_stores (
  id              uuid primary key default gen_random_uuid(),
  farm_id         uuid not null references public.farms(id) on delete cascade,
  name            text not null,
  method          public.silage_method not null,
  acreage         numeric(8,2),
  yield_t_per_acre numeric(6,2),       -- farmer's estimate, fresh
  length_m        numeric(6,2),
  width_m         numeric(6,2),
  avg_height_m    numeric(6,2),
  density_kg_m3   numeric(7,1),        -- farmer/advisor supplied, never defaulted
  bale_count      integer,
  bale_weight_kg  numeric(7,1),
  measured_tonnes numeric(10,2),
  dm_percent      numeric(5,2),
  dmd_percent     numeric(5,2),
  crude_protein_percent numeric(5,2),
  ph              numeric(4,2),
  measured_on     date not null default current_date,
  fed_out_tonnes  numeric(10,2) not null default 0,
  notes           text,
  created_at      timestamptz not null default now()
);
create index on public.silage_stores (farm_id);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
create table public.income (
  id              uuid primary key default gen_random_uuid(),
  farm_id         uuid not null references public.farms(id) on delete cascade,
  income_type     public.income_type not null,
  occurred_on     date not null,
  amount_eur      numeric(12,2) not null check (amount_eur >= 0),
  counterparty    text,
  milk_litres     numeric(12,1),
  fat_kg          numeric(10,2),
  protein_kg      numeric(10,2),
  animal_group_id uuid references public.animal_groups(id) on delete set null,
  head_count      integer check (head_count > 0),
  description     text,
  document_id     uuid references public.documents(id) on delete set null,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index on public.income (farm_id, occurred_on);

create table public.costs (
  id              uuid primary key default gen_random_uuid(),
  farm_id         uuid not null references public.farms(id) on delete cascade,
  category        public.cost_category not null,
  other_label     text,
  occurred_on     date not null,
  amount_eur      numeric(12,2) not null check (amount_eur >= 0),
  supplier_id     uuid references public.suppliers(id) on delete set null,
  supplier_name   text,
  feed_transaction_id uuid references public.feed_transactions(id) on delete cascade,
  description     text,
  document_id     uuid references public.documents(id) on delete set null,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index on public.costs (farm_id, occurred_on);
create index on public.costs (feed_transaction_id);

create table public.budget_lines (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms(id) on delete cascade,
  year        smallint not null,
  month       smallint check (month between 1 and 12),   -- null = annual
  kind        text not null check (kind in ('income','cost')),
  category    text not null,   -- income_type or cost_category value
  amount_eur  numeric(12,2) not null check (amount_eur >= 0),
  unique (farm_id, year, month, kind, category)
);

-- ---------------------------------------------------------------------------
-- Records (fertiliser, medicines, movements...) + jobs
-- ---------------------------------------------------------------------------
create table public.farm_records (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms(id) on delete cascade,
  record_type  public.record_type not null,
  occurred_on  date not null,
  title        text not null,
  details      jsonb not null default '{}'::jsonb,
  document_id  uuid references public.documents(id) on delete set null,
  state        public.confirmation_state not null default 'confirmed',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index on public.farm_records (farm_id, occurred_on);

create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms(id) on delete cascade,
  title       text not null,
  due_on      date,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.jobs (farm_id, done_at);

-- ---------------------------------------------------------------------------
-- Forecast governance (spec 10): every forecast stores inputs, rule version, time
-- ---------------------------------------------------------------------------
create table public.forecast_snapshots (
  id            uuid primary key default gen_random_uuid(),
  farm_id       uuid not null references public.farms(id) on delete cascade,
  forecast_type text not null,          -- 'feed_runout' | 'forage' | 'cash'
  subject_id    uuid,                   -- e.g. feed_product_id
  generated_at  timestamptz not null default now(),
  inputs_hash   text not null,
  inputs        jsonb not null,
  output        jsonb not null,
  confidence    public.confidence_level not null,
  rule_version  text not null
);
create index on public.forecast_snapshots (farm_id, forecast_type, subject_id, generated_at desc);
create unique index forecast_snapshot_dedupe on public.forecast_snapshots (subject_id, forecast_type, inputs_hash);

-- updated_at helper
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger farms_touch before update on public.farms for each row execute function public.touch_updated_at();
create trigger fss_touch before update on public.farm_supplier_settings for each row execute function public.touch_updated_at();
