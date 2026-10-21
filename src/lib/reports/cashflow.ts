/**
 * Cash flow statement: money in and out of the bank in the year, by the date it moved. Always cash
 * basis, whatever the profit report uses. Payments are the amounts actually paid (VAT included).
 * It reconciles to the cash position: opening cash plus receipts less payments equals closing cash.
 */
import type { FarmBundle, ISODate } from '../types';
import { COST_LABEL, INCOME_LABEL, type CostCategory, type IncomeType } from '../types';
import { addDays } from '../format';
import { cashPosition } from '../forecast/money';
import { paidOn } from '../forecast/bills';
import { loanYear } from '../loans';
import { DISCLAIMER, amountTable, r2, sum, type ReportDoc, type ReportSection } from './doc';
import { RETENTION } from './rules';
import { inRange, reportPeriod } from './common';
import { DIRECT_COSTS, OVERHEAD_COSTS, metaFor } from './profit';

export interface CashFigures {
  receipts: { key: IncomeType; label: string; total: number; n: number }[];
  receiptsTotal: number;
  payments: { key: CostCategory; label: string; total: number; n: number }[];
  /** Running costs paid, loan interest taken out */
  runningPaid: number;
  loanInterest: number | null;
  loanCapital: number | null;
  loanRepaid: number;
  capitalPaid: number;
  household: number;
  paymentsTotal: number;
  net: number;
  opening: number | null;
  closing: number | null;
  /** closing - opening - net: should be 0.00 */
  difference: number | null;
  complete: boolean;
  reasons: string[];
  notes: string[];
}

export function cashFigures(b: FarmBundle, today: ISODate, offset = 0): CashFigures {
  const p = reportPeriod(b.farm, today, offset);
  const reasons: string[] = [];
  const notes: string[] = [];
  const inc = b.income.filter((i) => inRange(i.occurred_on, p.fy.start, p.asAt));
  const paid = b.costs.filter((c) => { const d = paidOn(c); return d !== null && inRange(d, p.fy.start, p.asAt); });
  const order: IncomeType[] = ['milk', 'livestock', 'crop', 'grant', 'other'];
  const receipts = order.map((k) => { const rows = inc.filter((i) => i.income_type === k); return { key: k, label: INCOME_LABEL[k], total: sum(rows.map((i) => Number(i.amount_eur))), n: rows.length }; }).filter((r) => r.n > 0);
  const receiptsTotal = sum(receipts.map((r) => r.total));
  const cats = [...DIRECT_COSTS, ...OVERHEAD_COSTS];
  const payments = cats.map((k) => { const rows = paid.filter((c) => c.category === k); return { key: k, label: COST_LABEL[k], total: sum(rows.map((c) => Number(c.amount_eur))), n: rows.length }; }).filter((r) => r.n > 0);
  const runningPaid = sum(payments.map((x) => x.total));
  const repay = paid.filter((c) => c.category === 'loan_repayment');
  const loanRepaid = sum(repay.map((c) => Number(c.amount_eur)));
  const years = (b.loans ?? []).filter((l) => l.kind !== 'overdraft').map((l) => loanYear(l, b.costs, b.loanStatements ?? [], p.fy, today));
  const yearOf = new Map(years.map((y) => [y.loan.id, y]));
  // Each repayment must be linked to a loan whose interest is known, or carry its own interest figure
  const unsplit = repay.filter((c) => (c.interest_eur === null || c.interest_eur === undefined) && !(c.loan_id && yearOf.get(c.loan_id)?.interest !== null && yearOf.get(c.loan_id)?.interest !== undefined));
  let loanInterest: number | null = null;
  if (loanRepaid === 0) loanInterest = 0;
  else if (unsplit.length === 0) {
    const linked = new Set(repay.filter((c) => c.loan_id && yearOf.has(c.loan_id)).map((c) => c.loan_id as string));
    const fromLoans = sum([...linked].map((id) => yearOf.get(id)!.interest ?? 0));
    const fromLoose = sum(repay.filter((c) => !(c.loan_id && yearOf.has(c.loan_id))).map((c) => Number(c.interest_eur ?? 0)));
    loanInterest = Math.min(loanRepaid, r2(fromLoans + fromLoose));
  }
  const loanCapital = loanInterest === null ? null : r2(loanRepaid - loanInterest);
  if (loanInterest === null) reasons.push('Interest and capital in loan repayments cannot be split: link each repayment to a loan and add the bank statement');
  const capitalPaid = sum(paid.filter((c) => c.category === 'capital').map((c) => Number(c.amount_eur)));
  const household = sum(paid.filter((c) => c.category === 'household').map((c) => Number(c.amount_eur)));
  const paymentsTotal = r2(runningPaid + loanRepaid + capitalPaid + household);
  const net = r2(receiptsTotal - paymentsTotal);

  const f = b.farm;
  let opening: number | null = null; let closing: number | null = null;
  if (f.opening_cash_eur === null || !f.opening_cash_date) {
    reasons.push('Opening cash is not set (Set up your farm), so the bank balance cannot be shown');
  } else if (f.opening_cash_date > addDays(p.asAt, 1)) {
    reasons.push(`Opening cash was set on ${f.opening_cash_date}, after this period`);
  } else {
    closing = r2(cashPosition(f, b.income, b.costs, p.asAt)!.balance);
    if (f.opening_cash_date <= p.fy.start) opening = r2(cashPosition(f, b.income, b.costs, p.openingDay)!.balance);
    else reasons.push(`Opening cash was set on ${f.opening_cash_date}, part way through the year, so the start-of-year balance is not known`);
  }
  const difference = opening !== null && closing !== null ? r2(closing - opening - net) : null;
  if (p.provisional) notes.push(`Year to date, to ${p.asAt}. Payments dated later than today are not included.`);
  const owed = b.costs.filter((c) => paidOn(c) === null).length;
  if (owed > 0) notes.push(`${owed} bill${owed > 1 ? 's' : ''} still to pay ${owed > 1 ? 'are' : 'is'} not in this report. They are in Money, Bills.`);
  notes.push('Amounts are what left the bank, VAT included. VAT reclaimed or paid over is not recorded in Agri-It.');
  return { receipts, receiptsTotal, payments, runningPaid, loanInterest, loanCapital, loanRepaid, capitalPaid, household, paymentsTotal, net, opening, closing, difference, complete: reasons.length === 0, reasons, notes };
}

