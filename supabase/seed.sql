-- Agri-It local seed. Runs on `supabase db reset` (and first `supabase start`).
-- 1) Reference data: evidence sources, forage benchmarks, supplier directory
-- 2) A demo login + demo farm so every screen has data to look at.
--
-- IMPORTANT: supplier phone numbers below are copied from the Agri-It MVP Overview
-- (September 2026, sources S7 to S15). They are stamped verified_on 2026-09-01 to
-- reflect that document. Re-verify against each source_url before any production use.

-- ---------------------------------------------------------------------------
-- Evidence sources
-- ---------------------------------------------------------------------------
insert into public.evidence_sources (code, title, publisher, url, published_on, accessed_on) values
('S1','Financial Analysis','Teagasc','https://teagasc.ie/rural-economy/farm-management/financial-analysis/',null,'2026-09-01'),
('S2','Irish Farm Report 2026','Ifac','https://www.ifac.ie/irish-farm-report-2026',null,'2026-09-01'),
('S3','Act Now to Assess Winter Feed Demand and Plan for the Winter Ahead','Teagasc','https://teagasc.ie/news--events/daily/act-now-to-assess-winter-feed-demand-and-plan-for-the-winter-ahead/',null,'2026-09-01'),
('S4','Making quality silage on beef farms','Teagasc','https://teagasc.ie/insights/making-quality-silage-on-beef-farms/',null,'2026-09-01'),
('S5','4 key winter housing considerations','Teagasc','https://teagasc.ie/news--events/daily/4-key-winter-housing-considerations/',null,'2026-09-01'),
('S6','Financial Analysis Tools','Teagasc','https://teagasc.ie/rural-economy/farm-management/financial-analysis/get-farm-financially-fit/tools/',null,'2026-09-01');

