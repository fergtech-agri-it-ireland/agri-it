import { describe, expect, it } from 'vitest';
import { cashCompleteness, cashForecast90, cashPosition, reconcileCash } from './money';
import type { Cost, Farm, Income, Routine } from '../types';

const TODAY = '2026-10-14';
const farm = (over: Partial<Farm> = {}) => ({ id: 'f', financial_year_start_month: 1, opening_cash_eur: 10000, opening_cash_date: '2026-10-01', enterprises: ['dairy'], ...over } as unknown as Farm);
const inc = (on: string, amount: number, type: Income['income_type'] = 'milk'): Income => ({ id: `${on}-${type}`, farm_id: 'f', income_type: type, occurred_on: on, amount_eur: amount } as Income);
const cost = (on: string, amount: number, category: Cost['category'] = 'fertiliser'): Cost => ({ id: `${on}-${category}`, farm_id: 'f', category, occurred_on: on, amount_eur: amount } as Cost);
const routine = (r: Partial<Routine>): Routine => ({
  id: 'r', farm_id: 'f', kind: 'expense', title: 'Electricity', frequency: 'monthly', interval_days: null, weekday: null, day_of_month: 20,
  start_date: '2026-01-01', end_date: null, amount: 300, category: 'utilities', counterparty: null, feed_product_id: null, silage_store_id: null,
  supplier_id: null, active: true, created_at: '2026-01-01T00:00:00Z', ...r
});
const empty = { income: [] as Income[], costs: [] as Cost[], budget: [], routines: [] as Routine[] };

describe('recorded cash is labelled by what it is built from (review G02)', () => {
  it('says when the balance was last checked, and asks again after 30 days', () => {
    expect(cashCompleteness(farm(), empty, TODAY)).toMatchObject({ checkedOn: '2026-10-01', daysSinceCheck: 13, stale: false });
    const old = cashCompleteness(farm({ opening_cash_date: '2026-08-01' }), empty, TODAY);
    expect(old.stale).toBe(true);
    expect(old.gaps[0].id).toBe('stale');
    expect(cashCompleteness(farm({ opening_cash_eur: null, opening_cash_date: null }), empty, TODAY).gaps[0].id).toBe('no-balance');
  });

  it('flags regular money with nothing expected in the next 90 days, and bills with no due date', () => {
    const b = {
      ...empty,
      income: [inc('2026-08-15', 20000), inc('2026-09-15', 21000)],
      costs: [cost('2026-08-02', 900), cost('2026-09-03', 1100), { ...cost('2026-10-10', 400, 'vet_medicine'), payment_status: 'owed' } as Cost]
    };
    const ids = cashCompleteness(farm(), b, TODAY).gaps.map((g) => g.id);
    expect(ids).toEqual(['no-budget', 'income-milk', 'cost-fertiliser', 'undated']);
    // A budget for milk and a repeat for fertiliser: nothing left to warn about but the undated bill
    const covered = { ...b, budget: [{ id: 'l', farm_id: 'f', year: 2026, month: 11, kind: 'income' as const, category: 'milk', amount_eur: 20000 }], routines: [routine({ category: 'fertiliser' })] };
    expect(cashCompleteness(farm(), covered, TODAY).gaps.map((g) => g.id)).toEqual(['undated']);
  });

  it('checking against the bank keeps the balance as the end of today and says how far out it was', () => {
    const f = farm();
    const recorded = cashPosition(f, [inc('2026-10-05', 2000)], [cost('2026-10-14', 500)], TODAY)!.balance;
    expect(recorded).toBe(11500);
    const r = reconcileCash(recorded, 11200, TODAY);
    expect(r).toEqual({ opening_cash_eur: 11200, opening_cash_date: '2026-10-15', difference: -300 });
    // Today's bill is taken as already in the bank figure: not taken off again
    const after = cashPosition({ ...f, ...r } as Farm, [inc('2026-10-05', 2000)], [cost('2026-10-14', 500)], TODAY)!;
    expect(after.balance).toBe(11200);
    expect(cashCompleteness({ ...f, ...r } as Farm, empty, TODAY).daysSinceCheck).toBe(0);
  });

  it('repeats the farmer set up are in the 90-day forecast, and their budget line is not counted twice', () => {
    const budget = [{ id: 'l', farm_id: 'f', year: 2026, month: 11, kind: 'cost' as const, category: 'utilities', amount_eur: 250 }];
    const without = cashForecast90(farm(), [], [], budget, TODAY);
    const withR = cashForecast90(farm(), [], [], budget, TODAY, undefined, [routine({})]);
    const nov0 = without.rows.find((r) => r.month === '2026-11')!;
    const nov = withR.rows.find((r) => r.month === '2026-11')!;
    expect(nov0.assumedOut).toBe(250);
    expect(nov.regularOut).toBe(300);
    expect(nov.assumedOut).toBe(0);
    // Oct 20, Nov 20, Dec 20: three electricity bills of 300 by mid-January
    expect(withR.rows.reduce((t, r) => t + r.regularOut, 0)).toBe(900);
  });
});
