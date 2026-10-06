import { useEffect, useMemo } from 'react';
import type { FarmBundle, ISODate } from '../types';
import { forecastFeed, type FeedForecast } from '../forecast/feed';
import { forecastForage } from '../forecast/forage';
import { budgetVsActual, cashForecast90, cashPosition, yearEndPack } from '../forecast/money';
import { daysBetween, fmtDay, fmtKg, todayISO, eur } from '../format';
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
      logs: b.feedLogs.filter((l) => l.feed_product_id === p.id)
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
export interface Priority {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  to: string;
  action?: string;
}

const toneRank: Record<Tone, number> = { urgent: 0, warn: 1, info: 2, ok: 3 };

export function useDerived(b: FarmBundle) {
  const today = todayISO();
  return useMemo(() => {
    const feed = feedForecasts(b, today);
    const forage = forecastForage({ farm: b.farm, stores: silageWithFedOut(b), groups: b.groups, benchmarks: b.benchmarks, evidence: b.evidence, today });
    const cash = cashPosition(b.farm, b.income, b.costs, today);
    const cash90 = cashForecast90(b.farm, b.income, b.costs, b.budget, today);
    const budget = budgetVsActual(b.farm, b, today);
    const yearEnd = yearEndPack(b, today);

    const p: Priority[] = [];
    for (const product of b.products.filter((x) => !x.archived)) {
      const f = feed.get(product.id)!;
      const ordered = f.openOrders.reduce((s, o) => s + o.kg, 0);
      const nextDue = f.openOrders.map((o) => o.expected).filter(Boolean).sort()[0] ?? null;
      if ((f.status === 'order_now' || f.status === 'order_soon') && ordered > 0 && (!nextDue || !f.runOutDate || nextDue < f.runOutDate)) {
        // Already ordered and it should land before running out: inform, don't nag
        p.push({ id: `feed-${product.id}`, tone: 'info', title: `${product.name}: ${fmtKg(ordered)} on order`,
          detail: `${nextDue ? `Due ${fmtDay(nextDue)}. ` : ''}Without it, runs out ${fmtDay(f.runOutDate)}`, to: `/feed/${product.id}` });
      } else if (f.status === 'order_now') {
        p.push({ id: `feed-${product.id}`, tone: 'urgent', title: `Order ${product.name} now`,
          detail: f.runOutDate ? `Runs out ${fmtDay(f.runOutDate)}. ${f.openOrders.length ? 'An order is already open.' : ''}`.trim() : 'Below safety stock', to: `/feed/${product.id}`, action: 'Call supplier' });
      } else if (f.status === 'order_soon') {
        p.push({ id: `feed-${product.id}`, tone: 'warn', title: `Order ${product.name} by ${fmtDay(f.orderByDate ?? f.reorderDate)}`,
          detail: `${Math.floor(f.daysRemaining ?? 0)} days left at your feeding plan`, to: `/feed/${product.id}` });
      } else if (f.status === 'no_plan') {
        p.push({ id: `feed-${product.id}`, tone: 'info', title: `Add a feeding plan for ${product.name}`, detail: 'So Agri-It can tell you when it runs out', to: `/feed/${product.id}/rule/new` });
      } else if (f.status === 'no_stock_record') {
        p.push({ id: `feed-${product.id}`, tone: 'info', title: `How much ${product.name} is in the shed?`, detail: 'Add a stock count to start the forecast', to: `/feed/${product.id}/count` });
      }
      for (const o of b.txns.filter((t) => t.feed_product_id === product.id && t.txn_type === 'order' && t.order_status === 'open')) {
        if (o.expected_delivery_date && o.expected_delivery_date <= today) {
          p.push({ id: `order-${o.id}`, tone: 'warn', title: `Did the ${product.name} arrive?`, detail: `${fmtKg(Number(o.quantity_kg))} was due ${fmtDay(o.expected_delivery_date)}`, to: `/record/delivery?feed=${product.id}&order=${o.id}`, action: 'Confirm delivery' });
        }
      }
    }
    if (forage.status === 'deficit') p.push({ id: 'forage', tone: 'urgent', title: 'Silage short for the winter', detail: `About ${Math.round(Math.abs((forage.needT ?? 0) - forage.availableT))} t short before reserve`, to: '/forecast?tab=forage' });
    else if (forage.status === 'tight') p.push({ id: 'forage', tone: 'warn', title: 'Winter silage is tight', detail: `Covers the winter but not your ${forage.reservePercent}% reserve`, to: '/forecast?tab=forage' });
    if (cash90.lowest && cash && cash90.lowest.closing < 0) p.push({ id: 'cash', tone: 'urgent', title: 'Cash may go overdrawn', detail: `Lowest point about ${eur(cash90.lowest.closing)} by the end of the period`, to: '/forecast?tab=cash' });
    if (budget.adequate) {
      for (const r of budget.rows.filter((x) => x.kind === 'cost' && x.budget > 0 && x.variance / x.budget > 0.1)) {
        p.push({ id: `budget-${r.category}`, tone: 'warn', title: `${r.label} is over budget`, detail: `${eur(r.variance)} over so far this year`, to: '/money' });
      }
    }
    for (const j of b.jobs.filter((x) => !x.done_at && x.due_on && daysBetween(today, x.due_on) <= 2)) {
      p.push({ id: `job-${j.id}`, tone: j.due_on! < today ? 'warn' : 'info', title: j.title, detail: j.due_on! < today ? `Overdue since ${fmtDay(j.due_on)}` : `Due ${fmtDay(j.due_on)}`, to: '/farm/jobs' });
    }
    const stale = b.groups.filter((g) => !g.archived && daysBetween(g.head_count_updated_at.slice(0, 10), today) > 30);
    if (stale.length) p.push({ id: 'heads', tone: 'info', title: 'Check your head counts', detail: `${stale.map((g) => g.name).join(', ')} not updated in a month`, to: '/farm/groups' });
    if (cash === null) p.push({ id: 'opening-cash', tone: 'info', title: 'Add your bank balance', detail: 'Unlocks the cash-flow forecast', to: '/settings' });

    p.sort((a, c) => toneRank[a.tone] - toneRank[c.tone]);
    return { today, feed, forage, cash, cash90, budget, yearEnd, priorities: p };
  }, [b, today]);
}

/** Forecast governance: persist inputs + output + rule version whenever inputs change. */
export function useSnapshotRecorder(b: FarmBundle | undefined, d: ReturnType<typeof useDerived> | undefined) {
  useEffect(() => {
    if (!b || !d || !navigator.onLine) return;
    const seenKey = 'agri-it:snapshots';
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
