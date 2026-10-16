/**
 * Alert load (advisory board G12, 14 Oct 2026; rule alerts@1.0).
 *
 * 1. Bundling: related items on Needs your attention (and in the phone reminders) become one
 *    line each: "3 fields to spread", "2 feed orders to place". A bundle takes the most pressing
 *    member's timing and tone, so an overdue item is never hidden inside a calmer line.
 * 2. Not now: only information can be put off. The farmer says why (busy, done elsewhere, not
 *    relevant) and for how long. Anything owed, overdue or due today stays until dealt with.
 * 3. Counts for the pilot: per kind of alert, how often it was acted on, put off, turned down
 *    or ignored. Kept on this phone only and shown in Settings.
 *
 * Pure: no browser APIs (the storage wrapper is alertStore.ts), so it is unit tested.
 */
import type { ISODate } from './types';
import { addDays } from './format';

export const ALERTS_RULE_VERSION = 'alerts@1.0';

export type Tone = 'urgent' | 'warn' | 'info' | 'ok';
export type When = 'overdue' | 'today' | 'soon' | 'later';

export interface AlertItem {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  to: string;
  action?: string;
  when: When;
  dismissable?: boolean;
  /** Items with the same group are shown as one line when there are two or more */
  group?: string;
  /** Short name for the member inside a bundle (a field, a feed, a job) */
  name?: string;
  /** For a bundle: the items inside it */
  members?: AlertItem[];
}

const toneRank: Record<Tone, number> = { urgent: 0, warn: 1, info: 2, ok: 3 };
const whenRank: Record<When, number> = { overdue: 0, today: 1, soon: 2, later: 3 };

/** The words for a bundle of `n` items of one group, and where its line goes. */
const GROUPS: Record<string, { title: (n: number) => string; to: string }> = {
  'feed-order': { title: (n) => `${n} feeds to order`, to: '/progress' },
  'feed-setup': { title: (n) => `${n} feeds need a plan or a stock count`, to: '/progress' },
  'feed-on-order': { title: (n) => `${n} feeds on order`, to: '/progress' },
  'place-order': { title: (n) => `${n} orders to place with the supplier`, to: '/progress' },
  'order-arrive': { title: (n) => `${n} deliveries due to confirm`, to: '/diary' },
  dupe: { title: (n) => `${n} deliveries recorded twice?`, to: '/diary' },
  spread: { title: (n) => `${n} fields to spread`, to: '/fertiliser' },
  cut: { title: (n) => `Did you cut ${n} fields?`, to: '/farm/fields' },
  'fert-low': { title: (n) => `Low on ${n} fertilisers`, to: '/fertiliser' },
  'fert-short': { title: (n) => `Not enough of ${n} fertilisers for the fields due`, to: '/fertiliser' },
  'fert-check': { title: (n) => `Check ${n} fertiliser stocks`, to: '/fertiliser' },
  budget: { title: (n) => `${n} budget lines off track`, to: '/money' },
  job: { title: (n) => `${n} jobs due`, to: '/farm/jobs' }
};

const WHEN_WORD: Record<When, string> = { overdue: 'overdue', today: 'today', soon: 'coming up', later: 'later' };

/**
 * One line per group of two or more related items. Single items are left as they are.
 * Order is kept: a bundle sits where its most pressing member was.
 */
