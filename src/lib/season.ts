/**
 * Calving season planner (rule season-plan@1.0).
 *
 * From the farmer's own calving dates, Agri-It lays out the jobs around drying off and calving,
 * each with its date and where the timing comes from. Nothing is recorded until the farmer
 * approves a step: approving adds jobs to the list or opens the drying-off screen.
 *
 * Published timings used (checked 13 Oct 2026):
 * - Teagasc BCS guide (T1): dry thin cows 10 weeks before calving, cows on target 8 weeks;
 *   herd average 3.0 at drying off (2.75 to 3.25), 3.25 before calving (3.0 to 3.5).
 * - Teagasc dairy advice (T2): standard dry period 60 to 70 days.
 * - Teagasc calving checklist (T3): pre-calver minerals 6 weeks before calving; pens, colostrum,
 *   cameras, tags and calving gear ready (no timing given: Agri-It puts them 3 weeks before the
 *   first calf and says so).
 * - Teagasc, getting the cow ready for calving (T4): pre-calver minerals 4 to 6 weeks before
 *   calving; thin and fat cows back on target 50 to 60 days before calving.
 * - Calf tagging and registration: ROI tag before 20 days of age, register within 27 days (T5);
 *   NI dairy tag within 36 hours, other herds 20 days, notify within 27 days (T6).
 * - ICBF gestation (T7): Holstein Friesian average 279 days, all cattle 283.
 *
 * Agri-It never says how much to feed a dry cow: that stays with the farmer and their adviser.
 */
import type { CalfBirth, CalvingSeason, Farm, ISODate, SuggestionDecision } from './types';
import { addDays, daysBetween, fmtDay } from './format';

export const SEASON_RULE_VERSION = 'season-plan@1.0';

export interface SeasonSource { code: string; title: string; publisher: string; url: string; published: string }
export const SEASON_SOURCES: Record<string, SeasonSource> = {
  T1: { code: 'T1', title: 'Body Condition Scoring (BCS)', publisher: 'Teagasc', url: 'https://teagasc.ie/wp-content/uploads/media/website/events/2023/BCS.pdf', published: '2023' },
  T2: { code: 'T2', title: 'Dairy advice: act early when managing body condition score over an extended dry period', publisher: 'Teagasc', url: 'https://teagasc.ie/news--events/daily/dairy-advice-act-early-when-managing-body-condition-score-over-an-extended-dry-period/', published: '' },
  T3: { code: 'T3', title: 'Preparation and planning: calving checklist', publisher: 'Teagasc', url: 'https://teagasc.ie/news--events/daily/preparation-and-planning-calving-checklist/', published: '' },
  T4: { code: 'T4', title: 'Getting the cow ready for calving', publisher: 'Teagasc', url: 'https://teagasc.ie/news--events/daily/getting-the-cow-ready-for-calving/', published: '' },
  T5: { code: 'T5', title: 'Important calf-related dates and scheme compliance', publisher: 'Irish Farmers Journal', url: 'https://www.farmersjournal.ie/important-calf-related-dates-and-scheme-compliance-851967', published: '2025-01-18' },
  T6: { code: 'T6', title: 'Notification of bovine births', publisher: 'DAERA', url: 'https://www.daera-ni.gov.uk/articles/notification-bovine-births', published: '' },
  T7: { code: 'T7', title: 'Updated gestation length figures', publisher: 'ICBF', url: 'https://www.icbf.com/?p=16931', published: '2020-12-04' }
};

/** ICBF average gestation (T7). Used only to turn a bull-in or AI start date into a calving date. */
export const GESTATION_DAYS = { holstein_friesian: 279, all_cattle: 283 } as const;
export function calvingFromBreeding(breedingStart: ISODate, gestation: number = GESTATION_DAYS.all_cattle): ISODate {
  return addDays(breedingStart, gestation);
}

export type StepAction =
  /** Approving adds these jobs to the job list (due on the step's date) */
  | { kind: 'jobs'; jobs: string[] }
  /** Approving opens the drying-off screen for this batch */
  | { kind: 'dry_off'; batch: 'thin' | 'main' }
  /** Nothing to approve: a link to look at */
  | { kind: 'open'; to: string; label: string };

export interface SeasonStep {
  /** Stable within a season: decisions are stored against `season:<id>:<key>` */
  key: string;
  date: ISODate;
  /** For a window (drying off cows on target): the last day */
  until?: ISODate;
  title: string;
  detail: string;
  sourceCodes: string[];
  /** Agri-It chose this timing itself (the source gives no timing) */
  ourTiming?: boolean;
  action: StepAction;
  status: 'done' | 'dismissed' | 'snoozed' | 'open';
  snoozedUntil?: ISODate | null;
}

