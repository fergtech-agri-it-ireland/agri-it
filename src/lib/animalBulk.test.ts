import { describe, expect, it } from 'vitest';
import type { Animal } from './types';
import { changeProblem, parseTagList, planAdd, planChange } from './animalBulk';

describe('a pasted list of cattle tags', () => {
  it('finds every tag whatever separates them', () => {
    const l = parseTagList('372 12 34567 8 1234\n372123456781235, IE 04 12345 6 7890;372-12-34567-8-1236 372123456781237', 'cattle');
    expect(l.tags).toEqual(['372123456781234', '372123456781235', 'IE041234567890', '372123456781236', '372123456781237']);
    expect(l.unreadable).toEqual([]);
  });
  it('keeps a repeated tag once and says so', () => {
    const l = parseTagList('372123456781234\n372 12 34567 8 1234\n372123456781235', 'cattle');
    expect(l.tags).toHaveLength(2);
    expect(l.repeated).toEqual(['372123456781234']);
  });
  it('reports what is not a tag instead of guessing', () => {
    const l = parseTagList('372123456781234\n3721234567\nbull', 'cattle');
    expect(l.tags).toEqual(['372123456781234']);
    expect(l.unreadable).toEqual(['3721234567', 'bull']);
  });
  it('a tag of 16 digits is not read as a tag plus a stray digit', () => {
    const l = parseTagList('3721234567812345', 'cattle');
    expect(l.tags).toEqual([]);
    expect(l.unreadable).toEqual(['3721234567812345']);
  });
});

describe('a list of other animals takes any tag', () => {
  it('one per line or separated by commas, spaces inside removed', () => {
    const l = parseTagList('IE-S 001\nS002, S003;x', 'sheep');
    expect(l.tags).toEqual(['IE-S001', 'S002', 'S003']);
    expect(l.unreadable).toEqual(['x']);
  });
});

describe('adding the list', () => {
  const details = { species: 'cattle' as const, groupId: 'g1', sex: 'male' as const, castrated: true, breed: ' Angus ', bornOn: '2026-03-01' as const };
  it('skips tags already on the farm and carries the rest in requests of 250', () => {
    const tags = Array.from({ length: 600 }, (_, i) => `372${String(100000000000 + i)}`);
    let n = 0;
    const p = planAdd({ tags, repeated: [], unreadable: [] }, new Set([tags[0], tags[1]]), details, 'f', () => `id${++n}`);
    expect(p.alreadyHere).toEqual([tags[0], tags[1]]);
    expect(p.rows).toHaveLength(598);
    expect(p.ops.map((o) => (o.kind === 'insertMany' ? o.rows.length : 0))).toEqual([250, 250, 98]);
    expect(p.undo.map((o) => (o.kind === 'deleteMany' ? o.ids.length : 0))).toEqual([250, 250, 98]);
    expect(p.rows[0]).toMatchObject({ species: 'cattle', animal_group_id: 'g1', sex: 'male', castrated: true, breed: 'Angus', born_on: '2026-03-01', status: 'on_farm', tag_source: 'typed' });
  });
  it('castrated is only kept for a male', () => {
    const p = planAdd({ tags: ['372123456781234'], repeated: [], unreadable: [] }, new Set(), { ...details, sex: 'female' }, 'f', () => 'x');
    expect(p.rows[0].castrated).toBeNull();
  });
});

describe('changing many at once', () => {
  const a = (id: string, x: Partial<Animal>): Animal => ({ id, farm_id: 'f', tag_number: id, tag_source: 'typed', animal_group_id: null, sex: null, breed: null, born_on: null, status: 'on_farm', left_on: null, note: null, ...x });
  it('marks them sold, and the undo puts each back as it was', () => {
    const animals = [a('1', { animal_group_id: 'gc' }), a('2', { animal_group_id: 'gc' }), a('3', { status: 'died', left_on: '2026-01-01' })];
    const p = planChange(animals, { kind: 'left', status: 'sold', on: '2026-10-22' });
    expect(p.ops).toEqual([{ kind: 'updateMany', table: 'animals', ids: ['1', '2', '3'], patch: { status: 'sold', left_on: '2026-10-22' } }]);
    expect(p.undo).toEqual([
      { kind: 'updateMany', table: 'animals', ids: ['1', '2'], patch: { status: 'on_farm', left_on: null } },
      { kind: 'updateMany', table: 'animals', ids: ['3'], patch: { status: 'died', left_on: '2026-01-01' } }
    ]);
  });
  it('a group change undoes to the group each was in', () => {
    const animals = [a('1', { animal_group_id: 'gc' }), a('2', { animal_group_id: null })];
    const p = planChange(animals, { kind: 'group', groupId: 'gw' });
    expect(p.undo).toEqual([
      { kind: 'updateMany', table: 'animals', ids: ['1'], patch: { animal_group_id: 'gc' } },
      { kind: 'updateMany', table: 'animals', ids: ['2'], patch: { animal_group_id: null } }
    ]);
  });
  it('refuses a date that cannot be right, and says why', () => {
    const animals = [a('1', { born_on: '2026-06-01' }), a('2', { born_on: '2026-01-01' })];
    expect(changeProblem({ kind: 'left', status: 'sold', on: '2026-03-01' }, animals, '2026-10-22')).toBe('1 of them would leave before they were born.');
    expect(changeProblem({ kind: 'left', status: 'sold', on: '2027-03-01' }, animals, '2026-10-22')).toBe('The date cannot be in the future.');
    expect(changeProblem({ kind: 'born', on: '2026-05-01' }, [a('3', { left_on: '2026-02-01', status: 'sold' })], '2026-10-22')).toBe('1 of them left the farm before that date.');
    expect(changeProblem({ kind: 'left', status: 'sold', on: '2026-10-01' }, animals, '2026-10-22')).toBeNull();
  });
});
