/**
 * Money (MVP spec section 6): Monitor, Analyse, Plan.
 * Cash flow, management profit and tax stay distinct. This module produces
 * management figures only. It never computes taxable profit.
 */
import type { BudgetLine, Cost, CostCategory, Farm, FarmBundle, ISODate, Income, IncomeType } from '../types';
import { COST_LABEL, INCOME_LABEL, NON_OPERATING } from '../types';
import { addDays, cur, daysBetween, eur, getCurrency, monthKey, toISO } from '../format';
import { owedBills, paidOn, payeeOf } from './bills';
import { dueDates } from '../routines';
import type { Routine } from '../types';

/** 1.1: cash moves when a bill is paid, not when it is incurred; owed bills are known future outflows. */
export const CASH_RULE_VERSION = 'cash-flow@1.1';

export function fyRange(farm: Pick<Farm, 'financial_year_start_month'>, today: ISODate, offset = 0) {
  const m = farm.financial_year_start_month;
  const [y, mm] = today.split('-').map(Number);
  let startYear = mm >= m ? y : y - 1;
  startYear += offset;
  const start = toISO(new Date(Date.UTC(startYear, m - 1, 1)));
  const end = addDays(toISO(new Date(Date.UTC(startYear + 1, m - 1, 1))), -1);
  const label = m === 1 ? String(startYear) : `${startYear}/${String(startYear + 1).slice(2)}`;
  return { start, end, label };
}