export const stepDecisionKey = (seasonId: string, key: string) => `season:${seasonId}:${key}`;

export function decisionFor(decisions: SuggestionDecision[], key: string, today: ISODate): { status: SeasonStep['status']; until: ISODate | null } {
  const d = [...decisions].filter((x) => x.key === key).sort((a, c) => c.decided_at.localeCompare(a.decided_at))[0];
  if (!d) return { status: 'open', until: null };
  if (d.decision === 'snoozed') return d.until && d.until > today ? { status: 'snoozed', until: d.until } : { status: 'open', until: null };
  return { status: d.decision, until: null };
}

/** The calving checklist from Teagasc (T3), as jobs. */
export const CALVING_PREP_JOBS = [
  'Clean and disinfect the calving pens',
  'Get frozen colostrum ready',
  'Check calving cameras and sensors work',
  'Check the calving gate and crush are secure',
  'Stock the calving kit (gloves, lubricant, jack, ropes, iodine, stomach tube, thermometer)'
];

export function seasonSteps(season: CalvingSeason, decisions: SuggestionDecision[], today: ISODate, farm?: Pick<Farm, 'default_lead_time_days'>): SeasonStep[] {
  const S = season.calving_start;
  const E = season.calving_end && season.calving_end >= S ? season.calving_end : null;
  const dw = season.dry_weeks || 8;
  const dwThin = season.dry_weeks_thin || 10;
  const due = season.cows_due ? `${season.cows_due} ` : '';
  const steps: Omit<SeasonStep, 'status' | 'snoozedUntil'>[] = [];

  if (season.herd === 'dairy') {
    const dryThin = addDays(S, -dwThin * 7);
    const dryMain = addDays(S, -dw * 7);
    steps.push({
      key: 'bcs', date: addDays(dryThin, -14), title: 'Body condition score the herd',
      detail: `Pick out the thin cows to dry off first, from ${fmtDay(dryThin)}. Teagasc's target is a herd average of 3.0 at drying off (2.75 to 3.25).`,
      sourceCodes: ['T1'], ourTiming: true, action: { kind: 'jobs', jobs: ['Body condition score the cows'] }
    });
    if (season.thin_count !== 0) {
      steps.push({
        key: 'dry_thin', date: dryThin, title: `Dry off thin cows${season.thin_count ? ` (${season.thin_count})` : ''}`,
        detail: `Teagasc: dry thin cows ${dwThin} weeks before calving, so from ${fmtDay(dryThin)} for cows due ${fmtDay(S)}.`,
        sourceCodes: ['T1'], action: { kind: 'dry_off', batch: 'thin' }
      });
    }
    steps.push({
      key: 'dry_main', date: dryMain, until: E ? addDays(E, -dw * 7) : undefined, title: 'Dry off cows on target',
      detail: E
        ? `${dw} weeks before each cow is due: from ${fmtDay(dryMain)} for the first, to ${fmtDay(addDays(E, -dw * 7))} for the last. Teagasc's standard dry period is 60 to 70 days.`
        : `${dw} weeks before each cow is due, from ${fmtDay(dryMain)} for the first. Teagasc's standard dry period is 60 to 70 days.`,
      sourceCodes: ['T1', 'T2'], action: { kind: 'dry_off', batch: 'main' }
    });
  } else {
    steps.push({
      key: 'condition', date: addDays(S, -90), title: 'Check cow condition',
      detail: `Teagasc: get thin and fat cows back on target 50 to 60 days before calving (by ${fmtDay(addDays(S, -60))}), and hold them steady after that.`,
      sourceCodes: ['T4'], ourTiming: true, action: { kind: 'jobs', jobs: ['Check cow body condition'] }
    });
  }

  const mineralsStart = addDays(S, -42);
  const lead = farm?.default_lead_time_days ?? null;
  steps.push({
    key: 'minerals', date: lead ? addDays(mineralsStart, -lead) : addDays(mineralsStart, -7),
    title: 'Pre-calver minerals',
    detail: `Teagasc: start pre-calver minerals 4 to 6 weeks before calving, so from ${fmtDay(mineralsStart)}. Don't use last year's leftovers.${lead ? ` Order by ${fmtDay(addDays(mineralsStart, -lead))} (your ${lead}-day delivery time).` : ''}`,
    sourceCodes: ['T3', 'T4'], action: { kind: 'jobs', jobs: ['Order pre-calver minerals', `Start pre-calver minerals (from ${fmtDay(mineralsStart)})`] }
  });
  steps.push({
    key: 'tags', date: addDays(S, -28), title: 'Order calf tags',
    detail: `${due ? `${due}cows due. ` : ''}Teagasc's checklist says to have enough tags in before calving starts.`,
    sourceCodes: ['T3'], ourTiming: true, action: { kind: 'jobs', jobs: [`Order calf tags${season.cows_due ? ` (${season.cows_due} cows due)` : ''}`] }
  });
  steps.push({
    key: 'prep', date: addDays(S, -21), title: 'Get ready for calving',
    detail: `Teagasc's calving checklist: pens, colostrum, cameras, gate and crush, calving kit. ${CALVING_PREP_JOBS.length} jobs.`,
    sourceCodes: ['T3'], ourTiming: true, action: { kind: 'jobs', jobs: CALVING_PREP_JOBS }
  });
  steps.push({
    key: 'calving', date: S, until: E ?? undefined, title: 'Calving starts',
    detail: `First calf due ${fmtDay(S)}${E ? `, last ${fmtDay(E)}` : ''}. Record each calf: Agri-It keeps the tagging and registration dates for you.`,
    sourceCodes: [], action: { kind: 'open', to: '/record/calf', label: 'Record a calf' }
  });

  return steps.map((s) => {
    const d = decisionFor(decisions, stepDecisionKey(season.id, s.key), today);
    return { ...s, status: d.status, snoozedUntil: d.until };
  });
}

