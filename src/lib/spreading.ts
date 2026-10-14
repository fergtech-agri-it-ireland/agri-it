/**
 * When chemical fertiliser may be spread (14 Oct 2026). Statutory dates only, each with its
 * official source, the day it was checked and a recheck date (releaseGates.test.ts fails the
 * build 30 days after `reviewBy`, as for lib/deadlines.ts). Plus published guidance on timing
 * (Teagasc, DAERA), always labelled guidance, never a rule.
 *
 * Agri-It does not know the weather, soil temperature or ground conditions. Its reminders say
 * when spreading is allowed and when a field is due on the farmer's own round; the farmer
 * decides whether today is a day to spread.
 */
import type { ISODate, Jurisdiction } from './types';
import { addDays } from './format';

export type Zone = 'A' | 'B' | 'C' | 'NI';

export interface ClosedPeriodRule {
  zone: Zone;
  jurisdiction: Jurisdiction;
  counties: string[];
  /** Closed from this day (MM-DD) to `closedTo` (MM-DD) inclusive, across the new year */
  closedFrom: string;
  closedTo: string;
  /** In plain words, as the source puts it */
  text: string;
  /** Spread any time of year */
  exempt: string;
  source: { publisher: string; title: string; url: string };
  /** A second source that confirms the dates for the current year, where the first is older */
  confirmedBy?: { publisher: string; title: string; url: string };
  /** What could and could not be checked */
  note?: string;
  checkedOn: ISODate;
  reviewBy: ISODate;
}

const CHECKED = '2026-10-14';

const ROI_SOURCE = {
  publisher: 'gov.ie (Department of Agriculture, Food and the Marine)',
  title: 'Nitrates Explanatory Handbook (Good Agricultural Practice Regulations 2022), page 7',
  url: 'https://assets.gov.ie/235515/57d8da44-f672-4be4-b26b-5a9405a93ece.pdf'
};
const ROI_CONFIRMED = {
  publisher: 'Teagasc',
  title: 'Fertiliser spreading: key dates approaching',
  url: 'https://teagasc.ie/news--events/daily/fertiliser-spreading-key-dates-approaching/'
};
const ROI_NOTE = 'The 2022 Regulations were replaced on 1 January 2026 by S.I. No. 588 of 2025 (amended by S.I. No. 119 of 2026). Teagasc and the farming press report the same dates for 2026; the new regulation\'s closed-period schedule could not be read in full on 14 Oct 2026, so this is due a recheck early.';
// Rechecked before spreading reopens in January
const ROI_REVIEW = '2027-01-14';

