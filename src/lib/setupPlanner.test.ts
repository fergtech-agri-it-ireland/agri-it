import { describe, expect, it } from 'vitest';
import type { Cost, ExpectedIncome, Farm, FarmBundle, Loan, LoanStatement, Routine } from './types';
import { addMonths, balanceOn, dueUnrecorded, loanYear, overdraftLimit, projectRepayments, repaymentDates, upcomingRepayments } from './loans';
import { SCHEME_RULES, expectedRows, planScheme, schemeRule, schemesFor } from './schemes';
import { calvingHint, fyHint, jobIdeasFor, monthChips, setupPlan, setupProgress } from './setup';
import { dueDates, isDue, scheduleLabel } from './routines';
import { yearPlan } from './forecast/plan';
import { cashForecast90, packReadme, yearEndCsv, yearEndPack } from './forecast/money';

const farm = (o: Partial<Farm> = {}): Farm => ({
  id: 'f', name: 'Test', eircode: null, county: 'Cork', jurisdiction: 'ROI', enterprise: 'dairy', enterprises: ['dairy'], financial_year_start_month: 1,
  opening_cash_eur: 10000, opening_cash_date: '2026-10-01', default_lead_time_days: null, forage_reserve_percent: 15, feed_target_days: 30,
  housing_start: null, turnout_date: null, setup: {}, ...o
});
const loan = (o: Partial<Loan> = {}): Loan => ({
  id: 'L1', farm_id: 'f', lender: 'AIB', kind: 'loan', purpose: 'buildings', balance_eur: 100000, balance_on: '2026-10-01', rate_percent: 5, rate_type: 'variable',
  repayment_eur: 1000, frequency: 'monthly', next_due: '2026-11-01', skip_months: [], interest_only_until: null, ends_on: null, credit_limit_eur: null,
  notes: null, archived: false, ...o
});
const cost = (o: Partial<Cost>): Cost => ({
  id: 'c', farm_id: 'f', category: 'loan_repayment', other_label: null, occurred_on: '2026-11-01', amount_eur: 1000, supplier_id: null, supplier_name: 'AIB',
  feed_transaction_id: null, description: null, document_id: null, payment_status: 'paid', paid_on: null, ...o
});
const bundle = (o: Partial<FarmBundle> = {}): FarmBundle => ({
  farm: farm(), groups: [], crops: [], suppliers: [], branches: [], supplierSettings: [], products: [], txns: [], rules: [], silage: [], benchmarks: [], evidence: [],
  income: [], costs: [], budget: [], records: [], documents: [], jobs: [], routines: [], completions: [], feedLogs: [], headHistory: [], seasons: [], births: [],
  decisions: [], fields: [], fertilisers: [], fertStock: [], spreads: [], spreadFields: [], loans: [], loanStatements: [], expected: [], yearValues: [], animals: [], ...o
});

describe('loans@1.0: when repayments fall', () => {
  it('steps by the frequency and keeps the day, clamped to short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(repaymentDates(loan({ frequency: 'quarterly', next_due: '2026-01-31' }), '2026-01-01', '2026-08-31')).toEqual(['2026-01-31', '2026-04-30', '2026-07-31']);
  });
  it('leaves out the months a seasonal loan has no repayment (milk-linked: none December to March)', () => {
    expect(repaymentDates(loan({ next_due: '2026-11-15', skip_months: [12, 1, 2, 3] }), '2026-11-01', '2027-05-31')).toEqual(['2026-11-15', '2027-04-15', '2027-05-15']);
  });
  it('an overdraft, or a loan with no repayment given, has no schedule', () => {
    expect(repaymentDates(loan({ kind: 'overdraft' }), '2026-01-01', '2027-01-01')).toEqual([]);
    expect(repaymentDates(loan({ repayment_eur: null }), '2026-01-01', '2027-01-01')).toEqual([]);
  });
});

