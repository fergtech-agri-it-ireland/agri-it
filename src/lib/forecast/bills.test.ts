import { describe, expect, it } from 'vitest';
import { applyInvoice, billState, commitments, markOwed, markPaid, moneyStates, orderRemainingKg, owedBySupplier, paidOn, planInvoice, possibleDuplicateDeliveries, similarCost, similarDelivery, uninvoicedDeliveries } from './bills';
import { cashForecast90, cashPosition, ledgerCsv, yearEndPack } from './money';
import type { Cost, Farm, FarmBundle, FeedTransaction } from '../types';

const TODAY = '2026-10-11';
const txn = (r: Partial<FeedTransaction>): FeedTransaction => ({
  id: 't', farm_id: 'f', feed_product_id: 'p', txn_type: 'delivery', quantity_kg: 8000, order_date: null, delivery_date: null, expected_delivery_date: null,
  effective_on: '2026-10-01', order_status: null, linked_order_id: null, supplier_id: 'tir', total_price_eur: null, price_per_tonne_eur: null,
  evidence: 'confirmed_docket', document_id: null, notes: null, created_at: '2026-10-01T09:00:00Z', ...r
});
const cost = (r: Partial<Cost>): Cost => ({
  id: 'c', farm_id: 'f', category: 'feed', other_label: null, occurred_on: '2026-10-01', amount_eur: 3000, supplier_id: 'tir', supplier_name: 'Tirlán',
  feed_transaction_id: null, description: null, document_id: null, ...r
});
const farm = { id: 'f', name: 'Test', financial_year_start_month: 1, opening_cash_eur: 10000, opening_cash_date: '2026-01-01', enterprise: 'dairy', enterprises: ['dairy'] } as unknown as Farm;
const bundle = (over: Partial<FarmBundle>): FarmBundle => ({
  farm, groups: [], crops: [], suppliers: [{ id: 'tir', name: 'Tirlán' } as FarmBundle['suppliers'][number]], branches: [], supplierSettings: [], products: [{ id: 'p', name: 'Dairy nut' } as FarmBundle['products'][number]],
  txns: [], rules: [], silage: [], benchmarks: [], evidence: [], income: [], costs: [], budget: [], records: [], documents: [], jobs: [], routines: [], completions: [], feedLogs: [], headHistory: [], seasons: [], births: [], decisions: [], fields: [], fertilisers: [], fertStock: [], spreads: [], spreadFields: [], ...over
});

describe('paid, owed and when cash moves', () => {
  it('older records count as paid the day they happened; owed ones have no paid date', () => {
    expect(paidOn(cost({}))).toBe('2026-10-01');
    expect(paidOn(cost({ payment_status: 'owed' }))).toBeNull();
    expect(paidOn(cost({ ...markPaid('2026-10-20') }))).toBe('2026-10-20');
    expect(billState(cost({ ...markOwed(), due_on: '2026-10-05' }), TODAY)).toBe('overdue');
    expect(billState(cost({ ...markOwed(), due_on: '2026-10-30' }), TODAY)).toBe('owed');
  });
  it('cash only goes down when a bill is paid; the forecast takes owed bills off on their due date', () => {
    const owed = cost({ id: 'a', amount_eur: 3000, ...markOwed(), due_on: '2026-11-15' });
    const paid = cost({ id: 'b', amount_eur: 500 });
    expect(cashPosition(farm, [], [owed, paid], TODAY)!.balance).toBe(9500);
    const f = cashForecast90(farm, [], [owed, paid], [], TODAY);
    expect(f.rows.find((r) => r.month === '2026-11')!.owedOut).toBe(3000);
    expect(f.rows.at(-1)!.closing).toBe(6500);
    // Paying it moves the same €3,000 once, on the day paid
    const now = cost({ ...owed, ...markPaid('2026-10-11') });
    expect(cashPosition(farm, [], [now, paid], TODAY)!.balance).toBe(6500);
    expect(cashForecast90(farm, [], [now, paid], [], TODAY).rows.at(-1)!.closing).toBe(6500);
  });
  it('overdue and undated bills come off in the first month, not never', () => {
    const f = cashForecast90(farm, [], [cost({ ...markOwed(), due_on: '2026-09-01', amount_eur: 700 }), cost({ id: 'x', ...markOwed(), amount_eur: 300 })], [], TODAY);
    expect(f.rows[0].owedOut).toBe(1000);
  });
  it('groups owed bills by supplier, overdue first', () => {
    const b = bundle({ costs: [cost({ id: 'a', ...markOwed(), due_on: '2026-10-01' }), cost({ id: 'b', ...markOwed(), supplier_id: null, supplier_name: 'Vet', due_on: '2026-10-20', amount_eur: 100 })] });
    const g = owedBySupplier(b, TODAY);
    expect(g.map((x) => [x.payee, x.total, x.overdue])).toEqual([['Tirlán', 3000, 3000], ['Vet', 100, 0]]);
  });
});

