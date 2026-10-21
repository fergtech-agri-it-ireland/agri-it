/**
 * Animals report: head count reconciliation per group for the year (opening + born + bought or added
 * + moved in - sold - moved out - other reductions = closing), then livestock sales and what the
 * farmer has valued them at. Numbers of animals only; values are the farmer's (year-end values).
 */
import type { AnimalGroup, FarmBundle, HeadCountChange, ISODate } from '../types';
import { ANIMAL_CLASS_LABEL } from '../types';
import { DISCLAIMER, sum, type ReportDoc, type ReportRow } from './doc';
import { RETENTION } from './rules';
import { headsAtEndOf, reportPeriod } from './common';
import { metaFor } from './profit';

export interface GroupMovement {
  groupId: string;
  name: string;
  klass: string;
  opening: number;
  born: number;
  added: number;
  movedIn: number;
  sold: number;
  movedOut: number;
  /** Counted down by hand: deaths, losses, corrections */
  reduced: number;
  closing: number;
  /** opening + in - out - closing: 0 when every change is classed */
  unexplained: number;
  soldRecordedInIncome: number;
}

export function classify(reason: string): 'born' | 'moved_in' | 'moved_out' | 'sold' | 'sale_undone' | 'calf_undone' | 'ignore' | 'adjust' {
  const r = reason.toLowerCase();
  if (r === 'calved') return 'born';
  if (r === 'sale') return 'sold';
  if (r.startsWith('moved from')) return 'moved_in';
  if (r.startsWith('moved to')) return 'moved_out';
  if (r === 'sale undone') return 'sale_undone';
  if (r === 'calf undone') return 'calf_undone';
  if (r === 'confirmed') return 'ignore';
  return 'adjust';
}

/** Where one group's head count went in the year. The first count entered for a group is not a movement. */
export function groupMovement(g: AnimalGroup, history: HeadCountChange[], income: FarmBundle['income'], start: ISODate, openingDay: ISODate, end: ISODate): GroupMovement {
  const rows = [...history].sort((a, c) => (a.effective_on + a.created_at).localeCompare(c.effective_on + c.created_at));
  let running = headsAtEndOf(g, rows, openingDay);
  const opening = running;
  const m = { born: 0, added: 0, movedIn: 0, sold: 0, movedOut: 0, reduced: 0 };
  for (const h of rows.filter((x) => x.effective_on >= start && x.effective_on <= end)) {
    if (h.reason === 'opening') { running = Number(h.head_count); continue; }
    const delta = Number(h.head_count) - running;
    running = Number(h.head_count);
    if (delta === 0) continue;
    const k = classify(h.reason);
    if (k === 'ignore') continue;
    if (k === 'born' && delta > 0) m.born += delta;
    else if (k === 'moved_in' && delta > 0) m.movedIn += delta;
    else if (k === 'moved_out' && delta < 0) m.movedOut += -delta;
    else if (k === 'sold' && delta < 0) m.sold += -delta;
    else if (k === 'sale_undone' && delta > 0) m.sold -= delta; // the sale was taken back: not sold after all
    else if (k === 'calf_undone' && delta < 0) m.born += delta; // the birth was taken back
    else if (delta > 0) m.added += delta; // bought in, group started, or a hand count up
    else m.reduced += -delta;
  }
  const closing = running;
  const sold = income.filter((i) => i.income_type === 'livestock' && i.animal_group_id === g.id && i.occurred_on >= start && i.occurred_on <= end).reduce((s, i) => s + Number(i.head_count ?? 0), 0);
  return { groupId: g.id, name: g.name, klass: ANIMAL_CLASS_LABEL[g.animal_class], opening, ...m, closing, unexplained: opening + m.born + m.added + m.movedIn - m.sold - m.movedOut - m.reduced - closing, soldRecordedInIncome: sold };
}

export interface AnimalFigures { groups: GroupMovement[]; totals: Omit<GroupMovement, 'groupId' | 'name' | 'klass'>; livestockSalesEur: number; soldHeadsInSales: number; unattachedSales: number; complete: boolean; reasons: string[]; notes: string[] }

