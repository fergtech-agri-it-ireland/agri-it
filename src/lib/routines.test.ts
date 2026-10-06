import { describe, expect, it } from 'vitest';
import { buildChecklist, checklistProgress, dueDates, isDue, nextDue, scheduleLabel } from './routines';
import { forecastFeed } from './forecast/feed';
import type { AnimalGroup, FeedProduct, FeedTransaction, FeedUseLog, FeedingRule, Routine } from './types';
import { addDays } from './format';

const TODAY = '2026-10-06'; // a Tuesday
const base: Routine = {
  id: 'r1', farm_id: 'f', kind: 'expense', title: 'ESB bill', frequency: 'monthly', interval_days: null, weekday: null, day_of_month: 20,
  start_date: '2026-01-01', end_date: null, amount: 640, category: 'utilities', counterparty: 'ESB', feed_product_id: null,
  silage_store_id: null, supplier_id: null, active: true, created_at: '2026-01-01T09:00:00Z'
};

describe('schedules', () => {
  it('weekly falls on the chosen weekday', () => {
    const r = { ...base, frequency: 'weekly' as const, weekday: 1, day_of_month: null };
    expect(dueDates(r, '2026-10-01', '2026-10-31')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(scheduleLabel(r)).toBe('Every Monday');
  });
  it('monthly on the 31st falls on the last day of shorter months', () => {
    const r = { ...base, day_of_month: 31 };
    expect(isDue(r, '2026-09-30')).toBe(true);
    expect(isDue(r, '2026-02-28')).toBe(true);
    expect(isDue(r, '2026-10-31')).toBe(true);
    expect(scheduleLabel(r)).toBe('Monthly on the 31st');
  });
  it('every N days counts from the start date', () => {
    const r = { ...base, frequency: 'every_n_days' as const, interval_days: 21, start_date: '2026-10-01', day_of_month: null };
    expect(dueDates(r, '2026-10-01', '2026-11-30')).toEqual(['2026-10-01', '2026-10-22', '2026-11-12']);
  });
  it('respects start, end and paused', () => {
    expect(isDue({ ...base, start_date: '2026-11-01' }, '2026-10-20')).toBe(false);
    expect(isDue({ ...base, end_date: '2026-09-30' }, '2026-10-20')).toBe(false);
    expect(isDue({ ...base, active: false }, '2026-10-20')).toBe(false);
    expect(nextDue(base, TODAY)).toBe('2026-10-20');
  });
});

const group = (id: string, name: string, heads: number): AnimalGroup => ({
  id, farm_id: 'f', name, animal_class: 'in_calf_heifer', head_count: heads, head_count_updated_at: '2026-10-05T00:00:00Z',
  forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0
});
const product: FeedProduct = { id: 'p', farm_id: 'f', supplier_id: null, name: 'Heifer nut', storage_location: null, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: 3, archived: false };
const rule = (p: Partial<FeedingRule>): FeedingRule => ({
  id: 'rule1', farm_id: 'f', feed_product_id: 'p', animal_group_id: 'heif', head_count_override: null, kg_per_head_per_feed: 2, feeds_per_day: 1,
  start_date: '2026-09-01', end_date: null, is_temporary: false, label: null, confirm_daily: true, created_at: '2026-10-04T08:00:00Z', ...p
});
const log = (p: Partial<FeedUseLog>): FeedUseLog => ({
  id: Math.random().toString(36), farm_id: 'f', feeding_rule_id: 'rule1', feed_product_id: 'p', animal_group_id: 'heif', used_on: TODAY,
  planned_kg: 80, actual_kg: 80, status: 'fed', created_at: '2026-10-06T08:00:00Z', ...p
});
const groups = [group('heif', 'Heifers', 40)];
const bundle = (over: Record<string, unknown> = {}) => ({ rules: [rule({})], groups, products: [product], silage: [], routines: [], completions: [], feedLogs: [], ...over });

describe('checklist: the 2 kg per heifer example', () => {
  it('a daily plan becomes one tick a day: 40 heifers × 2 kg = 80 kg', () => {
    const items = buildChecklist(bundle(), TODAY);
    const today = items.filter((i) => i.date === TODAY);
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ kind: 'feeding', planned: 80, status: 'pending', title: 'Heifers: 80 kg Heifer nut' });
  });
  it('unticked days since the rule was set up show as from earlier, never before it existed', () => {
    const items = buildChecklist(bundle(), TODAY);
    expect(items.filter((i) => i.overdue).map((i) => i.date)).toEqual(['2026-10-04', '2026-10-05']);
  });
  it('ticked days drop off; today stays, marked done with the actual amount', () => {
    const items = buildChecklist(bundle({ feedLogs: [log({ used_on: '2026-10-04' }), log({ used_on: '2026-10-05' }), log({ actual_kg: 90, status: 'changed' })] }), TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'done', actual: 90 });
    expect(checklistProgress(items, TODAY)).toEqual({ done: 1, total: 1, earlier: 0 });
  });
  it('rules switched off for ticking stay out of the list', () => {
    expect(buildChecklist(bundle({ rules: [rule({ confirm_daily: false })] }), TODAY)).toHaveLength(0);
  });
  it('routines due in the last week appear once, until ticked', () => {
    const weekly: Routine = { ...base, id: 'w', kind: 'job', title: 'Check troughs', frequency: 'weekly', weekday: 1, day_of_month: null, amount: null };
    const items = buildChecklist(bundle({ rules: [], routines: [weekly, base] }), TODAY);
    expect(items.map((i) => [i.title, i.date, i.overdue])).toEqual([['Check troughs', '2026-10-05', true]]);
    const done = buildChecklist(bundle({ rules: [], routines: [weekly], completions: [{ id: 'c', farm_id: 'f', routine_id: 'w', due_date: '2026-10-05', status: 'done', amount: null, record_table: null, record_id: null, done_on: '2026-10-05', created_at: '' }] }), TODAY);
    expect(done).toHaveLength(0);
  });
});

