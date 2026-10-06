import { describe, expect, it } from 'vitest';
import { countVariances, forecastFeed, rulesForDay } from './feed';
import type { AnimalGroup, FeedProduct, FeedTransaction, FeedingRule } from '../types';
import { addDays } from '../format';

const TODAY = '2026-10-01';
const recent = '2026-09-30T10:00:00Z';

const group = (id: string, name: string, heads: number, updated = recent): AnimalGroup => ({
  id, farm_id: 'f', name, animal_class: 'dairy_cow', head_count: heads, head_count_updated_at: updated,
  forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0
});
const product: FeedProduct = {
  id: 'p', farm_id: 'f', supplier_id: null, name: 'Dairy nut', storage_location: null,
  safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: 3, archived: false
};
const txn = (p: Partial<FeedTransaction>): FeedTransaction => ({
  id: Math.random().toString(36), farm_id: 'f', feed_product_id: 'p', txn_type: 'delivery', quantity_kg: 0,
  order_date: null, delivery_date: null, expected_delivery_date: null, effective_on: TODAY, order_status: null,
  linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null,
  evidence: 'confirmed_docket', document_id: null, notes: null, created_at: recent, ...p
});
const rule = (p: Partial<FeedingRule>): FeedingRule => ({
  id: Math.random().toString(36), farm_id: 'f', feed_product_id: 'p', animal_group_id: 'cows',
  head_count_override: null, kg_per_head_per_feed: 1, feeds_per_day: 1, start_date: '2026-01-01',
  end_date: null, is_temporary: false, label: null, ...p
});

const groups = [group('cows', 'Dairy cows', 120), group('heifers', 'Heifers', 40)];
const specRules = [
  rule({ animal_group_id: 'cows', kg_per_head_per_feed: 1, feeds_per_day: 2 }),
  rule({ animal_group_id: 'heifers', kg_per_head_per_feed: 1, feeds_per_day: 1 })
];

describe('forecastFeed: spec worked example (section 4.2)', () => {
  const f = forecastFeed({
    product,
    txns: [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'measured' })],
    rules: specRules, groups, farmLeadTimeDays: null, today: TODAY
  });

  it('sums daily use across groups: 120×1×2 + 40×1×1 = 280 kg/day', () => {
    expect(f.dailyUseKg).toBe(280);
  });
  it('8,000 kg lasts 28.6 days', () => {
    expect(f.daysRemaining).toBeCloseTo(28.57, 1);
    expect(f.runOutDate).toBe(addDays(TODAY, 28));
  });
  it('3-day safety stock is 840 kg and is reached after ~25.6 days', () => {
    expect(f.safetyKg).toBe(840);
    expect(f.reorderDate).toBe(addDays(TODAY, 25));
  });
  it('order-by = reorder date minus 3-day lead time', () => {
    expect(f.orderByDate).toBe(addDays(TODAY, 22));
    expect(f.leadTimeSource).toBe('feed');
  });
  it('is high confidence with a measured count, current head counts and explicit rules', () => {
    expect(f.confidence).toBe('high');
    expect(f.status).toBe('ok');
  });
});

describe('forecastFeed: behaviour required by acceptance criteria', () => {
  it('recalculates when a head count changes, without re-entering the delivery', () => {
    const txns = [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'measured' })];
    const before = forecastFeed({ product, txns, rules: specRules, groups, farmLeadTimeDays: null, today: TODAY });
    const moreCows = [group('cows', 'Dairy cows', 160), groups[1]];
    const after = forecastFeed({ product, txns, rules: specRules, groups: moreCows, farmLeadTimeDays: null, today: TODAY });
    expect(after.dailyUseKg).toBe(360);
    expect(after.runOutDate! < before.runOutDate!).toBe(true);
  });

  it('does not count an open order as stock', () => {
    const txns = [
      txn({ txn_type: 'count', quantity_kg: 1000, effective_on: TODAY, evidence: 'measured' }),
      txn({ txn_type: 'order', quantity_kg: 5000, order_status: 'open', effective_on: addDays(TODAY, 2), expected_delivery_date: addDays(TODAY, 2) })
    ];
    const f = forecastFeed({ product, txns, rules: specRules, groups, farmLeadTimeDays: null, today: TODAY });
    expect(f.stockKg).toBe(1000);
    expect(f.openOrders).toHaveLength(1);
    expect(f.runOutWithOpenOrders! > f.runOutDate!).toBe(true);
  });

  it('subtracts planned use since the last count and adds later deliveries', () => {
    const txns = [
      txn({ txn_type: 'count', quantity_kg: 2000, effective_on: addDays(TODAY, -5), evidence: 'measured' }),
      txn({ txn_type: 'delivery', quantity_kg: 3000, effective_on: addDays(TODAY, -2) })
    ];
    const f = forecastFeed({ product, txns, rules: specRules, groups, farmLeadTimeDays: null, today: TODAY });
    expect(f.stockKg).toBe(2000 + 3000 - 5 * 280);
  });

  it('never invents a lead time: no lead time means no order-by date', () => {
    const f = forecastFeed({
      product: { ...product, lead_time_days: null },
      txns: [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'measured' })],
      rules: specRules, groups, farmLeadTimeDays: null, today: TODAY
    });
    expect(f.orderByDate).toBeNull();
    expect(f.reorderDate).not.toBeNull();
    expect(f.reasons.join(' ')).toMatch(/No lead time/);
  });

  it('falls back to the farm default lead time', () => {
    const f = forecastFeed({
      product: { ...product, lead_time_days: null },
      txns: [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'measured' })],
      rules: specRules, groups, farmLeadTimeDays: 5, today: TODAY
    });
    expect(f.leadTimeSource).toBe('farm');
    expect(f.orderByDate).toBe(addDays(TODAY, 20));
  });

  it('flags order now when the order-by date has passed', () => {
    const f = forecastFeed({
      product,
      txns: [txn({ txn_type: 'count', quantity_kg: 1500, effective_on: TODAY, evidence: 'measured' })],
      rules: specRules, groups, farmLeadTimeDays: null, today: TODAY
    });
    expect(f.status).toBe('order_now');
  });
});

