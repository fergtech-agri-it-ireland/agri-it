/**
 * Bills: the order, delivery, invoice and payment lifecycle (review gap P0).
 *
 * One purchase moves through four events and each one changes something different:
 *
 *   order placed     a commitment: expected kg and value. No stock, no cost, no cash.
 *   goods delivered  stock goes up. A cost is recognised (on the delivery date) if a price
 *                    is known, either paid now or owed "on account". No cash unless paid now.
 *   invoice arrives  the invoice REPLACES the docket price on the deliveries it covers:
 *                    the same cost rows are updated, never added to, so nothing is counted twice.
 *   payment made     the cost gets a paid date. Cash moves on that date, and only then.
 *
 * Budgets and the year-end summary use the date the cost was incurred (`occurred_on`).
 * Cash uses the date it was paid (`paid_on`). Records from before this change have no
 * `paid_on` field and are read as paid on the day they happened (how they were entered).
 */
import type { Cost, FarmBundle, FeedTransaction, ISODate } from '../types';
import { addDays, daysBetween } from '../format';

export const BILLS_RULE_VERSION = 'bills@1.0';

export type BillState = 'paid' | 'owed' | 'overdue';

type PayFields = Pick<Cost, 'paid_on' | 'occurred_on' | 'payment_status'>;

/** When the money for this cost left (or leaves) the bank. Null = still owed. */
export function paidOn(c: PayFields): ISODate | null {
  if (c.payment_status === 'owed') return null;
  return c.paid_on ?? c.occurred_on; // paid with no date, or an older record: paid the day it happened
}

/** The fields to write when a bill is paid, or put back to owed. */
export const markPaid = (on: ISODate) => ({ payment_status: 'paid' as const, paid_on: on });
export const markOwed = () => ({ payment_status: 'owed' as const, paid_on: null });

export function billState(c: PayFields & Pick<Cost, 'due_on'>, today: ISODate): BillState {
  if (paidOn(c) !== null) return 'paid';
  return c.due_on && c.due_on < today ? 'overdue' : 'owed';
}

export interface OwedBill {
  cost: Cost;
  state: 'owed' | 'overdue';
  payee: string;
  dueOn: ISODate | null;
  /** Days until due (negative = days overdue). Null when no due date is set. */
  daysToDue: number | null;
}

export interface SupplierOwed { payee: string; supplierId: string | null; total: number; overdue: number; bills: OwedBill[] }

export function payeeOf(c: Pick<Cost, 'supplier_name' | 'supplier_id'>, b: Pick<FarmBundle, 'suppliers'>): string {
  return c.supplier_name ?? b.suppliers.find((s) => s.id === c.supplier_id)?.name ?? 'Not recorded';
}

/** Everything still to pay, overdue first, then by due date (undated last). */
export function owedBills(b: Pick<FarmBundle, 'costs' | 'suppliers'>, today: ISODate): OwedBill[] {
  return b.costs
    .filter((c) => paidOn(c) === null)
    .map((c) => ({
      cost: c,
      state: (c.due_on && c.due_on < today ? 'overdue' : 'owed') as OwedBill['state'],
      payee: payeeOf(c, b),
      dueOn: c.due_on ?? null,
      daysToDue: c.due_on ? daysBetween(today, c.due_on) : null
    }))
    .sort((a, c) => (a.dueOn ?? '9999').localeCompare(c.dueOn ?? '9999') || a.cost.occurred_on.localeCompare(c.cost.occurred_on));
}

/** Owed bills grouped by who is owed: a supplier statement is usually paid in one go. */
export function owedBySupplier(b: Pick<FarmBundle, 'costs' | 'suppliers'>, today: ISODate): SupplierOwed[] {
  const map = new Map<string, SupplierOwed>();
  for (const o of owedBills(b, today)) {
    const k = o.cost.supplier_id ?? `name:${o.payee}`;
    const g = map.get(k) ?? { payee: o.payee, supplierId: o.cost.supplier_id, total: 0, overdue: 0, bills: [] };
    g.total += Number(o.cost.amount_eur);
    if (o.state === 'overdue') g.overdue += Number(o.cost.amount_eur);
    g.bills.push(o);
    map.set(k, g);
  }
  return [...map.values()].sort((a, c) => c.overdue - a.overdue || c.total - a.total);
}

