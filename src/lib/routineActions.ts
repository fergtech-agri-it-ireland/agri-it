/**
 * Ticking things off. Each action returns the writes (queued offline like any other save),
 * an optimistic patch so the screen updates at once, an undo, and a plain-words label.
 * Every write is keyed (rule + day, routine + due date) so a retry or a second tap can't
 * double-count.
 */
import type { Op } from './offline/outbox';
import type { ChecklistItem } from './routines';
import type { Cost, FarmBundle, FeedTransaction, FeedUseLog, Income, RoutineCompletion } from './types';
import { addDays, eur, fmtKg, fmtNum, todayISO, uuid } from './format';

export interface TickAction {
  ops: Op[];
  patch: (b: FarmBundle) => FarmBundle;
  undo: Op[];
  label: string;
}

const now = () => new Date().toISOString();

/** Feeding: record what was actually fed (or skipped) for one rule on one day. */
export function tickFeeding(item: ChecklistItem, farmId: string, actualKg: number, skipped = false): TickAction {
  const status: FeedUseLog['status'] = skipped ? 'skipped' : actualKg === item.planned ? 'fed' : 'changed';
  const row = {
    farm_id: farmId, feeding_rule_id: item.ruleId!, feed_product_id: item.productId!, animal_group_id: item.groupId!,
    used_on: item.date, planned_kg: item.planned ?? 0, actual_kg: skipped ? 0 : actualKg, status
  };
  const local: FeedUseLog = { ...row, id: uuid(), created_at: now() };
  return {
    ops: [{ kind: 'upsert', table: 'feed_use_logs', row, onConflict: 'feeding_rule_id,used_on' }],
    patch: (b) => ({ ...b, feedLogs: [...b.feedLogs.filter((l) => !(l.feeding_rule_id === row.feeding_rule_id && l.used_on === row.used_on)), local] }),
    undo: [{ kind: 'delete', table: 'feed_use_logs', match: { feeding_rule_id: row.feeding_rule_id, used_on: row.used_on } }],
    label: skipped ? `Skipped: ${item.title.split(':')[0]}` : `Fed ${fmtKg(row.actual_kg)}`
  };
}

/** "All fed as planned": one tap for every feeding tick still open today. */
export function tickAllFeeding(items: ChecklistItem[], farmId: string): TickAction {
  const actions = items.map((i) => tickFeeding(i, farmId, i.planned ?? 0));
  const total = items.reduce((s, i) => s + (i.planned ?? 0), 0);
  return {
    ops: actions.flatMap((a) => a.ops),
    patch: (b) => actions.reduce((acc, a) => a.patch(acc), b),
    undo: actions.flatMap((a) => a.undo),
    label: `All fed: ${fmtKg(total)} across ${items.length} groups`
  };
}

/** Undo a tick from the list itself (tapping a done item). */
export function untick(item: ChecklistItem): TickAction {
  if (item.kind === 'feeding' && item.log) {
    const l = item.log;
    return {
      ops: [{ kind: 'delete', table: 'feed_use_logs', match: { feeding_rule_id: l.feeding_rule_id, used_on: l.used_on } }],
      patch: (b) => ({ ...b, feedLogs: b.feedLogs.filter((x) => !(x.feeding_rule_id === l.feeding_rule_id && x.used_on === l.used_on)) }),
      undo: [{ kind: 'upsert', table: 'feed_use_logs', row: stripLocal(l), onConflict: 'feeding_rule_id,used_on' }],
      label: 'Unticked'
    };
  }
  const c = item.completion!;
  const ops: Op[] = [{ kind: 'delete', table: 'routine_completions', match: { routine_id: c.routine_id, due_date: c.due_date } }];
  // A tick that created a cost/income/order removes it too
  if (c.record_table && c.record_id) ops.push({ kind: 'delete', table: c.record_table, match: { id: c.record_id } });
  return {
    ops,
    patch: (b) => ({
      ...b,
      completions: b.completions.filter((x) => x.id !== c.id),
      costs: c.record_table === 'costs' ? b.costs.filter((x) => x.id !== c.record_id) : b.costs,
      income: c.record_table === 'income' ? b.income.filter((x) => x.id !== c.record_id) : b.income,
      txns: c.record_table === 'feed_transactions' ? b.txns.filter((x) => x.id !== c.record_id) : b.txns
    }),
    undo: [],
    label: 'Unticked'
  };
}

