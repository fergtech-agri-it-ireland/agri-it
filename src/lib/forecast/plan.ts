/**
 * Year plan (rule year-plan@1.0, 16 Oct 2026): the farm's cash flow budget for the financial
 * year, month by month, planned against what actually happened.
 *
 * Laid out the way Teagasc's cash flow budget is (Creating a cash flow budget, KC2010):
 * receipts, payments (farm costs, other known costs, loans and leases, household drawings),
 * net cash flow, then the bank balance carried forward to spot the months the overdraft
 * may be breached. Cash basis: money counts in the month it is paid or received.
 *
 * Planned, for each line and month, comes from (first that applies):
 *  - repeats the farmer set up (Routines with an amount), on their days;
 *  - loan repayments from each loan's schedule (lib/loans.ts);
 *  - scheme payments expected, on their published dates (lib/schemes.ts);
 *  - the farmer's own budget, for anything those don't already cover that month.
 * Actual is what was recorded. Nothing here is a benchmark or a recommendation.
 */
import type { CostCategory, FarmBundle, ISODate, IncomeType } from '../types';
import { COST_LABEL, INCOME_LABEL } from '../types';
import { addDays, daysBetween, monthKey, toISO } from '../format';
import { dueDates } from '../routines';
import { paidOn } from './bills';
import { cashPosition, fyRange, monthsBetween } from './money';
import { balanceOn, overdraftLimit, projectRepayments, knownBalance, isRecorded } from '../loans';

export const PLAN_RULE_VERSION = 'year-plan@1.0';

export type PlanSource = 'repeat' | 'loan' | 'scheme' | 'budget' | 'owed';
export interface PlanCell { planned: number; actual: number; sources: PlanSource[] }
export interface PlanLine {
  key: string;
  kind: 'in' | 'out';
  /** Teagasc's groups: receipts; farm costs; loans and leases; household; capital */
  group: 'receipts' | 'farm' | 'loans' | 'household' | 'capital';
  label: string;
  cells: Record<string, PlanCell>;
  planned: number;
  actual: number;
}
export interface PlanMonth {
  month: string;
  plannedIn: number; plannedOut: number;
  actualIn: number; actualOut: number;
  /** past = closed month; now = this month; ahead = still to come */
  status: 'past' | 'now' | 'ahead';
  /** Bank at the month end: recorded for closed months (when a balance is known), else projected */
  bank: number | null;
  bankBasis: 'recorded' | 'projected' | null;
}

const GROUP_OF = (cat: string): PlanLine['group'] => (cat === 'loan_repayment' ? 'loans' : cat === 'household' ? 'household' : cat === 'capital' ? 'capital' : 'farm');