export function cashflowReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; figures: CashFigures } {
  const p = reportPeriod(b.farm, today, opts.offset ?? 0);
  const f = cashFigures(b, today, opts.offset ?? 0);
  const inn: ReportSection = { heading: 'Money in', rows: f.receipts.map((r) => ({ label: r.label, amount: r.total, records: r.n, kind: 'line' as const, to: '/reports/income' })) };
  if (!f.receipts.length) inn.rows.push({ label: 'No income recorded in this year', amount: 0, kind: 'info', noCsv: true });
  inn.rows.push({ label: 'Total money in', amount: f.receiptsTotal, kind: 'subtotal' });
  const out: ReportSection = { heading: 'Money out', rows: f.payments.map((r) => ({ label: r.label, amount: r.total, records: r.n, kind: 'line' as const, to: '/reports/expenses' })) };
  out.rows.push({ label: 'Running costs paid', amount: f.runningPaid, kind: 'subtotal' });
  out.rows.push({ label: 'Loan interest', amount: f.loanInterest, missing: f.loanInterest === null, kind: 'line', to: '/money/loans', note: f.loanInterest === null ? 'Add the bank statement to split the repayments' : undefined });
  out.rows.push({ label: 'Loan capital repaid', amount: f.loanCapital, missing: f.loanCapital === null, kind: 'line', to: '/money/loans' });
  out.rows.push({ label: 'Machinery, buildings and land bought', amount: f.capitalPaid, kind: 'line' });
  out.rows.push({ label: 'Household drawings', amount: f.household, kind: 'line' });
  out.rows.push({ label: 'Total money out', amount: f.paymentsTotal, kind: 'subtotal' });
  const net: ReportSection = {
    heading: 'Bank balance',
    rows: [
      { label: 'Cash at the start of the year', amount: f.opening, missing: f.opening === null, kind: 'line', to: '/setup' },
      { label: 'Money in less money out', amount: f.net, kind: 'line' },
      { label: 'Cash at the end', amount: f.closing, missing: f.closing === null, kind: 'total', note: f.difference !== null && f.difference !== 0 ? `Does not agree by ${f.difference.toFixed(2)}` : undefined }
    ]
  };
  const meta = metaFor(b, p, 'cash', opts.now ?? new Date().toISOString());
  const sections = [inn, out, net];
  // In the download the lines must add up to the total. When interest and capital cannot be split their two lines are empty,
  // so the repayments are shown as one line instead (the screen keeps the two lines and says why they are blank).
  const table = amountTable(sections, meta.currency);
  if (f.loanInterest === null && f.loanRepaid !== 0) {
    const at = table.rows.findIndex((r) => r[0] === 'Money out' && r[1] === 'Loan capital repaid');
    table.rows.splice(at + 1, 0, ['Money out', 'Loan repayments (interest and capital not split)', 'Line', f.loanRepaid, null]);
  }
  const doc: ReportDoc = {
    id: 'cashflow', title: 'Cash flow statement', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta,
    basisNote: 'Cash: money in and out of the bank on the day it moved. Bills still owed are not in it.',
    completeness: { complete: f.complete, reasons: f.reasons, notes: f.notes },
    sections, footnotes: [DISCLAIMER, RETENTION[b.farm.jurisdiction]],
    table
  };
  return { doc, figures: f };
}
