-- Animals at scale (22 Oct 2026): what kind of animal it is, whether a male was castrated, and an
-- optional life stage set by hand. The stage normally comes from the animal's age (calf, weanling,
-- heifer, cow; lamb, hogget, ewe) and is worked out in the app, never stored, so it moves up on
-- its own as the animal gets older. `stage` is only for the farmer who overrides it (an in-calf
-- heifer, say). Indexes keep lists of thousands of animals quick.

alter table public.animals
  add column if not exists species   text not null default 'cattle' check (species in ('cattle', 'sheep', 'goat', 'pig', 'horse', 'other')),
  add column if not exists castrated boolean,
  add column if not exists stage     text check (stage is null or stage ~ '^[a-z_]{2,30}$');

create index if not exists animals_farm_status on public.animals (farm_id, status);
create index if not exists animals_farm_species on public.animals (farm_id, species) where status = 'on_farm';

-- No change history for animals: a farm can load or update thousands at once, which would bury
-- the history of money and feed records. Each animal still has created_at and updated_at.
drop trigger if exists animals_audit on public.animals;
