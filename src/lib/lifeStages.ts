/**
 * Life stages: what an animal is called at its age (a calf, then a weanling, then a heifer and a
 * cow; a lamb, then a hogget, then a ewe). The stage is worked out from the date born every time
 * it is shown, never stored, so an animal moves up on its own as it gets older and nothing has to
 * be updated by hand. The only stored stage is one the farmer sets by hand on a single animal
 * (an in-calf heifer, say), and that always wins.
 *
 * The ages are Agri-It's defaults from common Irish farm usage, not an official definition: farms
 * wean and breed at different ages. They are listed on the Life stages screen so the farmer can
 * see exactly what is used. Species with no ages here (other) have a single stage.
 *
 * Pure: the same animal and day always give the same stage.
 */
import type { Animal, AnimalClass, AnimalSpecies, ISODate } from './types';

export interface StageInfo {
  key: string;
  /** "Weanling" */
  label: string;
  /** "Weanlings" */
  plural: string;
  species: AnimalSpecies;
  /** 0 is the youngest stage; used to tell when an animal has outgrown its group */
  rank: number;
  /** Group classes that suit an animal at this stage */
  classes: AnimalClass[];
}

const S = (species: AnimalSpecies, key: string, label: string, plural: string, rank: number, classes: AnimalClass[] = []): StageInfo => ({ key, label, plural, species, rank, classes });

/** Every stage there is, by key. */
export const STAGES: Record<string, StageInfo> = Object.fromEntries([
  // Cattle
  S('cattle', 'calf', 'Calf', 'Calves', 0, ['calf']),
  S('cattle', 'weanling', 'Weanling', 'Weanlings', 1, ['weanling']),
  S('cattle', 'heifer', 'Heifer', 'Heifers', 2, ['heifer', 'in_calf_heifer', 'store_cattle']),
  S('cattle', 'in_calf_heifer', 'In-calf heifer', 'In-calf heifers', 2, ['in_calf_heifer', 'heifer']),
  S('cattle', 'bullock', 'Bullock', 'Bullocks', 2, ['bullock', 'store_cattle', 'finishing_cattle']),
  S('cattle', 'young_bull', 'Young bull', 'Young bulls', 2, ['bull', 'bullock', 'store_cattle']),
  S('cattle', 'young_male', 'Young male', 'Young males', 2, ['bull', 'bullock', 'store_cattle']),
  S('cattle', 'young_cattle', 'Young cattle', 'Young cattle', 2, ['store_cattle', 'heifer', 'bullock']),
  S('cattle', 'cow', 'Cow', 'Cows', 3, ['dairy_cow', 'suckler_cow']),
  S('cattle', 'bull', 'Bull', 'Bulls', 3, ['bull']),
  S('cattle', 'male', 'Male', 'Males', 3, ['bull', 'bullock', 'finishing_cattle']),
  S('cattle', 'adult_cattle', 'Adult cattle', 'Adult cattle', 3, ['dairy_cow', 'suckler_cow', 'finishing_cattle']),
  // Sheep
  S('sheep', 'lamb', 'Lamb', 'Lambs', 0, ['lamb']),
  S('sheep', 'hogget', 'Hogget', 'Hoggets', 1, ['hogget']),
  S('sheep', 'ewe', 'Ewe', 'Ewes', 2, ['ewe']),
  S('sheep', 'ram', 'Ram', 'Rams', 2, ['ram']),
  S('sheep', 'wether', 'Wether', 'Wethers', 2, ['ram', 'hogget']),
  S('sheep', 'ram_or_wether', 'Ram or wether', 'Rams and wethers', 2, ['ram']),
  S('sheep', 'adult_sheep', 'Adult sheep', 'Adult sheep', 2, ['ewe', 'ram']),
  // Goats
  S('goat', 'kid', 'Kid', 'Kids', 0, ['goat']),
  S('goat', 'nanny', 'Nanny goat', 'Nanny goats', 1, ['goat']),
  S('goat', 'billy', 'Billy goat', 'Billy goats', 1, ['goat']),
  S('goat', 'goat', 'Goat', 'Goats', 1, ['goat']),
  // Pigs
  S('pig', 'piglet', 'Piglet', 'Piglets', 0, ['pig']),
  S('pig', 'weaner', 'Weaner', 'Weaners', 1, ['pig']),
  S('pig', 'grower', 'Grower', 'Growers', 2, ['pig']),
  S('pig', 'gilt', 'Gilt', 'Gilts', 3, ['pig']),
  S('pig', 'sow', 'Sow', 'Sows', 4, ['pig']),
  S('pig', 'boar', 'Boar', 'Boars', 4, ['pig']),
  S('pig', 'pig', 'Pig', 'Pigs', 4, ['pig']),
  // Horses
  S('horse', 'foal', 'Foal', 'Foals', 0, ['horse']),
  S('horse', 'yearling', 'Yearling', 'Yearlings', 1, ['horse']),
  S('horse', 'mare', 'Mare', 'Mares', 2, ['horse']),
  S('horse', 'stallion', 'Stallion', 'Stallions', 2, ['horse']),
  S('horse', 'gelding', 'Gelding', 'Geldings', 2, ['horse']),
  S('horse', 'horse', 'Horse', 'Horses', 2, ['horse']),
  // Anything else
  S('other', 'animal', 'Animal', 'Animals', 0, ['other', 'poultry']),
  // No date of birth
  S('other', 'unknown_age', 'Age not known', 'Age not known', -1)
].map((s) => [s.key, s]));

