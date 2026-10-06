-- Row level security, storage and transactional RPCs.
-- Access model: a user sees a farm only through farm_members.
-- owner/member can write; advisor is read-only (e.g. accountant reviewing the year-end pack).

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_farm_member(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members m
                 where m.farm_id = p_farm_id and m.user_id = auth.uid());
$$;

create or replace function public.can_write_farm(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members m
                 where m.farm_id = p_farm_id and m.user_id = auth.uid()
                   and m.role in ('owner', 'member'));
$$;

create or replace function public.is_farm_owner(p_farm_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.farm_members m
                 where m.farm_id = p_farm_id and m.user_id = auth.uid() and m.role = 'owner');
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.evidence_sources      enable row level security;
alter table public.forage_benchmarks     enable row level security;
alter table public.farms                 enable row level security;
alter table public.farm_members          enable row level security;
alter table public.animal_groups         enable row level security;
alter table public.head_count_history    enable row level security;
alter table public.suppliers             enable row level security;
alter table public.supplier_branches     enable row level security;
alter table public.farm_supplier_settings enable row level security;
alter table public.documents             enable row level security;
alter table public.feed_products         enable row level security;
alter table public.feed_transactions     enable row level security;
alter table public.feeding_rules         enable row level security;
alter table public.silage_stores         enable row level security;
alter table public.income                enable row level security;
alter table public.costs                 enable row level security;
alter table public.budget_lines          enable row level security;
alter table public.farm_records          enable row level security;
alter table public.jobs                  enable row level security;
alter table public.forecast_snapshots    enable row level security;

-- Reference data: readable by any signed-in user, written only by service role
create policy "read evidence" on public.evidence_sources for select to authenticated using (true);
create policy "read benchmarks" on public.forage_benchmarks for select to authenticated using (true);

-- Farms
create policy "members read farm" on public.farms for select to authenticated
  using (public.is_farm_member(id));
create policy "writers update farm" on public.farms for update to authenticated
  using (public.can_write_farm(id)) with check (public.can_write_farm(id));
create policy "owner deletes farm" on public.farms for delete to authenticated
  using (public.is_farm_owner(id));
-- inserts go through public.create_farm()

-- Members
create policy "members see co-members" on public.farm_members for select to authenticated
  using (public.is_farm_member(farm_id));
create policy "owner manages members" on public.farm_members for all to authenticated
  using (public.is_farm_owner(farm_id)) with check (public.is_farm_owner(farm_id));

-- Generic farm-scoped tables: members read, owner/member write
do $$
declare t text;
begin
  foreach t in array array[
    'animal_groups','head_count_history','farm_supplier_settings','documents',
    'feed_products','feed_transactions','feeding_rules','silage_stores',
    'income','costs','budget_lines','farm_records','jobs','forecast_snapshots'
  ] loop
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_farm_member(farm_id))', t);
    execute format('create policy "writers insert %1$s" on public.%1$I for insert to authenticated with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers update %1$s" on public.%1$I for update to authenticated using (public.can_write_farm(farm_id)) with check (public.can_write_farm(farm_id))', t);
    execute format('create policy "writers delete %1$s" on public.%1$I for delete to authenticated using (public.can_write_farm(farm_id))', t);
  end loop;
end $$;

-- Suppliers: shared directory (farm_id null) is read-only; farm-added suppliers are editable
create policy "read directory and own suppliers" on public.suppliers for select to authenticated
  using (farm_id is null or public.is_farm_member(farm_id));
create policy "add own supplier" on public.suppliers for insert to authenticated
  with check (farm_id is not null and public.can_write_farm(farm_id));
create policy "edit own supplier" on public.suppliers for update to authenticated
  using (farm_id is not null and public.can_write_farm(farm_id))
  with check (farm_id is not null and public.can_write_farm(farm_id));
create policy "delete own supplier" on public.suppliers for delete to authenticated
  using (farm_id is not null and public.can_write_farm(farm_id));

create policy "read branches of visible suppliers" on public.supplier_branches for select to authenticated
  using (exists (select 1 from public.suppliers s where s.id = supplier_id
                 and (s.farm_id is null or public.is_farm_member(s.farm_id))));

-- ---------------------------------------------------------------------------
-- Storage: bucket 'records', object path = <farm_id>/<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('records', 'records', false, 10485760)
on conflict (id) do nothing;

create policy "members read farm files" on storage.objects for select to authenticated
  using (bucket_id = 'records' and public.is_farm_member(((storage.foldername(name))[1])::uuid));
create policy "writers upload farm files" on storage.objects for insert to authenticated
  with check (bucket_id = 'records' and public.can_write_farm(((storage.foldername(name))[1])::uuid));
create policy "writers delete farm files" on storage.objects for delete to authenticated
  using (bucket_id = 'records' and public.can_write_farm(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------------
-- RPCs. All accept a client-generated id so an offline retry is idempotent.
-- security invoker: RLS still applies to every statement.
-- ---------------------------------------------------------------------------

-- Create a farm and make the caller its owner (needed because farms has no insert policy)
create or replace function public.create_farm(
  p_name text, p_county text, p_eircode text default null,
  p_jurisdiction public.jurisdiction default 'ROI',
  p_enterprise public.enterprise_type default 'dairy',
  p_default_lead_time_days smallint default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.farms (name, county, eircode, jurisdiction, enterprise, default_lead_time_days, created_by)
  values (trim(p_name), p_county, nullif(upper(trim(p_eircode)), ''), p_jurisdiction, p_enterprise, p_default_lead_time_days, auth.uid())
  returning id into v_id;
  insert into public.farm_members (farm_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

-- Feed delivery: one entry updates stock, cost, cash flow, order status and supplier history.
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
  p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_total numeric := p_total_price_eur;
  v_ppt   numeric := p_price_per_tonne_eur;
  v_product text;
  v_supplier_name text;
begin
  if exists (select 1 from public.feed_transactions where id = p_id) then
    return p_id; -- already synced
  end if;
  if p_quantity_kg is null or p_quantity_kg <= 0 then
    raise exception 'Quantity must be more than zero';
  end if;

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
    update public.feed_transactions set order_status = 'delivered'
    where id = p_linked_order_id and txn_type = 'order';
  end if;

  if v_total is not null and v_total > 0 then
    select name into v_product from public.feed_products where id = p_feed_product_id;
    select name into v_supplier_name from public.suppliers where id = p_supplier_id;
    insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_id, supplier_name,
                              feed_transaction_id, description, document_id)
    values (p_farm_id, 'feed', p_delivery_date, v_total, p_supplier_id, v_supplier_name,
            p_id, coalesce(v_product, 'Feed') || ' ' || round(p_quantity_kg / 1000, 2) || ' t', p_document_id);
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
