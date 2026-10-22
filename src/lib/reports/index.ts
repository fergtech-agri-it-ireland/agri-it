import type { FarmBundle, ISODate } from '../types';
import type { Basis, ReportDoc, ReportId } from './doc';
import { profitReport } from './profit';
import { balanceReport } from './balance';
import { animalsReport } from './animals';

export * from './doc';
export { REPORT_RULES, RETENTION, deemedCostPercent } from './rules';
export { reportPeriod } from './common';

export interface BuildOpts { offset?: number; basis?: Basis; now?: string }

export function buildReport(id: ReportId, b: FarmBundle, today: ISODate, o: BuildOpts = {}): ReportDoc {
  switch (id) {
    case 'profit': return profitReport(b, today, o).doc;
    case 'balance': return balanceReport(b, today, o).doc;
    case 'animals': return animalsReport(b, today, o).doc;
  }
}

/** The three reports. More come back one at a time, once these read right. */
export const REPORT_LIST: { id: ReportId; title: string; sub: string }[] = [
  { id: 'profit', title: 'Profit and loss', sub: 'Income, costs and profit for the year' },
  { id: 'balance', title: 'Balance sheet', sub: 'What the farm owns and owes' },
  { id: 'animals', title: 'Animals', sub: 'Tag, born, sold and left dates for each animal' }
];
