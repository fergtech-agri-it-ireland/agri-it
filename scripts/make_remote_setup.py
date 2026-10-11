"""Write supabase/remote/setup_agri_it.sql: one file to paste into the Supabase SQL editor of
the hosted project `agri-it` (ref xgudpylxmrlywegpdvps).

Why a paste file: the Supabase connector cancels any change that contains a delete or drop
(several migrations do, inside functions) because its confirmation card never reaches the
owner. Everything else was applied through the connector.

What it does, in order (stops at the first error; each step is its own transaction):
  1. the rest of migration 20260929000200 (parts 1 and 2 already applied by the connector)
  2. migrations 20261006000100 to 20261011000400, each in its own transaction
  3. reference data only from seed.sql (evidence sources, Teagasc allowances, supplier
     directory and branches). Never the demo login or demo farm.
  4. migration history tidied to the nine file versions, so `supabase db push` lines up later
  5. db_review.sql against the demo farm, inside a transaction that is rolled back, so it
     leaves nothing behind. "Success. No rows returned" means every check passed.

Run: python3 scripts/make_remote_setup.py
"""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
mig = sorted((root / 'supabase/migrations').glob('*.sql'))
out = []
w = out.append

w('-- Agri-It: finish setting up the hosted Supabase project `agri-it` (xgudpylxmrlywegpdvps).')
w('-- Made by scripts/make_remote_setup.py. Paste all of it into the SQL editor and press Run.')
w('-- Safe to run once. Stops at the first error and leaves that step unchanged.')
w('-- Check the project name at the top of the SQL editor says agri-it, not gauntlet.')
w('')
w("do $$ begin if exists (select 1 from pg_proc where proname = 'import_phone_backup') then raise exception 'Already set up: nothing to do'; end if; end $$;")
w('')

# 1. Rest of migration 2
m2 = (root / 'supabase/migrations/20260929000200_security_and_functions.sql').read_text()
i = m2.index('-- Undo a delivery')
w('-- 1. 20260929000200_security_and_functions.sql (rest: undo, head counts, animal sales, grants)')
w('begin;'); w(m2[i:].strip()); w('commit;'); w('')

# 2. Migrations 3 to 9
for f in mig:
    if f.name < '20261006':
        continue
    w(f'-- 2. {f.name}')
    w('begin;'); w(f.read_text().strip()); w('commit;'); w('')

# 3. Reference data only
seed = (root / 'supabase/seed.sql').read_text()
j = seed.index('-- ---------------------------------------------------------------------------\n-- Demo login')
w('-- 3. Reference data from seed.sql (top half only: no demo login, no demo farm)')
w('begin;'); w(seed[:j].strip()); w('commit;'); w('')

# 4. Migration history
w('-- 4. Migration history: the nine migration files, by their own versions')
w('begin;')
w('delete from supabase_migrations.schema_migrations;')
vals = ',\n  '.join(f"('{f.name.split('_', 1)[0]}', '{f.name.split('_', 1)[1][:-4]}')" for f in mig)
w(f'insert into supabase_migrations.schema_migrations (version, name) values\n  {vals};')
w('commit;'); w('')

# 5. db_review.sql against the demo farm, rolled back
review = (root / 'scripts/e2e/db_review.sql').read_text()
lines = [l for l in review.splitlines() if l.strip() not in ('begin;', 'commit;') and not l.startswith('\\')]
w('-- 5. db_review.sql checks, run against the demo farm inside one transaction and rolled back.')
w('--    Nothing from this step is kept. An error here names the check that failed.')
w('begin;')
w(seed[j:].strip())
w('\n'.join(lines).strip())
w("reset role;")
w('rollback;')
w('')
w("select 'Agri-It set up: ' || (select count(*) from pg_policies where schemaname = 'public') || ' security rules, '")
w("  || (select count(*) from public.suppliers where farm_id is null) || ' directory suppliers, '")
w("  || (select count(*) from public.supplier_branches) || ' branches, demo farm left out: '")
w("  || (not exists (select 1 from public.farms))::text as result;")

dest = root / 'supabase/remote/setup_agri_it.sql'
dest.write_text('\n'.join(out) + '\n')
print(dest, dest.stat().st_size, 'bytes')
