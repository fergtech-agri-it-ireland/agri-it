/**
 * Compare what the farmer paid with the CSO's national average for the same kind of product
 * (14 Oct 2026). The CSO figures come from cso-prices.json, fetched monthly from CSO tables
 * AJM08 (feed) and AJM09 (fertiliser) by .github/workflows/cso.yml.
 *
 * Rules:
 * - Only for a product whose pick-list item names a CSO series (same analysis or protein band).
 * - The CSO month is the month of the farmer's delivery; if the CSO hasn't published that
 *   month yet, its latest month, and it says which.
 * - Always labelled: national average, excluding VAT, the month, the day fetched. Never a quote.
 * - Republic of Ireland only. Northern Ireland farms get no comparison (the CSO covers the
 *   Republic; no matching published series was found for Northern Ireland).
 */
import data from './cso-prices.json';
import { catalogueItem } from '../catalogue';
import type { ISODate, Jurisdiction } from '../types';

interface Table { kind: string; title: string; url: string; latest_month: string | null; items: Record<string, Record<string, number>> }
const CSO = data as unknown as { source: string; licence: string; note: string; fetched_on: ISODate; tables: Record<string, Table> };

export const CSO_FETCHED_ON = CSO.fetched_on;

export interface CsoFigure {
  series: string;
  month: string; // YYYY-MM
  eurPerT: number;
  /** The CSO hasn't published the delivery's month yet, so this is its latest */
  latestInstead: boolean;
  tableUrl: string;
  fetchedOn: ISODate;
}

function find(series: string): { t: Table; s: Record<string, number> } | null {
  for (const t of Object.values(CSO.tables)) if (t.items[series]) return { t, s: t.items[series] };
  return null;
}

/** The CSO figure for a series in a month (or the latest before it). Null when the series has no figures. */
export function csoFigure(series: string, month: string): CsoFigure | null {
  const hit = find(series);
  if (!hit) return null;
  const months = Object.keys(hit.s).sort();
  const at = months.filter((m) => m <= month).pop();
  const use = at ?? null;
  if (!use) return null;
  return { series, month: use, eurPerT: hit.s[use], latestInstead: use !== month, tableUrl: hit.t.url, fetchedOn: CSO.fetched_on };
}

export interface CsoComparison {
  paidEurPerT: number;
  paidOn: ISODate;
  cso: CsoFigure;
  diffEur: number;
  diffPct: number;
}

/** Compare a price paid with the CSO average. Null when there is nothing honest to compare with. */
export function compareWithCso(catalogueKey: string | null | undefined, jurisdiction: Jurisdiction, paid: { eurPerT: number; on: ISODate } | null): CsoComparison | null {
  if (jurisdiction !== 'ROI' || !paid || !(paid.eurPerT > 0)) return null;
  const item = catalogueItem(catalogueKey);
  if (!item?.cso) return null;
  const cso = csoFigure(item.cso, paid.on.slice(0, 7));
  if (!cso) return null;
  const diffEur = Math.round((paid.eurPerT - cso.eurPerT) * 100) / 100;
  return { paidEurPerT: paid.eurPerT, paidOn: paid.on, cso, diffEur, diffPct: Math.round((diffEur / cso.eurPerT) * 1000) / 10 };
}

/** Why there's no comparison, in plain words, for a product screen. */
export function noComparisonReason(catalogueKey: string | null | undefined, jurisdiction: Jurisdiction, hasPaid: boolean): string {
  if (jurisdiction !== 'ROI') return 'The CSO average covers the Republic of Ireland. Agri-It has no Northern Ireland average yet, so only your own prices are shown.';
  const item = catalogueItem(catalogueKey);
  if (!item) return 'Say what kind of product this is to compare with the CSO national average.';
  if (!item.cso) return `The CSO publishes no average for ${item.name}, so only your own prices are shown.`;
  if (!hasPaid) return 'Record a delivery with its price to compare with the CSO national average.';
  return '';
}

const monthFmt = new Intl.DateTimeFormat('en-IE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const csoMonthLabel = (m: string) => monthFmt.format(new Date(`${m}-01T00:00:00Z`));
