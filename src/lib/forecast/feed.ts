/**
 * Purchased feed run-out and reorder forecast (MVP spec section 4).
 *
 * Pure arithmetic on the farmer's own feeding plan. It never prescribes a rate,
 * never invents a lead time, and never counts ordered stock until it's delivered.
 *
 * Stock model (start-of-day positions):
 *   stock(today) = baseline (latest count/opening)
 *                + confirmed deliveries and adjustments after the baseline date
 *                - planned use for each day from the baseline date up to yesterday
 *   planned use(day) = Σ heads × kg/head/feed × feeds/day over rules active that day.
 *   A temporary rule replaces that group's normal rule(s) for its date window.
 */
import type {
  AnimalGroup, Confidence, Evidence, FarmSupplierSetting, FeedProduct, FeedTransaction, FeedUseLog, FeedingRule, ISODate
} from '../types';
import { addDays, daysBetween, hashString } from '../format';

export const FEED_RULE_VERSION = 'feed-runout@1.0';
const HORIZON_DAYS = 400;
const STALE_COUNT_DAYS = 30; // group head counts older than this lower confidence
const STALE_STOCK_DAYS = 45; // a baseline older than this lowers confidence

export type FeedStatus = 'order_now' | 'order_soon' | 'ok' | 'no_plan' | 'no_stock_record';

export interface RuleUse {
  ruleId: string;
  groupId: string;
  groupName: string;
  heads: number;
  headsSource: 'group' | 'override';
  kgPerHeadPerFeed: number;
  feedsPerDay: number;
  dailyKg: number;
  temporary: boolean;
  label: string | null;
  startDate: ISODate;
  endDate: ISODate | null;
}

export interface LedgerLine {
  date: ISODate;
  label: string;
  kg: number; // signed effect on stock
  evidence?: Evidence;
}

export interface FeedForecast {
  productId: string;
  today: ISODate;
  status: FeedStatus;
  /** What's in the bin now: start-of-day stock less anything ticked off as fed today. */
  stockKg: number | null;
  dailyUseKg: number;
  /** Fed today and ticked off on the checklist. */
  confirmedTodayKg: number;
  /** Planned for today but not ticked off yet. */
  remainingTodayKg: number;
  /** Days in the last week with feeding not ticked off (only counted once you use ticking). */
  unconfirmedDays: number;
  activeRules: RuleUse[];
  upcomingChanges: { date: ISODate; dailyUseKg: number; reason: string }[];
  daysRemaining: number | null;
  runOutDate: ISODate | null;
  safetyKg: number;
  safetyLabel: string;
  reorderDate: ISODate | null;
  leadTimeDays: number | null;
  leadTimeSource: 'feed' | 'supplier' | 'farm' | null;
  orderByDate: ISODate | null;
  openOrders: { id: string; kg: number; expected: ISODate | null }[];
  runOutWithOpenOrders: ISODate | null;
  confidence: Confidence;
  reasons: string[];
  ledger: LedgerLine[];
  pricePerTonne: number | null;
  costPerDay: number | null;
  costPerHeadPerDay: number | null;
  costUntilReorder: number | null;
  inputsHash: string;
  inputs: Record<string, unknown>;
}

export interface FeedForecastInput {
  product: FeedProduct;
  txns: FeedTransaction[]; // all txns for this product
  rules: FeedingRule[]; // all rules for this product
  groups: AnimalGroup[];
  supplierSetting?: FarmSupplierSetting | null;
  farmLeadTimeDays: number | null;
  today: ISODate;
  now?: Date; // for staleness checks (defaults to today)
  /** Ticked-off feeding (Today checklist). Confirmed amounts replace the plan for that day and group. */
  logs?: FeedUseLog[];
}

function ruleActive(r: FeedingRule, day: ISODate) {
  return r.start_date <= day && (r.end_date === null || day <= r.end_date);
}

/** Rules that actually apply on a given day: temporary rules override a group's normal rules. */
export function rulesForDay(rules: FeedingRule[], day: ISODate): FeedingRule[] {
  const active = rules.filter((r) => ruleActive(r, day));
  const tempGroups = new Set(active.filter((r) => r.is_temporary).map((r) => r.animal_group_id));
  return active.filter((r) => r.is_temporary || !tempGroups.has(r.animal_group_id));
}

