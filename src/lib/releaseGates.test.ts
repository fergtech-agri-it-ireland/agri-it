/**
 * Advisory board release gates (14 Oct 2026), run end to end against the in-browser database
 * the phone build uses. Every expected figure here is worked out by hand in the test, from a
 * small reference ledger, never taken from the code under test.
 *
 *   G1 feed correctness: the board's own example, 280 kg a day from two groups
 *   G3 orders to place (review G03): a drafted order is not "on order" until placed
 *   G5 no false authority: no delivery date guessed when no delivery time is known
 *   G7 finance explainability: month-end and export totals reconcile with a reference ledger
 *   G08 supplier directory: every checked contact is rechecked within six months (30 days' grace)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoClient, _testDb, _testReset } from './demo/client';
import { bundleFrom } from './testing/bundle';
import { derive } from './data/derived';
import { moneyStates } from './forecast/bills';
import { cashPosition, ledgerCsv, monthlyFlows, yearEndCsv, yearEndPack } from './forecast/money';
import { addDays, monthKey, todayISO } from './format';
import type { FarmBundle } from './types';
import type { Op } from './offline/outbox';

const client = createDemoClient();
const today = todayISO();
const D = (n: number) => addDays(today, n);
const rpc = async (fn: string, args: Record<string, unknown>) => { const r = await client.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; };
const ins = async (t: string, row: Record<string, unknown>) => { const r = await client.from(t).insert(row); if (r.error) throw new Error(r.error.message); };
const run = async (ops: Op[]) => {
  for (const op of ops) {
    if (op.kind === 'insert') await ins(op.table, op.row);
    else if (op.kind === 'update') await client.from(op.table).update(op.patch).match(op.match);
    else throw new Error(`not used here: ${op.kind}`);
  }
};
const TIRLAN = '10000000-0000-0000-0000-000000000001';
const ids = { cows: crypto.randomUUID(), heif: crypto.randomUUID(), nut: crypto.randomUUID() };
let farm = '';
let b: () => FarmBundle;

beforeEach(async () => {
  _testReset(true);
  farm = String(await rpc('create_farm', { p_name: 'Gate farm', p_county: 'Cork', p_enterprises: ['dairy'] }));
  await client.from('farms').update({ opening_cash_eur: 50000, opening_cash_date: D(-60) }).eq('id', farm);
  await ins('animal_groups', { id: ids.cows, farm_id: farm, name: 'Dairy cows', animal_class: 'dairy_cow', head_count: 120 });
  await ins('animal_groups', { id: ids.heif, farm_id: farm, name: 'Heifers', animal_class: 'heifer', head_count: 40 });
  await ins('feed_products', { id: ids.nut, farm_id: farm, name: 'Dairy nut', supplier_id: TIRLAN, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: 3 });
  await ins('feeding_rules', { farm_id: farm, feed_product_id: ids.nut, animal_group_id: ids.cows, kg_per_head_per_feed: 1, feeds_per_day: 2, start_date: D(-30) });
  await ins('feeding_rules', { farm_id: farm, feed_product_id: ids.nut, animal_group_id: ids.heif, kg_per_head_per_feed: 1, feeds_per_day: 1, start_date: D(-30) });
  b = () => bundleFrom(_testDb(), farm);
});
const nut = () => derive(b(), today).feed.get(ids.nut)!;

describe('Gate G1: the board\'s feed example, checked by hand', () => {
  it('8,000 kg, 120 cows x 1 kg x 2 plus 40 heifers x 1 kg x 1: 280 kg a day, run-out, reorder and order-by', async () => {
    await rpc('record_feed_delivery', { p_id: 'g1', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 8000, p_delivery_date: today, p_supplier_id: TIRLAN });
    const daily = 120 * 1 * 2 + 40 * 1 * 1; // 280
    const days = 8000 / daily; // 28.57
    const reorderDays = (8000 - 3 * daily) / daily; // 7,160 kg to the 840 kg safety stock: 25.57
    const f = nut();
    expect(f.dailyUseKg).toBe(280);
    expect(f.stockKg).toBe(8000);
    expect(f.daysRemaining).toBeCloseTo(days, 2);
    expect(f.runOutDate).toBe(D(Math.floor(days))); // day 28
    expect(f.reorderDate).toBe(D(Math.floor(reorderDays))); // day 25
    expect(f.orderByDate).toBe(D(Math.floor(reorderDays) - 3)); // day 22, with a 3-day delivery time
  });
});

describe('Gate G3 and review G03: an order Agri-It drafts is an order to place', () => {
  it('is not on order, not committed money and not "did it arrive?" until the farmer places it', async () => {
    // Little stock left, so Agri-It drafts an order from the last delivery
    await rpc('record_feed_delivery', { p_id: 'last', p_farm_id: farm, p_feed_product_id: ids.nut, p_quantity_kg: 8000, p_delivery_date: D(-26), p_supplier_id: TIRLAN, p_price_per_tonne_eur: 400 });
    const s = derive(b(), today).suggestions.find((x) => x.key.startsWith(`order:${ids.nut}`))!;
    expect(s.approve!.label).toBe('Add to orders to place');
    await run(s.approve!.ops);
    const order = b().txns.find((t) => t.txn_type === 'order')!;
    expect(order.placed).toBe(false);
    let d = derive(b(), today);
    expect(d.feed.get(ids.nut)!.openOrders).toHaveLength(0);
    expect(d.feed.get(ids.nut)!.ordersToPlace).toEqual([{ id: order.id, kg: 8000 }]);
    expect(d.feed.get(ids.nut)!.runOutWithOpenOrders).toBeNull();
    expect(moneyStates(b(), today).committedTotal).toBe(0);
    expect(d.priorities.find((p) => p.id === `place-${order.id}`)?.detail).toMatch(/Not placed yet: Agri-It doesn't send orders/);
    // The drafted order doesn't draft a second one
    expect(d.suggestions.some((x) => x.key.startsWith(`order:${ids.nut}`))).toBe(false);
    // Placed: now it is coming, and counts as committed at the last price paid
    await client.from('feed_transactions').update({ placed: true, placed_on: today, expected_delivery_date: D(3), effective_on: D(3) }).eq('id', order.id);
    d = derive(b(), today);
    expect(d.feed.get(ids.nut)!.openOrders[0].kg).toBe(8000);
    expect(d.feed.get(ids.nut)!.runOutWithOpenOrders).not.toBeNull();
    expect(moneyStates(b(), today).committedTotal).toBe(3200);
    expect(d.priorities.some((p) => p.id === `place-${order.id}`)).toBe(false);
  });

  it('older orders, saved before orders to place existed, still count as placed', async () => {
    await ins('feed_transactions', { id: 'old', farm_id: farm, feed_product_id: ids.nut, txn_type: 'order', quantity_kg: 2000, order_date: D(-1), expected_delivery_date: D(2), effective_on: D(2), order_status: 'open', supplier_id: TIRLAN, evidence: 'unconfirmed' });
    delete (_testDb().feed_transactions.find((t) => t.id === 'old') as Record<string, unknown>).placed;
    expect(nut().openOrders.map((o) => o.id)).toEqual(['old']);
  });
});

describe('Gate G7: month-end and export totals reconcile with a reference ledger', () => {
  it('cash, monthly flows, the summary and the transaction list all agree with hand-worked sums', async () => {
    // The reference ledger, all in this financial year and on or before today
    const day = (n: number) => { const x = D(-n); return x < `${today.slice(0, 4)}-01-01` ? `${today.slice(0, 4)}-01-01` : x; };
    const rows = {
      income: [
        { on: day(40), amount: 21000.5, type: 'milk' }, { on: day(10), amount: 19500, type: 'milk' }, { on: day(20), amount: 3400, type: 'livestock' }
      ],
      paid: [
        { on: day(35), amount: 1250.25, category: 'fertiliser' }, { on: day(15), amount: 640, category: 'vet_medicine' }, { on: day(5), amount: 9000, category: 'capital' }
      ],
      owed: [{ on: day(3), amount: 2210, category: 'contractor', due: D(20) }]
    };
    for (const i of rows.income) await ins('income', { farm_id: farm, income_type: i.type, occurred_on: i.on, amount_eur: i.amount });
    for (const c of rows.paid) await ins('costs', { farm_id: farm, category: c.category, occurred_on: c.on, amount_eur: c.amount, supplier_name: 'Ref' });
    for (const c of rows.owed) await ins('costs', { farm_id: farm, category: c.category, occurred_on: c.on, amount_eur: c.amount, supplier_name: 'Ref', payment_status: 'owed', due_on: c.due });

    const totalIn = 21000.5 + 19500 + 3400; // 43,900.50
    const paidOut = 1250.25 + 640 + 9000; // 10,890.25
    const running = 1250.25 + 640 + 2210; // capital is not a running cost: 4,100.25
    const pack = yearEndPack(b(), today);
    expect(pack.totalIncome).toBeCloseTo(totalIn, 2);
    expect(pack.totalCosts).toBeCloseTo(running, 2);
    expect(pack.totalNonOperating).toBeCloseTo(9000, 2);
    expect(pack.owedAtEndTotal).toBeCloseTo(2210, 2);
    // Cash moves only for what was paid; the owed bill is not cash yet
    expect(cashPosition(b().farm, b().income, b().costs, today)!.balance).toBeCloseTo(50000 + totalIn - paidOut, 2);
    // Monthly flows add up to the same cash movement
    const months = [...new Set([...rows.income.map((r) => r.on), ...rows.paid.map((r) => r.on)].map(monthKey))].sort();
    const flows = monthlyFlows(b().income, b().costs, months);
    expect(flows.reduce((t, f) => t + f.inflow, 0)).toBeCloseTo(totalIn, 2);
    expect(flows.reduce((t, f) => t + f.outflow, 0)).toBeCloseTo(paidOut, 2);
    // The transaction list in the export, read back as a spreadsheet would
    const csv = ledgerCsv(pack).split('\n').map((l) => l.split('","').map((c) => c.replace(/^"|"$/g, '')));
    const body = csv.slice(1).filter((r) => r[0] && /^\d{4}-/.test(r[0]));
    const sum = (k: string) => body.filter((r) => r[1] === k).reduce((t, r) => t + Number(r[5]), 0);
    expect(body).toHaveLength(7);
    expect(sum('In')).toBeCloseTo(totalIn, 2);
    expect(sum('Out')).toBeCloseTo(paidOut + 2210, 2);
    expect(body.filter((r) => r[10] === 'Owed').map((r) => Number(r[5]))).toEqual([2210]);
    // The summary sheet says it is a management summary, and which currency
    const summary = yearEndCsv(pack, 'Gate farm');
    expect(summary).toContain('not statutory accounts or a tax computation');
    expect(summary).toContain('"Currency","EUR"');
  });
});

describe('Gate G5: no delivery date is ever guessed', () => {
  it('ticking a repeat feed order with no delivery time known leaves the expected date blank', async () => {
    await client.from('feed_products').update({ lead_time_days: null }).eq('id', ids.nut);
    const { completeRoutine } = await import('./routineActions');
    const item = { kind: 'order', date: today, routine: { id: 'r1', kind: 'order', feed_product_id: ids.nut, supplier_id: null, title: 'Nut order' }, key: 'r1', title: 'Nut order', unit: 'kg', planned: 4000 } as never;
    const order = completeRoutine(item, b(), 4000).ops.find((o) => o.kind === 'insert' && o.table === 'feed_transactions') as { row: Record<string, unknown> };
    expect(order.row.expected_delivery_date).toBeNull();
    expect(order.row.effective_on).toBe(today);
  });
});

describe('Gate G5 / review G06: statutory deadlines are jurisdictional, dated and source backed', () => {
  it('every rule names its official source, the day it was checked, and is not past its recheck', async () => {
    const { STATUTORY_RULES, ruleFor } = await import('./deadlines');
    const official = /^https:\/\/(www\.)?(irishstatutebook\.ie|gov\.ie|daera-ni\.gov\.uk)\//;
    for (const r of STATUTORY_RULES) {
      expect(r.source.url, `${r.jurisdiction} ${r.id}`).toMatch(official);
      expect(r.checkedOn <= today).toBe(true);
      // The build fails 30 days after a rule's recheck date, so it can never quietly go stale.
      // To fix: check the source, then update checkedOn and reviewBy (or add a new version) in lib/deadlines.ts.
      expect(addDays(r.reviewBy, 30) >= today, `${r.jurisdiction} ${r.id} is overdue a recheck (review by ${r.reviewBy})`).toBe(true);
    }
    for (const j of ['ROI', 'NI'] as const) for (const herd of ['dairy', 'other'] as const) {
      expect(ruleFor('calf_tag', j, herd, today)).not.toBeNull();
      expect(ruleFor('calf_register', j, herd, today)).not.toBeNull();
    }
    expect(ruleFor('calf_tag', 'NI', 'dairy', today)!.hours).toBe(36);
    expect(ruleFor('calf_tag', 'NI', 'other', today)!.days).toBe(20);
    expect(ruleFor('calf_tag', 'ROI', 'dairy', today)!.officialSystem).toMatch(/AgFood/);
  });

  it('a rule that changes keeps the old rule for births before the change', async () => {
    const { STATUTORY_RULES, ruleFor } = await import('./deadlines');
    const old = ruleFor('calf_register', 'ROI', 'dairy', today)!;
    STATUTORY_RULES.push({ ...old, version: 2, days: 20, effectiveFrom: D(10) });
    try {
      expect(ruleFor('calf_register', 'ROI', 'dairy', D(9))!.days).toBe(27);
      expect(ruleFor('calf_register', 'ROI', 'dairy', D(10))!.days).toBe(20);
    } finally {
      STATUTORY_RULES.pop();
    }
  });
});

describe('G08 supplier directory upkeep', () => {
  it('no directory supplier or branch is more than 30 days past its recheck date', async () => {
    const { buildReference } = await import('./demo/seed');
    const { recheckBy, RECHECK_GRACE_DAYS } = await import('./suppliers');
    const ref = buildReference();
    const rows = [
      ...ref.suppliers.map((s) => ({ what: `supplier ${s.name}`, on: (s.verified_on as string | null) ?? null })),
      ...ref.supplier_branches.map((x) => ({ what: `branch ${x.name}`, on: (x.verified_on as string | null) ?? null }))
    ];
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      const by = recheckBy(r.on);
      if (!by) continue; // never verified: shown as not verified, with no number to go stale
      // To fix: check the number on the supplier's own contact page, then update verified_on in
      // a new migration, seed.sql and buildReference() (src/lib/demo/seed.ts).
      expect(addDays(by, RECHECK_GRACE_DAYS) >= today, `${r.what} is overdue a recheck (recheck by ${by})`).toBe(true);
    }
  });
});
