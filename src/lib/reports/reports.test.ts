import { describe, expect, it } from 'vitest';
import type { Animal, AnimalGroup, Cost, Farm, FarmBundle, Income, Loan, YearEndValue } from '../types';
import { unzipSync, strFromU8 } from 'fflate';
import { buildReport, docCsv, tableCsv } from './index';
import { ledgerCsv, yearEndCsv, yearEndPack } from '../forecast/money';
import { vaultCsv } from '../vault';
import { profitReport } from './profit';
import { balanceReport } from './balance';
import { animalsReport } from './animals';
import { fifoValue, netAmount } from './common';
import { tableXlsx } from './xlsx';
import { formatTag } from '../animalId';
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


describe('profit report: edge cases', () => {
  it('repayments not linked to a loan and with no interest cannot be split, so the profit says so', () => {
    const b = bundle({ loans: [], costs: [cost('r1', 'loan_repayment', '2026-05-01', 3000)] });
    const p = profitReport(b, TODAY, run).figures;
    expect(p.complete).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/not linked to a loan/);
  });
  it('a repayment with its own interest figure splits without a loan', () => {
    const b = bundle({ loans: [], costs: [cost('r1', 'loan_repayment', '2026-05-01', 3000, { interest_eur: 200 })] });
    expect(profitReport(b, TODAY, run).figures.interest).toBe(200);
  });
  it('a year still in progress is marked year to date, and costs dated after today are left out', () => {
    const b = bundle({ costs: [...bundle().costs, cost('f1', 'feed', '2027-12-01', 999, { payment_status: 'owed', paid_on: null })] });
    const d = profitReport(b, '2027-06-01', { now: NOW }).doc;
    expect(d.meta.provisional).toBe(true);
    expect(d.subtitle).toContain('year to date');
  });
  it('currency and jurisdiction follow the farm and are stated in the document', () => {
    expect(buildReport('profit', bundle({ farm: farm({ jurisdiction: 'NI' }) }), TODAY, run).meta.jurisdiction).toBe('NI');
  });
});

// ---------------------------------------------------------------------------
// Animals: one row per tagged animal
// ---------------------------------------------------------------------------
const animal = (id: string, tag: string, x: Partial<Animal> = {}): Animal => ({ id, farm_id: 'f', tag_number: tag, tag_source: 'typed', animal_group_id: 'g', sex: 'female', breed: null, born_on: null, status: 'on_farm', left_on: null, note: null, ...x });
const herd = (): Animal[] => [
  animal('a1', '372123456781234', { breed: 'Holstein', born_on: '2022-03-04' }),
  animal('a2', '372123456780002', { born_on: '2026-02-10', sex: 'male' }),                                  // born in 2026
  animal('a3', '372123456780003', { born_on: '2024-05-05', status: 'sold', left_on: '2026-10-01' }),      // sold in 2026
  animal('a4', '372123456780004', { born_on: '2020-01-01', status: 'died', left_on: '2026-04-04' }),      // died in 2026
  animal('a5', '372123456780005', { born_on: '2019-01-01', status: 'sold', left_on: '2025-06-01' }),      // left before 2026
  animal('a6', 'IE041234567890', { born_on: '2027-01-15', animal_group_id: null, sex: null }),             // born in 2027
  animal('a7', '372123456780007', { status: 'moved_off', left_on: '2026-08-08' })
];

