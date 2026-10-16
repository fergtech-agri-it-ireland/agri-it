/**
 * Set up your farm (rule setup@1.0, 16 Oct 2026).
 *
 * Sign-up asks only for the farm and what it does. Everything else Agri-It needs to be fully
 * working is gathered here, in stages of a few short steps, built from what the farmer has
 * already said: a dairy farm is asked about its milk buyer and calving, a tillage farm about
 * crops, a farm with no animals is never asked about feeding. Each step saves as it goes, so
 * a farmer can stop in the yard and carry on later from the dashboard.
 *
 * A stage is done when the farmer finishes or skips it, or when the data it asks for is
 * already there (added some other way). Nothing is filled in without the farmer saving it.
 */
import type { FarmBundle, FarmType, ISODate } from './types';
import { farmTypes, grows, keepsAnimals } from './farmTypes';

export const SETUP_RULE_VERSION = 'setup@1.0';

export type StageKey = 'farm' | 'animals' | 'feeding' | 'jobs' | 'crops' | 'income' | 'bills' | 'loans' | 'yearend';
export type StepKey =
  | 'land' | 'herd'
  | 'groups' | 'where' | 'calving'
  | 'meal' | 'silage'
  | 'jobs'
  | 'crops' | 'fields'
  | 'milk' | 'schemes'
  | 'regular'
  | 'loans'
  | 'bank' | 'year' | 'accountant';

export interface SetupStep { key: StepKey; title: string; done: boolean }
export interface SetupStage {
  key: StageKey;
  title: string;
  /** Why it matters, in a few words */
  why: string;
  /** Rough minutes, for the farmer deciding whether to do it now */
  minutes: number;
  steps: SetupStep[];
  status: 'done' | 'skipped' | 'started' | 'todo';
}

const GRAZERS: FarmType[] = ['dairy', 'suckler', 'beef', 'calf_rearing', 'sheep', 'goats', 'horses'];

/** The stages for this farm, in the order they're best done. */
export function setupPlan(b: Pick<FarmBundle, 'farm' | 'groups' | 'products' | 'silage' | 'crops' | 'fields' | 'routines' | 'seasons'> & Partial<Pick<FarmBundle, 'loans' | 'expected'>>): SetupStage[] {
  const f = b.farm;
  const types = farmTypes(f);
  const marks = f.setup ?? {};
  const animals = keepsAnimals(types) || types.length === 0;
  const grazing = types.some((t) => GRAZERS.includes(t));
  const calving = types.includes('dairy') || types.includes('suckler');
  const stages: Omit<SetupStage, 'status'>[] = [];

  stages.push({
    key: 'farm', title: 'Your farm', why: 'Land, herd number and VAT: the details your accountant and schemes use', minutes: 2,
    steps: [
      { key: 'land', title: 'Your land', done: f.acres_owned != null || f.acres_rented != null },
      { key: 'herd', title: 'Herd number and VAT', done: !!f.herd_number || !!f.vat_status }
    ]
  });
  if (animals) {
    stages.push({
      key: 'animals', title: 'Your animals', why: 'Numbers drive the feed and silage forecasts', minutes: 3,
      steps: [
        { key: 'groups', title: 'Groups and breeds', done: b.groups.some((g) => !g.archived) },
        { key: 'where', title: 'In for the winter, or out?', done: !!f.housing_start || !!f.turnout_date },
        ...(calving ? [{ key: 'calving' as const, title: 'Calving', done: (b.seasons ?? []).some((s) => !s.archived) }] : [])
      ]
    });
    stages.push({
      key: 'feeding', title: 'Feeding', why: 'So Agri-It can tell you when to order meal and if the silage will last', minutes: 3,
      steps: [
        { key: 'meal', title: 'Meal or nuts you buy', done: b.products.some((p) => !p.archived) },
        ...(grazing ? [{ key: 'silage' as const, title: 'Silage and bales', done: b.silage.length > 0 }] : [])
      ]
    });
  }
  if (grows(types)) {
    stages.push({
      key: 'crops', title: 'Crops and fields', why: 'Acres for costs per acre, fields for spreading reminders', minutes: 3,
      steps: [
        { key: 'crops', title: 'Crops this harvest', done: b.crops.some((c) => !c.archived) },
        { key: 'fields', title: 'Your fields', done: (b.fields ?? []).some((x) => !x.archived) }
      ]
    });
  }
  stages.push({
    key: 'jobs', title: 'Daily and weekly jobs', why: 'A tick-off list each morning, so nothing is forgotten', minutes: 1,
    steps: [{ key: 'jobs', title: 'Jobs you do', done: b.routines.some((r) => r.kind === 'job') }]
  });
  stages.push({
    key: 'income', title: 'Money coming in', why: 'Scheme payments on their dates make the cash plan real', minutes: 2,
    steps: [
      ...(types.includes('dairy') ? [{ key: 'milk' as const, title: 'Your milk cheque', done: !!f.milk_buyer }] : []),
      { key: 'schemes', title: 'Scheme payments', done: (b.expected ?? []).length > 0 }
    ]
  });
  stages.push({
    key: 'bills', title: 'Regular bills', why: 'Rent, ESB, insurance and the rest, so the cash plan sees them coming', minutes: 2,
    steps: [{ key: 'regular', title: 'Bills that come regularly', done: b.routines.some((r) => r.kind === 'expense') }]
  });
  stages.push({
    key: 'loans', title: 'Loans and overdraft', why: 'Repayments in the plan, and interest split out for the accountant', minutes: 2,
    steps: [{ key: 'loans', title: 'Loans, hire purchase, overdraft', done: (b.loans ?? []).length > 0 }]
  });
  stages.push({
    key: 'yearend', title: 'Bank and year end', why: 'Starts the cash figure and gets the accountant pack ready', minutes: 1,
    steps: [
      { key: 'bank', title: 'Money in the bank', done: f.opening_cash_eur != null },
      { key: 'year', title: 'Your financial year', done: marks.year === 'done' },
      { key: 'accountant', title: 'Your accountant', done: !!f.accountant_name }
    ]
  });

  return stages.map((s) => {
    const mark = marks[s.key];
    const doneSteps = s.steps.filter((x) => x.done).length;
    const status: SetupStage['status'] = mark === 'done' || doneSteps === s.steps.length ? 'done'
      : mark === 'skipped' ? 'skipped' : doneSteps > 0 ? 'started' : 'todo';
    return { ...s, status };
  });
}

