/**
 * Balance sheet (statement of what the farm owns and owes) at the year end, with the start of the
 * year beside it. Single-entry records: assets and liabilities come from what Agri-It holds plus the
 * values the farmer entered. Nothing is made up; a missing value is shown as not valued, and net
 * worth is labelled incomplete. Net worth movement is reconciled to profit and drawings with an
 * explicit "other changes" line, never forced to balance.
 */
import type { FarmBundle, ISODate, YearValueKind } from '../types';
import { YEAR_VALUE_LABEL, type YearEndValue } from '../types';
import { addDays } from '../format';
import { cashPosition } from '../forecast/money';
import { paidOn } from '../forecast/bills';
import { balanceOn } from '../loans';
import { DISCLAIMER, r2, sum, type ReportDoc, type ReportRow, type ReportSection } from './doc';
import { RETENTION, NOTE_NO_DEPRECIATION } from './rules';
import { reportPeriod, stockPosition, stockTotal, stockUnvaluedKg, valuesOn, valueSum, type Period } from './common';
import { metaFor, profitFigures } from './profit';

export interface Side {
  day: ISODate;
  cash: number | null;
  debtors: number | null;
  livestock: number | null;
  crops: number | null;
  stock: number;
  stockUnvaluedKg: number;
  machinery: number | null;
  buildings: number | null;
  land: number | null;
  other: number | null;
  assetsTotal: number;
  loans: { lender: string; balance: number | null }[];
  loansTotal: number;
  loansUnknown: number;
  creditors: number;
  liabilitiesTotal: number;
  netWorth: number;
  /** Items that could not be valued, in words */
  gaps: string[];
}

export interface BalanceFigures { opening: Side; closing: Side; profit: number | null; household: number; netWorthChange: number; otherChanges: number | null; complete: boolean; reasons: string[]; notes: string[]; basisKinds: Record<string, string[]> }

function kindValue(b: FarmBundle, day: ISODate, kind: YearValueKind): number | null {
  const rows = valuesOn(b, day, kind);
  return rows.length ? valueSum(rows) : null;
}

export function sideOn(b: FarmBundle, day: ISODate, valueDay: ISODate, today: ISODate, label: string): Side {
  const gaps: string[] = [];
  const upTo = day > today ? today : day;
  const f = b.farm;
  let cash: number | null = null;
  if (f.opening_cash_eur !== null && f.opening_cash_date && f.opening_cash_date <= addDays(upTo, 1)) cash = r2(cashPosition(f, b.income, b.costs, upTo)!.balance);
  else gaps.push(`Cash at bank (${label}): opening cash not set for then`);
  const lv = kindValue(b, valueDay, 'livestock');
  if (lv === null) gaps.push(`Livestock (${label}) not valued`);
  const crops = kindValue(b, valueDay, 'crops_in_store');
  const debtors = kindValue(b, valueDay, 'debtors');
  const machinery = kindValue(b, valueDay, 'machinery'); const buildings = kindValue(b, valueDay, 'buildings'); const land = kindValue(b, valueDay, 'land'); const other = kindValue(b, valueDay, 'other_asset');
  const sp = stockPosition(b, upTo, today);
  const stock = stockTotal(sp);
  const loans = (b.loans ?? []).filter((l) => !l.archived || l.balance_on <= upTo).map((l) => ({
    lender: l.lender,
    balance: l.balance_on <= upTo ? balanceOn(l, b.costs, b.loanStatements ?? [], upTo) : null
  }));
  const loansUnknown = loans.filter((l) => l.balance === null).length;
  if (loansUnknown) gaps.push(`${loansUnknown} loan${loansUnknown > 1 ? 's have' : ' has'} no balance on record for ${label}`);
  const loansTotal = sum(loans.map((l) => l.balance ?? 0));
  const creditors = sum(b.costs.filter((c) => c.occurred_on <= upTo && (() => { const p = paidOn(c); return p === null || p > upTo; })()).map((c) => Number(c.amount_eur)));
  const assetsTotal = r2((cash ?? 0) + (debtors ?? 0) + (lv ?? 0) + (crops ?? 0) + stock + (machinery ?? 0) + (buildings ?? 0) + (land ?? 0) + (other ?? 0));
  const liabilitiesTotal = r2(loansTotal + creditors);
  return { day, cash, debtors, livestock: lv, crops, stock, stockUnvaluedKg: stockUnvaluedKg(sp), machinery, buildings, land, other, assetsTotal, loans, loansTotal, loansUnknown, creditors, liabilitiesTotal, netWorth: r2(assetsTotal - liabilitiesTotal), gaps };
}

export function balanceFigures(b: FarmBundle, today: ISODate, offset = 0): BalanceFigures {
  const p = reportPeriod(b.farm, today, offset);
  const opening = sideOn(b, p.openingDay, p.openingDay, today, 'the start');
  const closing = sideOn(b, p.asAt, p.closingDay, today, p.provisional ? 'today' : 'the year end');
  const reasons = [...opening.gaps.map((g) => g), ...closing.gaps];
  const notes: string[] = [];
  const basisKinds: Record<string, string[]> = {};
  for (const v of (b.yearValues ?? []).filter((x) => x.as_at === p.closingDay)) (basisKinds[v.kind] ??= []).push(v.basis);
  const pf = profitFigures(b, today, offset, 'accruals');
  const complete = reasons.length === 0 && pf.complete;
  const household = pf.household;
  const netWorthChange = r2(closing.netWorth - opening.netWorth);
  const otherChanges = complete ? r2(netWorthChange - (pf.profit - household)) : null;
  if (p.provisional) notes.push(`Cash, stock, loans and bills are as at ${p.asAt}. Values you enter for ${p.closingDay} count as the closing values.`);
  if (opening.stockUnvaluedKg + closing.stockUnvaluedKg > 0) notes.push('Some feed or fertiliser in store has no price recorded and is left out of its value.');
  return { opening, closing, profit: pf.profit, household, netWorthChange, otherChanges, complete, reasons: [...new Set(reasons)], notes, basisKinds };
}

