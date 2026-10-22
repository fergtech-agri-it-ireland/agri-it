/** The three bulk requests send what they say to the table, and big sets are cut into batches. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { table: string; fn: string; args: unknown[] }[] = [];
function q(table: string) {
  const o: Record<string, unknown> = {};
  const rec = (fn: string) => (...args: unknown[]) => { calls.push({ table, fn, args }); return o; };
  for (const fn of ['upsert', 'update', 'delete', 'in']) o[fn] = rec(fn);
  o.then = (ok: (v: { data: null; error: null }) => unknown) => Promise.resolve().then(() => ok({ data: null, error: null }));
  return o;
}
vi.mock('../supabase', () => ({ supabase: { from: (t: string) => q(t), rpc: async () => ({ data: null, error: null }) } }));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
vi.stubGlobal('navigator', { onLine: true });

const { BATCH, chunk, execute } = await import('./outbox');
import { planAdd, planChange, parseTagList } from '../animalBulk';
import type { Animal } from '../types';

beforeEach(() => { calls.length = 0; });

describe('bulk requests', () => {
  it('insertMany sends all rows once, ignoring ones already there', async () => {
    await execute([{ kind: 'insertMany', table: 'animals', rows: [{ id: 'a' }, { id: 'b' }] }], 'x');
    expect(calls[0]).toMatchObject({ table: 'animals', fn: 'upsert' });
    expect(calls[0].args).toEqual([[{ id: 'a' }, { id: 'b' }], { onConflict: 'id', ignoreDuplicates: true }]);
  });
  it('updateMany and deleteMany act on the ids given and nothing else', async () => {
    await execute([{ kind: 'updateMany', table: 'animals', ids: ['a', 'b'], patch: { status: 'sold' } }, { kind: 'deleteMany', table: 'animals', ids: ['c'] }], 'x');
    expect(calls.map((c) => c.fn)).toEqual(['update', 'in', 'delete', 'in']);
    expect(calls[1].args).toEqual(['id', ['a', 'b']]);
    expect(calls[3].args).toEqual(['id', ['c']]);
  });
  it('chunk cuts a long list into batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
  it('2,000 animals added make 8 requests, and the undo removes the same animals', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `372 12 ${String(10000 + i).padStart(5, '0')} 8 1234`).join('\n');
    const list = parseTagList(text, 'cattle');
    let n = 0;
    const plan = planAdd(list, new Set(), { species: 'cattle', groupId: null, sex: null, castrated: null, breed: '', bornOn: '' }, 'f', () => `id${n++}`);
    expect(plan.rows).toHaveLength(2000);
    expect(plan.ops).toHaveLength(Math.ceil(2000 / BATCH));
    expect(plan.undo.flatMap((o) => (o.kind === 'deleteMany' ? o.ids : []))).toEqual(plan.rows.map((r) => r.id));
  });
  it('a change to 600 animals is sent in batches and undone to each one\'s own earlier value', () => {
    const animals = Array.from({ length: 600 }, (_, i) => ({ id: `a${i}`, breed: i % 2 ? 'Angus' : null }) as unknown as Animal);
    const plan = planChange(animals, { kind: 'breed', breed: 'Hereford' });
    expect(plan.ops).toHaveLength(3);
    expect(plan.undo.every((o) => o.kind === 'updateMany')).toBe(true);
    const back = new Map<string, unknown>();
    for (const o of plan.undo) if (o.kind === 'updateMany') o.ids.forEach((id) => back.set(id, o.patch.breed));
    expect(back.get('a1')).toBe('Angus'); expect(back.get('a2')).toBe(null); expect(back.size).toBe(600);
  });
});
