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