export function monthsBetween(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let [y, m] = startKey.split('-').map(Number);
  const [ey, em] = endKey.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export interface MonthFlow { month: string; inflow: number; outflow: number; net: number }

/** Money in and out by month. Cash basis: a cost counts in the month it was paid (owed bills not at all). */
export function monthlyFlows(income: Income[], costs: Cost[], months: string[]): MonthFlow[] {
  const map = new Map(months.map((m) => [m, { month: m, inflow: 0, outflow: 0, net: 0 }]));
  for (const i of income) { const r = map.get(monthKey(i.occurred_on)); if (r) r.inflow += Number(i.amount_eur); }
  for (const c of costs) { const p = paidOn(c); const r = p ? map.get(monthKey(p)) : undefined; if (r) r.outflow += Number(c.amount_eur); }
  for (const r of map.values()) r.net = r.inflow - r.outflow;
  return [...map.values()];
}

/** Opening cash + dated inflows − payments made, up to and including today. Owed bills are not cash yet. */
export function cashPosition(farm: Farm, income: Income[], costs: Cost[], today: ISODate) {
  if (farm.opening_cash_eur === null || !farm.opening_cash_date) return null;
  const from = farm.opening_cash_date;
  const inflow = income.filter((i) => i.occurred_on >= from && i.occurred_on <= today).reduce((s, i) => s + Number(i.amount_eur), 0);
  const outflow = costs.filter((c) => { const p = paidOn(c); return p !== null && p >= from && p <= today; }).reduce((s, c) => s + Number(c.amount_eur), 0);
  return { opening: Number(farm.opening_cash_eur), openingDate: from, inflow, outflow, balance: Number(farm.opening_cash_eur) + inflow - outflow };
}

export interface CashForecastMonth {
  month: string;
  knownIn: number;
  knownOut: number;
  /** Part of knownOut that is bills still owed (due in this month, or overdue / undated in the first month). */
  owedOut: number;
  /** Repeating income and bills the farmer set up (Routines), on their due days. */
  regularIn: number;
  regularOut: number;
  assumedIn: number;
  assumedOut: number;
  closing: number;
}

/**
 * 90-day view. "Known" = income entered with a future date, payments with a future paid date,
 * and bills still owed: on their due date, or in the first month when overdue or undated
 * (they have to be paid some time, so they are not left out).
 * "Assumed" = the farmer's own budget for months with no known entries of that kind.
 * The two are always reported separately (spec 10).
 */
export function cashForecast90(farm: Farm, income: Income[], costs: Cost[], budget: BudgetLine[], today: ISODate, scenario?: CashScenario, routines: Routine[] = []) {
  const pos = cashPosition(farm, income, costs, today);
  const end = addDays(today, 90);
  const months = monthsBetween(monthKey(today), monthKey(end));
  let running = pos?.balance ?? 0;
  const hasBudget = budget.length > 0;
  const owed = costs.filter((c) => paidOn(c) === null);
  const owedWhen = (c: Cost) => (c.due_on && c.due_on > today ? c.due_on : addDays(today, 1));
  const sc = scenario ?? { incomePct: 0, costPct: 0, oneOffEur: 0, oneOffOn: null };
  // Repeats with an amount: each due day in the window (review G02: a complete forecast needs recurring items)
  const repeats = routines.filter((r) => r.active && (r.kind === 'income' || r.kind === 'expense') && Number(r.amount) > 0)
    .flatMap((r) => dueDates(r, addDays(today, 1), end).map((on) => ({ kind: r.kind, category: r.category, on, amount: Number(r.amount) })));
  const rows: CashForecastMonth[] = months.map((m) => {
    const inRange = (d: ISODate) => monthKey(d) === m && d > today && d <= end;
    const knownIn = income.filter((i) => inRange(i.occurred_on)).reduce((s, i) => s + Number(i.amount_eur), 0) * (1 + sc.incomePct / 100);
    const owedOut = owed.filter((c) => inRange(owedWhen(c))).reduce((s, c) => s + Number(c.amount_eur), 0);
    const scheduled = costs.filter((c) => { const p = paidOn(c); return p !== null && inRange(p); }).reduce((s, c) => s + Number(c.amount_eur), 0);
    const oneOff = sc.oneOffEur && sc.oneOffOn && inRange(sc.oneOffOn) ? sc.oneOffEur : 0;
    const knownOut = (scheduled + owedOut) * (1 + sc.costPct / 100) + oneOff;
    const rep = repeats.filter((x) => monthKey(x.on) === m);
    const regularIn = rep.filter((x) => x.kind === 'income').reduce((t, x) => t + x.amount, 0) * (1 + sc.incomePct / 100);
    const regularOut = rep.filter((x) => x.kind === 'expense').reduce((t, x) => t + x.amount, 0) * (1 + sc.costPct / 100);
    // A budget line for something a repeat already covers this month is not counted twice
    const covered = new Set(rep.map((x) => `${x.kind === 'income' ? 'income' : 'cost'}:${x.category}`));
    const [y, mm] = m.split('-').map(Number);
    const monthLines = budget.filter((b) => b.year === y && b.month === mm && !covered.has(`${b.kind}:${b.category}`));
    // Pro-rate the current and final partial months by the days remaining in-window
    const monthStart = `${m}-01`;
    const monthEnd = addDays(toISO(new Date(Date.UTC(y, mm, 1))), -1);
    const windowStart = monthStart > today ? monthStart : addDays(today, 1);
    const windowEnd = monthEnd < end ? monthEnd : end;
    const frac = Math.max(0, daysBetween(windowStart, windowEnd) + 1) / (daysBetween(monthStart, monthEnd) + 1);
    // Owed bills don't stand in for the budget: they are last month's spending, not this month's
    const assumedIn = knownIn > 0 ? 0 : monthLines.filter((b) => b.kind === 'income').reduce((s, b) => s + Number(b.amount_eur), 0) * frac * (1 + sc.incomePct / 100);
    const assumedOut = scheduled > 0 ? 0 : monthLines.filter((b) => b.kind === 'cost').reduce((s, b) => s + Number(b.amount_eur), 0) * frac * (1 + sc.costPct / 100);
    running += knownIn - knownOut + regularIn - regularOut + assumedIn - assumedOut;
    return { month: m, knownIn, knownOut, owedOut, regularIn, regularOut, assumedIn, assumedOut, closing: running };
  });
  // Only report a low point if the balance actually dips below where it is today
  const minRow = rows.reduce<CashForecastMonth | null>((lo, r) => (!lo || r.closing < lo.closing ? r : lo), null);
  const lowest = minRow && pos && minRow.closing < pos.balance ? minRow : null;
  const isScenario = !!scenario && (sc.incomePct !== 0 || sc.costPct !== 0 || !!sc.oneOffEur);
  return { start: pos, rows, lowest, hasBudget, ruleVersion: CASH_RULE_VERSION, scenario: isScenario ? sc : null };
}

/** "What if" on the cash forecast. Always labelled as a scenario, never as the forecast. */
export interface CashScenario {
  /** Change every known and budgeted income by this %, e.g. -10 for a milk price drop. */
  incomePct: number;
  /** Change every known and budgeted cost by this %. */
  costPct: number;
  /** A one-off spend (a machine, a shed) on a date. */
  oneOffEur: number;
  oneOffOn: ISODate | null;
}

export interface VarianceRow {
  kind: 'income' | 'cost';
  category: string;
  label: string;
  budget: number;
  actual: number;
  variance: number; // actual - budget (for costs, positive = overspend)
  /** Completed months only (what alerts use): fair to lumpy bills that land early in a month. */
  closed: { budget: number; actual: number; variance: number };
  /** The month in progress, shown separately. */
  thisMonth: { budget: number; actual: number };
}

/**
 * Budget vs actual for the months elapsed in the FY. `adequate` is false when
 * too many elapsed months have no records at all: then we show numbers but no alerts.
 */
export function budgetVsActual(farm: Farm, bundle: Pick<FarmBundle, 'budget' | 'income' | 'costs'>, today: ISODate) {
  const fy = fyRange(farm, today);
  const months = monthsBetween(monthKey(fy.start), monthKey(today));
  const inMonths = (d: ISODate) => d >= fy.start && d <= today;
  const ymSet = new Set(months.map((m) => m.split('-').map(Number).join('-')));
  const current = monthKey(today);
  const budgetFor = (kind: string, cat: string, only?: (m: string) => boolean) =>
    bundle.budget.filter((b) => b.kind === kind && b.category === cat && b.month !== null && ymSet.has(`${b.year}-${b.month}`))
      .filter((b) => !only || only(`${b.year}-${String(b.month).padStart(2, '0')}`))
      .reduce((s, b) => s + Number(b.amount_eur), 0);
  const actualFor = (kind: string, cat: string, only?: (m: string) => boolean) => (kind === 'income'
    ? bundle.income.filter((i) => i.income_type === cat && inMonths(i.occurred_on) && (!only || only(monthKey(i.occurred_on)))).reduce((s, i) => s + Number(i.amount_eur), 0)
    : bundle.costs.filter((c) => c.category === cat && inMonths(c.occurred_on) && (!only || only(monthKey(c.occurred_on)))).reduce((s, c) => s + Number(c.amount_eur), 0));

  const cats = new Set(bundle.budget.map((b) => `${b.kind}:${b.category}`));
  const closedOnly = (m: string) => m < current;
  const currentOnly = (m: string) => m === current;
  const rows: VarianceRow[] = [...cats].map((key) => {
    const [kind, category] = key.split(':') as ['income' | 'cost', string];
    const actual = actualFor(kind, category);
    const b = budgetFor(kind, category);
    const cb = budgetFor(kind, category, closedOnly);
    const ca = actualFor(kind, category, closedOnly);
    const label = kind === 'income' ? INCOME_LABEL[category as IncomeType] ?? category : COST_LABEL[category as CostCategory] ?? category;
    return {
      kind, category, label, budget: b, actual, variance: actual - b,
      closed: { budget: cb, actual: ca, variance: ca - cb },
      thisMonth: { budget: budgetFor(kind, category, currentOnly), actual: actualFor(kind, category, currentOnly) }
    };
  });

  const monthsWithData = new Set([
    ...bundle.income.filter((i) => inMonths(i.occurred_on)).map((i) => monthKey(i.occurred_on)),
    ...bundle.costs.filter((c) => inMonths(c.occurred_on)).map((c) => monthKey(c.occurred_on))
  ]);
  const completedMonths = Math.max(1, months.length - 1); // current month is still in progress
  const coverage = monthsWithData.size / completedMonths;
  return { fy, rows, coverage, adequate: coverage >= 0.75, monthsElapsed: months.length, lastClosedMonth: months.length > 1 ? months.at(-2)! : null };
}

/** Variance alert thresholds: big enough to matter on a family farm, small enough to be early. */
export const BUDGET_ALERT = { ytdPct: 10, ytdMinEur: 250, incomeMinEur: 500, monthPct: 10, monthMinEur: 250, lastMonthPct: 25 } as const;

export interface BudgetAlert {
  id: string;
  kind: 'income' | 'cost';
  category: string;
  label: string;
  tone: 'warn' | 'info';
  scope: 'year' | 'this_month' | 'last_month';
  title: string;
  detail: string;
  amount: number; // € over (costs) or behind (income)
}

/**
 * Budget variance alerts (spec P1). Only raised when enough months have records
 * (`budgetVsActual().adequate`), so a farmer who hasn't entered much yet isn't nagged.
 *
 * - Year so far: completed months only, because one bill early in a month would otherwise
 *   look like an overspend against a pro-rated budget. Costs over by 10% and €250, or
 *   income behind by 10% and €500.
 * - This month: a cost category already over its whole monthly budget (10% and €250).
 * - Last month: a cost category that ran 25% over its monthly budget, when the year as a
 *   whole is still on track (a quieter, information-only note).
 * One alert per category, the most important first. Figures are the farmer's own budget
 * and records: nothing here is a benchmark or a recommendation.
 */
export function budgetAlerts(farm: Farm, bundle: Pick<FarmBundle, 'budget' | 'income' | 'costs'>, today: ISODate): BudgetAlert[] {
  const bva = budgetVsActual(farm, bundle, today);
  if (!bva.adequate) return [];
  const fy = bva.fy;
  const thisMonth = monthKey(today);
  const months = monthsBetween(monthKey(fy.start), thisMonth);
  const completed = months.slice(0, -1);
  const lastMonth = completed.at(-1) ?? null;
  const ym = (m: string) => m.split('-').map(Number) as [number, number];
  const budgetIn = (kind: string, cat: string, ms: string[]) => {
    const set = new Set(ms.map((m) => ym(m).join('-')));
    return bundle.budget.filter((b) => b.kind === kind && b.category === cat && b.month !== null && set.has(`${b.year}-${b.month}`)).reduce((s, b) => s + Number(b.amount_eur), 0);
  };
  const actualIn = (kind: string, cat: string, ms: string[]) => {
    const set = new Set(ms);
    return kind === 'income'
      ? bundle.income.filter((i) => i.income_type === cat && i.occurred_on >= fy.start && i.occurred_on <= today && set.has(monthKey(i.occurred_on))).reduce((s, i) => s + Number(i.amount_eur), 0)
      : bundle.costs.filter((c) => c.category === cat && c.occurred_on >= fy.start && c.occurred_on <= today && set.has(monthKey(c.occurred_on))).reduce((s, c) => s + Number(c.amount_eur), 0);
  };
  const monthName = (m: string) => new Intl.DateTimeFormat('en-IE', { month: 'long', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  const money = (n: number) => eur(n);

  const out: BudgetAlert[] = [];
  for (const r of bva.rows) {
    const base = { id: `budget-${r.kind}-${r.category}`, kind: r.kind, category: r.category, label: r.label };
    const yb = budgetIn(r.kind, r.category, completed);
    const ya = actualIn(r.kind, r.category, completed);
    if (r.kind === 'cost') {
      const over = ya - yb;
      if (yb > 0 && over >= BUDGET_ALERT.ytdMinEur && (over / yb) * 100 >= BUDGET_ALERT.ytdPct) {
        out.push({ ...base, tone: 'warn', scope: 'year', amount: over, title: `${r.label} is over budget`,
          detail: `${money(over)} over (${Math.round((over / yb) * 100)}%) to the end of ${monthName(lastMonth!)}` });
        continue;
      }
      const mb = budgetIn(r.kind, r.category, [thisMonth]);
      const ma = actualIn(r.kind, r.category, [thisMonth]);
      if (mb > 0 && ma - mb >= BUDGET_ALERT.monthMinEur && ((ma - mb) / mb) * 100 >= BUDGET_ALERT.monthPct) {
        out.push({ ...base, tone: 'warn', scope: 'this_month', amount: ma - mb, title: `${r.label}: this month's budget is used up`,
          detail: `${money(ma)} spent in ${monthName(thisMonth)} against ${money(mb)} planned` });
        continue;
      }
      if (lastMonth) {
        const lb = budgetIn(r.kind, r.category, [lastMonth]);
        const la = actualIn(r.kind, r.category, [lastMonth]);
        if (lb > 0 && la - lb >= BUDGET_ALERT.monthMinEur && ((la - lb) / lb) * 100 >= BUDGET_ALERT.lastMonthPct) {
          out.push({ ...base, tone: 'info', scope: 'last_month', amount: la - lb, title: `${r.label} ran over in ${monthName(lastMonth)}`,
            detail: `${money(la)} against ${money(lb)} planned. The year so far is still within budget.` });
        }
      }
    } else {
      const behind = yb - ya;
      if (yb > 0 && behind >= BUDGET_ALERT.incomeMinEur && (behind / yb) * 100 >= BUDGET_ALERT.ytdPct) {
        out.push({ ...base, tone: 'warn', scope: 'year', amount: behind, title: `${r.label} is behind budget`,
          detail: `${money(behind)} behind (${Math.round((behind / yb) * 100)}%) to the end of ${monthName(lastMonth!)}` });
      }
    }
  }
  const rank = { year: 0, this_month: 1, last_month: 2 } as const;
  return out.sort((a, c) => (a.tone === c.tone ? 0 : a.tone === 'warn' ? -1 : 1) || rank[a.scope] - rank[c.scope] || c.amount - a.amount);
}

export interface MissingItem { id: string; text: string; fix: string; to: string }

/** One line of the accountant's transaction list. */
export interface LedgerRow {
  date: ISODate;
  kind: 'income' | 'cost';
  category: string;
  description: string;
  counterparty: string;
  amount: number;
  vat: number | null;
  invoiceRef: string | null;
  /** Costs: paid date, or null when still owed. Income: the date received. */
  paidOn: ISODate | null;
  dueOn: ISODate | null;
  enterprise: string | null;
  documentId: string | null;
  documentFile: string | null;
  recordId: string;
}

/** Management year-end pack (spec 6). Deliberately not statutory accounts or a tax computation. */
export function yearEndPack(bundle: FarmBundle, today: ISODate, offset = 0) {
  const fy = fyRange(bundle.farm, today, offset);
  const inFy = (d: ISODate) => d >= fy.start && d <= fy.end;
  const income = bundle.income.filter((i) => inFy(i.occurred_on));
  const allCosts = bundle.costs.filter((c) => inFy(c.occurred_on));
  const costs = allCosts.filter((c) => !NON_OPERATING.includes(c.category));
  const nonOperating = allCosts.filter((c) => NON_OPERATING.includes(c.category));

  const incomeByType = Object.entries(
    income.reduce<Record<string, number>>((a, i) => ({ ...a, [i.income_type]: (a[i.income_type] ?? 0) + Number(i.amount_eur) }), {})
  ).map(([k, v]) => ({ key: k, label: INCOME_LABEL[k as IncomeType], total: v })).sort((a, b) => b.total - a.total);
  const byCategory = (list: Cost[]) => Object.entries(
    list.reduce<Record<string, number>>((a, c) => ({ ...a, [c.category]: (a[c.category] ?? 0) + Number(c.amount_eur) }), {})
  ).map(([k, v]) => ({ key: k, label: COST_LABEL[k as CostCategory] ?? k, total: v })).sort((a, b) => b.total - a.total);
  const costsByCategory = byCategory(costs);
  const nonOperatingByCategory = byCategory(nonOperating);
  const supplierTotals = Object.entries(
    allCosts.reduce<Record<string, number>>((a, c) => {
      const name = payeeOf(c, bundle);
      return { ...a, [name]: (a[name] ?? 0) + Number(c.amount_eur) };
    }, {})
  ).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);

  const totalIncome = income.reduce((s, i) => s + Number(i.amount_eur), 0);
  const totalCosts = costs.reduce((s, c) => s + Number(c.amount_eur), 0);
  const totalNonOperating = nonOperating.reduce((s, c) => s + Number(c.amount_eur), 0);
  const totalVat = allCosts.reduce((s, c) => s + Number(c.vat_eur ?? 0), 0);
  const lastMonth = monthKey(today < fy.end ? today : fy.end);
  const months = monthsBetween(monthKey(fy.start), lastMonth);
  // Cash by month: costs in the month they were paid, whichever year they were incurred
  const paidInFy = bundle.costs.filter((c) => { const p = paidOn(c); return p !== null && inFy(p); });
  const flows = monthlyFlows(income, paidInFy, months);
  const paidOut = paidInFy.reduce((s, c) => s + Number(c.amount_eur), 0);
  // Owed at the end of the year (or today, for the year in progress): incurred in the year, not paid by then
  const cutoff = today < fy.end ? today : fy.end;
  const owedAtEnd = allCosts.filter((c) => { const p = paidOn(c); return p === null || p > cutoff; });
  const owedAtEndTotal = owedAtEnd.reduce((s, c) => s + Number(c.amount_eur), 0);
  const milkLitres = income.filter((i) => i.income_type === 'milk').reduce((s, i) => s + Number(i.milk_litres ?? 0), 0);
  const livestockHead = income.filter((i) => i.income_type === 'livestock').reduce((s, i) => s + Number(i.head_count ?? 0), 0);

  // Per enterprise: only when the farmer tagged something, so a single-enterprise farm sees nothing new
  const ent = (e: string | null | undefined) => e ?? 'whole_farm';
  const tagged = [...income, ...costs].some((r) => r.enterprise);
  const enterprises = tagged ? [...new Set([...income.map((i) => ent(i.enterprise)), ...costs.map((c) => ent(c.enterprise))])].map((k) => {
    const inc = income.filter((i) => ent(i.enterprise) === k).reduce((s, i) => s + Number(i.amount_eur), 0);
    const out = costs.filter((c) => ent(c.enterprise) === k).reduce((s, c) => s + Number(c.amount_eur), 0);
    return { key: k, income: inc, costs: out, margin: inc - out };
  }).sort((a, b) => (a.key === 'whole_farm' ? 1 : b.key === 'whole_farm' ? -1 : b.income - a.income)) : [];

  const docName = (id: string | null) => (id ? bundle.documents.find((d) => d.id === id)?.file_name ?? `${id}` : null);
  const ledger: LedgerRow[] = [
    ...income.map((i) => ({
      date: i.occurred_on, kind: 'income' as const, category: INCOME_LABEL[i.income_type] ?? i.income_type, description: i.description ?? '',
      counterparty: i.counterparty ?? '', amount: Number(i.amount_eur), vat: null, invoiceRef: null, paidOn: i.occurred_on, dueOn: null,
      enterprise: i.enterprise ?? null, documentId: i.document_id, documentFile: docName(i.document_id), recordId: i.id
    })),
    ...allCosts.map((c) => ({
      date: c.occurred_on, kind: 'cost' as const, category: COST_LABEL[c.category] ?? c.category,
      description: c.category === 'other' && c.other_label ? `${c.other_label}${c.description ? `. ${c.description}` : ''}` : c.description ?? '',
      counterparty: payeeOf(c, bundle), amount: Number(c.amount_eur), vat: c.vat_eur ?? null, invoiceRef: c.invoice_ref ?? null,
      paidOn: paidOn(c), dueOn: c.due_on ?? null, enterprise: c.enterprise ?? null, documentId: c.document_id, documentFile: docName(c.document_id), recordId: c.id
    }))
  ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  // Missing-data checklist for the accountant/advisor
  const missing: MissingItem[] = [];
  const f = bundle.farm;
  const types = f.enterprises ?? [];
  if (f.opening_cash_eur === null) missing.push({ id: 'cash', text: 'Opening bank balance not set', fix: 'Add opening cash', to: '/settings' });
  if (types.includes('dairy') || f.enterprise === 'dairy' || f.enterprise === 'mixed') {
    const milkMonths = new Set(income.filter((i) => i.income_type === 'milk').map((i) => monthKey(i.occurred_on)));
    const closed = months.slice(0, -1);
    const gaps = closed.filter((m) => !milkMonths.has(m));
    if (gaps.length) missing.push({ id: 'milk', text: `No milk cheque recorded for ${gaps.length} month${gaps.length > 1 ? 's' : ''}`, fix: 'Add milk sale', to: '/record/milk' });
  }
  const unpriced = bundle.txns.filter((t) => t.txn_type === 'delivery' && inFy(t.effective_on) && t.total_price_eur === null);
  if (unpriced.length) missing.push({ id: 'feedprice', text: `${unpriced.length} feed deliver${unpriced.length > 1 ? 'ies have' : 'y has'} no price`, fix: 'Match an invoice', to: '/record/invoice' });
  const noInvoice = allCosts.filter((c) => c.category === 'feed' && c.feed_transaction_id && !c.invoice_ref && daysBetween(c.occurred_on, cutoff) > 40);
  if (noInvoice.length) missing.push({ id: 'feedinvoice', text: `${noInvoice.length} feed deliver${noInvoice.length > 1 ? 'ies' : 'y'} not matched to an invoice`, fix: 'Match invoices', to: '/record/invoice' });
  const noEvidence = allCosts.filter((c) => !c.document_id && Number(c.amount_eur) >= 500);
  if (noEvidence.length) missing.push({ id: 'evidence', text: `${noEvidence.length} cost${noEvidence.length > 1 ? 's' : ''} over ${cur()}500 without an invoice attached`, fix: 'Attach invoices', to: '/records' });
  const unconfirmed = bundle.documents.filter((d) => d.state === 'unconfirmed');
  if (unconfirmed.length) missing.push({ id: 'docs', text: `${unconfirmed.length} document${unconfirmed.length > 1 ? 's' : ''} waiting for you to confirm`, fix: 'Confirm documents', to: '/records' });
  const undatedOwed = owedBills(bundle, today).filter((o) => !o.dueOn && inFy(o.cost.occurred_on));
  if (undatedOwed.length) missing.push({ id: 'owed', text: `${undatedOwed.length} bill${undatedOwed.length > 1 ? 's' : ''} still owed with no due date`, fix: 'Review bills', to: '/money/bills' });
  const costCats = new Set(costs.map((c) => c.category));
  (['fertiliser', 'contractor', 'vet_medicine'] as CostCategory[]).forEach((c) => {
    if (!costCats.has(c)) missing.push({ id: `cat-${c}`, text: `No ${COST_LABEL[c].toLowerCase()} costs this year`, fix: 'Add cost', to: `/record/cost?category=${c}` });
  });

  return {
    fy, totalIncome, totalCosts, net: totalIncome - totalCosts, incomeByType, costsByCategory, nonOperatingByCategory, totalNonOperating,
    totalVat, paidOut, owedAtEndTotal, owedAtEndCount: owedAtEnd.length, enterprises,
    supplierTotals, flows, milkLitres, livestockHead, missing, ledger
  };
}

const csvRow = (r: (string | number | null)[]) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');

export function yearEndCsv(pack: ReturnType<typeof yearEndPack>, farmName: string): string {
  const c = cur();
  const rows: (string | number)[][] = [
    ['Agri-It management summary (not statutory accounts or a tax computation)'],
    ['Farm', farmName], ['Financial year', `${pack.fy.start} to ${pack.fy.end}`], ['Currency', getCurrency()], [],
    ['Income', `Total ${c}`], ...pack.incomeByType.map((r) => [r.label, r.total.toFixed(2)]),
    ['Total income', pack.totalIncome.toFixed(2)], [],
    ['Running costs (by date incurred)', `Total ${c}`], ...pack.costsByCategory.map((r) => [r.label, r.total.toFixed(2)]),
    ['Total running costs', pack.totalCosts.toFixed(2)], [],
    ['Income less running costs', pack.net.toFixed(2)], [],
    ...(pack.nonOperatingByCategory.length ? [['Loans and capital (not running costs)', `Total ${c}`], ...pack.nonOperatingByCategory.map((r) => [r.label, r.total.toFixed(2)]), []] : []),
    ['Paid out in the year (cash)', pack.paidOut.toFixed(2)],
    ['Still owed at the end of the year', pack.owedAtEndTotal.toFixed(2)],
    ['VAT on recorded invoices', pack.totalVat.toFixed(2)], [],
    ['Month', `In ${c}`, `Paid out ${c}`, `Net ${c}`], ...pack.flows.map((f) => [f.month, f.inflow.toFixed(2), f.outflow.toFixed(2), f.net.toFixed(2)]), [],
    ['Supplier', `Total ${c}`], ...pack.supplierTotals.map((s) => [s.name, s.total.toFixed(2)]), [],
    ...(pack.enterprises.length ? [['Enterprise', `Income ${c}`, `Running costs ${c}`, `Margin ${c}`], ...pack.enterprises.map((e) => [e.key, e.income.toFixed(2), e.costs.toFixed(2), e.margin.toFixed(2)]), []] : []),
    ['Missing data'], ...pack.missing.map((m) => [m.text])
  ];
  return rows.map(csvRow).join('\n');
}

/** Every income and cost in the year, one line each, with its paperwork. Sums match the summary. */
export function ledgerCsv(pack: ReturnType<typeof yearEndPack>): string {
  const c = cur();
  const head = ['Date', 'In or out', 'Category', 'Description', 'Paid to / received from', `Amount ${c}`, `VAT ${c}`, 'Invoice no.', 'Paid on', 'Due on', 'Status', 'Enterprise', 'Attachment', 'Agri-It id'];
  const lines = pack.ledger.map((r) => [
    r.date, r.kind === 'income' ? 'In' : 'Out', r.category, r.description, r.counterparty, r.amount.toFixed(2), r.vat === null ? '' : r.vat.toFixed(2),
    r.invoiceRef ?? '', r.paidOn ?? '', r.dueOn ?? '', r.kind === 'income' ? 'Received' : r.paidOn ? 'Paid' : 'Owed',
    r.enterprise ?? '', r.documentFile ? `attachments/${r.documentFile}` : '', r.recordId
  ]);
  const totalIn = pack.ledger.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0);
  const totalOut = pack.ledger.filter((r) => r.kind === 'cost').reduce((s, r) => s + r.amount, 0);
  return [head, ...lines, [], ['', 'Total in', '', '', '', totalIn.toFixed(2)], ['', 'Total out', '', '', '', totalOut.toFixed(2)]].map(csvRow).join('\n');
}

// ---------------------------------------------------------------------------
// How complete is the cash picture? (advisory review G02, gate G7)
// Recorded cash is the farmer's bank balance on a date plus what they have recorded
// since. It is not a bank balance. Say when it was last checked against the bank and
// what the 90-day forecast cannot know about, so a gap is never mistaken for money.
// ---------------------------------------------------------------------------
export interface CashGap { id: string; text: string; fix: string; to: string }
export interface CashCompleteness {
  /** The day the balance was last taken from the bank, or null if never. */
  checkedOn: ISODate | null;
  daysSinceCheck: number | null;
  /** More than 30 days since the bank balance was checked. */
  stale: boolean;
  /** Things the forecast leaves out, most important first. Empty = nothing obvious missing. */
  gaps: CashGap[];
}
const STALE_DAYS = 30;

export function cashCompleteness(farm: Farm, bundle: Pick<FarmBundle, 'income' | 'costs' | 'budget' | 'routines'>, today: ISODate): CashCompleteness {
  const checkedOn = farm.opening_cash_eur !== null && farm.opening_cash_date ? farm.opening_cash_date : null;
  // A balance taken "now" is stored as the start of tomorrow (see reconcileCash), so it counts as checked today
  const daysSinceCheck = checkedOn ? Math.max(0, daysBetween(checkedOn, today)) : null;
  const stale = daysSinceCheck !== null && daysSinceCheck > STALE_DAYS;
  const gaps: CashGap[] = [];
  if (!checkedOn) gaps.push({ id: 'no-balance', text: 'No bank balance entered, so there is no cash figure yet.', fix: 'Check against the bank', to: '/forecast?tab=cash' });
  else if (stale) gaps.push({ id: 'stale', text: `Last checked against the bank ${daysSinceCheck} days ago. Anything not recorded since is missing.`, fix: 'Check against the bank', to: '/forecast?tab=cash' });

  const end = addDays(today, 90);
  const hasBudget = bundle.budget.length > 0;
  if (!hasBudget) gaps.push({ id: 'no-budget', text: 'No budget, so regular income and bills you have not entered yet (milk, wages, fertiliser) are not in the forecast.', fix: 'Add a budget', to: '/money/budget' });

  // Money that came in or went out regularly in the last 90 days, with nothing expected in the next 90
  const since = addDays(today, -90);
  const expectedIncome = new Set<string>([
    ...bundle.income.filter((i) => i.occurred_on > today && i.occurred_on <= end).map((i) => i.income_type),
    ...bundle.budget.filter((l) => l.kind === 'income' && budgetInWindow(l, today, end)).map((l) => l.category),
    ...(bundle.routines ?? []).filter((r) => r.active && r.kind === 'income' && r.category).map((r) => String(r.category))
  ]);
  const expectedCost = new Set<string>([
    ...bundle.costs.filter((c) => { const p = paidOn(c); return (p === null) || (p > today && p <= end); }).map((c) => c.category),
    ...bundle.budget.filter((l) => l.kind === 'cost' && budgetInWindow(l, today, end)).map((l) => l.category),
    ...(bundle.routines ?? []).filter((r) => r.active && r.kind === 'expense' && r.category).map((r) => String(r.category))
  ]);
  const regular = <T extends string>(rows: { key: T; on: ISODate; amount: number }[]) => {
    const by = new Map<T, { n: number; total: number; months: Set<string> }>();
    for (const r of rows) {
      if (r.on < since || r.on > today) continue;
      const x = by.get(r.key) ?? { n: 0, total: 0, months: new Set<string>() };
      x.n++; x.total += r.amount; x.months.add(monthKey(r.on));
      by.set(r.key, x);
    }
    // At least two months out of the last three: it is a regular item
    return [...by.entries()].filter(([, x]) => x.months.size >= 2).sort((a, b) => b[1].total - a[1].total);
  };
  for (const [type, x] of regular(bundle.income.map((i) => ({ key: i.income_type, on: i.occurred_on, amount: Number(i.amount_eur) })))) {
    if (expectedIncome.has(type)) continue;
    gaps.push({ id: `income-${type}`, text: `${INCOME_LABEL[type]} came in ${x.n} times in the last 3 months (${eur(x.total)}), but none is expected in the next 90 days.`, fix: 'Add to the budget', to: '/money/budget' });
  }
  const regularCosts = regular(bundle.costs.filter((c) => !NON_OPERATING.includes(c.category) || c.category === 'loan_repayment')
    .map((c) => ({ key: c.category, on: c.occurred_on, amount: Number(c.amount_eur) })))
    .filter(([cat]) => !expectedCost.has(cat)).slice(0, 3);
  for (const [cat, x] of regularCosts) {
    gaps.push({ id: `cost-${cat}`, text: `${COST_LABEL[cat]} bills came ${x.n} times in the last 3 months (${eur(x.total)}), but none are expected in the next 90 days.`, fix: 'Add to the budget', to: '/money/budget' });
  }
  const undated = bundle.costs.filter((c) => paidOn(c) === null && !c.due_on);
  if (undated.length) gaps.push({ id: 'undated', text: `${undated.length} bill${undated.length > 1 ? 's' : ''} owed with no due date, counted as paid tomorrow.`, fix: 'Add due dates', to: '/money/bills' });
  return { checkedOn, daysSinceCheck, stale, gaps };
}
function budgetInWindow(l: BudgetLine, today: ISODate, end: ISODate): boolean {
  if (l.month === null || l.month === undefined) return false; // annual lines are not in the 90-day forecast
  const key = `${l.year}-${String(l.month).padStart(2, '0')}`;
  return key >= monthKey(today) && key <= monthKey(end);
}

/**
 * Check against the bank: the farmer reads the balance their bank shows now. It is kept as the
 * balance at the end of today, so anything already recorded for today is taken as in it, and
 * only what is recorded from tomorrow on is added. Returns the new opening date and how far the
 * recorded figure was out (bank − recorded): positive = more in the bank than recorded.
 */
export function reconcileCash(recordedBalance: number | null, bankBalance: number, today: ISODate) {
  return { opening_cash_eur: bankBalance, opening_cash_date: addDays(today, 1), difference: recordedBalance === null ? null : bankBalance - recordedBalance };
}