export function headsFor(rule: FeedingRule, groups: Map<string, AnimalGroup>): number {
  if (rule.head_count_override !== null && rule.head_count_override !== undefined) return rule.head_count_override;
  return groups.get(rule.animal_group_id)?.head_count ?? 0;
}

export function dailyUse(rules: FeedingRule[], groups: Map<string, AnimalGroup>, day: ISODate): number {
  return rulesForDay(rules, day).reduce(
    (sum, r) => sum + headsFor(r, groups) * Number(r.kg_per_head_per_feed) * Number(r.feeds_per_day),
    0
  );
}

/**
 * Usage model. A confirmed log replaces the planned amount for its rule and day (a skip is 0);
 * days nobody ticked off still use the plan, so forecasts never stall.
 */
export interface UsageModel {
  /** Total use on a past or future day: confirmed where ticked, planned elsewhere. */
  use(day: ISODate): number;
  /** Planned use still to come on `day` (rules not yet ticked off). */
  remaining(day: ISODate): number;
  /** Confirmed use on `day`. */
  confirmed(day: ISODate): number;
  /** Whether every confirm-daily rule active on `day` was ticked off. */
  allConfirmed(day: ISODate): boolean;
  hasLogs: boolean;
}

export function usageModel(rules: FeedingRule[], groups: Map<string, AnimalGroup>, logs: FeedUseLog[] = []): UsageModel {
  const byDay = new Map<string, Map<string, number>>();
  for (const l of logs) {
    const m = byDay.get(l.used_on) ?? new Map<string, number>();
    m.set(l.feeding_rule_id, Number(l.actual_kg));
    byDay.set(l.used_on, m);
  }
  const planned = (r: FeedingRule) => headsFor(r, groups) * Number(r.kg_per_head_per_feed) * Number(r.feeds_per_day);
  return {
    hasLogs: logs.length > 0,
    use(day) {
      const m = byDay.get(day);
      const active = rulesForDay(rules, day);
      let t = active.reduce((s, r) => s + (m?.has(r.id) ? m.get(r.id)! : planned(r)), 0);
      if (m) for (const [rid, kg] of m) if (!active.some((r) => r.id === rid)) t += kg; // fed outside the plan
      return t;
    },
    remaining(day) {
      const m = byDay.get(day);
      return rulesForDay(rules, day).reduce((s, r) => s + (m?.has(r.id) ? 0 : planned(r)), 0);
    },
    confirmed(day) {
      let t = 0;
      for (const kg of byDay.get(day)?.values() ?? []) t += kg;
      return t;
    },
    allConfirmed(day) {
      const m = byDay.get(day);
      return rulesForDay(rules, day).filter((r) => r.confirm_daily !== false && planned(r) > 0).every((r) => m?.has(r.id));
    }
  };
}

/** Latest count/opening on or before `day`: the measured anchor for the ledger. */
export function findBaseline(txns: FeedTransaction[], day: ISODate): FeedTransaction | null {
  const anchors = txns
    .filter((t) => (t.txn_type === 'count' || t.txn_type === 'opening') && t.effective_on <= day)
    .sort((a, b) => (a.effective_on === b.effective_on ? a.created_at.localeCompare(b.created_at) : a.effective_on.localeCompare(b.effective_on)));
  return anchors.at(-1) ?? null;
}

