-- Supplier directory re-checked against each supplier's own contact page on 11 Oct 2026
-- (review gap P1: verified supplier coverage). Only numbers seen on the source page are
-- marked verified; anything that could not be checked shows as not verified in the app.

update public.suppliers set verified_on = '2026-10-11' where id in (
  '10000000-0000-0000-0000-000000000001', -- Tirlán: 0818 321 321 (FarmLife support / customer services)
  '10000000-0000-0000-0000-000000000004'  -- Aurivo: 071 9186500 (Aurivo Agribusiness)
);
update public.suppliers set verified_on = '2026-10-11', source_url = 'https://www.dairygoldagri.ie/contact-us/our-team/',
  local_contact_method = 'Dairygold publishes its dairy, beef and tillage sales advisers by team. Inside Sales can put you through to yours; save them as your rep once you know them.'
  where id = '10000000-0000-0000-0000-000000000002'; -- 025 24411 (contact page) and 022 31644 (team page)
update public.suppliers set verified_on = '2026-10-11', central_phone_label = 'Head office (Clonee)',
  local_contact_method = 'Branch phones are listed by county. If there is more than one branch in your county, pick yours with Set my rep.'
  where id = '10000000-0000-0000-0000-000000000006'; -- 01 825 5011
update public.suppliers set verified_on = '2026-10-11', central_phone_label = 'Fane Valley main line',
  local_contact_method = 'The Fane Valley site lists one main number and no separate Feeds line. Ask for Feeds, then save your adviser as your rep.'
  where id = '10000000-0000-0000-0000-000000000007'; -- 028 9261 9620
-- Lakeland's site blocks automated checks, so its numbers are shown as not verified until checked by hand
update public.suppliers set verified_on = null,
  local_contact_method = 'These numbers come from the September 2026 product document and could not be re-checked on 11 Oct 2026. Check them on the Lakeland contact page before relying on them.'
  where id = '10000000-0000-0000-0000-000000000003';

-- Drummonds branches, from drummonds.ie/contact-us (each branch serves its own county).
-- On a fresh database the directory comes from seed.sql after the migrations (which has the
-- same rows), so only add branches where the supplier is already there.
insert into public.supplier_branches (id, supplier_id, name, town, counties, phone, source_url, verified_on)
select v.id::uuid, v.supplier_id::uuid, v.name, v.town, v.counties::text[], v.phone, v.source_url, v.verified_on::date from (values
('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'Drummonds Ardee', 'Ardee', '{Louth}', '041 685 3332', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000006', 'Drummonds Drogheda', 'Drogheda', '{Louth}', '041 983 8986', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006', 'Drummonds Dromone', 'Oldcastle', '{Meath}', '044 967 2650', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000006', 'Drummonds Knockbridge', 'Dundalk', '{Louth}', '042 937 4480', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006', 'Drummonds Lusk', 'Lusk', '{Dublin}', '01 525 2903', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'Drummonds Mullingar', 'Mullingar', '{Westmeath}', '044 936 2022', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000006', 'Drummonds Navan', 'Navan', '{Meath}', '046 902 1641', 'https://drummonds.ie/contact-us/', '2026-10-11'),
('11000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000006', 'Drummonds Rathcoffey', 'Rathcoffey', '{Kildare}', '087 400 3896', 'https://drummonds.ie/contact-us/', '2026-10-11')
) as v(id, supplier_id, name, town, counties, phone, source_url, verified_on)
where exists (select 1 from public.suppliers s where s.id = v.supplier_id::uuid)
on conflict (id) do nothing;
