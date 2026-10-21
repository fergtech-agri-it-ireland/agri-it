import type { FarmBundle, ISODate } from '../types';
import type { Basis, ReportDoc, ReportId } from './doc';
import { profitReport } from './profit';
import { cashflowReport } from './cashflow';
import { balanceReport } from './balance';
import { stockReport } from './stock';
import { animalsReport } from './animals';
import { incomeReport } from './income';
import { expensesReport } from './expenses';
import { checksReport } from './checks';

export * from './doc';
export { REPORT_RULES, RETENTION, deemedCostPercent } from './rules';
export { reportPeriod } from './common';

export interface BuildOpts { offset?: number; basis?: Basis; now?: string }

export function buildReport(id: ReportId, b: FarmBundle, today: ISODate, o: BuildOpts = {}): ReportDoc {
  switch (id) {
    case 'profit': return profitReport(b, today, o).doc;
    case 'cashflow': return cashflowReport(b, today, o).doc;
    case 'balance': return balanceReport(b, today, o).doc;
    case 'stock': return stockReport(b, today, o).doc;
    case 'animals': return animalsReport(b, today, o).doc;
    case 'income': return incomeReport(b, today, o).doc;
    case 'expenses': return expensesReport(b, today, o).doc;
    case 'checks': return checksReport(b, today, o).doc;
  }
}

export const REPORT_LIST: { id: ReportId; title: string; sub: string; group: 'year' | 'basic' }[] = [
  { id: 'profit', title: 'Profit report', sub: 'Output, costs and profit for the year', group: 'year' },
  { id: 'cashflow', title: 'Cash flow', sub: 'Money in and out of the bank', group: 'year' },
  { id: 'balance', title: 'Balance sheet', sub: 'What the farm owns and owes', group: 'year' },
  { id: 'checks', title: 'Do the reports agree?', sub: 'Checks before you see your accountant', group: 'year' },
  { id: 'income', title: 'Income', sub: 'Every sale and payment received', group: 'basic' },
  { id: 'expenses', title: 'Expenses', sub: 'Every cost, with VAT, paid and owed', group: 'basic' },
  { id: 'stock', title: 'Stock', sub: 'Feed and fertiliser in store, at cost', group: 'basic' },
  { id: 'animals', title: 'Animals', sub: 'Head counts, sales and values', group: 'basic' }
];
