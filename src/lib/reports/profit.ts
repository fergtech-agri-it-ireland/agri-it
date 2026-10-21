/**
 * Profit report (income and expenditure), laid out the way Teagasc's Profit Monitor lays it out:
 * output, direct costs, gross margin, overheads, loan interest, profit before depreciation.
 *
 * Basis, always stated:
 * - accruals (default): sales when received, plus the change in what is owed to the farm and in
 *   stock when the farmer has valued them; costs on the day incurred, owed bills included.
 * - cash: money received and paid in the year, nothing else.
 *
 * Nothing is invented. A stock or debtor value the farmer has not entered is "not valued", the
 * profit is labelled incomplete and says why. Loan capital, machinery, buildings, land and
 * household drawings are kept out of profit and listed beneath it. Depreciation and capital
 * allowances are not computed.
 */
import type { AnimalGroup, Cost, FarmBundle, ISODate } from '../types';
import { COST_LABEL, INCOME_LABEL, NON_OPERATING, type CostCategory, type IncomeType } from '../types';
import { eur as eurText, getCurrency } from '../format';
import { loanYear } from '../loans';
import { payeeOf } from '../forecast/bills';
import { DISCLAIMER, REPORTS_RULE_VERSION, amountTable, r2, sum, type Basis, type ReportDoc, type ReportMeta, type ReportRow, type ReportSection } from './doc';
import { NOTE_CAPITAL_ALLOWANCES, NOTE_HERD_BASIS_NI, NOTE_NO_DEPRECIATION, NOTE_STOCK_RELIEF, RETENTION } from './rules';
import { costDate, headsAtEndOf, inRange, isRegistered, netAmount, reportPeriod, stockPosition, stockTotal, stockUnvaluedKg, valueSum, valuesOn, type Period } from './common';

export const DIRECT_COSTS: CostCategory[] = ['feed', 'fertiliser', 'seed_sprays', 'vet_medicine', 'contractor', 'livestock_purchase'];
export const OVERHEAD_COSTS: CostCategory[] = ['machinery_fuel', 'utilities', 'land_rent', 'labour', 'insurance', 'professional_fees', 'other'];
const INCOME_ORDER: IncomeType[] = ['milk', 'livestock', 'crop', 'grant', 'other'];

export function metaFor(b: FarmBundle, p: Period, basis: Basis | null, now: string): ReportMeta {
  return {
    farm: b.farm.name, yearLabel: p.fy.label, start: p.fy.start, end: p.fy.end, asAt: p.asAt, provisional: p.provisional,
    basis, currency: getCurrency(), generatedAt: now, rule: REPORTS_RULE_VERSION, jurisdiction: b.farm.jurisdiction
  };
}

/** A change in value between the year's two ends, or why it is not known. */
export interface Change { label: string; opening: number | null; closing: number | null; change: number | null; why: string | null }

export interface ProfitFigures {
  basis: Basis;
  sales: number;
  salesByType: { key: IncomeType; label: string; total: number; n: number }[];
  changes: Change[];
  changesKnown: number;
  output: number;
  direct: { key: CostCategory; label: string; total: number; n: number }[];
  directTotal: number;
  grossMargin: number;
  overheads: { key: CostCategory; label: string; total: number; n: number }[];
  overheadsTotal: number;
  interest: number;
  interestUnknown: number;
  interestEstimated: boolean;
  profit: number;
  complete: boolean;
  reasons: string[];
  notes: string[];
  loanCapitalRepaid: number;
  loanRepaymentsTotal: number;
  capitalTotal: number;
  capital: { date: ISODate; description: string; payee: string; amount: number }[];
  household: number;
  /** Increase in trading stock (livestock, crops, feed, fertiliser) when every part is valued */
  stockIncrease: number | null;
  /** Costs counted gross although the farm is VAT registered, because no VAT was recorded on them */
  costsWithoutVat: number;
  incomeIds: string[];
  costIds: string[];
}

