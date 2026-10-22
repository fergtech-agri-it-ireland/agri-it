import { describe, expect, it } from 'vitest';
import { addMonthsISO, ageText, monthsBetween, stageChoices, stageOf, stagePath, stageTable } from './lifeStages';
import type { Animal } from './types';

const an = (x: Partial<Animal>) => ({ species: 'cattle', sex: 'female', castrated: null, born_on: null, stage: null, ...x }) as Pick<Animal, 'species' | 'sex' | 'castrated' | 'born_on' | 'stage'>;
const TODAY = '2026-10-22';

describe('age in months', () => {
  it('counts a month only once its day of the month is reached', () => {
    expect(monthsBetween('2026-04-22', TODAY)).toBe(6);
    expect(monthsBetween('2026-04-23', TODAY)).toBe(5);
    expect(monthsBetween('2025-10-22', TODAY)).toBe(12);
    expect(monthsBetween('2026-10-22', TODAY)).toBe(0);
    expect(monthsBetween('2027-01-01', TODAY)).toBe(0); // born in the future: not negative
  });
  it('adds months, landing on the last day of a shorter month', () => {
    expect(addMonthsISO('2026-04-22', 6)).toBe('2026-10-22');
    expect(addMonthsISO('2025-08-31', 6)).toBe('2026-02-28');
    expect(addMonthsISO('2025-12-15', 12)).toBe('2026-12-15');
  });
  it('says the age in words', () => {
    expect(ageText(null)).toBe('age not known');
    expect(ageText(0)).toBe('under a month');
    expect(ageText(1)).toBe('1 month');
    expect(ageText(8)).toBe('8 months');
    expect(ageText(26)).toBe('2 years 2 months');
    expect(ageText(36)).toBe('3 years');
  });
});

describe('cattle move up by age', () => {
  const at = (born: string, x: Partial<Animal> = {}) => stageOf(an({ born_on: born, ...x }), TODAY);
  it('a heifer calf: calf, weanling, heifer, cow', () => {
    expect(at('2026-09-01').key).toBe('calf');
    expect(at('2026-04-23').key).toBe('calf');       // 5 months
    expect(at('2026-04-22').key).toBe('weanling');   // 6 months today
    expect(at('2025-11-01').key).toBe('weanling');   // 11 months
    expect(at('2025-10-22').key).toBe('heifer');     // 12 months today
    expect(at('2024-10-23').key).toBe('heifer');     // 23 months
    expect(at('2024-10-22').key).toBe('cow');        // 24 months today
  });
  it('says when the next stage comes', () => {
    const s = at('2026-09-01');
    expect(s.next).toEqual({ key: 'weanling', label: 'Weanling', on: '2027-03-01' });
    expect(at('2020-01-01').next).toBeNull();
  });
  it('a castrated male becomes a bullock and stays one', () => {
    expect(at('2025-01-01', { sex: 'male', castrated: true }).key).toBe('bullock');
    expect(at('2020-01-01', { sex: 'male', castrated: true }).key).toBe('bullock');
  });
  it('a male not castrated becomes a young bull then a bull', () => {
    expect(at('2025-06-01', { sex: 'male', castrated: false }).key).toBe('young_bull');
    expect(at('2023-01-01', { sex: 'male', castrated: false }).key).toBe('bull');
  });
  it('a male with no word on castration is a young male, never wrongly a bull or a bullock', () => {
    expect(at('2025-06-01', { sex: 'male' }).key).toBe('young_male');
    expect(at('2025-06-01', { sex: null }).key).toBe('young_cattle');
  });
  it('an adult cow is a dairy cow or a suckler cow from the farm, else just a cow', () => {
    const born = an({ born_on: '2020-01-01' });
    expect(stageOf(born, TODAY).label).toBe('Cow');
    expect(stageOf(born, TODAY, { cow: 'dairy' })).toMatchObject({ label: 'Dairy cow', plural: 'Dairy cows', key: 'cow' });
    expect(stageOf(born, TODAY, { cow: 'suckler' }).plural).toBe('Suckler cows');
    // a calf is never called a cow
    expect(stageOf(an({ born_on: '2026-09-01' }), TODAY, { cow: 'dairy' }).label).toBe('Calf');
  });
});

