/**
 * Money (MVP spec section 6): Monitor, Analyse, Plan.
 * Cash flow, management profit and tax stay distinct. This module produces
 * management figures only. It never computes taxable profit.
 */
import type { BudgetLine, Cost, CostCategory, Farm, FarmBundle, ISODate, Income, IncomeType } from '../types';
import { COST_LABEL, INCOME_LABEL } from '../types';
import { addDays, daysBetween, monthKey, toISO } from '../format';

export const CASH_RULE_VERSION = 'cash-flow@1.0';

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

export function monthlyFlows(income: Income[], costs: Cost[], months: string[]): MonthFlow[] {
  const map = new Map(months.map((m) => [m, { month: m, inflow: 0, outflow: 0, net: 0 }]));
  for (const i of income) { const r = map.get(monthKey(i.occurred_on)); if (r) r.inflow += Number(i.amount_eur); }
  for (const c of costs) { const r = map.get(monthKey(c.occurred_on)); if (r) r.outflow += Number(c.amount_eur); }
  for (const r of map.values()) r.net = r.inflow - r.outflow;
  return [...map.values()];
}

/** Opening cash + dated inflows − dated outflows up to and including today. */
export function cashPosition(farm: Farm, income: Income[], costs: Cost[], today: ISODate) {
  if (farm.opening_cash_eur === null || !farm.opening_cash_date) return null;
  const from = farm.opening_cash_date;
  const inflow = income.filter((i) => i.occurred_on >= from && i.occurred_on <= today).reduce((s, i) => s + Number(i.amount_eur), 0);
  const outflow = costs.filter((c) => c.occurred_on >= from && c.occurred_on <= today).reduce((s, c) => s + Number(c.amount_eur), 0);
  return { opening: Number(farm.opening_cash_eur), openingDate: from, inflow, outflow, balance: Number(farm.opening_cash_eur) + inflow - outflow };
}

export interface CashForecastMonth {
  month: string;
  knownIn: number;
  knownOut: number;
  assumedIn: number;
  assumedOut: number;
  closing: number;
}

/**
 * 90-day view. "Known" = transactions already entered with a future date.
 * "Assumed" = the farmer's own budget for months with no known entries of that kind.
 * The two are always reported separately (spec 10).
 */
export function cashForecast90(farm: Farm, income: Income[], costs: Cost[], budget: BudgetLine[], today: ISODate) {
  const pos = cashPosition(farm, income, costs, today);
  const end = addDays(today, 90);
  const months = monthsBetween(monthKey(today), monthKey(end));
  let running = pos?.balance ?? 0;
  const hasBudget = budget.length > 0;
  const rows: CashForecastMonth[] = months.map((m) => {
    const inRange = (d: ISODate) => monthKey(d) === m && d > today && d <= end;
    const knownIn = income.filter((i) => inRange(i.occurred_on)).reduce((s, i) => s + Number(i.amount_eur), 0);
    const knownOut = costs.filter((c) => inRange(c.occurred_on)).reduce((s, c) => s + Number(c.amount_eur), 0);
    const [y, mm] = m.split('-').map(Number);
    const monthLines = budget.filter((b) => b.year === y && b.month === mm);
    // Pro-rate the current and final partial months by the days remaining in-window
    const monthStart = `${m}-01`;
    const monthEnd = addDays(toISO(new Date(Date.UTC(y, mm, 1))), -1);
    const windowStart = monthStart > today ? monthStart : addDays(today, 1);
    const windowEnd = monthEnd < end ? monthEnd : end;
    const frac = Math.max(0, daysBetween(windowStart, windowEnd) + 1) / (daysBetween(monthStart, monthEnd) + 1);
    const assumedIn = knownIn > 0 ? 0 : monthLines.filter((b) => b.kind === 'income').reduce((s, b) => s + Number(b.amount_eur), 0) * frac;
    const assumedOut = knownOut > 0 ? 0 : monthLines.filter((b) => b.kind === 'cost').reduce((s, b) => s + Number(b.amount_eur), 0) * frac;
    running += knownIn - knownOut + assumedIn - assumedOut;
    return { month: m, knownIn, knownOut, assumedIn, assumedOut, closing: running };
  });
  // Only report a low point if the balance actually dips below where it is today
  const minRow = rows.reduce<CashForecastMonth | null>((lo, r) => (!lo || r.closing < lo.closing ? r : lo), null);
  const lowest = minRow && pos && minRow.closing < pos.balance ? minRow : null;
  return { start: pos, rows, lowest, hasBudget, ruleVersion: CASH_RULE_VERSION };
}

