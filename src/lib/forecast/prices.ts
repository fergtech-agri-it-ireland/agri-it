/**
 * Supplier price history (spec P1). Every priced delivery the farmer has already recorded
 * becomes a price point, so nothing extra is typed. Prices are only ever what was paid:
 * Agri-It never quotes, predicts or guesses a supplier's price (spec 10).
 */
import type { FarmBundle, FeedTransaction, ISODate } from '../types';
import { addDays } from '../format';

export const PRICE_RULE_VERSION = 'price-history@1.0';
/** A change smaller than this is "about the same" (rounding, small surcharges). */
export const PRICE_CHANGE_PCT = 3;

export interface PricePoint {
  txnId: string;
  date: ISODate;
  productId: string;
  productName: string;
  supplierId: string | null;
  supplierName: string;
  kg: number;
  eurPerT: number;
  totalEur: number;
}

/** €/t from what was entered: the per-tonne price, or total ÷ tonnes. Null when there's no price. */
export function perTonne(t: Pick<FeedTransaction, 'price_per_tonne_eur' | 'total_price_eur' | 'quantity_kg'>): number | null {
  if (t.price_per_tonne_eur !== null && t.price_per_tonne_eur !== undefined && Number(t.price_per_tonne_eur) > 0) return Number(t.price_per_tonne_eur);
  const kg = Number(t.quantity_kg);
  if (t.total_price_eur !== null && t.total_price_eur !== undefined && Number(t.total_price_eur) > 0 && kg > 0) return Number(t.total_price_eur) / (kg / 1000);
  return null;
}

/** Priced deliveries, oldest first. Orders are not prices paid, so they are left out. */
export function pricePoints(b: Pick<FarmBundle, 'txns' | 'products' | 'suppliers'>): PricePoint[] {
  const out: PricePoint[] = [];
  for (const t of b.txns) {
    if (t.txn_type !== 'delivery') continue;
    const p = perTonne(t);
    if (p === null) continue;
    const product = b.products.find((x) => x.id === t.feed_product_id);
    const supplierId = t.supplier_id ?? product?.supplier_id ?? null;
    const kg = Number(t.quantity_kg);
    out.push({
      txnId: t.id, date: t.effective_on, productId: t.feed_product_id, productName: product?.name ?? 'Feed',
      supplierId, supplierName: b.suppliers.find((s) => s.id === supplierId)?.name ?? 'Supplier not recorded',
      kg, eurPerT: p, totalEur: t.total_price_eur !== null ? Number(t.total_price_eur) : (p * kg) / 1000
    });
  }
  return out.sort((a, c) => a.date.localeCompare(c.date) || a.txnId.localeCompare(c.txnId));
}

const pct = (now: number, was: number) => (was > 0 ? ((now - was) / was) * 100 : 0);
const direction = (p: number): 'up' | 'down' | 'same' => (p >= PRICE_CHANGE_PCT ? 'up' : p <= -PRICE_CHANGE_PCT ? 'down' : 'same');

export interface PriceHistory {
  points: PricePoint[]; // oldest first
  latest: PricePoint | null;
  previous: PricePoint | null;
  changePct: number | null; // latest vs previous
  trend: 'up' | 'down' | 'same' | null;
  avg12m: number | null; // tonnage-weighted over the last 365 days
  min: PricePoint | null;
  max: PricePoint | null;
  bySupplier: { supplierId: string | null; supplierName: string; latest: PricePoint; deliveries: number; tonnes: number }[];
}

export function priceHistory(points: PricePoint[], productId: string, today: ISODate): PriceHistory {
  const pts = points.filter((p) => p.productId === productId);
  const latest = pts.at(-1) ?? null;
  const previous = pts.at(-2) ?? null;
  const changePct = latest && previous ? pct(latest.eurPerT, previous.eurPerT) : null;
  const year = pts.filter((p) => p.date > addDays(today, -365) && p.date <= today);
  const kg = year.reduce((s, p) => s + p.kg, 0);
  const avg12m = year.length && kg > 0 ? year.reduce((s, p) => s + p.eurPerT * p.kg, 0) / kg : null;
  const min = pts.reduce<PricePoint | null>((m, p) => (!m || p.eurPerT < m.eurPerT ? p : m), null);
  const max = pts.reduce<PricePoint | null>((m, p) => (!m || p.eurPerT > m.eurPerT ? p : m), null);
  const sup = new Map<string, PriceHistory['bySupplier'][number]>();
  for (const p of pts) {
    const k = p.supplierId ?? p.supplierName;
    const cur = sup.get(k);
    sup.set(k, { supplierId: p.supplierId, supplierName: p.supplierName, latest: p, deliveries: (cur?.deliveries ?? 0) + 1, tonnes: (cur?.tonnes ?? 0) + p.kg / 1000 });
  }
  return {
    points: pts, latest, previous, changePct, trend: changePct === null ? null : direction(changePct), avg12m, min, max,
    bySupplier: [...sup.values()].sort((a, c) => c.latest.date.localeCompare(a.latest.date))
  };
}

export interface PriceCheck {
  against: PricePoint;
  sameSupplier: boolean;
  diffPerT: number;
  changePct: number;
  trend: 'up' | 'down' | 'same';
}

/**
 * Compare a price being entered with the last price paid for the same feed: from the same
 * supplier when there is one, otherwise from anyone. Null when there's nothing to compare.
 */
export function priceCheck(points: PricePoint[], productId: string, supplierId: string | null, eurPerT: number | null, excludeTxnId?: string): PriceCheck | null {
  if (eurPerT === null || !(eurPerT > 0)) return null;
  const pts = points.filter((p) => p.productId === productId && p.txnId !== excludeTxnId);
  const same = supplierId ? pts.filter((p) => p.supplierId === supplierId).at(-1) : undefined;
  const against = same ?? pts.at(-1);
  if (!against) return null;
  const changePct = pct(eurPerT, against.eurPerT);
  return { against, sameSupplier: !!same, diffPerT: eurPerT - against.eurPerT, changePct, trend: direction(changePct) };
}

/** Latest price paid per feed from one supplier (for the supplier screen). */
export function supplierPrices(points: PricePoint[], supplierId: string) {
  const byProduct = new Map<string, { latest: PricePoint; previous: PricePoint | null; deliveries: number }>();
  for (const p of points.filter((x) => x.supplierId === supplierId)) {
    const cur = byProduct.get(p.productId);
    byProduct.set(p.productId, { latest: p, previous: cur?.latest ?? null, deliveries: (cur?.deliveries ?? 0) + 1 });
  }
  return [...byProduct.values()].map((r) => ({ ...r, changePct: r.previous ? pct(r.latest.eurPerT, r.previous.eurPerT) : null }))
    .sort((a, c) => c.latest.date.localeCompare(a.latest.date));
}
