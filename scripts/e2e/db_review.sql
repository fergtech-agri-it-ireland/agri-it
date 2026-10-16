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
begin;
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
commit;

-- ---------------------------------------------------------------------------
-- The invited people accept, and see what their role allows
-- ---------------------------------------------------------------------------
begin;
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
commit;

begin;
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
commit;
-- Taking a spreading back takes its fields with it; another farm sees none of it
delete from public.fertiliser_spreads where id = 'f3000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select count(*) = 0 from public.fertiliser_spread_fields where spread_id = 'f3000000-0000-0000-0000-0000000000a1'), 'undoing a spreading removes it from every field');
select pg_temp.check((select count(*) > 0 from public.audit_log where table_name = 'fertiliser_spreads'), 'spreading is in the change history');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.fields) and (select count(*) = 0 from public.fertiliser_products) and (select count(*) = 0 from public.fertiliser_stock), 'someone outside the farm sees no fields or fertiliser');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b3';
select public.accept_farm_invite(current_setting('agri.family_token'));
select pg_temp.check((select count(*) > 0 from public.costs), 'family can read money');
insert into public.costs (farm_id, category, occurred_on, amount_eur) values ('30000000-0000-0000-0000-000000000001', 'other', current_date, 5);
do $$ begin perform public.create_farm_invite('30000000-0000-0000-0000-000000000001', 'x@y.ie', 'worker'); raise exception 'FAILED: family could invite'; exception when others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: only the owner invites'; end $$;
commit;

-- The worker's delivery had no cost (it was not theirs to record)
select pg_temp.check((select count(*) = 0 from public.costs where feed_transaction_id = 'e0000000-0000-0000-0000-000000000009'), 'no cost was added by the worker''s delivery');
select pg_temp.check((select count(*) = 4 from public.farm_members where farm_id = '30000000-0000-0000-0000-000000000001'), 'four people on the farm');
select pg_temp.check((select email from public.farm_members where user_id = '20000000-0000-0000-0000-0000000000b1') = 'worker@agri-it.local', 'members keep the email they joined with');
select pg_temp.check((select count(*) >= 2 from public.audit_log where table_name in ('calving_seasons', 'calf_births')), 'calving entries are in the change history');
-- Another farm's owner sees none of it
begin;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.calving_seasons) and (select count(*) = 0 from public.calf_births) and (select count(*) = 0 from public.suggestion_decisions), 'someone outside the farm sees no calving records');
commit;

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
begin;
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
commit;
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
begin;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select count(*) = 0 from public.loans) and (select count(*) = 0 from public.loan_statements) and (select count(*) = 0 from public.expected_income), 'a farm worker sees no loans or scheme payments');
do $$ begin
  insert into public.loans (farm_id, lender, balance_eur, balance_on) values ('30000000-0000-0000-0000-000000000001', 'Sneaky', 1, current_date);
  raise exception 'FAILED: a worker could add a loan';
exception when insufficient_privilege or check_violation or others then if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: a worker cannot add a loan'; end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b2';
select pg_temp.check((select count(*) >= 1 from public.loans) and (select count(*) >= 1 from public.expected_income), 'an adviser reads loans and scheme payments');
update public.loans set balance_eur = 1 where id = 'a1000000-0000-0000-0000-0000000000c1';
select pg_temp.check((select balance_eur = 100000 from public.loans where id = 'a1000000-0000-0000-0000-0000000000c1'), 'an adviser cannot change a loan');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-0000000000b9';
select pg_temp.check((select count(*) = 0 from public.loans) and (select count(*) = 0 from public.expected_income), 'someone outside the farm sees no loans');
commit;
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

-- Deleting a farm takes its trail with it (no orphan audit rows, no FK errors)
delete from public.farms where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) = 0 from public.audit_log where farm_id = '30000000-0000-0000-0000-000000000001'), 'deleting a farm removes its audit trail cleanly');
\echo 'ALL REVIEW DB CHECKS PASSED'
