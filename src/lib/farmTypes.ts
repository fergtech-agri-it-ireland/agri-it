/**
 * Farm types, animals and breeds, and the "getting started" guide that steers each
 * farmer to what matters for the farming they do. Pure functions, tested in
 * farmTypes.test.ts. Nothing here restricts what a farmer can record: it only
 * decides what is shown first.
 */
import type { AnimalClass, Farm, FarmBundle, FarmType } from './types';
import { todayISO } from './format';

export const FARM_TYPES: { value: FarmType; label: string; sub: string }[] = [
  { value: 'dairy', label: 'Dairy', sub: 'Milking cows' },
  { value: 'suckler', label: 'Suckler beef', sub: 'Cows rearing calves' },
  { value: 'beef', label: 'Beef and drystock', sub: 'Stores, bullocks, finishing' },
  { value: 'calf_rearing', label: 'Calf rearing', sub: 'Rearing or buying in calves' },
  { value: 'sheep', label: 'Sheep', sub: 'Ewes, lambs, hoggets' },
  { value: 'tillage', label: 'Tillage', sub: 'Cereals, beans, maize' },
  { value: 'goats', label: 'Goats', sub: 'Dairy or meat' },
  { value: 'pigs', label: 'Pigs', sub: 'Sows, weaners, finishers' },
  { value: 'poultry', label: 'Poultry', sub: 'Layers, broilers' },
  { value: 'horses', label: 'Horses', sub: 'Breeding or livery' },
  { value: 'other', label: 'Something else', sub: 'Forestry, contracting, more' }
];
export const FARM_TYPE_LABEL = Object.fromEntries(FARM_TYPES.map((t) => [t.value, t.label])) as Record<FarmType, string>;

/**
 * Everything the farm does. Farms saved before farm types became a list carry only the
 * old single type, so the list is worked out from it. An empty list means "not said yet".
 */
export function farmTypes(farm: Pick<Farm, 'enterprise'> & { enterprises?: FarmType[] | null }): FarmType[] {
  if (Array.isArray(farm.enterprises)) return farm.enterprises;
  switch (farm.enterprise) {
    case 'mixed': return ['dairy', 'suckler'];
    case 'other': return ['other'];
    default: return [farm.enterprise];
  }
}

/** The old single type, still stored for older code and reports. */
export function legacyEnterprise(types: FarmType[]): Farm['enterprise'] {
  if (types.length > 1) return 'mixed';
  const t = types[0];
  return t === 'dairy' || t === 'suckler' || t === 'beef' || t === 'sheep' || t === 'tillage' ? t : 'other';
}

export type Species = 'cattle' | 'sheep' | 'goats' | 'pigs' | 'poultry' | 'horses' | 'other';
export const SPECIES: { value: Species; label: string; classes: AnimalClass[] }[] = [
  { value: 'cattle', label: 'Cattle', classes: ['dairy_cow', 'suckler_cow', 'in_calf_heifer', 'heifer', 'bull', 'bullock', 'store_cattle', 'finishing_cattle', 'weanling', 'calf'] },
  { value: 'sheep', label: 'Sheep', classes: ['ewe', 'ram', 'hogget', 'lamb'] },
  { value: 'goats', label: 'Goats', classes: ['goat'] },
  { value: 'pigs', label: 'Pigs', classes: ['pig'] },
  { value: 'poultry', label: 'Poultry', classes: ['poultry'] },
  { value: 'horses', label: 'Horses', classes: ['horse'] },
  { value: 'other', label: 'Other', classes: ['other'] }
];
export function speciesOf(c: AnimalClass): Species {
  return SPECIES.find((s) => s.classes.includes(c))?.value ?? 'other';
}

