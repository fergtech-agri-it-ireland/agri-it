import { describe, expect, it } from 'vitest';
import { budgetAlerts, budgetVsActual } from './money';
import type { BudgetLine, Cost, Farm, Income } from '../types';

const farm: Farm = {
  id: 'f', name: 'Test', eircode: null, county: 'Tipperary', jurisdiction: 'ROI', enterprise: 'dairy',
  financial_year_start_month: 1, opening_cash_eur: 10000, opening_cash_date: '2026-01-01',
  default_lead_time_days: 3, forage_reserve_percent: 15, feed_target_days: 30, housing_start: null, turnout_date: null
};
let n = 0;
const cost = (category: Cost['category'], occurred_on: string, amount_eur: number): Cost => ({
  id: `c${n++}`, farm_id: 'f', category, other_label: null, occurred_on, amount_eur, supplier_id: null, supplier_name: null, feed_transaction_id: null, description: null, document_id: null
});
const milk = (occurred_on: string, amount_eur: number): Income => ({
  id: `i${n++}`, farm_id: 'f', income_type: 'milk', occurred_on, amount_eur, counterparty: null, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: null, document_id: null
});
const budgetLines = (kind: 'income' | 'cost', category: string, perMonth: number): BudgetLine[] =>
  Array.from({ length: 12 }, (_, i) => ({ id: `${category}${i}`, farm_id: 'f', year: 2026, month: i + 1, kind, category, amount_eur: perMonth }));

const months = ['01', '02', '03', '04', '05'];
const budget = [...budgetLines('cost', 'feed', 1000), ...budgetLines('cost', 'vet_medicine', 500), ...budgetLines('cost', 'fertiliser', 400), ...budgetLines('income', 'milk', 10000)];
const costs = [
  ...months.map((m) => cost('feed', `2026-${m}-05`, 1200)), // 20% over every month
  ...months.map((m) => cost('vet_medicine', `2026-${m}-10`, 500)), cost('vet_medicine', '2026-06-03', 800), // fine until June
  ...['01', '02', '03', '04'].map((m) => cost('fertiliser', `2026-${m}-12`, 300)), cost('fertiliser', '2026-05-12', 700) // one bad month
];
const income = months.map((m) => milk(`2026-${m}-15`, 8000)); // 20% behind

describe('budget variance alerts', () => {
  const alerts = budgetAlerts(farm, { budget, costs, income }, '2026-06-15');

  it('raises one alert per category, most important first', () => {
    expect(alerts.map((a) => [a.category, a.scope, a.tone])).toEqual([
      ['milk', 'year', 'warn'],
      ['feed', 'year', 'warn'],
      ['vet_medicine', 'this_month', 'warn'],
      ['fertiliser', 'last_month', 'info']
    ]);
  });

  it('year-so-far uses completed months only, with € and %', () => {
    const feed = alerts.find((a) => a.category === 'feed')!;
    expect(feed.amount).toBe(1000);
    expect(feed.detail).toBe('€1,000 over (20%) to the end of May');
    const milkAlert = alerts.find((a) => a.category === 'milk')!;
    expect(milkAlert.title).toBe(`${milkAlert.label} is behind budget`);
    expect(milkAlert.amount).toBe(10000);
  });

  it('a bill early in the month does not count as overspend against a part-month budget', () => {
    // June's whole feed budget spent on the 5th: on plan for the month, so no alert
    const onlyEarly = budgetAlerts(farm, { budget: budgetLines('cost', 'feed', 1000), costs: [...months.map((m) => cost('feed', `2026-${m}-05`, 1000)), cost('feed', '2026-06-05', 1000)], income }, '2026-06-06');
    expect(onlyEarly).toEqual([]);
  });

  it('small overspends stay quiet', () => {
    const small = budgetAlerts(farm, { budget: budgetLines('cost', 'feed', 1000), costs: months.map((m) => cost('feed', `2026-${m}-05`, 1040)), income }, '2026-06-15');
    expect(small).toEqual([]); // 4% over, under the 10% and €250 bar
  });

  it('no alerts while most months have no records', () => {
    expect(budgetAlerts(farm, { budget, costs: [cost('feed', '2026-06-01', 9000)], income: [] }, '2026-06-15')).toEqual([]);
  });

  it('budget rows split completed months from the month in progress', () => {
    const bva = budgetVsActual(farm, { budget, costs, income }, '2026-06-15');
    const vet = bva.rows.find((r) => r.category === 'vet_medicine')!;
    expect(bva.lastClosedMonth).toBe('2026-05');
    expect(vet.closed).toEqual({ budget: 2500, actual: 2500, variance: 0 });
    expect(vet.thisMonth).toEqual({ budget: 500, actual: 800 });
  });
});
