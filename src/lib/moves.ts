/**
 * Moving animals between groups as one change (drying off, a cow calving back into the milking
 * herd), and what that does to the feed forecasts. Pure apart from new ids.
 */
import type { AnimalGroup, FarmBundle, ISODate } from './types';
import type { Op } from './offline/outbox';
import { headChangeRow, headsOn } from './heads';
import { feedForecasts } from './data/derived';
import { uuid } from './format';

export interface MovePlan { ops: Op[]; undo: Op[]; patch: (b: FarmBundle) => FarmBundle }

export function planMove(b: FarmBundle, from: AnimalGroup, to: AnimalGroup, n: number, on: ISODate, today: ISODate): MovePlan {
  const hist = (id: string) => b.headHistory.filter((h) => h.animal_group_id === id);
  const fromN = headsOn(from, on, hist(from.id));
  const toN = headsOn(to, on, hist(to.id));
  const id = uuid();
  const rows = [{ ...headChangeRow(from, fromN - n, on, `moved to ${to.name}`, fromN), id }, headChangeRow(to, toN + n, on, `moved from ${from.name}`, toN)];
  return {
    ops: [{ kind: 'rpc', fn: 'move_animals', args: { p_id: id, p_farm_id: b.farm.id, p_from: from.id, p_to: to.id, p_count: n, p_effective_on: on } }],
    undo: [{ kind: 'rpc', fn: 'move_animals', args: { p_id: uuid(), p_farm_id: b.farm.id, p_from: to.id, p_to: from.id, p_count: n, p_effective_on: on } }],
    patch: (x) => {
      const all = [...x.headHistory, ...rows];
      return { ...x, headHistory: all, groups: x.groups.map((g) => (g.id === from.id || g.id === to.id ? { ...g, head_count: headsOn(g, today, all.filter((h) => h.animal_group_id === g.id)), head_count_updated_at: new Date().toISOString() } : g)) };
    }
  };
}

export interface FeedImpact { productId: string; name: string; beforeKg: number; afterKg: number; beforeRunOut: ISODate | null; afterRunOut: ISODate | null }

/** Each feed whose daily use changes when the plan is applied: kg a day and run-out, before and after. */
export function feedImpact(b: FarmBundle, patch: (b: FarmBundle) => FarmBundle, today: ISODate): FeedImpact[] {
  const before = feedForecasts(b, today);
  const after = feedForecasts(patch(b), today);
  const out: FeedImpact[] = [];
  for (const p of b.products.filter((x) => !x.archived)) {
    const f0 = before.get(p.id);
    const f1 = after.get(p.id);
    if (!f0 || !f1) continue;
    // The day's use changes from the move date: compare the use the forecast runs on
    const k0 = f0.dailyUseKg;
    const k1 = f1.dailyUseKg;
    const upcoming0 = f0.upcomingChanges.at(-1)?.dailyUseKg ?? k0;
    const upcoming1 = f1.upcomingChanges.at(-1)?.dailyUseKg ?? k1;
    if (Math.abs(k0 - k1) < 0.5 && Math.abs(upcoming0 - upcoming1) < 0.5 && f0.runOutDate === f1.runOutDate) continue;
    out.push({ productId: p.id, name: p.name, beforeKg: Math.abs(k0 - k1) >= 0.5 ? k0 : upcoming0, afterKg: Math.abs(k0 - k1) >= 0.5 ? k1 : upcoming1, beforeRunOut: f0.runOutDate, afterRunOut: f1.runOutDate });
  }
  return out;
}