/** Common breeds in Ireland, as a starting list. The farmer can always type their own. */
export const BREEDS: Record<Species, string[]> = {
  cattle: [
    'Holstein Friesian', 'British Friesian', 'Jersey', 'Jersey cross', 'Norwegian Red', 'Montbéliarde', 'Fleckvieh', 'Dairy Shorthorn', 'Kerry',
    'Aberdeen Angus', 'Hereford', 'Limousin', 'Charolais', 'Simmental', 'Belgian Blue', 'Salers', "Blonde d'Aquitaine", 'Parthenaise', 'Aubrac',
    'Shorthorn', 'Stabiliser', 'Speckle Park', 'Wagyu', 'Dexter', 'Highland'
  ],
  sheep: ['Suffolk', 'Texel', 'Belclare', 'Charollais', 'Vendéen', 'Beltex', "Rouge de l'Ouest", 'Bleu du Maine', 'Lleyn', 'Mule', 'Cheviot', 'Scotch Blackface', 'Galway', 'Zwartbles', 'Dorset', 'Jacob'],
  goats: ['Saanen', 'British Alpine', 'Toggenburg', 'Anglo-Nubian', 'Boer'],
  pigs: ['Large White', 'Landrace', 'Duroc', 'Pietrain', 'Hybrid'],
  poultry: ['Hy-Line Brown', 'Lohmann Brown', 'Ross 308', 'Cobb 500'],
  horses: ['Irish Draught', 'Irish Sport Horse', 'Thoroughbred', 'Connemara pony', 'Cob'],
  other: []
};
const DAIRY_BREEDS = 9; // the first nine cattle breeds above are dairy breeds
const BEEF_FIRST: AnimalClass[] = ['suckler_cow', 'bullock', 'store_cattle', 'finishing_cattle', 'weanling', 'bull'];
/** Breeds for this animal, most likely first: beef breeds lead for bullocks, sucklers and stores. */
export function breedList(c: AnimalClass): string[] {
  const all = BREEDS[speciesOf(c)];
  if (speciesOf(c) !== 'cattle' || !BEEF_FIRST.includes(c)) return all;
  return [...all.slice(DAIRY_BREEDS), ...all.slice(0, DAIRY_BREEDS)];
}
export const breedsFor = (c: AnimalClass): string[] => [...breedList(c), 'Crossbred', 'Mixed'];

const SUGGESTED: Record<FarmType, AnimalClass[]> = {
  dairy: ['dairy_cow', 'in_calf_heifer', 'heifer', 'calf', 'bull'],
  suckler: ['suckler_cow', 'calf', 'weanling', 'heifer', 'bull'],
  beef: ['weanling', 'bullock', 'heifer', 'store_cattle', 'finishing_cattle'],
  calf_rearing: ['calf', 'weanling'],
  sheep: ['ewe', 'ram', 'hogget', 'lamb'],
  goats: ['goat'],
  pigs: ['pig'],
  poultry: ['poultry'],
  horses: ['horse'],
  tillage: [],
  other: []
};
/** Animal groups to offer first at sign-up for this mix of farming, without repeats. */
export function suggestedClasses(types: FarmType[]): AnimalClass[] {
  return [...new Set(types.flatMap((t) => SUGGESTED[t]))];
}

const GRAZING: FarmType[] = ['dairy', 'suckler', 'beef', 'calf_rearing', 'sheep', 'goats'];
const SELLS_STOCK: FarmType[] = ['suckler', 'beef', 'calf_rearing', 'sheep', 'goats', 'pigs', 'poultry', 'horses'];
export const keepsAnimals = (types: FarmType[]) => types.some((t) => t !== 'tillage' && t !== 'other');
export const grows = (types: FarmType[]) => types.includes('tillage');

export interface GuideStep { id: string; title: string; sub: string; to: string; done: boolean }

/**
 * Getting started: the few things that make Agri-It useful for this farmer's mix of
 * farming, in the order they pay off. Done is worked out from what is already recorded.
 */
