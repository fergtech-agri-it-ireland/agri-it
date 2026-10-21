/**
 * Stock report: feed and fertiliser in store at the start and end of the year, valued first in, first
 * out at what was paid (net of recorded VAT for registered farms), never above cost. Kilograms with no
 * price behind them are listed as unvalued, not guessed. Silage is counted in tonnes only.
 */
import type { FarmBundle, ISODate } from '../types';
import { DISCLAIMER, moneyHead, r2, sum, type CellValue, type ReportDoc, type ReportRow } from './doc';
import { NOTE_STOCK_RELIEF, RETENTION, REPORT_RULES } from './rules';
import { reportPeriod, stockPosition, stockTotal, stockUnvaluedKg, type StockRow } from './common';
import { metaFor } from './profit';

export interface StockFigures { opening: StockRow[]; closing: StockRow[]; openingValue: number; closingValue: number; change: number; unvaluedKg: number; complete: boolean; reasons: string[]; notes: string[] }

export function stockFigures(b: FarmBundle, today: ISODate, offset = 0): StockFigures {
  const p = reportPeriod(b.farm, today, offset);
  const opening = stockPosition(b, p.openingDay, today); const closing = stockPosition(b, p.asAt, today);
  const unvaluedKg = Math.round(stockUnvaluedKg(closing));
  const notes: string[] = []; const reasons: string[] = [];
  if (unvaluedKg > 0) reasons.push(`${unvaluedKg.toLocaleString('en-IE')} kg in store has no price recorded and is not valued`);
  const unrec = closing.filter((r) => !r.recorded).map((r) => r.name);
  if (unrec.length) notes.push(`No stock count or deliveries recorded for: ${unrec.join(', ')}`);
  if (p.provisional) notes.push(`Stock as at ${p.asAt}.`);
  return { opening, closing, openingValue: stockTotal(opening), closingValue: stockTotal(closing), change: r2(stockTotal(closing) - stockTotal(opening)), unvaluedKg, complete: reasons.length === 0, reasons, notes };
}

export function stockReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; figures: StockFigures } {
  const p = reportPeriod(b.farm, today, opts.offset ?? 0);
  const f = stockFigures(b, today, opts.offset ?? 0);
  const cols = [{ label: 'Start (kg)', type: 'kg' as const }, { label: 'End (kg)', type: 'kg' as const }, { label: 'Value at end', type: 'money' as const }, { label: 'Not valued (kg)', type: 'kg' as const }];
  const mk = (kind: 'feed' | 'fertiliser'): ReportRow[] => f.closing.filter((r) => r.kind === kind).map((r) => {
    const o = f.opening.find((x) => x.id === r.id && x.kind === kind);
    return { label: r.name, cells: [o ? o.value.kg : 0, r.value.kg, r.value.valueEur, r.value.unvaluedKg], to: kind === 'feed' ? `/feed/${r.id}` : `/fertiliser/${r.id}`, note: r.recorded ? undefined : 'Nothing recorded' };
  });
  const tot = (kind: 'feed' | 'fertiliser'): ReportRow => { const rs = f.closing.filter((r) => r.kind === kind); const os = f.opening.filter((r) => r.kind === kind); return { label: `Total ${kind}`, cells: [sum(os.map((r) => r.value.kg)), sum(rs.map((r) => r.value.kg)), stockTotal(rs), sum(rs.map((r) => r.value.unvaluedKg))], kind: 'subtotal' }; };
  const feed = { heading: 'Feed', columns: cols, rows: [...mk('feed'), tot('feed')] };
  const fert = { heading: 'Fertiliser', columns: cols, rows: [...mk('fertiliser'), tot('fertiliser')] };
  const summary = { heading: 'Value of stock at cost', rows: [
    { label: 'At the start of the year', amount: f.openingValue, kind: 'line' as const },
    { label: 'At the end', amount: f.closingValue, kind: 'line' as const },
    { label: 'Increase (decrease) in the year', amount: f.change, kind: 'total' as const, note: 'Counted in the profit report' }
  ] };
  const silage = b.silage.length ? { heading: 'Silage', note: 'Counted in tonnes for planning. Not valued: put a value on it as Crops in store in Year-end values if your accountant wants one.', rows: [] } : null;
  // The download: one row per product, a total row per kind and one for all stock. Value at start is worked out the same way as at the end.
  const meta = metaFor(b, p, null, opts.now ?? new Date().toISOString());
  const flat: CellValue[][] = [];
  for (const [kind, label] of [['feed', 'Feed'], ['fertiliser', 'Fertiliser']] as const) {
    const rs = f.closing.filter((r) => r.kind === kind); const os = f.opening.filter((r) => r.kind === kind);
    for (const r of rs) {
      const o = os.find((x) => x.id === r.id);
      flat.push([label, r.name, 'Line', o ? o.value.kg : 0, r.value.kg, o ? o.value.valueEur : 0, r.value.valueEur, r.value.unvaluedKg]);
    }
    flat.push([label, `Total ${kind}`, 'Total', sum(os.map((r) => r.value.kg)), sum(rs.map((r) => r.value.kg)), stockTotal(os), stockTotal(rs), sum(rs.map((r) => r.value.unvaluedKg))]);
  }
  flat.push(['All stock', 'Total stock', 'Total', sum(f.opening.map((r) => r.value.kg)), sum(f.closing.map((r) => r.value.kg)), f.openingValue, f.closingValue, f.unvaluedKg]);
  const doc: ReportDoc = {
    id: 'stock', title: 'Stock report', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta,
    table: {
      columns: [
        { label: 'Stock', type: 'text' }, { label: 'Item', type: 'text' }, { label: 'Row', type: 'text' },
        { label: 'Start (kg)', type: 'number' }, { label: 'End (kg)', type: 'number' },
        { label: moneyHead('Value at start', meta.currency), type: 'money' }, { label: moneyHead('Value at end', meta.currency), type: 'money' }, { label: 'Not valued (kg)', type: 'number' }
      ],
      rows: flat
    },
    basisNote: 'Feed and fertiliser in store, first in first out, at what you paid. Never valued above cost.',
    completeness: { complete: f.complete, reasons: f.reasons, notes: f.notes },
    sections: [summary, feed, fert, ...(silage ? [silage] : [])], footnotes: [DISCLAIMER, `Stock rule: ${REPORT_RULES.find((r) => r.key === 'stock_valuation')?.title}.`, NOTE_STOCK_RELIEF, RETENTION[b.farm.jurisdiction]]
  };
  return { doc, figures: f };
}
