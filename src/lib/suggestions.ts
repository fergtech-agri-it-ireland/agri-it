/**
 * Ready to approve (rule suggestions@1.0).
 *
 * Agri-It does the legwork and puts the result in front of the farmer as a suggestion: a feed
 * order drafted from their own last order, a routine for a bill that comes every month, groups
 * to bring in when housing starts, the jobs for drying off and calving. Nothing is recorded
 * until the farmer taps Approve. "Not now" hides a suggestion for a week; "No" for good.
 *
 * Every suggestion is built only from the farm's own records and published timings (season.ts).
 * Nothing is invented: no supplier price, lead time or quantity the farmer hasn't used before.
 */
import type { CalvingSeason, Cost, FarmBundle, ISODate, Job, Routine, SuggestionDecision } from './types';
import { COST_LABEL } from './types';
import type { FeedForecast } from './forecast/feed';
import type { Op } from './offline/outbox';
import { addDays, daysBetween, eur, fmtDay, fmtKg, uuid } from './format';
import { calfTodos, decisionFor, seasonSteps, stepDecisionKey, stepWhen, type SeasonStep } from './season';
import { estimateStore } from './forecast/forage';

export const SUGGESTIONS_RULE_VERSION = 'suggestions@1.0';

export type SuggestionWhen = 'overdue' | 'today' | 'soon' | 'later';

export interface Approval {
  label: string;
  /** What gets saved on Approve */
  ops: Op[];
  /** The same change made to the cached farm, so screens move at once */
  patch: (b: FarmBundle) => FarmBundle;
  /** Toast after saving */
  saved: string;
  /** Where to go after (optional) */
  then?: string;
}

export interface Suggestion {
  key: string;
  when: SuggestionWhen;
  tone: 'warn' | 'info';
  title: string;
  detail: string;
  /** Why Agri-It is suggesting it, in a few words */
  why: string;
  /** Approve does it in one tap; `to` opens a screen to finish it */
  approve?: Approval;
  to?: { label: string; href: string };
  /** For season steps: links to the published sources behind the timing */
  sourceCodes?: string[];
  /** Can be put off or turned down (anything legally due cannot) */
  canDecline: boolean;
  /** Ordering within one kind of suggestion */
  rank?: number;
}

const whenRank: Record<SuggestionWhen, number> = { overdue: 0, today: 1, soon: 2, later: 3 };

/** The decision row saved when the farmer approves, puts off or turns down a suggestion. */
export function decisionOp(farmId: string, key: string, decision: SuggestionDecision['decision'], today: ISODate): { op: Op; row: SuggestionDecision } {
  const row: SuggestionDecision = { id: uuid(), farm_id: farmId, key, decision, until: decision === 'snoozed' ? addDays(today, 7) : null, decided_at: new Date().toISOString() };
  return { op: { kind: 'insert', table: 'suggestion_decisions', row: row as unknown as Record<string, unknown> }, row };
}

const withDecision = (row: SuggestionDecision) => (b: FarmBundle): FarmBundle => ({ ...b, decisions: [...(b.decisions ?? []), row] });

function hidden(decisions: SuggestionDecision[], key: string, today: ISODate) {
  return decisionFor(decisions, key, today).status !== 'open';
}

// ---------------------------------------------------------------------------
// Season steps
// ---------------------------------------------------------------------------
function jobsApproval(b: FarmBundle, season: CalvingSeason, step: SeasonStep, today: ISODate): Approval {
  if (step.action.kind !== 'jobs') throw new Error('not a jobs step');
  const dueOn = step.date < today ? today : step.date;
  const jobs: Job[] = step.action.jobs.map((title) => ({ id: uuid(), farm_id: b.farm.id, title, due_on: dueOn, done_at: null, dismissed_at: null }));
  const { op, row } = decisionOp(b.farm.id, stepDecisionKey(season.id, step.key), 'done', today);
  return {
    label: jobs.length > 1 ? `Add ${jobs.length} jobs` : 'Add to my jobs',
    ops: [...jobs.map((j) => ({ kind: 'insert' as const, table: 'jobs', row: j as unknown as Record<string, unknown> })), op],
    patch: (x) => withDecision(row)({ ...x, jobs: [...x.jobs, ...jobs] }),
    saved: jobs.length > 1 ? `${jobs.length} jobs added for ${fmtDay(dueOn)}` : `Added to your jobs for ${fmtDay(dueOn)}`
  };
}

