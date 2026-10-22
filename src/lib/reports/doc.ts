/**
 * One document shape for every report (21 Oct 2026, rule `reports@1.0`).
 *
 * Each report is built as a ReportDoc by a pure function. The screen, the print view and the CSV
 * are all drawn from that same document, so what the farmer reads is exactly what the accountant
 * gets: the three cannot disagree. Amounts are numbers; formatting happens only when drawing.
 */
import type { ISODate } from '../types';

export const REPORTS_RULE_VERSION = 'reports@1.0';

export type ReportId = 'profit' | 'balance' | 'animals';
export type Basis = 'accruals' | 'cash';
export type RowKind = 'line' | 'subtotal' | 'total' | 'info' | 'warn';
export type ColumnType = 'money' | 'number' | 'kg' | 'text' | 'date';

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
  /** Left out of the downloaded table (a screen-only line, such as "No income recorded") */
  noCsv?: boolean;
}
export interface ReportColumn { label: string; type: ColumnType }

/**
 * What a download holds: one header row, then data rows, with total rows where a total means something.
 * No title, notes, stamp, blank rows or section headings, so it opens as a plain table that can be
 * filtered, sorted, pivoted and summed, or imported by other software.
 */
export type CellValue = string | number | null;
export interface FlatColumn { label: string; type: 'text' | 'money' | 'number' | 'date' }
/** `strong` lists the rows that are totals, so a spreadsheet can show them in bold. Dates are ISO text. */
export interface FlatTable { columns: FlatColumn[]; rows: CellValue[][]; strong?: number[] }
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
  /** The downloadable table: see FlatTable */
  table: FlatTable;
}

export const DISCLAIMER = 'Management report from the records in Agri-It. Not statutory accounts and not a tax computation.';

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));

/** The currency in a money column's header, so the file says what the numbers are without a header block. */
export const moneyHead = (label: string, currency: 'EUR' | 'GBP') => `${label} (${currency})`;

/**
 * Amount-style reports (profit and loss) as one table: Section, Item, Amount.
 * A total is a row whose item says Total, and is bold in the spreadsheet. A figure that is not known is an empty cell.
 */
export function amountTable(sections: ReportSection[], currency: 'EUR' | 'GBP'): FlatTable {
  const rows: CellValue[][] = [];
  const strong: number[] = [];
  for (const s of sections) {
    for (const r of s.rows) {
      if (r.noCsv) continue;
      if (r.kind === 'info' && (r.missing || r.amount === null || r.amount === undefined)) continue;
      if (r.kind === 'total' || r.kind === 'subtotal') strong.push(rows.length);
      rows.push([s.heading, r.label, r.missing || r.amount === null || r.amount === undefined ? null : r.amount]);
    }
  }
  return { columns: [{ label: 'Section', type: 'text' }, { label: 'Item', type: 'text' }, { label: moneyHead('Amount', currency), type: 'money' }], rows, strong };
}

const text = (v: string) => {
  // A cell that starts with = + - or @ would run as a formula in a spreadsheet
  const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** 2026-02-05 as 05/02/2026, the way it is written in Ireland and read by an Irish spreadsheet */
export const dmy = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const value = (v: CellValue | undefined, col: FlatColumn | undefined) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return col?.type === 'date' ? dmy(v) : text(v);
  if (!Number.isFinite(v)) return '';
  const n = r2(v) + 0; // no "-0.00"
  return col?.type === 'money' ? n.toFixed(2) : String(n);
};

/** CSV of a table: header row, then rows. Numbers are plain (no currency sign, no thousands separator). Plain UTF-8, no byte-order mark. */
export function tableCsv(t: FlatTable): string {
  const head = t.columns.map((c) => text(c.label)).join(',');
  const body = t.rows.map((row) => t.columns.map((c, i) => value(row[i], c)).join(','));
  return [head, ...body].join('\n');
}

/** CSV of a report: its table, nothing else. What the basis and gaps are stay on the screen, in print and in the pack's README. */
export const docCsv = (d: ReportDoc): string => tableCsv(d.table);
