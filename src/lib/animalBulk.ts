/**
 * Adding many animals at once from a typed or pasted list of tag numbers, and changing many at
 * once. Pure: it only works out what would be saved, so the screen can show the farmer exactly
 * what is about to happen before anything is.
 */
import type { Animal, AnimalGroup, AnimalSpecies, AnimalStatus, ISODate } from './types';
import { parseTag } from './animalId';
import { BATCH, chunk, type Op } from './offline/outbox';

export const MAX_AT_ONCE = 5000;

export interface TagList {
  /** Tag numbers in the form they are stored, once each, in the order given */
  tags: string[];
  /** Entries given more than once (kept once) */
  repeated: string[];
  /** Pieces of the list that are not a tag, as typed */
  unreadable: string[];
}

// A number that carries on with more digits is not a tag
const CATTLE_TAG = /(?<![0-9A-Z])(?:372|IE)[\s.\-_]*(?:\d[\s.\-_]*){11}\d(?!\d)/gi;

/**
 * A list of tags. Cattle tags are found wherever they are (one per line, separated by commas, or
 * run together with spaces); anything else on a line that is not a tag is reported. Other kinds of
 * animal take one tag per line, or separated by commas or semicolons.
 */
export function parseTagList(text: string, species: AnimalSpecies): TagList {
  const tags: string[] = []; const repeated: string[] = []; const unreadable: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => { if (seen.has(t)) { if (!repeated.includes(t)) repeated.push(t); } else { seen.add(t); tags.push(t); } };
  const lines = text.split(/[\n\r;]+/);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (species === 'cattle') {
      const found = line.match(CATTLE_TAG) ?? [];
      const rest = line.replace(CATTLE_TAG, ' ').replace(/[\s,]+/g, ' ').trim();
      for (const f of found) { const p = parseTag(f); if (p) add(p.canonical); else unreadable.push(f.trim()); }
      if (rest) unreadable.push(rest);
    } else {
      for (const piece of line.split(',')) {
        const t = piece.toUpperCase().replace(/\s+/g, '');
        if (!t) continue;
        if (t.length < 3 || t.length > 30) unreadable.push(piece.trim()); else add(t);
      }
    }
  }
  return { tags, repeated, unreadable };
}

export interface NewAnimalDetails {
  species: AnimalSpecies;
  groupId: string | null;
  sex: Animal['sex'];
  castrated: boolean | null;
  breed: string;
  bornOn: ISODate | '';
}

/** The rows to save, the ones skipped because the tag is already on the farm, and the requests that carry them. */
export function planAdd(list: TagList, existingTags: Set<string>, d: NewAnimalDetails, farmId: string, newId: () => string): { rows: Animal[]; alreadyHere: string[]; ops: Op[]; undo: Op[] } {
  const rows: Animal[] = []; const alreadyHere: string[] = [];
  for (const t of list.tags) {
    if (existingTags.has(t)) { alreadyHere.push(t); continue; }
    rows.push({
      id: newId(), farm_id: farmId, tag_number: t, tag_source: 'typed', animal_group_id: d.groupId, sex: d.sex, species: d.species,
      castrated: d.sex === 'male' ? d.castrated : null, stage: null, breed: d.breed.trim() || null, born_on: d.bornOn || null, status: 'on_farm', left_on: null, note: null
    });
  }
  return {
    rows, alreadyHere,
    ops: chunk(rows, BATCH).map((r) => ({ kind: 'insertMany' as const, table: 'animals', rows: r.map((x) => ({ ...x })) })),
    undo: chunk(rows.map((r) => r.id), BATCH).map((ids) => ({ kind: 'deleteMany' as const, table: 'animals', ids }))
  };
}

export type Change =
  | { kind: 'left'; status: Exclude<AnimalStatus, 'on_farm'>; on: ISODate }
  | { kind: 'group'; groupId: string | null }
  | { kind: 'breed'; breed: string }
  | { kind: 'born'; on: ISODate }
  | { kind: 'back' };

export function patchFor(c: Change): Partial<Animal> {
  switch (c.kind) {
    case 'left': return { status: c.status, left_on: c.on };
    case 'group': return { animal_group_id: c.groupId };
    case 'breed': return { breed: c.breed.trim() || null };
    case 'born': return { born_on: c.on };
    case 'back': return { status: 'on_farm', left_on: null };
  }
}

/** Why a change cannot be made to these animals, in plain words. Null when it can. */
export function changeProblem(c: Change, animals: Animal[], today: ISODate): string | null {
  if (c.kind === 'left') {
    if (c.on > today) return 'The date cannot be in the future.';
    const early = animals.filter((a) => a.born_on && c.on < a.born_on).length;
    if (early) return `${early} of them would leave before they were born.`;
  }
  if (c.kind === 'born') {
    if (c.on > today) return 'The date cannot be in the future.';
    const late = animals.filter((a) => a.left_on && a.left_on < c.on).length;
    if (late) return `${late} of them left the farm before that date.`;
  }
  return null;
}

/** The requests that make the change, and the ones that put every animal back as it was. */
export function planChange(animals: Animal[], c: Change): { patch: Partial<Animal>; ops: Op[]; undo: Op[] } {
  const patch = patchFor(c);
  const keys = Object.keys(patch) as (keyof Animal)[];
  const ops: Op[] = chunk(animals.map((a) => a.id), BATCH).map((ids) => ({ kind: 'updateMany' as const, table: 'animals', ids, patch: { ...patch } }));
  // Undo: animals that were the same before go back together
  const groups = new Map<string, { prev: Record<string, unknown>; ids: string[] }>();
  for (const a of animals) {
    const prev = Object.fromEntries(keys.map((k) => [k, a[k] ?? null]));
    const key = JSON.stringify(prev);
    const g = groups.get(key) ?? { prev, ids: [] };
    g.ids.push(a.id); groups.set(key, g);
  }
  const undo: Op[] = [...groups.values()].flatMap((g) => chunk(g.ids, BATCH).map((ids) => ({ kind: 'updateMany' as const, table: 'animals', ids, patch: g.prev })));
  return { patch, ops, undo };
}

export function describeChange(c: Change, groups: AnimalGroup[]): string {
  switch (c.kind) {
    case 'left': return c.status === 'sold' ? 'sold' : c.status === 'died' ? 'died' : 'moved off the farm';
    case 'group': return c.groupId ? `moved to ${groups.find((g) => g.id === c.groupId)?.name ?? 'the group'}` : 'taken out of their group';
    case 'breed': return c.breed.trim() ? `given the breed ${c.breed.trim()}` : 'given no breed';
    case 'born': return 'given a date of birth';
    case 'back': return 'put back on the farm';
  }
}
