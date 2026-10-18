import type { Op } from './offline/outbox';
import type { FarmBundle, RoutineCompletion } from './types';
import { COST_LABEL, INCOME_LABEL } from './types';
import { eur, fmtDay, fmtKg } from './format';

/**
 * Deleting something already saved (18 Oct 2026). Pure rules for what goes with a record, so the
 * confirmation can list it all before anything is removed, and Undo can put every row back.
 */
export type DeleteKind = 'feed' | 'cost' | 'income' | 'fert' | 'spread' | 'job' | 'record';

export interface DeletePlan {
  /** "this delivery of 8 t of Dairy nut on 1 Oct" */
  what: string;
  /** Everything that will be removed or changed, one plain line each */
  lines: string[];
  /** Things that change but are not removed, e.g. an order opened again */
  effects: string[];
  ops: Op[];
  undo: Op[];
  patch: (b: FarmBundle) => FarmBundle;
  /** Livestock sales only: the choice to put the animals back in the group */
  animalsBack?: { group: string; head: number };
}

const row = (r: object) => ({ ...r }) as unknown as Record<string, unknown>;
const stripLocal = <T extends object>(r: T) => { const { id: _id, created_at: _c, ...rest } = r as Record<string, unknown>; return rest; }; // eslint-disable-line @typescript-eslint/no-unused-vars

/** A routine tick that created this record is taken off too, so the task shows as due again */
function tickFor(b: FarmBundle, table: string, id: string): RoutineCompletion | undefined {
  return b.completions.find((c) => c.record_table === table && c.record_id === id);
}

function tickOps(c: RoutineCompletion | undefined): { ops: Op[]; undo: Op[]; line: string[] } {
  if (!c) return { ops: [], undo: [], line: [] };
  return {
    ops: [{ kind: 'delete', table: 'routine_completions', match: { routine_id: c.routine_id, due_date: c.due_date } }],
    undo: [{ kind: 'upsert', table: 'routine_completions', row: stripLocal(c), onConflict: 'routine_id,due_date' }],
    line: [`The tick on your routine for ${fmtDay(c.due_date)}, so it shows as due again`]
  };
}

