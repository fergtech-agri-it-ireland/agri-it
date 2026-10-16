/**
 * Fertiliser stock and spreading (rule fertiliser@1.0, 14 Oct 2026). Pure: same records, same answer.
 *
 * Stock: the last stock check (or opening stock) + deliveries since - spreading since.
 *   Never counted: deliveries - spreading, and it says so.
 * Fields due: only on the farmer's own round (spread again every N days, for grazing) or their
 *   own cutting date (silage: Teagasc says N on at least 50 days before cutting). Agri-It never
 *   picks a round or a rate. Lime and straight potash don't count as a round of nitrogen.
 * Season: from the statutory closed period for the farm's zone (lib/spreading.ts). Nothing is
 *   ever due while spreading is closed.
 */
import type { FarmBundle, Field, FertiliserProduct, FertiliserStock, ISODate } from '../types';
import { addDays, daysBetween } from '../format';
import { catalogueItem } from '../catalogue';
import { isStockReason, type VarianceReasons } from '../stockReasons';
import { GUIDANCE, SILAGE_N_DAYS_BEFORE_CUT, seasonOn, zoneFor, type SpreadingSeason } from '../spreading';

export const FERTILISER_RULE = 'fertiliser@1.0';

export interface FertiliserState {
  product: FertiliserProduct;
  stockKg: number;
  /** More spread than recorded: shown as 0, and a stock check is asked for */
  overspentKg: number;
  basis: 'counted' | 'opening_estimate' | 'deliveries_only' | 'nothing';
  lastCheck: FertiliserStock | null;
  low: boolean;
  /** Last delivery with a price: €/t from its bill */
  lastPrice: { eurPerT: number; on: ISODate } | null;
  exempt: boolean;
}

/**
 * Predicted vs counted for fertiliser (G11): at each stock check after the first, what the
 * records said was there just before it, and why it differed if the farmer said.
 */
export function fertiliserVariances(b: Pick<FarmBundle, 'fertStock' | 'spreads' | 'costs'>, product: FertiliserProduct):
  ({ date: ISODate; predictedKg: number; countedKg: number; varianceKg: number } & VarianceReasons)[] {
  const checks = b.fertStock.filter((r) => r.product_id === product.id && r.kind === 'count')
    .sort((x, y) => x.on_date.localeCompare(y.on_date) || (x.created_at ?? '').localeCompare(y.created_at ?? ''));
  const out: ({ date: ISODate; predictedKg: number; countedKg: number; varianceKg: number } & VarianceReasons)[] = [];
  for (const c of checks) {
    // Everything recorded up to this check, without the check itself or any later one
    const before = { ...b, fertStock: b.fertStock.filter((r) => r.id !== c.id && !(r.kind === 'count' && (r.on_date > c.on_date || (r.on_date === c.on_date && (r.created_at ?? '') >= (c.created_at ?? ''))))) };
    const prior = stockFor(before, product, c.on_date);
    if (!prior.lastCheck) continue; // nothing to predict from before the first check or opening stock
    const predicted = prior.stockKg - prior.overspentKg;
    const since = prior.lastCheck.on_date;
    out.push({
      date: c.on_date, predictedKg: predicted, countedKg: Number(c.quantity_kg), varianceKg: Number(c.quantity_kg) - predicted,
      reason: isStockReason(c.reason) ? c.reason : null,
      adjustments: b.fertStock.filter((r) => r.product_id === product.id && r.kind === 'adjustment' && r.on_date <= c.on_date && r.on_date >= since)
        .map((r) => ({ on: r.on_date, kg: Number(r.quantity_kg), reason: isStockReason(r.reason) ? r.reason : null }))
    });
  }
  return out;
}

export type FieldDueKind = 'round' | 'silage' | 'cut_passed';
export interface FieldDue {
  field: Field;
  kind: FieldDueKind;
  /** The day it's due (round) or the day to spread by (silage) */
  dueOn: ISODate;
  lastSpread: { on: ISODate; productId: string; kgPerAcre: number | null } | null;
  /** kg needed at the farmer's last rate on this field, if known */
  needKg: number | null;
}