/** Stock at the start of `day` from the ledger, or null if nothing to anchor on. */
export function stockAt(
  txns: FeedTransaction[], rules: FeedingRule[], groups: Map<string, AnimalGroup>, day: ISODate,
  ledger?: LedgerLine[], logs: FeedUseLog[] = []
): { stock: number | null; baseline: FeedTransaction | null; firstDate: ISODate | null } {
  const usage = usageModel(rules, groups, logs);
  const baseline = findBaseline(txns, day);
  const moves = txns
    .filter((t) => (t.txn_type === 'delivery' || t.txn_type === 'adjustment') && t.effective_on <= day)
    .filter((t) => (baseline ? t.effective_on > baseline.effective_on : true))
    .sort((a, b) => a.effective_on.localeCompare(b.effective_on));

  let start: ISODate | null = baseline ? baseline.effective_on : moves[0]?.effective_on ?? null;
  if (start === null) return { stock: null, baseline: null, firstDate: null };

  let stock = baseline ? Number(baseline.quantity_kg) : 0;
  if (baseline && ledger) {
    ledger.push({
      date: baseline.effective_on,
      label: baseline.txn_type === 'count' ? 'Stock count' : 'Opening stock',
      kg: Number(baseline.quantity_kg),
      evidence: baseline.evidence
    });
  }
  let used = 0;
  let confirmedUsed = 0;
  let mi = 0;
  for (let d = start; d < day; d = addDays(d, 1)) {
    while (mi < moves.length && moves[mi].effective_on <= d) {
      const m = moves[mi++];
      stock += Number(m.quantity_kg);
      ledger?.push({
        date: m.effective_on,
        label: m.txn_type === 'delivery' ? 'Delivery' : 'Adjustment',
        kg: Number(m.quantity_kg),
        evidence: m.evidence
      });
    }
    const u = usage.use(d);
    const c = usage.confirmed(d);
    stock -= u;
    used += u - c;
    confirmedUsed += c;
  }
  while (mi < moves.length && moves[mi].effective_on <= day) {
    const m = moves[mi++];
    stock += Number(m.quantity_kg);
    ledger?.push({ date: m.effective_on, label: m.txn_type === 'delivery' ? 'Delivery' : 'Adjustment', kg: Number(m.quantity_kg), evidence: m.evidence });
  }
  if (ledger && confirmedUsed > 0) ledger.push({ date: day, label: `Feeding you ticked off since ${start}`, kg: -confirmedUsed });
  if (ledger && used > 0) ledger.push({ date: day, label: `Planned use since ${start}${confirmedUsed > 0 ? ' (days not ticked off)' : ''}`, kg: -used });
  return { stock, baseline, firstDate: start };
}

/** Walk forward day by day. Returns fractional days until stock reaches `floorKg`. */
function daysUntil(
  startStock: number, usage: UsageModel, today: ISODate, floorKg: number,
  extra: { date: ISODate; kg: number }[] = []
): number | null {
  let stock = startStock;
  if (stock <= floorKg) return 0;
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const d = addDays(today, i);
    for (const e of extra) if (e.date === d && i > 0) stock += e.kg;
    // Starting stock is "now", already net of anything ticked off today
    const use = i === 0 ? usage.remaining(d) : usage.use(d);
    if (use > 0 && stock - use <= floorKg) return i + (stock - floorKg) / use;
    stock -= use;
  }
  return null; // beyond horizon or no use
}

export function resolveLeadTime(
  product: FeedProduct, setting: FarmSupplierSetting | null | undefined, farmDefault: number | null
): { days: number | null; source: FeedForecast['leadTimeSource'] } {
  if (product.lead_time_days !== null && product.lead_time_days !== undefined) return { days: product.lead_time_days, source: 'feed' };
  if (setting?.lead_time_days !== null && setting?.lead_time_days !== undefined) return { days: setting.lead_time_days, source: 'supplier' };
  if (farmDefault !== null && farmDefault !== undefined) return { days: farmDefault, source: 'farm' };
  return { days: null, source: null };
}

