-- Alert load (advisory board G12, 14 Oct 2026).
-- "Not now" on a suggestion now says why (busy, done elsewhere, not relevant) and for how long
-- (the existing `until` date). Older rows have no reason. No deletes or drops.

alter table public.suggestion_decisions
  add column if not exists reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suggestion_decisions_reason_ok') then
    alter table public.suggestion_decisions
      add constraint suggestion_decisions_reason_ok
      check (reason is null or reason in ('busy', 'elsewhere', 'not_relevant'));
  end if;
end $$;

comment on column public.suggestion_decisions.reason is
  'Why the farmer put off or turned down a suggestion: busy, elsewhere (done elsewhere), not_relevant. Null on older rows.';
