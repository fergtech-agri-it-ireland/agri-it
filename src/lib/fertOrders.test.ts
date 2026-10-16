/**
 * Fertiliser orders (14 Oct 2026): order, part delivery, invoice, paid or on account, like feed.
 * Every expected figure is worked out by hand here.
 */
import { describe, expect, it } from 'vitest';
import { applyInvoice, commitments, fertOrderRemainingKg, moneyStates, openFertOrders, planInvoice, uninvoicedFertDeliveries } from './forecast/bills';
import { stockFor } from './forecast/fertiliser';
import { cashPosition } from './forecast/money';
import { derive } from './data/derived';
import type { Cost, Farm, FarmBundle, FertiliserProduct, FertiliserStock } from './types';

const T = '2026-10-14';
const farm = { id: 'f', name: 'Test', county: 'Cork', jurisdiction: 'ROI', financial_year_start_month: 1, opening_cash_eur: 10000, opening_cash_date: '2026-01-01', enterprise: 'dairy', enterprises: ['dairy'] } as unknown as Farm;
const can = { id: 'can', farm_id: 'f', name: 'CAN', supplier_id: 'tir', low_stock_kg: null, archived: false } as unknown as FertiliserProduct;
const row = (o: Partial<FertiliserStock>): FertiliserStock => ({ id: 'x', farm_id: 'f', product_id: 'can', kind: 'delivery', quantity_kg: 0, on_date: '2026-10-01', evidence: 'docket', supplier_id: 'tir', cost_id: null, notes: null, created_at: '2026-10-01T09:00:00Z', ...o });
const cost = (o: Partial<Cost>): Cost => ({ id: 'c', farm_id: 'f', category: 'fertiliser', other_label: null, occurred_on: '2026-10-01', amount_eur: 0, supplier_id: 'tir', supplier_name: 'Tirlán', feed_transaction_id: null, description: null, document_id: null, ...o });
const bundle = (over: Partial<FarmBundle>): FarmBundle => ({
  farm, groups: [], crops: [], suppliers: [{ id: 'tir', name: 'Tirlán' } as FarmBundle['suppliers'][number]], branches: [], supplierSettings: [], products: [],
  txns: [], rules: [], silage: [], benchmarks: [], evidence: [], income: [], costs: [], budget: [], records: [], documents: [], jobs: [], routines: [], completions: [],
  feedLogs: [], headHistory: [], seasons: [], births: [], decisions: [], fields: [], fertilisers: [can], fertStock: [], spreads: [], spreadFields: [], loans: [], loanStatements: [], expected: [], ...over
});

