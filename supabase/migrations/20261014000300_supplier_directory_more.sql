-- More feed and farm supplies businesses in the directory (14 Oct 2026). Each one was
-- checked on its own website that day; only what was seen there is marked verified.
--  * Brett Brothers Ltd, Callan: four branches (brettbrothers.ie/contact).
--  * Roche's Feeds (J. H. Roche & Sons), Dock Road, Limerick: one number (rochesfeeds.com/contact).
--  * Howard Farms, Kilcanway, Mallow: head office and four area contacts named on its own
--    contact page (howardfarms.ie/contact-us).
--  * Star Fuels & Farm Supplies, Clonmel and Mitchelstown: a separate business from Roche's.
--    Its website showed "account suspended" on 14 Oct 2026, so nothing could be checked:
--    no number is loaded and it shows as not verified.
-- New column: where the supplier says it serves, in its own words. Null = not stated.
-- No deletes or drops, so the Supabase connector can apply it.

alter table public.suppliers add column if not exists area_served text;

-- On a fresh database the directory comes from seed.sql after the migrations (with the same
-- rows), so only add these where the directory is already loaded (the hosted project).
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
where exists (select 1 from public.suppliers s where s.id = '10000000-0000-0000-0000-000000000001')
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
where exists (select 1 from public.suppliers s where s.id = v.supplier_id::uuid)
on conflict (id) do nothing;