export function farmGuide(b: Pick<FarmBundle, 'farm' | 'groups' | 'crops' | 'products' | 'silage' | 'income' | 'costs'>): GuideStep[] {
  const types = farmTypes(b.farm);
  const steps: GuideStep[] = [];
  if (types.length === 0) {
    steps.push({ id: 'types', title: 'Tell us what you farm', sub: 'Pick everything you do. You can change it any time.', to: '/farm/types', done: false });
  }
  if (keepsAnimals(types) || types.length === 0) {
    steps.push({ id: 'animals', title: 'Add your animals', sub: 'Groups, numbers and breeds', to: '/farm/groups', done: b.groups.some((g) => !g.archived) });
  }
  if (types.some((t) => GRAZING.includes(t) || t === 'pigs' || t === 'poultry')) {
    steps.push({ id: 'feed', title: 'Add the meal or nuts you buy', sub: 'So you know when to order', to: '/feed/new', done: b.products.some((p) => !p.archived) });
  }
  if (types.some((t) => GRAZING.includes(t))) {
    steps.push({ id: 'silage', title: 'Add your silage or bales', sub: 'See if you have enough for the winter', to: '/farm/silage/new', done: b.silage.length > 0 });
  }
  if (types.includes('dairy')) {
    steps.push({ id: 'milk', title: 'Record your last milk cheque', sub: 'Starts your milk and cash picture', to: '/record/milk', done: b.income.some((i) => i.income_type === 'milk') });
  }
  if (types.some((t) => SELLS_STOCK.includes(t))) {
    const only = types.filter((t) => SELLS_STOCK.includes(t));
    const what = only.length === 1 && only[0] === 'sheep' ? 'lambs' : 'stock';
    steps.push({ id: 'sale', title: `Record a sale of ${what}`, sub: 'Mart, factory or private', to: '/record/sale', done: b.income.some((i) => i.income_type === 'livestock') });
  }
  if (grows(types)) {
    steps.push({ id: 'crops', title: 'Add your crops and acres', sub: 'For this harvest', to: '/farm/crops', done: b.crops.some((c) => !c.archived) });
    steps.push({ id: 'inputs', title: 'Record seed, spray or fertiliser', sub: 'Builds your cost per acre', to: '/record/cost?category=seed_sprays', done: b.costs.some((c) => c.category === 'seed_sprays' || c.category === 'fertiliser') });
    steps.push({ id: 'grain', title: 'Record a grain or straw sale', sub: 'Income for the year-end summary', to: '/record/income?type=crop', done: b.income.some((i) => i.income_type === 'crop') });
  }
  steps.push({ id: 'cash', title: 'Add your bank balance', sub: 'Unlocks the cash forecast', to: '/settings', done: b.farm.opening_cash_eur !== null && b.farm.opening_cash_eur !== undefined });
  return steps;
}

export interface AddOption { id: string; label: string; sub: string; to: string; relevant: boolean }

/** Everything that can be added, the farmer's own kinds first. Nothing is hidden. */
export function addOptions(types: FarmType[]): AddOption[] {
  const any = types.length === 0;
  const has = (...t: FarmType[]) => any || t.some((x) => types.includes(x));
  const animals = any || keepsAnimals(types);
  const opts: AddOption[] = [
    { id: 'delivery', label: 'Feed delivery', sub: 'Meal, nuts or straights arrived', to: '/record/delivery', relevant: animals },
    { id: 'order', label: 'Feed order', sub: 'Ordered, not here yet', to: '/record/order', relevant: animals },
    { id: 'milk', label: 'Milk cheque', sub: 'Monthly milk payment', to: '/record/milk', relevant: has('dairy') },
    { id: 'sale', label: has('sheep') && !has('suckler', 'beef', 'calf_rearing', 'dairy') ? 'Sold lambs or sheep' : 'Sold animals', sub: 'Mart, factory or private sale', to: '/record/sale', relevant: animals },
    { id: 'grain', label: 'Grain or straw sale', sub: 'Crop income', to: '/record/income?type=crop', relevant: has('tillage') },
    { id: 'inputs', label: 'Seed, spray or fertiliser', sub: 'Crop inputs', to: '/record/cost?category=seed_sprays', relevant: has('tillage') },
    { id: 'cost', label: 'Bill paid', sub: 'Vet, contractor, ESB, anything', to: '/record/cost', relevant: true },
    { id: 'count', label: 'Stock count', sub: 'Dipped the bin or counted bags', to: '/record/count', relevant: animals },
    { id: 'income', label: 'Other income', sub: 'Grants, schemes, contracting', to: '/record/income', relevant: true },
    { id: 'record', label: 'Farm record', sub: 'Medicine, movement, spreading', to: '/records/new', relevant: true }
  ];
  return [...opts.filter((o) => o.relevant), ...opts.filter((o) => !o.relevant)];
}

export const COMMON_CROPS = ['Winter wheat', 'Spring barley', 'Winter barley', 'Winter oats', 'Spring oats', 'Spring beans', 'Winter oilseed rape', 'Maize', 'Potatoes', 'Fodder beet'];

/** The harvest being sown for now: from August on, it is next year's. */
export function currentHarvest(today = todayISO()) {
  const y = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 8 ? y + 1 : y;
}