/** A stage, and the age in whole months at which an animal reaches it. */
interface Step { key: string; from: number }

export type Sex = Animal['sex'];

/** The stages an animal passes through, oldest last, for its kind and sex. */
export function stagePath(species: AnimalSpecies, sex: Sex, castrated: boolean | null | undefined): Step[] {
  const male = sex === 'male';
  const fem = sex === 'female';
  switch (species) {
    case 'cattle':
      if (fem) return [{ key: 'calf', from: 0 }, { key: 'weanling', from: 6 }, { key: 'heifer', from: 12 }, { key: 'cow', from: 24 }];
      if (male && castrated === true) return [{ key: 'calf', from: 0 }, { key: 'weanling', from: 6 }, { key: 'bullock', from: 12 }];
      if (male && castrated === false) return [{ key: 'calf', from: 0 }, { key: 'weanling', from: 6 }, { key: 'young_bull', from: 12 }, { key: 'bull', from: 24 }];
      if (male) return [{ key: 'calf', from: 0 }, { key: 'weanling', from: 6 }, { key: 'young_male', from: 12 }, { key: 'male', from: 24 }];
      return [{ key: 'calf', from: 0 }, { key: 'weanling', from: 6 }, { key: 'young_cattle', from: 12 }, { key: 'adult_cattle', from: 24 }];
    case 'sheep':
      if (fem) return [{ key: 'lamb', from: 0 }, { key: 'hogget', from: 12 }, { key: 'ewe', from: 24 }];
      if (male && castrated === true) return [{ key: 'lamb', from: 0 }, { key: 'hogget', from: 12 }, { key: 'wether', from: 24 }];
      if (male && castrated === false) return [{ key: 'lamb', from: 0 }, { key: 'hogget', from: 12 }, { key: 'ram', from: 24 }];
      if (male) return [{ key: 'lamb', from: 0 }, { key: 'hogget', from: 12 }, { key: 'ram_or_wether', from: 24 }];
      return [{ key: 'lamb', from: 0 }, { key: 'hogget', from: 12 }, { key: 'adult_sheep', from: 24 }];
    case 'goat':
      return [{ key: 'kid', from: 0 }, { key: fem ? 'nanny' : male ? 'billy' : 'goat', from: 12 }];
    case 'pig':
      if (fem) return [{ key: 'piglet', from: 0 }, { key: 'weaner', from: 1 }, { key: 'grower', from: 3 }, { key: 'gilt', from: 6 }, { key: 'sow', from: 12 }];
      return [{ key: 'piglet', from: 0 }, { key: 'weaner', from: 1 }, { key: 'grower', from: 3 }, { key: male && castrated !== true ? 'boar' : 'pig', from: 6 }];
    case 'horse':
      return [{ key: 'foal', from: 0 }, { key: 'yearling', from: 12 }, { key: male ? (castrated === true ? 'gelding' : castrated === false ? 'stallion' : 'horse') : fem ? 'mare' : 'horse', from: 36 }];
    default:
      return [{ key: 'animal', from: 0 }];
  }
}

/** Stages only a farmer can pick (they cannot be worked out from age). */
const BY_HAND: Partial<Record<AnimalSpecies, string[]>> = { cattle: ['in_calf_heifer'] };

/** Every stage key that makes sense for this kind of animal: the ones age gives, and the by-hand ones. */
export function stageChoices(species: AnimalSpecies): StageInfo[] {
  const keys = new Set<string>();
  for (const sex of ['female', 'male', null] as const) for (const c of [true, false, null]) for (const s of stagePath(species, sex, c)) keys.add(s.key);
  for (const k of BY_HAND[species] ?? []) keys.add(k);
  return [...keys].map((k) => STAGES[k]).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

export interface Purpose { cow: 'dairy' | 'suckler' | null }

export interface StageNow {
  key: string;
  label: string;
  plural: string;
  rank: number;
  species: AnimalSpecies;
  /** Whole months old, or null when the date born is not known */
  ageMonths: number | null;
  /** Set by hand on the animal rather than worked out from its age */
  byHand: boolean;
  /** The next stage it will reach, and the day it reaches it. Null when it is at the last one or the stage is by hand. */
  next: { key: string; label: string; on: ISODate } | null;
}

export const speciesOf = (a: Pick<Animal, 'species'>): AnimalSpecies => a.species ?? 'cattle';

/** Whole calendar months from `from` to `to` (a month counts once its day of the month is reached). */
export function monthsBetween(from: ISODate, to: ISODate): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const m = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, m);
}

