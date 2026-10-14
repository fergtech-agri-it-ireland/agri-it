import { describe, expect, it } from 'vitest';
import { buildReference, refreshReference, type DB } from './demo/seed';
import { resolveContacts } from './suppliers';
import type { Farm, Supplier, SupplierBranch } from './types';

const BRETT = '10000000-0000-0000-0000-000000000008';
const ROCHES = '10000000-0000-0000-0000-000000000009';
const HOWARD = '10000000-0000-0000-0000-00000000000a';
const STAR = '10000000-0000-0000-0000-00000000000b';
const LAKELAND = '10000000-0000-0000-0000-000000000003';

const ref = buildReference();
const suppliers = ref.suppliers as unknown as Supplier[];
const branches = ref.supplier_branches as unknown as SupplierBranch[];
const farm = (county: string): Farm => ({ id: 'f', name: 'F', county, jurisdiction: 'ROI' } as unknown as Farm);
const sup = (id: string) => suppliers.find((s) => s.id === id)!;

describe('directory additions (checked 14 Oct 2026)', () => {
  it('records name, area, central phone, source and the day checked; unverified stays unverified', () => {
    expect(sup(BRETT)).toMatchObject({ name: 'Brett Brothers', central_phone: '056 775 5300', verified_on: '2026-10-14', source_url: 'https://www.brettbrothers.ie/contact/' });
    expect(sup(BRETT).area_served).toMatch(/Leinster and Munster/);
    expect(sup(ROCHES)).toMatchObject({ name: "Roche's Feeds", central_phone: '061 308 111', verified_on: '2026-10-14', area_served: null });
    expect(sup(HOWARD)).toMatchObject({ name: 'Howard Farms', central_phone: '022 26184', verified_on: '2026-10-14' });
    // Star Fuels' website was down: no number, not verified, and it says so
    expect(sup(STAR)).toMatchObject({ verified_on: null, central_phone: null, needs_live_directory: true });
    expect(sup(STAR).local_contact_method).toMatch(/down when checked/);
  });

  it('every branch and area contact carries its source and the day it was checked', () => {
    const mine = branches.filter((b) => b.supplier_id === BRETT || b.supplier_id === HOWARD);
    expect(mine).toHaveLength(8);
    expect(mine.every((b) => b.verified_on === '2026-10-14' && b.source_url.startsWith('https://www.') && b.phone)).toBe(true);
    expect(new Set(branches.map((b) => b.id)).size).toBe(branches.length);
  });

  it('a Tipperary farm gets the Ardfinnan branch; a Kilkenny farm picks between two, never guessed', () => {
    const tipp = resolveContacts(sup(BRETT), branches, undefined, farm('Tipperary'));
    expect(tipp.routes[0]).toMatchObject({ kind: 'branch', title: 'Brett Brothers Ardfinnan', phone: '052 746 6208' });
    const kk = resolveContacts(sup(BRETT), branches, undefined, farm('Kilkenny'));
    expect(kk.ambiguous).toBe(true);
    expect(kk.routes[0].kind).toBe('central');
  });

  it("Howard Farms' named area contacts route by county; two in Cork means the farmer picks", () => {
    const kerry = resolveContacts(sup(HOWARD), branches, undefined, farm('Kerry'));
    expect(kerry.routes[0]).toMatchObject({ kind: 'branch', title: "William O'Connor, Howard Farms, Kerry", phone: '087 131 5577' });
    const cork = resolveContacts(sup(HOWARD), branches, undefined, farm('Cork'));
    expect(cork.ambiguous).toBe(true);
    expect(cork.routes.map((r) => r.kind)).toEqual(['central']);
  });
});

describe('phone reference refresh', () => {
  // A phone first opened before 11 Oct: old directory, a farm-added supplier, a feed using a directory supplier
  function oldPhone(): DB {
    const db = structuredClone(buildReference());
    db.suppliers = db.suppliers.filter((s) => ![BRETT, ROCHES, HOWARD, STAR].includes(String(s.id)))
      .map((s) => (s.id === LAKELAND ? { ...s, central_phone: '0000 old', verified_on: '2026-09-01' } : s));
    db.suppliers.push({ id: 'my-own', farm_id: 'farm-1', name: 'Local merchant', coverage: ['ROI'] });
    db.supplier_branches = [];
    db.evidence_sources = db.evidence_sources.filter((e) => Number(String(e.code).slice(1)) < 16);
    db.farms = [{ id: 'farm-1', name: 'Mine' }];
    db.feed_products = [{ id: 'p1', farm_id: 'farm-1', supplier_id: LAKELAND, name: 'Dairy nut' }];
    return db;
  }

  it('brings in new suppliers, branches and sources, and corrects old directory rows', () => {
    const out = refreshReference(oldPhone());
    const ids = out.suppliers.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([BRETT, ROCHES, HOWARD, STAR]));
    expect(out.suppliers.find((s) => s.id === LAKELAND)).toMatchObject({ central_phone: '0818 474720', verified_on: null });
    expect(out.supplier_branches.length).toBe(ref.supplier_branches.length);
    expect(out.evidence_sources.map((e) => e.code)).toEqual(expect.arrayContaining(['S16', 'S19']));
  });

  it("never touches the farm's own records or a supplier the farmer added", () => {
    const before = oldPhone();
    const out = refreshReference(before);
    expect(out.farms).toEqual(before.farms);
    expect(out.feed_products).toEqual(before.feed_products);
    expect(out.suppliers.find((s) => s.id === 'my-own')).toEqual(before.suppliers.find((s) => s.id === 'my-own'));
  });

  it('keeps the ids this phone already had and changes nothing on a second run', () => {
    const before = oldPhone();
    const s1 = before.evidence_sources.find((e) => e.code === 'S1')!;
    const once = refreshReference({ ...before, evidence_sources: before.evidence_sources.map((e) => (e.code === 'S1' ? { ...e, id: 'phone-s1' } : e)) });
    expect(once.evidence_sources.find((e) => e.code === 'S1')!.id).toBe('phone-s1');
    expect(s1).toBeTruthy();
    const twice = refreshReference(once);
    expect(twice.suppliers).toEqual(once.suppliers);
    expect(twice.supplier_branches).toEqual(once.supplier_branches);
    expect(twice.evidence_sources).toEqual(once.evidence_sources);
  });
});
