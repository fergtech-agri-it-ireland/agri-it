/**
 * Scheme payments: when they usually come and how they are split (rule schemes@1.0).
 *
 * The farmer gives what they expect for the year (from their AgFood or DAERA statement);
 * Agri-It places it on the published advance and balance dates, so the cash plan knows
 * December is a big month. These are planning dates, not promises: a payment only arrives
 * once the Department has cleared the claim. Nothing is income until the farmer says it came.
 *
 * Every timing carries its source and the day it was checked, like lib/deadlines.ts, and the
 * build fails 30 days after `reviewBy` (releaseGates.test.ts) so a stale date can't linger.
 */
import type { ExpectedIncome, FarmType, ISODate, Jurisdiction } from './types';
import { uuid } from './format';

export const SCHEMES_RULE_VERSION = 'schemes@1.0';

export interface SchemeSource { title: string; publisher: string; url: string; published: ISODate }
export interface SchemePart {
  part: ExpectedIncome['part'];
  /** Share of the year's total, 0 to 1. The last part takes what's left, to the cent. */
  share: number;
  month: number;
  day: number;
  /** 1 = the year after the scheme year (balances paid in spring) */
  yearOffset: 0 | 1;
  /** How the source puts it, e.g. "from 16 October" or "early December" */
  when: string;
}
export interface SchemeRule {
  key: string;
  label: string;
  /** One line on what it is, in plain words */
  sub: string;
  jurisdiction: Jurisdiction;
  /** Suggested first for these farm types (any farm can add any scheme) */
  suggestFor: FarmType[] | 'all';
  parts: SchemePart[];
  sources: SchemeSource[];
  checkedOn: ISODate;
  reviewBy: ISODate;
  note?: string;
}

const FJ_ANC_2026: SchemeSource = { title: 'ANC payments to commence from 16 September', publisher: 'Irish Farmers Journal', url: 'https://www.farmersjournal.ie/anc-payments-to-commence-from-16-september-931550', published: '2026-09-09' };
const AGRILAND_75: SchemeSource = { title: 'Advance payments rise to 75% for BISS, CRISS and Eco-scheme', publisher: 'Agriland', url: 'https://www.agriland.ie/farming-news/advance-payments-rise-to-75-for-biss-criss-and-eco-scheme/', published: '2026-08-21' };
const AGRILAND_ECO: SchemeSource = { title: 'Eco-Scheme payments of €203m begin issuing to farmers', publisher: 'Agriland', url: 'https://www.agriland.ie/farming-news/eco-scheme-payments-of-e203m-begin-issuing-to-farmers/', published: '2026-10-16' };
const GOV_ACRES: SchemeSource = { title: 'Minister Heydon announces issue of €37 million in ACRES balancing payments for 2025 scheme year', publisher: 'Department of Agriculture, Food and the Marine (gov.ie)', url: 'https://www.gov.ie/en/department-of-agriculture-food-and-the-marine/press-releases/minister-heydon-announces-issue-of-37-million-in-acres-balancing-payments-for-2025-scheme-year/', published: '2026-04-20' };
const AGRILAND_SIS: SchemeSource = { title: 'Almost €17m in Sheep Improvement Scheme payments begin issuing', publisher: 'Agriland', url: 'https://www.agriland.ie/farming-news/almost-e17m-in-sheep-improvement-scheme-payments-begin-issuing/', published: '2025-11-24' };
const CHARTER: SchemeSource = { title: "Timeline of key payments outlined in new Farmers' Charter", publisher: 'Agriland', url: 'https://www.agriland.ie/farming-news/timeline-of-key-payments-outlined-in-new-farmers-charter/', published: '2024-07-04' };
const FJ_FSP: SchemeSource = { title: '£240m of payments issued to NI farmers', publisher: 'Irish Farmers Journal', url: 'https://www.farmersjournal.ie/more/northern-ireland/240m-of-payments-issued-to-ni-farmers-930837', published: '2026-09-02' };

const CHECKED = '2026-10-16';
const REVIEW = '2027-04-16';