describe('fertiliser orders', () => {
  const order = row({ id: 'o1', kind: 'order', quantity_kg: 4000, order_status: 'open', expected_on: '2026-10-10', price_per_tonne_eur: 400, evidence: 'farmer_estimate' });

  it('an order is on order only: no stock, no bill, no cash', () => {
    const b = bundle({ fertStock: [order] });
    expect(stockFor(b, can, T).stockKg).toBe(0);
    // 4 t at the agreed €400/t
    expect(commitments(b).rows).toEqual([expect.objectContaining({ kind: 'fertiliser', remainingKg: 4000, value: 1600, priceSource: 'order' })]);
    expect(moneyStates(b, T).committedTotal).toBe(1600);
    expect(moneyStates(b, T).owedTotal).toBe(0);
    expect(cashPosition(farm, [], b.costs, T)!.balance).toBe(10000);
  });

  it('half delivered on account: 2 t in stock, 2 t still on order, one bill owed', () => {
    const half = row({ id: 'd1', quantity_kg: 2000, on_date: '2026-10-12', linked_order_id: 'o1', cost_id: 'c1' });
    const b = bundle({ fertStock: [order, half], costs: [cost({ id: 'c1', amount_eur: 800, occurred_on: '2026-10-12', payment_status: 'owed', paid_on: null })] });
    expect(fertOrderRemainingKg(order, b.fertStock)).toBe(2000);
    expect(stockFor(b, can, T).stockKg).toBe(2000);
    expect(moneyStates(b, T).committedTotal).toBe(800);
    expect(moneyStates(b, T).owedTotal).toBe(800);
    expect(cashPosition(farm, [], b.costs, T)!.balance).toBe(10000);
    // The rest was due on the 10th: Today asks about the rest
    const p = derive(b, T).priorities.find((x) => x.id === 'fert-order-o1');
    expect(p).toMatchObject({ title: 'Rest of the CAN order?', when: 'overdue' });
  });

  it('a delivered or cancelled order is not on order and not asked about', () => {
    for (const s of ['delivered', 'cancelled'] as const) {
      const b = bundle({ fertStock: [{ ...order, order_status: s }] });
      expect(openFertOrders(b.fertStock)).toHaveLength(0);
      expect(derive(b, T).priorities.some((x) => x.id === 'fert-order-o1')).toBe(false);
    }
  });

  it('no date given: never asked "did it arrive", never a guessed date', () => {
    const b = bundle({ fertStock: [{ ...order, expected_on: null }] });
    expect(derive(b, T).priorities.some((x) => x.id.startsWith('fert-order-'))).toBe(false);
    expect(commitments(b).rows[0].expected).toBeNull();
  });

  it('the invoice replaces the docket price on both loads; nothing is counted twice', () => {
    const d1 = row({ id: 'd1', quantity_kg: 2000, on_date: '2026-10-05', cost_id: 'c1' });
    const d2 = row({ id: 'd2', quantity_kg: 2000, on_date: '2026-10-12' }); // no price on the docket
    const b = bundle({ fertStock: [d1, d2], costs: [cost({ id: 'c1', amount_eur: 800, occurred_on: '2026-10-05', payment_status: 'owed', paid_on: null })] });
    expect(uninvoicedFertDeliveries(b, 'tir', T).map((r) => r.id)).toEqual(['d1', 'd2']);
    const plan = planInvoice(b, { supplierId: 'tir', supplierName: 'Tirlán', ref: 'F-1', invoiceDate: T, dueOn: '2026-11-14', total: 1650, vat: null, documentId: null, paidOn: null, deliveryIds: ['d1', 'd2'], newIds: { d2: 'c2' } });
    // Split by kg (one load had no price): €825 each
    expect(plan.lines.map((l) => [l.id, l.after, l.newCost, l.kind])).toEqual([['d1', 825, false, 'fertiliser'], ['d2', 825, true, 'fertiliser']]);
    const after = applyInvoice(b, plan);
    expect(after.costs).toHaveLength(2);
    expect(after.costs.reduce((s, c) => s + Number(c.amount_eur), 0)).toBe(1650);
    expect(after.costs.every((c) => c.category === 'fertiliser' && c.invoice_ref === 'F-1' && c.payment_status === 'owed')).toBe(true);
    expect(after.fertStock.find((r) => r.id === 'd2')!.cost_id).toBe('c2');
    expect(uninvoicedFertDeliveries(after, 'tir', T)).toHaveLength(0);
  });

  it('one invoice can cover feed and fertiliser from the same supplier', () => {
    const feedDel = { id: 'fd', farm_id: 'f', feed_product_id: 'nut', txn_type: 'delivery', quantity_kg: 1000, effective_on: '2026-10-08', supplier_id: 'tir', total_price_eur: null, price_per_tonne_eur: null, created_at: '' } as unknown as FarmBundle['txns'][number];
    const b = bundle({ txns: [feedDel], products: [{ id: 'nut', name: 'Nut' } as FarmBundle['products'][number]], fertStock: [row({ id: 'd1', quantity_kg: 1000 })] });
    const plan = planInvoice(b, { supplierId: 'tir', supplierName: 'Tirlán', ref: 'M-1', invoiceDate: T, dueOn: null, total: 900, vat: null, documentId: null, paidOn: T, deliveryIds: ['fd', 'd1'], newIds: { fd: 'k1', d1: 'k2' } });
    const after = applyInvoice(b, plan);
    expect(after.costs.map((c) => [c.category, c.amount_eur, c.feed_transaction_id])).toEqual([['fertiliser', 450, null], ['feed', 450, 'fd']]);
    expect(cashPosition(farm, [], after.costs, T)!.balance).toBe(9100);
  });
});
