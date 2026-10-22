/**
 * Finding, counting and grouping animals when there are thousands of them. Everything here is pure
 * and works on a list built once per screen (`viewAll`), so a search or a filter is one pass over
 * the list. Lists on screen show a page at a time (PAGE_SIZE); counts are always for the whole match.
 */
import type { Animal, AnimalGroup, AnimalSpecies, FarmBundle, ISODate } from './types';
import { farmTypes } from './farmTypes';
import { CLASS_RANK, STAGES, speciesOf, stageOf, type Purpose, type StageNow } from './lifeStages';

export const PAGE_SIZE = 50;

export interface AnimalView {
  a: Animal;
  species: AnimalSpecies;
  stage: StageNow;
  group: AnimalGroup | null;
}

/** What an adult female is called on this farm: from her group if she has one, else from the farm's enterprises. */
export function purposeFor(b: Pick<FarmBundle, 'farm'>, group: AnimalGroup | null): Purpose {
  if (group?.animal_class === 'dairy_cow') return { cow: 'dairy' };
  if (group?.animal_class === 'suckler_cow') return { cow: 'suckler' };
  const types = farmTypes(b.farm);
  const dairy = types.includes('dairy'); const suckler = types.includes('suckler');
  return { cow: dairy && !suckler ? 'dairy' : suckler && !dairy ? 'suckler' : null };
}

/** Every animal with its kind, stage today and group, worked out once. */
export function viewAll(b: Pick<FarmBundle, 'animals' | 'groups' | 'farm'>, today: ISODate): AnimalView[] {
  const groups = new Map(b.groups.map((g) => [g.id, g]));
  return (b.animals ?? []).map((a) => {
    const group = (a.animal_group_id && groups.get(a.animal_group_id)) || null;
    return { a, species: speciesOf(a), stage: stageOf(a, today, purposeFor(b, group)), group };
  });
}

export type StatusFilter = 'on' | 'left' | 'all';
export interface AnimalFilter {
  /** Digits of a tag number (any part, so the last four digits work) or part of a breed */
  text: string;
  species: AnimalSpecies | 'all';
  stage: string | 'all';
  /** A group id, 'none' for animals in no group, or 'all' */
  group: string | 'all' | 'none';
  sex: 'female' | 'male' | 'none' | 'all';
  breed: string | 'all';
  status: StatusFilter;
}
export const NO_FILTER: AnimalFilter = { text: '', species: 'all', stage: 'all', group: 'all', sex: 'all', breed: 'all', status: 'on' };

const clean = (s: string) => s.replace(/[\s.\-_/]+/g, '').toUpperCase();

export function applyFilter(views: AnimalView[], f: AnimalFilter): AnimalView[] {
  const tag = clean(f.text);
  const words = f.text.trim().toUpperCase();
  return views.filter((v) => {
    const a = v.a;
    if (f.status === 'on' && a.status !== 'on_farm') return false;
    if (f.status === 'left' && a.status === 'on_farm') return false;
    if (f.species !== 'all' && v.species !== f.species) return false;
    if (f.stage !== 'all' && v.stage.key !== f.stage) return false;
    if (f.group === 'none' ? a.animal_group_id : f.group !== 'all' && a.animal_group_id !== f.group) return false;
    if (f.sex === 'none' ? a.sex : f.sex !== 'all' && a.sex !== f.sex) return false;
    if (f.breed !== 'all' && (a.breed ?? '') !== f.breed) return false;
    if (tag && !a.tag_number.includes(tag) && !(a.breed ?? '').toUpperCase().includes(words)) return false;
    return true;
  });
}

export const isFiltered = (f: AnimalFilter) => JSON.stringify({ ...f, status: 'on' }) !== JSON.stringify(NO_FILTER);

export interface SpeciesCount { species: AnimalSpecies; count: number; stages: { key: string; label: string; plural: string; rank: number; count: number }[] }

/** Counts by kind of animal, and within each kind by stage (youngest first). Only animals on the farm unless `left` is true. */
export function summarise(views: AnimalView[], left = false): SpeciesCount[] {
  const bySpecies = new Map<AnimalSpecies, Map<string, { label: string; plural: string; rank: number; count: number }>>();
  for (const v of views) {
    if ((v.a.status === 'on_farm') === left) continue;
    const m = bySpecies.get(v.species) ?? new Map();
    const cur = m.get(v.stage.key) ?? { label: v.stage.label, plural: v.stage.plural, rank: v.stage.rank, count: 0 };
    cur.count++; m.set(v.stage.key, cur); bySpecies.set(v.species, m);
  }
  return [...bySpecies.entries()]
    .map(([species, m]) => {
      const stages = [...m.entries()].map(([key, s]) => ({ key, ...s })).sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label));
      return { species, count: stages.reduce((s, x) => s + x.count, 0), stages };
    })
    .sort((x, y) => y.count - x.count);
}

export interface DueGroup {
  /** The group they are in now */
  from: AnimalGroup;
  /** The stage they have reached */
  stageKey: string;
  stageLabel: string;
  stagePlural: string;
  /** Groups that suit that stage, best first. Empty when the farm has none yet. */
  targets: AnimalGroup[];
  views: AnimalView[];
}

/**
 * Animals that have outgrown the group they are in: a weanling in the Calves group, a hogget in the
 * Lambs group. Only animals on the farm, in a group, whose stage was worked out from their age.
 */
export function dueToMoveUp(views: AnimalView[], groups: AnimalGroup[]): DueGroup[] {
  const live = groups.filter((g) => !g.archived);
  const out = new Map<string, DueGroup>();
  for (const v of views) {
    if (v.a.status !== 'on_farm' || !v.group || v.stage.byHand || v.stage.rank < 0) continue;
    const gc = CLASS_RANK[v.group.animal_class];
    if (!gc || gc.species !== v.species || gc.rank >= v.stage.rank) continue;
    const info = STAGES[v.stage.key];
    if (info.classes.includes(v.group.animal_class)) continue;
    const key = `${v.group.id}|${v.stage.key}`;
    let d = out.get(key);
    if (!d) {
      const targets = live.filter((g) => g.id !== v.group!.id && info.classes.includes(g.animal_class)).sort((x, y) => info.classes.indexOf(x.animal_class) - info.classes.indexOf(y.animal_class) || x.sort_order - y.sort_order);
      d = { from: v.group, stageKey: v.stage.key, stageLabel: v.stage.label, stagePlural: v.stage.plural, targets, views: [] };
      out.set(key, d);
    }
    d.views.push(v);
  }
  return [...out.values()].sort((x, y) => y.views.length - x.views.length);
}

/** Animals that reach their next stage within `days` days (for a look ahead). */
export function reachingSoon(views: AnimalView[], today: ISODate, days: number): AnimalView[] {
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + days);
  const to = end.toISOString().slice(0, 10);
  return views.filter((v) => v.a.status === 'on_farm' && v.stage.next && v.stage.next.on > today && v.stage.next.on <= to);
}

/** The breeds in use, most common first, for a filter list. */
export function breedsIn(views: AnimalView[]): string[] {
  const n = new Map<string, number>();
  for (const v of views) if (v.a.breed) n.set(v.a.breed, (n.get(v.a.breed) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}