/** Kg still to come on an order: ordered less everything delivered against it. */
export function orderRemainingKg(order: FeedTransaction, txns: FeedTransaction[]): number {
  const delivered = txns
    .filter((t) => t.txn_type === 'delivery' && t.linked_order_id === order.id)
    .reduce((s, t) => s + Number(t.quantity_kg), 0);
  return Math.max(0, Number(order.quantity_kg) - delivered);
}

export interface Commitment {
  orderId: string;
  productId: string;
  remainingKg: number;
  /** Agreed €/t on the order, else the last price paid for this feed. Null = no price known. */
  pricePerTonne: number | null;
  priceSource: 'order' | 'last_paid' | null;
  value: number | null;
  expected: ISODate | null;
}

/** Open orders: money promised but not yet a bill. Kept apart from owed and paid. */
export function commitments(b: Pick<FarmBundle, 'txns'>): { total: number; unpriced: number; rows: Commitment[] } {
  const rows: Commitment[] = b.txns
    .filter((t) => t.txn_type === 'order' && t.order_status === 'open' && t.placed !== false)
    .map((o) => {
      const remainingKg = orderRemainingKg(o, b.txns);
      const last = b.txns
        .filter((t) => t.txn_type === 'delivery' && t.feed_product_id === o.feed_product_id && t.price_per_tonne_eur !== null)
        .sort((a, c) => c.effective_on.localeCompare(a.effective_on))[0];
      const ppt = o.price_per_tonne_eur !== null ? Number(o.price_per_tonne_eur) : last ? Number(last.price_per_tonne_eur) : null;
      return {
        orderId: o.id, productId: o.feed_product_id, remainingKg,
        pricePerTonne: ppt, priceSource: (o.price_per_tonne_eur !== null ? 'order' : last ? 'last_paid' : null) as Commitment['priceSource'],
        value: ppt === null ? null : Math.round(ppt * remainingKg / 10) / 100,
        expected: o.expected_delivery_date
      };
    })
    .filter((r) => r.remainingKg > 0);
  return {
    total: rows.reduce((s, r) => s + (r.value ?? 0), 0),
    unpriced: rows.filter((r) => r.value === null).length,
    rows
  };
}

/** Paid, owed and committed: the three numbers the review asks to keep apart. */
export function moneyStates(b: Pick<FarmBundle, 'costs' | 'suppliers' | 'txns'>, today: ISODate) {
  const owed = owedBills(b, today);
  const committed = commitments(b);
  const dueSoon = (days: number) => owed.filter((o) => o.state === 'owed' && o.daysToDue !== null && o.daysToDue <= days);
  return {
    owedTotal: owed.reduce((s, o) => s + Number(o.cost.amount_eur), 0),
    overdueTotal: owed.filter((o) => o.state === 'overdue').reduce((s, o) => s + Number(o.cost.amount_eur), 0),
    overdueCount: owed.filter((o) => o.state === 'overdue').length,
    undatedCount: owed.filter((o) => o.dueOn === null).length,
    dueSoon,
    committedTotal: committed.total,
    committedUnpriced: committed.unpriced,
    committed: committed.rows,
    owed
  };
}

// ---------------------------------------------------------------------------
// Invoices: match a supplier invoice to the deliveries it covers
// ---------------------------------------------------------------------------

/** The cost row that a delivery created (if it had a price). */
export function deliveryCost(b: Pick<FarmBundle, 'costs'>, deliveryId: string): Cost | undefined {
  return b.costs.find((c) => c.feed_transaction_id === deliveryId);
}

/**
 * Deliveries an invoice from this supplier could cover: not yet on an invoice, and
 * delivered up to 120 days before the invoice date (and not after it, bar a week's grace
 * for an invoice dated before the truck came).
 */
export function uninvoicedDeliveries(b: Pick<FarmBundle, 'txns' | 'costs'>, supplierId: string | null, invoiceDate: ISODate): FeedTransaction[] {
  return b.txns
    .filter((t) => t.txn_type === 'delivery')
    .filter((t) => supplierId === null || t.supplier_id === supplierId)
    .filter((t) => t.effective_on <= addDays(invoiceDate, 7) && t.effective_on >= addDays(invoiceDate, -120))
    .filter((t) => !deliveryCost(b, t.id)?.invoice_ref)
    .sort((a, c) => a.effective_on.localeCompare(c.effective_on));
}

