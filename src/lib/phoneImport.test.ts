import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chunkPlan, IMPORT_ORDER, parseBackup, planPhoneImport, resultLine, sumResults } from './phoneImport';

// A real backup, made by scripts/e2e/make_phone_backup.py against `npm run build:phone`:
// 16 dairy cows (one added from today), Dairy nut 16% with a plan, 6 t delivered on account,
// a paid vet bill, an overdue contractor bill, a milk cheque and today's feeding ticked.
const text = readFileSync(new URL('./testing/fixtures/phone-backup.json', import.meta.url), 'utf8');
const backup = parseBackup(text);
const phoneFarm = backup.db.farms[0];
const ONLINE = '7f000000-0000-4000-8000-000000000001';

describe('phone backup import plan', () => {
  const plan = planPhoneImport(backup, ONLINE);

  it('reads a real backup and refuses anything else', () => {
    expect(backup.kind).toBe('phone-backup');
    expect(() => parseBackup('{"app":"agri-it"')).toThrow(/not a complete/);
    expect(() => parseBackup('{"hello":1}')).toThrow(/not an Agri-It phone backup/);
  });

  it('moves every record of the farm into the online farm, keeping ids', () => {
    for (const t of IMPORT_ORDER) {
      const src = (backup.db[t] ?? []).filter((r) => r.farm_id === phoneFarm.id);
      expect(plan.rows[t].map((r) => r.id ?? `${r.supplier_id}`)).toEqual(
        expect.arrayContaining(src.map((r) => r.id ?? `${r.supplier_id}`))
      );
      expect(plan.rows[t].length).toBe(src.length);
      for (const r of plan.rows[t]) expect(r.farm_id).toBe(ONLINE);
    }
    expect(plan.total).toBeGreaterThanOrEqual(10);
    expect(plan.counts.costs).toBe(3);
  });

  it('keeps dates and paid/owed state exactly', () => {
    const src = backup.db.costs;
    for (const c of plan.rows.costs) {
      const o = src.find((x) => x.id === c.id)!;
      expect([c.occurred_on, c.payment_status, c.paid_on, c.due_on, c.amount_eur, c.created_at]).toEqual(
        [o.occurred_on, o.payment_status, o.paid_on, o.due_on, o.amount_eur, o.created_at]
      );
    }
    const owed = plan.rows.costs.filter((c) => c.payment_status === 'owed');
    expect(owed).toHaveLength(2);
    expect(owed.every((c) => c.paid_on === null && c.due_on)).toBe(true);
    // The delivery on account keeps its link to the feed delivery
    const feedCost = plan.rows.costs.find((c) => c.feed_transaction_id)!;
    expect(plan.rows.feed_transactions.some((t) => t.id === feedCost.feed_transaction_id)).toBe(true);
  });

  it('leaves out shared reference data, people and the on-phone history', () => {
    expect(plan.rows.suppliers).toHaveLength(0); // all seven are the shared directory
    const keys = Object.keys(plan.rows);
    for (const t of ['evidence_sources', 'forage_benchmarks', 'supplier_branches', 'farms', 'farm_members', 'audit_log', 'forecast_snapshots']) {
      expect(keys).not.toContain(t);
    }
    // ...but links to directory suppliers are kept as they are (same ids online)
    expect(plan.rows.farm_supplier_settings[0].supplier_id).toBe('10000000-0000-0000-0000-000000000002');
  });

  it('carries the money and feed settings, not the name or address', () => {
    expect(plan.farm.opening_cash_eur).toBe(phoneFarm.opening_cash_eur);
    expect(plan.farm.opening_cash_date).toBe(phoneFarm.opening_cash_date);
    expect(plan.farm.enterprises).toEqual(['dairy']);
    expect(plan.farm).not.toHaveProperty('name');
    expect(plan.farm).not.toHaveProperty('county');
    expect(plan.phoneFarmName).toBe('Phone Farm');
  });

  it('is the same plan every time (so a second run adds nothing)', () => {
    expect(planPhoneImport(backup, ONLINE)).toEqual(plan);
  });

  it('puts orders before the deliveries that point at them, and moves photo paths', () => {
    const b = structuredClone(backup);
    const f = String(phoneFarm.id);
    const order = { id: '7f000000-0000-4000-8000-0000000000aa', farm_id: f, txn_type: 'order', quantity_kg: 1000 };
    b.db.feed_transactions = [{ id: '7f000000-0000-4000-8000-0000000000ab', farm_id: f, txn_type: 'delivery', linked_order_id: order.id }, order];
    b.db.documents = [{ id: '7f000000-0000-4000-8000-0000000000ac', farm_id: f, storage_path: `${f}/docket.jpg` }];
    const p = planPhoneImport(b, ONLINE);
    expect(p.rows.feed_transactions.map((t) => t.txn_type)).toEqual(['order', 'delivery']);
    expect(p.rows.documents[0].storage_path).toBe(`${ONLINE}/docket.jpg`);
    expect(p.photoPaths).toEqual([{ from: `${f}/docket.jpg`, to: `${ONLINE}/docket.jpg` }]);
  });

  it('older phone costs without payment fields count as paid on the day', () => {
    const b = structuredClone(backup);
    for (const c of b.db.costs) { delete c.payment_status; delete c.paid_on; }
    expect(planPhoneImport(b, ONLINE).rows.costs.every((c) => c.payment_status === 'paid')).toBe(true);
  });

  it('asks which farm when a backup holds two', () => {
    const b = structuredClone(backup);
    b.db.farms.push({ ...phoneFarm, id: '7f000000-0000-4000-8000-0000000000ff', name: 'Outfarm' });
    expect(() => planPhoneImport(b, ONLINE)).toThrow(/more than one farm/);
    expect(planPhoneImport(b, ONLINE, '7f000000-0000-4000-8000-0000000000ff').total).toBe(0);
  });

  it('splits big plans in table order and sums results in plain words', () => {
    const chunks = chunkPlan(plan, 4);
    expect(chunks.reduce((a, c) => a + Object.values(c).reduce((n, r) => n + (r?.length ?? 0), 0), 0)).toBe(plan.total);
    const r = sumResults([{ added: 9, already: 0, blocked: 0, failed: 0, firstError: null }, { added: 0, already: 2, blocked: 1, failed: 0, firstError: null }]);
    expect(resultLine(r)).toBe('9 records moved, 2 already here. 1 belongs to another farm in Agri-It and were left alone.');
    expect(resultLine({ added: 0, already: 12, blocked: 0, failed: 0, firstError: null })).toBe('12 already here.');
  });
});