export interface FertiliserForecast {
  season: SpreadingSeason | null;
  products: FertiliserState[];
  due: FieldDue[];
  /** Fields due now, and the stock they'd need at the last rate used on each, by product */
  shortfalls: { product: FertiliserProduct; needKg: number; haveKg: number; fields: string[] }[];
  /** No nitrogen spread yet since spreading opened this year */
  firstRound: boolean;
  computedAt: ISODate;
  rule: string;
}

function byTime<T extends { created_at?: string }>(a: T & { d: ISODate }, b: T & { d: ISODate }) {
  return a.d.localeCompare(b.d) || (a.created_at ?? '').localeCompare(b.created_at ?? '');
}

export function stockFor(b: Pick<FarmBundle, 'fertStock' | 'spreads' | 'costs'>, product: FertiliserProduct, today: ISODate): Omit<FertiliserState, 'low' | 'exempt' | 'product'> {
  const rows = b.fertStock.filter((r) => r.product_id === product.id && r.on_date <= today).map((r) => ({ ...r, d: r.on_date })).sort(byTime);
  const spreads = b.spreads.filter((s) => s.product_id === product.id && s.spread_on <= today).map((s) => ({ ...s, d: s.spread_on })).sort(byTime);
  const checks = rows.filter((r) => r.kind === 'count' || r.kind === 'opening');
  const last = checks[checks.length - 1] ?? null;
  const after = <T extends { d: ISODate; created_at?: string }>(x: T) => !last || x.d > last.on_date || (x.d === last.on_date && (x.created_at ?? '') > (last.created_at ?? ''));
  // Deliveries add; adjustments (G11) carry their own sign (wasted, sold: less; a missed delivery: more)
  const delivered = rows.filter((r) => (r.kind === 'delivery' || r.kind === 'adjustment') && after(r)).reduce((s, r) => s + Number(r.quantity_kg), 0);
  const spread = spreads.filter(after).reduce((s, r) => s + Number(r.total_kg), 0);
  const raw = (last ? Number(last.quantity_kg) : 0) + delivered - spread;
  const priced = b.fertStock
    .filter((r) => r.product_id === product.id && r.kind === 'delivery' && r.cost_id && Number(r.quantity_kg) > 0)
    .map((r) => ({ r, c: b.costs.find((c) => c.id === r.cost_id) }))
    .filter((x) => x.c && Number(x.c.amount_eur) > 0)
    .sort((x, y) => y.r.on_date.localeCompare(x.r.on_date) || (y.r.created_at ?? '').localeCompare(x.r.created_at ?? ''))[0];
  return {
    stockKg: Math.max(0, Math.round(raw)),
    overspentKg: raw < 0 ? Math.round(-raw) : 0,
    basis: last ? (last.evidence === 'farmer_estimate' ? 'opening_estimate' : 'counted') : rows.length ? 'deliveries_only' : 'nothing',
    lastCheck: last,
    lastPrice: priced ? { eurPerT: Math.round((Number(priced.c!.amount_eur) / Number(priced.r.quantity_kg)) * 1000 * 100) / 100, on: priced.r.on_date } : null
  };
}

export function isExempt(product: Pick<FertiliserProduct, 'catalogue_key'>): boolean {
  return !!catalogueItem(product.catalogue_key)?.exempt;
}

