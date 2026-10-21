import { describe, expect, it } from 'vitest';
import type { AnimalGroup, Cost, Farm, FarmBundle, Income, Loan, YearEndValue } from '../types';
import { buildReport, docCsv, tableCsv } from './index';
import { ledgerCsv, yearEndCsv, yearEndPack } from '../forecast/money';
import { vaultCsv } from '../vault';
import { profitReport } from './profit';
import { cashflowReport } from './cashflow';
import { balanceReport } from './balance';
import { animalsReport } from './animals';
import { expensesReport } from './expenses';
import { incomeReport } from './income';
import { runChecks } from './checks';
import { fifoValue, netAmount } from './common';
import { deemedCostPercent } from './rules';

// Worked by hand: farm year 2026 (calendar), reports run on 1 Feb 2027 for the year just ended.
const TODAY = '2027-02-01';
const NOW = '2027-02-01T09:00:00Z';
const farm = (over: Partial<Farm> = {}) => ({
  id: 'f', name: 'Test Farm', jurisdiction: 'ROI', enterprise: 'dairy', enterprises: ['dairy'], financial_year_start_month: 1, opening_cash_eur: 10000,
  opening_cash_date: '2026-01-01', default_lead_time_days: 3, forage_reserve_percent: 15, feed_target_days: 30, housing_start: null, turnout_date: null, vat_status: 'flat_rate', ...over
}) as unknown as Farm;
const group: AnimalGroup = { id: 'g', farm_id: 'f', name: 'Cows', animal_class: 'dairy_cow', head_count: 90, head_count_updated_at: '2026-10-01T10:00:00Z', forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0 } as AnimalGroup;
const inc = (id: string, income_type: Income['income_type'], occurred_on: string, amount_eur: number, x: Partial<Income> = {}): Income => ({ id, farm_id: 'f', income_type, occurred_on, amount_eur, counterparty: 'Buyer', milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: null, document_id: null, ...x });
const cost = (id: string, category: Cost['category'], occurred_on: string, amount_eur: number, x: Partial<Cost> = {}): Cost => ({ id, farm_id: 'f', category, other_label: null, occurred_on, amount_eur, supplier_id: null, supplier_name: 'Supplier', feed_transaction_id: null, description: null, document_id: 'd', payment_status: 'paid', paid_on: occurred_on, ...x } as Cost);
const val = (id: string, kind: YearEndValue['kind'], as_at: string, value_eur: number, x: Partial<YearEndValue> = {}): YearEndValue => ({ id, farm_id: 'f', kind, as_at, label: id, animal_group_id: null, head_count: null, unit_value_eur: null, value_eur, basis: 'market_value', market_unit_value_eur: null, note: null, ...x });
const loan = { id: 'l', farm_id: 'f', lender: 'AIB', kind: 'loan', purpose: 'machinery', balance_eur: 50000, balance_on: '2025-12-31', rate_percent: 5, rate_type: 'fixed', repayment_eur: null, frequency: null, next_due: null, skip_months: [], interest_only_until: null, ends_on: null, credit_limit_eur: null, notes: null, archived: false } as Loan;

