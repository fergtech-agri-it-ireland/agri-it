/**
 * Routines: recurring farm work, ticked off on Today.
 *
 * Reminder model (as in accounting software's "reminder" recurring transactions): an
 * occurrence is proposed on its due day and nothing is recorded until the farmer
 * confirms it, changes the amount, or skips it. Unticked occurrences stay visible for a
 * short while ("from earlier") and then drop off, so a missed week never piles up.
 *
 * Feeding needs no separate routine: every feeding rule is already a daily plan, so
 * each active rule (with confirm_daily on) is one tick a day.
 */
import type { FarmBundle, FeedUseLog, ISODate, Routine, RoutineCompletion, RoutineKind } from './types';
import { COST_LABEL, INCOME_LABEL, type CostCategory, type IncomeType } from './types';
import { addDays, daysBetween, eur, fmtKg, fmtNum, parseISO, toISO } from './format';
import { headsFor, rulesForDay } from './forecast/feed';

export const ROUTINE_LOOKBACK_DAYS = 7; // bills, jobs, counts stay "from earlier" for a week
export const FEEDING_LOOKBACK_DAYS = 3; // feeding older than this just uses the plan

const lastDayOfMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Is `routine` due on `day`? Monthly days past the month's end fall on its last day (31st → 30 Sept). */
export function isDue(r: Pick<Routine, 'frequency' | 'interval_days' | 'weekday' | 'day_of_month' | 'start_date' | 'end_date' | 'active'>, day: ISODate): boolean {
  if (!r.active || day < r.start_date || (r.end_date && day > r.end_date)) return false;
  const d = parseISO(day);
  switch (r.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return d.getUTCDay() === r.weekday;
    case 'monthly': {
      const last = lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth());
      return d.getUTCDate() === Math.min(r.day_of_month ?? 1, last);
    }
    case 'every_n_days':
      return daysBetween(r.start_date, day) % Math.max(1, r.interval_days ?? 1) === 0;
  }
}

export function dueDates(r: Parameters<typeof isDue>[0], from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isDue(r, d)) out.push(d);
  return out;
}

