/**
 * "Do the reports agree?" Cross-checks between the reports and the records, in plain words.
 * A check that fails names what to fix. These are the checks an accountant would do first.
 */
import type { FarmBundle, ISODate } from '../types';
import { paidOn } from '../forecast/bills';
import { eur } from '../format';
import { DISCLAIMER, r2, type ReportDoc, type ReportRow } from './doc';
import { RETENTION } from './rules';
import { reportPeriod } from './common';
import { metaFor, profitFigures } from './profit';
import { cashFigures } from './cashflow';
import { balanceFigures } from './balance';
import { animalFigures } from './animals';
import { incomeFigures } from './income';
import { expenseFigures } from './expenses';

export interface Check { id: string; label: string; ok: boolean; detail: string; to?: string; /** a fix is needed before the year end figures can be relied on */ blocking: boolean }

export function runChecks(b: FarmBundle, today: ISODate, offset = 0): Check[] {
  const p = reportPeriod(b.farm, today, offset);
  const profit = profitFigures(b, today, offset, 'accruals');
  const cash = cashFigures(b, today, offset);
  const inc = incomeFigures(b, today, offset);
  const exp = expenseFigures(b, today, offset);
  const ani = animalFigures(b, today, offset);
  const bal = balanceFigures(b, today, offset);
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);

  add({ id: 'income_agrees', label: 'Income report agrees with the profit report', blocking: true, ok: r2(inc.total - profit.sales) === 0 || p.provisional, detail: `Income report ${eur(inc.total, true)}, profit report sales ${eur(profit.sales, true)}`, to: '/reports/income' });
  const ids = new Set(profit.costIds);
  const counted = r2(b.costs.filter((c) => ids.has(c.id)).reduce((s, c) => s + Number(c.amount_eur), 0));
  add({ id: 'expenses_agree', label: 'Expenses report agrees with the profit report', blocking: true, ok: r2(exp.total - counted) === 0, detail: `Expenses report ${eur(exp.total, true)}, costs behind the profit report ${eur(counted, true)}`, to: '/reports/expenses' });
  if (cash.difference !== null) add({ id: 'cash_agrees', label: 'Cash flow agrees with the bank balance', blocking: true, ok: cash.difference === 0, detail: `Start ${eur(cash.opening, true)} plus in less out ${eur(cash.net, true)} should be ${eur(cash.closing, true)}`, to: '/reports/cashflow' });
  else add({ id: 'cash_set', label: 'Opening cash is set', blocking: true, ok: false, detail: 'Set opening cash and its date so the bank balance can be checked', to: '/setup' });
  add({ id: 'heads_agree', label: 'Animal counts add up', blocking: true, ok: ani.groups.every((g) => g.unexplained === 0), detail: ani.groups.filter((g) => g.unexplained !== 0).map((g) => `${g.name} off by ${g.unexplained}`).join('; ') || 'Every group adds up', to: '/reports/animals' });
  add({ id: 'sales_heads', label: 'Animals sold match the sales recorded', blocking: false, ok: ani.complete, detail: ani.reasons.join('; ') || 'Head counts and sales agree', to: '/reports/animals' });
  const sales = b.income.filter((i) => i.income_type === 'livestock' && i.occurred_on >= p.fy.start && i.occurred_on <= p.asAt);
  add({ id: 'sales_linked', label: 'Every animal sale is linked to a group', blocking: false, ok: sales.every((i) => i.animal_group_id), detail: ani.unattachedSales ? `${ani.unattachedSales} not linked` : 'All linked', to: '/money' });
  add({ id: 'livestock_valued', label: 'Livestock is valued at the start and end of the year', blocking: !p.provisional, ok: !profit.reasons.some((r) => r.toLowerCase().includes('livestock')), detail: p.provisional ? 'Closing values are entered at the year end' : 'Add a value for every group', to: '/reports/values' });
  add({ id: 'interest_known', label: 'Loan interest is known for every loan', blocking: true, ok: profit.interestUnknown === 0, detail: profit.interestUnknown ? `${profit.interestUnknown} loan${profit.interestUnknown > 1 ? 's' : ''} without interest: add the bank statement` : 'Interest known', to: '/money/loans' });
  const overdue = b.costs.filter((c) => paidOn(c) === null && c.due_on && c.due_on < today);
  add({ id: 'overdue', label: 'No bills are overdue', blocking: false, ok: overdue.length === 0, detail: overdue.length ? `${overdue.length} overdue` : 'None overdue', to: '/money/bills' });
  const undated = b.costs.filter((c) => c.occurred_on >= p.fy.start && c.occurred_on <= p.asAt && paidOn(c) === null && !c.due_on);
  add({ id: 'owed_dated', label: 'Bills still owed have a due date', blocking: false, ok: undated.length === 0, detail: undated.length ? `${undated.length} with no due date` : 'All dated', to: '/money/bills' });
  add({ id: 'documents', label: 'Costs have an invoice or receipt attached', blocking: false, ok: exp.noDocument === 0, detail: exp.noDocument ? `${exp.noDocument} of ${exp.n} without` : 'All have documents', to: '/reports/expenses' });
  if (b.farm.vat_status === 'registered') add({ id: 'vat', label: 'Costs have VAT recorded (VAT-registered)', blocking: false, ok: exp.noVat === 0, detail: exp.noVat ? `${exp.noVat} without VAT` : 'All have VAT', to: '/reports/expenses' });
  else if (!b.farm.vat_status) add({ id: 'vat_status', label: 'VAT status is set', blocking: false, ok: false, detail: 'Say whether you are flat-rate or registered', to: '/setup' });
  add({ id: 'stock_priced', label: 'Feed and fertiliser in store all have a price', blocking: false, ok: !bal.closing.stockUnvaluedKg, detail: bal.closing.stockUnvaluedKg ? `${Math.round(bal.closing.stockUnvaluedKg).toLocaleString('en-IE')} kg without a price` : 'All priced', to: '/reports/stock' });
  if (bal.otherChanges !== null) add({ id: 'networth', label: 'Net worth movement is explained by profit and drawings', blocking: false, ok: Math.abs(bal.otherChanges) < 0.005, detail: `Other changes ${eur(bal.otherChanges, true)} (revaluations, money put in, items not recorded)`, to: '/reports/balance' });
  return out;
}