export function bundleAlerts<T extends AlertItem>(items: T[]): AlertItem[] {
  const byGroup = new Map<string, T[]>();
  for (const x of items) if (x.group && GROUPS[x.group]) byGroup.set(x.group, [...(byGroup.get(x.group) ?? []), x]);
  const out: AlertItem[] = [];
  const done = new Set<string>();
  for (const x of items) {
    const members = x.group ? byGroup.get(x.group) : undefined;
    if (!members || members.length < 2) { out.push(x); continue; }
    if (done.has(x.group!)) continue;
    done.add(x.group!);
    const sorted = [...members].sort((a, c) => whenRank[a.when] - whenRank[c.when] || toneRank[a.tone] - toneRank[c.tone]);
    const top = sorted[0];
    const names = sorted.map((m) => m.name ?? m.title);
    const counts = (['overdue', 'today', 'soon', 'later'] as When[])
      .map((w) => [w, sorted.filter((m) => m.when === w).length] as const).filter(([, n]) => n > 0);
    const split = counts.length > 1 ? `${counts.map(([w, n]) => `${n} ${WHEN_WORD[w]}`).join(', ')}. ` : '';
    out.push({
      id: `bundle-${x.group}`,
      group: x.group,
      tone: top.tone,
      when: top.when,
      title: GROUPS[x.group!].title(members.length),
      detail: `${split}${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`,
      to: GROUPS[x.group!].to,
      action: top.action,
      dismissable: members.every((m) => canPutOff(m)),
      members: sorted
    });
  }
  return out;
}

/** Only information can be put off; anything owed, overdue or due today has to be dealt with. */
export function canPutOff(x: Pick<AlertItem, 'tone' | 'when' | 'dismissable'>): boolean {
  return !!x.dismissable && x.tone === 'info' && x.when !== 'overdue' && x.when !== 'today';
}

// ---------------------------------------------------------------------------
// Not now: a reason and a time
// ---------------------------------------------------------------------------
export type SnoozeReason = 'busy' | 'elsewhere' | 'not_relevant';
export const SNOOZE_REASONS: { value: SnoozeReason; label: string }[] = [
  { value: 'busy', label: 'Busy, later' },
  { value: 'elsewhere', label: 'Done it elsewhere' },
  { value: 'not_relevant', label: 'Not relevant to me' }
];
export const SNOOZE_DAYS: { value: string; label: string }[] = [
  { value: '1', label: 'Tomorrow' },
  { value: '3', label: '3 days' },
  { value: '7', label: 'A week' },
  { value: '14', label: '2 weeks' }
];
export const REASON_LABEL: Record<SnoozeReason, string> = { busy: 'Busy', elsewhere: 'Done elsewhere', not_relevant: 'Not relevant' };

export interface Snooze { until: ISODate; reason: SnoozeReason | null }
export type SnoozeMap = Record<string, Snooze>;