export interface VarianceRow {
  kind: 'income' | 'cost';
  category: string;
  label: string;
  budget: number;
  actual: number;
  variance: number; // actual - budget (for costs, positive = overspend)
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
  const budgetFor = (kind: string, cat: string) =>
    bundle.budget.filter((b) => b.kind === kind && b.category === cat && b.month !== null && ymSet.has(`${b.year}-${b.month}`))
      .reduce((s, b) => s + Number(b.amount_eur), 0);

  const cats = new Set(bundle.budget.map((b) => `${b.kind}:${b.category}`));
  const rows: VarianceRow[] = [...cats].map((key) => {
    const [kind, category] = key.split(':') as ['income' | 'cost', string];
    const actual = kind === 'income'
      ? bundle.income.filter((i) => i.income_type === category && inMonths(i.occurred_on)).reduce((s, i) => s + Number(i.amount_eur), 0)
      : bundle.costs.filter((c) => c.category === category && inMonths(c.occurred_on)).reduce((s, c) => s + Number(c.amount_eur), 0);
    const b = budgetFor(kind, category);
    const label = kind === 'income' ? INCOME_LABEL[category as IncomeType] ?? category : COST_LABEL[category as CostCategory] ?? category;
    return { kind, category, label, budget: b, actual, variance: actual - b };
  });

  const monthsWithData = new Set([
    ...bundle.income.filter((i) => inMonths(i.occurred_on)).map((i) => monthKey(i.occurred_on)),
    ...bundle.costs.filter((c) => inMonths(c.occurred_on)).map((c) => monthKey(c.occurred_on))
  ]);
  const completedMonths = Math.max(1, months.length - 1); // current month is still in progress
  const coverage = monthsWithData.size / completedMonths;
  return { fy, rows, coverage, adequate: coverage >= 0.75, monthsElapsed: months.length };
}

export interface MissingItem { id: string; text: string; fix: string; to: string }

