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