const bundle = (over: Partial<FarmBundle> = {}): FarmBundle => ({
  farm: farm(), groups: [group], crops: [], suppliers: [], branches: [], supplierSettings: [], products: [], txns: [], rules: [], silage: [], benchmarks: [], evidence: [],
  income: [
    inc('i1', 'milk', '2026-03-10', 20000, { milk_litres: 50000 }), inc('i2', 'milk', '2026-06-10', 18000),
    inc('i3', 'livestock', '2026-10-01', 9000, { animal_group_id: 'g', head_count: 10 }), inc('i4', 'grant', '2026-12-01', 4000)
  ],
  costs: [
    cost('c1', 'feed', '2026-02-01', 6000), cost('c2', 'fertiliser', '2026-04-01', 3000), cost('c3', 'vet_medicine', '2026-05-01', 1500), cost('c4', 'livestock_purchase', '2026-06-01', 4000),
    cost('c5', 'labour', '2026-07-01', 2000), cost('c6', 'other', '2026-12-20', 800, { payment_status: 'owed', paid_on: null, due_on: '2027-01-20' }),
    cost('c7', 'loan_repayment', '2026-09-01', 5000, { loan_id: 'l', interest_eur: 800 }), cost('c8', 'capital', '2026-08-01', 12000), cost('c9', 'household', '2026-12-01', 3000)
  ],
  budget: [], records: [], documents: [], jobs: [], routines: [], completions: [], feedLogs: [],
  headHistory: [{ id: 'h1', farm_id: 'f', animal_group_id: 'g', head_count: 90, previous_count: 100, effective_on: '2026-10-01', reason: 'sale', created_at: '2026-10-01T10:00:00Z' }],
  seasons: [], births: [], decisions: [], fields: [], fertilisers: [], fertStock: [], spreads: [], spreadFields: [], loans: [loan], loanStatements: [], expected: [],
  yearValues: [
    val('Cows open', 'livestock', '2025-12-31', 20000, { animal_group_id: 'g', head_count: 100 }), val('Cows close', 'livestock', '2026-12-31', 24000, { animal_group_id: 'g', head_count: 90 }),
    val('Milk cheque open', 'debtors', '2025-12-31', 5000), val('Milk cheque close', 'debtors', '2026-12-31', 6000), val('Tractor', 'machinery', '2026-12-31', 12000, { basis: 'cost' })
  ],
  ...over
} as unknown as FarmBundle);
const run = { offset: -1, now: NOW };

describe('profit report: hand-worked year', () => {
  const { figures: f, doc } = profitReport(bundle(), TODAY, run);
  it('output is sales plus the change in livestock and money owed', () => {
    expect(f.sales).toBe(51000);
    expect(f.changes.find((c) => c.label === 'Livestock')?.change).toBe(4000);
    expect(f.changes.find((c) => c.label === 'Money owed to you')?.change).toBe(1000);
    expect(f.output).toBe(56000);
  });
  it('direct costs, gross margin, overheads, interest and profit', () => {
    expect(f.directTotal).toBe(14500);
    expect(f.grossMargin).toBe(41500);
    expect(f.overheadsTotal).toBe(2800);
    expect(f.interest).toBe(800);
    expect(f.profit).toBe(37900);
    expect(f.complete).toBe(true);
  });
  it('keeps loan capital, machinery and household out of profit', () => {
    expect(f.loanCapitalRepaid).toBe(4200);
    expect(f.capitalTotal).toBe(12000);
    expect(f.household).toBe(3000);
  });
  it('states basis, rule version and currency, and never uses an em dash', () => {
    expect(doc.meta.basis).toBe('accruals');
    expect(doc.meta.rule).toBe('reports@1.0');
    expect(doc.meta.currency).toBe('EUR');
    expect(JSON.stringify(doc)).not.toContain(String.fromCharCode(0x2014));
    expect(docCsv(doc)).toContain('Profit before depreciation');
  });
  it('cash basis leaves out stock changes and the bill still owed', () => {
    const c = profitReport(bundle(), TODAY, { ...run, basis: 'cash' }).figures;
    expect(c.output).toBe(51000);
    expect(c.overheadsTotal).toBe(2000);
    expect(c.profit).toBe(33700);
  });
  it('a missing opening or closing value makes the profit incomplete and says why, never a guess', () => {
    const b = bundle({ yearValues: bundle().yearValues.filter((v) => v.id !== 'Milk cheque open') });
    const p = profitReport(b, TODAY, run);
    expect(p.figures.complete).toBe(false);
    expect(p.figures.reasons.join(' ')).toMatch(/owed to you/i);
    expect(p.figures.changes.find((c) => c.label === 'Money owed to you')?.change).toBeNull();
    expect(p.figures.output).toBe(55000);
  });
  it('an unvalued group of livestock is flagged', () => {
    const p = profitReport(bundle({ yearValues: [] }), TODAY, run);
    expect(p.figures.complete).toBe(false);
    expect(p.figures.reasons.join(' ')).toMatch(/livestock/i);
  });
  it('the year in progress is provisional and flagged until closing values exist', () => {
    const p = profitReport(bundle({ yearValues: bundle().yearValues.filter((v) => v.as_at < '2026-12-31') }), TODAY, run);
    expect(p.figures.complete).toBe(false);
  });
});