describe('orders and part deliveries', () => {
  const order = txn({ id: 'o', txn_type: 'order', quantity_kg: 1000, order_status: 'open', price_per_tonne_eur: 520, expected_delivery_date: '2026-10-14' });
  it('an order is a commitment until delivered; a part delivery leaves the rest committed', () => {
    expect(commitments(bundle({ txns: [order] })).total).toBe(520);
    const part = txn({ id: 'd1', quantity_kg: 400, linked_order_id: 'o' });
    expect(orderRemainingKg(order, [order, part])).toBe(600);
    expect(commitments(bundle({ txns: [order, part] })).rows[0]).toMatchObject({ remainingKg: 600, value: 312, priceSource: 'order' });
  });
  it('with no agreed price, the last price paid is used and labelled as such', () => {
    const o = { ...order, price_per_tonne_eur: null };
    const last = txn({ id: 'old', feed_product_id: 'p', price_per_tonne_eur: 500, total_price_eur: 4000, effective_on: '2026-09-01' });
    expect(commitments(bundle({ txns: [o, last] })).rows[0]).toMatchObject({ value: 500, priceSource: 'last_paid' });
  });
});

describe('an invoice replaces docket prices instead of adding a second cost', () => {
  const d1 = txn({ id: 'd1', quantity_kg: 8000, effective_on: '2026-09-10', total_price_eur: 3040, price_per_tonne_eur: 380 });
  const d2 = txn({ id: 'd2', quantity_kg: 4000, effective_on: '2026-09-24' });
  const c1 = cost({ id: 'c1', feed_transaction_id: 'd1', amount_eur: 3040, occurred_on: '2026-09-10', ...markOwed() });
  const b = bundle({ txns: [d1, d2], costs: [c1] });
  const inv = { supplierId: 'tir', supplierName: 'Tirlán', ref: 'INV-77', invoiceDate: '2026-09-30', dueOn: '2026-10-31', total: 4600.01, vat: 0, documentId: 'doc', paidOn: null, deliveryIds: ['d1', 'd2'], newIds: { d2: 'c2' } };
  it('splits the total by kg when a delivery had no price, exactly to the cent', () => {
    const plan = planInvoice(b, inv);
    expect(plan.lines.map((l) => [l.delivery.id, l.after, l.newCost])).toEqual([['d1', 3066.67, false], ['d2', 1533.34, true]]);
    expect(plan.lines.reduce((s, l) => s + l.after, 0)).toBeCloseTo(4600.01, 2);
    const after = applyInvoice(b, plan);
    // Two cost rows, not three: the docket cost was updated, the unpriced delivery got one
    expect(after.costs).toHaveLength(2);
    expect(after.costs.reduce((s, c) => s + Number(c.amount_eur), 0)).toBeCloseTo(4600.01, 2);
    expect(after.costs.every((c) => c.invoice_ref === 'INV-77' && c.due_on === '2026-10-31' && c.payment_status === 'owed')).toBe(true);
    expect(after.txns.find((t) => t.id === 'd2')!.price_per_tonne_eur).toBeCloseTo(383.34, 2);
    // Invoiced deliveries aren't offered again
    expect(uninvoicedDeliveries(after, 'tir', '2026-10-05')).toHaveLength(0);
  });
  it('splits by docket cost when every delivery was priced; paid invoices are paid', () => {
    const c2 = cost({ id: 'c2', feed_transaction_id: 'd2', amount_eur: 1520, occurred_on: '2026-09-24' });
    const plan = planInvoice(bundle({ txns: [d1, { ...d2, total_price_eur: 1520 }], costs: [c1, c2] }), { ...inv, total: 4500, paidOn: '2026-10-02' });
    expect(plan.lines.map((l) => l.after)).toEqual([3000, 1500]);
    expect(plan.difference).toBe(-60);
    const after = applyInvoice(bundle({ txns: [d1, d2], costs: [c1, c2] }), plan);
    expect(after.costs.map((c) => paidOn(c))).toEqual(['2026-10-02', '2026-10-02']);
  });
  it('refuses an invoice with no deliveries or no total', () => {
    expect(() => planInvoice(b, { ...inv, deliveryIds: [] })).toThrow();
    expect(() => planInvoice(b, { ...inv, total: 0 })).toThrow();
  });
});

