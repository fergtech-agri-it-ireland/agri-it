/**
 * The downloads on the seeded demo farm (Glenview Farm, the same data the browser demo shows),
 * for both years and both bases: every file must be a plain table. A header row, rows as wide as
 * the header, no blank lines, no title or notes, numbers that parse, totals that add up.
 */
import { describe, expect, it } from 'vitest';
import { _testDb, _testReset } from '../demo/client';
import { bundleFrom } from '../testing/bundle';
import { addDays, todayISO } from '../format';
import { ledgerCsv, packReadme, yearEndCsv, yearEndPack } from '../forecast/money';
import { vaultCsv, vaultItems } from '../vault';
import { buildReport, docCsv, REPORT_LIST, tableCsv } from './index';
import type { FarmBundle } from '../types';

function parse(text: string): string[][] {
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

const today = todayISO();
function demo(): FarmBundle {
  _testReset();
  const farm = (_testDb() as unknown as { farms: { id: string }[] }).farms[0].id;
  return bundleFrom(_testDb(), farm);
}

function assertPlain(name: string, csv: string, allowEmpty = false) {
  expect(csv.length, name).toBeGreaterThan(10);
  expect(csv.split('\n').some((l) => l.trim() === ''), `${name}: blank line`).toBe(false);
  const rows = parse(csv);
  expect(rows.length, name).toBeGreaterThan(allowEmpty ? 0 : 1);
  for (const r of rows) expect(r.length, `${name}: ${r.join('|')}`).toBe(rows[0].length);
  // The header is a header: no cell in it is a number, and no title or stamp is in the file
  expect(rows[0].every((h) => h !== '' && Number.isNaN(Number(h))), `${name}: header`).toBe(true);
  expect(csv, name).not.toMatch(/Rule version|Generated|reports@|Management report|statutory|Missing,|Note,/i);
  expect(csv, name).not.toContain(String.fromCharCode(0x2014));
  // No number was turned into text by the formula guard
  expect(csv, name).not.toMatch(/(^|,)'-?\d/m);
  return rows;
}

describe('downloads on the demo farm are plain tables', () => {
  for (const offset of [0, -1]) {
    it(`every report, ${offset === 0 ? 'this year' : 'last year'}, accruals and cash`, () => {
      const b = demo();
      for (const r of REPORT_LIST) {
        for (const basis of r.id === 'profit' ? (['accruals', 'cash'] as const) : (['accruals'] as const)) {
          // The demo farm has no tagged animals, so its animal report is a header and nothing else
          assertPlain(`${r.id} ${offset} ${basis}`, docCsv(buildReport(r.id, b, today, { offset, basis })), r.id === 'animals');
        }
      }
    });
    it(`summary, transactions and records, ${offset === 0 ? 'this year' : 'last year'}`, () => {
      const b = demo();
      const pack = yearEndPack(b, today, offset);
      assertPlain('summary', yearEndCsv(pack, b.farm.name));
      const led = assertPlain('transactions', ledgerCsv(pack));
      // Every ledger line and both total rows are as wide as the header, and the totals are the sums of the lines
      const amount = led[0].findIndex((h) => h.startsWith('Amount'));
      const lines = led.filter((r) => /^\d{4}-/.test(r[0]));
      const totalIn = Number(led.find((r) => r[1] === 'Total in')![amount]);
      expect(lines.filter((r) => r[1] === 'In').reduce((s, r) => s + Number(r[amount]), 0)).toBeCloseTo(totalIn, 2);
      const inYear = (d: string) => d >= pack.fy.start && d <= pack.fy.end;
      assertPlain('records', vaultCsv(vaultItems(b).filter((i) => inYear(i.date))), true); // a year with no records is a header and nothing else
    });
  }
  it('what the files leave out is in the pack README, in words', () => {
    const b = demo();
    const pack = yearEndPack(b, today, 0);
    const docs = REPORT_LIST.map((r) => buildReport(r.id, b, today, {}));
    const readme = packReadme(pack, b.farm.name, docs.map((d) => ({ title: d.title, basisNote: d.basisNote, complete: d.completeness.complete, reasons: d.completeness.reasons, notes: d.completeness.notes, footnotes: d.footnotes, provisional: d.meta.provisional, rule: d.meta.rule })));
    expect(readme).toContain('Profit and loss');
    expect(readme).toMatch(/Basis: Accruals/);
    expect(readme).toContain('Rule reports@1.0');
    expect(readme).toMatch(/not statutory accounts|not a set of statutory accounts/);
    expect(readme).toContain('FOR THE ACCOUNTANT: TO GATHER');
    expect(readme).not.toContain(String.fromCharCode(0x2014));
  });
  it('the profit report names its basis and year-to-date in the file name inputs, not in the file', () => {
    const d = buildReport('profit', demo(), today, { basis: 'cash' });
    expect(d.meta.basis).toBe('cash');
    expect(typeof d.meta.provisional).toBe('boolean');
    expect(tableCsv(d.table).split('\n')[0]).toBe('Section,Item,Amount (EUR)');
    void addDays;
  });
});