export function forecastFeed(input: FeedForecastInput): FeedForecast {
  const { product, txns, rules, today } = input;
  const groups = new Map(input.groups.map((g) => [g.id, g]));
  const now = input.now ?? new Date(today + 'T12:00:00Z');
  const reasons: string[] = [];
  const ledger: LedgerLine[] = [];

  const logs = input.logs ?? [];
  const usage = usageModel(rules, groups, logs);
  const { stock: startOfDay, baseline } = stockAt(txns, rules, groups, today, ledger, logs);
  const confirmedTodayKg = usage.confirmed(today);
  const remainingTodayKg = usage.remaining(today);
  // A count taken today already reflects feeding ticked off before it: only take off what was ticked after
  const countedToday = baseline && baseline.effective_on === today;
  const takenOffNow = countedToday
    ? logs.filter((l) => l.used_on === today && l.created_at > baseline!.created_at).reduce((s, l) => s + Number(l.actual_kg), 0)
    : confirmedTodayKg;
  const stock = startOfDay === null ? null : startOfDay - takenOffNow;
  if (takenOffNow > 0) ledger.push({ date: today, label: 'Fed today (ticked off)', kg: -takenOffNow });
  const todays = rulesForDay(rules, today);
  const dailyUseKg = dailyUse(rules, groups, today);

  const activeRules: RuleUse[] = todays.map((r) => {
    const heads = headsFor(r, groups);
    return {
      ruleId: r.id,
      groupId: r.animal_group_id,
      groupName: groups.get(r.animal_group_id)?.name ?? 'Unknown group',
      heads,
      headsSource: r.head_count_override !== null ? 'override' : 'group',
      kgPerHeadPerFeed: Number(r.kg_per_head_per_feed),
      feedsPerDay: Number(r.feeds_per_day),
      dailyKg: heads * Number(r.kg_per_head_per_feed) * Number(r.feeds_per_day),
      temporary: r.is_temporary,
      label: r.label,
      startDate: r.start_date,
      endDate: r.end_date
    };
  });

  // Upcoming changes in daily use within 60 days (temporary plans starting/ending)
  const upcomingChanges: FeedForecast['upcomingChanges'] = [];
  let prev = dailyUseKg;
  for (let i = 1; i <= 60; i++) {
    const d = addDays(today, i);
    const u = dailyUse(rules, groups, d);
    if (Math.abs(u - prev) > 0.001) {
      const starting = rules.find((r) => r.start_date === d);
      const ending = rules.find((r) => r.end_date === addDays(d, -1));
      const reason = starting ? `${starting.label ?? 'New feeding plan'} starts` : ending ? `${ending.label ?? 'Temporary plan'} ends` : 'Feeding plan changes';
      upcomingChanges.push({ date: d, dailyUseKg: u, reason });
      prev = u;
    }
  }

  const safetyKg = product.safety_stock_mode === 'kg'
    ? Number(product.safety_stock_value)
    : Number(product.safety_stock_value) * dailyUseKg;
  const safetyLabel = product.safety_stock_mode === 'kg'
    ? `${Math.round(Number(product.safety_stock_value))} kg`
    : `${Number(product.safety_stock_value)} days`;

  const lead = resolveLeadTime(product, input.supplierSetting, input.farmLeadTimeDays);

  const openOrders = txns
    .filter((t) => t.txn_type === 'order' && t.order_status === 'open')
    .map((t) => ({ id: t.id, kg: Number(t.quantity_kg), expected: t.expected_delivery_date }));

  let daysRemaining: number | null = null;
  let runOutDate: ISODate | null = null;
  let reorderDate: ISODate | null = null;
  let orderByDate: ISODate | null = null;
  let runOutWithOpenOrders: ISODate | null = null;

  const hasPlan = rules.some((r) => ruleActive(r, today) || r.start_date > today);

  if (stock !== null && dailyUseKg + upcomingChanges.reduce((s, c) => s + c.dailyUseKg, 0) > 0) {
    daysRemaining = daysUntil(stock, usage, today, 0);
    if (daysRemaining !== null) runOutDate = addDays(today, Math.floor(daysRemaining));
    const toReorder = daysUntil(stock, usage, today, safetyKg);
    if (toReorder !== null) {
      reorderDate = addDays(today, Math.floor(toReorder));
      if (lead.days !== null) orderByDate = addDays(reorderDate, -lead.days);
    }
    if (openOrders.length) {
      const extra = openOrders.filter((o) => o.expected).map((o) => ({ date: o.expected as ISODate, kg: o.kg }));
      const d = daysUntil(stock, usage, today, 0, extra);
      if (d !== null) runOutWithOpenOrders = addDays(today, Math.floor(d));
    }
  }

  // ---- status
  let status: FeedStatus;
  if (stock === null) status = 'no_stock_record';
  else if (!hasPlan || dailyUseKg === 0 && upcomingChanges.length === 0) status = 'no_plan';
  else {
    const trigger = orderByDate ?? reorderDate;
    if (trigger && trigger <= today) status = 'order_now';
    else if (trigger && daysBetween(today, trigger) <= 7) status = 'order_soon';
    else status = 'ok';
  }

  // ---- confidence (spec 4.4). Start high and step down with each weakness.
  const rank: Confidence[] = ['high', 'medium', 'low'];
  let level = 0;
  const lower = (to: 1 | 2, why: string) => {
    if (to > level) level = to;
    reasons.push(why);
  };
  if (!baseline) {
    if (stock === null) lower(2, 'No stock count or opening stock recorded yet.');
    else lower(2, 'No stock count: stock is built from deliveries only.');
  } else {
    if (baseline.evidence === 'farmer_estimate' || baseline.evidence === 'unconfirmed') lower(2, 'Opening stock is an estimate.');
    else if (baseline.evidence === 'invoice_derived') lower(1, 'Stock comes from an invoice rather than a count.');
    const age = daysBetween(baseline.effective_on, today);
    if (age > STALE_STOCK_DAYS) lower(1, `Last stock count was ${age} days ago.`);
  }
  const since = txns.filter((t) => t.txn_type === 'delivery' && (!baseline || t.effective_on > baseline.effective_on) && t.effective_on <= today);
  if (since.some((t) => t.evidence === 'unconfirmed' || t.evidence === 'farmer_estimate')) lower(2, 'A delivery is not confirmed.');
  else if (since.some((t) => t.evidence === 'invoice_derived')) lower(1, 'A delivery quantity is from an invoice, not a docket.');
  if (!hasPlan || activeRules.length === 0) lower(2, 'No feeding plan is set for today.');
  const staleGroups = activeRules
    .filter((r) => r.headsSource === 'group')
    .map((r) => groups.get(r.groupId))
    .filter((g): g is AnimalGroup => !!g && (now.getTime() - new Date(g.head_count_updated_at).getTime()) / 86_400_000 > STALE_COUNT_DAYS);
  if (staleGroups.length) lower(1, `Head count not updated in over ${STALE_COUNT_DAYS} days: ${staleGroups.map((g) => g.name).join(', ')}.`);
  if (lead.days === null) reasons.push('No lead time set, so there is no order-by date.');
  // Once the farmer ticks feeding off, days left unticked fall back to the plan: say so
  let unconfirmedDays = 0;
  if (usage.hasLogs) {
    const firstLog = logs.reduce((m, l) => (l.used_on < m ? l.used_on : m), today);
    for (let i = 1; i <= 7; i++) {
      const day = addDays(today, -i);
      if (day < firstLog || (baseline && day < baseline.effective_on)) break;
      if (usage.use(day) > 0 && !usage.allConfirmed(day)) unconfirmedDays++;
    }
    if (unconfirmedDays >= 3) lower(1, `Feeding not ticked off on ${unconfirmedDays} of the last 7 days. Those days use your plan.`);
  }
  const confidence = rank[level];

  // ---- economics
  const priced = txns
    .filter((t) => t.txn_type === 'delivery' && t.price_per_tonne_eur !== null)
    .sort((a, b) => b.effective_on.localeCompare(a.effective_on))[0];
  const pricePerTonne = priced ? Number(priced.price_per_tonne_eur) : null;
  const costPerDay = pricePerTonne !== null ? (dailyUseKg / 1000) * pricePerTonne : null;
  const totalHeads = activeRules.reduce((s, r) => s + r.heads, 0);
  const costPerHeadPerDay = costPerDay !== null && totalHeads > 0 ? costPerDay / totalHeads : null;
  const costUntilReorder = costPerDay !== null && reorderDate ? costPerDay * Math.max(0, daysBetween(today, reorderDate)) : null;

  const inputs = {
    rule_version: FEED_RULE_VERSION,
    today,
    product: { id: product.id, safety: [product.safety_stock_mode, Number(product.safety_stock_value)], lead: lead },
    baseline: baseline ? { id: baseline.id, kg: Number(baseline.quantity_kg), on: baseline.effective_on, evidence: baseline.evidence } : null,
    moves: txns.filter((t) => t.txn_type !== 'order').map((t) => [t.id, t.txn_type, Number(t.quantity_kg), t.effective_on, t.evidence]),
    rules: rules.map((r) => [r.id, r.animal_group_id, headsFor(r, groups), Number(r.kg_per_head_per_feed), Number(r.feeds_per_day), r.start_date, r.end_date, r.is_temporary]),
    logs: logs.map((l) => [l.feeding_rule_id, l.used_on, Number(l.actual_kg)])
  };

  return {
    productId: product.id,
    today,
    status,
    stockKg: stock,
    confirmedTodayKg,
    remainingTodayKg,
    unconfirmedDays,
    dailyUseKg,
    activeRules,
    upcomingChanges,
    daysRemaining,
    runOutDate,
    safetyKg,
    safetyLabel,
    reorderDate,
    leadTimeDays: lead.days,
    leadTimeSource: lead.source,
    orderByDate,
    openOrders,
    runOutWithOpenOrders,
    confidence,
    reasons,
    ledger,
    pricePerTonne,
    costPerDay,
    costPerHeadPerDay,
    costUntilReorder,
    inputsHash: hashString(JSON.stringify(inputs)),
    inputs
  };
}

