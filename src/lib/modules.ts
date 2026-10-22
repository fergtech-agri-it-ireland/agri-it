/**
 * The module tiles on the dashboard (rule `dashboard-modules@1.0`).
 *
 * The dashboard is the farm's one front page: key numbers, one list of things to do, and a tile
 * for each module (feed, silage, animals, fields, money ...) that opens that module's screens for
 * the detailed work. Each tile carries one live line worked out from the farm's own records and
 * a badge counting what is waiting for the farmer in that module. Pure, so it can be tested; the
 * same grouping is what later lets modules be offered in separate plans.
 */
import type { FarmBundle, ISODate } from './types';
import type { derive } from './data/derived';
import { silageDial } from './dials';
import { eur, fmtDay, fmtNum } from './format';
import { farmTypes, grows, keepsAnimals, speciesOf, SPECIES } from './farmTypes';

type Derived = ReturnType<typeof derive>;

export type ModuleKey = 'feed' | 'silage' | 'animals' | 'milk' | 'fields' | 'crops' | 'money' | 'loans' | 'reports' | 'records' | 'suppliers';
export type ModuleTone = 'urgent' | 'warn' | 'info';

export interface ModuleTile {
  key: ModuleKey;
  title: string;
  /** One live line, worked out from the farm's records */
  line: string;
  to: string;
  /** How many things in this module are waiting for the farmer */
  count: number;
  tone: ModuleTone;
}

/** Which module a to-do item belongs to, from its id (or a suggestion's key) and where it goes. */
export function moduleOf(idOrKey: string, to?: string): ModuleKey | null {
  const k = idOrKey;
  if (k.startsWith('fert-') || k.startsWith('spread')) return 'fields';
  if (k === 'forage' || k.startsWith('silage-dm:')) return 'silage';
  if (k.startsWith('loan:') || k.startsWith('scheme:')) return 'loans';
  if (k.startsWith('bills-') || k === 'cash' || k === 'cash-check' || k === 'opening-cash' || k.startsWith('budget-') || k === 'feed-uninvoiced' || k.startsWith('recurring:')) return 'money';
  if (k === 'heads' || k.startsWith('heads:') || k.startsWith('housing:') || k.startsWith('winter-dates:') || k.startsWith('calves:') || k.startsWith('season:')) return 'animals';
  if (k.startsWith('feed-') || k.startsWith('place-') || k.startsWith('order-') || k.startsWith('order:') || k.startsWith('dupe-')) return 'feed';
  if (k.startsWith('job-') || k.startsWith('routines-')) return null;
  const r = to ?? '';
  if (r.startsWith('/feed') || r.startsWith('/record/delivery') || r.startsWith('/record/order')) return 'feed';
  if (r.startsWith('/fertiliser') || r.startsWith('/farm/fields') || r.startsWith('/record/spread') || r.startsWith('/record/fertiliser')) return 'fields';
  if (r.startsWith('/farm/silage')) return 'silage';
  if (r.startsWith('/reports')) return 'reports';
  if (r.startsWith('/money/loans') || r.startsWith('/money/payments')) return 'loans';
  if (r.startsWith('/money') || r.startsWith('/forecast?tab=cash') || r.startsWith('/record/invoice')) return 'money';
  if (r.startsWith('/farm/groups') || r.startsWith('/calving')) return 'animals';
  if (r.startsWith('/records')) return 'records';
  return null;
}

const toneOf = (t: string): ModuleTone => (t === 'urgent' ? 'urgent' : t === 'warn' ? 'warn' : 'info');
const worse = (a: ModuleTone, b: ModuleTone): ModuleTone => (a === 'urgent' || b === 'urgent' ? 'urgent' : a === 'warn' || b === 'warn' ? 'warn' : 'info');