/** The last time a field had nitrogen (anything but lime or straight potash), on or before `today`. */
export function lastSpreadOn(b: Pick<FarmBundle, 'spreads' | 'spreadFields' | 'fertilisers'>, fieldId: string, today: ISODate) {
  const exempt = new Set(b.fertilisers.filter(isExempt).map((p) => p.id));
  let best: { on: ISODate; productId: string; kgPerAcre: number | null } | null = null;
  for (const sf of b.spreadFields.filter((x) => x.field_id === fieldId)) {
    const s = b.spreads.find((x) => x.id === sf.spread_id);
    if (!s || s.spread_on > today || exempt.has(s.product_id)) continue;
    const perAcre = sf.acres && Number(sf.acres) > 0 ? Math.round(Number(sf.kg) / Number(sf.acres)) : s.kg_per_acre !== null ? Number(s.kg_per_acre) : null;
    if (!best || s.spread_on > best.on) best = { on: s.spread_on, productId: s.product_id, kgPerAcre: perAcre };
  }
  return best;
}

export function forecastFertiliser(b: FarmBundle, today: ISODate): FertiliserForecast {
  const zone = zoneFor(b.farm.jurisdiction, b.farm.county);
  const season = zone ? seasonOn(zone, today) : null;
  const products: FertiliserState[] = b.fertilisers.filter((p) => !p.archived).map((p) => {
    const s = stockFor(b, p, today);
    return { product: p, ...s, exempt: isExempt(p), low: p.low_stock_kg !== null && s.basis !== 'nothing' && s.stockKg <= Number(p.low_stock_kg) };
  });

  const due: FieldDue[] = [];
  for (const f of b.fields.filter((x) => !x.archived)) {
    const last = lastSpreadOn(b, f.id, today);
    const needKg = (l: typeof last) => (l?.kgPerAcre && f.acres ? Math.round(l.kgPerAcre * Number(f.acres)) : null);
    if (f.use === 'silage' && f.cut_on) {
      if (f.cut_on < today) {
        due.push({ field: f, kind: 'cut_passed', dueOn: f.cut_on, lastSpread: last, needKg: null });
        continue;
      }
      const spreadBy = addDays(f.cut_on, -SILAGE_N_DAYS_BEFORE_CUT);
      // Already spread for this cut: any nitrogen in the 40 days before the spread-by date or after it
      const covered = last && last.on >= addDays(spreadBy, -40);
      if (!covered && season?.open && today >= addDays(spreadBy, -14)) due.push({ field: f, kind: 'silage', dueOn: spreadBy, lastSpread: last, needKg: needKg(last) });
      continue;
    }
    if (f.spread_every_days && season?.open) {
      // Never spread this season: due from the day spreading opened
      const since = last && last.on >= season.opensOn ? last : null;
      const dueOn = since ? addDays(since.on, f.spread_every_days) : season.opensOn;
      if (dueOn <= season.lastDay && daysBetween(today, dueOn) <= 3) due.push({ field: f, kind: 'round', dueOn, lastSpread: last, needKg: needKg(last) });
    }
  }
  due.sort((a, c) => a.dueOn.localeCompare(c.dueOn));

  // Can the stock cover the fields due now, at the last rate used on each?
  const shortfalls: FertiliserForecast['shortfalls'] = [];
  for (const p of products) {
    const fields = due.filter((d) => d.kind !== 'cut_passed' && d.dueOn <= addDays(today, 3) && d.lastSpread?.productId === p.product.id && d.needKg);
    const needKg = fields.reduce((s, d) => s + (d.needKg ?? 0), 0);
    if (needKg > p.stockKg) shortfalls.push({ product: p.product, needKg, haveKg: p.stockKg, fields: fields.map((d) => d.field.name) });
  }

  const nSpreadSinceOpen = season?.open && b.spreads.some((s) => s.spread_on >= season.opensOn && s.spread_on <= today && !isExempt(b.fertilisers.find((p) => p.id === s.product_id) ?? { catalogue_key: null }));
  const firstRound = !!season?.open && !nSpreadSinceOpen && daysBetween(season.opensOn, today) <= 60 && (b.fields.some((f) => !f.archived) || b.fertilisers.some((p) => !p.archived));
  return { season, products, due, shortfalls, firstRound, computedAt: today, rule: FERTILISER_RULE };
}

export const FIRST_N_GUIDANCE = GUIDANCE.first_n;
