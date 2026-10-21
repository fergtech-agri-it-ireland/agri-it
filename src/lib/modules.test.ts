import { describe, expect, it } from 'vitest';
import { dashboardModules, moduleCounts, moduleOf } from './modules';
import { derive } from './data/derived';
import type { AnimalGroup, Cost, Farm, FarmBundle, FeedingRule, FeedProduct, FeedTransaction } from './types';

const TODAY = '2026-11-25';
const farm = {
  id: 'f', name: 'Test', jurisdiction: 'ROI', enterprise: 'dairy', enterprises: ['dairy'], financial_year_start_month: 1, opening_cash_eur: 10000,
  opening_cash_date: '2026-01-01', default_lead_time_days: 3, forage_reserve_percent: 15, feed_target_days: 30, housing_start: '2026-11-15', turnout_date: '2027-03-01'
} as unknown as Farm;
const group = (x: Partial<AnimalGroup> = {}): AnimalGroup => ({
  id: 'g', farm_id: 'f', name: 'Cows', animal_class: 'dairy_cow', head_count: 100, head_count_updated_at: `${TODAY}T08:00:00Z`, forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0, ...x
} as AnimalGroup);
const bundle = (over: Partial<FarmBundle> = {}): FarmBundle => ({
  farm, groups: [group()], crops: [], suppliers: [{ id: 'tir', name: 'Tirlán' } as FarmBundle['suppliers'][number]], branches: [], supplierSettings: [], products: [],
  txns: [], rules: [], silage: [], benchmarks: [], evidence: [], income: [], costs: [], budget: [], records: [], documents: [], jobs: [], routines: [], completions: [], feedLogs: [], headHistory: [],
  seasons: [], births: [], decisions: [], fields: [], fertilisers: [], fertStock: [], spreads: [], spreadFields: [], loans: [], loanStatements: [], expected: [], yearValues: [], ...over
});
const keys = (t: { key: string }[]) => t.map((x) => x.key);

describe('which module a to-do belongs to', () => {
  it('sorts items by id, then by where they go', () => {
    expect(moduleOf('feed-nut')).toBe('feed');
    expect(moduleOf('place-1')).toBe('feed');
    expect(moduleOf('order:nut:2026-12-01')).toBe('feed');
    expect(moduleOf('fert-order-1')).toBe('fields'); // a fertiliser order is not a feed order
    expect(moduleOf('fert-round-9')).toBe('fields');
    expect(moduleOf('forage')).toBe('silage');
    expect(moduleOf('silage-dm:abc')).toBe('silage');
    expect(moduleOf('bills-overdue')).toBe('money');
    expect(moduleOf('feed-uninvoiced')).toBe('money'); // an invoice to match is money work
    expect(moduleOf('loan:l1:2026-11-25')).toBe('loans');
    expect(moduleOf('heads')).toBe('animals');
    expect(moduleOf('season:s1:dry-off')).toBe('animals');
    expect(moduleOf('job-1')).toBeNull(); // jobs and routines live in the diary
    expect(moduleOf('something-new', '/money/bills')).toBe('money');
    expect(moduleOf('something-new', '/farm/fields')).toBe('fields');
    expect(moduleOf('something-new', '/nowhere')).toBeNull();
  });

  it('counts what is waiting in each module and keeps the most pressing tone', () => {
    const c = moduleCounts(
      [{ id: 'feed-nut', to: '/feed/nut', tone: 'warn' }, { id: 'place-1', to: '/feed/nut', tone: 'urgent' }, { id: 'bills-due', to: '/money/bills', tone: 'info' }, { id: 'job-1', to: '/farm/jobs', tone: 'info' }],
      [{ key: 'heads:g@2026-09-01', tone: 'info' }]
    );
    expect(c.feed).toEqual({ count: 2, tone: 'urgent' });
    expect(c.money).toEqual({ count: 1, tone: 'info' });
    expect(c.animals).toEqual({ count: 1, tone: 'info' });
    expect(c.records).toBeUndefined();
  });
});

