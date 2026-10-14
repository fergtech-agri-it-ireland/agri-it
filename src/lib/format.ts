import type { ISODate } from './types';

// All date maths is done on calendar days (UTC midnight) to avoid DST drift.
const DAY = 86_400_000;

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}
export function parseISO(s: ISODate): Date {
  return new Date(s + 'T00:00:00Z');
}
export function todayISO(): ISODate {
  const now = new Date();
  return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}
export function addDays(s: ISODate, n: number): ISODate {
  return toISO(new Date(parseISO(s).getTime() + n * DAY));
}
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY);
}
export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}
export function minISO(a: ISODate, b: ISODate) {
  return a < b ? a : b;
}
export function maxISO(a: ISODate, b: ISODate) {
  return a > b ? a : b;
}

const dayFmt = new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-IE', { month: 'short', timeZone: 'UTC' });
const monthYearFmt = new Intl.DateTimeFormat('en-IE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Thu 15 Nov" */
export function fmtDay(s: ISODate | null | undefined): string {
  return s ? dayFmt.format(parseISO(s)) : '';
}
/** "15 Nov 2026" */
export function fmtDate(s: ISODate | null | undefined): string {
  return s ? longFmt.format(parseISO(s)) : '';
}
export function fmtMonth(key: string): string {
  return monthFmt.format(parseISO(key + '-01'));
}
export function fmtMonthYear(key: string): string {
  return monthYearFmt.format(parseISO(key + '-01'));
}
/** Human relative day: today, tomorrow, in 3 days, 2 days ago */
export function fmtRelative(s: ISODate, today: ISODate = todayISO()): string {
  const n = daysBetween(today, s);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/**
 * Money is shown in the farm's own currency (advisory review G05): euro for farms in the
 * Republic, pounds sterling for Northern Ireland. Amounts are stored as entered, in that
 * currency; nothing is ever converted. Set once the farm is loaded (normalizeBundle).
 */
export type Currency = 'EUR' | 'GBP';
let currency: Currency = 'EUR';
export function currencyFor(jurisdiction: string | null | undefined): Currency {
  return jurisdiction === 'NI' ? 'GBP' : 'EUR';
}
export function setCurrency(c: Currency) { currency = c; }
export function getCurrency(): Currency { return currency; }
/** The farm's currency sign: "€" or "£". */
export function cur(): string { return currency === 'GBP' ? '£' : '€'; }

type Fmts = { whole: Intl.NumberFormat; cents: Intl.NumberFormat; compact: Intl.NumberFormat };
const fmts: Partial<Record<Currency, Fmts>> = {};
function f(): Fmts {
  return (fmts[currency] ??= ((locale: string) => ({
    whole: new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }),
    cents: new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    compact: new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 0 })
  }))(currency === 'GBP' ? 'en-GB' : 'en-IE'));
}
/** "€127K" for dials and tiles where space is tight. Under 10,000 shows in full. */
export function eurCompact(n: number): string {
  return Math.abs(n) < 10_000 ? f().whole.format(n) : f().compact.format(n);
}

/** An amount in the farm's currency ("€1,200" or "£1,200"). The name is kept from when every farm used euro. */
export function eur(n: number | null | undefined, cents = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return (cents ? f().cents : f().whole).format(n);
}

const num = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 1 });
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return num.format(n);
}
/** Show kg under 1 t, tonnes above. Farmers talk in tonnes for bulk feed. */
export function fmtKg(kg: number): string {
  if (Math.abs(kg) >= 1000) return `${num.format(kg / 1000)} t`;
  return `${Math.round(kg)} kg`;
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Stable, cheap hash for forecast input snapshots (FNV-1a 32-bit). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