export interface InvoiceInput {
  supplierId: string | null;
  supplierName: string | null;
  ref: string | null;
  invoiceDate: ISODate;
  dueOn: ISODate | null;
  /** Total on the invoice, VAT included: what will be paid. */
  total: number;
  vat: number | null;
  documentId: string | null;
  /** Paid already (date), or null = owed. */
  paidOn: ISODate | null;
  deliveryIds: string[];
  /** Ids for cost rows the invoice has to create (deliveries with no price yet), one per delivery. */
  newIds: Record<string, string>;
}

export interface InvoicePlanLine {
  delivery: FeedTransaction;
  before: number | null; // docket cost before the invoice (null = no price yet)
  after: number;
  vat: number | null;
  costId: string;
  newCost: boolean;
}

/**
 * The invoice replaces docket prices on the deliveries it covers. Each delivery's cost is
 * set to its share of the invoice total: by its docket cost when every delivery had one,
 * otherwise by kg. Shares are rounded to the cent and the last one takes the remainder,
 * so the lines add up to the invoice exactly. No cost row is ever added for a delivery
 * that already has one: that is what stops the double count.
 */
export function planInvoice(b: Pick<FarmBundle, 'txns' | 'costs' | 'products'>, inv: InvoiceInput) {
  const deliveries = inv.deliveryIds.map((id) => b.txns.find((t) => t.id === id && t.txn_type === 'delivery')).filter((t): t is FeedTransaction => !!t);
  if (!deliveries.length) throw new Error('Pick at least one delivery this invoice is for.');
  if (!(inv.total > 0)) throw new Error('Enter the invoice total.');
  const existing = deliveries.map((d) => deliveryCost(b, d.id));
  const byCost = existing.every((c) => c && Number(c.amount_eur) > 0);
  const weights = deliveries.map((d, i) => (byCost ? Number(existing[i]!.amount_eur) : Number(d.quantity_kg)));
  const sumW = weights.reduce((s, w) => s + w, 0);
  const cents = Math.round(inv.total * 100);
  const vatCents = inv.vat !== null ? Math.round(inv.vat * 100) : null;
  let usedC = 0;
  let usedV = 0;
  const lines: InvoicePlanLine[] = deliveries.map((d, i) => {
    const last = i === deliveries.length - 1;
    const c = last ? cents - usedC : Math.round((cents * weights[i]) / sumW);
    const v = vatCents === null ? null : last ? vatCents - usedV : Math.round((vatCents * weights[i]) / sumW);
    usedC += c;
    if (v !== null) usedV += v;
    const cost = existing[i];
    return {
      delivery: d, before: cost ? Number(cost.amount_eur) : null, after: c / 100, vat: v === null ? null : v / 100,
      costId: cost?.id ?? inv.newIds[d.id], newCost: !cost
    };
  });

  const ops: { kind: 'insert' | 'update'; table: string; row?: Record<string, unknown>; match?: Record<string, unknown>; patch?: Record<string, unknown> }[] = [];
  const stamp = { invoice_ref: inv.ref, due_on: inv.paidOn ? null : inv.dueOn, ...(inv.paidOn ? markPaid(inv.paidOn) : markOwed()) };
  for (const l of lines) {
    const t = l.delivery;
    const perT = Math.round((l.after / (Number(t.quantity_kg) / 1000)) * 100) / 100;
    if (l.newCost) {
      const product = b.products.find((p) => p.id === t.feed_product_id)?.name ?? 'Feed';
      ops.push({ kind: 'insert', table: 'costs', row: {
        id: l.costId, farm_id: t.farm_id, category: 'feed', other_label: null, occurred_on: t.effective_on, amount_eur: l.after,
        supplier_id: inv.supplierId ?? t.supplier_id, supplier_name: inv.supplierName, feed_transaction_id: t.id,
        description: `${product} ${Math.round(Number(t.quantity_kg) / 10) / 100} t`, document_id: inv.documentId, vat_eur: l.vat, ...stamp
      } });
    } else {
      const c = existing[lines.indexOf(l)]!;
      ops.push({ kind: 'update', table: 'costs', match: { id: l.costId }, patch: {
        amount_eur: l.after, vat_eur: l.vat, ...stamp, ...(c.document_id ? {} : { document_id: inv.documentId })
      } });
    }
    ops.push({ kind: 'update', table: 'feed_transactions', match: { id: t.id }, patch: { total_price_eur: l.after, price_per_tonne_eur: perT } });
  }
  const before = lines.reduce((s, l) => s + (l.before ?? 0), 0);
  return { lines, ops, before, after: inv.total, difference: Math.round((inv.total - before) * 100) / 100, priced: lines.filter((l) => l.before !== null).length };
}

