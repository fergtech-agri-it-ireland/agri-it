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

-- Deleting a farm takes its trail with it (no orphan audit rows, no FK errors)
delete from public.farms where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) = 0 from public.audit_log where farm_id = '30000000-0000-0000-0000-000000000001'), 'deleting a farm removes its audit trail cleanly');
\echo 'ALL REVIEW DB CHECKS PASSED'