export const CLOSED_PERIODS: ClosedPeriodRule[] = [
  {
    zone: 'A', jurisdiction: 'ROI', closedFrom: '09-15', closedTo: '01-26',
    counties: ['Carlow', 'Cork', 'Dublin', 'Kildare', 'Kilkenny', 'Laois', 'Offaly', 'Tipperary', 'Waterford', 'Wexford', 'Wicklow'],
    text: 'Zone A: no chemical fertiliser from 15 September to 26 January.',
    exempt: 'Lime and straight potash can be spread all year.',
    source: ROI_SOURCE, confirmedBy: ROI_CONFIRMED, note: ROI_NOTE, checkedOn: CHECKED, reviewBy: ROI_REVIEW
  },
  {
    zone: 'B', jurisdiction: 'ROI', closedFrom: '09-15', closedTo: '01-29',
    counties: ['Clare', 'Galway', 'Kerry', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Roscommon', 'Sligo', 'Westmeath'],
    text: 'Zone B: no chemical fertiliser from 15 September to 29 January.',
    exempt: 'Lime and straight potash can be spread all year.',
    source: ROI_SOURCE, confirmedBy: ROI_CONFIRMED, note: ROI_NOTE, checkedOn: CHECKED, reviewBy: ROI_REVIEW
  },
  {
    zone: 'C', jurisdiction: 'ROI', closedFrom: '09-15', closedTo: '02-14',
    counties: ['Cavan', 'Donegal', 'Leitrim', 'Monaghan'],
    text: 'Zone C: no chemical fertiliser from 15 September to 14 February.',
    exempt: 'Lime and straight potash can be spread all year.',
    source: ROI_SOURCE, confirmedBy: ROI_CONFIRMED, note: ROI_NOTE, checkedOn: CHECKED, reviewBy: ROI_REVIEW
  },
  {
    zone: 'NI', jurisdiction: 'NI', closedFrom: '09-16', closedTo: '01-31',
    counties: ['Antrim', 'Armagh', 'Down', 'Fermanagh', 'Londonderry', 'Derry', 'Tyrone'],
    text: 'No chemical fertiliser from midnight on 15 September to midnight on 31 January.',
    exempt: 'Chemical potash on grassland (not blended with nitrogen or phosphorus) has no closed period. Crops other than grass with a demonstrable need are an exception: keep a record of why.',
    source: { publisher: 'DAERA', title: 'Closed spreading period for chemical fertiliser', url: 'https://www.daera-ni.gov.uk/news/closed-spreading-period-chemical-fertiliser' },
    confirmedBy: { publisher: 'DAERA', title: 'Farm Sustainability Standards: 2026 key dates', url: 'https://www.daera-ni.gov.uk/articles/farm-sustainability-standards-fss' },
    checkedOn: CHECKED, reviewBy: '2027-04-14'
  }
];

/** The zone a farm is in, from its county. Null when the county isn't one Agri-It knows (no dates shown). */
export function zoneFor(jurisdiction: Jurisdiction, county: string | null | undefined): ClosedPeriodRule | null {
  if (jurisdiction === 'NI') return CLOSED_PERIODS.find((r) => r.zone === 'NI')!;
  const c = (county ?? '').replace(/^(co\.?|county)\s+/i, '').trim().toLowerCase();
  return CLOSED_PERIODS.find((r) => r.jurisdiction === 'ROI' && r.counties.some((x) => x.toLowerCase() === c)) ?? null;
}

export interface SpreadingSeason {
  rule: ClosedPeriodRule;
  /** Spreading allowed today */
  open: boolean;
  /** The current or next closed period */
  closedFrom: ISODate;
  closedTo: ISODate;
  /** Last day to spread before the next closed period (when open) */
  lastDay: ISODate;
  /** First day spreading is allowed again (when closed: the next one; when open: the one that started this season) */
  opensOn: ISODate;
}

const ymd = (y: number, md: string) => `${y}-${md}`;

/** Where the farm is in the spreading year on `today`. */
export function seasonOn(rule: ClosedPeriodRule, today: ISODate): SpreadingSeason {
  const y = Number(today.slice(0, 4));
  const md = today.slice(5);
  if (md >= rule.closedFrom) {
    // Closed: autumn of this year to winter of next
    const closedFrom = ymd(y, rule.closedFrom), closedTo = ymd(y + 1, rule.closedTo);
    return { rule, open: false, closedFrom, closedTo, lastDay: addDays(closedFrom, -1), opensOn: addDays(closedTo, 1) };
  }
  if (md <= rule.closedTo) {
    // Closed: still in the period that started last autumn
    const closedFrom = ymd(y - 1, rule.closedFrom), closedTo = ymd(y, rule.closedTo);
    return { rule, open: false, closedFrom, closedTo, lastDay: addDays(closedFrom, -1), opensOn: addDays(closedTo, 1) };
  }
  // Open: between this year's reopening and this autumn's close
  const closedFrom = ymd(y, rule.closedFrom);
  return { rule, open: true, closedFrom, closedTo: ymd(y + 1, rule.closedTo), lastDay: addDays(closedFrom, -1), opensOn: addDays(ymd(y, rule.closedTo), 1) };
}

/** True when `on` falls in a closed period for this zone. */
export function isClosed(rule: ClosedPeriodRule, on: ISODate): boolean {
  return !seasonOn(rule, on).open;
}

export function needsRecheck(rule: ClosedPeriodRule, today: ISODate): boolean {
  return today > rule.reviewBy;
}

const dateFmt = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function ruleSourceLine(rule: ClosedPeriodRule): string {
  return `Source: ${rule.source.publisher}, ${rule.source.title}${rule.confirmedBy ? `; confirmed by ${rule.confirmedBy.publisher}, ${rule.confirmedBy.title}` : ''}. Checked ${dateFmt.format(new Date(`${rule.checkedOn}T00:00:00Z`))}.`;
}

/** Published guidance on timing. Shown as guidance with its source, never as a rule or a recommendation of Agri-It's own. */
export interface Guidance { id: string; text: string; source: { publisher: string; title: string; url: string }; checkedOn: ISODate }

export const GUIDANCE: Record<'first_n' | 'silage_n' | 'grazing_n', Guidance> = {
  first_n: {
    id: 'first_n',
    text: 'First nitrogen when soil temperature is above 6°C and rising and grass is growing, typically around the end of February. Only when fields can carry a tractor, and not when heavy rain is forecast.',
    source: { publisher: 'Teagasc', title: 'Early Nitrogen for Spring Grassland (ASSAP factsheet)', url: 'https://teagasc.ie/environment/water-quality/farming-for-water-quality-assap/assap-factsheets/early-nitrogen-for-spring-grassland/' },
    checkedOn: CHECKED
  },
  silage_n: {
    id: 'silage_n',
    text: 'Apply nitrogen at least 50 days before cutting, so the crop uses it all. Put the crop\'s N, P and K on when closing the field.',
    source: { publisher: 'Teagasc', title: 'Correct fertiliser application rates and cutting dates for first-cut silage', url: 'https://teagasc.ie/news--events/daily/correct-fertiliser-application-rates-and-cutting-dates-for-first-cut-silage/' },
    checkedOn: CHECKED
  },
  grazing_n: {
    id: 'grazing_n',
    text: 'Little and often, after each grazing: small regular amounts across the grazing ground every week or two.',
    source: { publisher: 'DAERA', title: 'Fertiliser requirements for grazing', url: 'https://www.daera-ni.gov.uk/news/fertiliser-requirements-grazing' },
    checkedOn: CHECKED
  }
};

/** Days before cutting that silage nitrogen should be on (Teagasc, GUIDANCE.silage_n). */
export const SILAGE_N_DAYS_BEFORE_CUT = 50;