describe('loans@1.0: interest and capital, worked by hand', () => {
  it('interest = balance x rate x days / 365, the rest pays the loan down', () => {
    const [a, b] = projectRepayments(loan(), '2026-12-31');
    // 100,000 x 5% x 31/365 = 424.66
    expect(a).toMatchObject({ on: '2026-11-01', amount: 1000, interest: 424.66, capital: 575.34, balanceAfter: 99424.66 });
    // 99,424.66 x 5% x 30/365 = 408.59
    expect(b).toMatchObject({ on: '2026-12-01', interest: 408.59, capital: 591.41, balanceAfter: 98833.25 });
  });
  it('the last repayment only clears what is left', () => {
    const r = projectRepayments(loan({ balance_eur: 1500, rate_percent: 0 }), '2027-03-01');
    expect(r.map((x) => x.amount)).toEqual([1000, 500]);
    expect(r.at(-1)!.balanceAfter).toBe(0);
  });
  it('with no rate given, interest is not guessed', () => {
    expect(projectRepayments(loan({ rate_percent: null }), '2026-11-30')[0]).toMatchObject({ interest: null, capital: 1000 });
  });
  it('works out the new repayment once interest-only ends, and says it is worked out', () => {
    const r = projectRepayments(loan({ repayment_eur: 400, interest_only_until: '2026-11-30', ends_on: '2027-10-01', rate_percent: 0 }), '2027-10-31');
    expect(r[0]).toMatchObject({ amount: 400, amountEstimated: false });
    // 100,000 - 400 left over 11 repayments (Dec to Oct) at 0%: 9,054.55 each
    expect(r[1]).toMatchObject({ on: '2026-12-01', amountEstimated: true });
    expect(r[1].amount).toBeCloseTo(99600 / 11, 2);
  });
});

describe('loans@1.0: recorded repayments and the balance now', () => {
  const paid = cost({ id: 'r1', loan_id: 'L1', occurred_on: '2026-11-02', interest_eur: 424.66 });
  it('owed now = the statement balance less the capital part of each repayment since', () => {
    expect(balanceOn(loan(), [paid], [], '2026-11-10')).toBe(99424.66);
    expect(balanceOn(loan(), [], [], '2026-11-10')).toBe(100000);
  });
  it('a later annual statement replaces the balance it started from', () => {
    const st: LoanStatement = { id: 's', farm_id: 'f', loan_id: 'L1', period_end: '2026-12-31', balance_eur: 98000, interest_eur: 850, document_id: null };
    expect(balanceOn(loan(), [paid], [st], '2027-01-05')).toBe(98000);
  });
  it('asks "did it come out?" for a due repayment not recorded, and stops once it is (10 days either side)', () => {
    expect(dueUnrecorded(loan(), [], [], '2026-11-05').map((r) => r.on)).toEqual(['2026-11-01']);
    expect(dueUnrecorded(loan(), [paid], [], '2026-11-05')).toEqual([]);
    expect(upcomingRepayments(loan(), [paid], [], '2026-11-05', '2026-11-01', '2026-12-31').map((r) => r.on)).toEqual(['2026-12-01']);
  });
  it('a repayment due on the day of the farmer\'s own balance still comes off it; a statement\'s does not', () => {
    const same = loan({ balance_on: '2026-11-01' });
    expect(dueUnrecorded(same, [], [], '2026-11-01').map((r) => r.on)).toEqual(['2026-11-01']);
    const st: LoanStatement = { id: 's', farm_id: 'f', loan_id: 'L1', period_end: '2026-12-01', balance_eur: 99000, interest_eur: null, document_id: null };
    expect(dueUnrecorded(loan(), [cost({ id: 'r', loan_id: 'L1', occurred_on: '2026-11-01' })], [st], '2026-12-05')).toEqual([]);
  });
  it('overdraft limits add up for the plan', () => {
    expect(overdraftLimit([loan({ kind: 'overdraft', credit_limit_eur: 20000 }), loan({ id: 'x', kind: 'overdraft', credit_limit_eur: 5000, archived: true }), loan()])).toBe(20000);
  });
  it('the year: the bank statement beats the farmer\'s figures, which beat the estimate', () => {
    const fy = { start: '2026-01-01', end: '2026-12-31' };
    const r2 = cost({ id: 'r2', loan_id: 'L1', occurred_on: '2026-12-01', interest_eur: null });
    const est = loanYear(loan(), [paid, r2], [], fy, '2027-01-10');
    expect(est.repaid).toBe(2000);
    expect(est.interestBasis).toBe('estimate');
    expect(est.interest).toBeCloseTo(424.66 + 99424.66 * 0.05 * 29 / 365, 1);
    const rec = loanYear(loan(), [paid, { ...r2, interest_eur: 400 }], [], fy, '2027-01-10');
    expect(rec).toMatchObject({ interest: 824.66, interestBasis: 'recorded' });
    const st: LoanStatement = { id: 's', farm_id: 'f', loan_id: 'L1', period_end: '2026-12-31', balance_eur: 98000, interest_eur: 850, document_id: null };
    expect(loanYear(loan(), [paid, r2], [st], fy, '2027-01-10')).toMatchObject({ interest: 850, interestBasis: 'statement', balanceEnd: 98000, balanceEndBasis: 'statement', balanceStart: null });
  });
});