/**
 * Predicted vs counted (spec 4.3): for each stock count after the first anchor,
 * compare the ledger's prediction just before the count with what was counted.
 * We show the variance; we never silently change the farmer's feeding rate.
 */
export function countVariances(
  txns: FeedTransaction[], rules: FeedingRule[], groups: AnimalGroup[], logs: FeedUseLog[] = []
): { date: ISODate; predictedKg: number; countedKg: number; varianceKg: number; variancePct: number | null }[] {
  const gm = new Map(groups.map((g) => [g.id, g]));
  const counts = txns.filter((t) => t.txn_type === 'count').sort((a, b) => a.effective_on.localeCompare(b.effective_on));
  const out = [];
  for (const c of counts) {
    const prior = txns.filter((t) => t.id !== c.id && !(t.txn_type === 'count' && t.effective_on >= c.effective_on));
    const { stock } = stockAt(prior, rules, gm, c.effective_on, undefined, logs);
    if (stock === null) continue;
    const counted = Number(c.quantity_kg);
    out.push({
      date: c.effective_on,
      predictedKg: stock,
      countedKg: counted,
      varianceKg: counted - stock,
      variancePct: stock > 0 ? ((counted - stock) / stock) * 100 : null
    });
  }
  return out;
}

export interface RunoutStep {
  from: ISODate;
  to: ISODate;
  days: number; // whole days, or a fraction on the final step
  kgPerDay: number;
  startKg: number; // stock at the start of this step
  usedKg: number;
  final: boolean; // the step where stock runs out
}