/** Management year-end pack (spec 6). Deliberately not statutory accounts or a tax computation. */
export function yearEndPack(bundle: FarmBundle, today: ISODate, offset = 0) {
  const fy = fyRange(bundle.farm, today, offset);
  const inFy = (d: ISODate) => d >= fy.start && d <= fy.end;
  const income = bundle.income.filter((i) => inFy(i.occurred_on));
  const costs = bundle.costs.filter((c) => inFy(c.occurred_on));

  const incomeByType = Object.entries(
    income.reduce<Record<string, number>>((a, i) => ({ ...a, [i.income_type]: (a[i.income_type] ?? 0) + Number(i.amount_eur) }), {})
  ).map(([k, v]) => ({ key: k, label: INCOME_LABEL[k as IncomeType], total: v })).sort((a, b) => b.total - a.total);
  const costsByCategory = Object.entries(
    costs.reduce<Record<string, number>>((a, c) => ({ ...a, [c.category]: (a[c.category] ?? 0) + Number(c.amount_eur) }), {})
  ).map(([k, v]) => ({ key: k, label: COST_LABEL[k as CostCategory], total: v })).sort((a, b) => b.total - a.total);
  const supplierTotals = Object.entries(
    costs.reduce<Record<string, number>>((a, c) => {
      const name = c.supplier_name ?? bundle.suppliers.find((s) => s.id === c.supplier_id)?.name ?? 'Not recorded';
      return { ...a, [name]: (a[name] ?? 0) + Number(c.amount_eur) };
    }, {})
  ).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);

  const totalIncome = income.reduce((s, i) => s + Number(i.amount_eur), 0);
  const totalCosts = costs.reduce((s, c) => s + Number(c.amount_eur), 0);
  const lastMonth = monthKey(today < fy.end ? today : fy.end);
  const months = monthsBetween(monthKey(fy.start), lastMonth);
  const flows = monthlyFlows(income, costs, months);
  const milkLitres = income.filter((i) => i.income_type === 'milk').reduce((s, i) => s + Number(i.milk_litres ?? 0), 0);
  const livestockHead = income.filter((i) => i.income_type === 'livestock').reduce((s, i) => s + Number(i.head_count ?? 0), 0);

  // Missing-data checklist for the accountant/advisor
  const missing: MissingItem[] = [];
  const f = bundle.farm;
  if (f.opening_cash_eur === null) missing.push({ id: 'cash', text: 'Opening bank balance not set', fix: 'Add opening cash', to: '/settings' });
  if (f.enterprise === 'dairy' || f.enterprise === 'mixed') {
    const milkMonths = new Set(income.filter((i) => i.income_type === 'milk').map((i) => monthKey(i.occurred_on)));
    const closed = months.slice(0, -1);
    const gaps = closed.filter((m) => !milkMonths.has(m));
    if (gaps.length) missing.push({ id: 'milk', text: `No milk cheque recorded for ${gaps.length} month${gaps.length > 1 ? 's' : ''}`, fix: 'Add milk sale', to: '/record/milk' });
  }
  const unpriced = bundle.txns.filter((t) => t.txn_type === 'delivery' && inFy(t.effective_on) && t.total_price_eur === null);
  if (unpriced.length) missing.push({ id: 'feedprice', text: `${unpriced.length} feed deliver${unpriced.length > 1 ? 'ies have' : 'y has'} no price`, fix: 'Review deliveries', to: '/forecast' });
  const noEvidence = costs.filter((c) => !c.document_id && Number(c.amount_eur) >= 500);
  if (noEvidence.length) missing.push({ id: 'evidence', text: `${noEvidence.length} cost${noEvidence.length > 1 ? 's' : ''} over €500 without an invoice attached`, fix: 'Attach invoices', to: '/records' });
  const unconfirmed = bundle.documents.filter((d) => d.state === 'unconfirmed');
  if (unconfirmed.length) missing.push({ id: 'docs', text: `${unconfirmed.length} document${unconfirmed.length > 1 ? 's' : ''} waiting for you to confirm`, fix: 'Confirm documents', to: '/records' });
  const costCats = new Set(costs.map((c) => c.category));
  (['fertiliser', 'contractor', 'vet_medicine'] as CostCategory[]).forEach((c) => {
    if (!costCats.has(c)) missing.push({ id: `cat-${c}`, text: `No ${COST_LABEL[c].toLowerCase()} costs this year`, fix: 'Add cost', to: `/record/cost?category=${c}` });
  });

  return {
    fy, totalIncome, totalCosts, net: totalIncome - totalCosts, incomeByType, costsByCategory,
    supplierTotals, flows, milkLitres, livestockHead, missing
  };
}

export function yearEndCsv(pack: ReturnType<typeof yearEndPack>, farmName: string): string {
  const rows: (string | number)[][] = [
    ['Agri-It management summary (not statutory accounts or a tax computation)'],
    ['Farm', farmName], ['Financial year', `${pack.fy.start} to ${pack.fy.end}`], [],
    ['Income', 'Total €'], ...pack.incomeByType.map((r) => [r.label, r.total.toFixed(2)]),
    ['Total income', pack.totalIncome.toFixed(2)], [],
    ['Costs', 'Total €'], ...pack.costsByCategory.map((r) => [r.label, r.total.toFixed(2)]),
    ['Total costs', pack.totalCosts.toFixed(2)], [],
    ['Net cash movement', pack.net.toFixed(2)], [],
    ['Month', 'In €', 'Out €', 'Net €'], ...pack.flows.map((f) => [f.month, f.inflow.toFixed(2), f.outflow.toFixed(2), f.net.toFixed(2)]), [],
    ['Supplier', 'Total €'], ...pack.supplierTotals.map((s) => [s.name, s.total.toFixed(2)]), [],
    ['Missing data'], ...pack.missing.map((m) => [m.text])
  ];
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