describe('schemes@1.0: published dates and splits', () => {
  it('splits the year\'s total over the advance and balance, adding up to the cent', () => {
    const parts = planScheme(schemeRule('biss')!, 10000.01, 2026, '2026-10-16');
    expect(parts.map((p) => [p.on, p.amount])).toEqual([['2026-10-16', 7500.01], ['2026-12-05', 2500]]);
    expect(parts.reduce((t, p) => t + p.amount, 0)).toBeCloseTo(10000.01, 2);
  });
  it('ACRES and sheep balances fall the next spring', () => {
    expect(planScheme(schemeRule('acres')!, 5000, 2026, '2026-10-16').map((p) => p.on)).toEqual(['2026-11-10', '2027-04-15']);
    expect(planScheme(schemeRule('sis')!, 1000, 2026, '2026-10-16').map((p) => p.amount)).toEqual([850, 150]);
  });
  it('marks parts already past and makes rows the farmer keeps, labelled with the rule', () => {
    const parts = planScheme(schemeRule('anc')!, 2000, 2026, '2026-10-16');
    expect(parts.map((p) => p.past)).toEqual([true, false]);
    const rows = expectedRows('f', schemeRule('anc')!, 2026, parts.filter((p) => !p.past));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'ANC 2026, balance', amount_eur: 300, expected_on: '2026-12-05', rule: 'schemes@1.0', income_id: null });
  });
  it('NI farms see NI schemes; likely ones first for the farm type', () => {
    expect(schemesFor('NI', ['dairy']).map((r) => r.key)).toEqual(['fsp']);
    const roi = schemesFor('ROI', ['tillage']).map((r) => r.key);
    expect(roi.slice(0, 2)).toEqual(['biss', 'eco']);
    expect(roi.indexOf('scep')).toBeGreaterThan(roi.indexOf('cisyf'));
  });
  it('every timing has a source and a recheck date', () => {
    for (const r of SCHEME_RULES) {
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.reviewBy > r.checkedOn).toBe(true);
      expect(r.parts.reduce((t, p) => t + p.share, 0)).toBeCloseTo(1, 5);
    }
  });
});

describe('routines: bills every 2, 3, 6 or 12 months', () => {
  const r = { frequency: 'monthly', interval_days: null, weekday: null, day_of_month: 10, start_date: '2026-11-01', end_date: null, active: true, interval_months: 2 } as const;
  it('counts months from the start', () => {
    expect(isDue(r, '2026-11-10')).toBe(true);
    expect(isDue(r, '2026-12-10')).toBe(false);
    expect(dueDates(r, '2026-11-01', '2027-05-31')).toEqual(['2026-11-10', '2027-01-10', '2027-03-10', '2027-05-10']);
    expect(scheduleLabel({ ...r, interval_months: 12 })).toBe('Once a year on the 10th');
  });
  it('older routines with no interval stay monthly', () => {
    expect(dueDates({ ...r, interval_months: undefined }, '2026-11-01', '2027-01-31')).toHaveLength(3);
  });
});

