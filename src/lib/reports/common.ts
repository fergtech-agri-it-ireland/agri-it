/**
 * Shared pieces for the reports: the period, VAT treatment, year-end values and stock valued at cost.
 */
import type { AnimalGroup, Cost, Farm, FarmBundle, HeadCountChange, ISODate, YearEndValue, YearValueKind } from '../types';
import { addDays } from '../format';
import { fyRange } from '../forecast/money';
import { paidOn } from '../forecast/bills';
import { stockAt } from '../forecast/feed';
import { stockFor } from '../forecast/fertiliser';
import { headsOn, withHistory } from '../heads';
import { r2, sum } from './doc';

export interface Period {
  fy: { start: ISODate; end: ISODate; label: string };
  today: ISODate;
  /** The day the figures run to: the year end, or today while the year is in progress */
  asAt: ISODate;
  /** The last day of the previous year: where the opening values are at */
  openingDay: ISODate;
  /** The year end: where the closing values are at */
  closingDay: ISODate;
  provisional: boolean;
  offset: number;
}

export function reportPeriod(farm: Pick<Farm, 'financial_year_start_month'>, today: ISODate, offset = 0): Period {
  const fy = fyRange(farm, today, offset);
  const provisional = today < fy.end;
  return { fy, today, asAt: provisional ? today : fy.end, openingDay: addDays(fy.start, -1), closingDay: fy.end, provisional, offset };
}

export const inRange = (d: ISODate, a: ISODate, b: ISODate) => d >= a && d <= b;

/** VAT-registered farms keep VAT out of costs (it is reclaimed); flat-rate farmers keep it in. */
export const isRegistered = (farm: Pick<Farm, 'vat_status'>) => farm.vat_status === 'registered';

/** A cost as the profit report counts it. Registered: net of the VAT recorded on it. */
export function netAmount(c: Pick<Cost, 'amount_eur' | 'vat_eur'>, registered: boolean): number {
  const gross = Number(c.amount_eur);
  return registered && c.vat_eur !== null && c.vat_eur !== undefined ? r2(gross - Number(c.vat_eur)) : gross;
}

/** The date a cost counts in the year, by basis: incurred (accruals) or paid (cash). Null = not paid, so not in cash. */
export const costDate = (c: Cost, basis: 'accruals' | 'cash'): ISODate | null => (basis === 'accruals' ? c.occurred_on : paidOn(c));

// ---------------------------------------------------------------------------
// Year-end values the farmer or accountant entered
// ---------------------------------------------------------------------------
export function valuesOn(b: Pick<FarmBundle, 'yearValues'>, day: ISODate, kind?: YearValueKind): YearEndValue[] {
  return (b.yearValues ?? []).filter((v) => v.as_at === day && (!kind || v.kind === kind));
}
export const valueSum = (rows: YearEndValue[]) => sum(rows.map((v) => Number(v.value_eur)));

// ---------------------------------------------------------------------------
// Stock valued at cost: first in, first out. Never above cost.
// ---------------------------------------------------------------------------
export interface Delivery { on: ISODate; kg: number; costEur: number | null }
export interface StockValue {
  kg: number;
  valueEur: number;
  valuedKg: number;
  /** Stock for which no price is known: counted in kg, left out of the value */
  unvaluedKg: number;
}

/**
 * FIFO: the oldest stock is used first, so what is left came from the newest deliveries.
 * Walk the deliveries newest first until the closing quantity is covered. A delivery with no
 * price, or stock older than every recorded delivery, is unvalued: it is counted but never given
 * a made-up value.
 */
export function fifoValue(closingKg: number, deliveries: Delivery[]): StockValue {
  let left = Math.max(0, closingKg);
  let value = 0;
  let valued = 0;
  const newestFirst = [...deliveries].filter((d) => d.kg > 0).sort((a, b) => b.on.localeCompare(a.on));
  for (const d of newestFirst) {
    if (left <= 0) break;
    const use = Math.min(left, d.kg);
    if (d.costEur !== null && d.costEur > 0) {
      value += (use * d.costEur) / d.kg;
      valued += use;
    }
    left -= use;
  }
  return { kg: Math.max(0, closingKg), valueEur: r2(value), valuedKg: Math.round(valued), unvaluedKg: Math.max(0, Math.round(closingKg - valued)) };
}