export function animalFigures(b: FarmBundle, today: ISODate, offset = 0): AnimalFigures {
  const p = reportPeriod(b.farm, today, offset);
  const hist = (g: AnimalGroup) => (b.headHistory ?? []).filter((h) => h.animal_group_id === g.id);
  const groups = b.groups.map((g) => groupMovement(g, hist(g), b.income, p.fy.start, p.openingDay, p.asAt)).filter((m) => !(m.opening === 0 && m.closing === 0 && m.born + m.added + m.movedIn + m.sold + m.movedOut + m.reduced === 0));
  const t = (k: keyof GroupMovement) => groups.reduce((s, g) => s + (g[k] as number), 0);
  const totals = { opening: t('opening'), born: t('born'), added: t('added'), movedIn: t('movedIn'), sold: t('sold'), movedOut: t('movedOut'), reduced: t('reduced'), closing: t('closing'), unexplained: t('unexplained'), soldRecordedInIncome: t('soldRecordedInIncome') };
  const sales = b.income.filter((i) => i.income_type === 'livestock' && i.occurred_on >= p.fy.start && i.occurred_on <= p.asAt);
  const unattachedSales = sales.filter((i) => !i.animal_group_id).length;
  const reasons: string[] = []; const notes: string[] = [];
  for (const g of groups) if (g.sold !== g.soldRecordedInIncome && g.soldRecordedInIncome > 0) reasons.push(`${g.name}: ${g.soldRecordedInIncome} sold in sales records, head count went down by ${g.sold}`);
  if (unattachedSales) notes.push(`${unattachedSales} livestock sale${unattachedSales > 1 ? 's are' : ' is'} not linked to a group, so ${unattachedSales > 1 ? 'they are' : 'it is'} not in the head counts.`);
  if (b.headHistory?.some((h) => h.reason === 'opening' && h.effective_on > p.fy.start && h.effective_on <= p.asAt)) notes.push('A group first entered during the year is counted as there from the start. Its first count is not shown as animals added.');
  if (groups.some((g) => g.added > 0)) notes.push('"Added" is animals bought in, a group started, or a count raised by hand. Record purchases as Livestock bought in Money so they reach the profit report.');
  if (groups.some((g) => g.reduced > 0)) notes.push('"Reduced by hand" is deaths, losses or corrections. Agri-It does not know which.');
  if (p.provisional) notes.push(`Year to date, to ${p.asAt}.`);
  return { groups, totals, livestockSalesEur: sum(sales.map((i) => Number(i.amount_eur))), soldHeadsInSales: sales.reduce((s, i) => s + Number(i.head_count ?? 0), 0), unattachedSales, complete: reasons.length === 0, reasons, notes };
}

export function animalsReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; figures: AnimalFigures } {
  const p = reportPeriod(b.farm, today, opts.offset ?? 0);
  const f = animalFigures(b, today, opts.offset ?? 0);
  const cols = ['Start', 'Born', 'Added', 'Moved in', 'Sold', 'Moved out', 'Reduced by hand', 'End'].map((label) => ({ label, type: 'number' as const }));
  const row = (label: string, g: Omit<GroupMovement, 'groupId' | 'name' | 'klass'>, extra: Partial<ReportRow> = {}): ReportRow => ({ label, cells: [g.opening, g.born, g.added, g.movedIn, g.sold, g.movedOut, g.reduced, g.closing], ...extra });
  const rows: ReportRow[] = f.groups.map((g) => row(g.name.toLowerCase() === g.klass.toLowerCase() ? g.name : `${g.name} (${g.klass})`, g, { to: '/farm/groups', note: g.unexplained !== 0 ? `Does not add up by ${g.unexplained}` : undefined }));
  rows.push(row('All animals', f.totals, { kind: 'total' }));
  const movement = { heading: 'Animals: start to end of the year', columns: cols, rows, note: 'Start + born + added + moved in - sold - moved out - reduced by hand = end. Moves between groups cancel out in the total.' };
  const values = (b.yearValues ?? []).filter((v) => v.kind === 'livestock' && v.as_at === p.closingDay);
  const sales = {
    heading: 'Sales and values', rows: [
      { label: 'Livestock sales received', amount: f.livestockSalesEur, kind: 'line' as const, to: '/reports/income', note: f.soldHeadsInSales ? `${f.soldHeadsInSales} animals recorded in sales` : undefined },
      { label: 'Value of livestock at the year end (your figures)', amount: values.length ? sum(values.map((v) => Number(v.value_eur))) : null, missing: !values.length, kind: 'line' as const, to: '/reports/values', note: values.length ? undefined : p.provisional ? 'Entered at the year end' : 'Not entered' }
    ]
  };
  const doc: ReportDoc = {
    id: 'animals', title: 'Animals report', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta: metaFor(b, p, null, opts.now ?? new Date().toISOString()),
    basisNote: 'Head counts from the day each change took effect. Values are only what you have entered.',
    completeness: { complete: f.complete, reasons: f.reasons, notes: f.notes }, sections: [movement, sales], footnotes: [DISCLAIMER, RETENTION[b.farm.jurisdiction]]
  };
  return { doc, figures: f };
}