/** How far along: stages done or skipped out of all, and the next one to do. */
export function setupProgress(stages: SetupStage[]) {
  const finished = stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const next = stages.find((s) => s.status === 'started') ?? stages.find((s) => s.status === 'todo') ?? null;
  const minutesLeft = stages.filter((s) => s.status === 'todo' || s.status === 'started').reduce((t, s) => t + s.minutes, 0);
  return { finished, total: stages.length, next, minutesLeft, complete: finished === stages.length };
}

/** A farm-level mark for a stage (or the 'year' step), merged into what's there. */
export function withMark(setup: Record<string, 'done' | 'skipped'> | null | undefined, key: string, mark: 'done' | 'skipped') {
  return { ...(setup ?? {}), [key]: mark };
}

// ---------------------------------------------------------------------------
// Jobs a farmer might tick off. A pick list, nothing more: the farmer chooses and can change
// how often. No job here is advice on how to farm.
// ---------------------------------------------------------------------------
export interface JobIdea { key: string; title: string; for: FarmType[] | 'all'; frequency: 'daily' | 'weekly' | 'monthly'; weekday?: number; dayOfMonth?: number }
export const JOB_IDEAS: JobIdea[] = [
  { key: 'stock', title: 'Check all stock', for: ['suckler', 'beef', 'sheep', 'calf_rearing', 'goats', 'horses', 'dairy'], frequency: 'daily' },
  { key: 'water', title: 'Check water troughs', for: GRAZERS, frequency: 'daily' },
  { key: 'calves', title: 'Feed calves', for: ['dairy', 'calf_rearing', 'suckler'], frequency: 'daily' },
  { key: 'cubicles', title: 'Clean and lime cubicles', for: ['dairy'], frequency: 'daily' },
  { key: 'scrape', title: 'Scrape yards and passages', for: ['dairy', 'suckler', 'beef'], frequency: 'daily' },
  { key: 'silage', title: 'Push in silage', for: ['dairy', 'suckler', 'beef', 'sheep'], frequency: 'daily' },
  { key: 'bedding', title: 'Bed the sheds and calf pens', for: ['dairy', 'suckler', 'beef', 'calf_rearing'], frequency: 'daily' },
  { key: 'pigs', title: 'Check pigs, feed and water', for: ['pigs'], frequency: 'daily' },
  { key: 'poultry', title: 'Collect eggs, check birds', for: ['poultry'], frequency: 'daily' },
  { key: 'footbath', title: 'Footbath the cows', for: ['dairy'], frequency: 'weekly', weekday: 3 },
  { key: 'grass', title: 'Walk the grass', for: ['dairy', 'suckler', 'beef', 'sheep'], frequency: 'weekly', weekday: 1 },
  { key: 'fences', title: 'Check fences and gates', for: GRAZERS, frequency: 'weekly', weekday: 6 },
  { key: 'feet', title: 'Check feet and fly strike', for: ['sheep'], frequency: 'weekly', weekday: 2 },
  { key: 'crops', title: 'Walk the crops', for: ['tillage'], frequency: 'weekly', weekday: 1 },
  { key: 'machinery', title: 'Grease and check machinery', for: 'all', frequency: 'weekly', weekday: 6 },
  { key: 'records', title: 'Write up medicine and movement records', for: 'all', frequency: 'weekly', weekday: 5 },
  { key: 'weigh', title: 'Weigh cattle', for: ['beef', 'suckler'], frequency: 'monthly', dayOfMonth: 1 },
  { key: 'parlour', title: 'Service check on the milking machine', for: ['dairy'], frequency: 'monthly', dayOfMonth: 1 }
];

