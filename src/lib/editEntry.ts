import type { Cost, FeedTransaction, FertiliserSpread, FertiliserSpreadField, ISODate } from './types';

/**
 * Editing what was already saved (18 Oct 2026). Pure rules for what else has to change when
 * one record changes, so a corrected delivery never leaves its bill, or a spreading its
 * fields, out of step. The screen (pages/EditEntry.tsx) only collects the new values.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface FeedEditInput {
  kg: number;
  date: ISODate;
  supplierId: string | null;
  /** Deliveries and orders: how the farmer gave the price. Empty price = none. */
  priceMode: 'per_t' | 'total';
  price: string;
  /** Orders only: when the supplier said it would come (optional, never guessed) */
  expectedOn: ISODate | null;
  notes: string;
}

export interface FeedEditResult {
  txn: Partial<FeedTransaction>;
  /** The bill that goes with a delivery */
  cost:
    | { action: 'update'; id: string; patch: Partial<Cost> }
    | { action: 'insert'; row: Partial<Cost> }
    | { action: 'delete'; id: string }
    | null;
}

export function priceFor(kg: number, mode: 'per_t' | 'total', price: string): { total: number | null; perT: number | null } {
  if (price.trim() === '' || !Number.isFinite(Number(price))) return { total: null, perT: null };
  const n = Number(price);
  if (mode === 'total') return { total: round2(n), perT: kg > 0 ? round2(n / (kg / 1000)) : null };
  return { total: round2((n * kg) / 1000), perT: round2(n) };
}

/**
 * Work out the change to a feed record. `cost` is the bill linked to a delivery (if any);
 * `canWriteMoney` is false for a farm worker, who never touches prices or bills.
 */
export function editFeedTxn(
  t: FeedTransaction, input: FeedEditInput, cost: Cost | undefined,
  opts: { canWriteMoney: boolean; productName: string; supplierName: string | null; newCostId: string }
): FeedEditResult {
  const notes = input.notes.trim() || null;
  if (t.txn_type === 'order') {
    const { perT } = priceFor(input.kg, 'per_t', input.priceMode === 'per_t' ? input.price : '');
    return {
      txn: {
        quantity_kg: input.kg, order_date: input.date, expected_delivery_date: input.expectedOn,
        effective_on: input.expectedOn ?? input.date, supplier_id: input.supplierId,
        price_per_tonne_eur: opts.canWriteMoney ? perT : t.price_per_tonne_eur, notes
      },
      cost: null
    };
  }
  if (t.txn_type !== 'delivery') {
    // opening stock, a count or an adjustment: the amount and the day
    return { txn: { quantity_kg: input.kg, effective_on: input.date, notes }, cost: null };
  }
  const base: Partial<FeedTransaction> = { quantity_kg: input.kg, delivery_date: input.date, effective_on: input.date, supplier_id: input.supplierId, notes };
  if (!opts.canWriteMoney) return { txn: base, cost: null };
  const { total, perT } = priceFor(input.kg, input.priceMode, input.price);
  const txn = { ...base, total_price_eur: total, price_per_tonne_eur: perT };
  if (total === null || total <= 0) return { txn, cost: cost ? { action: 'delete', id: cost.id } : null };
  const description = `${opts.productName} ${round2(input.kg / 1000)} t`;
  if (!cost) {
    return {
      txn,
      cost: {
        action: 'insert',
        row: {
          id: opts.newCostId, farm_id: t.farm_id, category: 'feed', occurred_on: input.date, amount_eur: total, supplier_id: input.supplierId,
          supplier_name: opts.supplierName, feed_transaction_id: t.id, description, document_id: t.document_id, payment_status: 'owed', paid_on: null, due_on: null
        }
      }
    };
  }
  // A paid bill's paid date moves with the delivery only if it was the same day
  const paidWithDelivery = cost.payment_status === 'paid' && (cost.paid_on ?? cost.occurred_on) === cost.occurred_on;
  const patch: Partial<Cost> = {
    amount_eur: total, occurred_on: input.date, supplier_id: input.supplierId, supplier_name: opts.supplierName ?? cost.supplier_name,
    ...(cost.description === null || /\d t$/.test(cost.description) ? { description } : {}),
    ...(paidWithDelivery ? { paid_on: input.date } : {})
  };
  return { txn, cost: { action: 'update', id: cost.id, patch } };
}

/** A spreading's total changed: each field's share and the per acre rate scale with it. */
export function scaleSpread(s: FertiliserSpread, fields: FertiliserSpreadField[], newTotalKg: number): {
  spread: Partial<FertiliserSpread>; fields: { id: string; kg: number }[];
} {
  const old = Number(s.total_kg);
  const ratio = old > 0 ? newTotalKg / old : 1;
  const mine = fields.filter((f) => f.spread_id === s.id);
  const share = mine.length ? newTotalKg / mine.length : 0;
  return {
    spread: { total_kg: round2(newTotalKg), kg_per_acre: s.kg_per_acre === null ? null : round2(Number(s.kg_per_acre) * ratio) },
    fields: mine.map((f) => ({ id: f.id, kg: old > 0 ? round2(Number(f.kg) * ratio) : round2(share) }))
  };
}

/** Bills that belong to a delivery are edited through the delivery, so the two never disagree. */
export function billOwner(c: Cost, fertCostIds: Set<string>): 'feed_delivery' | 'fertiliser_delivery' | null {
  if (c.feed_transaction_id) return 'feed_delivery';
  if (fertCostIds.has(c.id)) return 'fertiliser_delivery';
  return null;
}
