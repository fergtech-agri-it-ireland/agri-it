-- Sharing end to end on the hosted project (owner, family, farm worker, adviser).
-- Runs as ONE transaction that is rolled back: the test users, their farm and every row they
-- make are gone afterwards. Run through the Supabase connector (execute_sql) or the SQL editor.
-- Every check raises an error naming what failed; the final select proves nothing was left.
-- Also runs on scratch Postgres: psql -v ON_ERROR_STOP=1 -f scripts/e2e/sharing_live.sql

begin;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; end $$;
-- Act as a signed-in person (what the API does for each request)
create function pg_temp.act(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

insert into auth.users (id, aud, role, email) values
  ('5e000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@agri-it.test'),
  ('5e000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'family@agri-it.test'),
  ('5e000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'worker@agri-it.test'),
  ('5e000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'adviser@agri-it.test');
create temp table t (k text primary key, v text);
grant all on t to authenticated;

-- Owner sets up a farm with a feed and a bill, and invites three people
select pg_temp.act('5e000000-0000-4000-8000-000000000001');
insert into t values ('farm', public.create_farm('Sharing Test Farm', 'Tipperary', null, 'ROI', '{dairy}', null));
insert into public.feed_products (id, farm_id, name) select '5e000000-0000-4000-8000-0000000000f1', v::uuid, 'Dairy nut' from t where k = 'farm';
insert into public.costs (id, farm_id, category, occurred_on, amount_eur) select '5e000000-0000-4000-8000-0000000000c1', v::uuid, 'vet_medicine', current_date, 120 from t where k = 'farm';
insert into t select 'inv-family', public.create_farm_invite(v::uuid, 'Family@agri-it.test', 'member') from t where k = 'farm';
insert into t select 'inv-worker', public.create_farm_invite(v::uuid, 'worker@agri-it.test', 'worker') from t where k = 'farm';
insert into t select 'inv-adviser', public.create_farm_invite(v::uuid, 'adviser@agri-it.test', 'advisor') from t where k = 'farm';
select pg_temp.check((select count(*) = 3 from public.farm_invites where farm_id = (select v::uuid from t where k = 'farm') and accepted_at is null), 'owner sees three open invitations');
select pg_temp.check(pg_temp.fails($q$select public.create_farm_invite((select v::uuid from t where k = 'farm'), 'x@agri-it.test', 'owner')$q$), 'nobody can be invited as a second owner');

-- The wrong person can't use an invitation
select pg_temp.act('5e000000-0000-4000-8000-000000000004');
select pg_temp.check(pg_temp.fails($q$select public.accept_farm_invite((select v from t where k = 'inv-worker'))$q$), 'an invitation only works for the email it was sent to');
select pg_temp.check((select count(*) = 0 from public.farms), 'before accepting, the adviser sees no farm');
select pg_temp.check(public.accept_farm_invite((select v from t where k = 'inv-adviser')) = (select v::uuid from t where k = 'farm'), 'adviser joins with their own invitation');
select pg_temp.check(public.accept_farm_invite((select v from t where k = 'inv-adviser')) = (select v::uuid from t where k = 'farm'), 'opening the same link again is harmless');
select pg_temp.act('5e000000-0000-4000-8000-000000000003');
select pg_temp.check(public.accept_farm_invite((select v from t where k = 'inv-worker')) is not null, 'farm worker joins');
select pg_temp.act('5e000000-0000-4000-8000-000000000002');
select pg_temp.check(public.accept_farm_invite((select v from t where k = 'inv-family')) is not null, 'family joins (email matched without caring about capitals)');
select pg_temp.act('5e000000-0000-4000-8000-000000000001');
select pg_temp.check(pg_temp.fails($q$select public.accept_farm_invite((select v from t where k = 'inv-family'))$q$), 'a used invitation cannot be used by someone else');

-- Family or partner: sees and writes money
select pg_temp.act('5e000000-0000-4000-8000-000000000002');
select pg_temp.check((select count(*) = 1 from public.costs), 'family sees the bills');
insert into public.costs (id, farm_id, category, occurred_on, amount_eur, payment_status, due_on)
select '5e000000-0000-4000-8000-0000000000c2', v::uuid, 'contractor', current_date, 900, 'owed', current_date + 30 from t where k = 'farm';
select pg_temp.check((select count(*) = 2 from public.costs), 'family adds an owed bill');

-- Farm worker: records farm work, sees and writes no money
select pg_temp.act('5e000000-0000-4000-8000-000000000003');
select pg_temp.check((select count(*) = 1 from public.farms), 'worker sees the farm');
select pg_temp.check((select count(*) = 0 from public.costs), 'worker sees no bills');
select pg_temp.check((select count(*) = 0 from public.income), 'worker sees no income');
select pg_temp.check((select count(*) = 0 from public.budget_lines), 'worker sees no budget');
select pg_temp.check((select count(*) = 0 from public.audit_log), 'worker cannot read the change history (it holds money)');
select pg_temp.check(pg_temp.fails($q$insert into public.costs (farm_id, category, occurred_on, amount_eur) select v::uuid, 'other', current_date, 5 from t where k = 'farm'$q$), 'worker cannot add a bill');
select public.record_feed_delivery('5e000000-0000-4000-8000-0000000000d1', (select v::uuid from t where k = 'farm'), '5e000000-0000-4000-8000-0000000000f1', 3000, current_date, p_total_price_eur => 1200);
select pg_temp.check((select count(*) = 1 from public.feed_transactions where id = '5e000000-0000-4000-8000-0000000000d1'), 'worker records a feed delivery');
select pg_temp.check(pg_temp.fails($q$update public.farm_members set role = 'owner' where user_id = '5e000000-0000-4000-8000-000000000003'$q$) or (select role::text from public.farm_members where user_id = '5e000000-0000-4000-8000-000000000003') = 'worker', 'worker cannot promote themselves');

-- Adviser: reads everything including money and history, changes nothing
select pg_temp.act('5e000000-0000-4000-8000-000000000004');
select pg_temp.check((select count(*) = 2 from public.costs), 'adviser sees the bills, and the worker''s priced delivery added no cost');
select pg_temp.check(pg_temp.fails($q$insert into public.jobs (farm_id, title) select v::uuid, 'Not allowed' from t where k = 'farm'$q$), 'adviser cannot add a job');
update public.costs set amount_eur = 1 where id = '5e000000-0000-4000-8000-0000000000c1';
select pg_temp.check((select amount_eur = 120 from public.costs where id = '5e000000-0000-4000-8000-0000000000c1'), 'adviser cannot change a bill');
select pg_temp.check((select count(*) > 0 from public.audit_log), 'adviser reads the change history');

-- Change history: who did what, in their own name
select pg_temp.act('5e000000-0000-4000-8000-000000000001');
select pg_temp.check((select changed_by_label = 'family@agri-it.test' and action = 'insert' from public.audit_log where row_id = '5e000000-0000-4000-8000-0000000000c2'), 'history says family added the owed bill');
select pg_temp.check((select changed_by_label = 'worker@agri-it.test' from public.audit_log where row_id = '5e000000-0000-4000-8000-0000000000d1' and action = 'insert'), 'history says the worker recorded the delivery');
update public.costs set payment_status = 'paid', paid_on = current_date where id = '5e000000-0000-4000-8000-0000000000c2';
select pg_temp.check((select count(*) = 1 from public.audit_log where row_id = '5e000000-0000-4000-8000-0000000000c2' and action = 'update' and changed_by_label = 'owner@agri-it.test'
  and old_row->>'payment_status' = 'owed' and new_row->>'payment_status' = 'paid'), 'history shows the owner paying it, with before and after');
select pg_temp.check(not pg_temp.fails($q$insert into public.jobs (farm_id, title) select v::uuid, 'Fix the gate' from t where k = 'farm'$q$), 'the same job insert works for the owner (so the adviser was refused by the rules)');
select pg_temp.check((select count(*) = 4 from public.farm_members), 'four people on the farm');
select pg_temp.check((select count(*) = 3 from public.farm_invites where accepted_at is not null), 'all three invitations used');

reset role;
rollback;

select (select count(*) from auth.users where email like '%@agri-it.test') as test_users_left,
       (select count(*) from public.farms where name = 'Sharing Test Farm') as test_farms_left;
