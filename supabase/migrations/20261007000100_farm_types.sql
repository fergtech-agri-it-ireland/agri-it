-- Farms are rarely one thing. A farm can be dairy and sheep and tillage at once, so the
-- farm keeps a list of enterprises. The old single `enterprise` column stays for older
-- clients and reports: it is 'mixed' when the list holds more than one.
alter table public.farms
  add column enterprises text[] not null default '{}'
  check (enterprises <@ array['dairy', 'suckler', 'beef', 'calf_rearing', 'sheep', 'tillage', 'pigs', 'poultry', 'horses', 'goats', 'other']::text[]);

update public.farms set enterprises = case
  when enterprise = 'mixed' then array['dairy', 'suckler']
  else array[enterprise::text]
end;

-- Animal classes farmers actually use. Teagasc allowances exist only for some of them;
-- forage planning asks for a figure for the rest and never assumes one.
-- (New enum values are not used again in this file, so this is safe in one transaction.)
alter type public.animal_class add value if not exists 'heifer' after 'in_calf_heifer';
alter type public.animal_class add value if not exists 'bullock' after 'store_cattle';
alter type public.animal_class add value if not exists 'ram' after 'lamb';
alter type public.animal_class add value if not exists 'hogget' after 'ram';
alter type public.animal_class add value if not exists 'goat' before 'other';
alter type public.animal_class add value if not exists 'pig' before 'other';
alter type public.animal_class add value if not exists 'poultry' before 'other';
alter type public.animal_class add value if not exists 'horse' before 'other';

-- Breed is the farmer's own words (pick from a list or type it), so it is free text.
alter table public.animal_groups
  add column breed text check (breed is null or char_length(breed) between 1 and 60);

-- Tillage money: grain and straw sales, seed and sprays.
alter type public.income_type add value if not exists 'crop' after 'livestock';
alter type public.cost_category add value if not exists 'seed_sprays' after 'fertiliser';

-- Tillage crops: what is sown, how many acres, for which harvest.
create table public.crops (
  id            uuid primary key default gen_random_uuid(),
  farm_id       uuid not null references public.farms(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  variety       text check (variety is null or char_length(variety) <= 60),
  acres         numeric(8,2) check (acres > 0),
  harvest_year  smallint not null check (harvest_year between 2000 and 2100),
  sown_on       date,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index on public.crops (farm_id);
alter table public.crops enable row level security;
create policy "members read crops" on public.crops for select to authenticated using (public.is_farm_member(farm_id));
create policy "writers insert crops" on public.crops for insert to authenticated with check (public.can_write_farm(farm_id));
create policy "writers update crops" on public.crops for update to authenticated using (public.can_write_farm(farm_id)) with check (public.can_write_farm(farm_id));
create policy "writers delete crops" on public.crops for delete to authenticated using (public.can_write_farm(farm_id));

-- create_farm now takes the list. The single enterprise is worked out from it.
drop function if exists public.create_farm(text, text, text, public.jurisdiction, public.enterprise_type, smallint);
create or replace function public.create_farm(
  p_name text, p_county text, p_eircode text default null,
  p_jurisdiction public.jurisdiction default 'ROI',
  p_enterprises text[] default '{}',
  p_default_lead_time_days smallint default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_list text[] := coalesce(p_enterprises, '{}');
  v_one public.enterprise_type;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  v_one := case
    when cardinality(v_list) > 1 then 'mixed'
    when cardinality(v_list) = 0 then 'other'
    when v_list[1] in ('dairy', 'suckler', 'beef', 'sheep', 'tillage') then v_list[1]::public.enterprise_type
    else 'other'
  end;
  insert into public.farms (name, county, eircode, jurisdiction, enterprise, enterprises, default_lead_time_days, created_by)
  values (trim(p_name), p_county, nullif(upper(trim(p_eircode)), ''), p_jurisdiction, v_one, v_list, p_default_lead_time_days, auth.uid())
  returning id into v_id;
  insert into public.farm_members (farm_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;
grant execute on function public.create_farm(text, text, text, public.jurisdiction, text[], smallint) to authenticated;