describe('cash flow agrees with the bank balance', () => {
  const { figures: f } = cashflowReport(bundle(), TODAY, run);
  it('money in, out and the closing balance', () => {
    expect(f.receiptsTotal).toBe(51000);
    expect(f.paymentsTotal).toBe(36500);
    expect(f.net).toBe(14500);
    expect(f.opening).toBe(10000);
    expect(f.closing).toBe(24500);
    expect(f.difference).toBe(0);
    expect(f.loanInterest).toBe(800);
    expect(f.loanCapital).toBe(4200);
  });
  it('does not show a bank balance when opening cash is not set', () => {
    const g = cashflowReport(bundle({ farm: farm({ opening_cash_eur: null, opening_cash_date: null }) }), TODAY, run).figures;
    expect(g.closing).toBeNull();
    expect(g.complete).toBe(false);
  });
});

describe('balance sheet', () => {
  const { figures: f } = balanceReport(bundle(), TODAY, run);
  it('assets, liabilities and net worth at both ends', () => {
    expect(f.closing.cash).toBe(24500);
    expect(f.closing.assetsTotal).toBe(66500);
    expect(f.closing.loansTotal).toBe(45800);
    expect(f.closing.creditors).toBe(800);
    expect(f.closing.netWorth).toBe(19900);
    expect(f.opening.netWorth).toBe(-15000);
  });
  it('net worth movement is explained by profit and drawings with nothing left over', () => {
    expect(f.netWorthChange).toBe(34900);
    expect(f.otherChanges).toBe(0);
  });
  it('without a machinery value the movement shows the gap as other changes, not hidden', () => {
    const g = balanceReport(bundle({ yearValues: bundle().yearValues.filter((v) => v.kind !== 'machinery') }), TODAY, run).figures;
    expect(g.otherChanges).toBe(-12000);
  });
});

describe('animals and the other basic reports', () => {
  it('head counts add up and sold heads match the sale records', () => {
    const { figures: f } = animalsReport(bundle(), TODAY, run);
    expect(f.groups[0]).toMatchObject({ opening: 100, sold: 10, closing: 90, unexplained: 0, soldRecordedInIncome: 10 });
    expect(f.complete).toBe(true);
  });
  it('a sale that did not reduce the group is flagged', () => {
    const f = animalsReport(bundle({ headHistory: [], groups: [{ ...group, head_count: 100 }] }), TODAY, run).figures;
    expect(f.complete).toBe(false);
  });
  it('income and expenses report totals', () => {
    expect(incomeReport(bundle(), TODAY, run).figures.total).toBe(51000);
    const e = expensesReport(bundle(), TODAY, run).figures;
    expect(e.total).toBe(37300);
    expect(e.owed).toBe(800);
    expect(e.paid).toBe(36500);
  });
});

describe('the reports agree with each other', () => {
  it('every blocking check passes on the worked ledger', () => {
    const checks = runChecks(bundle(), TODAY, -1);
    expect(checks.filter((c) => c.blocking && !c.ok)).toEqual([]);
    expect(checks.find((c) => c.id === 'networth')?.ok).toBe(true);
  });
  it('every report builds and exports to CSV', () => {
    for (const id of ['profit', 'cashflow', 'balance', 'stock', 'animals', 'income', 'expenses', 'checks'] as const) {
      const d = buildReport(id, bundle(), TODAY, run);
      expect(d.sections.length, id).toBeGreaterThan(0);
      expect(docCsv(d).length, id).toBeGreaterThan(20);
    }
  });
});