describe('forecast uses what was actually fed', () => {
  const txns: FeedTransaction[] = [{
    id: 't', farm_id: 'f', feed_product_id: 'p', txn_type: 'count', quantity_kg: 2000, order_date: null, delivery_date: null, expected_delivery_date: null,
    effective_on: '2026-10-03', order_status: null, linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null,
    evidence: 'measured', document_id: null, notes: null, created_at: '2026-10-03T08:00:00Z'
  }];
  const run = (logs: FeedUseLog[]) => forecastFeed({ product, txns, rules: [rule({})], groups, farmLeadTimeDays: null, today: TODAY, logs });

  it('without ticks, the plan is used (3 days × 80 kg)', () => {
    expect(run([]).stockKg).toBe(2000 - 3 * 80);
  });
  it('confirmed amounts replace the plan, a skip uses nothing', () => {
    const f = run([log({ used_on: '2026-10-03', actual_kg: 100, status: 'changed' }), log({ used_on: '2026-10-04', actual_kg: 0, status: 'skipped' })]);
    expect(f.stockKg).toBe(2000 - 100 - 0 - 80);
  });
  it('ticking off today updates what is left now, and the run-out stays consistent', () => {
    const before = run([]);
    const after = run([log({})]);
    expect(after.stockKg).toBe(before.stockKg! - 80);
    expect(after.confirmedTodayKg).toBe(80);
    expect(after.remainingTodayKg).toBe(0);
    expect(after.runOutDate).toBe(before.runOutDate);
  });
  it('once ticking is in use, several unticked days lower confidence and say why', () => {
    const f = forecastFeed({ product, txns, rules: [rule({})], groups, farmLeadTimeDays: null, today: addDays(TODAY, 4), logs: [log({ used_on: '2026-10-04' })] });
    expect(f.unconfirmedDays).toBeGreaterThanOrEqual(3);
    expect(f.reasons.join(' ')).toMatch(/not ticked off/);
    expect(f.confidence).toBe('medium');
  });
});