export function jobIdeasFor(types: FarmType[]): JobIdea[] {
  const fits = (j: JobIdea) => j.for === 'all' || j.for.some((t) => types.includes(t));
  return [...JOB_IDEAS.filter(fits), ...JOB_IDEAS.filter((j) => !fits(j))];
}

// ---------------------------------------------------------------------------
// Regular bills a farm usually has. The farmer picks, and gives the amount and how often.
// ---------------------------------------------------------------------------
export interface BillIdea { key: string; title: string; category: string; every: 1 | 2 | 3 | 6 | 12 }
export const BILL_IDEAS: BillIdea[] = [
  { key: 'rent', title: 'Land rent', category: 'land_rent', every: 12 },
  { key: 'esb', title: 'Electricity', category: 'utilities', every: 2 },
  { key: 'phone', title: 'Phone and broadband', category: 'utilities', every: 1 },
  { key: 'insurance', title: 'Farm insurance', category: 'insurance', every: 12 },
  { key: 'accountant', title: 'Accountant', category: 'professional_fees', every: 12 },
  { key: 'advisor', title: 'Teagasc or adviser fee', category: 'professional_fees', every: 12 },
  { key: 'wages', title: 'Wages', category: 'labour', every: 1 },
  { key: 'contractor', title: 'Contractor account', category: 'contractor', every: 1 },
  { key: 'vet', title: 'Vet account', category: 'vet_medicine', every: 1 },
  { key: 'diesel', title: 'Diesel', category: 'machinery_fuel', every: 1 },
  { key: 'household', title: 'Household (taken out for living)', category: 'household', every: 1 }
];

/** "every 2 months" style words for the bill picker. */
export const EVERY_LABEL: Record<number, string> = { 1: 'Monthly', 2: 'Every 2 months', 3: 'Every 3 months', 6: 'Twice a year', 12: 'Once a year' };

// ---------------------------------------------------------------------------
// Dates offered as one-tap starting points, each with where it comes from
// ---------------------------------------------------------------------------
export interface DateHint { on: ISODate; label: string; source: string }

/**
 * Teagasc's target for a spring-calving dairy herd: a mean calving date of 5 to 15 February,
 * with calving starting 15 to 20 days before it (Teagasc, "Calving date impacts on feed and
 * forage costs"). Middle of both: first calf about 23 January. Suckler: Teagasc's Suckler
 * Breeding Targets example starts calving on 7 February.
 */
export function calvingHint(herd: 'dairy' | 'suckler', today: ISODate): DateHint {
  const y = Number(today.slice(0, 4));
  const [m, d] = herd === 'dairy' ? [1, 23] : [2, 7];
  let on = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (on <= today) on = `${y + 1}${on.slice(4)}`;
  return herd === 'dairy'
    ? { on, label: 'Teagasc spring target', source: 'Teagasc: mean calving 5 to 15 Feb, calving starts 15 to 20 days before' }
    : { on, label: 'Teagasc example', source: 'Teagasc Suckler Breeding Targets: calving from 7 Feb, over 10 to 12 weeks' };
}

/** Tap-a-month chips for housing and turnout: the farmer's own winter, not a typical one. */
export function monthChips(kind: 'housing' | 'turnout', today: ISODate): { on: ISODate; label: string }[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  // The winter being planned: housing this autumn (or last, if it's already winter), turnout the spring after
  const winterStart = m >= 7 ? y : y - 1;
  const opts = kind === 'housing'
    ? [[10, 1, 'Early Oct'], [10, 15, 'Mid Oct'], [11, 1, 'Early Nov'], [11, 15, 'Mid Nov'], [12, 1, 'December']] as const
    : [[2, 1, 'Early Feb'], [2, 15, 'Mid Feb'], [3, 1, 'Early Mar'], [3, 15, 'Mid Mar'], [4, 1, 'April']] as const;
  return opts.map(([mm, dd, label]) => ({ on: `${kind === 'housing' ? winterStart : winterStart + 1}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, label }));
}

/**
 * Financial year starting month offered first. Republic: income tax is for the calendar year,
 * so most farm accounts run January to December. Northern Ireland: since 2024/25 profits are
 * taxed on the tax year (6 April to 5 April) and accounts ending 31 March to 5 April count as
 * the tax year (gov.uk, Basis period reform), so April is the natural start.
 */
export function fyHint(jurisdiction: 'ROI' | 'NI'): { month: number; why: string } {
  return jurisdiction === 'NI'
    ? { month: 4, why: 'Most farms now match the UK tax year (accounts to 31 March or 5 April). Check with your accountant.' }
    : { month: 1, why: 'Income tax runs for the calendar year, so most farm accounts run January to December. Check with your accountant.' };
}
