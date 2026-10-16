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
import type { Cost, FarmBundle, FeedTransaction, FertiliserStock, ISODate } from '../types';
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
  /** Feed or fertiliser (14 Oct 2026); missing = feed */
  kind?: 'feed' | 'fertiliser';
  productId: string;
  remainingKg: number;
  /** Agreed €/t on the order, else the last price paid for this feed. Null = no price known. */
  pricePerTonne: number | null;
  priceSource: 'order' | 'last_paid' | null;
  value: number | null;
  expected: ISODate | null;
}

/** Kg still to come on a fertiliser order: ordered less everything delivered against it. */
export function fertOrderRemainingKg(order: FertiliserStock, rows: FertiliserStock[]): number {
  const delivered = rows.filter((r) => r.kind === 'delivery' && r.linked_order_id === order.id).reduce((s, r) => s + Number(r.quantity_kg), 0);
  return Math.max(0, Number(order.quantity_kg) - delivered);
}

/** Open fertiliser orders with something still to come. */
export function openFertOrders(rows: FertiliserStock[], productId?: string): (FertiliserStock & { remainingKg: number })[] {
  return rows
    .filter((r) => r.kind === 'order' && r.order_status === 'open' && (!productId || r.product_id === productId))
    .map((r) => ({ ...r, remainingKg: fertOrderRemainingKg(r, rows) }))
    .filter((r) => r.remainingKg > 0)
    .sort((a, c) => (a.expected_on ?? a.on_date).localeCompare(c.expected_on ?? c.on_date));
}

/** Open orders: money promised but not yet a bill. Kept apart from owed and paid. Feed and fertiliser. */
export function commitments(b: Pick<FarmBundle, 'txns'> & Partial<Pick<FarmBundle, 'fertStock' | 'costs'>>): { total: number; unpriced: number; rows: Commitment[] } {
  const feed: Commitment[] = b.txns
    .filter((t) => t.txn_type === 'order' && t.order_status === 'open' && t.placed !== false)
    .map((o) => {
      const remainingKg = orderRemainingKg(o, b.txns);
      const last = b.txns
        .filter((t) => t.txn_type === 'delivery' && t.feed_product_id === o.feed_product_id && t.price_per_tonne_eur !== null)
        .sort((a, c) => c.effective_on.localeCompare(a.effective_on))[0];
      const ppt = o.price_per_tonne_eur !== null ? Number(o.price_per_tonne_eur) : last ? Number(last.price_per_tonne_eur) : null;
      return {
        orderId: o.id, kind: 'feed' as const, productId: o.feed_product_id, remainingKg,
        pricePerTonne: ppt, priceSource: (o.price_per_tonne_eur !== null ? 'order' : last ? 'last_paid' : null) as Commitment['priceSource'],
        value: ppt === null ? null : Math.round(ppt * remainingKg / 10) / 100,
        expected: o.expected_delivery_date
      };
    });
  const rows = b.fertStock ?? [];
  const fert: Commitment[] = openFertOrders(rows).map((o) => {
    // Agreed price on the order, else the last fertiliser delivery of this product with a bill
    const last = rows
      .filter((r) => r.kind === 'delivery' && r.product_id === o.product_id && r.cost_id && Number(r.quantity_kg) > 0)
      .map((r) => ({ r, c: (b.costs ?? []).find((c) => c.id === r.cost_id) }))
      .filter((x) => x.c && Number(x.c.amount_eur) > 0)
      .sort((x, y) => y.r.on_date.localeCompare(x.r.on_date))[0];
    const lastPpt = last ? Number(last.c!.amount_eur) / (Number(last.r.quantity_kg) / 1000) : null;
    const agreed = o.price_per_tonne_eur !== null && o.price_per_tonne_eur !== undefined ? Number(o.price_per_tonne_eur) : null;
    const ppt = agreed ?? lastPpt;
    return {
      orderId: o.id, kind: 'fertiliser' as const, productId: o.product_id, remainingKg: o.remainingKg,
      pricePerTonne: ppt, priceSource: (agreed !== null ? 'order' : lastPpt !== null ? 'last_paid' : null) as Commitment['priceSource'],
      value: ppt === null ? null : Math.round(ppt * o.remainingKg / 10) / 100,
      expected: o.expected_on ?? null
    };
  });
  const all = [...feed, ...fert].filter((r) => r.remainingKg > 0);
  return {
    total: all.reduce((s, r) => s + (r.value ?? 0), 0),
    unpriced: all.filter((r) => r.value === null).length,
    rows: all
  };
}

