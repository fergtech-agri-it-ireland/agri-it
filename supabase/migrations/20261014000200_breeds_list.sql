-- Breeds as a list (14 Oct 2026). One group often holds more than one breed
-- (dairy cows: Holstein Friesian and Jersey cross), so a group keeps a list.
-- The old single `breed` column stays for older code and reports: it holds the
-- list joined ("Holstein Friesian, Jersey cross"), cut to 60 characters.
-- Older groups: their one breed becomes a list of one, exactly as written.
-- No deletes or drops in this file, so the Supabase connector can apply it.

alter table public.animal_groups
  add column if not exists breeds text[] not null default '{}';

-- At most 8 breeds, each 1 to 60 characters (a check can't hold a subquery, so a function)
create or replace function public.breeds_ok(p text[]) returns boolean
language sql immutable set search_path = public as $$
  select cardinality(p) <= 8
     and coalesce((select bool_and(x is not null and char_length(btrim(x)) between 1 and 60) from unnest(p) x), true)
$$;

alter table public.animal_groups
  add constraint animal_groups_breeds_ok check (public.breeds_ok(breeds));

update public.animal_groups
   set breeds = array[btrim(breed)]
 where breed is not null and btrim(breed) <> '' and cardinality(breeds) = 0;

-- Keep the two in step whichever one a client writes:
--  * a newer client writes the list: `breed` becomes the list joined;
--  * an older client (or an older phone backup) writes only `breed`: the list becomes that one breed.
create or replace function public.animal_groups_breeds_in_step() returns trigger
language plpgsql set search_path = public as $$
declare
  v_joined text;
begin
  if tg_op = 'UPDATE' and new.breeds is not distinct from old.breeds and new.breed is distinct from old.breed then
    new.breeds := case when new.breed is null or btrim(new.breed) = '' then '{}'::text[] else array[btrim(new.breed)] end;
  elsif tg_op = 'INSERT' and cardinality(coalesce(new.breeds, '{}')) = 0 and new.breed is not null and btrim(new.breed) <> '' then
    new.breeds := array[btrim(new.breed)];
  end if;
  new.breeds := coalesce(new.breeds, '{}');
  if cardinality(new.breeds) = 0 then
    new.breed := null;
  else
    v_joined := array_to_string(new.breeds, ', ');
    new.breed := case when char_length(v_joined) <= 60 then v_joined else rtrim(left(v_joined, 57)) || '...' end;
  end if;
  return new;
end $$;

create trigger animal_groups_breeds_in_step before insert or update on public.animal_groups
  for each row execute function public.animal_groups_breeds_in_step();