export interface StockRow {
  id: string;
  name: string;
  kind: 'feed' | 'fertiliser';
  recorded: boolean;
  value: StockValue;
}

/** Feed in the bin at the end of `day`, from the ledger. Null = nothing recorded up to then. */
export function feedKgEndOf(b: FarmBundle, productId: string, day: ISODate, today: ISODate): number | null {
  const groups = new Map(withHistory(b.groups, b.headHistory).map((g) => [g.id, g]));
  const next = addDays(day, 1) > today ? today : addDays(day, 1);
  const r = stockAt(
    b.txns.filter((t) => t.feed_product_id === productId),
    b.rules.filter((x) => x.feed_product_id === productId),
    groups, next, undefined, b.feedLogs.filter((l) => l.feed_product_id === productId)
  );
  return r.stock === null ? null : Math.max(0, Math.round(r.stock));
}

export function feedDeliveries(b: FarmBundle, productId: string, lastDay: ISODate, registered: boolean): Delivery[] {
  return b.txns
    .filter((t) => t.feed_product_id === productId && t.txn_type === 'delivery' && t.effective_on <= lastDay && Number(t.quantity_kg) > 0)
    .map((t) => {
      const costs = b.costs.filter((c) => c.feed_transaction_id === t.id);
      const costEur = costs.length ? sum(costs.map((c) => netAmount(c, registered))) : t.total_price_eur !== null && t.total_price_eur !== undefined ? Number(t.total_price_eur) : null;
      return { on: t.effective_on, kg: Number(t.quantity_kg), costEur };
    });
}

export function fertDeliveries(b: FarmBundle, productId: string, lastDay: ISODate, registered: boolean): Delivery[] {
  return b.fertStock
    .filter((r) => r.product_id === productId && r.kind === 'delivery' && r.on_date <= lastDay && Number(r.quantity_kg) > 0)
    .map((r) => {
      const c = r.cost_id ? b.costs.find((x) => x.id === r.cost_id) : undefined;
      return { on: r.on_date, kg: Number(r.quantity_kg), costEur: c ? netAmount(c, registered) : null };
    });
}

/** Every feed and fertiliser the farm has, with what is in store at the end of `day` and what it cost. */
export function stockPosition(b: FarmBundle, day: ISODate, today: ISODate): StockRow[] {
  const reg = isRegistered(b.farm);
  const upTo = day > today ? today : day;
  const rows: StockRow[] = [];
  for (const p of b.products) {
    const kg = feedKgEndOf(b, p.id, upTo, today);
    if (kg === null && p.archived) continue;
    rows.push({ id: p.id, name: p.name, kind: 'feed', recorded: kg !== null, value: fifoValue(kg ?? 0, feedDeliveries(b, p.id, upTo, reg)) });
  }
  for (const p of b.fertilisers) {
    const s = stockFor(b, p, upTo);
    const recorded = s.basis !== 'nothing';
    if (!recorded && p.archived) continue;
    rows.push({ id: p.id, name: p.name, kind: 'fertiliser', recorded, value: fifoValue(s.stockKg, fertDeliveries(b, p.id, upTo, reg)) });
  }
  return rows;
}
export const stockTotal = (rows: StockRow[]) => sum(rows.map((r) => r.value.valueEur));
export const stockUnvaluedKg = (rows: StockRow[]) => rows.reduce((s, r) => s + r.value.unvaluedKg, 0);

// ---------------------------------------------------------------------------
// Head counts at a day, for reports
// ---------------------------------------------------------------------------
/**
 * Head count at the end of `day`. The "opening" entry a group is created with is the count the farmer
 * started from: before it, the same count is taken to have been there (the farm did not start that
 * day). Everything else is read from the dated history.
 */
export function headsAtEndOf(g: Pick<AnimalGroup, 'head_count'>, history: HeadCountChange[], day: ISODate): number {
  if (!history.length) return g.head_count;
  const rows = [...history].sort((a, c) => (a.effective_on + a.created_at).localeCompare(c.effective_on + c.created_at));
  if (rows.some((h) => h.effective_on <= day)) return headsOn(g, day, rows);
  return rows[0].reason === 'opening' ? Number(rows[0].head_count) : headsOn(g, day, rows);
}