describe('dashboard module tiles', () => {
  it('a new dairy farm gets the modules it needs and a plain line for each, nothing invented', () => {
    const b = bundle();
    const tiles = dashboardModules(b, derive(b, TODAY), TODAY);
    expect(keys(tiles)).toEqual(['feed', 'silage', 'animals', 'milk', 'fields', 'money', 'reports', 'loans', 'records', 'suppliers']);
    const line = (k: string) => tiles.find((t) => t.key === k)!.line;
    expect(line('feed')).toBe('Add the feed you buy');
    expect(line('animals')).toBe('1 group, 100 cattle');
    expect(line('milk')).toBe('Add a milk cheque');
    expect(line('fields')).toBe('Add your fields and what is in the shed');
    expect(line('loans')).toBe('Repayments, interest, scheme payments');
  });

  it('feed says how many days are left, and its badge counts the to-dos in that module', () => {
    const p: FeedProduct = { id: 'nut', farm_id: 'f', supplier_id: 'tir', name: 'Dairy nut', storage_location: null, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: null, archived: false };
    const rule: FeedingRule = { id: 'r', farm_id: 'f', feed_product_id: 'nut', animal_group_id: 'g', head_count_override: null, kg_per_head_per_feed: 1, feeds_per_day: 2, start_date: '2026-11-01', end_date: null, is_temporary: false, label: null, confirm_daily: false };
    const deliv = { id: 'd', farm_id: 'f', feed_product_id: 'nut', txn_type: 'delivery', quantity_kg: 8000, effective_on: '2026-11-10', delivery_date: '2026-11-10', order_date: null, expected_delivery_date: null, order_status: null, evidence: 'confirmed_docket', supplier_id: 'tir', price_per_tonne_eur: 400, total_price_eur: 3200 } as unknown as FeedTransaction;
    const count = { ...deliv, id: 'c', txn_type: 'count', quantity_kg: 1000, evidence: 'measured' } as FeedTransaction;
    const b = bundle({ products: [p], rules: [rule], txns: [count, deliv] });
    const d = derive(b, TODAY);
    const feed = dashboardModules(b, d, TODAY).find((t) => t.key === 'feed')!;
    expect(feed.line).toMatch(/^1 feed, \d+ days? left$/);
    expect(feed.to).toBe('/feed/nut'); // one feed: straight to it
    expect(feed.count).toBeGreaterThan(0); // the drafted order waits in this module
    expect(feed.tone).not.toBe('info');
  });

  it('a farm worker sees no money, loans or milk tiles', () => {
    const b = bundle({ role: 'worker' });
    expect(keys(dashboardModules(b, derive(b, TODAY), TODAY))).not.toEqual(expect.arrayContaining(['money']));
    const k = keys(dashboardModules(b, derive(b, TODAY), TODAY));
    expect(k).not.toContain('money');
    expect(k).not.toContain('loans');
    expect(k).not.toContain('milk');
  });

  it('shows the owed-bill badge on money and the last milk cheque on milk', () => {
    const owed: Cost = { id: 'c1', farm_id: 'f', category: 'vet_medicine', other_label: null, occurred_on: '2026-11-01', amount_eur: 300, supplier_id: null, supplier_name: 'Vet', feed_transaction_id: null, description: null, document_id: null, payment_status: 'owed', due_on: '2026-11-10' } as unknown as Cost;
    const milk = { id: 'm1', farm_id: 'f', income_type: 'milk', occurred_on: '2026-11-20', amount_eur: 5000, milk_litres: 100000 } as unknown as FarmBundle['income'][number];
    const b = bundle({ costs: [owed], income: [milk] });
    const tiles = dashboardModules(b, derive(b, TODAY), TODAY);
    const money = tiles.find((t) => t.key === 'money')!;
    expect(money.count).toBeGreaterThan(0);
    expect(money.tone).not.toBe('info'); // overdue bill
    expect(tiles.find((t) => t.key === 'milk')!.line).toContain('5.0c a litre');
  });
});