/** Plan the delete of one record. null = it isn't there, or this person may not delete it. */
export function planDelete(kind: DeleteKind, id: string, b: FarmBundle, opts: { putAnimalsBack?: boolean } = {}): DeletePlan | null {
  const money = b.role !== 'worker';

  // ---- Feed: delivery, order, stock check, adjustment, opening stock --------------------------
  if (kind === 'feed') {
    const t = b.txns.find((x) => x.id === id);
    if (!t) return null;
    const p = b.products.find((x) => x.id === t.feed_product_id);
    const name = p?.name ?? 'feed';
    const cost = b.costs.find((c) => c.feed_transaction_id === t.id);
    if (cost && !money) return null; // a worker never removes a bill
    const kg = fmtKg(Math.abs(Number(t.quantity_kg)));
    const day = fmtDay(t.delivery_date ?? t.order_date ?? t.effective_on);
    const noun = ({ delivery: `delivery of ${kg} of ${name}`, order: `order of ${kg} of ${name}`, count: `stock check of ${name}`, adjustment: `stock adjustment of ${name}`, opening: `opening stock of ${name}` } as Record<string, string>)[t.txn_type] ?? `entry for ${name}`;
    const lines = [`The ${noun}, ${day}`];
    const effects: string[] = [];
    const ops: Op[] = [];
    const undo: Op[] = [];
    let orderPatch: ((x: FarmBundle) => FarmBundle) | null = null;
    if (t.txn_type === 'delivery') {
      ops.push({ kind: 'rpc', fn: 'undo_feed_delivery', args: { p_id: t.id } });
      undo.push({ kind: 'insert', table: 'feed_transactions', row: row(t) });
      if (cost) {
        lines.push(`Its bill of ${eur(Number(cost.amount_eur), true)} (${cost.payment_status === 'owed' ? 'still to pay' : 'paid'})`);
        undo.push({ kind: 'insert', table: 'costs', row: row(cost) });
      }
      const order = t.linked_order_id ? b.txns.find((x) => x.id === t.linked_order_id) : undefined;
      if (order && order.order_status === 'delivered') {
        const others = b.txns.filter((x) => x.txn_type === 'delivery' && x.linked_order_id === order.id && x.id !== t.id).reduce((s, x) => s + Number(x.quantity_kg), 0);
        if (others < Number(order.quantity_kg)) {
          effects.push(`The order of ${fmtKg(Number(order.quantity_kg))} it was against is open again`);
          undo.push({ kind: 'update', table: 'feed_transactions', match: { id: order.id }, patch: { order_status: 'delivered' } });
          orderPatch = (x) => ({ ...x, txns: x.txns.map((y) => (y.id === order.id ? { ...y, order_status: 'open' as const } : y)) });
        }
      }
    } else {
      ops.push({ kind: 'delete', table: 'feed_transactions', match: { id: t.id } });
      undo.push({ kind: 'insert', table: 'feed_transactions', row: row(t) });
      if (t.txn_type === 'order') {
        const against = b.txns.filter((x) => x.linked_order_id === t.id);
        if (against.length) effects.push(`${against.length} ${against.length === 1 ? 'delivery' : 'deliveries'} against it stay${against.length === 1 ? 's' : ''}, no longer linked to an order`);
      }
    }
    const tick = tickOps(tickFor(b, 'feed_transactions', t.id));
    lines.push(...tick.line);
    ops.push(...tick.ops);
    undo.push(...tick.undo);
    effects.push(`${name} stock and run-out date are worked out again without it`);
    const gone = tick.ops.length ? tickFor(b, 'feed_transactions', t.id)!.id : null;
    return {
      what: `this ${noun}`, lines, effects, ops, undo,
      patch: (x) => {
        const y = { ...x, txns: x.txns.filter((r) => r.id !== t.id), costs: x.costs.filter((c) => c.feed_transaction_id !== t.id), completions: gone ? x.completions.filter((c) => c.id !== gone) : x.completions };
        return orderPatch ? orderPatch(y) : y;
      }
    };
  }

  // ---- A bill or cost (not one that belongs to a delivery) -----------------------------------
  if (kind === 'cost') {
    const c = b.costs.find((x) => x.id === id);
    if (!c || !money) return null;
    const fertCostIds = new Set(b.fertStock.map((s) => s.cost_id).filter(Boolean) as string[]);
    if (c.feed_transaction_id || fertCostIds.has(c.id)) return null; // removed with its delivery
    const tickRow = tickFor(b, 'costs', c.id);
    const tick = tickOps(tickRow);
    const what = `this ${c.payment_status === 'owed' ? 'bill' : 'cost'} of ${eur(Number(c.amount_eur), true)}${c.supplier_name ? ` to ${c.supplier_name}` : ''}`;
    return {
      what,
      lines: [`${COST_LABEL[c.category]}, ${eur(Number(c.amount_eur), true)}${c.supplier_name ? ` to ${c.supplier_name}` : ''}, ${fmtDay(c.occurred_on)}, ${c.payment_status === 'owed' ? 'still to pay' : 'paid'}`, ...tick.line],
      effects: ['Cash, the budget and the year-end pack are worked out again without it'],
      ops: [{ kind: 'delete', table: 'costs', match: { id: c.id } }, ...tick.ops],
      undo: [{ kind: 'insert', table: 'costs', row: row(c) }, ...tick.undo],
      patch: (x) => ({ ...x, costs: x.costs.filter((r) => r.id !== c.id), completions: tickRow ? x.completions.filter((r) => r.id !== tickRow.id) : x.completions })
    };
  }

  // ---- Income: milk cheque, sale, grant, grain ------------------------------------------------
  if (kind === 'income') {
    const i = b.income.find((x) => x.id === id);
    if (!i || !money) return null;
    const tickRow = tickFor(b, 'income', i.id);
    const tick = tickOps(tickRow);
    const linked = (b.expected ?? []).filter((e) => e.income_id === i.id);
    const group = i.income_type === 'livestock' && i.animal_group_id && i.head_count ? b.groups.find((g) => g.id === i.animal_group_id) : undefined;
    const back = !!group && opts.putAnimalsBack !== false;
    const lines = [`${INCOME_LABEL[i.income_type]}, ${eur(Number(i.amount_eur), true)}${i.counterparty ? ` from ${i.counterparty}` : ''}, ${fmtDay(i.occurred_on)}`, ...tick.line];
    const effects = ['Income, cash and the year-end pack are worked out again without it'];
    if (linked.length) effects.push(`${linked.map((e) => e.label).join(', ')} goes back to the plan as a payment still to come`);
    if (back && group) effects.push(`${i.head_count} head go back into ${group.name}`);
    const ops: Op[] = back
      ? [{ kind: 'rpc', fn: 'undo_animal_sale', args: { p_income_id: i.id } }, ...tick.ops]
      : [{ kind: 'delete', table: 'income', match: { id: i.id } }, ...tick.ops];
    const undo: Op[] = back && group
      ? [{ kind: 'rpc', fn: 'record_animal_sale', args: { p_id: i.id, p_farm_id: i.farm_id, p_group_id: group.id, p_head_count: i.head_count, p_amount_eur: i.amount_eur, p_occurred_on: i.occurred_on, p_counterparty: i.counterparty, p_reduce_group: true } }, ...tick.undo]
      : [{ kind: 'insert', table: 'income', row: row(i) }, ...tick.undo];
    if (linked.length) undo.push(...linked.map((e) => ({ kind: 'update' as const, table: 'expected_income', match: { id: e.id }, patch: { income_id: i.id } })));
    return {
      what: `this ${i.income_type === 'milk' ? 'milk cheque' : i.income_type === 'livestock' ? 'sale' : 'income'} of ${eur(Number(i.amount_eur), true)}`,
      lines, effects, ops, undo,
      animalsBack: group ? { group: group.name, head: Number(i.head_count) } : undefined,
      patch: (x) => ({
        ...x, income: x.income.filter((r) => r.id !== i.id),
        completions: tickRow ? x.completions.filter((r) => r.id !== tickRow.id) : x.completions,
        expected: (x.expected ?? []).map((e) => (e.income_id === i.id ? { ...e, income_id: null } : e)),
        groups: back && group ? x.groups.map((g) => (g.id === group.id ? { ...g, head_count: g.head_count + Number(i.head_count) } : g)) : x.groups
      })
    };
  }

  // ---- Fertiliser delivery, order, check, adjustment ------------------------------------------
  if (kind === 'fert') {
    const s = b.fertStock.find((x) => x.id === id);
    if (!s) return null;
    const cost = s.cost_id ? b.costs.find((c) => c.id === s.cost_id) : undefined;
    if (cost && !money) return null;
    const name = b.fertilisers.find((p) => p.id === s.product_id)?.name ?? 'fertiliser';
    const kg = fmtKg(Math.abs(Number(s.quantity_kg)));
    const noun = ({ delivery: `delivery of ${kg} of ${name}`, order: `order of ${kg} of ${name}`, count: `stock check of ${name}`, adjustment: `stock adjustment of ${name}`, opening: `opening stock of ${name}` } as Record<string, string>)[s.kind] ?? `entry for ${name}`;
    const lines = [`The ${noun}, ${fmtDay(s.on_date)}`];
    const effects = [`${name} stock is worked out again without it`];
    const ops: Op[] = [];
    const undo: Op[] = [];
    // The bill goes first so the stock row is not left pointing at it
    if (cost) {
      lines.push(`Its bill of ${eur(Number(cost.amount_eur), true)} (${cost.payment_status === 'owed' ? 'still to pay' : 'paid'})`);
      ops.push({ kind: 'delete', table: 'costs', match: { id: cost.id } });
    }
    ops.push({ kind: 'delete', table: 'fertiliser_stock', match: { id: s.id } });
    undo.push(...(cost ? [{ kind: 'insert' as const, table: 'costs', row: row(cost) }] : []), { kind: 'insert', table: 'fertiliser_stock', row: row(s) });
    const order = s.linked_order_id ? b.fertStock.find((x) => x.id === s.linked_order_id) : undefined;
    let reopen = false;
    if (order && order.order_status === 'delivered') {
      const others = b.fertStock.filter((x) => x.kind === 'delivery' && x.linked_order_id === order.id && x.id !== s.id).reduce((n, x) => n + Number(x.quantity_kg), 0);
      if (others < Number(order.quantity_kg)) {
        reopen = true;
        effects.push(`The order of ${fmtKg(Number(order.quantity_kg))} it was against is open again`);
        ops.push({ kind: 'update', table: 'fertiliser_stock', match: { id: order.id }, patch: { order_status: 'open' } });
        undo.push({ kind: 'update', table: 'fertiliser_stock', match: { id: order.id }, patch: { order_status: 'delivered' } });
      }
    }
    if (s.kind === 'order') {
      const against = b.fertStock.filter((x) => x.linked_order_id === s.id);
      if (against.length) effects.push(`${against.length} ${against.length === 1 ? 'delivery' : 'deliveries'} against it stay${against.length === 1 ? 's' : ''}, no longer linked to an order`);
    }
    return {
      what: `this ${noun}`, lines, effects, ops, undo,
      patch: (x) => ({
        ...x,
        fertStock: x.fertStock.filter((r) => r.id !== s.id).map((r) => (reopen && order && r.id === order.id ? { ...r, order_status: 'open' as const } : r)),
        costs: cost ? x.costs.filter((c) => c.id !== cost.id) : x.costs
      })
    };
  }

  // ---- A spreading and the fields in it ---------------------------------------------------------
  if (kind === 'spread') {
    const s = b.spreads.find((x) => x.id === id);
    if (!s) return null;
    const name = b.fertilisers.find((p) => p.id === s.product_id)?.name ?? 'fertiliser';
    const fields = b.spreadFields.filter((f) => f.spread_id === s.id);
    const names = fields.map((f) => b.fields.find((x) => x.id === f.field_id)?.name ?? 'a field');
    return {
      what: `this spreading of ${fmtKg(Number(s.total_kg))} of ${name}`,
      lines: [`The spreading of ${fmtKg(Number(s.total_kg))} of ${name}, ${fmtDay(s.spread_on)}`, ...(fields.length ? [`Its record against ${fields.length === 1 ? 'one field' : `${fields.length} fields`}: ${names.join(', ')}`] : [])],
      effects: [`${name} goes back into stock`, 'Each field\'s "last spread" date is worked out again'],
      ops: [{ kind: 'delete', table: 'fertiliser_spreads', match: { id: s.id } }],
      undo: [{ kind: 'insert', table: 'fertiliser_spreads', row: row(s) }, ...fields.map((f) => ({ kind: 'insert' as const, table: 'fertiliser_spread_fields', row: row(f) }))],
      patch: (x) => ({ ...x, spreads: x.spreads.filter((r) => r.id !== s.id), spreadFields: x.spreadFields.filter((f) => f.spread_id !== s.id) })
    };
  }

  // ---- A job ---------------------------------------------------------------------------------------
  if (kind === 'job') {
    const j = b.jobs.find((x) => x.id === id);
    if (!j) return null;
    return {
      what: 'this job', lines: [`The job "${j.title}"${j.due_on ? `, due ${fmtDay(j.due_on)}` : ''}`], effects: [],
      ops: [{ kind: 'delete', table: 'jobs', match: { id: j.id } }], undo: [{ kind: 'insert', table: 'jobs', row: row(j) }],
      patch: (x) => ({ ...x, jobs: x.jobs.filter((r) => r.id !== j.id) })
    };
  }

  // ---- A record (calving, treatment, test, and so on) -----------------------------------------------
  const r = b.records.find((x) => x.id === id);
  if (!r) return null;
  const tickRow = tickFor(b, 'farm_records', r.id);
  const tick = tickOps(tickRow);
  return {
    what: 'this record', lines: [`The record "${r.title}", ${fmtDay(r.occurred_on)}`, ...(r.document_id ? ['The photo or document stays in your files'] : []), ...tick.line], effects: [],
    ops: [{ kind: 'delete', table: 'farm_records', match: { id: r.id } }, ...tick.ops],
    undo: [{ kind: 'insert', table: 'farm_records', row: row(r) }, ...tick.undo],
    patch: (x) => ({ ...x, records: x.records.filter((y) => y.id !== r.id), completions: tickRow ? x.completions.filter((c) => c.id !== tickRow.id) : x.completions })
  };
}