/** Next due date on or after `from` (within ~13 months), or null. */
export function nextDue(r: Parameters<typeof isDue>[0], from: ISODate): ISODate | null {
  for (let i = 0; i < 400; i++) {
    const d = addDays(from, i);
    if (isDue(r, d)) return d;
  }
  return null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "Every day", "Every Monday", "Monthly on the 20th", "Every 21 days". */
export function scheduleLabel(r: Pick<Routine, 'frequency' | 'interval_days' | 'weekday' | 'day_of_month'>): string {
  switch (r.frequency) {
    case 'daily': return 'Every day';
    case 'weekly': return `Every ${WEEKDAYS[r.weekday ?? 1]}`;
    case 'monthly': return `Monthly on the ${ordinal(r.day_of_month ?? 1)}`;
    case 'every_n_days': return r.interval_days === 1 ? 'Every day' : `Every ${r.interval_days} days`;
  }
}

/** What the farmer would expect to see for one occurrence, before ticking it. */
export function routineSummary(r: Routine, b: Pick<FarmBundle, 'products' | 'silage'>): string {
  const product = b.products.find((p) => p.id === r.feed_product_id)?.name;
  switch (r.kind) {
    case 'expense': return [r.amount !== null ? eur(Number(r.amount)) : 'Amount varies', r.counterparty ? `to ${r.counterparty}` : COST_LABEL[r.category as CostCategory]].filter(Boolean).join(' ');
    case 'income': return [r.amount !== null ? `About ${eur(Number(r.amount))}` : 'Amount varies', r.counterparty ? `from ${r.counterparty}` : INCOME_LABEL[r.category as IncomeType]].filter(Boolean).join(' ');
    case 'count': return `Count ${product ?? 'the feed'} and update the stock`;
    case 'order': return `${r.amount !== null ? fmtKg(Number(r.amount)) : 'Order'} of ${product ?? 'feed'}`;
    case 'silage': return `${r.amount !== null ? `${fmtNum(Number(r.amount))} t` : 'Silage'} from ${b.silage.find((s) => s.id === r.silage_store_id)?.name ?? 'the pit'}`;
    case 'job': return '';
  }
}

export type ChecklistKind = 'feeding' | RoutineKind;

export interface ChecklistItem {
  key: string;
  kind: ChecklistKind;
  date: ISODate;
  overdue: boolean;
  title: string;
  sub: string;
  planned: number | null; // kg for feeding/orders, € for money, t for silage
  unit: 'kg' | '€' | 't' | null;
  status: 'pending' | 'done' | 'skipped';
  actual: number | null;
  // feeding
  ruleId?: string;
  productId?: string;
  groupId?: string;
  log?: FeedUseLog;
  // routines
  routine?: Routine;
  completion?: RoutineCompletion;
}

const unitFor = (k: RoutineKind): ChecklistItem['unit'] => (k === 'expense' || k === 'income' ? '€' : k === 'order' ? 'kg' : k === 'silage' ? 't' : null);
const timesADay = (n: number) => (n === 1 ? 'once a day' : n === 2 ? 'twice a day' : `${fmtNum(n)} times a day`);

/**
 * Today's checklist: everything due today (pending and done), plus anything due in the
 * last few days that was never ticked off. Occurrences before a rule or routine was
 * created never appear, so a new farm doesn't open on a backlog.
 */
export function buildChecklist(
  b: Pick<FarmBundle, 'rules' | 'groups' | 'products' | 'silage' | 'routines' | 'completions' | 'feedLogs'>,
  today: ISODate
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const groups = new Map(b.groups.map((g) => [g.id, g]));

  // Feeding: one tick per rule per day, straight from the feeding plan
  const liveProducts = new Map(b.products.filter((p) => !p.archived).map((p) => [p.id, p]));
  for (const [pid, product] of liveProducts) {
    const rules = b.rules.filter((r) => r.feed_product_id === pid);
    for (let i = FEEDING_LOOKBACK_DAYS; i >= 0; i--) {
      const day = addDays(today, -i);
      for (const r of rulesForDay(rules, day)) {
        if (r.confirm_daily === false) continue;
        const created = toISO(new Date(r.created_at ?? `${r.start_date}T00:00:00Z`));
        if (day < created) continue;
        const g = groups.get(r.animal_group_id);
        if (!g || g.archived) continue;
        const heads = headsFor(r, groups);
        const planned = heads * Number(r.kg_per_head_per_feed) * Number(r.feeds_per_day);
        if (planned <= 0) continue;
        const log = b.feedLogs.find((l) => l.feeding_rule_id === r.id && l.used_on === day);
        items.push({
          key: `feed:${r.id}:${day}`, kind: 'feeding', date: day, overdue: day < today && !log,
          title: `${g.name}: ${fmtKg(planned)} ${product.name}`,
          sub: `${heads} head, ${fmtNum(Number(r.kg_per_head_per_feed))} kg ${timesADay(Number(r.feeds_per_day))}${r.is_temporary && r.label ? `. ${r.label}` : ''}`,
          planned, unit: 'kg',
          status: !log ? 'pending' : log.status === 'skipped' ? 'skipped' : 'done',
          actual: log ? Number(log.actual_kg) : null,
          ruleId: r.id, productId: pid, groupId: g.id, log
        });
      }
    }
  }

  // Routines: bills, income, jobs, counts, orders, silage feed-out
  for (const r of b.routines) {
    if (!r.active) continue;
    if (r.feed_product_id && !liveProducts.has(r.feed_product_id)) continue;
    const created = toISO(new Date(r.created_at));
    const from = [addDays(today, -ROUTINE_LOOKBACK_DAYS), r.start_date, created].sort().at(-1)!;
    for (const day of dueDates(r, from, today)) {
      const c = b.completions.find((x) => x.routine_id === r.id && x.due_date === day);
      if (day < today && c) {
        // ticked off already: only today's items stay on the list once done
        continue;
      }
      items.push({
        key: `routine:${r.id}:${day}`, kind: r.kind, date: day, overdue: day < today && !c,
        title: r.title, sub: routineSummary(r, b),
        planned: r.amount !== null ? Number(r.amount) : null, unit: unitFor(r.kind),
        status: !c ? 'pending' : c.status === 'skipped' ? 'skipped' : 'done',
        actual: c?.amount !== null && c?.amount !== undefined ? Number(c.amount) : null,
        routine: r, completion: c
      });
    }
  }

  // Past feeding that was ticked off stays off the list; past unticked stays as "from earlier"
  return items
    .filter((x) => x.date === today || x.status === 'pending')
    .sort((a, c) => (a.date === c.date ? kindOrder(a.kind) - kindOrder(c.kind) : a.date.localeCompare(c.date)));
}

const ORDER: ChecklistKind[] = ['feeding', 'silage', 'count', 'order', 'job', 'expense', 'income'];
const kindOrder = (k: ChecklistKind) => ORDER.indexOf(k);

export function checklistProgress(items: ChecklistItem[], today: ISODate) {
  const todays = items.filter((x) => x.date === today);
  return { done: todays.filter((x) => x.status !== 'pending').length, total: todays.length, earlier: items.filter((x) => x.date < today).length };
}

export type RepeatChoice = 'none' | 'weekly' | 'monthly';

/**
 * "This repeats" on a bill or income form: create the routine from this entry and mark this
 * occurrence done (linked to the record just saved), so the next one shows up on its due day.
 */
export function routineFromEntry(e: {
  farmId: string; kind: 'expense' | 'income'; title: string; date: ISODate; amount: number | null;
  category: string; counterparty: string | null; repeat: Exclude<RepeatChoice, 'none'>; recordTable: 'costs' | 'income'; recordId: string; routineId: string;
}) {
  const d = parseISO(e.date);
  const routine: Routine = {
    id: e.routineId, farm_id: e.farmId, kind: e.kind, title: e.title,
    frequency: e.repeat, interval_days: null,
    weekday: e.repeat === 'weekly' ? d.getUTCDay() : null,
    day_of_month: e.repeat === 'monthly' ? d.getUTCDate() : null,
    start_date: e.date, end_date: null, amount: e.amount, category: e.category, counterparty: e.counterparty,
    feed_product_id: null, silage_store_id: null, supplier_id: null, active: true, created_at: new Date().toISOString()
  };
  const completion = {
    farm_id: e.farmId, routine_id: e.routineId, due_date: e.date, status: 'done' as const, amount: e.amount,
    record_table: e.recordTable, record_id: e.recordId, done_on: e.date
  };
  const { created_at: _c, ...routineRow } = routine; // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ops: [
      { kind: 'insert' as const, table: 'routines', row: routineRow },
      { kind: 'upsert' as const, table: 'routine_completions', row: completion, onConflict: 'routine_id,due_date' }
    ],
    routine,
    completion: { ...completion, id: crypto.randomUUID(), created_at: new Date().toISOString() } as RoutineCompletion
  };
}
