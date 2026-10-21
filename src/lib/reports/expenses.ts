/** Expenses report: every cost incurred in the year by category, with VAT, what is paid and what is still owed. */
import type { Cost, FarmBundle, ISODate } from '../types';
import { COST_LABEL, type CostCategory } from '../types';
import { paidOn, payeeOf } from '../forecast/bills';
import { DISCLAIMER, moneyHead, r2, sum, type CellValue, type ReportDoc } from './doc';
import { RETENTION } from './rules';
import { inRange, isRegistered, reportPeriod } from './common';
import { metaFor } from './profit';

export interface ExpenseFigures {
  total: number; vat: number; net: number; paid: number; owed: number; n: number;
  byCategory: { key: CostCategory; label: string; gross: number; vat: number; n: number }[];
  bySupplier: { name: string; total: number; n: number }[];
  noSupplier: number; noDocument: number; noVat: number; ids: string[];
}

export function expenseFigures(b: FarmBundle, today: ISODate, offset = 0): ExpenseFigures {
  const p = reportPeriod(b.farm, today, offset);
  const rows = b.costs.filter((c) => inRange(c.occurred_on, p.fy.start, p.asAt));
  const cats = [...new Set(rows.map((c) => c.category))];
  const byCategory = cats.map((k) => { const r = rows.filter((c) => c.category === k); return { key: k, label: COST_LABEL[k], gross: sum(r.map((c) => Number(c.amount_eur))), vat: sum(r.map((c) => Number(c.vat_eur ?? 0))), n: r.length }; }).sort((a, c) => c.gross - a.gross);
  const sup = new Map<string, { total: number; n: number }>();
  for (const c of rows) { const k = payeeOf(c, b); const cur = sup.get(k) ?? { total: 0, n: 0 }; sup.set(k, { total: r2(cur.total + Number(c.amount_eur)), n: cur.n + 1 }); }
  const total = sum(rows.map((c) => Number(c.amount_eur)));
  const vat = sum(rows.map((c) => Number(c.vat_eur ?? 0)));
  const owedRows = rows.filter((c) => paidOn(c) === null);
  return {
    total, vat, net: r2(total - vat), paid: r2(total - sum(owedRows.map((c) => Number(c.amount_eur)))), owed: sum(owedRows.map((c) => Number(c.amount_eur))), n: rows.length, byCategory,
    bySupplier: [...sup.entries()].map(([name, v]) => ({ name, ...v })).sort((a, c) => c.total - a.total), noSupplier: rows.filter((c) => !c.supplier_name && !c.supplier_id).length,
    noDocument: rows.filter((c) => !c.document_id).length, noVat: isRegistered(b.farm) ? rows.filter((c) => c.vat_eur === null || c.vat_eur === undefined).length : 0, ids: rows.map((c) => c.id)
  };
}

export function expensesReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; figures: ExpenseFigures } {
  const p = reportPeriod(b.farm, today, opts.offset ?? 0);
  const f = expenseFigures(b, today, opts.offset ?? 0);
  const cols = [{ label: 'Total paid or owed', type: 'money' as const }, { label: 'VAT recorded', type: 'money' as const }, { label: 'Without VAT', type: 'money' as const }];
  const cat = { heading: 'Costs by type', columns: cols, rows: [
    ...f.byCategory.map((c) => ({ label: c.label, cells: [c.gross, c.vat, r2(c.gross - c.vat)], records: c.n })),
    { label: 'Total', cells: [f.total, f.vat, f.net], kind: 'total' as const }
  ] };
  const status = { heading: 'Paid and owed', rows: [
    { label: 'Paid', amount: f.paid, kind: 'line' as const }, { label: 'Still owed', amount: f.owed, kind: 'line' as const, to: '/money/bills' }, { label: 'Total', amount: f.total, kind: 'total' as const }
  ] };
  const sup = { heading: 'Biggest suppliers', columns: [{ label: 'Total', type: 'money' as const }, { label: 'Bills', type: 'number' as const }], rows: f.bySupplier.slice(0, 15).map((s) => ({ label: s.name, cells: [s.total, s.n] })) };
  const list = b.costs.filter((c) => inRange(c.occurred_on, p.fy.start, p.asAt)).sort((a, c) => a.occurred_on.localeCompare(c.occurred_on));
  const all = {
    heading: 'Every cost', columns: [{ label: 'Date', type: 'text' as const }, { label: 'Type', type: 'text' as const }, { label: 'Paid to', type: 'text' as const }, { label: 'Amount', type: 'money' as const }, { label: 'Status', type: 'text' as const }],
    rows: list.map((c: Cost) => ({ label: c.description || COST_LABEL[c.category], cells: [c.occurred_on, COST_LABEL[c.category], payeeOf(c, b), Number(c.amount_eur), paidOn(c) === null ? 'Owed' : `Paid ${paidOn(c)}`], to: '/money' }))
  };
  const notes: string[] = [];
  if (f.noSupplier) notes.push(`${f.noSupplier} cost${f.noSupplier > 1 ? 's have' : ' has'} no supplier recorded.`);
  if (f.noDocument) notes.push(`${f.noDocument} cost${f.noDocument > 1 ? 's have' : ' has'} no invoice or receipt attached. Revenue wants the documents behind the figures kept.`);
  if (f.noVat) notes.push(`VAT-registered: ${f.noVat} cost${f.noVat > 1 ? 's have' : ' has'} no VAT recorded.`);
  // The download: every cost on one line (paid or owed), then a total row. Type is the column to filter or pivot on.
  const meta = metaFor(b, p, 'accruals', opts.now ?? new Date().toISOString());
  const desc = (c: Cost) => (c.category === 'other' && c.other_label ? `${c.other_label}${c.description ? `. ${c.description}` : ''}` : c.description ?? '');
  const flat: CellValue[][] = list.map((c): CellValue[] => [
    c.occurred_on, COST_LABEL[c.category], payeeOf(c, b), desc(c), c.invoice_ref ?? '', Number(c.amount_eur), c.vat_eur === null || c.vat_eur === undefined ? null : Number(c.vat_eur),
    c.vat_eur === null || c.vat_eur === undefined ? null : r2(Number(c.amount_eur) - Number(c.vat_eur)), paidOn(c) === null ? 'Owed' : 'Paid', paidOn(c) ?? '', c.due_on ?? '', c.id
  ]);
  flat.push(['', 'Total', '', '', '', f.total, f.vat, f.net, '', '', '', '']);
  const doc: ReportDoc = {
    id: 'expenses', title: 'Expenses report', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta,
    table: {
      columns: [
        { label: 'Date', type: 'text' }, { label: 'Type', type: 'text' }, { label: 'Paid to', type: 'text' }, { label: 'Description', type: 'text' }, { label: 'Invoice no.', type: 'text' },
        { label: moneyHead('Amount', meta.currency), type: 'money' }, { label: moneyHead('VAT', meta.currency), type: 'money' }, { label: moneyHead('Without VAT', meta.currency), type: 'money' },
        { label: 'Status', type: 'text' }, { label: 'Paid on', type: 'text' }, { label: 'Due on', type: 'text' }, { label: 'Agri-It id', type: 'text' }
      ],
      rows: flat
    },
    basisNote: 'Every cost on the day it was incurred (invoice or delivery date), whether paid or still owed. Includes loan repayments, machinery and household drawings, shown by type.',
    completeness: { complete: true, reasons: [], notes }, sections: [cat, status, sup, all], footnotes: [DISCLAIMER, RETENTION[b.farm.jurisdiction]]
  };
  return { doc, figures: f };
}