-- Teagasc winter planning allowances, fresh pit silage per head per month (S3)
insert into public.forage_benchmarks (animal_class, fresh_tonnes_per_month, source_code, valid_from, notes) values
('dairy_cow',      1.6, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('suckler_cow',    1.4, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('in_calf_heifer', 1.3, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('store_cattle',   1.3, 'S3', '2026-09-01', 'Planning allowance; use farm history where available'),
('weanling',       0.7, 'S3', '2026-09-01', 'Planning allowance; use farm history where available');

-- ---------------------------------------------------------------------------
-- Supplier directory (shared, farm_id null). Named reps are NOT seeded: none are
-- publicly mapped in the source data, so the app falls back to central numbers.
-- ---------------------------------------------------------------------------
insert into public.suppliers (id, name, network, coverage, central_phone, central_phone_label,
  secondary_phone, secondary_phone_label, website, local_contact_method, source_url, verified_on, needs_live_directory) values
('10000000-0000-0000-0000-000000000001','Tirlán FarmLife','GAIN Feeds','{ROI}','0818 321 321','Customer services',
  null,null,'https://www.tirlanfarmlife.com',
  'Customer services can connect you to your local Business Manager. Use the Tirlán store finder with your Eircode or town.',
  'https://www.tirlanfarmlife.com/about-us/contact-us/contact','2026-10-11',false),
('10000000-0000-0000-0000-000000000002','Dairygold Agri Business',null,'{ROI}','025 24411','Agri Business',
  '022 31644','Inside Sales','https://www.dairygoldagri.ie',
  'Dairygold publishes its dairy, beef and tillage sales advisers by team. Inside Sales can put you through to yours; save them as your rep once you know them.',
  'https://www.dairygoldagri.ie/contact-us/our-team/','2026-10-11',false),
('10000000-0000-0000-0000-000000000003','Lakeland Dairies Agribusiness',null,'{ROI,NI}','0818 474720','ROI agribusiness',
  '+44 28 3026 2311','NI agribusiness','https://lakelanddairies.com',
  'These numbers come from the September 2026 product document and could not be re-checked on 11 or 14 Oct 2026 (its website blocks automated checks). Check them on the Lakeland contact page before relying on them.',
  'https://lakelanddairies.com/contact-us',null,false),
('10000000-0000-0000-0000-000000000004','Aurivo Agribusiness','Nutrias','{ROI}','071 9186500','Agribusiness',
  null,null,'https://www.aurivo.ie',
  'Current Aurivo agribusiness contact or branch data; central number as fallback.',
  'https://www.aurivo.ie/overview/','2026-10-11',false),
('10000000-0000-0000-0000-000000000005','Arrabawn Tipperary Co-op','Dan O''Connor Feeds','{ROI}',null,null,
  null,null,null,
  'Arrabawn and Tipperary Co-op merged in Feb 2025. Contacts must come from the merged co-op''s live directory, not legacy Arrabawn data.',
  'https://www.rte.ie/news/business/2025/0228/1499516-arrabawn-tipperary-co-operative-society/',null,true),
('10000000-0000-0000-0000-000000000006','Drummonds',null,'{ROI}','01 825 5011','Head office (Clonee)',
  null,null,'https://drummonds.ie',
  'Branch phones are listed by county. If there is more than one branch in your county, pick yours with Set my rep.',
  'https://drummonds.ie/contact-us/','2026-10-11',false),
('10000000-0000-0000-0000-000000000007','Fane Valley Feeds',null,'{NI}','028 9261 9620','Fane Valley main line',
  null,null,'https://fanevalley.com',
  'The Fane Valley site lists one main number and no separate Feeds line. Ask for Feeds, then save your adviser as your rep.',
  'https://fanevalley.com/','2026-10-11',false);

-- Drummonds branches (drummonds.ie/contact-us, checked 11 Oct 2026). Each serves its own county.
insert into public.supplier_branches (id, supplier_id, name, town, counties, phone, source_url, verified_on) values
('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','Drummonds Ardee','Ardee','{Louth}','041 685 3332','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000006','Drummonds Drogheda','Drogheda','{Louth}','041 983 8986','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000006','Drummonds Dromone','Oldcastle','{Meath}','044 967 2650','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000006','Drummonds Knockbridge','Dundalk','{Louth}','042 937 4480','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000006','Drummonds Lusk','Lusk','{Dublin}','01 525 2903','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','Drummonds Mullingar','Mullingar','{Westmeath}','044 936 2022','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000006','Drummonds Navan','Navan','{Meath}','046 902 1641','https://drummonds.ie/contact-us/','2026-10-11'),
('11000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000006','Drummonds Rathcoffey','Rathcoffey','{Kildare}','087 400 3896','https://drummonds.ie/contact-us/','2026-10-11')
on conflict (id) do nothing;


-- Brett Brothers, Roche's Feeds, Howard Farms (checked on their own websites 14 Oct 2026) and
-- Star Fuels & Farm Supplies (website down that day: not verified, no number).
insert into public.suppliers (id, name, network, coverage, central_phone, central_phone_label,
  secondary_phone, secondary_phone_label, website, local_contact_method, area_served, source_url, verified_on, needs_live_directory)
select v.id::uuid, v.name, v.network, v.coverage::public.jurisdiction[], v.central_phone, v.central_phone_label,
  null, null, v.website, v.local_contact_method, v.area_served, v.source_url, v.verified_on::date, v.needs_live_directory
from (values
('10000000-0000-0000-0000-000000000008', 'Brett Brothers', null, '{ROI}', '056 775 5300', 'Head office (Callan)',
  'https://www.brettbrothers.ie',
  'Four branches, each with its own number. If more than one is near you, pick yours with Set my rep.',
  'Leinster and Munster (branches in Kilkenny, Tipperary and Waterford)',
  'https://www.brettbrothers.ie/contact/', '2026-10-14', false),
('10000000-0000-0000-0000-000000000009', 'Roche''s Feeds', 'J. H. Roche & Sons', '{ROI}', '061 308 111', 'Roche''s Feeds, Dock Road, Limerick',
  'https://www.rochesfeeds.com',
  'One number on its website, for the mill on the Dock Road in Limerick. It lists no branches or reps: save yours with Set my rep.',
  null,
  'https://www.rochesfeeds.com/contact', '2026-10-14', false),
('10000000-0000-0000-0000-00000000000a', 'Howard Farms', null, '{ROI}', '022 26184', 'Head office (Kilcanway, Mallow)',
  'https://www.howardfarms.ie',
  'Howard Farms names an area contact for each part of Munster on its website. Where two cover your county, pick yours with Set my rep.',
  'Clare, Cork, Kerry, Limerick, Tipperary and Waterford (from its area contacts)',
  'https://www.howardfarms.ie/contact-us/', '2026-10-14', false),
('10000000-0000-0000-0000-00000000000b', 'Star Fuels & Farm Supplies', null, '{ROI}', null, null,
  'https://starfuels.ie',
  'Its website was down when checked on 14 Oct 2026, so Agri-It has no checked number yet. Add the branch you use with Set my rep.',
  'Clonmel and Mitchelstown (not checked)',
  'https://starfuels.ie/', null, true)
) as v(id, name, network, coverage, central_phone, central_phone_label, website, local_contact_method, area_served, source_url, verified_on, needs_live_directory)
on conflict (id) do nothing;

insert into public.supplier_branches (id, supplier_id, name, town, counties, phone, contact_name, contact_role, source_url, verified_on)
select v.id::uuid, v.supplier_id::uuid, v.name, v.town, v.counties::text[], v.phone, v.contact_name, v.contact_role, v.source_url, v.verified_on::date from (values
('11000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Callan', 'Callan', '{Kilkenny}', '056 775 5300', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Windgap', 'Windgap', '{Kilkenny}', '051 648 204', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Ardfinnan', 'Ardfinnan', '{Tipperary}', '052 746 6208', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000008', 'Brett Brothers Portlaw', 'Portlaw', '{Waterford}', '051 387 396', null, null, 'https://www.brettbrothers.ie/contact/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Clare and Limerick', null, '{Clare,Limerick}', '087 138 0693', 'Bryan King', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, East Cork, East Limerick, Tipperary and Waterford', null, '{Cork,Limerick,Tipperary,Waterford}', '087 218 8294', 'Robert Meagher', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Cork', null, '{Cork}', '087 288 6041', 'John McLoughlin', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14'),
('11000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-00000000000a', 'Howard Farms, Kerry', null, '{Kerry}', '087 131 5577', 'William O''Connor', 'Area contact', 'https://www.howardfarms.ie/contact-us/', '2026-10-14')
) as v(id, supplier_id, name, town, counties, phone, contact_name, contact_role, source_url, verified_on)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Demo login: demo@agri-it.local / agri-it-demo
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values (
  '00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'demo@agri-it.local', crypt('agri-it-demo', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"name":"Demo Farmer"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '{"sub":"20000000-0000-0000-0000-000000000001","email":"demo@agri-it.local","email_verified":true}',
  'email', now(), now(), now());

-- ---------------------------------------------------------------------------
-- Demo farm. Dates are relative to the day you reset, so the demo never goes stale.
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid := '20000000-0000-0000-0000-000000000001';
  f uuid := '30000000-0000-0000-0000-000000000001';
  g_cows uuid := '40000000-0000-0000-0000-000000000001';
  g_heif uuid := '40000000-0000-0000-0000-000000000002';
  g_wean uuid := '40000000-0000-0000-0000-000000000003';
  g_calf uuid := '40000000-0000-0000-0000-000000000004';
  p_nut  uuid := '50000000-0000-0000-0000-000000000001';
  p_calf uuid := '50000000-0000-0000-0000-000000000002';
  tirlan uuid := '10000000-0000-0000-0000-000000000001';
  d date := current_date;
  m int;
begin
  insert into public.farms (id, name, eircode, county, jurisdiction, enterprise, enterprises, financial_year_start_month,
    opening_cash_eur, opening_cash_date, default_lead_time_days, forage_reserve_percent,
    housing_start, turnout_date, created_by)
  values (f, 'Glenview Farm', 'E91 X000', 'Tipperary', 'ROI', 'dairy', array['dairy'], 1,
    38000, date_trunc('year', d)::date, 3, 15,
    make_date(extract(year from d)::int, 11, 1), make_date(extract(year from d)::int + 1, 2, 28), u);
  insert into public.farm_members (farm_id, user_id, role) values (f, u, 'owner');

  insert into public.animal_groups (id, farm_id, name, animal_class, breed, head_count, sort_order, housed) values
    (g_cows, f, 'Dairy cows', 'dairy_cow', 'Holstein Friesian', 120, 1, true),
    (g_heif, f, 'In-calf heifers', 'in_calf_heifer', 'Holstein Friesian', 40, 2, true),
    (g_wean, f, 'Weanlings', 'weanling', 'Aberdeen Angus', 30, 3, true),
    (g_calf, f, 'Calves', 'calf', 'Mixed', 18, 4, true);
  insert into public.head_count_history (farm_id, animal_group_id, head_count, effective_on, reason)
  select f, id, head_count, d - 20, 'opening' from public.animal_groups where farm_id = f;

  insert into public.farm_supplier_settings (farm_id, supplier_id, lead_time_days, last_used_at)
  values (f, tirlan, 3, now() - interval '4 days');

  insert into public.feed_products (id, farm_id, supplier_id, name, storage_location, safety_stock_mode, safety_stock_value)
  values (p_nut, f, tirlan, 'Dairy nut 16%', 'Bin 1', 'days', 3),
         (p_calf, f, tirlan, 'Calf ration', 'Shed store', 'kg', 150);

  -- Dairy nut: counted 20 days ago, then an 8 t delivery 4 days ago
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, effective_on, evidence, notes)
  values (f, p_nut, 'count', 6200, d - 20, 'measured', 'Bin dipped');
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, order_date, delivery_date,
    effective_on, supplier_id, total_price_eur, price_per_tonne_eur, evidence)
  values (f, p_nut, 'delivery', 8000, d - 7, d - 4, d - 4, tirlan, 3120, 390, 'confirmed_docket');
  insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_id, supplier_name, description)
  values (f, 'feed', d - 4, 3120, tirlan, 'Tirlán FarmLife', 'Dairy nut 16% 8 t');
  -- An open order not yet delivered: must NOT count as stock
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, order_date,
    expected_delivery_date, effective_on, order_status, supplier_id, evidence)
  values (f, p_calf, 'order', 1000, d - 1, d + 2, d + 2, 'open', tirlan, 'unconfirmed');

  -- Calf ration: estimated opening stock, so confidence should drop to low
  insert into public.feed_transactions (farm_id, feed_product_id, txn_type, quantity_kg, effective_on, evidence, notes)
  values (f, p_calf, 'opening', 500, d - 6, 'farmer_estimate', 'Roughly 20 bags');

  -- Rules set up two mornings ago (when ticking began), so Today's checklist only reaches back that far
  insert into public.feeding_rules (id, farm_id, feed_product_id, animal_group_id, kg_per_head_per_feed, feeds_per_day, start_date, label, created_at)
  values ('60000000-0000-0000-0000-000000000001', f, p_nut, g_cows, 1.0, 2, d - 30, null, (d - 2)::timestamptz + interval '6 hours'),
         ('60000000-0000-0000-0000-000000000002', f, p_nut, g_heif, 1.0, 1, d - 30, null, (d - 2)::timestamptz + interval '6 hours'),
         ('60000000-0000-0000-0000-000000000003', f, p_calf, g_calf, 1.5, 1, d - 30, null, (d - 2)::timestamptz + interval '6 hours');
  -- temporary plan: replaces the cows' normal rate for 10 days, then reverts automatically
  insert into public.feeding_rules (farm_id, feed_product_id, animal_group_id, kg_per_head_per_feed, feeds_per_day,
    start_date, end_date, is_temporary, label)
  values (f, p_nut, g_cows, 1.5, 2, d + 3, d + 12, true, 'Higher rate while grass is short');

  -- Silage: pit measured, bales counted
  insert into public.silage_stores (id, farm_id, name, method, length_m, width_m, avg_height_m, density_kg_m3, dm_percent, dmd_percent, measured_on)
  values ('70000000-0000-0000-0000-000000000001', f, 'Main pit', 'pit_dimensions', 40, 12, 2.2, 700, 28, 72, d - 25);
  insert into public.silage_stores (farm_id, name, method, bale_count, bale_weight_kg, measured_on)
  values (f, 'Round bales (haggard)', 'bale_count', 220, 750, d - 25);

  -- Money: 8 months of milk cheques + typical costs
  for m in 1..8 loop
    insert into public.income (farm_id, income_type, occurred_on, amount_eur, counterparty, milk_litres, description)
    values (f, 'milk', (date_trunc('month', d) - make_interval(months => m))::date + 14,
            26000 + (m * 1300) % 7000, 'Tirlán', 56000 + (m * 3100) % 16000, 'Milk cheque');
    insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_name, description) values
      (f, 'feed', (date_trunc('month', d) - make_interval(months => m))::date + 3, 6800 + (m * 410) % 2500, 'Tirlán FarmLife', 'Meal'),
      (f, 'utilities', (date_trunc('month', d) - make_interval(months => m))::date + 20, 640 + (m * 37) % 200, 'Electricity supplier', 'ESB bill'),
      (f, 'vet_medicine', (date_trunc('month', d) - make_interval(months => m))::date + 9, 900 + (m * 173) % 1100, 'Local vet', 'Vet call-outs'),
      (f, 'other', (date_trunc('month', d) - make_interval(months => m))::date + 1, 5200, 'Bank', 'Loan repayment');
  end loop;
  insert into public.costs (farm_id, category, occurred_on, amount_eur, supplier_name, description) values
    (f, 'fertiliser', d - 150, 14200, 'Tirlán FarmLife', 'CAN and 18-6-12'),
    (f, 'contractor', d - 110, 9800, 'Local contractor', 'First cut silage'),
    (f, 'machinery_fuel', d - 45, 2300, 'Fuel supplier', 'Green diesel');
  insert into public.income (farm_id, income_type, occurred_on, amount_eur, counterparty, animal_group_id, head_count, description)
  values (f, 'livestock', d - 60, 7400, 'Mart', g_wean, 12, '12 weanlings sold');

  -- Budget: monthly feed and milk
  for m in 1..12 loop
    insert into public.budget_lines (farm_id, year, month, kind, category, amount_eur) values
      (f, extract(year from d)::int, m, 'income', 'milk', 29000),
      (f, extract(year from d)::int, m, 'cost', 'feed', 7500);
  end loop;

  -- Records and jobs
  insert into public.farm_records (farm_id, record_type, occurred_on, title, details, state) values
    (f, 'fertiliser', d - 150, 'CAN spread, paddocks 1 to 12', '{"product":"CAN","quantity_kg":6000,"area_ha":24}', 'confirmed'),
    (f, 'medicine', d - 12, 'Dosed weanlings', '{"product":"Wormer","animals":30,"withdrawal_days":14}', 'confirmed'),
    (f, 'movement', d - 60, '12 weanlings to mart', '{"direction":"out","animals":12}', 'confirmed');
  insert into public.jobs (farm_id, title, due_on) values
    (f, 'Book vet for TB test', d + 5),
    (f, 'Check silage pit cover', d + 1);

  -- Feeding ticked off on the last two days; calves got a little extra yesterday
  insert into public.feed_use_logs (farm_id, feeding_rule_id, feed_product_id, animal_group_id, used_on, planned_kg, actual_kg, status)
  select f, r.id, r.feed_product_id, r.animal_group_id, day, r.planned, r.planned, 'fed'
  from (values ('60000000-0000-0000-0000-000000000001'::uuid, p_nut, g_cows, 240),
               ('60000000-0000-0000-0000-000000000002'::uuid, p_nut, g_heif, 40)) as r(id, feed_product_id, animal_group_id, planned),
       (values (d - 2), (d - 1)) as days(day);
  insert into public.feed_use_logs (farm_id, feeding_rule_id, feed_product_id, animal_group_id, used_on, planned_kg, actual_kg, status) values
    (f, '60000000-0000-0000-0000-000000000003', p_calf, g_calf, d - 2, 27, 27, 'fed'),
    (f, '60000000-0000-0000-0000-000000000003', p_calf, g_calf, d - 1, 27, 30, 'changed');

  -- Routines: relative dates so there is always something due, overdue and done
  insert into public.routines (id, farm_id, kind, title, frequency, weekday, day_of_month, start_date, amount, category, counterparty, feed_product_id, silage_store_id, created_at) values
    (gen_random_uuid(), f, 'expense', 'Loan repayment', 'monthly', null, extract(day from d - 5)::int, d - 60, 5200, 'other', 'Bank', null, null, now() - interval '60 days'),
    (gen_random_uuid(), f, 'expense', 'ESB bill', 'monthly', null, extract(day from d + 14)::int, d - 60, 640, 'utilities', 'Electricity supplier', null, null, now() - interval '60 days'),
    (gen_random_uuid(), f, 'income', 'Milk cheque', 'monthly', null, extract(day from d + 9)::int, d - 60, 27000, 'milk', 'Tirlán', null, null, now() - interval '60 days'),
    ('80000000-0000-0000-0000-000000000001', f, 'count', 'Dip the nut bin', 'weekly', extract(dow from d - 1)::int, null, d - 60, null, null, null, p_nut, null, now() - interval '60 days'),
    ('80000000-0000-0000-0000-000000000002', f, 'job', 'Check water troughs', 'weekly', extract(dow from d - 2)::int, null, d - 60, null, null, null, null, null, now() - interval '60 days'),
    (gen_random_uuid(), f, 'silage', 'Feed out silage', 'daily', null, null, make_date(extract(year from d)::int, 11, 1), 6, null, null, null, '70000000-0000-0000-0000-000000000001', now() - interval '60 days');
  insert into public.routine_completions (farm_id, routine_id, due_date, status, done_on)
  values (f, '80000000-0000-0000-0000-000000000002', d - 2, 'done', d - 2);

  -- Set up your farm, loans and scheme payments (16 Oct 2026), as in src/lib/demo/seed.ts.
  -- The bank loan is the "Loan repayment" routine above; a tractor on HP and an overdraft show the rest.
  update public.farms set herd_number = 'P1234567', acres_owned = 110, acres_rented = 40, vat_status = 'flat_rate',
    accountant_name = 'Local accountant', milk_buyer = 'Tirlán',
    setup = '{"farm":"done","animals":"done","feeding":"done","jobs":"done","income":"done","bills":"done","loans":"done","yearend":"done","year":"done"}'
  where id = f;
  insert into public.loans (id, farm_id, lender, kind, purpose, balance_eur, balance_on, rate_percent, rate_type, repayment_eur, frequency, next_due, ends_on, notes) values
    ('a1000000-0000-0000-0000-000000000001', f, 'Finance company', 'hire_purchase', 'machinery', 38000, d - 20, 6.9, 'fixed', 3150, 'quarterly', d + 40, d + 1100, 'Tractor');
  insert into public.loans (id, farm_id, lender, kind, purpose, balance_eur, balance_on, rate_percent, credit_limit_eur) values
    ('a1000000-0000-0000-0000-000000000002', f, 'AIB', 'overdraft', 'working_capital', 0, d - 1, 9.5, 25000);
  insert into public.expected_income (farm_id, scheme, label, scheme_year, part, amount_eur, expected_on) values
    (f, 'biss', 'BISS and CRISS ' || extract(year from d)::int || ', advance', extract(year from d)::int, 'advance', 27750, d + 20),
    (f, 'biss', 'BISS and CRISS ' || extract(year from d)::int || ', balance', extract(year from d)::int, 'balance', 9250, d + 50);
end $$;
