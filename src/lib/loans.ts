/**
 * Loans, hire purchase, leases and overdrafts (rule loans@1.0, 16 Oct 2026).
 *
 * Everything starts from the farmer's own figures: what is owed on a date (from their latest
 * statement), the rate, what comes out and how often. Agri-It never quotes a rate or a
 * repayment. From those figures it works out:
 *  - when each repayment falls (skipping any months the loan has no repayment, like a
 *    milk-linked loan with nothing December to March),
 *  - roughly how much of each repayment is interest and how much pays the loan down
 *    (balance x rate x days since the last one / 365, labelled an estimate),
 *  - what is owed now, from the statement balance less what has been repaid since.
 * The bank's annual statement always beats the estimate: it is the figure the accountant uses.
 */
import type { Cost, ISODate, Loan, LoanFrequency, LoanStatement } from './types';
import { addDays, daysBetween, parseISO, toISO } from './format';

export const LOAN_RULE_VERSION = 'loans@1.0';

export const FREQ_MONTHS: Record<LoanFrequency, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
export const FREQ_LABEL: Record<LoanFrequency, string> = { monthly: 'Every month', quarterly: 'Every 3 months', half_yearly: 'Every 6 months', yearly: 'Once a year' };
export const KIND_LABEL: Record<Loan['kind'], string> = { loan: 'Loan', hire_purchase: 'Hire purchase', lease: 'Lease', overdraft: 'Overdraft', other: 'Other borrowing' };
export const PURPOSE_LABEL: Record<NonNullable<Loan['purpose']>, string> = {
  land: 'Land', buildings: 'Sheds, parlour, yard', machinery: 'Machinery', stock: 'Stock', working_capital: 'Day-to-day farm costs', other: 'Something else'
};

/** The same day `n` months on; a day past the month's end falls on its last day (31 Jan + 1 = 28 Feb). */
export function addMonths(day: ISODate, n: number, dayOfMonth = Number(day.slice(8, 10))): ISODate {
  const d = parseISO(day);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(y, m, Math.min(dayOfMonth, last))));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Repayment dates from the loan's next due date, between `from` and `to`, leaving out its skip months. */
export function repaymentDates(loan: Pick<Loan, 'kind' | 'repayment_eur' | 'frequency' | 'next_due' | 'skip_months' | 'ends_on'>, from: ISODate, to: ISODate): ISODate[] {
  if (loan.kind === 'overdraft' || !loan.repayment_eur || !loan.frequency || !loan.next_due) return [];
  const step = FREQ_MONTHS[loan.frequency];
  const dom = Number(loan.next_due.slice(8, 10));
  const skip = new Set(loan.skip_months ?? []);
  const out: ISODate[] = [];
  for (let i = 0; i < 600; i++) {
    const d = addMonths(loan.next_due, i * step, dom);
    if (d > to || (loan.ends_on && d > loan.ends_on)) break;
    if (d >= from && !skip.has(Number(d.slice(5, 7)))) out.push(d);
  }
  return out;
}

export interface Repayment {
  on: ISODate;
  amount: number;
  /** Null when the rate isn't known */
  interest: number | null;
  capital: number;
  balanceAfter: number;
  /** The amount itself is worked out (after an interest-only period ends), not the farmer's */
  amountEstimated: boolean;
}

/**
 * Projected repayments from what is owed on `balance_on` (or a later known balance), up to `to`.
 * Interest is balance x rate x days / 365 between repayments: an estimate, close for a
 * reducing-balance loan but not the bank's figure.
 */
export function projectRepayments(loan: Loan, to: ISODate, start?: { balance: number; on: ISODate; inclusive?: boolean }): Repayment[] {
  const from = start?.on ?? loan.balance_on;
  let balance = start?.balance ?? Number(loan.balance_eur);
  // The farmer's own "owed as on" figure is taken as the start of that day, so a repayment due that
  // day still comes off it. A statement (end of its period) or a repayment already recorded is not.
  const inclusive = start ? !!start.inclusive : true;
  const dates = repaymentDates(loan, inclusive ? from : addDays(from, 1), to);
  const rate = loan.rate_percent === null || loan.rate_percent === undefined ? null : Number(loan.rate_percent) / 100;
  const out: Repayment[] = [];
  let prev = from;
  for (const on of dates) {
    if (balance <= 0.005) break;
    const interest = rate === null ? null : round2(balance * rate * daysBetween(prev, on) / 365);
    let amount = Number(loan.repayment_eur);
    let amountEstimated = false;
    // After an interest-only period the repayment goes up: work it out if the end date and rate are known
    if (loan.interest_only_until && on > loan.interest_only_until && loan.ends_on && rate !== null) {
      const left = Math.max(1, dates.filter((d) => d >= on).length);
      const i = rate * FREQ_MONTHS[loan.frequency!] / 12;
      amount = round2(i === 0 ? balance / left : (balance * i) / (1 - Math.pow(1 + i, -left)));
      amountEstimated = true;
    }
    // The last one clears what's left
    if (amount > balance + (interest ?? 0)) amount = round2(balance + (interest ?? 0));
    const capital = round2(Math.max(0, amount - (interest ?? 0)));
    balance = round2(Math.max(0, balance - capital));
    out.push({ on, amount, interest, capital, balanceAfter: balance, amountEstimated });
    prev = on;
  }
  return out;
}

