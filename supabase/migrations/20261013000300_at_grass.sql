-- Where each group is today (13 Oct 2026, rule forage-budget@1.2).
-- at_grass: out at grass now. housed_from: the day the group comes in (or came in), when it is
-- not the farm's housing date. The winter silage plan counts each group from the day it is in;
-- a group out at grass with no date is counted from today, so the plan errs short.
-- Older groups: at_grass false and no date = in with the herd from the farm's housing date (as before).
alter table public.animal_groups
  add column if not exists at_grass boolean not null default false,
  add column if not exists housed_from date;