/** One season step as a suggestion (used on Today and on the calving plan). */
export function stepSuggestion(b: FarmBundle, season: CalvingSeason, step: SeasonStep, today: ISODate, when: SuggestionWhen): Suggestion {
  const base = {
    key: stepDecisionKey(season.id, step.key), when, tone: (when === 'overdue' ? 'warn' : 'info') as 'warn' | 'info',
    title: step.title, detail: step.detail, sourceCodes: step.sourceCodes, canDecline: true,
    why: `${season.label}: ${step.until ? `${fmtDay(step.date)} to ${fmtDay(step.until)}` : fmtDay(step.date)}${step.ourTiming ? ' (timing suggested by Agri-It)' : ''}`
  };
  if (step.action.kind === 'jobs') return { ...base, approve: jobsApproval(b, season, step, today) };
  if (step.action.kind === 'dry_off') return { ...base, to: { label: 'Dry off cows', href: `/calving/dry-off?season=${season.id}&batch=${step.action.batch}` } };
  return { ...base, to: { label: step.action.label, href: step.action.to } };
}

export function seasonSuggestions(b: FarmBundle, today: ISODate): Suggestion[] {
  const out: Suggestion[] = [];
  for (const season of (b.seasons ?? []).filter((s) => !s.archived)) {
    for (const step of seasonSteps(season, b.decisions ?? [], today, b.farm)) {
      const when = stepWhen(step, today);
      if (!when || when === 'later') continue;
      out.push(stepSuggestion(b, season, step, today, when));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feed: an order drafted from the farm's own last order or delivery
// ---------------------------------------------------------------------------
export function feedOrderSuggestions(b: FarmBundle, feed: Map<string, FeedForecast>, today: ISODate): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of b.products.filter((x) => !x.archived)) {
    const f = feed.get(p.id);
    if (!f || (f.status !== 'order_now' && f.status !== 'order_soon') || f.openOrders.length) continue;
    const key = `order:${p.id}:${f.orderByDate ?? f.reorderDate ?? today}`;
    if (hidden(b.decisions ?? [], key, today)) continue;
    const last = b.txns.filter((t) => t.feed_product_id === p.id && (t.txn_type === 'order' || t.txn_type === 'delivery') && Number(t.quantity_kg) > 0)
      .sort((a, c) => c.effective_on.localeCompare(a.effective_on))[0];
    const supplierId = p.supplier_id ?? last?.supplier_id ?? null;
    const supplier = b.suppliers.find((s) => s.id === supplierId)?.name ?? null;
    const late = f.orderByDate !== null && f.orderByDate < today;
    const when: SuggestionWhen = late ? 'overdue' : f.status === 'order_now' ? 'today' : 'soon';
    const by = f.orderByDate ? `Order by ${fmtDay(f.orderByDate)}` : f.runOutDate ? `Runs out ${fmtDay(f.runOutDate)}` : 'Below your safety stock';
    if (!last) {
      out.push({ key, when, tone: 'warn', title: `Order ${p.name}`, detail: `${by}. How much do you want?`, why: 'At your feeding plan', canDecline: true,
        to: { label: 'Order', href: `/record/order?feed=${p.id}` } });
      continue;
    }
    const kg = Number(last.quantity_kg);
    const expected = f.leadTimeDays !== null ? addDays(today, f.leadTimeDays) : null;
    const row = {
      id: uuid(), farm_id: b.farm.id, feed_product_id: p.id, txn_type: 'order' as const, quantity_kg: kg, order_date: today,
      expected_delivery_date: expected, effective_on: expected ?? today, order_status: 'open' as const, supplier_id: supplierId, evidence: 'unconfirmed' as const,
      price_per_tonne_eur: null, total_price_eur: null
    };
    out.push({
      key, when, tone: 'warn', canDecline: true,
      title: `Order ${fmtKg(kg)} of ${p.name}${supplier ? ` from ${supplier}` : ''}?`,
      detail: `${by}. Same amount as your last ${last.txn_type === 'order' ? 'order' : 'delivery'} (${fmtDay(last.effective_on)}).${expected ? ` Expected ${fmtDay(expected)} (your ${f.leadTimeDays}-day delivery time).` : ' Add the delivery date when the supplier tells you.'}`,
      why: `${Math.max(0, Math.floor(f.daysRemaining ?? 0))} days left at your feeding plan`,
      approve: {
        label: 'Record the order', ops: [{ kind: 'insert', table: 'feed_transactions', row }],
        patch: (x) => ({ ...x, txns: [...x.txns, { ...row, delivery_date: null, linked_order_id: null, document_id: null, notes: null, created_at: new Date().toISOString() } as unknown as FarmBundle['txns'][number]] }),
        saved: 'Order recorded. Ring the supplier to place it', then: `/feed/${p.id}`
      },
      to: { label: 'Change it', href: `/record/order?feed=${p.id}&kg=${kg}` }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Housing and turnout: bring the groups in (or out) on the farm's own dates
// ---------------------------------------------------------------------------
const EATS_SILAGE = (c: string) => c !== 'pig' && c !== 'poultry' && c !== 'horse';

export function housingSuggestions(b: FarmBundle, today: ISODate): Suggestion[] {
  const out: Suggestion[] = [];
  const { housing_start: hs, turnout_date: to } = b.farm;
  const live = b.groups.filter((g) => !g.archived && g.housed && g.head_count > 0 && EATS_SILAGE(g.animal_class));
  // Groups out at grass whose day to come in has come (their own date, or the farm's housing date)
  const due = live.filter((g) => g.at_grass && (g.housed_from ?? hs ?? '9999') <= today);
  if (due.length) {
    const key = `housing:${due.map((g) => `${g.id}@${g.housed_from ?? hs}`).join(',')}`;
    if (!hidden(b.decisions ?? [], key, today)) {
      const ids = due.map((g) => g.id);
      out.push({
        key, when: 'today', tone: 'info', canDecline: true,
        title: due.length === 1 ? `Is ${due[0].name} in now?` : 'Are these in for the winter now?',
        detail: due.map((g) => `${g.name} (${g.head_count})`).join(', '),
        why: `${due.length === 1 ? 'Its' : 'Their'} day to come in was ${fmtDay(due.map((g) => g.housed_from ?? hs!).sort()[0])}. Your silage plan counts them from the day they're in`,
        approve: {
          label: due.length === 1 ? 'Yes, in today' : 'Yes, all in today',
          ops: ids.map((id) => ({ kind: 'update' as const, table: 'animal_groups', match: { id }, patch: { at_grass: false, housed_from: today } })),
          patch: (x) => ({ ...x, groups: x.groups.map((g) => (ids.includes(g.id) ? { ...g, at_grass: false, housed_from: today } : g)) }),
          saved: 'Marked in. Your silage plan is updated'
        },
        to: { label: 'Not yet: set a date', href: '/farm/groups' }
      });
    }
  }
  // Winter over: next winter's dates
  if (to && to < today && (!hs || hs < to)) {
    const key = `winter-dates:${to}`;
    if (!hidden(b.decisions ?? [], key, today)) {
      out.push({
        key, when: 'later', tone: 'info', canDecline: true,
        title: 'Set next winter\'s dates',
        detail: `Turnout was ${fmtDay(to)}. Put in when housing starts next and when you expect to let out, so the silage plan looks ahead.`,
        why: 'Your winter dates are in the past',
        to: { label: 'Set dates', href: '/settings' }
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Head counts: confirm a stale count in one tap (keeps forecasts at High confidence)
// ---------------------------------------------------------------------------
export function headCountSuggestions(b: FarmBundle, today: ISODate): Suggestion[] {
  const stale = b.groups.filter((g) => !g.archived && g.head_count > 0 && daysBetween(g.head_count_updated_at.slice(0, 10), today) > 30);
  if (!stale.length) return [];
  const key = `heads:${stale.map((g) => `${g.id}@${g.head_count_updated_at.slice(0, 10)}`).join(',')}`;
  if (hidden(b.decisions ?? [], key, today)) return [];
  const now = `${today}T12:00:00.000Z`;
  return [{
    key, when: 'later', tone: 'info', canDecline: true,
    title: stale.length === 1 ? `Still ${stale[0].head_count} in ${stale[0].name}?` : 'Are these head counts still right?',
    detail: stale.map((g) => `${g.name}: ${g.head_count}`).join(', '),
    why: 'Not checked in over a month, so feed forecasts drop to Medium',
    approve: {
      label: stale.length === 1 ? 'Yes, still right' : 'Yes, all still right',
      ops: stale.map((g) => ({ kind: 'rpc' as const, fn: 'set_head_count', args: { p_group_id: g.id, p_head_count: g.head_count, p_reason: 'confirmed' } })),
      patch: (x) => ({ ...x, groups: x.groups.map((g) => (stale.some((s) => s.id === g.id) ? { ...g, head_count_updated_at: now } : g)) }),
      saved: 'Head counts confirmed'
    },
    to: { label: 'Change a count', href: '/farm/groups' }
  }];
}

// ---------------------------------------------------------------------------
// Bills that come every month: offer a routine so they're ticked off, not typed
// ---------------------------------------------------------------------------
const payeeOf = (b: FarmBundle, c: Cost) => (c.supplier_name ?? b.suppliers.find((s) => s.id === c.supplier_id)?.name ?? '').trim();

export function recurringCostSuggestions(b: FarmBundle, today: ISODate): Suggestion[] {
  const out: Suggestion[] = [];
  const since = addDays(today, -200);
  const groups = new Map<string, Cost[]>();
  for (const c of b.costs) {
    if (c.feed_transaction_id || c.category === 'feed' || c.occurred_on < since || c.occurred_on > today) continue;
    const payee = payeeOf(b, c);
    if (!payee) continue;
    const k = `${c.category}|${payee.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const hasRoutine = (r: Routine, payee: string, cat: string) => r.kind === 'expense' && r.active && ((r.counterparty ?? '').toLowerCase() === payee.toLowerCase() || (!r.counterparty && r.category === cat));
  for (const [k, list] of groups) {
    const sorted = [...list].sort((a, c) => a.occurred_on.localeCompare(c.occurred_on));
    if (sorted.length < 3) continue;
    const gaps = sorted.slice(1).map((c, i) => daysBetween(sorted[i].occurred_on, c.occurred_on));
    if (!gaps.every((g) => g >= 25 && g <= 35)) continue;
    const last = sorted[sorted.length - 1];
    if (daysBetween(last.occurred_on, today) > 40) continue;
    const payee = payeeOf(b, last);
    if (b.routines.some((r) => hasRoutine(r, payee, last.category))) continue;
    const key = `recurring:${k}`;
    if (hidden(b.decisions ?? [], key, today)) continue;
    const dom = Number(last.occurred_on.slice(8, 10));
    const nextMonth = addDays(last.occurred_on, 20);
    const routine: Routine = {
      id: uuid(), farm_id: b.farm.id, kind: 'expense', title: payee, frequency: 'monthly', interval_days: null, weekday: null, day_of_month: dom,
      start_date: nextMonth, end_date: null, amount: Number(last.amount_eur), category: last.category, counterparty: payee,
      feed_product_id: null, silage_store_id: null, supplier_id: last.supplier_id, active: true, created_at: new Date().toISOString()
    };
    const { created_at: _c, ...row } = routine;
    out.push({
      key, when: 'later', tone: 'info', canDecline: true, rank: sorted.length,
      title: `${payee} looks monthly: tick it off instead of typing it?`,
      detail: `${sorted.length} bills about a month apart, last ${eur(Number(last.amount_eur))} on ${fmtDay(last.occurred_on)} (${COST_LABEL[last.category].toLowerCase()}). It goes in your diary on the ${dom}${dom === 1 || dom === 21 || dom === 31 ? 'st' : dom === 2 || dom === 22 ? 'nd' : dom === 3 || dom === 23 ? 'rd' : 'th'}; you tick it with the real amount.`,
      why: 'From your own bills',
      approve: {
        label: 'Make it a routine', ops: [{ kind: 'insert', table: 'routines', row }],
        patch: (x) => ({ ...x, routines: [...x.routines, routine] }), saved: `${payee} added to your routines`
      }
    });
  }
  // Two at a time, the most regular first: a wall of suggestions is as bad as none
  return out.sort((a, c) => (c.rank ?? 0) - (a.rank ?? 0)).slice(0, 2);
}

// ---------------------------------------------------------------------------
// Silage with no dry matter: the yard test takes a minute and fills the winter plan
// ---------------------------------------------------------------------------
export function silageSuggestions(b: FarmBundle, today: ISODate): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of b.silage) {
    if (s.method !== 'pit_dimensions' && s.method !== 'bale_count') continue;
    const e = estimateStore(s, b.farm.jurisdiction);
    if (!e.bestGuess) continue;
    const key = `silage-dm:${s.id}`;
    if (hidden(b.decisions ?? [], key, today)) continue;
    const pit = s.method === 'pit_dimensions';
    out.push({
      key, when: 'later', tone: 'info', canDecline: true,
      title: pit ? `${s.name}: make the best guess better` : `${s.name}: weigh one bale?`,
      detail: pit
        ? 'Your winter plan uses typical silage for this pit. A one-minute squeeze test in the yard tightens the tonnes. No lab needed.'
        : 'Your winter plan uses a typical 600 kg bale. One weighed bale (mart or loader scale) tightens the tonnes.',
      why: 'The silage figure is a best guess from typical figures',
      to: { label: pit ? 'Do the squeeze test' : 'Add the weight', href: `/farm/silage/${s.id}/edit` }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Calves: tagging and registering (legal deadlines, so they can't be turned down)
// ---------------------------------------------------------------------------
export function calfSuggestions(b: FarmBundle, today: ISODate): Suggestion[] {
  const births = b.births ?? [];
  if (!births.length) return [];
  const herdOf = (x: { season_id: string | null }) => (b.seasons ?? []).find((s) => s.id === x.season_id)?.herd ?? (b.farm.enterprises?.includes('dairy') ? 'dairy' : 'suckler');
  return calfTodos(births, b.farm.jurisdiction, herdOf, today).map((t) => {
    const field = t.kind === 'tag' ? 'tagged_on' : 'registered_on';
    const ids = t.births.map((x) => x.id);
    const when: SuggestionWhen = t.overdue ? 'overdue' : t.firstBy === today ? 'today' : daysBetween(today, t.firstBy) <= 3 ? 'soon' : 'later';
    const verb = t.kind === 'tag' ? 'Tag' : 'Register';
    return {
      key: `calves:${t.kind}`, when, tone: when === 'overdue' || when === 'today' ? 'warn' : 'info', canDecline: false,
      title: `${verb} ${t.calves} ${t.calves === 1 ? 'calf' : 'calves'}`,
      detail: `${t.overdue ? `${t.overdue} past the deadline. ` : ''}First one by ${fmtDay(t.firstBy)}.`,
      why: t.kind === 'tag' ? (b.farm.jurisdiction === 'NI' ? 'NI: dairy calves within 36 hours, others within 20 days' : 'Calves must be tagged before 20 days of age') : 'Calves must be registered within 27 days of birth',
      approve: {
        label: t.kind === 'tag' ? 'All tagged today' : 'All registered today',
        ops: ids.map((id) => ({ kind: 'update' as const, table: 'calf_births', match: { id }, patch: { [field]: today } })),
        patch: (x) => ({ ...x, births: x.births.map((y) => (ids.includes(y.id) ? { ...y, [field]: today } : y)) }),
        saved: t.kind === 'tag' ? 'Marked tagged' : 'Marked registered'
      },
      to: { label: 'One by one', href: '/calving' }
    } satisfies Suggestion;
  });
}

/** Everything ready for the farmer, most pressing first. A farm worker sees no money suggestions. */
export function suggestions(b: FarmBundle, feed: Map<string, FeedForecast>, today: ISODate): Suggestion[] {
  const all = [
    ...calfSuggestions(b, today),
    ...seasonSuggestions(b, today),
    ...feedOrderSuggestions(b, feed, today),
    ...housingSuggestions(b, today),
    ...silageSuggestions(b, today),
    ...headCountSuggestions(b, today),
    ...(b.role === 'worker' ? [] : recurringCostSuggestions(b, today))
  ];
  return all.sort((a, c) => whenRank[a.when] - whenRank[c.when] || (a.tone === 'warn' ? 0 : 1) - (c.tone === 'warn' ? 0 : 1));
}