describe('setup@1.0: stages built from what the farmer said', () => {
  it('a dairy farm is asked about animals, calving, feeding, silage and its milk cheque', () => {
    const s = setupPlan(bundle());
    expect(s.map((x) => x.key)).toEqual(['farm', 'animals', 'feeding', 'jobs', 'income', 'bills', 'loans', 'yearend']);
    expect(s.find((x) => x.key === 'animals')!.steps.map((x) => x.key)).toEqual(['groups', 'where', 'calving']);
    expect(s.find((x) => x.key === 'income')!.steps.map((x) => x.key)).toEqual(['milk', 'schemes']);
  });
  it('a tillage farm is asked about crops and fields, never feeding', () => {
    const s = setupPlan(bundle({ farm: farm({ enterprises: ['tillage'], enterprise: 'tillage' }) }));
    expect(s.map((x) => x.key)).toEqual(['farm', 'crops', 'jobs', 'income', 'bills', 'loans', 'yearend']);
  });
  it('a stage is done when its data is there or the farmer finished or skipped it', () => {
    const s = setupPlan(bundle({ farm: farm({ acres_owned: 80, herd_number: 'P1234567', setup: { loans: 'skipped', jobs: 'done' } }) }));
    expect(s.find((x) => x.key === 'farm')!.status).toBe('done');
    expect(s.find((x) => x.key === 'loans')!.status).toBe('skipped');
    expect(s.find((x) => x.key === 'jobs')!.status).toBe('done');
    expect(s.find((x) => x.key === 'yearend')!.status).toBe('started'); // bank balance already given
    const p = setupProgress(s);
    expect(p.finished).toBe(3);
    expect(p.next!.key).toBe('yearend');
  });
  it('job ideas for the farm type come first', () => {
    const ids = jobIdeasFor(['dairy']).map((j) => j.key);
    expect(ids.indexOf('footbath')).toBeLessThan(ids.indexOf('feet'));
  });
  it('dates offered are sourced or the farmer\'s own pick', () => {
    expect(calvingHint('dairy', '2026-10-16').on).toBe('2027-01-23');
    expect(calvingHint('suckler', '2026-10-16').on).toBe('2027-02-07');
    expect(monthChips('housing', '2026-10-16')[2].on).toBe('2026-11-01');
    expect(monthChips('turnout', '2026-10-16')[3].on).toBe('2027-03-15');
    expect(monthChips('turnout', '2027-01-10')[0].on).toBe('2027-02-01');
    expect(fyHint('NI').month).toBe(4);
    expect(fyHint('ROI').month).toBe(1);
  });
});

describe('year-plan@1.0: planned against actual, bank carried forward (hand-worked)', () => {
  const expected = (o: Partial<ExpectedIncome>): ExpectedIncome => ({ id: 'e', farm_id: 'f', scheme: 'biss', label: 'BISS', scheme_year: 2026, part: 'advance', amount_eur: 7500, expected_on: '2026-10-16', rule: 'schemes@1.0', income_id: null, ...o });
  const esb: Routine = { id: 'r', farm_id: 'f', kind: 'expense', title: 'ESB', frequency: 'monthly', interval_days: null, weekday: null, day_of_month: 10, interval_months: 2, start_date: '2026-11-01', end_date: null, amount: 300, category: 'utilities', counterparty: 'ESB', feed_product_id: null, silage_store_id: null, supplier_id: null, active: true, created_at: '' };
  const b = bundle({
    loans: [loan()],
    expected: [expected({}), expected({ id: 'e2', part: 'balance', amount_eur: 2500, expected_on: '2026-12-05' })],
    routines: [esb],
    budget: [{ id: 'b', farm_id: 'f', year: 2026, month: 11, kind: 'cost', category: 'feed', amount_eur: 2000 }],
    income: [{ id: 'i', farm_id: 'f', income_type: 'milk', occurred_on: '2026-10-05', amount_eur: 20000, counterparty: null, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: null, document_id: null }],
    costs: [cost({ id: 'v', category: 'vet_medicine', occurred_on: '2026-10-10', amount_eur: 500, supplier_name: 'Vet' })]
  });
  it('carries the bank forward from today with what is still to come', () => {
    const p = yearPlan(b, '2026-10-16');
    const m = (k: string) => p.months.find((x) => x.month === k)!;
    expect(p.start!.balance).toBe(29500);
    expect(m('2026-10')).toMatchObject({ status: 'now', plannedIn: 7500, actualIn: 20000, bank: 37000, bankBasis: 'projected' });
    expect(m('2026-11')).toMatchObject({ plannedOut: 3300, bank: 33700 });
    expect(m('2026-12')).toMatchObject({ plannedIn: 2500, plannedOut: 1000, bank: 35200 });
    expect(p.low!.month).toBe('2026-11');
    expect(p.lowWarning).toBeNull();
    expect(p.lines.find((l) => l.key === 'loan:L1')!.cells['2026-11'].sources).toEqual(['loan']);
    expect(p.lines.find((l) => l.key === 'out:feed')!.cells['2026-11'].sources).toEqual(['budget']);
  });
  it('next year carries on from where this year\'s plan leaves the bank', () => {
    const next = yearPlan(b, '2026-10-16', 1);
    // Dec 2026 ends at 35,200; Jan 2027 has an ESB bill (every 2 months from Nov) and a loan repayment
    expect(next.fy.label).toBe('2027');
    expect(next.months[0]).toMatchObject({ month: '2027-01', plannedOut: 1300, bank: 33900 });
  });
  it('a budget line for something a repeat already plans that month is not counted twice', () => {
    const p = yearPlan({ ...b, budget: [...b.budget, { id: 'b2', farm_id: 'f', year: 2026, month: 11, kind: 'cost', category: 'utilities', amount_eur: 999 }] }, '2026-10-16');
    expect(p.lines.find((l) => l.key === 'out:utilities')!.cells['2026-11'].planned).toBe(300);
  });
  it('warns when the plan goes overdrawn, and past the overdraft limit', () => {
    const tight = { ...b, budget: [{ id: 'b', farm_id: 'f', year: 2026, month: 11, kind: 'cost' as const, category: 'feed', amount_eur: 40000 }] };
    expect(yearPlan(tight, '2026-10-16').lowWarning).toBe('overdrawn');
    expect(yearPlan({ ...tight, loans: [...tight.loans, loan({ id: 'od', kind: 'overdraft', credit_limit_eur: 1000, repayment_eur: null })] }, '2026-10-16').lowWarning).toBe('past_limit');
  });
  it('the 90-day cash forecast counts loan repayments and scheme payments too', () => {
    const f = cashForecast90(b.farm, b.income, b.costs, [], '2026-10-16', undefined, [], { loans: b.loans, expected: b.expected });
    const nov = f.rows.find((r) => r.month === '2026-11')!;
    const dec = f.rows.find((r) => r.month === '2026-12')!;
    expect(nov.regularOut).toBe(1000);
    expect(dec.regularIn).toBe(2500);
  });
});