/** Reads the stored map; older phones kept just a date per item (hidden for a week, no reason). */
export function parseSnoozes(raw: string | null): SnoozeMap {
  try {
    const o = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    const out: SnoozeMap = {};
    for (const [k, v] of Object.entries(o ?? {})) {
      if (typeof v === 'string') out[k] = { until: v, reason: null };
      else if (v && typeof v === 'object' && typeof (v as Snooze).until === 'string') {
        const r = (v as Snooze).reason;
        out[k] = { until: (v as Snooze).until, reason: r && r in REASON_LABEL ? r : null };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Put off the given items (a bundle puts off each member) and drop ones that have run out. */
export function snooze(map: SnoozeMap, ids: string[], days: number, reason: SnoozeReason, today: ISODate): SnoozeMap {
  const live = Object.fromEntries(Object.entries(map).filter(([, s]) => s.until > today));
  const until = addDays(today, Math.max(1, Math.min(60, Math.round(days))));
  for (const id of ids) live[id] = { until, reason };
  return live;
}

/** True when this item is put off today. Things that can't be put off ignore an old snooze. */
export function isSnoozed(map: SnoozeMap, x: Pick<AlertItem, 'id' | 'tone' | 'when' | 'dismissable'>, today: ISODate): boolean {
  const s = map[x.id];
  return !!s && s.until > today && canPutOff(x);
}

// ---------------------------------------------------------------------------
// Counts for the pilot: per kind of alert
// ---------------------------------------------------------------------------
export type AlertKind =
  | 'feed' | 'feed_orders' | 'duplicates' | 'bills' | 'missed' | 'silage' | 'season' | 'fields'
  | 'fertiliser' | 'cash' | 'budget' | 'jobs' | 'heads' | 'other'
  | 'sugg_order' | 'sugg_season' | 'sugg_housing' | 'sugg_heads' | 'sugg_recurring' | 'sugg_silage' | 'sugg_calves' | 'sugg_other';

export const KIND_LABEL: Record<AlertKind, string> = {
  feed: 'Feed stock', feed_orders: 'Feed orders', duplicates: 'Possible double entries', bills: 'Bills',
  missed: 'Missed routines', silage: 'Winter silage', season: 'Spreading season', fields: 'Fields to spread',
  fertiliser: 'Fertiliser stock', cash: 'Cash', budget: 'Budget', jobs: 'Jobs', heads: 'Head counts', other: 'Other',
  sugg_order: 'Approve: feed orders', sugg_season: 'Approve: calving season steps', sugg_housing: 'Approve: housing and turnout',
  sugg_heads: 'Approve: head counts', sugg_recurring: 'Approve: monthly bills', sugg_silage: 'Approve: silage dry matter',
  sugg_calves: 'Approve: calf tags and registration', sugg_other: 'Approve: other'
};

/** The kind of an alert from its id ("fert-round-<field>" is Fields to spread). Suggestions start "sugg:". */
export function alertKind(id: string): AlertKind {
  if (id.startsWith('sugg:')) {
    const k = id.slice(5);
    if (k.startsWith('order:')) return 'sugg_order';
    if (k.startsWith('season:')) return 'sugg_season';
    if (k.startsWith('housing:') || k.startsWith('winter-dates:') || k.startsWith('turnout')) return 'sugg_housing';
    if (k.startsWith('heads:')) return 'sugg_heads';
    if (k.startsWith('recurring:')) return 'sugg_recurring';
    if (k.startsWith('silage-dm:')) return 'sugg_silage';
    if (k.startsWith('calves:')) return 'sugg_calves';
    return 'sugg_other';
  }
  if (id.startsWith('bundle-')) {
    const g = id.slice(7);
    return ({ 'feed-order': 'feed', 'feed-setup': 'feed', 'feed-on-order': 'feed', 'place-order': 'feed_orders', 'order-arrive': 'feed_orders',
      dupe: 'duplicates', spread: 'fields', cut: 'fields', 'fert-low': 'fertiliser', 'fert-short': 'fertiliser', 'fert-check': 'fertiliser',
      budget: 'budget', job: 'jobs' } as Record<string, AlertKind>)[g] ?? 'other';
  }
  if (id.startsWith('feed-uninvoiced') || id.startsWith('bills-')) return 'bills';
  if (id.startsWith('feed-')) return 'feed';
  if (id.startsWith('place-') || id.startsWith('order-')) return 'feed_orders';
  if (id.startsWith('fert-order-')) return 'fertiliser';
  if (id.startsWith('dupe-')) return 'duplicates';
  if (id === 'routines-missed') return 'missed';
  if (id === 'forage') return 'silage';
  if (id === 'fert-close' || id === 'fert-open' || id === 'fert-first') return 'season';
  if (id.startsWith('fert-round-') || id.startsWith('fert-silage-') || id.startsWith('fert-cut-')) return 'fields';
  if (id.startsWith('fert-')) return 'fertiliser';
  if (id === 'cash' || id === 'cash-check' || id === 'opening-cash') return 'cash';
  if (id.startsWith('budget-')) return 'budget';
  if (id.startsWith('job-')) return 'jobs';
  if (id === 'heads') return 'heads';
  return 'other';
}

export interface KindCounts {
  /** Days it was on screen (once per alert per day) */
  shown: number;
  /** Opened, approved, or gone by the next day because it was dealt with */
  acted: number;
  /** Not now */
  putOff: number;
  /** "No" on a suggestion */
  turnedDown: number;
  /** On screen a day and still there the next day, with nothing done */
  ignored: number;
  reasons: Record<SnoozeReason, number>;
}

export interface AlertStats {
  since: ISODate;
  kinds: Partial<Record<AlertKind, KindCounts>>;
  /** The day being watched: what was shown and what was done with it */
  day: { date: ISODate; seen: string[]; handled: string[] } | null;
}

export const emptyStats = (today: ISODate): AlertStats => ({ since: today, kinds: {}, day: null });

const blank = (): KindCounts => ({ shown: 0, acted: 0, putOff: 0, turnedDown: 0, ignored: 0, reasons: { busy: 0, elsewhere: 0, not_relevant: 0 } });

function bump(s: AlertStats, id: string, f: (c: KindCounts) => void): AlertStats {
  const k = alertKind(id);
  const c = { ...(s.kinds[k] ?? blank()) };
  c.reasons = { ...c.reasons };
  f(c);
  return { ...s, kinds: { ...s.kinds, [k]: c } };
}

export function parseStats(raw: string | null, today: ISODate): AlertStats {
  try {
    const o = JSON.parse(raw ?? '') as AlertStats;
    if (o && typeof o.since === 'string' && o.kinds && typeof o.kinds === 'object') return { since: o.since, kinds: o.kinds, day: o.day ?? null };
  } catch { /* start again */ }
  return emptyStats(today);
}

/**
 * Records what is on screen now. On the first open of a new day, settles the day before:
 * anything shown then with nothing done is "ignored" if it is still here, or "acted on" if
 * it has gone (dealt with another way: the farmer ordered from the feed screen, say).
 */
export function recordShown(s: AlertStats, ids: string[], today: ISODate): AlertStats {
  let out = s;
  const prev = out.day;
  if (prev && prev.date !== today) {
    const now = new Set(ids);
    for (const id of prev.seen) {
      if (prev.handled.includes(id)) continue;
      out = bump(out, id, (c) => { if (now.has(id)) c.ignored++; else c.acted++; });
    }
    out = { ...out, day: null };
  }
  const day = out.day ?? { date: today, seen: [], handled: [] };
  const fresh = ids.filter((id) => !day.seen.includes(id));
  if (!fresh.length && out.day) return out;
  for (const id of fresh) out = bump(out, id, (c) => { c.shown++; });
  return { ...out, day: { ...day, seen: [...day.seen, ...fresh].slice(-300) } };
}

export type AlertAction = { kind: 'acted' } | { kind: 'put_off'; reason: SnoozeReason } | { kind: 'turned_down' };

/** Counts what the farmer did with an alert (once per alert per day). */
export function recordAction(s: AlertStats, id: string, a: AlertAction, today: ISODate): AlertStats {
  const day = s.day && s.day.date === today ? s.day : { date: today, seen: [], handled: [] };
  if (day.handled.includes(id)) return s;
  const out = bump(s, id, (c) => {
    if (a.kind === 'acted') c.acted++;
    else if (a.kind === 'turned_down') c.turnedDown++;
    else { c.putOff++; c.reasons[a.reason]++; }
  });
  return { ...out, day: { ...day, handled: [...day.handled, id].slice(-300) } };
}

/** Rows for Settings, most shown first. */
export function statsRows(s: AlertStats): { kind: AlertKind; label: string; c: KindCounts }[] {
  return (Object.entries(s.kinds) as [AlertKind, KindCounts][])
    .map(([kind, c]) => ({ kind, label: KIND_LABEL[kind] ?? kind, c }))
    .sort((a, b) => b.c.shown - a.c.shown || a.label.localeCompare(b.label));
}

/** Plain text for the pilot observer to copy. */
export function statsText(s: AlertStats, today: ISODate): string {
  const rows = statsRows(s);
  const head = `Agri-It alert counts, ${s.since} to ${today} (${ALERTS_RULE_VERSION})`;
  if (!rows.length) return `${head}\nNothing yet.`;
  return [head, 'Kind, shown, acted on, put off, turned down, ignored, busy, done elsewhere, not relevant',
    ...rows.map(({ label, c }) => [label, c.shown, c.acted, c.putOff, c.turnedDown, c.ignored, c.reasons.busy, c.reasons.elsewhere, c.reasons.not_relevant].join(', '))].join('\n');
}
