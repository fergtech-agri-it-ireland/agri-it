/** Income report: every sale and payment received in the year, by type, with milk and livestock detail. Cash received basis. */
import type { FarmBundle, ISODate } from '../types';
import { INCOME_LABEL, type IncomeType } from '../types';
import { DISCLAIMER, r2, sum, type ReportDoc } from './doc';
import { RETENTION } from './rules';
import { inRange, reportPeriod } from './common';
import { metaFor } from './profit';

export interface IncomeFigures { total: number; n: number; byType: { key: IncomeType; label: string; total: number; n: number }[]; milkLitres: number; milkEur: number; livestockHeads: number; livestockEur: number; noCounterparty: number; ids: string[] }

export function incomeFigures(b: FarmBundle, today: ISODate, offset = 0): IncomeFigures {
  const p = reportPeriod(b.farm, today, offset);
  const rows = b.income.filter((i) => inRange(i.occurred_on, p.fy.start, p.asAt));
  const order: IncomeType[] = ['milk', 'livestock', 'crop', 'grant', 'other'];
  const byType = order.map((k) => { const r = rows.filter((i) => i.income_type === k); return { key: k, label: INCOME_LABEL[k], total: sum(r.map((i) => Number(i.amount_eur))), n: r.length }; }).filter((x) => x.n > 0);
  const milk = rows.filter((i) => i.income_type === 'milk'); const live = rows.filter((i) => i.income_type === 'livestock');
  return {
    total: sum(rows.map((i) => Number(i.amount_eur))), n: rows.length, byType,
    milkLitres: milk.reduce((s, i) => s + Number(i.milk_litres ?? 0), 0), milkEur: sum(milk.filter((i) => i.milk_litres).map((i) => Number(i.amount_eur))),
    livestockHeads: live.reduce((s, i) => s + Number(i.head_count ?? 0), 0), livestockEur: sum(live.filter((i) => i.head_count).map((i) => Number(i.amount_eur))),
    noCounterparty: rows.filter((i) => !i.counterparty).length, ids: rows.map((i) => i.id)
  };
}

export function incomeReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; figures: IncomeFigures } {
  const p = reportPeriod(b.farm, today, opts.offset ?? 0);
  const f = incomeFigures(b, today, opts.offset ?? 0);
  const sum1 = { heading: 'Income by type', rows: [
    ...f.byType.map((t) => ({ label: t.label, amount: t.total, records: t.n, kind: 'line' as const })),
    { label: 'Total income received', amount: f.total, kind: 'total' as const }
  ] };
  const detail = { heading: 'Detail', rows: [] as { label: string; amount?: number | null; kind: 'info'; note?: string }[] };
  if (f.milkLitres > 0) detail.rows.push({ label: 'Milk sold (litres)', amount: f.milkLitres, kind: 'info', note: `Average ${(f.milkEur / f.milkLitres * 100).toFixed(2)} cent per litre on the cheques that gave litres` });
  if (f.livestockHeads > 0) detail.rows.push({ label: 'Animals sold (head)', amount: f.livestockHeads, kind: 'info', note: `Average ${r2(f.livestockEur / f.livestockHeads).toFixed(2)} per head on the sales that gave a head count` });
  const list = b.income.filter((i) => inRange(i.occurred_on, p.fy.start, p.asAt)).sort((a, c) => a.occurred_on.localeCompare(c.occurred_on));
  const all = {
    heading: 'Every receipt', columns: [{ label: 'Date', type: 'text' as const }, { label: 'Type', type: 'text' as const }, { label: 'From', type: 'text' as const }, { label: 'Amount', type: 'money' as const }],
    rows: list.map((i) => ({ label: i.description || INCOME_LABEL[i.income_type], cells: [i.occurred_on, INCOME_LABEL[i.income_type], i.counterparty ?? 'Not recorded', Number(i.amount_eur)], to: '/money' }))
  };
  const doc: ReportDoc = {
    id: 'income', title: 'Income report', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta: metaFor(b, p, 'cash', opts.now ?? new Date().toISOString()),
    basisNote: 'Money received, on the day it was received. Amounts are as recorded; Agri-It does not split out VAT on sales.',
    completeness: { complete: true, reasons: [], notes: f.noCounterparty ? [`${f.noCounterparty} receipt${f.noCounterparty > 1 ? 's have' : ' has'} no name recorded for who paid.`] : [] },
    sections: [sum1, ...(detail.rows.length ? [detail] : []), all], footnotes: [DISCLAIMER, RETENTION[b.farm.jurisdiction]]
  };
  return { doc, figures: f };
}