export function yearPlan(b: FarmBundle, today: ISODate, offset = 0) {
  const fy = fyRange(b.farm, today, offset);
  const months = monthsBetween(monthKey(fy.start), monthKey(fy.end));
  const current = monthKey(today);
  const lines = new Map<string, PlanLine>();
  const line = (key: string, kind: PlanLine['kind'], group: PlanLine['group'], label: string) => {
    let l = lines.get(key);
    if (!l) { l = { key, kind, group, label, cells: Object.fromEntries(months.map((m) => [m, { planned: 0, actual: 0, sources: [] }])), planned: 0, actual: 0 }; lines.set(key, l); }
    return l;
  };
  const add = (l: PlanLine, m: string, field: 'planned' | 'actual', amount: number, source?: PlanSource) => {
    const c = l.cells[m];
    if (!c) return;
    c[field] += amount;
    if (source && !c.sources.includes(source)) c.sources.push(source);
  };
  const incomeKey = (t: string) => `in:${t}`;
  const costKey = (c: string) => `out:${c}`;
  const incomeLine = (t: string) => line(incomeKey(t), 'in', 'receipts', INCOME_LABEL[t as IncomeType] ?? t);
  const costLine = (c: string) => line(costKey(c), 'out', GROUP_OF(c), COST_LABEL[c as CostCategory] ?? c);

  // --- Planned: repeats -------------------------------------------------------
  const covered = new Set<string>(); // `${month}|${lineKey}` already planned by something exact
  for (const r of b.routines) {
    if (!r.active || (r.kind !== 'income' && r.kind !== 'expense') || !(Number(r.amount) > 0)) continue;
    const l = r.kind === 'income' ? incomeLine(String(r.category ?? 'other')) : costLine(String(r.category ?? 'other'));
    for (const on of dueDates(r, fy.start, fy.end)) { add(l, monthKey(on), 'planned', Number(r.amount), 'repeat'); covered.add(`${monthKey(on)}|${l.key}`); }
  }
  // --- Planned: loans (one line per loan) --------------------------------------
  const loanLines = new Map<string, PlanLine>();
  for (const loan of b.loans ?? []) {
    if (loan.archived || loan.kind === 'overdraft') continue;
    const l = line(`loan:${loan.id}`, 'out', 'loans', loan.lender);
    loanLines.set(loan.id, l);
    const k = knownBalance(loan, b.loanStatements ?? []);
    for (const x of projectRepayments(loan, fy.end, k)) {
      if (x.on < fy.start) continue;
      add(l, monthKey(x.on), 'planned', x.amount, 'loan');
    }
    covered.add(`*|out:loan_repayment`);
  }
  // --- Planned: scheme payments -----------------------------------------------
  for (const e of b.expected ?? []) {
    if (e.expected_on < fy.start || e.expected_on > fy.end) continue;
    const l = incomeLine('grant');
    add(l, monthKey(e.expected_on), 'planned', Number(e.amount_eur), 'scheme');
    covered.add(`${monthKey(e.expected_on)}|${l.key}`);
  }
  // --- Planned: the farmer's budget, where nothing exact covers it --------------
  for (const bl of b.budget) {
    const key = bl.kind === 'income' ? incomeKey(bl.category) : costKey(bl.category);
    const spread = bl.month === null || bl.month === undefined
      ? months.filter((m) => Number(m.slice(0, 4)) === bl.year).map((m) => ({ m, amount: Number(bl.amount_eur) / 12 }))
      : [{ m: `${bl.year}-${String(bl.month).padStart(2, '0')}`, amount: Number(bl.amount_eur) }];
    for (const { m, amount } of spread) {
      if (!months.includes(m) || covered.has(`${m}|${key}`) || (key === 'out:loan_repayment' && covered.has('*|out:loan_repayment'))) continue;
      const l = bl.kind === 'income' ? incomeLine(bl.category) : costLine(bl.category);
      add(l, m, 'planned', amount, 'budget');
    }
  }
  // --- Actual: what was recorded (cash basis) ----------------------------------
  for (const i of b.income) {
    if (i.occurred_on < fy.start || i.occurred_on > fy.end) continue;
    add(incomeLine(i.income_type), monthKey(i.occurred_on), 'actual', Number(i.amount_eur));
  }
  for (const c of b.costs) {
    const p = paidOn(c);
    if (!p || p < fy.start || p > fy.end) continue;
    const l = c.loan_id && loanLines.has(c.loan_id) ? loanLines.get(c.loan_id)! : costLine(c.category);
    add(l, monthKey(p), 'actual', Number(c.amount_eur));
  }
  // Bills still owed: still to go out, in the month they're due (overdue or undated: this month)
  const owed = b.costs.filter((c) => paidOn(c) === null);
  if (owed.length) {
    const l = line('out:owed', 'out', 'farm', 'Bills still to pay');
    for (const c of owed) {
      const due = c.due_on && c.due_on > today ? monthKey(c.due_on) : current;
      add(l, due, 'planned', Number(c.amount_eur), 'owed');
    }
  }

  const all = [...lines.values()];
  for (const l of all) {
    l.planned = Object.values(l.cells).reduce((s, c) => s + c.planned, 0);
    l.actual = Object.values(l.cells).reduce((s, c) => s + c.actual, 0);
  }
  const order: PlanLine['group'][] = ['receipts', 'farm', 'loans', 'capital', 'household'];
  const sorted = all.filter((l) => l.planned || l.actual).sort((a, c) => order.indexOf(a.group) - order.indexOf(c.group) || c.planned + c.actual - (a.planned + a.actual));

  // --- Months, and the bank carried forward -----------------------------------
  const pos = cashPosition(b.farm, b.income, b.costs, today);
  const toCome = (cell: PlanCell, m: string) => (m < current ? 0 : m === current ? Math.max(0, cell.planned - cell.actual) : cell.planned);
  // A later year starts from where the plan leaves the bank at the end of the year before
  let running: number | null = offset > 0 ? (yearPlan(b, today, offset - 1).months.at(-1)?.bank ?? null) : (pos?.balance ?? null);
  const monthRows: PlanMonth[] = months.map((m) => {
    const ins = sorted.filter((l) => l.kind === 'in');
    const outs = sorted.filter((l) => l.kind === 'out');
    const sum = (ls: PlanLine[], f: 'planned' | 'actual') => ls.reduce((s, l) => s + l.cells[m][f], 0);
    const status: PlanMonth['status'] = m < current ? 'past' : m === current ? 'now' : 'ahead';
    let bank: number | null = null;
    let bankBasis: PlanMonth['bankBasis'] = null;
    if (status === 'past') {
      const end = addDays(toISO(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1))), -1);
      const at = b.farm.opening_cash_date && b.farm.opening_cash_date <= addDays(end, 1) ? cashPosition(b.farm, b.income, b.costs, end) : null;
      if (at) { bank = at.balance; bankBasis = 'recorded'; }
    } else if (running !== null) {
      running += ins.reduce((s, l) => s + toCome(l.cells[m], m), 0) - outs.reduce((s, l) => s + toCome(l.cells[m], m), 0);
      bank = running; bankBasis = 'projected';
    }
    return { month: m, plannedIn: sum(ins, 'planned'), plannedOut: sum(outs, 'planned'), actualIn: sum(ins, 'actual'), actualOut: sum(outs, 'actual'), status, bank, bankBasis };
  });

  const ahead = monthRows.filter((r) => r.bankBasis === 'projected');
  const low = ahead.reduce<PlanMonth | null>((lo, r) => (!lo || (r.bank ?? 0) < (lo.bank ?? 0) ? r : lo), null);
  const limit = overdraftLimit(b.loans ?? []);
  const lowWarning = !low || low.bank === null || low.bank >= 0 ? null
    : limit > 0 && -low.bank > limit ? 'past_limit' as const : 'overdrawn' as const;
  const totals = {
    plannedIn: monthRows.reduce((s, r) => s + r.plannedIn, 0), plannedOut: monthRows.reduce((s, r) => s + r.plannedOut, 0),
    actualIn: monthRows.reduce((s, r) => s + r.actualIn, 0), actualOut: monthRows.reduce((s, r) => s + r.actualOut, 0)
  };
  // What the plan can't see yet, so a gap is never mistaken for a quiet month
  const gaps: { id: string; text: string; to: string; fix: string }[] = [];
  if (!pos) gaps.push({ id: 'bank', text: 'No bank balance yet, so there is no balance to carry forward.', to: '/forecast?tab=cash', fix: 'Add your bank balance' });
  if (!sorted.some((l) => l.kind === 'in' && l.planned > 0)) gaps.push({ id: 'income', text: 'No income planned: add milk, sales or scheme payments to the budget or set up your scheme payments.', to: '/money/budget', fix: 'Plan income' });
  if (!b.budget.length && !b.routines.some((r) => r.kind === 'expense' && Number(r.amount) > 0)) gaps.push({ id: 'costs', text: 'No costs planned beyond loans: feed, fertiliser, vet and the rest are missing.', to: '/money/budget', fix: 'Plan costs' });
  for (const loan of (b.loans ?? []).filter((l) => !l.archived && l.kind !== 'overdraft' && !l.repayment_eur)) {
    gaps.push({ id: `loan-${loan.id}`, text: `${loan.lender}: no repayment amount, so it isn't in the plan.`, to: `/money/loans/${loan.id}`, fix: 'Add the repayment' });
  }
  return { fy, months: monthRows, lines: sorted, totals, low, lowWarning, overdraft: limit, start: pos, gaps, ruleVersion: PLAN_RULE_VERSION };
}

/** Loans that are past their interest-only period or near the end: worth a word on the Loans screen. */
export function loanNotes(b: Pick<FarmBundle, 'loans' | 'costs' | 'loanStatements'>, today: ISODate) {
  const out: { loanId: string; text: string }[] = [];
  for (const l of b.loans ?? []) {
    if (l.archived) continue;
    if (l.interest_only_until && l.interest_only_until >= today && daysBetween(today, l.interest_only_until) <= 60) {
      out.push({ loanId: l.id, text: `Interest only ends ${l.interest_only_until}: ask ${l.lender} for the new repayment.` });
    }
    if (l.kind !== 'overdraft' && l.repayment_eur && balanceOn(l, b.costs, b.loanStatements ?? [], today) <= 0.005) {
      out.push({ loanId: l.id, text: `${l.lender} looks paid off. Archive it once the bank confirms.` });
    }
    if (l.next_due && l.next_due < addDays(today, -45) && !isRecorded(l, b.costs, l.next_due) && !b.costs.some((c) => c.loan_id === l.id)) {
      out.push({ loanId: l.id, text: `No ${l.lender} repayments recorded yet. Tick them off as they come out.` });
    }
  }
  return out;
}
