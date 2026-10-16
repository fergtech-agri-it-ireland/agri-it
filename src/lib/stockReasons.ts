/**
 * Forecast exceptions (advisory board G11, 14 Oct 2026; rule stock-reasons@1.0).
 *
 * A stock adjustment (feed or fertiliser) carries a reason, and a stock check that is a fair
 * way off what Agri-It expected asks why. The reasons show on Predicted vs counted, so the
 * farmer (and the pilot) can see whether a gap was waste, unplanned use or a miscount.
 *
 * Agri-It never changes the farmer's feeding rate or spreading rate because of any of this.
 */
import type { ISODate } from './types';

export type StockReason =
  | 'wasted' | 'fed_other_group' | 'used_elsewhere' | 'sold_returned' | 'count_error' | 'delivery_missing' | 'not_known';

export const STOCK_REASONS: StockReason[] = ['wasted', 'fed_other_group', 'used_elsewhere', 'sold_returned', 'count_error', 'delivery_missing', 'not_known'];

export const REASON_TEXT: Record<'feed' | 'fertiliser', Record<StockReason, string>> = {
  feed: {
    wasted: 'Wasted or spoiled',
    fed_other_group: 'Unplanned use: fed to another group',
    used_elsewhere: 'Unplanned use: used elsewhere',
    sold_returned: 'Sold or returned',
    count_error: 'Counting error',
    delivery_missing: "A delivery wasn't recorded",
    not_known: "Don't know"
  },
  fertiliser: {
    wasted: 'Wasted or spoiled (wet or burst bags)',
    fed_other_group: 'Unplanned use: spread and not recorded',
    used_elsewhere: 'Unplanned use: used elsewhere',
    sold_returned: 'Sold or returned',
    count_error: 'Counting error',
    delivery_missing: "A delivery wasn't recorded",
    not_known: "Don't know"
  }
};

/** Short words for history lines and Predicted vs counted. */
export const REASON_SHORT: Record<StockReason, string> = {
  wasted: 'wasted', fed_other_group: 'unplanned use', used_elsewhere: 'used elsewhere', sold_returned: 'sold or returned',
  count_error: 'counting error', delivery_missing: 'delivery not recorded', not_known: 'reason not known'
};

/** Which way an adjustment moves stock. A counting error can go either way, so the farmer says. */
export const TAKES_OFF: Record<StockReason, boolean | null> = {
  wasted: true, fed_other_group: true, used_elsewhere: true, sold_returned: true, count_error: null, delivery_missing: false, not_known: null
};

/** Reasons offered when recording an adjustment by hand. */
export const ADJUST_REASONS: StockReason[] = ['wasted', 'fed_other_group', 'used_elsewhere', 'sold_returned', 'count_error'];

/**
 * Reasons offered when a stock check comes in off the forecast. Less than expected: what took it.
 * More than expected: a miscount or a delivery that wasn't put in. Don't know is always there.
 */
export function countReasons(countedKg: number, expectedKg: number): StockReason[] {
  return countedKg < expectedKg
    ? ['wasted', 'fed_other_group', 'used_elsewhere', 'sold_returned', 'count_error', 'not_known']
    : ['count_error', 'delivery_missing', 'not_known'];
}

/** Asking why is worth it at 25 kg and 3% or more off (one bag of meal, and more than rounding). */
export const ASK_MIN_KG = 25;
export const ASK_MIN_PCT = 3;
export function worthAsking(countedKg: number, expectedKg: number | null): boolean {
  if (expectedKg === null || !Number.isFinite(countedKg)) return false;
  const gap = Math.abs(countedKg - expectedKg);
  return gap >= ASK_MIN_KG && (expectedKg <= 0 || (gap / expectedKg) * 100 >= ASK_MIN_PCT);
}

export const isStockReason = (x: unknown): x is StockReason => typeof x === 'string' && (STOCK_REASONS as string[]).includes(x);

/** The signed kg for an adjustment: reasons that take stock off are negative. */
export function signedKg(kg: number, reason: StockReason, direction: 'less' | 'more'): number {
  const off = TAKES_OFF[reason] ?? direction === 'less';
  return off ? -Math.abs(kg) : Math.abs(kg);
}

export interface VarianceReasons {
  /** Why the count differed (asked at the stock check), if the farmer said */
  reason: StockReason | null;
  /** Adjustments recorded between the last check and this one, with their reasons */
  adjustments: { on: ISODate; kg: number; reason: StockReason | null }[];
}

/** "Reasons given: wasted 2, counting error 1" across a feed's or fertiliser's checks. */
export function reasonTally(rows: VarianceReasons[]): string | null {
  const n = new Map<StockReason, number>();
  for (const r of rows) {
    if (r.reason) n.set(r.reason, (n.get(r.reason) ?? 0) + 1);
    for (const a of r.adjustments) if (a.reason) n.set(a.reason, (n.get(a.reason) ?? 0) + 1);
  }
  if (!n.size) return null;
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${REASON_SHORT[r]} ${c}`).join(', ');
}
