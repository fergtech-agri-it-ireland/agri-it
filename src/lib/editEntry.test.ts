import { describe, expect, it } from 'vitest';
import { billOwner, editFeedTxn, priceFor, scaleSpread } from './editEntry';
import type { Cost, FeedTransaction, FertiliserSpread, FertiliserSpreadField } from './types';

const txn = (o: Partial<FeedTransaction> = {}): FeedTransaction => ({
  id: 't1', farm_id: 'f', feed_product_id: 'p', txn_type: 'delivery', quantity_kg: 8000, order_date: null, delivery_date: '2026-10-01',
  expected_delivery_date: null, effective_on: '2026-10-01', order_status: null, linked_order_id: null, supplier_id: 's1',
  total_price_eur: 2800, price_per_tonne_eur: 350, evidence: 'confirmed_docket', document_id: null, notes: null, created_at: '', ...o
});
const cost = (o: Partial<Cost> = {}): Cost => ({
  id: 'c1', farm_id: 'f', category: 'feed', other_label: null, occurred_on: '2026-10-01', amount_eur: 2800, supplier_id: 's1', supplier_name: 'Tirlán',
  feed_transaction_id: 't1', description: 'Dairy nut 8 t', document_id: null, payment_status: 'paid', paid_on: '2026-10-01', ...o
});
const opts = { canWriteMoney: true, productName: 'Dairy nut', supplierName: 'Tirlán', newCostId: 'new' };
const input = { kg: 8000, date: '2026-10-01', supplierId: 's1', priceMode: 'per_t' as const, price: '350', expectedOn: null, notes: '' };

describe('editing what was saved', () => {
  it('works out the price both ways to the cent', () => {
    expect(priceFor(8000, 'per_t', '350')).toEqual({ total: 2800, perT: 350 });
    expect(priceFor(8000, 'total', '2800')).toEqual({ total: 2800, perT: 350 });
    expect(priceFor(3000, 'total', '1000')).toEqual({ total: 1000, perT: 333.33 });
    expect(priceFor(8000, 'per_t', '')).toEqual({ total: null, perT: null });
  });

  it('a corrected delivery quantity moves its bill with it', () => {
    const r = editFeedTxn(txn(), { ...input, kg: 7500 }, cost(), opts);
    expect(r.txn.quantity_kg).toBe(7500);
    expect(r.txn.total_price_eur).toBe(2625);
    expect(r.cost).toEqual({ action: 'update', id: 'c1', patch: expect.objectContaining({ amount_eur: 2625, occurred_on: '2026-10-01', description: 'Dairy nut 7.5 t' }) });
  });

  it('a paid bill keeps its own paid date unless it was paid the day it came', () => {
    const same = editFeedTxn(txn(), { ...input, date: '2026-10-03' }, cost(), opts);
    expect(same.cost).toMatchObject({ patch: { paid_on: '2026-10-03', occurred_on: '2026-10-03' } });
    const later = editFeedTxn(txn(), { ...input, date: '2026-10-03' }, cost({ paid_on: '2026-10-20' }), opts);
    expect((later.cost as { patch: Record<string, unknown> }).patch).not.toHaveProperty('paid_on');
    expect(editFeedTxn(txn(), { ...input, date: '2026-10-03' }, cost({ payment_status: 'owed', paid_on: null }), opts).cost).toMatchObject({ patch: { occurred_on: '2026-10-03' } });
  });

  it('taking the price off a delivery removes its bill; adding one creates it owed', () => {
    expect(editFeedTxn(txn(), { ...input, price: '' }, cost(), opts).cost).toEqual({ action: 'delete', id: 'c1' });
    const added = editFeedTxn(txn({ total_price_eur: null, price_per_tonne_eur: null }), input, undefined, opts);
    expect(added.cost).toMatchObject({ action: 'insert', row: { id: 'new', amount_eur: 2800, feed_transaction_id: 't1', payment_status: 'owed' } });
  });

  it('a farm worker never changes prices or bills', () => {
    const r = editFeedTxn(txn(), { ...input, kg: 7000, price: '999' }, cost(), { ...opts, canWriteMoney: false });
    expect(r.txn.quantity_kg).toBe(7000);
    expect(r.txn).not.toHaveProperty('total_price_eur');
    expect(r.cost).toBeNull();
  });

  it('a count or adjustment changes the amount and the day only', () => {
    const r = editFeedTxn(txn({ txn_type: 'count' }), { ...input, kg: 1200, date: '2026-10-10' }, undefined, opts);
    expect(r.txn).toEqual({ quantity_kg: 1200, effective_on: '2026-10-10', notes: null });
  });

  it('an order keeps its agreed price per tonne and only dates the stock from a day the supplier gave', () => {
    const o = txn({ txn_type: 'order', order_status: 'open', delivery_date: null, order_date: '2026-10-05' });
    const r = editFeedTxn(o, { ...input, date: '2026-10-06', expectedOn: null, price: '360' }, undefined, opts);
    expect(r.txn).toMatchObject({ order_date: '2026-10-06', expected_delivery_date: null, effective_on: '2026-10-06', price_per_tonne_eur: 360 });
    expect(editFeedTxn(o, { ...input, expectedOn: '2026-10-09' }, undefined, opts).txn.effective_on).toBe('2026-10-09');
  });

  it('scales a spreading and every field in it together', () => {
    const s = { id: 's', total_kg: 1000, kg_per_acre: 50 } as FertiliserSpread;
    const f = [{ id: 'a', spread_id: 's', kg: 600 }, { id: 'b', spread_id: 's', kg: 400 }, { id: 'x', spread_id: 'other', kg: 9 }] as FertiliserSpreadField[];
    const r = scaleSpread(s, f, 500);
    expect(r.spread).toEqual({ total_kg: 500, kg_per_acre: 25 });
    expect(r.fields).toEqual([{ id: 'a', kg: 300 }, { id: 'b', kg: 200 }]);
  });

  it('a bill that belongs to a delivery is edited through the delivery', () => {
    expect(billOwner(cost(), new Set())).toBe('feed_delivery');
    expect(billOwner(cost({ id: 'c2', feed_transaction_id: null }), new Set(['c2']))).toBe('fertiliser_delivery');
    expect(billOwner(cost({ id: 'c3', feed_transaction_id: null }), new Set())).toBeNull();
  });
});
