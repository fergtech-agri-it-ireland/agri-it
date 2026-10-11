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