function stripLocal<T extends { id?: string; created_at?: string }>(r: T) {
  const { id: _id, created_at: _c, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

/**
 * A routine occurrence: done (with the amount that actually happened) or skipped.
 * Bills, income and feed orders create the real record in the same step.
 */
export function completeRoutine(item: ChecklistItem, b: FarmBundle, amount: number | null, skipped = false): TickAction {
  const r = item.routine!;
  const farmId = r.farm_id;
  const recordId = uuid();
  const ops: Op[] = [];
  const undo: Op[] = [];
  let patchRecord: (x: FarmBundle) => FarmBundle = (x) => x;
  let recordTable: string | null = null;
  let label = skipped ? `Skipped: ${r.title}` : `Done: ${r.title}`;

  if (!skipped && r.kind === 'expense' && amount !== null) {
    recordTable = 'costs';
    const row = { id: recordId, farm_id: farmId, category: (r.category ?? 'other') as Cost['category'], other_label: r.category === 'other' ? r.title : null, occurred_on: item.date, amount_eur: amount, supplier_name: r.counterparty, description: r.title, document_id: null };
    ops.push({ kind: 'insert', table: 'costs', row });
    undo.push({ kind: 'delete', table: 'costs', match: { id: recordId } });
    patchRecord = (x) => ({ ...x, costs: [{ ...row, supplier_id: null, feed_transaction_id: null } as Cost, ...x.costs] });
    label = `Paid ${eur(amount)}: ${r.title}`;
  } else if (!skipped && r.kind === 'income' && amount !== null) {
    recordTable = 'income';
    const row = { id: recordId, farm_id: farmId, income_type: (r.category ?? 'other') as Income['income_type'], occurred_on: item.date, amount_eur: amount, counterparty: r.counterparty, description: r.title, document_id: null };
    ops.push({ kind: 'insert', table: 'income', row });
    undo.push({ kind: 'delete', table: 'income', match: { id: recordId } });
    patchRecord = (x) => ({ ...x, income: [{ ...row, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null } as Income, ...x.income] });
    label = `Received ${eur(amount)}: ${r.title}`;
  } else if (!skipped && r.kind === 'order' && amount !== null && r.feed_product_id) {
    recordTable = 'feed_transactions';
    const product = b.products.find((p) => p.id === r.feed_product_id);
    const supplierId = r.supplier_id ?? product?.supplier_id ?? null;
    const lead = product?.lead_time_days ?? b.supplierSettings.find((s) => s.supplier_id === supplierId)?.lead_time_days ?? b.farm.default_lead_time_days ?? null;
    // No delivery time known: no expected date (never guessed, spec 10)
    const expected = lead === null ? null : addDays(item.date, lead);
    const row = { id: recordId, farm_id: farmId, feed_product_id: r.feed_product_id, txn_type: 'order' as const, quantity_kg: amount, order_date: item.date, expected_delivery_date: expected, effective_on: expected ?? item.date, order_status: 'open' as const, supplier_id: supplierId, evidence: 'unconfirmed' as const };
    ops.push({ kind: 'insert', table: 'feed_transactions', row });
    undo.push({ kind: 'delete', table: 'feed_transactions', match: { id: recordId } });
    patchRecord = (x) => ({ ...x, txns: [...x.txns, { ...row, delivery_date: null, linked_order_id: null, total_price_eur: null, price_per_tonne_eur: null, document_id: null, notes: null, created_at: now() } as FeedTransaction] });
    label = `Ordered ${fmtKg(amount)} ${product?.name ?? ''}. Not counted as stock until it arrives`.trim();
  } else if (!skipped && r.kind === 'silage' && amount !== null) {
    label = `Fed out ${fmtNum(amount)} t silage`;
  }

  // Saved under the occurrence's own due date, even when it was moved to another day
  const due = item.due ?? item.date;
  const completion = {
    farm_id: farmId, routine_id: r.id, due_date: due, status: skipped ? 'skipped' as const : 'done' as const,
    amount: skipped ? null : amount, record_table: recordTable, record_id: recordTable ? recordId : null, done_on: todayISO(), moved_to: null
  };
  ops.push({ kind: 'upsert', table: 'routine_completions', row: completion, onConflict: 'routine_id,due_date' });
  if (item.completion?.status === 'moved') {
    // Undo puts it back to "moved", not back to never-dealt-with
    const { id: _i, created_at: _c, ...moved } = item.completion; // eslint-disable-line @typescript-eslint/no-unused-vars
    undo.unshift({ kind: 'upsert', table: 'routine_completions', row: moved, onConflict: 'routine_id,due_date' });
  } else {
    undo.unshift({ kind: 'delete', table: 'routine_completions', match: { routine_id: r.id, due_date: due } });
  }
  const local: RoutineCompletion = { ...completion, id: uuid(), created_at: now() };
  return {
    ops,
    patch: (x) => patchRecord({ ...x, completions: [...x.completions.filter((c) => !(c.routine_id === r.id && c.due_date === due)), local] }),
    undo,
    label
  };
}

/** Put an occurrence off to another day. It shows on that day and stays until it is ticked or skipped. */
export function moveRoutine(item: ChecklistItem, to: string): TickAction {
  const r = item.routine!;
  const due = item.due ?? item.date;
  const row = { farm_id: r.farm_id, routine_id: r.id, due_date: due, status: 'moved' as const, moved_to: to, amount: null, record_table: null, record_id: null, done_on: todayISO() };
  const local: RoutineCompletion = { ...row, id: uuid(), created_at: now() };
  const undo: Op[] = item.completion
    ? [{ kind: 'upsert', table: 'routine_completions', row: stripLocal(item.completion), onConflict: 'routine_id,due_date' }]
    : [{ kind: 'delete', table: 'routine_completions', match: { routine_id: r.id, due_date: due } }];
  return {
    ops: [{ kind: 'upsert', table: 'routine_completions', row, onConflict: 'routine_id,due_date' }],
    patch: (x) => ({ ...x, completions: [...x.completions.filter((c) => !(c.routine_id === r.id && c.due_date === due)), local] }),
    undo,
    label: `Moved to ${to === addDays(todayISO(), 1) ? 'tomorrow' : to}: ${r.title}`
  };
}

/** Skip the other missed days a gathered line stands for (the line's own day stays to tick or skip). */
export function skipMissed(item: ChecklistItem): TickAction {
  const r = item.routine!;
  const days = item.missedDates ?? [];
  const rows = days.map((d) => ({ farm_id: r.farm_id, routine_id: r.id, due_date: d, status: 'skipped' as const, moved_to: null, amount: null, record_table: null, record_id: null, done_on: todayISO() }));
  return {
    ops: rows.map((row) => ({ kind: 'upsert' as const, table: 'routine_completions', row, onConflict: 'routine_id,due_date' })),
    patch: (x) => ({ ...x, completions: [...x.completions.filter((c) => !(c.routine_id === r.id && days.includes(c.due_date))), ...rows.map((row) => ({ ...row, id: uuid(), created_at: now() }))] }),
    undo: days.map((d) => ({ kind: 'delete' as const, table: 'routine_completions', match: { routine_id: r.id, due_date: d } })),
    label: `Skipped ${days.length} missed day${days.length === 1 ? '' : 's'}: ${r.title}`
  };
}
