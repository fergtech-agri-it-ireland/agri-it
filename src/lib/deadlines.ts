/**
 * Statutory deadlines Agri-It reminds farmers about (advisory review G06, gate G5).
 *
 * Every rule here is:
 * - for one jurisdiction (and herd type where the law differs),
 * - backed by the official source, with the day it was last checked,
 * - in force from a date (`effectiveFrom`; null = in force when checked, start not recorded),
 *   so a rule that changes gets a new version and older births keep the rule of their day,
 * - due a recheck by `reviewBy`. releaseGates.test.ts fails the build 30 days after that date,
 *   so a rule can't quietly go stale.
 *
 * Agri-It's dates are reminders. The official system is the record: every screen that shows a
 * statutory deadline says so and names it.
 *
 * To update a rule: check the source, then either bump `checkedOn` and `reviewBy`, or add a new
 * version with its `effectiveFrom` and leave the old one in place for older records.
 */
import type { ISODate, Jurisdiction } from './types';
import { addDays } from './format';

export type DeadlineId = 'calf_tag' | 'calf_register';
export type Herd = 'dairy' | 'other';

export interface StatutoryRule {
  id: DeadlineId;
  version: number;
  jurisdiction: Jurisdiction;
  /** Null = every herd */
  herd: Herd | null;
  /** Days after birth. Hours for the rules written in hours (shown as written; the date is the next day). */
  days: number;
  hours?: number;
  /** The rule in plain words, as the source puts it */
  text: string;
  authority: string;
  /** Where the farmer does it, and checks it */
  officialSystem: string;
  source: { publisher: string; title: string; url: string };
  effectiveFrom: ISODate | null;
  checkedOn: ISODate;
  reviewBy: ISODate;
}

const CHECKED = '2026-10-14';
const REVIEW = '2027-04-14';

export const STATUTORY_RULES: StatutoryRule[] = [
  {
    id: 'calf_tag', version: 1, jurisdiction: 'ROI', herd: null, days: 20,
    text: 'Tag no later than 20 days after birth, or before the calf leaves the farm where it was born if that is sooner.',
    authority: 'Department of Agriculture, Food and the Marine', officialSystem: 'AgFood.ie or the Calf-Reg app',
    source: { publisher: 'Irish Statute Book', title: 'S.I. No. 591/2022, Bovine Identification Regulations 2022, regulation 5', url: 'https://www.irishstatutebook.ie/2022/en/si/0591.html' },
    effectiveFrom: null, checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    id: 'calf_register', version: 1, jurisdiction: 'ROI', herd: null, days: 27,
    text: 'Register the calf within 27 days of its birth.',
    authority: 'Department of Agriculture, Food and the Marine', officialSystem: 'AgFood.ie or the Calf-Reg app',
    source: { publisher: 'gov.ie (DAFM)', title: 'Calf-Reg app', url: 'https://www.gov.ie/en/department-of-agriculture-food-and-the-marine/services/calf-reg-app/' },
    effectiveFrom: null, checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    id: 'calf_tag', version: 1, jurisdiction: 'NI', herd: 'dairy', days: 1, hours: 36,
    text: 'Dairy herds: tag within 36 hours of birth.',
    authority: 'DAERA', officialSystem: 'DAERA Online Services',
    source: { publisher: 'DAERA', title: 'Identification of bovine animals', url: 'https://www.daera-ni.gov.uk/articles/identification-bovine-animals' },
    effectiveFrom: null, checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    id: 'calf_tag', version: 1, jurisdiction: 'NI', herd: 'other', days: 20,
    text: 'Herds other than dairy: tag within 20 days of birth, or before the calf leaves the herd if that is sooner.',
    authority: 'DAERA', officialSystem: 'DAERA Online Services',
    source: { publisher: 'DAERA', title: 'Identification of bovine animals', url: 'https://www.daera-ni.gov.uk/articles/identification-bovine-animals' },
    effectiveFrom: null, checkedOn: CHECKED, reviewBy: REVIEW
  },
  {
    id: 'calf_register', version: 1, jurisdiction: 'NI', herd: null, days: 27,
    text: 'Notify the birth and tagging within 27 days of birth, or before the calf moves if that is sooner.',
    authority: 'DAERA', officialSystem: 'DAERA Online Services (or phone 0300 200 7855, or form MC1)',
    source: { publisher: 'DAERA', title: 'Notification of bovine births', url: 'https://www.daera-ni.gov.uk/articles/notification-bovine-births' },
    effectiveFrom: null, checkedOn: CHECKED, reviewBy: REVIEW
  }
];

/** The rule in force on `on` for this farm and herd. Null when Agri-It has no checked rule (it then shows no date). */
export function ruleFor(id: DeadlineId, jurisdiction: Jurisdiction, herd: Herd, on: ISODate): StatutoryRule | null {
  const fits = STATUTORY_RULES
    .filter((r) => r.id === id && r.jurisdiction === jurisdiction && (r.herd === null || r.herd === herd))
    .filter((r) => r.effectiveFrom === null || r.effectiveFrom <= on)
    // The newest version in force, and a herd-specific rule over an all-herds one
    .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? '') || Number(b.herd !== null) - Number(a.herd !== null) || b.version - a.version);
  return fits[0] ?? null;
}

/** The last day, from the birth date. */
export function deadlineFrom(rule: StatutoryRule, born: ISODate): ISODate {
  return addDays(born, rule.days);
}

/** True once a rule is past its recheck date: screens say so, and the build fails 30 days later. */
export function needsRecheck(rule: StatutoryRule, today: ISODate): boolean {
  return today > rule.reviewBy;
}

const dateFmt = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "Source: DAERA, Identification of bovine animals, checked 14 Oct 2026." */
export function ruleSourceLine(rule: StatutoryRule): string {
  return `Source: ${rule.source.publisher}, ${rule.source.title}, checked ${dateFmt.format(new Date(`${rule.checkedOn}T00:00:00Z`))}.`;
}
