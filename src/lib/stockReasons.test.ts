import { describe, expect, it } from 'vitest';
import { countReasons, reasonTally, signedKg, worthAsking } from './stockReasons';
import { countVariances, forecastFeed } from './forecast/feed';
import { fertiliserVariances, stockFor } from './forecast/fertiliser';
import type { AnimalGroup, FeedProduct, FeedTransaction, FeedingRule, FertiliserProduct, FertiliserStock } from './types';

const T = '2026-10-14';
const txn = (o: Partial<FeedTransaction>): FeedTransaction => ({
  id: Math.random().toString(36), farm_id: 'f', feed_product_id: 'p', txn_type: 'count', quantity_kg: 0, order_date: null, delivery_date: null,
  expected_delivery_date: null, effective_on: T, order_status: null, linked_order_id: null, supplier_id: null, total_price_eur: null,
  price_per_tonne_eur: null, evidence: 'measured', document_id: null, notes: null, created_at: '2026-01-01T00:00:00Z', ...o
});
const group = { id: 'g', farm_id: 'f', name: 'Cows', animal_class: 'dairy_cow', head_count: 100, head_count_updated_at: '2026-10-01T00:00:00Z', archived: false } as unknown as AnimalGroup;
const rule = { id: 'r', farm_id: 'f', feed_product_id: 'p', animal_group_id: 'g', head_count_override: null, kg_per_head_per_feed: 1, feeds_per_day: 2, start_date: '2026-10-01', end_date: null, is_temporary: false } as unknown as FeedingRule;

describe('stock reasons (G11)', () => {
  it('asks why only when a check is a fair way off', () => {
    expect(worthAsking(1000, 1010)).toBe(false); // 10 kg
    expect(worthAsking(4000, 4040)).toBe(false); // 40 kg but 1%
    expect(worthAsking(900, 1000)).toBe(true);
    expect(worthAsking(900, null)).toBe(false);
  });

  it('offers reasons that fit the direction', () => {
    expect(countReasons(900, 1000)).toContain('wasted');
    expect(countReasons(900, 1000)).not.toContain('delivery_missing');
    expect(countReasons(1100, 1000)).toEqual(['count_error', 'delivery_missing', 'not_known']);
  });

  it('signs adjustments by reason; a counting error goes the way the farmer says', () => {
    expect(signedKg(200, 'wasted', 'more')).toBe(-200);
    expect(signedKg(200, 'count_error', 'more')).toBe(200);
    expect(signedKg(200, 'count_error', 'less')).toBe(-200);
  });

  it('an adjustment changes feed stock but never the feeding plan', () => {
    const product = { id: 'p', farm_id: 'f', name: 'Nut', safety_stock_days: 3, safety_stock_kg: null, lead_time_days: 3, archived: false } as unknown as FeedProduct;
    const base = [txn({ quantity_kg: 2000, effective_on: '2026-10-13' })];
    const args = { product, rules: [rule], groups: [group], supplierSetting: undefined, farmLeadTimeDays: null, today: T };
    const before = forecastFeed({ ...args, txns: base });
    const after = forecastFeed({ ...args, txns: [...base, txn({ txn_type: 'adjustment', quantity_kg: -300, reason: 'wasted' })] });
    expect(before.stockKg! - after.stockKg!).toBe(300);
    expect(after.dailyUseKg).toBe(before.dailyUseKg); // 200 kg/day either way
  });

  it('Predicted vs counted shows the reason and the adjustments since the last check', () => {
    const txns = [
      txn({ quantity_kg: 3000, effective_on: '2026-10-01' }),
      txn({ txn_type: 'adjustment', quantity_kg: -200, effective_on: '2026-10-05', reason: 'fed_other_group' }),
      txn({ quantity_kg: 300, effective_on: '2026-10-10', reason: 'wasted' })
    ];
    const v = countVariances(txns, [rule], [group]);
    expect(v).toHaveLength(1);
    // 3,000 − 9 days × 200 − 200 adjusted = 1,000 predicted on the 10th
    expect(v[0].predictedKg).toBe(1000);
    expect(v[0].reason).toBe('wasted');
    expect(v[0].adjustments).toEqual([{ on: '2026-10-05', kg: -200, reason: 'fed_other_group' }]);
    expect(reasonTally(v)).toBe('wasted 1, unplanned use 1');
  });
});

describe('fertiliser adjustments and checks (G11)', () => {
  const product = { id: 'c', farm_id: 'f', name: 'CAN', low_stock_kg: null, archived: false } as unknown as FertiliserProduct;
  const row = (o: Partial<FertiliserStock>): FertiliserStock => ({ id: Math.random().toString(36), farm_id: 'f', product_id: 'c', kind: 'count', quantity_kg: 0, on_date: T, evidence: 'measured', supplier_id: null, cost_id: null, notes: null, created_at: '2026-01-01T00:00:00Z', ...o });

  it('an adjustment takes off stock', () => {
    const b = { fertStock: [row({ kind: 'opening', quantity_kg: 2000, on_date: '2026-10-01' }), row({ kind: 'adjustment', quantity_kg: -100, on_date: '2026-10-02', reason: 'wasted' })], spreads: [], costs: [] };
    expect(stockFor(b, product, T).stockKg).toBe(1900);
  });

  it('a later check shows expected, checked and why', () => {
    const b = {
      fertStock: [
        row({ kind: 'opening', quantity_kg: 2000, on_date: '2026-10-01' }),
        row({ kind: 'adjustment', quantity_kg: -100, on_date: '2026-10-02', reason: 'wasted' }),
        row({ kind: 'count', quantity_kg: 1500, on_date: '2026-10-10', reason: 'fed_other_group' })
      ],
      spreads: [{ id: 's', farm_id: 'f', product_id: 'c', spread_on: '2026-10-05', kg_per_acre: null, total_kg: 200, notes: null }],
      costs: []
    };
    const v = fertiliserVariances(b as never, product);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ predictedKg: 1700, countedKg: 1500, varianceKg: -200, reason: 'fed_other_group' });
    expect(v[0].adjustments).toEqual([{ on: '2026-10-02', kg: -100, reason: 'wasted' }]);
  });
});
