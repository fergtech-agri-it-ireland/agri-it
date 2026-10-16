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
