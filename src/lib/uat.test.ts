/**
 * The review's UAT checklist (UAT-01 to UAT-10), run end to end against the in-browser
 * database the phone build uses (the same behaviour as the SQL functions), the forecast
 * engines and the screens' derived data. UAT-06 and UAT-07 (offline and two phones) are
 * in offline/outbox.test.ts; the SQL side is in scripts/e2e/db_review.sql.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoClient, _testDb, _testReset } from './demo/client';
import { bundleFrom } from './testing/bundle';
import { derive } from './data/derived';
import { applyInvoice, moneyStates, paidOn, planInvoice } from './forecast/bills';
import { cashPosition, ledgerCsv, yearEndPack } from './forecast/money';
import { countVariances, forecastFeed } from './forecast/feed';
import { buildChecklist } from './routines';
import { addDays, todayISO } from './format';
import type { FarmBundle } from './types';

const client = createDemoClient();
const today = todayISO();
const D = (n: number) => addDays(today, n);
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const r = await client.rpc(fn, args);
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const ins = async (t: string, row: Record<string, unknown>) => { const r = await client.from(t).insert(row); if (r.error) throw new Error(r.error.message); };
const upd = async (t: string, id: string, patch: Record<string, unknown>) => { await client.from(t).update(patch).eq('id', id); };

let farm = '';
let b: () => FarmBundle;
const ids = { cows: crypto.randomUUID(), heif: crypto.randomUUID(), nut: crypto.randomUUID(), ruleCows: crypto.randomUUID(), ruleHeif: crypto.randomUUID() };
const TIRLAN = '10000000-0000-0000-0000-000000000001';

beforeEach(async () => {
  // UAT-10 setting: a fresh farm on reference data only (what the phone build starts from)
  _testReset(true);
  farm = String(await rpc('create_farm', { p_name: 'Hillside', p_county: 'Tipperary', p_enterprises: ['dairy'] }));
  await upd('farms', farm, { opening_cash_eur: 20000, opening_cash_date: D(-30), default_lead_time_days: 3 });
  await ins('animal_groups', { id: ids.cows, farm_id: farm, name: 'Dairy cows', animal_class: 'dairy_cow', head_count: 100 });
  await ins('animal_groups', { id: ids.heif, farm_id: farm, name: 'Heifers', animal_class: 'heifer', head_count: 40 });
  await ins('feed_products', { id: ids.nut, farm_id: farm, name: 'Dairy nut', supplier_id: TIRLAN, safety_stock_mode: 'days', safety_stock_value: 3 });
  await ins('feed_transactions', { farm_id: farm, feed_product_id: ids.nut, txn_type: 'count', quantity_kg: 6000, effective_on: D(-10), evidence: 'measured' });
  await ins('feeding_rules', { id: ids.ruleCows, farm_id: farm, feed_product_id: ids.nut, animal_group_id: ids.cows, kg_per_head_per_feed: 1, feeds_per_day: 2, start_date: D(-30) });
  await ins('feeding_rules', { id: ids.ruleHeif, farm_id: farm, feed_product_id: ids.nut, animal_group_id: ids.heif, kg_per_head_per_feed: 1, feeds_per_day: 1, start_date: D(-30) });
  b = () => bundleFrom(_testDb(), farm);
});

const nut = () => derive(b(), today).feed.get(ids.nut)!;

describe('UAT-01: receive feed', () => {
  it('stock, forecast, supplier history and money all change once; on account means no cash yet', async () => {
    const before = nut();
    expect(before.dailyUseKg).toBe(240);
    expect(before.stockKg).toBe(6000 - 10 * 240);
    const cashBefore = cashPosition(b().farm, b().income, b().costs, today)!.balance;
    await rpc('record_feed_delivery', { p_id: 'd1', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 8000, p_delivery_date: today, p_supplier_id: TIRLAN, p_price_per_tonne_eur: 390, p_payment: 'account', p_due_on: D(30) });
    // A retry (lost reply, second tap) changes nothing
    await rpc('record_feed_delivery', { p_id: 'd1', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 8000, p_delivery_date: today, p_supplier_id: TIRLAN, p_price_per_tonne_eur: 390, p_payment: 'account' });
    const after = nut();
    expect(after.stockKg).toBe(before.stockKg! + 8000);
    expect(after.runOutDate! > before.runOutDate!).toBe(true);
    const costs = b().costs.filter((c) => c.feed_transaction_id === 'd1');
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ amount_eur: 3120, payment_status: 'owed', due_on: D(30) });
    expect(cashPosition(b().farm, b().income, b().costs, today)!.balance).toBe(cashBefore);
    expect(b().supplierSettings.find((s) => s.supplier_id === TIRLAN)?.last_used_at).toBeTruthy();
    // Paid now instead: cash moves today
    await rpc('record_feed_delivery', { p_id: 'd2', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 1000, p_delivery_date: today, p_supplier_id: TIRLAN, p_total_price_eur: 400, p_payment: 'paid' });
    expect(cashPosition(b().farm, b().income, b().costs, today)!.balance).toBe(cashBefore - 400);
  });
});

describe('UAT-02: group numbers with dates', () => {
  it('a change from a past date keeps ticked-off actuals and uses the old count before it', async () => {
    await ins('feed_use_logs', { farm_id: farm, feeding_rule_id: ids.ruleCows, feed_product_id: ids.nut, animal_group_id: ids.cows, used_on: D(-8), planned_kg: 200, actual_kg: 180, status: 'changed' });
    const before = nut().stockKg!;
    await rpc('set_head_count', { p_group_id: ids.cows, p_head_count: 80, p_effective_on: D(-5) });
    const after = nut();
    // Days -5..-1 now use 80 cows (160 kg/day instead of 200): 5 × 40 kg less used
    expect(after.stockKg).toBe(before + 5 * 40);
    expect(after.dailyUseKg).toBe(200);
    expect(b().feedLogs[0].actual_kg).toBe(180); // the actual stays as ticked
    expect(b().groups.find((g) => g.id === ids.cows)!.head_count).toBe(80);
  });
  it('moving animals between groups changes both from the day, and only from then', async () => {
    await rpc('move_animals', { p_id: 'm1', p_farm_id: farm, p_from: ids.cows, p_to: ids.heif, p_count: 10, p_effective_on: D(3) });
    const f = nut();
    expect(f.dailyUseKg).toBe(240); // not yet
    expect(f.upcomingChanges[0]).toMatchObject({ date: D(3), dailyUseKg: 90 * 2 + 50 });
    expect(b().groups.find((g) => g.id === ids.cows)!.head_count).toBe(100); // today's count
    await expect(rpc('move_animals', { p_id: 'm2', p_farm_id: farm, p_from: ids.cows, p_to: ids.heif, p_count: 500 })).rejects.toThrow(/only has/);
  });
});

describe('UAT-03: a temporary plan ends and normal feeding returns', () => {
  it('the higher rate applies for its window only', async () => {
    await ins('feeding_rules', { farm_id: farm, feed_product_id: ids.nut, animal_group_id: ids.cows, kg_per_head_per_feed: 2, feeds_per_day: 2, start_date: D(2), end_date: D(5), is_temporary: true, label: 'Short of grass' });
    const f = nut();
    expect(f.upcomingChanges.map((c) => [c.date, c.dailyUseKg])).toEqual([[D(2), 440], [D(6), 240]]);
  });
});

describe('UAT-04: a physical count shows the variance and never changes your rate', () => {
  it('counted less than predicted', async () => {
    await ins('feed_transactions', { farm_id: farm, feed_product_id: ids.nut, txn_type: 'count', quantity_kg: 3400, effective_on: today, evidence: 'measured' });
    const v = countVariances(b().txns, b().rules, b().groups, b().feedLogs, b().headHistory).at(-1)!;
    expect(v).toMatchObject({ predictedKg: 3600, countedKg: 3400, varianceKg: -200 });
    expect(b().rules.find((r) => r.id === ids.ruleCows)!.kg_per_head_per_feed).toBe(1);
  });
});

describe('UAT-05: order, part delivery, invoice, payment: no duplicate costs', () => {
  it('runs the whole lifecycle with one cost per delivery and cash moving once', async () => {
    const cash0 = cashPosition(b().farm, b().income, b().costs, today)!.balance;
    await ins('feed_transactions', { id: 'o1', farm_id: farm, feed_product_id: ids.nut, txn_type: 'order', quantity_kg: 10000, order_date: D(-3), expected_delivery_date: D(-1), effective_on: D(-1), order_status: 'open', supplier_id: TIRLAN, price_per_tonne_eur: 380, total_price_eur: 3800, evidence: 'unconfirmed' });
    expect(moneyStates(b(), today).committedTotal).toBe(3800);
    expect(nut().openOrders[0].kg).toBe(10000);
    // 6 t came, 4 t to follow
    await rpc('record_feed_delivery', { p_id: 'p1', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 6000, p_delivery_date: D(-1), p_supplier_id: TIRLAN, p_price_per_tonne_eur: 380, p_linked_order_id: 'o1', p_payment: 'account', p_close_order: false });
    expect(b().txns.find((t) => t.id === 'o1')!.order_status).toBe('open');
    expect(nut().openOrders[0].kg).toBe(4000);
    expect(moneyStates(b(), today).committedTotal).toBe(1520);
    // The rest, no price on the docket
    await rpc('record_feed_delivery', { p_id: 'p2', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 4000, p_delivery_date: today, p_supplier_id: TIRLAN, p_linked_order_id: 'o1', p_payment: 'account', p_close_order: false });
    expect(b().txns.find((t) => t.id === 'o1')!.order_status).toBe('delivered');
    expect(moneyStates(b(), today).committedTotal).toBe(0);
    expect(b().costs.filter((c) => c.category === 'feed')).toHaveLength(1);
    // The invoice covers both: €3,950 incl. VAT
    const plan = planInvoice(b(), { supplierId: TIRLAN, supplierName: 'Tirlán FarmLife', ref: 'T-9001', invoiceDate: today, dueOn: D(25), total: 3950, vat: 0, documentId: null, paidOn: null, deliveryIds: ['p1', 'p2'], newIds: { p2: 'cost-p2' } });
    for (const op of plan.ops) {
      if (op.kind === 'insert') await ins(op.table, op.row!);
      else await client.from(op.table).update(op.patch!).match(op.match!);
    }
    const feedCosts = b().costs.filter((c) => c.category === 'feed');
    expect(feedCosts).toHaveLength(2); // one per delivery, never a third for the invoice
    expect(feedCosts.reduce((s, c) => s + Number(c.amount_eur), 0)).toBeCloseTo(3950, 2);
    expect(feedCosts.every((c) => c.invoice_ref === 'T-9001' && paidOn(c) === null)).toBe(true);
    expect(cashPosition(b().farm, b().income, b().costs, today)!.balance).toBe(cash0);
    // Pay the statement
    for (const c of feedCosts) await upd('costs', c.id, { payment_status: 'paid', paid_on: today });
    expect(cashPosition(b().farm, b().income, b().costs, today)!.balance).toBeCloseTo(cash0 - 3950, 2);
    expect(moneyStates(b(), today).owedTotal).toBe(0);
    // And the year-end pack counts €3,950 of feed once
    const pack = yearEndPack(b(), today);
    expect(pack.costsByCategory.find((c) => c.key === 'feed')!.total).toBeCloseTo(3950, 2);
    // Undoing the part delivery reopens the order for what is still to come
    await rpc('undo_feed_delivery', { p_id: 'p2' });
    expect(b().txns.find((t) => t.id === 'o1')!.order_status).toBe('open');
    void applyInvoice;
  });
});

describe('UAT-08: a bill left overdue for a week stays actionable', () => {
  it('stays on Today as overdue until paid, then goes', async () => {
    await ins('costs', { id: 'vet', farm_id: farm, category: 'vet_medicine', occurred_on: D(-20), amount_eur: 685, supplier_name: 'Local vet', payment_status: 'owed', due_on: D(-7) });
    for (const day of [today, D(7), D(30)]) {
      const p = derive(b(), day).priorities.find((x) => x.id === 'bills-overdue');
      expect(p, `still there on ${day}`).toBeTruthy();
      expect(p!.when).toBe('overdue');
      expect(p!.dismissable).toBeFalsy();
    }
    await upd('costs', 'vet', { payment_status: 'paid', paid_on: today });
    expect(derive(b(), today).priorities.find((x) => x.id === 'bills-overdue')).toBeUndefined();
  });
  it('a missed routine stays until ticked, moved or skipped', async () => {
    await ins('routines', { id: 'rt', farm_id: farm, kind: 'job', title: 'Check troughs', frequency: 'weekly', weekday: new Date(D(-14) + 'T00:00:00Z').getUTCDay(), start_date: D(-14), created_at: `${D(-14)}T06:00:00Z` });
    const missed = (day: string) => buildChecklist(b(), day).filter((i) => i.routine?.id === 'rt' && i.status === 'pending' && i.date < day);
    expect(missed(today)).toHaveLength(1);
    expect(missed(today)[0].missedDates).toHaveLength(1); // two weeks, gathered into one line
    expect(derive(b(), today).priorities.find((x) => x.id === 'routines-missed')?.when).toBe('overdue');
    expect(missed(D(21))).toHaveLength(1); // three weeks later: still there
  });
});

describe('UAT-09: year-end records reconcile', () => {
  it('the transaction list adds up to the summary', async () => {
    await ins('income', { farm_id: farm, income_type: 'milk', occurred_on: D(-5), amount_eur: 25000, milk_litres: 60000 });
    await ins('costs', { farm_id: farm, category: 'contractor', occurred_on: D(-6), amount_eur: 1200, supplier_name: 'Contractor', invoice_ref: 'C-1', vat_eur: 162 });
    await ins('costs', { farm_id: farm, category: 'capital', occurred_on: D(-4), amount_eur: 9000, supplier_name: 'Dealer' });
    const pack = yearEndPack(b(), today);
    const ledgerOut = pack.ledger.filter((r) => r.kind === 'cost').reduce((s, r) => s + r.amount, 0);
    expect(ledgerOut).toBe(pack.totalCosts + pack.totalNonOperating);
    expect(pack.ledger.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0)).toBe(pack.totalIncome);
    expect(ledgerCsv(pack)).toContain('"C-1"');
    expect(pack.totalNonOperating).toBe(9000);
  });
});

describe('UAT-10: a fresh farm, first useful action, no demo data', () => {
  it('has only its own records and a working forecast after one delivery', async () => {
    const own = b();
    expect(own.costs).toHaveLength(0);
    expect(own.income).toHaveLength(0);
    expect(own.suppliers.length).toBeGreaterThan(0); // the reference directory
    await rpc('record_feed_delivery', { p_id: 'first', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 4000, p_delivery_date: today, p_supplier_id: TIRLAN });
    const f = nut();
    expect(f.status).not.toBe('no_stock_record');
    expect(f.orderByDate).not.toBeNull(); // the farmer gave a lead time at setup
    expect(f.confidence).toBe('high');
    expect(forecastFeed).toBeTypeOf('function');
  });
});