describe('VAT and stock valuation', () => {
  it('registered farms count costs net of the VAT recorded, flat-rate farms keep it in', () => {
    expect(netAmount({ amount_eur: 123, vat_eur: 23 }, true)).toBe(100);
    expect(netAmount({ amount_eur: 123, vat_eur: 23 }, false)).toBe(123);
    expect(netAmount({ amount_eur: 123, vat_eur: null }, true)).toBe(123);
    const b = bundle({ farm: farm({ vat_status: 'registered' }), costs: [cost('c1', 'feed', '2026-02-01', 1230, { vat_eur: 230 })] });
    expect(profitReport(b, TODAY, run).figures.directTotal).toBe(1000);
  });
  it('stock is valued first in, first out, never above cost, and the unpriced part is not valued', () => {
    // 1000 kg in store; delivered 600 kg at 300 then 600 kg at 420: the newest 600 are in store, plus 400 of the first
    const v = fifoValue(1000, [{ on: '2026-01-01', kg: 600, costEur: 300 }, { on: '2026-06-01', kg: 600, costEur: 420 }]);
    expect(v.valueEur).toBe(420 + 200);
    expect(v.unvaluedKg).toBe(0);
    const u = fifoValue(1000, [{ on: '2026-06-01', kg: 600, costEur: 420 }, { on: '2026-07-01', kg: 100, costEur: null }]);
    expect(u.valueEur).toBe(420);
    expect(u.unvaluedKg).toBe(400);
  });
  it('deemed cost percentages are the published ones', () => {
    expect(deemedCostPercent('dairy_cow')).toBe(60);
  });
});

describe('head counts, loans and edge cases found in the demo', () => {
  const hc = (id: string, count: number, prev: number | null, on: string, reason: string) => ({ id, farm_id: 'f', animal_group_id: 'g', head_count: count, previous_count: prev, effective_on: on, reason, created_at: `${on}T10:00:00Z` });
  it('the first count a group is created with is not animals added, and the year starts at that count', () => {
    const f = animalsReport(bundle({ groups: [{ ...group, head_count: 100 }], headHistory: [hc('h0', 100, null, '2026-03-01', 'opening')], income: [] }), TODAY, run).figures;
    expect(f.groups[0]).toMatchObject({ opening: 100, added: 0, closing: 100, unexplained: 0 });
  });
  it('a sale that was undone is not counted as sold', () => {
    const hist = [hc('h1', 90, 100, '2026-10-01', 'sale'), hc('h2', 100, 90, '2026-10-02', 'sale undone')];
    const f = animalsReport(bundle({ groups: [{ ...group, head_count: 100 }], headHistory: hist, income: [] }), TODAY, run).figures;
    expect(f.groups[0]).toMatchObject({ opening: 100, sold: 0, added: 0, closing: 100, unexplained: 0 });
  });
  it('moves between groups are classed and cancel out in the total', () => {
    const g2 = { ...group, id: 'g2', name: 'Heifers', head_count: 10 };
    const hist = [hc('m1', 80, 100, '2026-05-01', 'moved to Heifers'), { ...hc('m2', 10, 0, '2026-05-01', 'moved from Cows'), animal_group_id: 'g2' }];
    const f = animalsReport(bundle({ groups: [{ ...group, head_count: 80 }, g2], headHistory: hist, income: [] }), TODAY, run).figures;
    expect(f.totals.movedIn).toBe(10);
    expect(f.totals.movedOut).toBe(20);
    expect(f.groups.find((g) => g.name === 'Cows')).toMatchObject({ movedOut: 20, closing: 80, unexplained: 0 });
  });
  it('repayments not linked to a loan and with no interest cannot be split, so the profit says so and the cash flow shows no split', () => {
    const b = bundle({ loans: [], costs: [cost('r1', 'loan_repayment', '2026-05-01', 3000)] });
    const p = profitReport(b, TODAY, run).figures;
    expect(p.complete).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/not linked to a loan/);
    const c = cashflowReport(b, TODAY, run).figures;
    expect(c.loanInterest).toBeNull();
    expect(c.loanRepaid).toBe(3000);
  });
  it('a repayment with its own interest figure splits without a loan', () => {
    const b = bundle({ loans: [], costs: [cost('r1', 'loan_repayment', '2026-05-01', 3000, { interest_eur: 200 })] });
    expect(profitReport(b, TODAY, run).figures.interest).toBe(200);
    expect(cashflowReport(b, TODAY, run).figures.loanCapital).toBe(2800);
  });
  it('opening cash set part way through the year leaves the start-of-year balance unknown, not invented', () => {
    const b = bundle({ farm: farm({ opening_cash_date: '2026-06-01' }) });
    const f = cashflowReport(b, TODAY, run).figures;
    expect(f.opening).toBeNull();
    expect(f.closing).not.toBeNull();
    expect(f.complete).toBe(false);
  });
  it('a year still in progress is marked year to date, and costs dated after today are left out', () => {
    const b = bundle({ costs: [...bundle().costs, cost('f1', 'feed', '2027-12-01', 999, { payment_status: 'owed', paid_on: null })] });
    const d = profitReport(b, '2027-06-01', { now: NOW }).doc;
    expect(d.meta.provisional).toBe(true);
    expect(d.subtitle).toContain('year to date');
  });
  it('currency follows the farm and is stated in the document', () => {
    expect(buildReport('income', bundle({ farm: farm({ jurisdiction: 'NI' }) }), TODAY, run).meta.jurisdiction).toBe('NI');
  });
});


