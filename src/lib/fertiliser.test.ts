import { describe, expect, it } from 'vitest';
import { CLOSED_PERIODS, GUIDANCE, isClosed, seasonOn, zoneFor } from './spreading';
import { forecastFertiliser, stockFor } from './forecast/fertiliser';
import { CATALOGUE, pickList } from './catalogue';
import { compareWithCso, csoFigure, noComparisonReason, CSO_FETCHED_ON } from './cso/compare';
import cso from './cso/cso-prices.json';
import { addDays } from './format';
import type { Cost, FarmBundle, Farm, Field, FertiliserProduct, FertiliserSpread, FertiliserSpreadField, FertiliserStock } from './types';

const TODAY = '2026-10-14';
const farm = (county = 'Tipperary', jurisdiction: 'ROI' | 'NI' = 'ROI') => ({ id: 'f', county, jurisdiction } as unknown as Farm);
const zoneA = zoneFor('ROI', 'Tipperary')!;

describe('closed periods (statutory, sourced)', () => {
  it('puts each county in its zone, and Northern Ireland on its own dates', () => {
    expect(zoneFor('ROI', 'Tipperary')!.zone).toBe('A');
    expect(zoneFor('ROI', 'Co. Kerry')!.zone).toBe('B');
    expect(zoneFor('ROI', 'county monaghan')!.zone).toBe('C');
    expect(zoneFor('NI', 'Tyrone')!.zone).toBe('NI');
    expect(zoneFor('ROI', 'Atlantis')).toBeNull();
  });

  it('Zone A: last day 14 Sept, closed 15 Sept to 26 Jan, open again 27 Jan', () => {
    expect(isClosed(zoneA, '2026-09-14')).toBe(false);
    expect(isClosed(zoneA, '2026-09-15')).toBe(true);
    expect(isClosed(zoneA, '2027-01-26')).toBe(true);
    expect(isClosed(zoneA, '2027-01-27')).toBe(false);
    const s = seasonOn(zoneA, TODAY);
    expect(s).toMatchObject({ open: false, closedFrom: '2026-09-15', closedTo: '2027-01-26', opensOn: '2027-01-27' });
    expect(seasonOn(zoneA, '2027-03-01')).toMatchObject({ open: true, lastDay: '2027-09-14', opensOn: '2027-01-27' });
  });

  it('Zone B opens 30 Jan, Zone C 15 Feb, Northern Ireland 1 Feb (closed from midnight on 15 Sept)', () => {
    expect(seasonOn(zoneFor('ROI', 'Galway')!, '2027-01-29').open).toBe(false);
    expect(seasonOn(zoneFor('ROI', 'Galway')!, '2027-01-30').open).toBe(true);
    expect(seasonOn(zoneFor('ROI', 'Cavan')!, '2027-02-14').open).toBe(false);
    expect(seasonOn(zoneFor('ROI', 'Cavan')!, '2027-02-15').open).toBe(true);
    const ni = zoneFor('NI', 'Down')!;
    expect(isClosed(ni, '2026-09-15')).toBe(false);
    expect(isClosed(ni, '2026-09-16')).toBe(true);
    expect(seasonOn(ni, '2026-12-01').opensOn).toBe('2027-02-01');
  });

  it('every rule and every piece of guidance names its source and the day it was checked; rules are not past recheck', () => {
    for (const r of CLOSED_PERIODS) {
      expect(r.source.url).toMatch(/^https:\/\/(assets\.gov\.ie|www\.daera-ni\.gov\.uk)\//);
      expect(r.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The build fails 30 days after a recheck date. To fix: check the source, then update checkedOn and reviewBy in lib/spreading.ts.
      expect(addDays(r.reviewBy, 30) >= new Date().toISOString().slice(0, 10), `Zone ${r.zone} closed period is overdue a recheck (review by ${r.reviewBy})`).toBe(true);
    }
    for (const g of Object.values(GUIDANCE)) expect(g.source.url).toMatch(/^https:\/\//);
  });
});

// Builders
let n = 0;
const fld = (x: Partial<Field>): Field => ({ id: `fld${++n}`, farm_id: 'f', name: `Field ${n}`, acres: 10, use: 'grazing', spread_every_days: null, cut_on: null, archived: false, sort_order: n, ...x });
const prod = (x: Partial<FertiliserProduct> = {}): FertiliserProduct => ({ id: 'can', farm_id: 'f', name: 'CAN', catalogue_key: 'can', supplier_id: null, low_stock_kg: null, archived: false, ...x });
const stk = (x: Partial<FertiliserStock>): FertiliserStock => ({ id: `s${++n}`, farm_id: 'f', product_id: 'can', kind: 'delivery', quantity_kg: 1000, on_date: '2026-03-01', evidence: 'docket', supplier_id: null, cost_id: null, notes: null, created_at: `2026-03-01T0${n % 10}:00:00Z`, ...x });
function spread(on: string, fieldIds: string[], kgPerAcre: number, productId = 'can'): { s: FertiliserSpread; f: FertiliserSpreadField[] } {
  const id = `sp${++n}`;
  return { s: { id, farm_id: 'f', product_id: productId, spread_on: on, kg_per_acre: kgPerAcre, total_kg: kgPerAcre * 10 * fieldIds.length, notes: null, created_at: `${on}T12:00:00Z` },
    f: fieldIds.map((fid) => ({ id: `${id}-${fid}`, farm_id: 'f', spread_id: id, field_id: fid, acres: 10, kg: kgPerAcre * 10 })) };
}
const bundle = (x: Partial<FarmBundle>): FarmBundle => ({ farm: farm(), fields: [], fertilisers: [prod()], fertStock: [], spreads: [], spreadFields: [], costs: [], ...x } as unknown as FarmBundle);

describe('fertiliser stock', () => {
  it('last stock check + deliveries since - spreading since', () => {
    const sp = spread('2026-04-01', ['a', 'b'], 50);
    const b = bundle({
      fertStock: [stk({ kind: 'count', quantity_kg: 2000, on_date: '2026-03-01' }), stk({ quantity_kg: 3000, on_date: '2026-03-20' }), stk({ quantity_kg: 999, on_date: '2026-02-01' })],
      spreads: [sp.s]
    });
    const s = stockFor(b, prod(), TODAY);
    expect(s.stockKg).toBe(2000 + 3000 - 1000);
    expect(s.basis).toBe('counted');
  });

  it('a check counts what was there when it was saved: earlier same-day deliveries are in it, later ones are not', () => {
    const b = bundle({ fertStock: [
      stk({ quantity_kg: 500, on_date: '2026-05-01', created_at: '2026-05-01T08:00:00Z' }),
      stk({ kind: 'count', quantity_kg: 1200, on_date: '2026-05-01', created_at: '2026-05-01T09:00:00Z' }),
      stk({ quantity_kg: 300, on_date: '2026-05-01', created_at: '2026-05-01T10:00:00Z' })
    ] });
    expect(stockFor(b, prod(), TODAY).stockKg).toBe(1500);
  });

  it('never checked: deliveries less spreading, and more spread than recorded shows as 0 with the gap', () => {
    const sp = spread('2026-04-01', ['a'], 120);
    const b = bundle({ fertStock: [stk({ quantity_kg: 1000 })], spreads: [sp.s] });
    const s = stockFor(b, prod(), TODAY);
    expect(s).toMatchObject({ stockKg: 0, overspentKg: 200, basis: 'deliveries_only' });
  });

  it('the last price paid comes from the delivery\'s own bill', () => {
    const cost = { id: 'c1', amount_eur: 1080 } as Cost;
    const b = bundle({ fertStock: [stk({ quantity_kg: 2000, on_date: '2026-08-10', cost_id: 'c1' })], costs: [cost] });
    expect(stockFor(b, prod(), TODAY).lastPrice).toEqual({ eurPerT: 540, on: '2026-08-10' });
  });

  it('warns at the farmer\'s own low level only', () => {
    const b = bundle({ fertilisers: [prod({ low_stock_kg: 1000 })], fertStock: [stk({ kind: 'count', quantity_kg: 900 })] });
    expect(forecastFertiliser(b, TODAY).products[0].low).toBe(true);
    expect(forecastFertiliser(bundle({ fertStock: [stk({ kind: 'count', quantity_kg: 900 })] }), TODAY).products[0].low).toBe(false);
  });
});

describe('fields due, on the farmer\'s own round only', () => {
  const SPRING = '2027-03-20'; // Zone A open since 27 Jan
  it('a grazing field on a 21-day round is due 21 days after it was last spread', () => {
    const f = fld({ spread_every_days: 21 });
    const sp = spread('2027-03-01', [f.id], 50);
    const due = forecastFertiliser(bundle({ fields: [f], spreads: [sp.s], spreadFields: sp.f }), SPRING).due;
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: 'round', dueOn: '2027-03-22', needKg: 500 });
  });

  it('never spread this season: due from the day spreading opened', () => {
    const f = fld({ spread_every_days: 21 });
    expect(forecastFertiliser(bundle({ fields: [f] }), SPRING).due[0].dueOn).toBe('2027-01-27');
  });

  it('nothing is due while spreading is closed, or past the last day', () => {
    const f = fld({ spread_every_days: 21 });
    expect(forecastFertiliser(bundle({ fields: [f] }), TODAY).due).toHaveLength(0);
    const sp = spread('2027-09-01', [f.id], 50);
    expect(forecastFertiliser(bundle({ fields: [f], spreads: [sp.s], spreadFields: sp.f }), '2027-09-12').due).toHaveLength(0);
  });

  it('a field with no round of its own is never flagged (Agri-It never picks one)', () => {
    expect(forecastFertiliser(bundle({ fields: [fld({})] }), SPRING).due).toHaveLength(0);
  });

  it('lime and straight potash do not count as a round of nitrogen', () => {
    const f = fld({ spread_every_days: 21 });
    const lime = prod({ id: 'lime', name: 'Lime', catalogue_key: 'lime' });
    const sp = spread('2027-03-15', [f.id], 500, 'lime');
    const due = forecastFertiliser(bundle({ fields: [f], fertilisers: [prod(), lime], spreads: [sp.s], spreadFields: sp.f }), SPRING).due;
    expect(due[0].dueOn).toBe('2027-01-27');
  });

  it('silage: spread by 50 days before cutting (Teagasc), flagged two weeks ahead, and cleared once spread', () => {
    const f = fld({ use: 'silage', cut_on: '2027-05-15' });
    const by = addDays('2027-05-15', -50);
    expect(by).toBe('2027-03-26');
    expect(forecastFertiliser(bundle({ fields: [f] }), '2027-03-11').due).toHaveLength(0);
    expect(forecastFertiliser(bundle({ fields: [f] }), '2027-03-12').due[0]).toMatchObject({ kind: 'silage', dueOn: '2027-03-26' });
    const sp = spread('2027-03-20', [f.id], 60);
    expect(forecastFertiliser(bundle({ fields: [f], spreads: [sp.s], spreadFields: sp.f }), '2027-03-25').due).toHaveLength(0);
    expect(forecastFertiliser(bundle({ fields: [f] }), '2027-05-20').due[0].kind).toBe('cut_passed');
  });

  it('warns when the fields due need more than is in stock, at the last rate used on each', () => {
    const a = fld({ spread_every_days: 21 }), c = fld({ spread_every_days: 21 });
    const sp = spread('2027-02-20', [a.id, c.id], 50);
    const b = bundle({ fields: [a, c], spreads: [sp.s], spreadFields: sp.f, fertStock: [stk({ kind: 'count', quantity_kg: 1600, on_date: '2027-02-01' })] });
    const f = forecastFertiliser(b, '2027-03-14');
    expect(f.products[0].stockKg).toBe(600);
    expect(f.shortfalls[0]).toMatchObject({ needKg: 1000, haveKg: 600 });
  });
});

describe('pick lists', () => {
  it('a supplier\'s own products show only for that supplier, and only where it lists them', () => {
    const howard = pickList('fertiliser', '10000000-0000-0000-0000-00000000000a');
    expect(howard[0].group).toBe('Listed by Howard Farms');
    expect(howard[0].items.every((i) => i.source?.url.startsWith('https://www.howardfarms.ie/'))).toBe(true);
    const other = pickList('fertiliser', '10000000-0000-0000-0000-000000000008');
    expect(other.flatMap((g) => g.items).some((i) => i.supplierId)).toBe(false);
  });

  it('every CSO series named in the pick list exists in the CSO figures', () => {
    const labels = new Set(Object.values(cso.tables).flatMap((t) => Object.keys(t.items)));
    for (const c of CATALOGUE.filter((x) => x.cso)) expect(labels.has(c.cso!), `${c.name}: CSO series "${c.cso}" not found`).toBe(true);
  });
});

describe('CSO comparison', () => {
  it('compares with the CSO figure for the delivery month, excluding VAT', () => {
    const fig = csoFigure('Calcium Ammonium Nitrate (27.5% N)', '2026-07')!;
    const c = compareWithCso('can', 'ROI', { eurPerT: fig.eurPerT + 20, on: '2026-07-10' })!;
    expect(c).toMatchObject({ diffEur: 20, cso: { month: '2026-07', latestInstead: false } });
  });

  it('uses the latest month the CSO has published, and says so', () => {
    const c = compareWithCso('npk_18_6_12', 'ROI', { eurPerT: 600, on: '2026-10-01' })!;
    expect(c.cso.month <= '2026-10').toBe(true);
    expect(c.cso.latestInstead).toBe(true);
  });

  it('never compares a product the CSO doesn\'t cover, a typed product, or a Northern Ireland farm', () => {
    expect(compareWithCso('protected_urea', 'ROI', { eurPerT: 700, on: '2026-07-01' })).toBeNull();
    expect(compareWithCso(null, 'ROI', { eurPerT: 700, on: '2026-07-01' })).toBeNull();
    expect(compareWithCso('can', 'NI', { eurPerT: 700, on: '2026-07-01' })).toBeNull();
    expect(noComparisonReason('can', 'NI', true)).toMatch(/Republic of Ireland/);
    expect(noComparisonReason('protected_urea', 'ROI', true)).toMatch(/publishes no average/);
  });

  it('the CSO figures are fresh enough (the monthly job on GitHub keeps them up to date)', () => {
    // Fails if the monthly fetch has stopped for over 100 days. To fix: run Actions > CSO prices.
    expect(addDays(CSO_FETCHED_ON, 100) >= new Date().toISOString().slice(0, 10), `CSO figures fetched ${CSO_FETCHED_ON}`).toBe(true);
  });
});
