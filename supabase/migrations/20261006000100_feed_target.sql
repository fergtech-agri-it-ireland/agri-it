-- Farmer-set comfort level for bought-in feed, in days of cover.
-- Drives the Feed dial on Today. It is the farmer's own target, never a recommendation.
alter table public.farms
  add column feed_target_days smallint not null default 30
  check (feed_target_days between 1 and 180);