export function checksReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; checks: Check[] } {
  const p = reportPeriod(b.farm, today, opts.offset ?? 0);
  const checks = runChecks(b, today, opts.offset ?? 0);
  const failed = checks.filter((c) => !c.ok);
  const row = (c: Check): ReportRow => ({ label: c.label, cells: [c.ok ? 'OK' : c.blocking ? 'Fix' : 'Check'], note: c.detail, kind: c.ok ? 'info' : 'warn', to: c.to });
  const doc: ReportDoc = {
    id: 'checks', title: 'Do the reports agree?', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta: metaFor(b, p, null, opts.now ?? new Date().toISOString()),
    basisNote: 'Checks that the reports agree with each other and with your records. Do this before you send anything to your accountant.',
    completeness: { complete: failed.filter((c) => c.blocking).length === 0, reasons: failed.filter((c) => c.blocking).map((c) => `${c.label}: ${c.detail}`), notes: failed.filter((c) => !c.blocking).map((c) => `${c.label}: ${c.detail}`) },
    sections: [{ heading: 'Needs fixing', columns: [{ label: 'Result', type: 'text' as const }], rows: failed.map(row) }, { heading: 'Passed', columns: [{ label: 'Result', type: 'text' as const }], rows: checks.filter((c) => c.ok).map(row) }].filter((s) => s.rows.length),
    footnotes: [DISCLAIMER, RETENTION[b.farm.jurisdiction]]
  };
  return { doc, checks };
}