describe('year-end pack: what the accountant asks for', () => {
  it('loans, interest by its basis, household drawings, schemes and the checklist', () => {
    const st: LoanStatement = { id: 's', farm_id: 'f', loan_id: 'L1', period_end: '2026-12-31', balance_eur: 98000, interest_eur: 850, document_id: null };
    const b = bundle({
      farm: farm({ herd_number: 'P1234567', vat_status: 'flat_rate', acres_owned: 80 }),
      loans: [loan()], loanStatements: [st],
      costs: [cost({ id: 'r1', loan_id: 'L1' }), cost({ id: 'h', category: 'household', amount_eur: 400, occurred_on: '2026-11-05', supplier_name: null })],
      income: [{ id: 'g', farm_id: 'f', income_type: 'grant', occurred_on: '2026-10-16', amount_eur: 7500, counterparty: 'DAFM', milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: 'BISS 2026, advance', document_id: null }]
    });
    const pack = yearEndPack(b, '2027-01-10', -1);
    expect(pack.fy.label).toBe('2026');
    expect(pack.loans[0]).toMatchObject({ repaid: 1000, interest: 850, interestBasis: 'statement', balanceEnd: 98000 });
    expect(pack.totalInterest).toBe(850);
    expect(pack.household).toBe(400);
    expect(pack.totalCosts).toBe(0); // household and loan repayments are not running costs
    expect(pack.schemesReceived).toEqual([{ label: 'BISS 2026, advance', total: 7500 }]);
    expect(pack.checklist.find((i) => i.id === 'loan-L1')!.done).toBe(true);
    expect(pack.checklist.find((i) => i.id === 'vat')!.text).toContain('VAT 58');
    const csv = yearEndCsv(pack, 'Test');
    expect(csv).toContain('Loans: owed at end,AIB,Line,98000.00');
    expect(csv).toContain('Loans: interest,AIB,Line,850.00');
    // The start balance is not known (see the statement), so it is blank and its total is blank, not 0.00
    expect(csv.split('\n')).toContain('Loans: owed at start,AIB,Line,');
    expect(csv.split('\n')).toContain('Loans: owed at start,Total owed at start,Total,');
    // Farm details, what to gather and where each loan figure came from sit in the pack's README, not in the table
    const readme = packReadme(pack, 'Test', []);
    expect(readme).toContain('Herd number: P1234567');
    expect(readme).toContain('VAT 58');
    expect(readme).toContain('AIB: end balance from the bank statement; interest bank statement');
  });
  it('flags a loan with no annual statement', () => {
    const pack = yearEndPack(bundle({ loans: [loan()], costs: [cost({ id: 'r1', loan_id: 'L1' })] }), '2027-01-10', -1);
    expect(pack.missing.map((m) => m.id)).toContain('loan-statement-L1');
    expect(pack.loans[0].interestBasis).toBe('estimate');
  });
});
