import { useEffect, useMemo } from 'react';
import { IN_BROWSER, key } from '../env';
import type { FarmBundle, ISODate } from '../types';
import { forecastFeed, type FeedForecast } from '../forecast/feed';
import { forecastForage, silageSummary } from '../forecast/forage';
import { budgetAlerts, budgetVsActual, cashCompleteness, cashForecast90, cashPosition, yearEndPack } from '../forecast/money';
import { pricePoints } from '../forecast/prices';
import { moneyStates, possibleDuplicateDeliveries } from '../forecast/bills';
import { buildChecklist } from '../routines';
import { suggestions as buildSuggestions } from '../suggestions';
import { addDays, daysBetween, fmtDay, fmtKg, todayISO, eur } from '../format';
import { supabase } from '../supabase';

export function feedForecasts(b: FarmBundle, today: ISODate): Map<string, FeedForecast> {
  const out = new Map<string, FeedForecast>();
  for (const p of b.products.filter((x) => !x.archived)) {
    out.set(p.id, forecastFeed({
      product: p,
      txns: b.txns.filter((t) => t.feed_product_id === p.id),
      rules: b.rules.filter((r) => r.feed_product_id === p.id),
      groups: b.groups,
      supplierSetting: b.supplierSettings.find((s) => s.supplier_id === p.supplier_id),
      farmLeadTimeDays: b.farm.default_lead_time_days,
      today,
      logs: b.feedLogs.filter((l) => l.feed_product_id === p.id),
      headHistory: b.headHistory,
      warnDays: b.farm.order_warning_days
    }));
  }
  return out;
}

/**
 * Silage stores with ticked-off feed-out applied: each "Feed out silage" tick after a store
 * was measured comes off what's left in it.
 */
export function silageWithFedOut(b: Pick<FarmBundle, 'silage' | 'routines' | 'completions'>) {
  return b.silage.map((s) => {
    const fed = b.completions
      .filter((c) => c.status === 'done' && c.amount !== null && c.due_date >= s.measured_on)
      .filter((c) => b.routines.find((r) => r.id === c.routine_id)?.silage_store_id === s.id)
      .reduce((t, c) => t + Number(c.amount), 0);
    return fed ? { ...s, fed_out_tonnes: Number(s.fed_out_tonnes ?? 0) + fed } : s;
  });
}

export type Tone = 'urgent' | 'warn' | 'info' | 'ok';
/**
 * When something needs doing. Overdue items stay on Today until they are done, moved,
 * skipped or (for jobs) taken off the list: they never drop off because time passed.
 */
export type When = 'overdue' | 'today' | 'soon' | 'later';
export interface Priority {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  to: string;
  action?: string;
  when: When;
  /** Only information can be hidden for a while; anything owed or overdue has to be dealt with. */
  dismissable?: boolean;
}

const toneRank: Record<Tone, number> = { urgent: 0, warn: 1, info: 2, ok: 3 };
const whenRank: Record<When, number> = { overdue: 0, today: 1, soon: 2, later: 3 };
export const WHEN_LABEL: Record<When, string> = { overdue: 'Overdue', today: 'Today', soon: 'Coming up', later: 'When you get a minute' };

