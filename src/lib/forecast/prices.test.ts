import { describe, expect, it } from 'vitest';
import { perTonne, priceCheck, priceHistory, pricePoints, supplierPrices } from './prices';
import type { FeedProduct, FeedTransaction, Supplier } from '../types';

const txn = (p: Partial<FeedTransaction>): FeedTransaction => ({
  id: Math.random().toString(36).slice(2), farm_id: 'f', feed_product_id: 'nut', txn_type: 'delivery', quantity_kg: 8000,
  order_date: null, delivery_date: null, expected_delivery_date: null, effective_on: '2026-09-01', order_status: null,
  linked_order_id: null, supplier_id: 'tir', total_price_eur: null, price_per_tonne_eur: null, evidence: 'confirmed_docket',
  document_id: null, notes: null, created_at: '2026-09-01T00:00:00Z', ...p
});
const products = [{ id: 'nut', name: 'Dairy nut', supplier_id: 'tir' }, { id: 'calf', name: 'Calf ration', supplier_id: 'tir' }] as FeedProduct[];
const suppliers = [{ id: 'tir', name: 'Tirlán' }, { id: 'dg', name: 'Dairygold' }] as Supplier[];

const txns = [
  txn({ id: 'a', effective_on: '2026-04-01', price_per_tonne_eur: 370 }),
  txn({ id: 'b', effective_on: '2026-05-01', total_price_eur: 3000, quantity_kg: 8000 }), // 375/t from the total
  txn({ id: 'c', effective_on: '2026-06-01', price_per_tonne_eur: 360, supplier_id: 'dg', quantity_kg: 4000 }),
  txn({ id: 'd', effective_on: '2026-09-01', price_per_tonne_eur: 390 }),
  txn({ id: 'e', effective_on: '2026-09-10', txn_type: 'order', price_per_tonne_eur: 999 }), // an order is not a price paid
  txn({ id: 'f', effective_on: '2026-09-12' }), // unpriced delivery
  txn({ id: 'g', effective_on: '2026-08-01', feed_product_id: 'calf', price_per_tonne_eur: 520 })
];

describe('price history', () => {
  const pts = pricePoints({ txns, products, suppliers });

  it('uses per-tonne price, or total ÷ tonnes, and skips orders and unpriced deliveries', () => {
    expect(perTonne({ price_per_tonne_eur: null, total_price_eur: 3000, quantity_kg: 8000 })).toBe(375);
    expect(perTonne({ price_per_tonne_eur: null, total_price_eur: null, quantity_kg: 8000 })).toBeNull();
    expect(pts.map((p) => p.txnId)).toEqual(['a', 'b', 'c', 'g', 'd']);
  });

  it('latest vs previous, tonnage-weighted 12-month average, lowest and highest', () => {
    const h = priceHistory(pts, 'nut', '2026-09-15');
    expect(h.latest?.eurPerT).toBe(390);
    expect(h.previous?.eurPerT).toBe(360);
    expect(h.changePct).toBeCloseTo(8.33, 1);
    expect(h.trend).toBe('up');
    // (370×8 + 375×8 + 360×4 + 390×8) / 28
    expect(h.avg12m).toBeCloseTo((370 * 8 + 375 * 8 + 360 * 4 + 390 * 8) / 28, 5);
    expect(h.min?.eurPerT).toBe(360);
    expect(h.max?.eurPerT).toBe(390);
    expect(h.bySupplier.map((s) => [s.supplierName, s.latest.eurPerT, s.deliveries])).toEqual([['Tirlán', 390, 3], ['Dairygold', 360, 1]]);
  });

  it('checks a new price against the same supplier first', () => {
    const same = priceCheck(pts, 'nut', 'dg', 370);
    expect(same?.sameSupplier).toBe(true);
    expect(same?.against.eurPerT).toBe(360);
    expect(same?.diffPerT).toBe(10);
    const other = priceCheck(pts, 'nut', 'someone-new', 392);
    expect(other?.sameSupplier).toBe(false);
    expect(other?.against.eurPerT).toBe(390);
    expect(other?.trend).toBe('same'); // under 3% is "about the same"
    expect(priceCheck(pts, 'nut', 'tir', null)).toBeNull();
    expect(priceCheck([], 'nut', 'tir', 380)).toBeNull();
  });

  it('per-supplier view lists each feed with its last change', () => {
    const r = supplierPrices(pts, 'tir');
    expect(r.map((x) => [x.latest.productName, x.latest.eurPerT])).toEqual([['Dairy nut', 390], ['Calf ration', 520]]);
    expect(r[0].changePct).toBeCloseTo(4, 5); // 375 → 390
    expect(r[1].changePct).toBeNull();
  });
});
