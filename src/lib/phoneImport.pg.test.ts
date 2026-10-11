/**
 * The phone import against a real database: the plan from a real phone backup goes through
 * public.import_phone_backup as a signed-in owner, twice (the second run must add nothing),
 * and a different farmer importing the same backup can't touch the first farm's rows.
 *
 * Runs only when AGRI_PG is set to a database with every migration applied, e.g.
 *   AGRI_PG=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run src/lib/phoneImport.pg.test.ts
 * (CI runs it after `supabase db reset`; locally any Postgres with scripts/e2e/supabase_stub.sql works).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBackup, planPhoneImport } from './phoneImport';

const PG = process.env.AGRI_PG;
const dir = mkdtempSync(join(tmpdir(), 'agri-import-'));
let n = 0;
/** Run SQL (as the database owner unless `as` is given) and return the last statement's single value. */
function sql(body: string, as?: string): string {
  const who = as
    ? `set role authenticated; select set_config('request.jwt.claim.sub', '${as}', false), set_config('request.jwt.claims', '{"sub":"${as}","role":"authenticated"}', false);\n`
    : '';
  const f = join(dir, `q${++n}.sql`);
  writeFileSync(f, `\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\n${who}${body}\n`);
  const out = execFileSync('psql', [PG!, '-q', '-f', f], { encoding: 'utf8' }).trim().split('\n');
  return out[out.length - 1] ?? '';
}
const lit = (v: unknown) => `$agri$${JSON.stringify(v)}$agri$::jsonb`;

describe.skipIf(!PG)('phone import on Postgres', () => {
  const backup = parseBackup(readFileSync(new URL('./testing/fixtures/phone-backup.json', import.meta.url), 'utf8'));
  const OWNER = '7e000000-0000-4000-8000-000000000001';
  const OTHER = '7e000000-0000-4000-8000-000000000002';

  it('imports once, a second run adds nothing, and nobody else can claim the rows', () => {
    // Supabase grants signed-in users table access by default; a bare test database may not
    sql(`grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated;`);
    sql(`delete from public.farms where created_by in ('${OWNER}', '${OTHER}'); delete from auth.users where id in ('${OWNER}', '${OTHER}');
         insert into auth.users (id, email, aud, role) values ('${OWNER}', 'import-owner@agri-it.test', 'authenticated', 'authenticated'),
                                                         ('${OTHER}', 'import-other@agri-it.test', 'authenticated', 'authenticated');`);
    const farm = sql(`select public.create_farm('Online Farm', 'Tipperary', null, 'ROI', '{dairy}', null);`, OWNER);
    const plan = planPhoneImport(backup, farm);
    const call = (f: string, as: string) => JSON.parse(sql(`select public.import_phone_backup('${f}', ${lit(plan.farm)}, ${lit(plan.rows)});`, as));

    const first = call(farm, OWNER);
    expect(first).toMatchObject({ added: plan.total, already: 0, blocked: 0, failed: 0 });

    // Paid and owed exactly as on the phone, and cash settings came across
    const costs = sql(`select string_agg(id || ':' || payment_status || ':' || coalesce(paid_on::text, '-') || ':' || coalesce(due_on::text, '-'), ',' order by id) from public.costs where farm_id = '${farm}';`);
    const want = backup.db.costs.map((c) => `${c.id}:${c.payment_status}:${c.paid_on ?? '-'}:${c.due_on ?? '-'}`).sort().join(',');
    expect(costs).toBe(want);
    expect(sql(`select opening_cash_eur::text || ' ' || name from public.farms where id = '${farm}';`)).toBe(`${Number(backup.db.farms[0].opening_cash_eur).toFixed(2)} Online Farm`);
    // Dates kept (created_at from the phone, not the moment of import)
    const cr = backup.db.costs[0];
    expect(sql(`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') from public.costs where id = '${cr.id}';`)).toBe(String(cr.created_at).slice(0, 19));

    const second = call(farm, OWNER);
    expect(second).toMatchObject({ added: 0, already: plan.total, blocked: 0, failed: 0 });
    expect(Number(sql(`select count(*) from public.costs where farm_id = '${farm}';`))).toBe(plan.counts.costs);

    // Another farmer with the same backup gets their own farm but can't take these rows
    const other = sql(`select public.create_farm('Copy', 'Cork', null, 'ROI', '{dairy}', null);`, OTHER);
    const plan2 = planPhoneImport(backup, other);
    const third = JSON.parse(sql(`select public.import_phone_backup('${other}', ${lit(plan2.farm)}, ${lit(plan2.rows)});`, OTHER));
    expect(third.added + third.blocked + third.already).toBe(plan2.total);
    expect(third.blocked).toBeGreaterThan(0);
    expect(Number(sql(`select count(*) from public.costs where farm_id = '${farm}';`))).toBe(plan.counts.costs);
    // ...and can't write into someone else's farm at all
    expect(() => call(farm, OTHER)).toThrow(/Only the farm owner/);

    sql(`delete from public.farms where id in ('${farm}', '${other}'); delete from auth.users where id in ('${OWNER}', '${OTHER}');`);
  });
});