/** How many to-do items each module holds, and the most pressing tone among them. */
export function moduleCounts(alerts: { id: string; to: string; tone: string }[], suggestions: { key: string; tone: string; to?: { href: string } }[]) {
  const out: Partial<Record<ModuleKey, { count: number; tone: ModuleTone }>> = {};
  const add = (m: ModuleKey | null, tone: ModuleTone) => {
    if (!m) return;
    const cur = out[m];
    out[m] = { count: (cur?.count ?? 0) + 1, tone: cur ? worse(cur.tone, tone) : tone };
  };
  for (const a of alerts) add(moduleOf(a.id, a.to), toneOf(a.tone));
  for (const s of suggestions) add(moduleOf(s.key, s.to?.href), toneOf(s.tone));
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;

export function dashboardModules(b: FarmBundle, d: Derived, today: ISODate): ModuleTile[] {
  const types = farmTypes(b.farm);
  const animals = keepsAnimals(types) || types.length === 0;
  const worker = b.role === 'worker';
  const counts = moduleCounts(d.priorities, d.suggestions);
  const tile = (key: ModuleKey, title: string, line: string, to: string, extra?: { count: number; tone: ModuleTone }): ModuleTile => {
    const c = counts[key];
    const count = (c?.count ?? 0) + (extra?.count ?? 0);
    return { key, title, line, to, count, tone: c && extra ? worse(c.tone, extra.tone) : c?.tone ?? extra?.tone ?? 'info' };
  };
  const tiles: ModuleTile[] = [];

  // Feed
  const live = b.products.filter((p) => !p.archived);
  if (animals || live.length > 0) {
    const days = live.map((p) => d.feed.get(p.id)?.daysRemaining).filter((x): x is number => typeof x === 'number');
    const first = days.length ? Math.floor(Math.min(...days)) : null;
    const line = live.length === 0 ? 'Add the feed you buy' : `${plural(live.length, 'feed')}${first === null ? ', needs a plan or a count' : `, ${first} ${first === 1 ? 'day' : 'days'} left`}`;
    tiles.push(tile('feed', 'Feed', line, live.length === 1 ? `/feed/${live[0].id}` : '/progress?tab=feed'));
  }

  // Silage and bales
  if (animals || b.silage.length > 0) {
    const s = silageDial(d.forage);
    tiles.push(tile('silage', 'Silage and bales', s.value === '?' ? 'Not set up yet' : `${s.value} of winter need`, '/farm/silage'));
  }

  // Animals
  const tagged = (b.animals ?? []).filter((a) => a.status === 'on_farm').length;
  const groups = b.groups.filter((g) => !g.archived && g.head_count > 0);
  const bySpecies = SPECIES.map((s) => ({ s, n: groups.filter((g) => speciesOf(g.animal_class) === s.value).reduce((t, g) => t + g.head_count, 0) })).filter((x) => x.n > 0);
  tiles.push(tile('animals', 'Animals', groups.length === 0 ? 'Add your groups' : `${plural(groups.length, 'group')}, ${bySpecies.map((x) => `${fmtNum(x.n)} ${x.s.label.toLowerCase()}`).join(', ')}${tagged > 0 ? `, ${fmtNum(tagged)} tagged` : ''}`, '/animals'));

  // Milk
  if (types.includes('dairy') && !worker) {
    const last = [...b.income].filter((i) => i.income_type === 'milk').sort((x, y) => y.occurred_on.localeCompare(x.occurred_on))[0];
    const cpl = last?.milk_litres ? (Number(last.amount_eur) / Number(last.milk_litres)) * 100 : null;
    tiles.push(tile('milk', 'Milk', last ? `Last cheque ${eur(Number(last.amount_eur))}${cpl === null ? '' : `, ${cpl.toFixed(1)}c a litre`}` : 'Add a milk cheque', '/diary?tab=history'));
  }

  // Fields and fertiliser
  const fields = b.fields.filter((f) => !f.archived);
  const ferts = b.fertilisers.filter((f) => !f.archived);
  const due = d.fertiliser.due.filter((x) => x.kind !== 'cut_passed').length;
  const season = d.fertiliser.season;
  const fieldsLine = fields.length === 0 && ferts.length === 0 ? 'Add your fields and what is in the shed'
    : due > 0 ? `${plural(due, 'field')} due`
    : season && !season.open ? `Spreading closed until ${fmtDay(season.closedTo)}`
    : `${plural(fields.length, 'field')}, ${plural(ferts.length, 'fertiliser')}`;
  tiles.push(tile('fields', 'Fields and fertiliser', fieldsLine, '/fertiliser'));

  // Crops
  if (grows(types)) {
    const year = Number(today.slice(0, 4));
    const crops = b.crops.filter((c) => !c.archived && c.harvest_year >= year);
    const acres = crops.reduce((s, c) => s + Number(c.acres ?? 0), 0);
    tiles.push(tile('crops', 'Crops', crops.length === 0 ? 'Add your crops and acres' : `${plural(crops.length, 'crop')}, ${fmtNum(acres)} acres`, '/farm/crops'));
  }

  // Money and loans: not for a farm worker (the database hides it from them too)
  if (!worker) {
    tiles.push(tile('money', 'Money', 'Cash, bills, budget, year plan', '/money'));
    const loans = (b.loans ?? []).filter((l) => !l.archived);
    tiles.push(tile('reports', 'Reports', 'Profit and loss, balance sheet, animals', '/reports'));
    tiles.push(tile('loans', 'Loans and schemes', loans.length ? plural(loans.length, 'loan') : 'Repayments, interest, scheme payments', '/money/loans'));
  }

  // Records
  const unconfirmed = b.documents.filter((x) => x.state === 'unconfirmed').length + b.records.filter((r) => r.state === 'unconfirmed').length;
  tiles.push(tile('records', 'Records', unconfirmed ? `${unconfirmed} waiting for you to confirm` : 'Dockets, medicines, movements', '/records', unconfirmed ? { count: unconfirmed, tone: 'warn' } : undefined));

  tiles.push(tile('suppliers', 'Suppliers', 'Numbers, your rep, lead times', '/suppliers'));
  return tiles;
}