export function balanceReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; figures: BalanceFigures } {
  const p: Period = reportPeriod(b.farm, today, opts.offset ?? 0);
  const f = balanceFigures(b, today, opts.offset ?? 0);
  const col = (o: Side, c: Side, label: string, get: (s: Side) => number | null, extra?: Partial<ReportRow>): ReportRow => ({ label, cells: [get(o), get(c)], ...extra });
  const money = [{ label: `At ${f.opening.day}`, type: 'money' as const }, { label: `At ${f.closing.day}`, type: 'money' as const }];
  const assets: ReportSection = {
    heading: 'What the farm owns', columns: money,
    rows: [
      col(f.opening, f.closing, 'Cash at bank', (s) => s.cash, { to: '/setup' }),
      col(f.opening, f.closing, 'Money owed to you', (s) => s.debtors, { to: '/reports/values' }),
      col(f.opening, f.closing, 'Livestock', (s) => s.livestock, { to: '/reports/values' }),
      col(f.opening, f.closing, 'Crops in store', (s) => s.crops, { to: '/reports/values' }),
      col(f.opening, f.closing, 'Feed and fertiliser in store, at cost', (s) => s.stock, { to: '/reports/stock' }),
      col(f.opening, f.closing, 'Machinery', (s) => s.machinery, { to: '/reports/values' }),
      col(f.opening, f.closing, 'Buildings', (s) => s.buildings, { to: '/reports/values' }),
      col(f.opening, f.closing, 'Land', (s) => s.land, { to: '/reports/values' }),
      col(f.opening, f.closing, 'Other assets', (s) => s.other, { to: '/reports/values' }),
      col(f.opening, f.closing, 'Total assets', (s) => s.assetsTotal, { kind: 'total' })
    ].filter((r) => r.kind === 'total' || r.cells!.some((c) => c !== null))
  };
  const loanRows: ReportRow[] = f.closing.loans.map((l) => ({ label: `Loan: ${l.lender}`, cells: [f.opening.loans.find((x) => x.lender === l.lender)?.balance ?? null, l.balance], to: '/money/loans', kind: 'line' as const }));
  const liab: ReportSection = {
    heading: 'What the farm owes', columns: money,
    rows: [
      ...loanRows,
      col(f.opening, f.closing, 'Bills owed to suppliers', (s) => s.creditors, { to: '/money/bills' }),
      col(f.opening, f.closing, 'Total owed', (s) => s.liabilitiesTotal, { kind: 'total' })
    ]
  };
  const worth: ReportSection = {
    heading: 'Net worth', columns: money,
    rows: [{ ...col(f.opening, f.closing, 'Net worth (owns less owes)', (s) => s.netWorth, { kind: 'total', note: f.complete ? undefined : 'Incomplete: values missing above' }) }]
  };
  const move: ReportSection = {
    heading: 'How net worth moved',
    rows: [
      { label: 'Net worth at the end less at the start', amount: f.netWorthChange, kind: 'line' },
      { label: 'Profit for the year (profit report, accruals)', amount: f.profit, kind: 'line', to: '/reports/profit' },
      { label: 'Less household drawings', amount: f.household === 0 ? 0 : -f.household, kind: 'line' },
      { label: 'Other changes', amount: f.otherChanges, missing: f.otherChanges === null, kind: 'total', note: f.otherChanges === null ? 'Shown once every value is entered' : 'Revaluations, depreciation not counted, money put in or taken out of the farm, and anything not recorded' }
    ]
  };
  const basis: ReportSection = {
    heading: 'How the values were put on things',
    rows: (b.yearValues ?? []).filter((v: YearEndValue) => v.as_at === p.closingDay).map((v) => ({
      label: `${YEAR_VALUE_LABEL[v.kind]}: ${v.label}`, amount: Number(v.value_eur), kind: 'info' as const, note: `${VALUE_BASIS_TEXT[v.basis]}${v.note ? `. ${v.note}` : ''}`, to: '/reports/values'
    }))
  };
  const sections = [assets, liab, worth, move];
  if (basis.rows.length) sections.push(basis);
  const doc: ReportDoc = {
    id: 'balance', title: 'Balance sheet', subtitle: `${b.farm.name}, at ${f.closing.day}`,
    meta: metaFor(b, p, null, opts.now ?? new Date().toISOString()),
    basisNote: 'What the farm owns and owes on the day. Values for animals, crops, machinery, buildings, land and money owed are yours or your accountant\'s, with the basis shown.',
    completeness: { complete: f.complete, reasons: f.reasons, notes: f.notes }, sections,
    footnotes: [DISCLAIMER, NOTE_NO_DEPRECIATION, 'Single-entry records: this is a statement of position, not a double-entry balance sheet.', RETENTION[b.farm.jurisdiction]]
  };
  return { doc, figures: f };
}

const VALUE_BASIS_TEXT: Record<string, string> = {
  market_value: 'Market value', cost: 'Cost', net_realisable_value: 'Net realisable value',
  deemed_cost: 'Deemed cost (a set percentage of market value)', accountant: 'Your accountant\'s figure', farmer_estimate: 'Your own estimate'
};