describe('sheep, goats, pigs, horses and others', () => {
  const at = (x: Partial<Animal>) => stageOf(an(x), TODAY).key;
  it('lamb, hogget, ewe or ram', () => {
    expect(at({ species: 'sheep', born_on: '2026-05-01' })).toBe('lamb');
    expect(at({ species: 'sheep', born_on: '2025-09-01' })).toBe('hogget');
    expect(at({ species: 'sheep', born_on: '2024-01-01' })).toBe('ewe');
    expect(at({ species: 'sheep', sex: 'male', castrated: false, born_on: '2024-01-01' })).toBe('ram');
    expect(at({ species: 'sheep', sex: 'male', castrated: true, born_on: '2024-01-01' })).toBe('wether');
  });
  it('goats, pigs and horses have their own steps', () => {
    expect(at({ species: 'goat', born_on: '2026-08-01' })).toBe('kid');
    expect(at({ species: 'goat', sex: 'male', born_on: '2020-01-01' })).toBe('billy');
    expect(at({ species: 'pig', born_on: '2026-10-10' })).toBe('piglet');
    expect(at({ species: 'pig', born_on: '2026-06-01' })).toBe('grower');
    expect(at({ species: 'pig', born_on: '2025-06-01' })).toBe('sow');
    expect(at({ species: 'horse', born_on: '2026-04-01' })).toBe('foal');
    expect(at({ species: 'horse', sex: 'male', castrated: true, born_on: '2018-01-01' })).toBe('gelding');
  });
  it('another kind of animal has the one stage and needs no birth date', () => {
    expect(stageOf(an({ species: 'other' }), TODAY)).toMatchObject({ key: 'animal', label: 'Animal' });
  });
  it('an animal with no date of birth has no stage worked out, and says so', () => {
    expect(stageOf(an({}), TODAY)).toMatchObject({ key: 'unknown_age', label: 'Age not known', ageMonths: null, next: null });
  });
  it('older records with no kind stored are cattle', () => {
    expect(stageOf({ sex: 'female', born_on: '2020-01-01', stage: null } as never, TODAY).key).toBe('cow');
  });
});

describe('a stage set by hand always wins', () => {
  it('an in-calf heifer stays one whatever her age says, and does not move up', () => {
    const s = stageOf(an({ born_on: '2025-01-01', stage: 'in_calf_heifer' }), TODAY);
    expect(s).toMatchObject({ key: 'in_calf_heifer', byHand: true, next: null });
  });
  it('a stage that belongs to another kind of animal is ignored', () => {
    expect(stageOf(an({ species: 'sheep', born_on: '2025-01-01', stage: 'in_calf_heifer' }), TODAY).key).toBe('hogget');
    expect(stageOf(an({ born_on: '2025-01-01', stage: 'not_a_stage' }), TODAY).key).toBe('heifer');
  });
});

describe('the table of ages', () => {
  it('lists the steps for each kind, and offers stage choices for the form', () => {
    const t = stageTable();
    expect(t[0]).toEqual({ species: 'cattle', who: 'Female cattle', steps: [{ label: 'Calf', from: 0 }, { label: 'Weanling', from: 6 }, { label: 'Heifer', from: 12 }, { label: 'Cow', from: 24 }] });
    expect(stageChoices('cattle').map((s) => s.key)).toContain('in_calf_heifer');
    expect(stageChoices('sheep').map((s) => s.key)).not.toContain('calf');
    expect(stagePath('cattle', 'female', null).at(-1)!.key).toBe('cow');
  });
});