/**
 * The run-out date as a visible sum (after MyFitnessPal's "goal − food + exercise = remaining"):
 * today's stock, minus each stretch of days at a steady daily use, until it runs out.
 * A new step starts whenever the feeding plan changes (e.g. a temporary higher rate).
 * Uses the same daily-use rules as forecastFeed, so the steps always add up to its answer.
 */
export function runoutSteps(
  stockKg: number, rules: FeedingRule[], groups: AnimalGroup[], today: ISODate,
  /** Today's use still to come, when part of today is already ticked off. */
  todayRemainingKg?: number
): RunoutStep[] {
  const gm = new Map(groups.map((g) => [g.id, g]));
  const steps: RunoutStep[] = [];
  let stock = stockKg;
  let idle = 0;
  for (let i = 0; i < HORIZON_DAYS && stock > 0; i++) {
    const day = addDays(today, i);
    const use = i === 0 && todayRemainingKg !== undefined ? todayRemainingKg : dailyUse(rules, gm, day);
    if (use <= 0) {
      if (++idle > 60) break; // nothing planned for two months: no run-out to explain
      continue;
    }
    idle = 0;
    let cur = steps.at(-1);
    if (!cur || Math.abs(cur.kgPerDay - use) > 1e-9 || addDays(cur.to, 1) !== day) {
      cur = { from: day, to: day, days: 0, kgPerDay: use, startKg: stock, usedKg: 0, final: false };
      steps.push(cur);
    }
    cur.to = day;
    if (stock - use <= 0) {
      cur.days += stock / use;
      cur.usedKg += stock;
      cur.final = true;
      stock = 0;
    } else {
      cur.days += 1;
      cur.usedKg += use;
      stock -= use;
    }
  }
  return steps;
}