/** Apply a plan to a bundle (the optimistic update, and what tests check). */
export function applyInvoice<B extends Pick<FarmBundle, 'txns' | 'costs'>>(b: B, plan: ReturnType<typeof planInvoice>): B {
  let costs = [...b.costs];
  let txns = [...b.txns];
  for (const op of plan.ops) {
    if (op.table === 'costs' && op.kind === 'insert') costs = [op.row as unknown as Cost, ...costs];
    if (op.table === 'costs' && op.kind === 'update') costs = costs.map((c) => (c.id === op.match!.id ? { ...c, ...op.patch } as Cost : c));
    if (op.table === 'feed_transactions') txns = txns.map((t) => (t.id === op.match!.id ? { ...t, ...op.patch } as FeedTransaction : t));
  }
  return { ...b, costs, txns };
}

// ---------------------------------------------------------------------------
// Duplicates: the same thing recorded twice (two phones, or a docket and its invoice)
// ---------------------------------------------------------------------------

/** A cost that looks like one already recorded: same amount and payee within a week. */
export function similarCost(b: Pick<FarmBundle, 'costs'>, c: { amount: number; payee: string | null; date: ISODate; ref?: string | null }, ignoreId?: string): Cost | undefined {
  const name = (c.payee ?? '').trim().toLowerCase();
  return b.costs.find((x) => x.id !== ignoreId && (
    (c.ref && x.invoice_ref && x.invoice_ref.trim().toLowerCase() === c.ref.trim().toLowerCase()) ||
    (Math.abs(Number(x.amount_eur) - c.amount) < 0.005 && Math.abs(daysBetween(x.occurred_on, c.date)) <= 7 &&
      (!name || (x.supplier_name ?? '').trim().toLowerCase() === name))
  ));
}

/** A delivery that looks like one already recorded: same feed, same kg, within a day, or the same docket number. */
export function similarDelivery(b: Pick<FarmBundle, 'txns'>, d: { productId: string; kg: number; date: ISODate; ref?: string | null }, ignoreId?: string): FeedTransaction | undefined {
  const ref = d.ref?.trim().toLowerCase();
  return b.txns.find((t) => t.id !== ignoreId && t.txn_type === 'delivery' && (
    (ref && (t.notes ?? '').toLowerCase().includes(ref)) ||
    (t.feed_product_id === d.productId && Math.abs(Number(t.quantity_kg) - d.kg) < 0.5 && Math.abs(daysBetween(t.effective_on, d.date)) <= 1)
  ));
}

/** Pairs of deliveries that look like the same truck recorded twice (e.g. from two phones). */
export function possibleDuplicateDeliveries(b: Pick<FarmBundle, 'txns'>, since: ISODate): [FeedTransaction, FeedTransaction][] {
  const ds = b.txns.filter((t) => t.txn_type === 'delivery' && t.effective_on >= since).sort((a, c) => a.created_at.localeCompare(c.created_at));
  const out: [FeedTransaction, FeedTransaction][] = [];
  const kept = (t: FeedTransaction) => ((t.notes ?? '').includes('[not a duplicate]'));
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const [a, c] = [ds[i], ds[j]];
      if (kept(c)) continue;
      if (a.feed_product_id === c.feed_product_id && a.effective_on === c.effective_on && Math.abs(Number(a.quantity_kg) - Number(c.quantity_kg)) < 0.5) out.push([a, c]);
    }
  }
  return out;
}
