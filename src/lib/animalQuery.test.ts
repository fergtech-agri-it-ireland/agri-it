import { describe, expect, it } from 'vitest';
import type { Animal, AnimalGroup, Farm, FarmBundle } from './types';
import { NO_FILTER, applyFilter, breedsIn, dueToMoveUp, purposeFor, reachingSoon, summarise, viewAll } from './animalQuery';

const TODAY = '2026-10-22';
const farm = { id: 'f', name: 'T', jurisdiction: 'ROI', enterprise: 'dairy', enterprises: ['dairy', 'sheep'] } as unknown as Farm;
const grp = (id: string, name: string, animal_class: AnimalGroup['animal_class'], x: Partial<AnimalGroup> = {}) => ({ id, farm_id: 'f', name, animal_class, head_count: 10, archived: false, sort_order: 0, ...x }) as AnimalGroup;
const groups = [grp('gc', 'Calves', 'calf'), grp('gw', 'Weanlings', 'weanling'), grp('gh', 'Heifers', 'heifer'), grp('gd', 'Dairy cows', 'dairy_cow'), grp('gl', 'Lambs', 'lamb'), grp('gg', 'Hoggets', 'hogget')];
let n = 0;
const an = (x: Partial<Animal>): Animal => ({ id: `a${++n}`, farm_id: 'f', tag_number: `372${String(100000000000 + n)}`, tag_source: 'typed', animal_group_id: null, sex: 'female', breed: null, born_on: null, status: 'on_farm', left_on: null, note: null, species: 'cattle', ...x });
const bundle = (animals: Animal[]) => ({ farm, groups, animals }) as unknown as FarmBundle;

describe('counting and finding', () => {
  const animals = [
    an({ born_on: '2026-09-01', animal_group_id: 'gc', breed: 'Angus' }),           // calf
    an({ born_on: '2026-09-02', animal_group_id: 'gc', breed: 'Angus' }),           // calf
    an({ born_on: '2026-02-01', animal_group_id: 'gc', breed: 'Hereford' }),         // weanling, still in Calves
    an({ born_on: '2020-02-01', animal_group_id: 'gd', breed: 'Holstein' }),         // cow
    an({ species: 'sheep', born_on: '2026-05-01', animal_group_id: 'gl' }),          // lamb
    an({ species: 'sheep', born_on: '2025-06-01', animal_group_id: 'gl' }),          // hogget, still in Lambs
    an({ born_on: '2019-01-01', status: 'sold', left_on: '2026-08-01' })            // gone
  ];
  const b = bundle(animals);
  const views = viewAll(b, TODAY);
  it('counts by kind and by stage, youngest first, for the animals on the farm', () => {
    const s = summarise(views);
    expect(s.map((x) => [x.species, x.count])).toEqual([['cattle', 4], ['sheep', 2]]);
    expect(s[0].stages.map((x) => [x.label, x.count])).toEqual([['Calf', 2], ['Weanling', 1], ['Dairy cow', 1]]);
    expect(summarise(views, true)[0].count).toBe(1);
  });
  it('filters by kind, stage, group, breed and a part of the tag', () => {
    expect(applyFilter(views, { ...NO_FILTER, species: 'sheep' })).toHaveLength(2);
    expect(applyFilter(views, { ...NO_FILTER, stage: 'calf' })).toHaveLength(2);
    expect(applyFilter(views, { ...NO_FILTER, group: 'gc' })).toHaveLength(3);
    expect(applyFilter(views, { ...NO_FILTER, breed: 'Angus' })).toHaveLength(2);
    expect(applyFilter(views, { ...NO_FILTER, status: 'left' })).toHaveLength(1);
    expect(applyFilter(views, { ...NO_FILTER, status: 'all' })).toHaveLength(7);
    const last = animals[3].tag_number.slice(-4);
    expect(applyFilter(views, { ...NO_FILTER, text: last }).map((v) => v.a.id)).toContain(animals[3].id);
    expect(applyFilter(views, { ...NO_FILTER, text: 'hereford' })).toHaveLength(1);
    expect(applyFilter(views, { ...NO_FILTER, group: 'none' })).toHaveLength(0);
  });
  it('lists breeds, most common first', () => {
    expect(breedsIn(views)).toEqual(['Angus', 'Hereford', 'Holstein']);
  });
  it('a dairy and sheep farm calls an adult cow a dairy cow', () => {
    expect(views[3].stage.label).toBe('Dairy cow');
    expect(purposeFor(b, null)).toEqual({ cow: 'dairy' });
    expect(purposeFor({ farm: { ...farm, enterprises: ['dairy', 'suckler'] } } as FarmBundle, null)).toEqual({ cow: null });
  });
});

describe('animals that have outgrown their group', () => {
  const animals = [
    an({ born_on: '2026-09-01', animal_group_id: 'gc' }),   // calf in Calves: right
    an({ born_on: '2026-02-01', animal_group_id: 'gc' }),   // weanling in Calves: due
    an({ born_on: '2026-01-01', animal_group_id: 'gc' }),   // weanling in Calves: due
    an({ born_on: '2025-06-01', animal_group_id: 'gw' }),   // heifer in Weanlings: due, to Heifers
    an({ born_on: '2026-02-01', animal_group_id: 'gh' }),   // a weanling in the Heifers group: older group, not due
    an({ species: 'sheep', born_on: '2025-06-01', animal_group_id: 'gl' }), // hogget in Lambs: due
    an({ born_on: '2026-02-01' }),                           // no group: nothing to move
    an({ born_on: '2026-02-01', animal_group_id: 'gc', stage: 'weanling' }), // set by hand: left alone
    an({ born_on: '2026-02-01', animal_group_id: 'gc', status: 'sold', left_on: '2026-09-01' }) // gone
  ];
  const views = viewAll(bundle(animals), TODAY);
  const due = dueToMoveUp(views, groups);
  it('finds them by group and stage, with the group each belongs in', () => {
    expect(due.map((d) => [d.from.name, d.stageLabel, d.views.length, d.targets.map((t) => t.name)])).toEqual([
      ['Calves', 'Weanling', 2, ['Weanlings']],
      ['Weanlings', 'Heifer', 1, ['Heifers']],
      ['Lambs', 'Hogget', 1, ['Hoggets']]
    ]);
  });
  it('says so when the farm has no group for the new stage', () => {
    const d = dueToMoveUp(views, groups.filter((g) => g.id !== 'gw'));
    expect(d.find((x) => x.from.id === 'gc')!.targets).toEqual([]);
  });
  it('looks ahead to who reaches the next stage soon', () => {
    const soon = reachingSoon(viewAll(bundle([an({ born_on: '2026-04-30', animal_group_id: 'gc' }), an({ born_on: '2026-09-01' })]), TODAY), TODAY, 14);
    expect(soon).toHaveLength(1); // weanling on 30 Oct
  });
});

describe('thousands of animals', () => {
  it('counts and filters 5,000 animals in well under a second', () => {
    const many: Animal[] = [];
    for (let i = 0; i < 5000; i++) many.push(an({ species: i % 3 ? 'cattle' : 'sheep', born_on: `20${20 + (i % 7)}-0${1 + (i % 9)}-15`, animal_group_id: groups[i % groups.length].id, breed: i % 2 ? 'Angus' : 'Charolais' }));
    const t0 = Date.now();
    const v = viewAll(bundle(many), TODAY);
    const s = summarise(v);
    const hits = applyFilter(v, { ...NO_FILTER, species: 'sheep', breed: 'Angus' });
    expect(s.reduce((x, y) => x + y.count, 0)).toBe(5000);
    expect(hits.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