/** When a step should be in front of the farmer: a week ahead until done (windows stay until their last day). */
export function stepWhen(s: SeasonStep, today: ISODate): 'overdue' | 'today' | 'soon' | 'later' | null {
  if (s.status !== 'open') return null;
  const end = s.until ?? s.date;
  if (s.action.kind === 'open' && end < today) return null; // calving itself has passed
  if (today > end) return 'overdue';
  if (today >= s.date) return 'today';
  if (daysBetween(today, s.date) <= 7) return 'soon';
  return 'later';
}

// ---------------------------------------------------------------------------
// Calf tagging and registration deadlines
// ---------------------------------------------------------------------------
export interface CalfDeadline {
  birth: CalfBirth;
  tagBy: ISODate | null;
  registerBy: ISODate | null;
  /** 'tag' or 'register', whichever is next and not yet done */
  next: 'tag' | 'register' | null;
  nextBy: ISODate | null;
}

/**
 * Last day to tag and to register. ROI: tagged before 20 days of age, registered within 27 days (T5).
 * NI: dairy herds tag within 36 hours (the next day), other herds within 20 days; notify within 27 days (T6).
 */
export function calfDeadlines(birth: CalfBirth, jurisdiction: 'ROI' | 'NI', herd: 'dairy' | 'suckler'): CalfDeadline {
  const tagDays = jurisdiction === 'NI' ? (herd === 'dairy' ? 1 : 20) : 19;
  const tagBy = birth.tagged_on ? null : addDays(birth.born_on, tagDays);
  const registerBy = birth.registered_on ? null : addDays(birth.born_on, 27);
  const next = tagBy ? 'tag' : registerBy ? 'register' : null;
  return { birth, tagBy, registerBy, next, nextBy: next === 'tag' ? tagBy : registerBy };
}

export interface CalfTodo { kind: 'tag' | 'register'; calves: number; firstBy: ISODate; overdue: number; births: CalfBirth[] }

/** Calves still to tag and to register, gathered so the farmer can do them in one go. */
export function calfTodos(births: CalfBirth[], jurisdiction: 'ROI' | 'NI', herdOf: (b: CalfBirth) => 'dairy' | 'suckler', today: ISODate): CalfTodo[] {
  const out: CalfTodo[] = [];
  for (const kind of ['tag', 'register'] as const) {
    const list = births.map((b) => calfDeadlines(b, jurisdiction, herdOf(b))).filter((d) => (kind === 'tag' ? d.tagBy : d.registerBy));
    if (!list.length) continue;
    const by = list.map((d) => (kind === 'tag' ? d.tagBy! : d.registerBy!)).sort();
    out.push({
      kind, calves: list.reduce((n, d) => n + d.birth.calves, 0), firstBy: by[0],
      overdue: list.filter((d) => (kind === 'tag' ? d.tagBy! : d.registerBy!) < today).reduce((n, d) => n + d.birth.calves, 0),
      births: list.map((d) => d.birth)
    });
  }
  return out;
}

export const sourceOf = (code: string) => SEASON_SOURCES[code];