function byCat(list: Cost[], basis: Basis, registered: boolean) {
  const m = new Map<CostCategory, { total: number; n: number }>();
  for (const c of list) {
    const cur = m.get(c.category) ?? { total: 0, n: 0 };
    m.set(c.category, { total: r2(cur.total + netAmount(c, registered)), n: cur.n + 1 });
  }
  void basis;
  return m;
}

export function profitFigures(b: FarmBundle, today: ISODate, offset = 0, basis: Basis = 'accruals'): ProfitFigures {
  const p = reportPeriod(b.farm, today, offset);
  const reg = isRegistered(b.farm);
  const reasons: string[] = [];
  const notes: string[] = [];

  const income = b.income.filter((i) => inRange(i.occurred_on, p.fy.start, p.asAt));
  const inYear = b.costs.filter((c) => { const d = costDate(c, basis); return d !== null && inRange(d, p.fy.start, p.asAt); });
  const operating = inYear.filter((c) => !NON_OPERATING.includes(c.category));

  const salesByType = INCOME_ORDER.map((k) => {
    const rows = income.filter((i) => i.income_type === k);
    return { key: k, label: INCOME_LABEL[k], total: sum(rows.map((i) => Number(i.amount_eur))), n: rows.length };
  }).filter((r) => r.n > 0);
  const sales = sum(salesByType.map((s) => s.total));

  // --- changes in stock and in what is owed to the farm (accruals only) ---
  const changes: Change[] = [];
  if (basis === 'accruals') {
    const closingDay = p.closingDay;
    const asAtHeads = p.asAt;
    // Livestock: every group that has animals at either end needs a value at both ends
    const groups = b.groups.filter((g) => !g.archived || (b.headHistory ?? []).some((h) => h.animal_group_id === g.id));
    const heads = (g: AnimalGroup, day: ISODate) => headsAtEndOf(g, (b.headHistory ?? []).filter((h) => h.animal_group_id === g.id), day);
    const needed = groups.filter((g) => heads(g, p.openingDay) > 0 || heads(g, asAtHeads) > 0);
    const lsOpen = valuesOn(b, p.openingDay, 'livestock');
    const lsClose = valuesOn(b, closingDay, 'livestock');
    const lacking = (rows: typeof lsOpen, day: ISODate) => needed.filter((g) => heads(g, day === p.openingDay ? p.openingDay : asAtHeads) > 0 && !rows.some((v) => v.animal_group_id === g.id)).map((g) => g.name);
    if (needed.length || lsOpen.length || lsClose.length) {
      const missOpen = lacking(lsOpen, p.openingDay);
      const missClose = lacking(lsClose, closingDay);
      let why: string | null = null;
      if (missOpen.length) { why = `Not valued at ${p.openingDay}: ${missOpen.join(', ')}`; reasons.push(`Livestock not valued at the start of the year (${missOpen.join(', ')})`); }
      if (missClose.length) {
        why = why ?? (p.provisional ? `Closing values are entered at the year end, ${closingDay}` : `Not valued at ${closingDay}: ${missClose.join(', ')}`);
        reasons.push(p.provisional ? `Livestock values at the year end (${closingDay}) come at the year end` : `Livestock not valued at the year end (${missClose.join(', ')})`);
      }
      const o = valueSum(lsOpen); const c = valueSum(lsClose);
      changes.push({ label: 'Livestock', opening: missOpen.length ? null : o, closing: missClose.length ? null : c, change: why ? null : r2(c - o), why });
    }
    // Crops in store and money owed to the farm: if either end is entered, both are needed
    const pair = (kind: 'crops_in_store' | 'debtors', label: string, missingWhy: string) => {
      const o = valuesOn(b, p.openingDay, kind); const c = valuesOn(b, closingDay, kind);
      if (!o.length && !c.length) return;
      const missO = !o.length; const missC = !c.length;
      const why = missO || missC ? `${label} ${missO ? `not entered at ${p.openingDay}` : `not entered at ${closingDay}`}` : null;
      if (why) reasons.push(`${missingWhy}: ${why.toLowerCase()}`);
      changes.push({ label, opening: missO ? null : valueSum(o), closing: missC ? null : valueSum(c), change: why ? null : r2(valueSum(c) - valueSum(o)), why });
    };
    pair('crops_in_store', 'Crops in store', 'Crops');
    pair('debtors', 'Money owed to you', 'Money owed to you');
    // Feed and fertiliser: worked out from the records, at cost
    const so = stockPosition(b, p.openingDay, today); const sc = stockPosition(b, p.asAt, today);
    const fo = stockTotal(so); const fc = stockTotal(sc);
    if (fo !== 0 || fc !== 0) {
      changes.push({ label: 'Feed and fertiliser in store, at cost', opening: fo, closing: fc, change: r2(fc - fo), why: null });
      const un = stockUnvaluedKg(sc) + stockUnvaluedKg(so);
      if (un > 0) notes.push(`${Math.round(un).toLocaleString('en-IE')} kg of feed or fertiliser in store has no price recorded, so it is counted in the stock report but left out of its value`);
    }
    if (!changes.some((c) => c.label === 'Money owed to you') && salesByType.some((s) => s.key === 'milk')) {
      notes.push('Money owed to you at the year end (for example last month\'s milk cheque) is not entered. Income is counted when it is received, so the first cheque of the next year counts there.');
    }
  } else {
    notes.push('Cash basis: stock and money owed are not counted, so this can differ a lot from accounts prepared on the accruals basis.');
  }
  const changesKnown = sum(changes.filter((c) => c.change !== null).map((c) => c.change as number));
  const output = r2(sales + changesKnown);

  // --- costs ---
  const dm = byCat(operating, basis, reg);
  const dir = DIRECT_COSTS.filter((k) => dm.has(k)).map((k) => ({ key: k, label: COST_LABEL[k], ...dm.get(k)! }));
  const oh = [...new Set<CostCategory>([...OVERHEAD_COSTS, ...(operating.map((c) => c.category) as CostCategory[])])]
    .filter((k) => !DIRECT_COSTS.includes(k) && dm.has(k)).map((k) => ({ key: k, label: COST_LABEL[k], ...dm.get(k)! }));
  const directTotal = sum(dir.map((d) => d.total));
  const overheadsTotal = sum(oh.map((d) => d.total));

  // --- loan interest: the bank's statement, else what the farmer typed, else Agri-It's estimate ---
  const years = (b.loans ?? []).filter((l) => l.kind !== 'overdraft').map((l) => loanYear(l, b.costs, b.loanStatements ?? [], p.fy, today)).filter((y) => !y.loan.archived || y.repaid > 0);
  const known = years.filter((y) => y.interest !== null);
  const unknownLoans = years.filter((y) => y.interest === null);
  // Repayments the farmer recorded without saying which loan they were for: their own interest figure counts, otherwise they cannot be split
  const knownIds = new Set(known.map((y) => y.loan.id));
  const looseRepayments = inYear.filter((c) => c.category === 'loan_repayment' && !(c.loan_id && knownIds.has(c.loan_id)) && !(c.loan_id && years.some((y) => y.loan.id === c.loan_id)));
  const looseUnsplit = looseRepayments.filter((c) => c.interest_eur === null || c.interest_eur === undefined);
  const interest = r2(sum(known.map((y) => y.interest as number)) + sum(looseRepayments.filter((c) => c.interest_eur !== null && c.interest_eur !== undefined).map((c) => Number(c.interest_eur))));
  const interestUnknown = unknownLoans.length + (looseUnsplit.length ? 1 : 0);
  const interestEstimated = known.some((y) => y.interestBasis === 'estimate');
  for (const y of unknownLoans) reasons.push(`Interest on ${y.loan.lender} is not known: ${y.repaid > 0 ? 'add the bank\'s annual statement' : 'no repayments are recorded in the year and there is no bank statement'}`);
  if (looseUnsplit.length) reasons.push(`${looseUnsplit.length} loan repayment${looseUnsplit.length > 1 ? 's' : ''} (${eurText(sum(looseUnsplit.map((c) => Number(c.amount_eur))))}) not linked to a loan and with no interest recorded: link ${looseUnsplit.length > 1 ? 'them' : 'it'} to a loan`);

  // --- not in profit ---
  const nonOp = inYear.filter((c) => NON_OPERATING.includes(c.category));
  const repayments = nonOp.filter((c) => c.category === 'loan_repayment');
  const loanRepaymentsTotal = sum(repayments.map((c) => Number(c.amount_eur)));
  const loanCapitalRepaid = Math.max(0, r2(loanRepaymentsTotal - interest));
  const capital = nonOp.filter((c) => c.category === 'capital').map((c) => ({ date: c.occurred_on, description: c.description ?? '', payee: payeeOf(c, b), amount: Number(c.amount_eur) })).sort((a, c) => a.date.localeCompare(c.date));
  const household = sum(nonOp.filter((c) => c.category === 'household').map((c) => Number(c.amount_eur)));

  // --- VAT ---
  const costsWithoutVat = reg ? operating.filter((c) => c.vat_eur === null || c.vat_eur === undefined).length : 0;
  if (reg) {
    if (costsWithoutVat > 0) notes.push(`VAT-registered: ${costsWithoutVat} cost${costsWithoutVat > 1 ? 's have' : ' has'} no VAT recorded, so ${costsWithoutVat > 1 ? 'they are' : 'it is'} counted gross`);
    notes.push('VAT-registered: costs are shown without the VAT recorded on them. Agri-It does not record VAT on sales, so income may include VAT.');
  } else if (b.farm.vat_status === 'flat_rate') {
    notes.push('Flat-rate farmer: costs include the VAT paid on them.');
  } else {
    notes.push('VAT status is not set (Set up your farm): costs are shown as entered.');
  }

  // --- stock relief information ---
  const eligible = changes.filter((c) => c.label !== 'Money owed to you');
  const stockIncrease = basis === 'accruals' && eligible.length > 0 && eligible.every((c) => c.change !== null) ? r2(eligible.reduce((s, c) => s + (c.change as number), 0)) : null;

  const profit = r2(output - directTotal - overheadsTotal - interest);
  return {
    basis, sales, salesByType, changes, changesKnown, output, direct: dir, directTotal, grossMargin: r2(output - directTotal), overheads: oh, overheadsTotal, interest, interestUnknown, interestEstimated, profit,
    complete: reasons.length === 0, reasons, notes, loanCapitalRepaid, loanRepaymentsTotal, capitalTotal: sum(capital.map((c) => c.amount)), capital, household, stockIncrease, costsWithoutVat,
    incomeIds: income.map((i) => i.id), costIds: inYear.map((c) => c.id)
  };
}

