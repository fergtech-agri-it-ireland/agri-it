/**
 * One document shape for every report (21 Oct 2026, rule `reports@1.0`).
 *
 * Each report is built as a ReportDoc by a pure function. The screen, the print view and the CSV
 * are all drawn from that same document, so what the farmer reads is exactly what the accountant
 * gets: the three cannot disagree. Amounts are numbers; formatting happens only when drawing.
 */
import type { ISODate } from '../types';

export const REPORTS_RULE_VERSION = 'reports@1.0';

export type ReportId = 'profit' | 'cashflow' | 'balance' | 'stock' | 'animals' | 'income' | 'expenses' | 'checks';
export type Basis = 'accruals' | 'cash';
export type RowKind = 'line' | 'subtotal' | 'total' | 'info' | 'warn';
export type ColumnType = 'money' | 'number' | 'kg' | 'text';

export interface ReportRow {
  label: string;
  /** One-amount sections */
  amount?: number | null;
  /** Table sections: one value per column */
  cells?: (string | number | null)[];
  note?: string;
  kind?: RowKind;
  /** Where to look at, or fix, what is behind the line */
  to?: string;
  /** The figure is not known: shown as a dash with the note saying why */
  missing?: boolean;
  /** How many records it is built from */
  records?: number;
}
export interface ReportColumn { label: string; type: ColumnType }
export interface ReportSection { heading: string; columns?: ReportColumn[]; rows: ReportRow[]; note?: string }

export interface Completeness {
  /** No blocking gaps: the figures can be read as the year's figures */
  complete: boolean;
  /** What is missing, in plain words */
  reasons: string[];
  /** Worth knowing, not blocking */
  notes: string[];
}

export interface ReportMeta {
  farm: string;
  yearLabel: string;
  start: ISODate;
  end: ISODate;
  /** The day the figures run to: the year end, or today while the year is in progress */
  asAt: ISODate;
  provisional: boolean;
  basis: Basis | null;
  currency: 'EUR' | 'GBP';
  generatedAt: string;
  rule: string;
  jurisdiction: 'ROI' | 'NI';
}

export interface ReportDoc {
  id: ReportId;
  title: string;
  subtitle: string;
  meta: ReportMeta;
  /** One plain sentence saying how the figures are worked out */
  basisNote: string;
  completeness: Completeness;
  sections: ReportSection[];
  footnotes: string[];
}

export const DISCLAIMER = 'Management report from the records in Agri-It. Not statutory accounts and not a tax computation.';

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));

const q = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** CSV of a report: a header block, then each section. Numbers are plain (no currency sign); the currency is in the header. */
export function docCsv(d: ReportDoc): string {
  const m = d.meta;
  const out: (string | number | null)[][] = [
    [d.title], [d.subtitle], [DISCLAIMER], [],
    ['Farm', m.farm], ['Financial year', `${m.start} to ${m.end}`], ['Figures run to', m.asAt + (m.provisional ? ' (year in progress: provisional)' : '')],
    ['Basis', d.basisNote], ['Currency', m.currency], ['Generated', m.generatedAt], ['Rule version', m.rule],
    ['Complete', d.completeness.complete ? 'Yes' : 'No']
  ];
  for (const r of d.completeness.reasons) out.push(['Missing', r]);
  for (const r of d.completeness.notes) out.push(['Note', r]);
  out.push([]);
  for (const s of d.sections) {
    out.push([s.heading]);
    if (s.columns) out.push(['', ...s.columns.map((c) => c.label), 'Note']);
    else out.push(['Line', 'Amount', 'Note']);
    for (const r of s.rows) {
      const val = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : typeof v === 'number' ? num(v) : v);
      if (s.columns) out.push([r.label, ...s.columns.map((_, i) => (r.missing ? '' : val(r.cells?.[i]))), r.note ?? '']);
      else out.push([r.label, r.missing || r.amount === null || r.amount === undefined ? '' : num(r.amount), r.note ?? '']);
    }
    if (s.note) out.push([s.note]);
    out.push([]);
  }
  for (const f of d.footnotes) out.push([f]);
  return out.map((row) => row.map(q).join(',')).join('\n');
}