/** The day `born` plus `months` calendar months (a 31st lands on the last day of a shorter month). */
export function addMonthsISO(born: ISODate, months: number): ISODate {
  const [y, m, d] = born.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const cowText = (info: StageInfo, purpose?: Purpose | null): Pick<StageInfo, 'label' | 'plural'> => {
  if (info.key !== 'cow') return info;
  if (purpose?.cow === 'dairy') return { label: 'Dairy cow', plural: 'Dairy cows' };
  if (purpose?.cow === 'suckler') return { label: 'Suckler cow', plural: 'Suckler cows' };
  return info;
};

/** What this animal is called today. */
export function stageOf(a: Pick<Animal, 'species' | 'sex' | 'castrated' | 'born_on' | 'stage'>, today: ISODate, purpose?: Purpose | null): StageNow {
  const species = speciesOf(a);
  const hand = a.stage && STAGES[a.stage] && STAGES[a.stage].species === species ? STAGES[a.stage] : null;
  const months = a.born_on ? monthsBetween(a.born_on, today) : null;
  if (hand) {
    const t = cowText(hand, purpose);
    return { key: hand.key, label: t.label, plural: t.plural, rank: hand.rank, species, ageMonths: months, byHand: true, next: null };
  }
  if (months === null) {
    const u = STAGES.unknown_age;
    // A species with a single stage does not need a date
    if (species === 'other') { const o = STAGES.animal; return { key: o.key, label: o.label, plural: o.plural, rank: o.rank, species, ageMonths: null, byHand: false, next: null }; }
    return { key: u.key, label: u.label, plural: u.plural, rank: u.rank, species, ageMonths: null, byHand: false, next: null };
  }
  const path = stagePath(species, a.sex ?? null, a.castrated);
  let idx = 0;
  path.forEach((p, i) => { if (months >= p.from) idx = i; });
  const info = STAGES[path[idx].key];
  const t = cowText(info, purpose);
  const nx = path[idx + 1];
  return {
    key: info.key, label: t.label, plural: t.plural, rank: info.rank, species, ageMonths: months, byHand: false,
    next: nx ? { key: nx.key, label: STAGES[nx.key].label, on: addMonthsISO(a.born_on!, nx.from) } : null
  };
}

/** "5 months", "1 year 8 months", "3 years" */
export function ageText(months: number | null): string {
  if (months === null) return 'age not known';
  if (months < 1) return 'under a month';
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const y = Math.floor(months / 12); const m = months % 12;
  return `${y} years${m ? ` ${m} month${m === 1 ? '' : 's'}` : ''}`;
}

/** The group classes in a species, youngest first: used to tell a group of younger animals from older ones. */
export const CLASS_RANK: Partial<Record<AnimalClass, { species: AnimalSpecies; rank: number }>> = {
  calf: { species: 'cattle', rank: 0 }, weanling: { species: 'cattle', rank: 1 },
  heifer: { species: 'cattle', rank: 2 }, in_calf_heifer: { species: 'cattle', rank: 2 }, store_cattle: { species: 'cattle', rank: 2 }, bullock: { species: 'cattle', rank: 2 }, finishing_cattle: { species: 'cattle', rank: 2 },
  dairy_cow: { species: 'cattle', rank: 3 }, suckler_cow: { species: 'cattle', rank: 3 }, bull: { species: 'cattle', rank: 3 },
  lamb: { species: 'sheep', rank: 0 }, hogget: { species: 'sheep', rank: 1 }, ewe: { species: 'sheep', rank: 2 }, ram: { species: 'sheep', rank: 2 }
};

/** The ages Agri-It uses, for the Life stages screen: one line per kind of animal. */
export function stageTable(): { species: AnimalSpecies; who: string; steps: { label: string; from: number }[] }[] {
  const row = (species: AnimalSpecies, who: string, sex: Sex, castrated: boolean | null) => ({ species, who, steps: stagePath(species, sex, castrated).map((s) => ({ label: STAGES[s.key].label, from: s.from })) });
  return [
    row('cattle', 'Female cattle', 'female', null), row('cattle', 'Bullocks (castrated males)', 'male', true), row('cattle', 'Bulls (males not castrated)', 'male', false),
    row('sheep', 'Female sheep', 'female', null), row('sheep', 'Rams (males not castrated)', 'male', false), row('sheep', 'Wethers (castrated males)', 'male', true),
    row('goat', 'Goats', 'female', null), row('pig', 'Female pigs', 'female', null), row('pig', 'Male pigs', 'male', false), row('horse', 'Horses', 'female', null)
  ];
}