/** Repayments recorded for this loan (cost rows with its id), paid date or the day it happened. */
export function recordedRepayments(loan: Pick<Loan, 'id'>, costs: Cost[]): Cost[] {
  return costs.filter((c) => c.loan_id === loan.id && (c.payment_status ?? 'paid') !== 'owed');
}
const paidDate = (c: Cost) => c.paid_on ?? c.occurred_on;

/** Was a repayment due on `on` recorded? Allows 10 days either side (weekends, bank holidays, late entries). */
export function isRecorded(loan: Pick<Loan, 'id'>, costs: Cost[], on: ISODate): boolean {
  return recordedRepayments(loan, costs).some((c) => Math.abs(daysBetween(on, paidDate(c))) <= 10);
}

/** The latest balance the farmer or the bank gave: the loan's own, or a later annual statement. */
export function knownBalance(loan: Loan, statements: LoanStatement[]): { balance: number; on: ISODate; from: 'loan' | 'statement'; inclusive: boolean } {
  const later = statements.filter((s) => s.loan_id === loan.id && s.balance_eur !== null && s.period_end > loan.balance_on)
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  return later ? { balance: Number(later.balance_eur), on: later.period_end, from: 'statement', inclusive: false } : { balance: Number(loan.balance_eur), on: loan.balance_on, from: 'loan', inclusive: true };
}

/** Capital part of a recorded repayment: what the farmer gave as interest, else the estimate. */
function capitalOf(loan: Loan, c: Cost, balanceBefore: number, prev: ISODate): number {
  const amount = Number(c.amount_eur);
  if (c.interest_eur !== null && c.interest_eur !== undefined) return Math.max(0, amount - Number(c.interest_eur));
  if (loan.rate_percent === null || loan.rate_percent === undefined) return amount;
  const interest = balanceBefore * (Number(loan.rate_percent) / 100) * Math.max(0, daysBetween(prev, paidDate(c))) / 365;
  return Math.max(0, amount - interest);
}

/** What is owed on `day`: the known balance less the capital part of every repayment recorded since. */
export function balanceOn(loan: Loan, costs: Cost[], statements: LoanStatement[], day: ISODate): number {
  const k = knownBalance(loan, statements);
  let balance = k.balance;
  let prev = k.on;
  for (const c of recordedRepayments(loan, costs).filter((x) => (k.inclusive ? paidDate(x) >= k.on : paidDate(x) > k.on) && paidDate(x) <= day).sort((a, b) => paidDate(a).localeCompare(paidDate(b)))) {
    balance = Math.max(0, balance - capitalOf(loan, c, balance, prev));
    prev = paidDate(c);
  }
  return round2(balance);
}

/** Repayments still to come (not recorded yet), from `from` to `to`, starting from today's balance. */
export function upcomingRepayments(loan: Loan, costs: Cost[], statements: LoanStatement[], today: ISODate, from: ISODate, to: ISODate): Repayment[] {
  if (loan.archived) return [];
  const now = balanceOn(loan, costs, statements, today);
  const lastPaid = recordedRepayments(loan, costs).map(paidDate).filter((d) => d <= today).sort().at(-1);
  const k = knownBalance(loan, statements);
  const fromPaid = !!lastPaid && lastPaid >= k.on;
  const startOn = fromPaid ? lastPaid! : k.on;
  // Project from the last known point so interest days are right, then keep the window
  return projectRepayments(loan, to, { balance: now, on: startOn < today ? startOn : today, inclusive: !fromPaid && k.inclusive })
    .filter((r) => r.on >= from && !isRecorded(loan, costs, r.on));
}

