import { describe, expect, it } from 'vitest';
import { estimateStore, forecastForage } from './forage';
import { budgetVsActual, cashForecast90, cashPosition, fyRange, yearEndPack } from './money';
import type { AnimalGroup, Farm, FarmBundle, ForageBenchmark, SilageStore } from '../types';

const farm: Farm = {
  id: 'f', name: 'Test', eircode: null, county: 'Tipperary', jurisdiction: 'ROI', enterprise: 'dairy',
  financial_year_start_month: 1, opening_cash_eur: 10000, opening_cash_date: '2026-01-01',
  default_lead_time_days: 3, forage_reserve_percent: 15, feed_target_days: 30, housing_start: '2026-11-01', turnout_date: '2027-03-01'
};
const store = (p: Partial<SilageStore>): SilageStore => ({
  id: 's', farm_id: 'f', name: 'Pit', method: 'pit_dimensions', acreage: null, yield_t_per_acre: null,
  length_m: null, width_m: null, avg_height_m: null, density_kg_m3: null, bale_count: null, bale_weight_kg: null,
  measured_tonnes: null, dm_percent: null, dmd_percent: null, crude_protein_percent: null, ph: null,
  measured_on: '2026-09-01', fed_out_tonnes: 0, notes: null, ...p
});
const bench: ForageBenchmark[] = [
  { id: '1', animal_class: 'dairy_cow', fresh_tonnes_per_month: 1.6, source_code: 'S3', valid_from: '2026-09-01' },
  { id: '2', animal_class: 'weanling', fresh_tonnes_per_month: 0.7, source_code: 'S3', valid_from: '2026-09-01' }
];
const grp = (p: Partial<AnimalGroup>): AnimalGroup => ({
  id: 'g', farm_id: 'f', name: 'Cows', animal_class: 'dairy_cow', head_count: 100, head_count_updated_at: '2026-09-30',
  forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0, ...p
});

describe('forage stores', () => {
  it('pit: L × W × H × density', () => {
    const e = estimateStore(store({ length_m: 40, width_m: 12, avg_height_m: 2.2, density_kg_m3: 700 }));
    expect(e.tonnes).toBeCloseTo(739.2, 1);
  });
  it('pit without density asks for it rather than assuming one', () => {
    const e = estimateStore(store({ length_m: 40, width_m: 12, avg_height_m: 2.2 }));
    expect(e.tonnes).toBeNull();
    expect(e.missing).toMatch(/density/);
  });
  it('acreage is flagged as a planning estimate', () => {
    const e = estimateStore(store({ method: 'acreage', acreage: 30, yield_t_per_acre: 10 }));
    expect(e.tonnes).toBe(300);
    expect(e.basis).toBe('planning_estimate');
  });
});

describe('forecastForage', () => {
  const base = { farm, benchmarks: bench, evidence: [], today: '2026-10-01' };
  it('uses Teagasc allowance with 15% reserve over the housing period', () => {
    const f = forecastForage({ ...base, stores: [store({ method: 'measured_tonnes', measured_tonnes: 900 })], groups: [grp({})] });
    expect(f.demandTPerMonth).toBeCloseTo(160);
    expect(f.monthsToCover).toBeCloseTo(120 / 30.4, 2);
    expect(f.needWithReserveT).toBeCloseTo(160 * (120 / 30.4) * 1.15, 1);
    expect(f.confidence).toBe('medium'); // benchmark used
  });
  it('prefers farm history per group and reaches high confidence', () => {
    const f = forecastForage({ ...base, stores: [store({ method: 'measured_tonnes', measured_tonnes: 900 })], groups: [grp({ forage_t_per_head_month: 1.5 })] });
    expect(f.groups[0].source).toBe('farm_history');
    expect(f.confidence).toBe('high');
  });
  it('asks for a figure when no benchmark exists instead of inventing one', () => {
    const f = forecastForage({ ...base, stores: [store({ method: 'measured_tonnes', measured_tonnes: 100 })], groups: [grp({ animal_class: 'bull', name: 'Bulls' })] });
    expect(f.groups[0].source).toBe('missing');
    expect(f.missing.join(' ')).toMatch(/Bulls/);
    expect(f.confidence).toBe('low');
  });
  it('reports deficit when stock is below need', () => {
    const f = forecastForage({ ...base, stores: [store({ method: 'measured_tonnes', measured_tonnes: 100 })], groups: [grp({})] });
    expect(f.status).toBe('deficit');
  });
});

describe('money', () => {
  it('fyRange handles non-January year starts', () => {
    expect(fyRange({ financial_year_start_month: 4 }, '2026-02-10')).toMatchObject({ start: '2025-04-01', end: '2026-03-31' });
    expect(fyRange({ financial_year_start_month: 1 }, '2026-02-10')).toMatchObject({ start: '2026-01-01', end: '2026-12-31' });
  });
  const inc = [{ id: '1', farm_id: 'f', income_type: 'milk' as const, occurred_on: '2026-02-15', amount_eur: 5000, counterparty: null, milk_litres: 10000, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: null, document_id: null }];
  const cst = [{ id: '2', farm_id: 'f', category: 'feed' as const, other_label: null, occurred_on: '2026-02-20', amount_eur: 2000, supplier_id: null, supplier_name: 'Co-op', feed_transaction_id: null, description: null, document_id: null }];
  it('cash position = opening + in − out', () => {
    expect(cashPosition(farm, inc, cst, '2026-03-01')?.balance).toBe(13000);
  });
  it('cash forecast keeps known and assumed separate', () => {
    const budget = [{ id: 'b', farm_id: 'f', year: 2026, month: 4, kind: 'cost' as const, category: 'feed', amount_eur: 3000 }];
    const fc = cashForecast90(farm, inc, cst, budget, '2026-03-01');
    const apr = fc.rows.find((r) => r.month === '2026-04')!;
    expect(apr.knownOut).toBe(0);
    expect(apr.assumedOut).toBe(3000);
  });
  it('budget vs actual marks thin data as inadequate', () => {
    const r = budgetVsActual(farm, { budget: [], income: [], costs: [] }, '2026-06-15');
    expect(r.adequate).toBe(false);
  });
  it('year-end pack lists missing milk months for a dairy farm', () => {
    const bundle = { farm, income: inc, costs: cst, txns: [], documents: [], suppliers: [] } as unknown as FarmBundle;
    const p = yearEndPack(bundle, '2026-05-10');
    expect(p.totalIncome).toBe(5000);
    expect(p.missing.find((m) => m.id === 'milk')?.text).toMatch(/3 months/);
  });
});