export const SCHEME_RULES: SchemeRule[] = [
  {
    key: 'biss', label: 'BISS and CRISS', sub: 'Basic Income Support and the redistributive top-up', jurisdiction: 'ROI', suggestFor: 'all',
    parts: [
      { part: 'advance', share: 0.75, month: 10, day: 16, yearOffset: 0, when: '75% from 16 October' },
      { part: 'balance', share: 0.25, month: 12, day: 5, yearOffset: 0, when: 'the rest from early December' }
    ],
    sources: [AGRILAND_75, FJ_ANC_2026], checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    key: 'eco', label: 'Eco-scheme', sub: 'Paid with BISS for the eco actions you picked', jurisdiction: 'ROI', suggestFor: 'all',
    parts: [
      { part: 'advance', share: 0.75, month: 10, day: 16, yearOffset: 0, when: '75% from 16 October' },
      { part: 'balance', share: 0.25, month: 12, day: 5, yearOffset: 0, when: 'the rest from early December' }
    ],
    sources: [AGRILAND_ECO, AGRILAND_75], checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    key: 'anc', label: 'ANC', sub: 'Areas of Natural Constraint', jurisdiction: 'ROI', suggestFor: ['suckler', 'beef', 'sheep', 'dairy', 'calf_rearing', 'goats', 'horses'],
    parts: [
      { part: 'advance', share: 0.85, month: 9, day: 16, yearOffset: 0, when: '85% from 16 September' },
      { part: 'balance', share: 0.15, month: 12, day: 5, yearOffset: 0, when: 'the rest in early December' }
    ],
    sources: [FJ_ANC_2026], checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    key: 'acres', label: 'ACRES', sub: 'Agri-Climate Rural Environment Scheme', jurisdiction: 'ROI', suggestFor: 'all',
    parts: [
      { part: 'advance', share: 0.85, month: 11, day: 10, yearOffset: 0, when: '85% advance in November' },
      { part: 'balance', share: 0.15, month: 4, day: 15, yearOffset: 1, when: 'the balance the next April' }
    ],
    sources: [GOV_ACRES], checkedOn: CHECKED, reviewBy: REVIEW,
    note: 'Dates follow the 2025 scheme year (advance from 10 November 2025, balance from 15 April 2026). The 2026 advance date was not confirmed when checked.'
  },
  {
    key: 'scep', label: 'SCEP', sub: 'Suckler Carbon Efficiency Programme', jurisdiction: 'ROI', suggestFor: ['suckler'],
    parts: [{ part: 'full', share: 1, month: 12, day: 5, yearOffset: 0, when: 'early December' }],
    sources: [CHARTER], checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    key: 'sis', label: 'Sheep Improvement Scheme', sub: 'Payments for the sheep welfare actions', jurisdiction: 'ROI', suggestFor: ['sheep'],
    parts: [
      { part: 'advance', share: 0.85, month: 11, day: 24, yearOffset: 0, when: '85% advance from late November' },
      { part: 'balance', share: 0.15, month: 4, day: 15, yearOffset: 1, when: 'the rest the next April' }
    ],
    sources: [AGRILAND_SIS], checkedOn: CHECKED, reviewBy: REVIEW,
    note: 'Dates follow the 2025 scheme year (advance from 24 November 2025, balance from April 2026).'
  },
  {
    key: 'cisyf', label: 'Young farmer payment', sub: 'CIS-YF, and National Reserve top-ups', jurisdiction: 'ROI', suggestFor: 'all',
    parts: [{ part: 'full', share: 1, month: 12, day: 5, yearOffset: 0, when: 'early December' }],
    sources: [CHARTER], checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    key: 'fsp', label: 'Farm Sustainability Payment', sub: 'The main area payment in Northern Ireland', jurisdiction: 'NI', suggestFor: 'all',
    parts: [{ part: 'full', share: 1, month: 9, day: 1, yearOffset: 0, when: 'from early September' }],
    sources: [FJ_FSP], checkedOn: CHECKED, reviewBy: REVIEW,
    note: 'The 2026 payment issued from 1 September 2026. Check DAERA Online Services for your claim.'
  }
];

export function schemeRule(key: string): SchemeRule | undefined {
  return SCHEME_RULES.find((r) => r.key === key);
}

/** The schemes for a farm, the most likely first. Any farm can add any scheme on its side of the border. */
export function schemesFor(jurisdiction: Jurisdiction, types: FarmType[]): SchemeRule[] {
  const list = SCHEME_RULES.filter((r) => r.jurisdiction === jurisdiction);
  const likely = (r: SchemeRule) => r.suggestFor === 'all' || r.suggestFor.some((t) => types.includes(t));
  return [...list.filter(likely), ...list.filter((r) => !likely(r))];
}

/** The scheme year a farmer is most likely thinking of: this year's claim. */
export function currentSchemeYear(today: ISODate): number {
  return Number(today.slice(0, 4));
}

export interface PlannedPart { part: SchemePart['part']; amount: number; on: ISODate; when: string; past: boolean }

/** Split the year's total over the published dates. The last part takes what's left, so the parts add up to the cent. */
export function planScheme(rule: SchemeRule, total: number, year: number, today: ISODate): PlannedPart[] {
  const cents = Math.round(total * 100);
  let given = 0;
  return rule.parts.map((p, i) => {
    const share = i === rule.parts.length - 1 ? cents - given : Math.round(cents * p.share);
    given += share;
    const on = `${year + p.yearOffset}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    return { part: p.part, amount: share / 100, on, when: p.when, past: on < today };
  });
}

/** Rows for expected_income, one per part the farmer kept. */
export function expectedRows(farmId: string, rule: SchemeRule, year: number, parts: PlannedPart[]): ExpectedIncome[] {
  return parts.filter((p) => p.amount > 0).map((p) => ({
    id: uuid(), farm_id: farmId, scheme: rule.key, label: `${rule.label} ${year}${p.part === 'full' ? '' : p.part === 'advance' ? ', advance' : ', balance'}`,
    scheme_year: year, part: p.part, amount_eur: p.amount, expected_on: p.on, rule: SCHEMES_RULE_VERSION, income_id: null
  }));
}

/** "Agriland, 21 Aug 2026; Irish Farmers Journal, 9 Sep 2026. Checked 16 Oct 2026." */
export function schemeSourceLine(rule: SchemeRule): string {
  const d = (s: ISODate) => new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
  return `${rule.sources.map((s) => `${s.publisher}, ${d(s.published)}`).join('; ')}. Checked ${d(rule.checkedOn)}.`;
}

/** Expected payments still to come in (not received), in date order. */
export function stillExpected(rows: ExpectedIncome[]): ExpectedIncome[] {
  return rows.filter((r) => !r.income_id).sort((a, b) => a.expected_on.localeCompare(b.expected_on));
}