/** Everything the screens show, worked out from the farm's records. Pure: same records, same answer. */
export function derive(b: FarmBundle, today: ISODate) {
  {
    const feed = feedForecasts(b, today);
    const forage = forecastForage({ farm: b.farm, stores: silageWithFedOut(b), groups: b.groups, benchmarks: b.benchmarks, evidence: b.evidence, today });
    const cash = cashPosition(b.farm, b.income, b.costs, today);
    const cash90 = cashForecast90(b.farm, b.income, b.costs, b.budget, today, undefined, b.routines);
    const cashGaps = cashCompleteness(b.farm, b, today);
    const budget = budgetVsActual(b.farm, b, today);
    const yearEnd = yearEndPack(b, today);

    const p: Priority[] = [];
    const billDays = b.farm.bill_warning_days ?? 7;
    for (const product of b.products.filter((x) => !x.archived)) {
      const f = feed.get(product.id)!;
      const ordered = f.openOrders.reduce((s, o) => s + o.kg, 0);
      const nextDue = f.openOrders.map((o) => o.expected).filter(Boolean).sort()[0] ?? null;
      if ((f.status === 'order_now' || f.status === 'order_soon') && ordered > 0 && (!nextDue || !f.runOutDate || nextDue < f.runOutDate)) {
        // Already ordered and it should land before running out: inform, don't nag
        p.push({ id: `feed-${product.id}`, tone: 'info', when: 'soon', title: `${product.name}: ${fmtKg(ordered)} on order`,
          detail: `${nextDue ? `Due ${fmtDay(nextDue)}. ` : ''}Without it, runs out ${fmtDay(f.runOutDate)}`, to: `/feed/${product.id}` });
      } else if (f.status === 'order_now') {
        const late = f.orderByDate && f.orderByDate < today;
        p.push({ id: `feed-${product.id}`, tone: 'urgent', when: late ? 'overdue' : 'today', title: `Order ${product.name} now`,
          detail: f.runOutDate ? `Runs out ${fmtDay(f.runOutDate)}.${late ? ` Should have been ordered by ${fmtDay(f.orderByDate)}.` : ''} ${f.openOrders.length ? 'An order is already open.' : ''}`.trim() : 'Below safety stock', to: `/feed/${product.id}`, action: 'Call supplier' });
      } else if (f.status === 'order_soon') {
        p.push({ id: `feed-${product.id}`, tone: 'warn', when: 'soon', title: `Order ${product.name} by ${fmtDay(f.orderByDate ?? f.reorderDate)}`,
          detail: `${Math.floor(f.daysRemaining ?? 0)} days left at your feeding plan`, to: `/feed/${product.id}` });
      } else if (f.status === 'no_plan') {
        p.push({ id: `feed-${product.id}`, tone: 'info', when: 'later', dismissable: true, title: `Add a feeding plan for ${product.name}`, detail: 'So Agri-It can tell you when it runs out', to: `/feed/${product.id}/rule/new` });
      } else if (f.status === 'no_stock_record') {
        p.push({ id: `feed-${product.id}`, tone: 'info', when: 'later', dismissable: true, title: `How much ${product.name} is in the shed?`, detail: 'Add a stock count to start the forecast', to: `/feed/${product.id}/count` });
      }
      for (const o of b.txns.filter((t) => t.feed_product_id === product.id && t.txn_type === 'order' && t.order_status === 'open' && t.placed === false)) {
        const who = b.suppliers.find((s) => s.id === o.supplier_id)?.name;
        const late = f.orderByDate !== null && f.orderByDate < today;
        p.push({ id: `place-${o.id}`, tone: 'warn', when: late ? 'overdue' : 'today', title: `Place the ${product.name} order`,
          detail: `${fmtKg(Number(o.quantity_kg))}${who ? ` with ${who}` : ''}. Not placed yet: Agri-It doesn't send orders`, to: `/feed/${product.id}`, action: 'Placed?' });
      }
      for (const o of b.txns.filter((t) => t.feed_product_id === product.id && t.txn_type === 'order' && t.order_status === 'open' && t.placed !== false)) {
        const left = f.openOrders.find((x) => x.id === o.id)?.kg ?? 0;
        if (left > 0 && o.expected_delivery_date && o.expected_delivery_date <= today) {
          const part = left < Number(o.quantity_kg);
          p.push({ id: `order-${o.id}`, tone: 'warn', when: o.expected_delivery_date < today ? 'overdue' : 'today',
            title: part ? `Rest of the ${product.name} order?` : `Did the ${product.name} arrive?`,
            detail: part ? `${fmtKg(left)} of ${fmtKg(Number(o.quantity_kg))} still to come, due ${fmtDay(o.expected_delivery_date)}` : `${fmtKg(Number(o.quantity_kg))} was due ${fmtDay(o.expected_delivery_date)}`,
            to: `/record/delivery?feed=${product.id}&order=${o.id}`, action: 'Confirm delivery' });
        }
      }
    }

    // Bills: overdue ones stay until paid; ones falling due soon are flagged ahead
    const money = moneyStates(b, today);
    const overdue = money.owed.filter((o) => o.state === 'overdue');
    if (overdue.length) {
      const oldest = overdue.reduce((m, o) => (o.dueOn! < m ? o.dueOn! : m), today);
      p.push({ id: 'bills-overdue', tone: daysBetween(oldest, today) > 30 ? 'urgent' : 'warn', when: 'overdue',
        title: overdue.length === 1 ? `Pay ${overdue[0].payee}: ${eur(Number(overdue[0].cost.amount_eur))}` : `${overdue.length} bills overdue: ${eur(money.overdueTotal)}`,
        detail: overdue.length === 1 ? `Was due ${fmtDay(overdue[0].dueOn)}` : `Oldest was due ${fmtDay(oldest)}. ${[...new Set(overdue.map((o) => o.payee))].slice(0, 3).join(', ')}`,
        to: '/money/bills', action: 'Pay' });
    }
    const dueSoon = money.dueSoon(billDays);
    if (dueSoon.length) {
      const first = dueSoon[0];
      p.push({ id: 'bills-due', tone: first.daysToDue! <= 1 ? 'warn' : 'info', when: first.daysToDue === 0 ? 'today' : 'soon',
        title: dueSoon.length === 1 ? `${first.payee} due ${fmtDay(first.dueOn)}: ${eur(Number(first.cost.amount_eur))}` : `${dueSoon.length} bills due in the next ${billDays} days`,
        detail: dueSoon.length === 1 ? (first.cost.description ?? 'Bill to pay') : `${eur(dueSoon.reduce((s, o) => s + Number(o.cost.amount_eur), 0))} in all. First: ${first.payee}, ${fmtDay(first.dueOn)}`,
        to: '/money/bills' });
    }
    const uninvoiced = b.costs.filter((c) => c.category === 'feed' && c.feed_transaction_id && !c.invoice_ref && c.payment_status === 'owed' && daysBetween(c.occurred_on, today) > 40);
    if (uninvoiced.length) {
      p.push({ id: 'feed-uninvoiced', tone: 'info', when: 'later', dismissable: true, title: `${uninvoiced.length} feed deliver${uninvoiced.length > 1 ? 'ies' : 'y'} with no invoice yet`,
        detail: 'Match the invoice when it comes, so the bill shows the right amount', to: '/record/invoice' });
    }
    const dupes = possibleDuplicateDeliveries(b, addDays(today, -30));
    for (const [a, c] of dupes) {
      const name = b.products.find((x) => x.id === a.feed_product_id)?.name ?? 'Feed';
      p.push({ id: `dupe-${c.id}`, tone: 'warn', when: 'today', title: `${name} delivery recorded twice?`,
        detail: `${fmtKg(Number(a.quantity_kg))} on ${fmtDay(a.effective_on)} appears twice (maybe from two phones)`, to: `/feed/${a.feed_product_id}?dupe=${c.id}`, action: 'Check' });
    }

    // Routines (bills, jobs, counts, orders) missed on earlier days stay until ticked, moved or skipped
    const missed = buildChecklist(b, today).filter((x) => x.kind !== 'feeding' && x.date < today && x.status === 'pending');
    if (missed.length) {
      const names = [...new Set(missed.map((x) => x.title))];
      p.push({ id: 'routines-missed', tone: 'warn', when: 'overdue', title: `${missed.length} from earlier not ticked off`,
        detail: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}. Tick, move or skip each one`, to: '/diary' });
    }

    const ss = silageSummary(forage);
    if (ss && ss.shortOfWinterT > 0) p.push({ id: 'forage', tone: 'urgent', when: 'soon', title: 'Silage short for the winter', detail: ss.line, to: '/forecast?tab=forage' });
    else if (ss && ss.shortOfTargetT > 0) p.push({ id: 'forage', tone: 'warn', when: 'soon', title: 'Winter silage is tight', detail: ss.line, to: '/forecast?tab=forage' });
    if (cash && cashGaps.stale) p.push({ id: 'cash-check', tone: 'info', when: 'later', title: 'Check your cash against the bank', detail: `Last checked ${cashGaps.daysSinceCheck} days ago. Recorded cash is not a bank balance`, to: '/forecast?tab=cash' });
    if (cash90.lowest && cash && cash90.lowest.closing < 0) p.push({ id: 'cash', tone: 'urgent', when: 'soon', title: 'Cash may go overdrawn', detail: `Lowest point about ${eur(cash90.lowest.closing)}, from recorded cash, bills owed, repeats and budget`, to: '/forecast?tab=cash' });
    // Budget variance: only the year-so-far and this-month alerts reach Today; last month's note stays on Money
    const alerts = budgetAlerts(b.farm, b, today);
    for (const a of alerts.filter((x) => x.tone === 'warn')) {
      p.push({ id: a.id, tone: 'warn', when: 'later', title: a.title, detail: a.detail, to: '/money' });
    }
    for (const j of b.jobs.filter((x) => !x.done_at && !x.dismissed_at && x.due_on && daysBetween(today, x.due_on) <= 2)) {
      const when: When = j.due_on! < today ? 'overdue' : j.due_on === today ? 'today' : 'soon';
      p.push({ id: `job-${j.id}`, tone: when === 'overdue' ? 'warn' : 'info', when, title: j.title, detail: when === 'overdue' ? `Overdue since ${fmtDay(j.due_on)}` : `Due ${fmtDay(j.due_on)}`, to: '/farm/jobs' });
    }
    const stale = b.groups.filter((g) => !g.archived && daysBetween(g.head_count_updated_at.slice(0, 10), today) > 30);
    if (stale.length) p.push({ id: 'heads', tone: 'info', when: 'later', dismissable: true, title: 'Check your head counts', detail: `${stale.map((g) => g.name).join(', ')} not updated in a month`, to: '/farm/groups' });
    if (cash === null) p.push({ id: 'opening-cash', tone: 'info', when: 'later', dismissable: true, title: 'Add your bank balance', detail: 'Unlocks the cash-flow forecast', to: '/settings' });

    // A farm worker doesn't see the farm's money (RLS hides it too): no bill, cash or budget items
    const moneyIds = /^(bills-|cash$|opening-cash$|budget-|feed-uninvoiced$)/;
    if (b.role === 'worker') for (let i = p.length - 1; i >= 0; i--) if (moneyIds.test(p[i].id)) p.splice(i, 1);
    // Things Agri-It has drafted for approval replace the plain reminder for the same thing
    const suggestions = buildSuggestions(b, feed, today);
    const drafted = new Set(suggestions.map((x) => x.key.startsWith('order:') ? `feed-${x.key.split(':')[1]}` : x.key.startsWith('heads:') ? 'heads' : ''));
    for (let i = p.length - 1; i >= 0; i--) if (drafted.has(p[i].id)) p.splice(i, 1);
    p.sort((a, c) => whenRank[a.when] - whenRank[c.when] || toneRank[a.tone] - toneRank[c.tone]);
    return { today, feed, forage, cash, cash90, cashGaps, budget, budgetAlerts: alerts, prices: pricePoints(b), yearEnd, money, priorities: p, suggestions, computedAt: new Date() };
  }
}

export function useDerived(b: FarmBundle) {
  const today = todayISO();
  return useMemo(() => derive(b, today), [b, today]);
}

/** Forecast governance: persist inputs + output + rule version whenever inputs change. */
export function useSnapshotRecorder(b: FarmBundle | undefined, d: ReturnType<typeof useDerived> | undefined) {
  useEffect(() => {
    if (!b || !d || (!IN_BROWSER && !navigator.onLine)) return;
    const seenKey = key('snapshots');
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(seenKey) ?? '[]'));
    const rows: Record<string, unknown>[] = [];
    for (const f of d.feed.values()) {
      const k = `${f.productId}:${f.inputsHash}`;
      if (seen.has(k) || f.stockKg === null) continue;
      seen.add(k);
      rows.push({
        farm_id: b.farm.id, forecast_type: 'feed_runout', subject_id: f.productId, inputs_hash: f.inputsHash,
        inputs: f.inputs, confidence: f.confidence, rule_version: String(f.inputs.rule_version),
        output: { stock_kg: f.stockKg, daily_use_kg: f.dailyUseKg, days_remaining: f.daysRemaining, run_out: f.runOutDate, reorder: f.reorderDate, order_by: f.orderByDate, reasons: f.reasons }
      });
    }
    const fk = `forage:${d.forage.inputsHash}`;
    if (!seen.has(fk)) {
      seen.add(fk);
      rows.push({
        farm_id: b.farm.id, forecast_type: 'forage', subject_id: b.farm.id, inputs_hash: d.forage.inputsHash,
        inputs: d.forage.inputs, confidence: d.forage.confidence, rule_version: String(d.forage.inputs.rule_version),
        output: { available_t: d.forage.availableT, need_with_reserve_t: d.forage.needWithReserveT, balance_t: d.forage.balanceT, status: d.forage.status }
      });
    }
    sessionStorage.setItem(seenKey, JSON.stringify([...seen]));
    if (rows.length) {
      supabase.from('forecast_snapshots')
        .upsert(rows, { onConflict: 'subject_id,forecast_type,inputs_hash', ignoreDuplicates: true })
        .then(({ error }) => { if (error) console.warn('snapshot', error.message); });
    }
  }, [b, d]);
}

/**
 * What a reminder should lead with: urgent items, then anything overdue or due today that
 * matters (feed to order, an order that didn't arrive, a bill due or overdue), worst first.
 */
export function reminderHeadlines(p: Priority[], s: { title: string; when: string; tone: string }[] = []): string[] {
  const ready = s.filter((x) => x.when === 'overdue' || x.when === 'today').map((x) => x.title);
  return [...p.filter((x) => x.tone === 'urgent' || ((x.when === 'overdue' || x.when === 'today') && x.tone === 'warn') || x.id === 'bills-due')
    .sort((a, c) => (a.tone === 'urgent' ? 0 : 1) - (c.tone === 'urgent' ? 0 : 1))
    .map((x) => x.title), ...ready];
}