/** Paid, owed and committed: the three numbers the review asks to keep apart. */
export function moneyStates(b: Pick<FarmBundle, 'costs' | 'suppliers' | 'txns'> & Partial<Pick<FarmBundle, 'fertStock'>>, today: ISODate) {
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

type InvoiceBundle = Pick<FarmBundle, 'txns' | 'costs' | 'products'> & Partial<Pick<FarmBundle, 'fertStock' | 'fertilisers'>>;

/** The cost row that a delivery created (if it had a price): feed by its link, fertiliser by the row's cost_id. */
export function deliveryCost(b: Pick<FarmBundle, 'costs'> & Partial<Pick<FarmBundle, 'fertStock'>>, deliveryId: string): Cost | undefined {
  const feed = b.costs.find((c) => c.feed_transaction_id === deliveryId);
  if (feed) return feed;
  const f = (b.fertStock ?? []).find((r) => r.id === deliveryId && r.kind === 'delivery');
  return f?.cost_id ? b.costs.find((c) => c.id === f.cost_id) : undefined;
}

const inWindow = (on: ISODate, invoiceDate: ISODate) => on <= addDays(invoiceDate, 7) && on >= addDays(invoiceDate, -120);

/**
 * Deliveries an invoice from this supplier could cover: not yet on an invoice, and
 * delivered up to 120 days before the invoice date (and not after it, bar a week's grace
 * for an invoice dated before the truck came).
 */
export function uninvoicedDeliveries(b: Pick<FarmBundle, 'txns' | 'costs'>, supplierId: string | null, invoiceDate: ISODate): FeedTransaction[] {
  return b.txns
    .filter((t) => t.txn_type === 'delivery')
    .filter((t) => supplierId === null || t.supplier_id === supplierId)
    .filter((t) => inWindow(t.effective_on, invoiceDate))
    .filter((t) => !deliveryCost(b, t.id)?.invoice_ref)
    .sort((a, c) => a.effective_on.localeCompare(c.effective_on));
}

/** The same for fertiliser deliveries (14 Oct 2026). */
export function uninvoicedFertDeliveries(b: Pick<FarmBundle, 'costs'> & Partial<Pick<FarmBundle, 'fertStock'>>, supplierId: string | null, invoiceDate: ISODate): FertiliserStock[] {
  return (b.fertStock ?? [])
    .filter((r) => r.kind === 'delivery' && Number(r.quantity_kg) > 0)
    .filter((r) => supplierId === null || r.supplier_id === supplierId)
    .filter((r) => inWindow(r.on_date, invoiceDate))
    .filter((r) => !deliveryCost(b, r.id)?.invoice_ref)
    .sort((a, c) => a.on_date.localeCompare(c.on_date));
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
  /** Feed deliveries and fertiliser deliveries (fertiliser_stock ids), in any mix */
  deliveryIds: string[];
  /** Ids for cost rows the invoice has to create (deliveries with no price yet), one per delivery. */
  newIds: Record<string, string>;
}

export interface InvoicePlanLine {
  id: string;
  kind: 'feed' | 'fertiliser';
  /** The feed delivery (feed lines) */
  delivery?: FeedTransaction;
  /** The fertiliser delivery (fertiliser lines) */
  fert?: FertiliserStock;
  kg: number;
  on: ISODate;
  name: string;
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
 * that already has one: that is what stops the double count. One invoice can cover feed
 * and fertiliser from the same supplier.
 */
export function planInvoice(b: InvoiceBundle, inv: InvoiceInput) {
  const items = inv.deliveryIds.map((id) => {
    const feed = b.txns.find((t) => t.id === id && t.txn_type === 'delivery');
    if (feed) return { id, kind: 'feed' as const, delivery: feed, kg: Number(feed.quantity_kg), on: feed.effective_on, farmId: feed.farm_id, supplierId: feed.supplier_id, name: b.products.find((p) => p.id === feed.feed_product_id)?.name ?? 'Feed' };
    const fert = (b.fertStock ?? []).find((r) => r.id === id && r.kind === 'delivery');
    if (fert) return { id, kind: 'fertiliser' as const, fert, kg: Number(fert.quantity_kg), on: fert.on_date, farmId: fert.farm_id, supplierId: fert.supplier_id, name: (b.fertilisers ?? []).find((p) => p.id === fert.product_id)?.name ?? 'Fertiliser' };
    return null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) throw new Error('Pick at least one delivery this invoice is for.');
  if (!(inv.total > 0)) throw new Error('Enter the invoice total.');
  const existing = items.map((d) => deliveryCost(b, d.id));
  const byCost = existing.every((c) => c && Number(c.amount_eur) > 0);
  const weights = items.map((d, i) => (byCost ? Number(existing[i]!.amount_eur) : d.kg));
  const sumW = weights.reduce((s, w) => s + w, 0);
  const cents = Math.round(inv.total * 100);
  const vatCents = inv.vat !== null ? Math.round(inv.vat * 100) : null;
  let usedC = 0;
  let usedV = 0;
  const lines: InvoicePlanLine[] = items.map((d, i) => {
    const last = i === items.length - 1;
    const c = last ? cents - usedC : Math.round((cents * weights[i]) / sumW);
    const v = vatCents === null ? null : last ? vatCents - usedV : Math.round((vatCents * weights[i]) / sumW);
    usedC += c;
    if (v !== null) usedV += v;
    const cost = existing[i];
    return {
      id: d.id, kind: d.kind, delivery: d.kind === 'feed' ? d.delivery : undefined, fert: d.kind === 'fertiliser' ? d.fert : undefined,
      kg: d.kg, on: d.on, name: d.name,
      before: cost ? Number(cost.amount_eur) : null, after: c / 100, vat: v === null ? null : v / 100,
      costId: cost?.id ?? inv.newIds[d.id], newCost: !cost
    };
  });

  const ops: { kind: 'insert' | 'update'; table: string; row?: Record<string, unknown>; match?: Record<string, unknown>; patch?: Record<string, unknown> }[] = [];
  const stamp = { invoice_ref: inv.ref, due_on: inv.paidOn ? null : inv.dueOn, ...(inv.paidOn ? markPaid(inv.paidOn) : markOwed()) };
  lines.forEach((l, i) => {
    const item = items[i];
    const perT = Math.round((l.after / (l.kg / 1000)) * 100) / 100;
    if (l.newCost) {
      ops.push({ kind: 'insert', table: 'costs', row: {
        id: l.costId, farm_id: item.farmId, category: l.kind === 'feed' ? 'feed' : 'fertiliser', other_label: null, occurred_on: l.on, amount_eur: l.after,
        supplier_id: inv.supplierId ?? item.supplierId, supplier_name: inv.supplierName, feed_transaction_id: l.kind === 'feed' ? l.id : null,
        description: `${l.name} ${Math.round(l.kg / 10) / 100} t`, document_id: inv.documentId, vat_eur: l.vat, ...stamp
      } });
      if (l.kind === 'fertiliser') ops.push({ kind: 'update', table: 'fertiliser_stock', match: { id: l.id }, patch: { cost_id: l.costId } });
    } else {
      const c = existing[i]!;
      ops.push({ kind: 'update', table: 'costs', match: { id: l.costId }, patch: {
        amount_eur: l.after, vat_eur: l.vat, ...stamp, ...(c.document_id ? {} : { document_id: inv.documentId })
      } });
    }
    if (l.kind === 'feed') ops.push({ kind: 'update', table: 'feed_transactions', match: { id: l.id }, patch: { total_price_eur: l.after, price_per_tonne_eur: perT } });
  });
  const before = lines.reduce((s, l) => s + (l.before ?? 0), 0);
  return { lines, ops, before, after: inv.total, difference: Math.round((inv.total - before) * 100) / 100, priced: lines.filter((l) => l.before !== null).length };
}

/** Apply a plan to a bundle (the optimistic update, and what tests check). */
export function applyInvoice<B extends Pick<FarmBundle, 'txns' | 'costs'> & Partial<Pick<FarmBundle, 'fertStock'>>>(b: B, plan: ReturnType<typeof planInvoice>): B {
  let costs = [...b.costs];
  let txns = [...b.txns];
  let fertStock = b.fertStock ? [...b.fertStock] : undefined;
  for (const op of plan.ops) {
    if (op.table === 'costs' && op.kind === 'insert') costs = [op.row as unknown as Cost, ...costs];
    if (op.table === 'costs' && op.kind === 'update') costs = costs.map((c) => (c.id === op.match!.id ? { ...c, ...op.patch } as Cost : c));
    if (op.table === 'feed_transactions') txns = txns.map((t) => (t.id === op.match!.id ? { ...t, ...op.patch } as FeedTransaction : t));
    if (op.table === 'fertiliser_stock' && fertStock) fertStock = fertStock.map((r) => (r.id === op.match!.id ? { ...r, ...op.patch } as FertiliserStock : r));
  }
  return { ...b, costs, txns, ...(fertStock ? { fertStock } : {}) };
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