describe('temporary feeding plans (section 4.3)', () => {
  const temp = rule({
    animal_group_id: 'cows', kg_per_head_per_feed: 2, feeds_per_day: 2, is_temporary: true,
    start_date: addDays(TODAY, 3), end_date: addDays(TODAY, 16), label: 'Extra for a fortnight'
  });
  const rules = [...specRules, temp];

  it('replaces the group’s normal rule during its window, then reverts', () => {
    expect(rulesForDay(rules, TODAY)).toHaveLength(2);
    const during = rulesForDay(rules, addDays(TODAY, 5));
    expect(during).toHaveLength(2);
    expect(during.find((r) => r.animal_group_id === 'cows')?.is_temporary).toBe(true);
    expect(rulesForDay(rules, addDays(TODAY, 17)).every((r) => !r.is_temporary)).toBe(true);
  });

  it('warns earlier when a rate increase is planned', () => {
    const txns = [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'measured' })];
    const base = forecastFeed({ product, txns, rules: specRules, groups, farmLeadTimeDays: null, today: TODAY });
    const withTemp = forecastFeed({ product, txns, rules, groups, farmLeadTimeDays: null, today: TODAY });
    expect(withTemp.runOutDate! < base.runOutDate!).toBe(true);
    expect(withTemp.upcomingChanges[0].date).toBe(addDays(TODAY, 3));
    expect(withTemp.upcomingChanges[0].dailyUseKg).toBe(120 * 2 * 2 + 40);
  });
});

describe('confidence (section 4.4)', () => {
  it('is low when opening stock is an estimate', () => {
    const f = forecastFeed({
      product,
      txns: [txn({ txn_type: 'opening', quantity_kg: 500, effective_on: TODAY, evidence: 'farmer_estimate' })],
      rules: specRules, groups, farmLeadTimeDays: null, today: TODAY
    });
    expect(f.confidence).toBe('low');
  });
  it('is medium when stock is invoice-derived', () => {
    const f = forecastFeed({
      product,
      txns: [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'invoice_derived' })],
      rules: specRules, groups, farmLeadTimeDays: null, today: TODAY
    });
    expect(f.confidence).toBe('medium');
  });
  it('is medium when head counts are stale', () => {
    const stale = [group('cows', 'Dairy cows', 120, '2026-06-01T00:00:00Z'), groups[1]];
    const f = forecastFeed({
      product,
      txns: [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'measured' })],
      rules: specRules, groups: stale, farmLeadTimeDays: null, today: TODAY
    });
    expect(f.confidence).toBe('medium');
  });
  it('is low with no feeding plan', () => {
    const f = forecastFeed({
      product,
      txns: [txn({ txn_type: 'count', quantity_kg: 8000, effective_on: TODAY, evidence: 'measured' })],
      rules: [], groups, farmLeadTimeDays: null, today: TODAY
    });
    expect(f.confidence).toBe('low');
    expect(f.status).toBe('no_plan');
  });
});

describe('predicted vs counted', () => {
  it('reports the variance at each later count', () => {
    const txns = [
      txn({ txn_type: 'count', quantity_kg: 5000, effective_on: addDays(TODAY, -10), evidence: 'measured' }),
      txn({ txn_type: 'count', quantity_kg: 2000, effective_on: TODAY, evidence: 'measured' })
    ];
    const v = countVariances(txns, specRules, groups);
    const last = v.at(-1)!;
    expect(last.predictedKg).toBe(5000 - 10 * 280);
    expect(last.varianceKg).toBe(2000 - 2200);
  });
});
