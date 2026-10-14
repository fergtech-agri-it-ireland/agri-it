import { describe, expect, it } from 'vitest';
import { calfDeadlines, calfTodos, calvingFromBreeding, CALVING_PREP_JOBS, SEASON_SOURCES, seasonSteps, stepDecisionKey, stepWhen } from './season';
import type { CalfBirth, CalvingSeason, SuggestionDecision } from './types';

const season = (x: Partial<CalvingSeason> = {}): CalvingSeason => ({
  id: 's', farm_id: 'f', label: 'Spring calving 2027', herd: 'dairy', calving_start: '2027-02-01', calving_end: '2027-04-15', cows_due: 120,
  thin_count: 15, dry_weeks: 8, dry_weeks_thin: 10, milking_group_id: 'milk', dry_group_id: 'dry', calf_group_id: 'calves', archived: false, ...x
});
const birth = (x: Partial<CalfBirth> = {}): CalfBirth => ({ id: 'b', farm_id: 'f', season_id: 's', born_on: '2027-02-03', calves: 1, calf_group_id: null, tagged_on: null, registered_on: null, notes: null, ...x });
const decided = (key: string, decision: SuggestionDecision['decision'], until: string | null = null): SuggestionDecision => ({ id: key + decision, farm_id: 'f', key, decision, until, decided_at: '2026-11-01T10:00:00Z' });

describe('calving season plan', () => {
  it('works the dairy plan back from the first and last calf dates (Teagasc timings)', () => {
    const steps = seasonSteps(season(), [], '2026-10-13');
    const at = (k: string) => steps.find((s) => s.key === k)!;
    expect(steps.map((s) => s.key)).toEqual(['bcs', 'dry_thin', 'dry_main', 'minerals', 'tags', 'prep', 'calving']);
    expect(at('dry_thin').date).toBe('2026-11-23'); // 10 weeks before 1 Feb
    expect(at('dry_main').date).toBe('2026-12-07'); // 8 weeks before
    expect(at('dry_main').until).toBe('2027-02-18'); // 8 weeks before the last calf
    expect(at('bcs').date).toBe('2026-11-09'); // two weeks before the first drying off
    expect(at('minerals').detail).toContain('21 Dec'); // 6 weeks before calving
    expect(at('prep').action).toEqual({ kind: 'jobs', jobs: CALVING_PREP_JOBS });
    expect(at('tags').title).toBe('Order calf tags');
    for (const s of steps) for (const c of s.sourceCodes) expect(SEASON_SOURCES[c]).toBeTruthy();
  });

  it('suckler herds have no drying off, and a known delivery time sets when to order minerals', () => {
    const steps = seasonSteps(season({ herd: 'suckler' }), [], '2026-10-13', { default_lead_time_days: 5 });
    expect(steps.some((s) => s.key.startsWith('dry'))).toBe(false);
    expect(steps[0].key).toBe('condition');
    const m = steps.find((s) => s.key === 'minerals')!;
    expect(m.date).toBe('2026-12-16'); // minerals from 21 Dec, ordered 5 days before
    expect(m.detail).toContain('5-day delivery time');
  });

  it('no thin cows means no early drying off; no last calf date means an open window', () => {
    expect(seasonSteps(season({ thin_count: 0 }), [], '2026-10-13').some((s) => s.key === 'dry_thin')).toBe(false);
    expect(seasonSteps(season({ calving_end: null }), [], '2026-10-13').find((s) => s.key === 'dry_main')!.until).toBeUndefined();
  });

  it('turns a bull-in date into a calving date with ICBF gestation', () => {
    expect(calvingFromBreeding('2026-04-28')).toBe('2027-02-05');
    expect(calvingFromBreeding('2026-04-28', 279)).toBe('2027-02-01');
  });

  it('a step comes up a week ahead, stays until done, and respects not now and no', () => {
    const steps = seasonSteps(season(), [], '2026-11-20');
    const thin = steps.find((s) => s.key === 'dry_thin')!;
    expect(stepWhen(thin, '2026-11-10')).toBe('later');
    expect(stepWhen(thin, '2026-11-17')).toBe('soon');
    expect(stepWhen(thin, '2026-11-23')).toBe('today');
    expect(stepWhen(thin, '2026-12-20')).toBe('overdue');
    const main = steps.find((s) => s.key === 'dry_main')!;
    expect(stepWhen(main, '2027-01-10')).toBe('today'); // inside the drying-off window
    const k = stepDecisionKey('s', 'dry_thin');
    const snoozed = seasonSteps(season(), [decided(k, 'snoozed', '2026-11-27')], '2026-11-24').find((s) => s.key === 'dry_thin')!;
    expect(snoozed.status).toBe('snoozed');
    expect(stepWhen(snoozed, '2026-11-24')).toBeNull();
    expect(seasonSteps(season(), [decided(k, 'snoozed', '2026-11-27')], '2026-11-28').find((s) => s.key === 'dry_thin')!.status).toBe('open');
    expect(seasonSteps(season(), [decided(k, 'done')], '2026-11-28').find((s) => s.key === 'dry_thin')!.status).toBe('done');
  });
});

describe('calf tagging and registration', () => {
  it('ROI: tag no later than 20 days after birth (S.I. 591/2022), register within 27 days', () => {
    const d = calfDeadlines(birth(), 'ROI', 'dairy');
    expect(d.tagBy).toBe('2027-02-23');
    expect(d.rules.tag!.source.url).toMatch(/irishstatutebook/);
    expect(d.registerBy).toBe('2027-03-02');
    expect(d.next).toBe('tag');
    expect(calfDeadlines(birth({ tagged_on: '2027-02-05' }), 'ROI', 'dairy')).toMatchObject({ tagBy: null, next: 'register' });
  });
  it('NI: dairy calves within 36 hours, others within 20 days', () => {
    expect(calfDeadlines(birth(), 'NI', 'dairy').tagBy).toBe('2027-02-04');
    expect(calfDeadlines(birth(), 'NI', 'suckler').tagBy).toBe('2027-02-23');
  });
  it('gathers calves still to do, counting twins and the ones past the deadline', () => {
    const list = [birth({ id: 'a', born_on: '2027-02-01', calves: 2 }), birth({ id: 'b', born_on: '2027-02-15' }), birth({ id: 'c', born_on: '2027-02-02', tagged_on: '2027-02-03' })];
    const todos = calfTodos(list, 'ROI', () => 'dairy', '2027-02-22');
    const tag = todos.find((t) => t.kind === 'tag')!;
    expect(tag).toMatchObject({ calves: 3, firstBy: '2027-02-21', overdue: 2 });
    expect(todos.find((t) => t.kind === 'register')!.calves).toBe(4);
  });
});