export function profitReport(b: FarmBundle, today: ISODate, opts: { offset?: number; basis?: Basis; now?: string } = {}): { doc: ReportDoc; figures: ProfitFigures } {
  const offset = opts.offset ?? 0;
  const basis = opts.basis ?? 'accruals';
  const p = reportPeriod(b.farm, today, offset);
  const f = profitFigures(b, today, offset, basis);
  const ni = b.farm.jurisdiction === 'NI';

  const out: ReportSection = { heading: 'Output', rows: [] };
  for (const s of f.salesByType) out.rows.push({ label: s.label, amount: s.total, records: s.n, kind: 'line' });
  if (!f.salesByType.length) out.rows.push({ label: 'No income recorded in this year', amount: 0, kind: 'info', noCsv: true });
  out.rows.push({ label: 'Sales received', amount: f.sales, kind: 'subtotal' });
  for (const c of f.changes) {
    out.rows.push({
      label: `${c.label}: ${basis === 'accruals' ? 'increase (decrease) in the year' : ''}`.replace(/: $/, ''),
      amount: c.change, missing: c.change === null, kind: 'line',
      note: c.change === null ? c.why ?? 'Not valued' : `${c.closing === null ? '' : 'Closing'} less opening`.trim(),
      to: c.label.startsWith('Feed') ? '/reports/stock' : '/reports/values'
    });
  }
  out.rows.push({ label: 'Total output', amount: f.output, kind: 'total', note: f.changes.some((c) => c.change === null) ? 'Leaves out the changes that are not valued' : undefined });

  const direct: ReportSection = { heading: 'Direct costs', rows: f.direct.map((d) => ({ label: d.label, amount: d.total, records: d.n, kind: 'line' as const, to: '/reports/expenses' })) };
  direct.rows.push({ label: 'Total direct costs', amount: f.directTotal, kind: 'subtotal' });
  const margin: ReportSection = { heading: 'Gross margin', rows: [{ label: 'Gross margin (output less direct costs)', amount: f.grossMargin, kind: 'total' }] };
  const over: ReportSection = { heading: 'Overheads', rows: f.overheads.map((d) => ({ label: d.label, amount: d.total, records: d.n, kind: 'line' as const, to: '/reports/expenses' })) };
  if (f.interest > 0 || f.interestUnknown > 0) {
    over.rows.push({
      label: 'Loan interest', amount: f.interestUnknown > 0 && f.interest === 0 ? null : f.interest, missing: f.interestUnknown > 0 && f.interest === 0, kind: 'line', to: '/money/loans',
      note: f.interestUnknown > 0 ? `Not known for ${f.interestUnknown} loan${f.interestUnknown > 1 ? 's' : ''}` : f.interestEstimated ? 'Part of this is estimated by Agri-It' : 'From the bank statement or your repayments'
    });
  }
  over.rows.push({ label: 'Total overheads and interest', amount: r2(f.overheadsTotal + f.interest), kind: 'subtotal' });
  over.rows.push({ label: 'Depreciation and capital allowances', amount: null, missing: true, kind: 'info', note: 'Not included: your accountant works these out' });
  const result: ReportSection = {
    heading: 'Profit',
    rows: [{ label: 'Profit before depreciation and capital allowances', amount: f.profit, kind: 'total', note: f.complete ? undefined : 'Incomplete: see what is missing above' }]
  };

  const beneath: ReportSection = {
    heading: 'Not in the profit figure',
    note: 'These are real money, but not running costs of the year.',
    rows: [
      { label: 'Loan capital repaid', amount: f.loanCapitalRepaid, kind: 'line', to: '/money/loans', note: f.loanRepaymentsTotal > 0 ? `Repayments ${f.loanRepaymentsTotal.toFixed(2)} less interest ${f.interest.toFixed(2)}` : undefined },
      { label: 'Machinery, buildings and land bought', amount: f.capitalTotal, kind: 'line', records: f.capital.length, note: f.capital.length ? f.capital.map((c) => `${c.date} ${c.description || c.payee}`).join('; ') : undefined },
      { label: 'Household drawings', amount: f.household, kind: 'line' }
    ]
  };
  const sections = [out, direct, margin, over, result, beneath];
  if (f.stockIncrease !== null) {
    sections.push({ heading: 'For your accountant: stock', rows: [{ label: 'Increase in trading stock in the year', amount: f.stockIncrease, kind: 'info', note: ni ? 'Livestock, crops, feed and fertiliser. Your accountant values it for tax.' : 'Livestock, crops, feed and fertiliser: the figure stock relief is worked from.' }] });
  }

  const footnotes = [DISCLAIMER, NOTE_NO_DEPRECIATION, ...(f.capital.length && !ni ? [NOTE_CAPITAL_ALLOWANCES] : []), ...(ni ? [NOTE_HERD_BASIS_NI] : [NOTE_STOCK_RELIEF]), RETENTION[b.farm.jurisdiction]];
  const basisNote = basis === 'accruals'
    ? 'Accruals: costs on the day incurred (owed bills included), sales when received, plus the change in stock and in money owed to you where you have valued them.'
    : 'Cash: money paid and received in the year, nothing else. Stock and money owed are not counted.';
  const meta = metaFor(b, p, basis, opts.now ?? new Date().toISOString());
  const doc: ReportDoc = {
    id: 'profit', title: 'Profit report', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta, basisNote,
    completeness: { complete: f.complete, reasons: f.reasons, notes: f.notes }, sections, footnotes,
    table: amountTable(sections, meta.currency)
  };
  return { doc, figures: f };
}

export type { ReportRow };
