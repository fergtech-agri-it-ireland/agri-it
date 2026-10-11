/**
 * Head counts with dates (review gap P0: animal-group data reliability).
 *
 * Every change to a group's head count is kept with the day it took effect. The feed
 * ledger asks "how many were in this group on that day?", so selling 20 cattle today
 * does not rewrite how much meal was eaten last month, and a sale booked for next week
 * changes the forecast only from next week.
 */
import type { AnimalGroup, HeadCountChange, ISODate } from './types';

export type GroupWithHistory = AnimalGroup & { history?: HeadCountChange[] };

const byTime = (a: HeadCountChange, b: HeadCountChange) =>
  a.effective_on === b.effective_on ? a.created_at.localeCompare(b.created_at) : a.effective_on.localeCompare(b.effective_on);

/**
 * Head count in force on `day`:
 * - the latest change on or before that day;
 * - before the first recorded change, the count it replaced (`previous_count`);
 * - with no history at all, the group's current count.
 */
export function headsOn(group: Pick<AnimalGroup, 'head_count'>, day: ISODate, history: HeadCountChange[] = []): number {
  if (!history.length) return group.head_count;
  const sorted = [...history].sort(byTime);
  let found: HeadCountChange | null = null;
  for (const h of sorted) {
    if (h.effective_on <= day) found = h;
    else break;
  }
  if (found) return found.head_count;
  const first = sorted[0];
  return first.previous_count ?? group.head_count;
}

/** Attach each group's history, so feed forecasts can look up the count on any day. */
export function withHistory(groups: AnimalGroup[], history: HeadCountChange[] = []): GroupWithHistory[] {
  if (!history.length) return groups;
  const by = new Map<string, HeadCountChange[]>();
  for (const h of history) by.set(h.animal_group_id, [...(by.get(h.animal_group_id) ?? []), h]);
  return groups.map((g) => (by.has(g.id) ? { ...g, history: by.get(g.id) } : g));
}

/** Groups with `head_count` set to the count in force today (future-dated changes not yet applied). */
export function groupsAsOf(groups: AnimalGroup[], history: HeadCountChange[], today: ISODate): AnimalGroup[] {
  if (!history.length) return groups;
  return groups.map((g) => {
    const h = history.filter((x) => x.animal_group_id === g.id);
    if (!h.length) return g;
    const n = headsOn(g, today, h);
    return n === g.head_count ? g : { ...g, head_count: n };
  });
}

/** Changes still to come (effective after today), soonest first. */
export function upcomingHeadChanges(history: HeadCountChange[], today: ISODate): HeadCountChange[] {
  return history.filter((h) => h.effective_on > today).sort(byTime);
}

/** The history row a head count change writes (used for optimistic updates and previews). */
export function headChangeRow(g: Pick<AnimalGroup, 'id' | 'farm_id' | 'head_count'>, count: number, effectiveOn: ISODate, reason: string, previous?: number): HeadCountChange {
  return {
    id: crypto.randomUUID(), farm_id: g.farm_id, animal_group_id: g.id, head_count: count,
    previous_count: previous ?? g.head_count, effective_on: effectiveOn, reason, created_at: new Date().toISOString()
  };
}