// ---------------------------------------------------------------------------
// Downloads: a plain table an accountant can filter, pivot, sum and import
// ---------------------------------------------------------------------------
/** A small RFC 4180 reader: what a spreadsheet or an import tool does with the file. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur); rows.push(row);
  return rows;
}
const ids = ['profit', 'cashflow', 'balance', 'stock', 'animals', 'income', 'expenses', 'checks'] as const;
const table = (id: (typeof ids)[number], b: FarmBundle = bundle(), o: Record<string, unknown> = {}) => {
  const rows = parseCsv(docCsv(buildReport(id, b, TODAY, { ...run, ...o })));
  const head = rows[0];
  return { head, body: rows.slice(1), col: (name: string) => head.findIndex((h) => h === name || h.startsWith(`${name} (`)) };
};
const num = (v: string) => (v === '' ? 0 : Number(v));

describe('downloads are plain tables: a header row, the data and total rows, nothing else', () => {
  it('every report starts with its header row, has no blank line and no stamp, and every row is as wide as the header', () => {
    for (const id of ids) {
      const csv = docCsv(buildReport(id, bundle(), TODAY, run));
      const lines = csv.split('\n');
      expect(lines.some((l) => l.trim() === ''), `${id} has a blank line`).toBe(false);
      const rows = parseCsv(csv);
      expect(rows.length, id).toBeGreaterThan(1);
      for (const r of rows) expect(r.length, `${id}: ${r.join('|')}`).toBe(rows[0].length);
      // Nothing that belongs on the screen or in the print is in the file
      expect(csv, id).not.toMatch(/statutory|Rule version|Generated|reports@|Management report|Basis:|Retention|six years/i);
      expect(csv, id).not.toContain(String.fromCharCode(0x2014));
    }
  });
  it('the headers are the ones an accountant expects', () => {
    expect(table('profit').head).toEqual(['Section', 'Line', 'Row', 'Amount (EUR)', 'Records']);
    expect(table('cashflow').head).toEqual(['Section', 'Line', 'Row', 'Amount (EUR)', 'Records']);
    expect(table('income').head).toEqual(['Date', 'Type', 'Received from', 'Description', 'Litres', 'Head', 'Amount (EUR)', 'Agri-It id']);
    expect(table('expenses').head).toEqual(['Date', 'Type', 'Paid to', 'Description', 'Invoice no.', 'Amount (EUR)', 'VAT (EUR)', 'Without VAT (EUR)', 'Status', 'Paid on', 'Due on', 'Agri-It id']);
    expect(table('animals').head).toEqual(['Group', 'Class', 'Row', 'Start', 'Born', 'Added', 'Moved in', 'Sold', 'Moved out', 'Reduced by hand', 'End']);
    expect(table('stock').head).toEqual(['Stock', 'Item', 'Row', 'Start (kg)', 'End (kg)', 'Value at start (EUR)', 'Value at end (EUR)', 'Not valued (kg)']);
    expect(table('balance').head).toEqual(['Section', 'Line', 'Row', 'At 2025-12-31 (EUR)', 'At 2026-12-31 (EUR)', 'Change (EUR)']);
  });
  it('money columns hold plain numbers with two decimals, and an unknown figure is an empty cell', () => {
    for (const id of ['profit', 'cashflow', 'balance', 'income', 'expenses', 'stock'] as const) {
      const t = table(id);
      t.head.forEach((h, i) => { if (/\(EUR\)$/.test(h)) for (const r of t.body) expect(r[i], `${id} ${h}: ${r[i]}`).toMatch(/^(-?\d+\.\d{2})?$/); });
    }
  });
  it('profit: the total rows are the hand-worked figures and the output lines add up to Total output', () => {
    const t = table('profit'); const a = t.col('Amount');
    const row = (section: string, line: string) => t.body.find((r) => r[0] === section && r[1] === line)!;
    expect(num(row('Output', 'Total output')[a])).toBe(56000);
    expect(num(row('Gross margin', 'Gross margin (output less direct costs)')[a])).toBe(41500);
    expect(num(row('Profit', 'Profit before depreciation and capital allowances')[a])).toBe(37900);
    const lines = t.body.filter((r) => r[0] === 'Output' && r[2] === 'Line').reduce((s, r) => s + num(r[a]), 0);
    expect(lines).toBe(56000);
    // The "Row" column lets a pivot leave totals out
    expect(new Set(t.body.map((r) => r[2]))).toEqual(new Set(['Line', 'Total']));
    // Capital, loan capital and drawings are in the table, under their own section, not in the profit lines
    expect(t.body.filter((r) => r[0] === 'Not in the profit figure').map((r) => r[1])).toEqual(['Loan capital repaid', 'Machinery, buildings and land bought', 'Household drawings']);
  });
  it('profit: a figure that is not valued is an empty cell and the totals are still there', () => {
    const b = bundle({ yearValues: bundle().yearValues.filter((v) => v.id !== 'Cows open') });
    const t = table('profit', b); const a = t.col('Amount');
    const lv = t.body.find((r) => r[0] === 'Output' && r[1].startsWith('Livestock: increase'))!;
    expect(lv[a]).toBe('');
    expect(t.body.some((r) => r[1] === 'Total output' && r[2] === 'Total')).toBe(true);
    // Screen-only lines are not in the file
    expect(t.body.some((r) => /Depreciation|No income recorded/.test(r[1]))).toBe(false);
  });
  it('cash flow: money in less money out is the movement, and the closing balance is there', () => {
    const t = table('cashflow'); const a = t.col('Amount');
    const get = (line: string) => num(t.body.find((r) => r[1] === line)![a]);
    expect(get('Total money in')).toBe(51000);
    expect(get('Cash at the start of the year')).toBe(10000);
    expect(get('Cash at the start of the year') + get('Money in less money out')).toBe(get('Cash at the end'));
  });
  it('cash flow: the lines add up to the total money out even when loan interest cannot be split', () => {
    const costs = bundle().costs.map((c) => (c.id === 'c7' ? { ...c, loan_id: null, interest_eur: null } : c));
    for (const b of [bundle(), bundle({ costs } as Partial<FarmBundle>)]) {
      const t = table('cashflow', b); const a = t.col('Amount');
      const out = t.body.filter((r) => r[0] === 'Money out');
      expect(out.filter((r) => r[2] === 'Line').reduce((s, r) => s + num(r[a]), 0)).toBeCloseTo(num(out.find((r) => r[1] === 'Total money out')![a]), 2);
    }
    const t = table('cashflow', bundle({ costs } as Partial<FarmBundle>));
    expect(t.body.find((r) => r[1].startsWith('Loan repayments'))![t.col('Amount')]).toBe('5000.00');
    expect(t.body.find((r) => r[1] === 'Loan interest')![t.col('Amount')]).toBe('');
  });
  it('income and expenses: one line per record, and the total row is the sum of the lines', () => {
    const inc = table('income'); const ia = inc.col('Amount');
    const lines = inc.body.filter((r) => r[1] !== 'Total');
    expect(lines).toHaveLength(4);
    expect(lines.reduce((s, r) => s + num(r[ia]), 0)).toBe(51000);
    expect(num(inc.body.find((r) => r[1] === 'Total')![ia])).toBe(51000);
    expect(lines.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]))).toBe(true);
    const exp = table('expenses'); const ea = exp.col('Amount'); const st = exp.col('Status');
    const costs = exp.body.filter((r) => r[1] !== 'Total');
    expect(costs).toHaveLength(9);
    expect(costs.reduce((s, r) => s + num(r[ea]), 0)).toBe(37300);
    expect(num(exp.body.find((r) => r[1] === 'Total')![ea])).toBe(37300);
    expect(costs.filter((r) => r[st] === 'Owed').map((r) => num(r[ea]))).toEqual([800]);
  });
  it('balance sheet: totals equal the lines above them, in both columns', () => {
    const t = table('balance'); const s = t.col('At 2025-12-31'); const e = t.col('At 2026-12-31');
    for (const [section, total] of [['What the farm owns', 'Total assets'], ['What the farm owes', 'Total owed']]) {
      const rows = t.body.filter((r) => r[0] === section);
      for (const c of [s, e]) expect(rows.filter((r) => r[2] === 'Line').reduce((x, r) => x + num(r[c]), 0), `${section} col ${c}`).toBeCloseTo(num(rows.find((r) => r[1] === total)![c]), 2);
    }
    const nw = t.body.find((r) => r[1] === 'Net worth (owns less owes)')!;
    expect(num(nw[e]) - num(nw[s])).toBeCloseTo(num(nw[t.col('Change')]), 2);
  });
  it('animals: each group adds up and the total row is the sum of the groups', () => {
    const t = table('animals'); const end = t.col('End');
    const groups = t.body.filter((r) => r[2] === 'Line');
    expect(groups.length).toBeGreaterThan(0);
    expect(num(t.body.find((r) => r[2] === 'Total')![end])).toBe(groups.reduce((x, r) => x + num(r[end]), 0));
  });
  it('stock: has its totals even when nothing is in store', () => {
    const t = table('stock');
    expect(t.body.map((r) => r[1])).toEqual(['Total feed', 'Total fertiliser', 'Total stock']);
    expect(t.body.every((r) => r[2] === 'Total')).toBe(true);
  });
  it('a negative amount is a number, and text that could run as a formula is made safe', () => {
    const csv = tableCsv({ columns: [{ label: 'Item', type: 'text' }, { label: 'Amount (EUR)', type: 'money' }], rows: [['Refund', -12.5], ['=1+1', 0], ['Mart, Cahir', -0.001], ['Say "hi"', 3]] });
    expect(csv.split('\n')).toEqual(['Item,Amount (EUR)', 'Refund,-12.50', "'=1+1,0.00", '"Mart, Cahir",0.00', '"Say ""hi""",3.00']);
  });
  it('the other exports are plain tables too: summary, transactions and records', () => {
    const pack = yearEndPack(bundle(), TODAY, -1);
    for (const csv of [yearEndCsv(pack, 'Test Farm'), ledgerCsv(pack)]) {
      const rows = parseCsv(csv);
      expect(csv.split('\n').some((l) => l.trim() === '')).toBe(false);
      for (const r of rows) expect(r.length).toBe(rows[0].length);
    }
    const summary = parseCsv(yearEndCsv(pack, 'Test Farm'));
    expect(summary[0]).toEqual(['Section', 'Line', 'Row', 'Amount (EUR)']);
    expect(summary.some((r) => r[0] === 'Income' && r[1] === 'Total income' && r[3] === '51000.00')).toBe(true);
    // A negative month is a number, not text
    expect(summary.filter((r) => r[3].startsWith("'")).length).toBe(0);
    const records = vaultCsv([{ date: '2026-03-01', kind: 'record', title: 'Vet visit', sub: 'TB test', confirmed: true, documentId: null, fileName: null } as never]).split('\n');
    expect(records[0]).toBe('Date,Kind,What,Details,Confirmed,Attachment'.split(',').map((h) => `"${h}"`).join(','));
  });
});
