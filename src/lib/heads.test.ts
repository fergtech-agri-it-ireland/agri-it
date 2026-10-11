import { describe, expect, it } from 'vitest';
import { groupsAsOf, headsOn, upcomingHeadChanges } from './heads';
import { forecastFeed, stockAt } from './forecast/feed';
import { withHistory } from './heads';
import type { AnimalGroup, FeedProduct, FeedTransaction, FeedingRule, HeadCountChange } from './types';

const TODAY = '2026-10-11';
const group: AnimalGroup = { id: 'g', farm_id: 'f', name: 'Bullocks', animal_class: 'bullock', head_count: 40, head_count_updated_at: '2026-10-11T08:00:00Z', forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0 };
const h = (count: number, on: string, previous: number | null, at = `${on}T10:00:00Z`): HeadCountChange => ({ id: `${count}-${on}`, farm_id: 'f', animal_group_id: 'g', head_count: count, previous_count: previous, effective_on: on, reason: 'manual', created_at: at });
const product: FeedProduct = { id: 'p', farm_id: 'f', supplier_id: null, name: 'Ration', storage_location: null, safety_stock_mode: 'days', safety_stock_value: 0, lead_time_days: null, archived: false };
const rule: FeedingRule = { id: 'r', farm_id: 'f', feed_product_id: 'p', animal_group_id: 'g', head_count_override: null, kg_per_head_per_feed: 2, feeds_per_day: 1, start_date: '2026-09-01', end_date: null, is_temporary: false, label: null, confirm_daily: false };
const count: FeedTransaction = { id: 'c', farm_id: 'f', feed_product_id: 'p', txn_type: 'count', quantity_kg: 10000, order_date: null, delivery_date: null, expected_delivery_date: null, effective_on: '2026-10-01', order_status: null, linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null, evidence: 'measured', document_id: null, notes: null, created_at: '2026-10-01T08:00:00Z' };

describe('head counts with dates', () => {
  it('uses the count in force on each day; before the first change, the count it replaced', () => {
    const hist = [h(40, '2026-10-06', 50)];
    expect(headsOn(group, '2026-10-05', hist)).toBe(50);
    expect(headsOn(group, '2026-10-06', hist)).toBe(40);
    expect(headsOn(group, '2026-11-01', hist)).toBe(40);
    expect(headsOn(group, '2026-10-05', [])).toBe(40); // no history: the group's own count
  });
  it("a count booked for later isn't today's count yet", () => {
    const hist = [h(40, '2026-10-01', 50), h(20, '2026-10-20', 40)];
    expect(groupsAsOf([{ ...group, head_count: 20 }], hist, TODAY)[0].head_count).toBe(40);
    expect(upcomingHeadChanges(hist, TODAY).map((x) => x.head_count)).toEqual([20]);
  });
});

describe('UAT-02: changing group numbers keeps what was already eaten', () => {
  const groups = new Map(withHistory([group], [h(40, '2026-10-06', 50)]).map((g) => [g.id, g]));
  it('selling 10 on the 6th: the 1st to 5th used 50 head, the rest 40', () => {
    // 5 days × 50 × 2 kg + 5 days × 40 × 2 kg = 500 + 400 = 900 kg used by the start of the 11th
    expect(stockAt([count], [rule], groups, TODAY).stock).toBe(10000 - 900);
    // Without dates (the old behaviour) every day would have used 40: 10 days × 80 = 800
    const flat = new Map([[group.id, group]]);
    expect(stockAt([count], [rule], flat, TODAY).stock).toBe(10000 - 800);
  });
  it('a sale booked for next week changes the forecast only from that day', () => {
    const later = [h(40, '2026-10-01', 40), h(10, '2026-10-18', 40)];
    const f = forecastFeed({ product, txns: [count], rules: [rule], groups: [group], farmLeadTimeDays: null, today: TODAY, headHistory: later });
    expect(f.dailyUseKg).toBe(80);
    expect(f.upcomingChanges[0]).toMatchObject({ date: '2026-10-18', dailyUseKg: 20 });
    expect(f.upcomingChanges[0].reason).toContain('10 head');
    // 10,000 − 10 days × 80 = 9,200 today; 7 more days at 80 (560) leaves 8,640, then 20 a day = 432 more days: past the horizon
    expect(f.stockKg).toBe(9200);
  });
});