/** Repayments that fell due in the last `days` days and haven't been recorded: "did it come out?" */
export function dueUnrecorded(loan: Loan, costs: Cost[], statements: LoanStatement[], today: ISODate, days = 30): Repayment[] {
  if (loan.archived) return [];
  const k = knownBalance(loan, statements);
  const from = addDays(today, -days);
  return projectRepayments(loan, today, k)
    .filter((r) => r.on >= from && r.on <= today && (k.inclusive ? r.on >= k.on : r.on > k.on) && !isRecorded(loan, costs, r.on));
}

export interface LoanYear {
  loan: Loan;
  /** Owed at the start of the year: only when the farmer's figure is from before it */
  balanceStart: number | null;
  balanceEnd: number;
  balanceEndBasis: 'statement' | 'worked out';
  repaid: number;
  repayments: number;
  interest: number | null;
  /** statement = the bank's figure; recorded = the farmer typed it on each repayment; estimate = worked out */
  interestBasis: 'statement' | 'recorded' | 'estimate' | 'unknown';
  statement: LoanStatement | null;
}

/**
 * One loan over a financial year, for the year-end pack. The bank's statement for the year
 * wins; then interest the farmer typed on every repayment; then the estimate.
 */
export function loanYear(loan: Loan, costs: Cost[], statements: LoanStatement[], fy: { start: ISODate; end: ISODate }, today: ISODate): LoanYear {
  const cutoff = today < fy.end ? today : fy.end;
  const inYear = recordedRepayments(loan, costs).filter((c) => paidDate(c) >= fy.start && paidDate(c) <= cutoff);
  const repaid = inYear.reduce((s, c) => s + Number(c.amount_eur), 0);
  // The statement for this year: one ending within a month either side of the year end
  const statement = statements.filter((s) => s.loan_id === loan.id && Math.abs(daysBetween(fy.end, s.period_end)) <= 31)
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0] ?? null;
  const balanceStart = loan.balance_on <= fy.start ? balanceOn(loan, costs, statements, addDays(fy.start, -1)) : null;
  const balanceEnd = statement?.balance_eur !== null && statement?.balance_eur !== undefined ? Number(statement.balance_eur) : balanceOn(loan, costs, statements, cutoff);
  let interest: number | null = null;
  let interestBasis: LoanYear['interestBasis'] = 'unknown';
  if (statement?.interest_eur !== null && statement?.interest_eur !== undefined) {
    interest = Number(statement.interest_eur); interestBasis = 'statement';
  } else if (inYear.length && inYear.every((c) => c.interest_eur !== null && c.interest_eur !== undefined)) {
    interest = round2(inYear.reduce((s, c) => s + Number(c.interest_eur), 0)); interestBasis = 'recorded';
  } else if (loan.rate_percent !== null && loan.rate_percent !== undefined && inYear.length) {
    // Estimate each recorded repayment's interest from the balance before it
    const k = knownBalance(loan, statements);
    let balance = k.balance; let prev = k.on; let sum = 0;
    for (const c of recordedRepayments(loan, costs).filter((x) => (k.inclusive ? paidDate(x) >= k.on : paidDate(x) > k.on) && paidDate(x) <= cutoff).sort((a, b) => paidDate(a).localeCompare(paidDate(b)))) {
      const est = c.interest_eur ?? balance * (Number(loan.rate_percent) / 100) * Math.max(0, daysBetween(prev, paidDate(c))) / 365;
      if (paidDate(c) >= fy.start) sum += Number(est);
      balance = Math.max(0, balance - (Number(c.amount_eur) - Number(est)));
      prev = paidDate(c);
    }
    interest = round2(sum); interestBasis = 'estimate';
  }
  return {
    loan, balanceStart, balanceEnd: round2(balanceEnd), balanceEndBasis: statement?.balance_eur != null ? 'statement' : 'worked out',
    repaid: round2(repaid), repayments: inYear.length, interest, interestBasis, statement
  };
}

/** Total agreed overdraft limits: how far the bank balance may go below zero. */
export function overdraftLimit(loans: Loan[]): number {
  return loans.filter((l) => !l.archived && l.kind === 'overdraft').reduce((s, l) => s + Number(l.credit_limit_eur ?? 0), 0);
}

/** One line for a loan card: "€1,240 every month, next 1 Nov" */
export function loanLine(loan: Loan): string {
  if (loan.kind === 'overdraft') return loan.credit_limit_eur ? 'Overdraft limit' : 'Overdraft';
  if (!loan.repayment_eur || !loan.frequency) return 'Repayments not given';
  return FREQ_LABEL[loan.frequency].toLowerCase();
}
