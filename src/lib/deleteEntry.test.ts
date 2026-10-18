import { describe, expect, it } from 'vitest';
import { planDelete } from './deleteEntry';
import type { FarmBundle } from './types';

const bundle = (o: Record<string, unknown> = {}) => ({
  role: 'owner', txns: [], costs: [], income: [], products: [{ id: 'p', name: 'Dairy nut' }], fertilisers: [{ id: 'fp', name: 'CAN' }], fertStock: [], spreads: [], spreadFields: [],
  fields: [{ id: 'f1', name: 'Home field' }, { id: 'f2', name: 'Long meadow' }], jobs: [], records: [], completions: [], expected: [], groups: [{ id: 'g', name: 'Cows', head_count: 50 }], ...o
}) as unknown as FarmBundle;

const delivery = { id: 't1', farm_id: 'f', feed_product_id: 'p', txn_type: 'delivery', quantity_kg: 8000, delivery_date: '2026-10-01', effective_on: '2026-10-01', linked_order_id: null };
const bill = { id: 'c1', farm_id: 'f', category: 'feed', amount_eur: 2800, occurred_on: '2026-10-01', payment_status: 'owed', supplier_name: 'Tirlán', feed_transaction_id: 't1' };

describe('deleting what was saved', () => {
  it('a delivery goes with its bill, and the farmer is told so', () => {
    const b = bundle({ txns: [delivery], costs: [bill] });
    const p = planDelete('feed', 't1', b)!;
    expect(p.lines.join(' ')).toMatch(/8 t of Dairy nut/);
    expect(p.lines.join(' ')).toMatch(/Its bill of .*2,800.*still to pay/);
    expect(p.ops).toEqual([{ kind: 'rpc', fn: 'undo_feed_delivery', args: { p_id: 't1' } }]);
    expect(p.undo.map((o) => (o as { table: string }).table)).toEqual(['feed_transactions', 'costs']);
    const after = p.patch(b);
    expect(after.txns).toHaveLength(0);
    expect(after.costs).toHaveLength(0);
  });

  it('deleting a delivery opens its order again', () => {
    const order = { id: 'o1', farm_id: 'f', feed_product_id: 'p', txn_type: 'order', quantity_kg: 8000, order_status: 'delivered', order_date: '2026-09-28', effective_on: '2026-10-01' };
    const b = bundle({ txns: [order, { ...delivery, linked_order_id: 'o1' }] });
    const p = planDelete('feed', 't1', b)!;
    expect(p.effects.join(' ')).toMatch(/open again/);
    expect(p.patch(b).txns.find((t) => t.id === 'o1')!.order_status).toBe('open');
    expect(p.undo).toContainEqual({ kind: 'update', table: 'feed_transactions', match: { id: 'o1' }, patch: { order_status: 'delivered' } });
  });

  it('a stock check is a plain delete', () => {
    const b = bundle({ txns: [{ ...delivery, id: 't2', txn_type: 'count' }] });
    expect(planDelete('feed', 't2', b)!.ops).toEqual([{ kind: 'delete', table: 'feed_transactions', match: { id: 't2' } }]);
  });

  it('a bill that belongs to a delivery cannot be deleted on its own', () => {
    expect(planDelete('cost', 'c1', bundle({ txns: [delivery], costs: [bill] }))).toBeNull();
    const own = { ...bill, id: 'c2', feed_transaction_id: null };
    expect(planDelete('cost', 'c2', bundle({ costs: [own] }))!.ops).toEqual([{ kind: 'delete', table: 'costs', match: { id: 'c2' } }]);
  });

  it('a routine tick that made a record is taken off with it', () => {
    const own = { ...bill, id: 'c2', feed_transaction_id: null };
    const tick = { id: 'k', routine_id: 'r', due_date: '2026-10-02', status: 'done', record_table: 'costs', record_id: 'c2' };
    const b = bundle({ costs: [own], completions: [tick] });
    const p = planDelete('cost', 'c2', b)!;
    expect(p.lines.join(' ')).toMatch(/tick on your routine/);
    expect(p.ops).toContainEqual({ kind: 'delete', table: 'routine_completions', match: { routine_id: 'r', due_date: '2026-10-02' } });
    expect(p.patch(b).completions).toHaveLength(0);
  });

  it('a farm worker cannot delete money', () => {
    const own = { ...bill, id: 'c2', feed_transaction_id: null };
    expect(planDelete('cost', 'c2', bundle({ role: 'worker', costs: [own] }))).toBeNull();
    expect(planDelete('income', 'i', bundle({ role: 'worker', income: [{ id: 'i', income_type: 'milk', amount_eur: 1, occurred_on: '2026-10-01' }] }))).toBeNull();
    expect(planDelete('feed', 't1', bundle({ role: 'worker', txns: [delivery], costs: [bill] }))).toBeNull();
  });

  it('a sale can put the animals back, or leave the group alone', () => {
    const sale = { id: 'i', farm_id: 'f', income_type: 'livestock', amount_eur: 3000, occurred_on: '2026-10-05', animal_group_id: 'g', head_count: 4, counterparty: 'Mart' };
    const b = bundle({ income: [sale] });
    const yes = planDelete('income', 'i', b)!;
    expect(yes.animalsBack).toEqual({ group: 'Cows', head: 4 });
    expect(yes.ops[0]).toMatchObject({ kind: 'rpc', fn: 'undo_animal_sale' });
    expect(yes.patch(b).groups[0].head_count).toBe(54);
    const no = planDelete('income', 'i', b, { putAnimalsBack: false })!;
    expect(no.ops[0]).toMatchObject({ kind: 'delete', table: 'income' });
    expect(no.patch(b).groups[0].head_count).toBe(50);
  });

  it('a received grant goes back to the plan as still to come', () => {
    const inc = { id: 'i', farm_id: 'f', income_type: 'grant', amount_eur: 900, occurred_on: '2026-10-05' };
    const b = bundle({ income: [inc], expected: [{ id: 'e', label: 'Basic payment', income_id: 'i' }] });
    const p = planDelete('income', 'i', b)!;
    expect(p.effects.join(' ')).toMatch(/Basic payment/);
    expect(p.patch(b).expected![0].income_id).toBeNull();
  });

  it('a fertiliser delivery goes with its bill; a spreading with its fields', () => {
    const stock = { id: 's', farm_id: 'f', product_id: 'fp', kind: 'delivery', quantity_kg: 2000, on_date: '2026-10-01', cost_id: 'fc' };
    const fb = { ...bill, id: 'fc', feed_transaction_id: null, category: 'fertiliser' };
    const p = planDelete('fert', 's', bundle({ fertStock: [stock], costs: [fb] }))!;
    expect(p.ops.map((o) => (o as { table: string }).table)).toEqual(['costs', 'fertiliser_stock']);
    const sp = { id: 'sp', farm_id: 'f', product_id: 'fp', spread_on: '2026-10-03', total_kg: 1000 };
    const fields = [{ id: 'a', spread_id: 'sp', field_id: 'f1' }, { id: 'b', spread_id: 'sp', field_id: 'f2' }];
    const b = bundle({ spreads: [sp], spreadFields: fields });
    const q = planDelete('spread', 'sp', b)!;
    expect(q.lines.join(' ')).toMatch(/2 fields: Home field, Long meadow/);
    expect(q.undo.map((o) => (o as { table: string }).table)).toEqual(['fertiliser_spreads', 'fertiliser_spread_fields', 'fertiliser_spread_fields']);
    expect(q.patch(b).spreadFields).toHaveLength(0);
  });

  it('a record or job that is not there gives no plan', () => {
    expect(planDelete('job', 'x', bundle())).toBeNull();
    expect(planDelete('record', 'x', bundle())).toBeNull();
  });
});