describe('animals report', () => {
  const f = animalsReport(bundle({ animals: herd() }), TODAY, run).figures;
  it('lists the animals that were on the farm at some point in the year, and leaves out one that left before it', () => {
    expect(f.lines.map((l) => l.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a7']);
  });
  it('counts born, sold, died, moved off and on the farm at the end', () => {
    expect(f).toMatchObject({ bornInYear: 1, soldInYear: 1, diedInYear: 1, movedOffInYear: 1, onFarmAtEnd: 2, leftNoDate: 0, complete: true });
  });
  it('an animal that left with no date is flagged, because it cannot be put in a year', () => {
    const g = animalsReport(bundle({ animals: [animal('x', '372123456780009', { status: 'sold' })] }), TODAY, run).figures;
    expect(g.leftNoDate).toBe(1);
    expect(g.complete).toBe(false);
    expect(g.onFarmAtEnd).toBe(0);
  });
  it('no animals gives an empty list, not an error', () => {
    const g = animalsReport(bundle({ animals: [] }), TODAY, run);
    expect(g.figures.lines).toEqual([]);
    expect(g.doc.table.rows).toEqual([]);
  });
  it('the year in progress runs to today', () => {
    const g = animalsReport(bundle({ animals: herd() }), '2027-02-01', { now: NOW }).figures;
    expect(g.lines.map((l) => l.id).sort()).toEqual(['a1', 'a2', 'a6']);
    expect(g.bornInYear).toBe(1);
    expect(g.onFarmAtEnd).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Downloads: a plain table with a header row, the values and nothing else
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
const ids = ['profit', 'balance', 'animals'] as const;
// control characters, zero-width and joiner characters, line separators, byte-order mark and the replacement character
const HIDDEN = new RegExp(`[${['0000-0008', '000B-001F', '200B-200F', '2060', '2028-2029', 'FEFF', 'FFFD'].map((r) => r.split('-').map((h) => `\\u${h}`).join('-')).join('')}]`);
const withHerd = () => bundle({ animals: herd() });
const table = (id: (typeof ids)[number], b: FarmBundle = withHerd(), o: Record<string, unknown> = {}) => {
  const rows = parseCsv(docCsv(buildReport(id, b, TODAY, { ...run, ...o })));
  const head = rows[0];
  return { head, body: rows.slice(1), col: (name: string) => head.findIndex((h) => h === name || h.startsWith(`${name} (`)) };
};
const num = (v: string) => (v === '' ? 0 : Number(v));

describe('downloads are plain tables: a header row and the values, nothing else', () => {
  it('every report starts with its header row, has no blank line and no stamp, and every row is as wide as the header', () => {
    for (const id of ids) {
      const csv = docCsv(buildReport(id, withHerd(), TODAY, run));
      expect(csv.split('\n').some((l) => l.trim() === ''), `${id} has a blank line`).toBe(false);
      const rows = parseCsv(csv);
      expect(rows.length, id).toBeGreaterThan(1);
      for (const r of rows) expect(r.length, `${id}: ${r.join('|')}`).toBe(rows[0].length);
      expect(csv, id).not.toMatch(/statutory|Rule version|Generated|reports@|Management report|Basis:|Retention|six years/i);
      expect(csv, id).not.toContain(String.fromCharCode(0x2014));
    }
  });
  it('no byte-order mark, no hidden characters and nothing outside plain text in any report file', () => {
    for (const id of ids) {
      const csv = docCsv(buildReport(id, withHerd(), TODAY, run));
      expect(csv.charCodeAt(0), id).not.toBe(0xfeff);

      expect(HIDDEN.test(csv), id).toBe(false);
    }
  });
  it('the headers are short names only', () => {
    expect(table('profit').head).toEqual(['Section', 'Item', 'Amount (EUR)']);
    expect(table('balance').head).toEqual(['Section', 'Item', 'At 31 Dec 2025 (EUR)', 'At 31 Dec 2026 (EUR)', 'Change (EUR)']);
    expect(table('animals').head).toEqual(['Tag number', 'Group', 'Sex', 'Breed', 'Born', 'Status', 'Left']);
  });
  it('money columns hold plain numbers with two decimals, and an unknown figure is an empty cell', () => {
    for (const id of ['profit', 'balance'] as const) {
      const t = table(id);
      t.head.forEach((h, i) => { if (/\(EUR\)$/.test(h)) for (const r of t.body) expect(r[i], `${id} ${h}: ${r[i]}`).toMatch(/^(-?\d+\.\d{2})?$/); });
    }
  });
  it('profit: the total rows are the hand-worked figures and the output lines add up to Total output', () => {
    const t = table('profit'); const a = t.col('Amount');
    const row = (section: string, item: string) => t.body.find((r) => r[0] === section && r[1] === item)!;
    expect(num(row('Output', 'Total output')[a])).toBe(56000);
    expect(num(row('Gross margin', 'Gross margin')[a])).toBe(41500);
    expect(num(row('Profit', 'Profit before depreciation')[a])).toBe(37900);
    const lines = t.body.filter((r) => r[0] === 'Output' && !/^Total/.test(r[1]));
    // Sales by type, the change in livestock and money owed: the sales subtotal is the one line to leave out
    expect(lines.filter((r) => r[1] !== 'Total sales').reduce((s, r) => s + num(r[a]), 0)).toBe(56000);
    expect(t.body.filter((r) => r[0] === 'Not in profit').map((r) => r[1])).toEqual(['Loan capital repaid', 'Machinery, buildings and land bought', 'Household drawings']);
    // Plain words for what changed
    expect(t.body.some((r) => r[1] === 'Change in livestock')).toBe(true);
  });
  it('profit: a figure that is not valued is an empty cell and the totals are still there', () => {
    const b = bundle({ yearValues: bundle().yearValues.filter((v) => v.id !== 'Cows open') });
    const t = table('profit', b); const a = t.col('Amount');
    expect(t.body.find((r) => r[0] === 'Output' && r[1] === 'Change in livestock')![a]).toBe('');
    expect(t.body.some((r) => r[1] === 'Total output')).toBe(true);
    expect(t.body.some((r) => /Depreciation|No income recorded/.test(r[1]))).toBe(false);
  });
  it('balance sheet: totals equal the lines above them, in both columns', () => {
    const t = table('balance'); const s = 2; const e = 3;
    for (const [section, total] of [['Owns', 'Total owned'], ['Owes', 'Total owed']]) {
      const rows = t.body.filter((r) => r[0] === section);
      for (const c of [s, e]) expect(rows.filter((r) => r[1] !== total).reduce((x, r) => x + num(r[c]), 0), `${section} col ${c}`).toBeCloseTo(num(rows.find((r) => r[1] === total)![c]), 2);
    }
    const nw = t.body.find((r) => r[1] === 'Net worth')!;
    expect(num(nw[e]) - num(nw[s])).toBeCloseTo(num(nw[4]), 2);
  });
  it('animals: one row per animal, tag shown with spaces, dates as day/month/year, empty cells where nothing is known', () => {
    const t = table('animals');
    expect(t.body).toHaveLength(5);
    const a1 = t.body.find((r) => r[0] === formatTag('372123456781234'))!;
    expect(a1).toEqual(['372 12 34567 8 1234', 'Cows', 'Female', 'Holstein', '04/03/2022', 'On the farm', '']);
    const a3 = t.body.find((r) => r[0] === formatTag('372123456780003'))!;
    expect([a3[4], a3[5], a3[6]]).toEqual(['05/05/2024', 'Sold', '01/10/2026']);
    expect(t.body.find((r) => r[0] === formatTag('372123456780007'))!.slice(4)).toEqual(['', 'Moved off', '08/08/2026']);
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
    expect(summary.filter((r) => r[3].startsWith("'")).length).toBe(0);
    const records = vaultCsv([{ date: '2026-03-01', kind: 'record', title: 'Vet visit', sub: 'TB test', confirmed: true, documentId: null, fileName: null } as never]).split('\n');
    expect(records[0]).toBe('Date,Kind,What,Details,Confirmed,Attachment'.split(',').map((h) => `"${h}"`).join(','));
  });
});

describe('Excel download', () => {
  const unzip = (t: Parameters<typeof tableXlsx>[0]) => { const z = unzipSync(tableXlsx(t, 'Test')); return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, strFromU8(v)])); };
  it('is a zip holding the parts of a workbook, with the header row first and bold', () => {
    const x = unzip(buildReport('animals', withHerd(), TODAY, run).table);
    expect(Object.keys(x).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = x['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t>Tag number</t></is></c>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<c r="A2" s="0" t="inlineStr">');
  });
  it('keeps numbers as numbers and dates as dates', () => {
    const x = unzip({ columns: [{ label: 'Item', type: 'text' }, { label: 'Amount (EUR)', type: 'money' }, { label: 'Born', type: 'date' }], rows: [['Total', 1234.5, '2026-02-10'], ['Net', -3, null]], strong: [0] });
    const sheet = x['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="B2" s="6"><v>1234.5</v></c>');
    expect(sheet).toContain('<c r="C2" s="3"><v>46063</v></c>');
    expect(sheet).toContain('<c r="B3" s="2"><v>-3</v></c>');
    expect(sheet).not.toContain('r="C3"');
  });
  it('writes accents, the euro sign and markup characters safely, and drops control characters', () => {
    const x = unzip({ columns: [{ label: 'Paid to', type: 'text' }], rows: [['Seán Ó Briain & Sons <Mart> €5'], ['bad\u0001char']] });
    const sheet = x['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('Seán Ó Briain &amp; Sons &lt;Mart&gt; €5');
    expect(sheet).toContain('badchar');
    expect(sheet).not.toContain('\u0001');
    expect(sheet.charCodeAt(0)).not.toBe(0xfeff);
  });
});