describe('spotting the same thing recorded twice', () => {
  it('a delivery of the same feed and kg within a day, or with the same docket number', () => {
    const b = bundle({ txns: [txn({ id: 'a', notes: 'Docket 4471' })] });
    expect(similarDelivery(b, { productId: 'p', kg: 8000, date: '2026-10-02' })?.id).toBe('a');
    expect(similarDelivery(b, { productId: 'p', kg: 6000, date: '2026-10-09', ref: '4471' })?.id).toBe('a');
    expect(similarDelivery(b, { productId: 'p', kg: 6000, date: '2026-10-09' })).toBeUndefined();
  });
  it('two phones saving the same truck show as a possible duplicate until "two loads came"', () => {
    const a = txn({ id: 'a', created_at: '2026-10-01T09:00:00Z' });
    const c = txn({ id: 'b', created_at: '2026-10-01T09:05:00Z' });
    expect(possibleDuplicateDeliveries(bundle({ txns: [a, c] }), '2026-09-01')).toHaveLength(1);
    expect(possibleDuplicateDeliveries(bundle({ txns: [a, { ...c, notes: '[not a duplicate]' }] }), '2026-09-01')).toHaveLength(0);
  });
  it('a bill with the same amount and payee within a week, or the same invoice number', () => {
    const b = bundle({ costs: [cost({ id: 'x', invoice_ref: 'V-1', amount_eur: 685, supplier_name: 'Vet' })] });
    expect(similarCost(b, { amount: 685, payee: 'vet', date: '2026-10-05' })?.id).toBe('x');
    expect(similarCost(b, { amount: 1, payee: null, date: '2026-12-01', ref: 'v-1' })?.id).toBe('x');
    expect(similarCost(b, { amount: 685, payee: 'ESB', date: '2026-10-05' })).toBeUndefined();
  });
});

describe('year-end: management figures, cash and paperwork reconcile', () => {
  it('running costs, loans and capital, paid out and owed are kept apart, and the transaction list adds up', () => {
    const b = bundle({
      income: [{ id: 'i', farm_id: 'f', income_type: 'milk', occurred_on: '2026-03-14', amount_eur: 20000, counterparty: 'Tirlán', milk_litres: 50000, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: null, document_id: null }],
      costs: [cost({ id: 'a', amount_eur: 3000, occurred_on: '2026-03-01', vat_eur: 405, invoice_ref: 'I1' }), cost({ id: 'b', amount_eur: 1000, ...markOwed(), occurred_on: '2026-10-01' }),
        cost({ id: 'l', category: 'loan_repayment', amount_eur: 5200, occurred_on: '2026-04-01' })]
    });
    const pack = yearEndPack(b, TODAY);
    expect(pack.totalCosts).toBe(4000);
    expect(pack.totalNonOperating).toBe(5200);
    expect(pack.paidOut).toBe(8200);
    expect(pack.owedAtEndTotal).toBe(1000);
    expect(pack.totalVat).toBe(405);
    expect(pack.ledger).toHaveLength(4);
    const csv = ledgerCsv(pack);
    expect(csv).toContain('"Total in","","","","20000.00"');
    expect(csv).toContain('"Total out","","","","9200.00"');
    expect(csv).toContain('"Owed"');
  });
});

describe('money states on one screen', () => {
  it('paid, owed and committed never overlap', () => {
    const order = txn({ id: 'o', txn_type: 'order', quantity_kg: 2000, order_status: 'open', price_per_tonne_eur: 400 });
    const m = moneyStates(bundle({ txns: [order], costs: [cost({ id: 'a', ...markOwed(), due_on: '2026-10-01' }), cost({ id: 'b' })] }), TODAY);
    expect([m.owedTotal, m.overdueTotal, m.committedTotal]).toEqual([3000, 3000, 800]);
  });
});
