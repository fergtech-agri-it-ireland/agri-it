/**
 * UAT-06 and UAT-07: offline writes land exactly once, and an edit made against an old
 * version of a record never silently overwrites someone else's newer change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny server: one table, rows with updated_at, and a switch to drop the connection
type Row = Record<string, unknown>;
const server = { rows: new Map<string, Row>(), down: false, failAfterCommit: false, calls: 0, clock: 0 };
const stamp = () => `2026-10-11T10:00:${String(++server.clock).padStart(2, '0')}Z`;
function query(table: string) {
  let mode: 'select' | 'update' | 'upsert' = 'select';
  let patch: Row = {};
  let filt: Row = {};
  let payload: Row | null = null;
  const q = {
    select: () => q,
    update: (p: Row) => { mode = 'update'; patch = p; return q; },
    upsert: (r: Row) => { mode = 'upsert'; payload = r; return q; },
    match: (m: Row) => { filt = { ...filt, ...m }; return q; },
    eq: (k: string, v: unknown) => { filt = { ...filt, [k]: v }; return q; },
    then: (ok: (v: { data: unknown; error: { message: string } | null }) => unknown) => Promise.resolve().then(() => {
      server.calls++;
      if (server.down) return ok({ data: null, error: { message: 'Failed to fetch' } });
      const hit = [...server.rows.values()].filter((r) => r.table === table && Object.entries(filt).every(([k, v]) => r[k] === v));
      if (mode === 'upsert') {
        if (!server.rows.has(String(payload!.id))) server.rows.set(String(payload!.id), { ...payload!, table, updated_at: stamp() });
        return ok({ data: null, error: null });
      }
      if (mode === 'update') {
        hit.forEach((r) => Object.assign(r, patch, { updated_at: stamp() }));
        if (server.failAfterCommit) { server.failAfterCommit = false; return ok({ data: null, error: { message: 'network request failed' } }); }
        return ok({ data: hit.map((r) => ({ ...r })), error: null });
      }
      return ok({ data: hit.map((r) => ({ ...r })), error: null });
    })
  };
  return q;
}
vi.mock('../supabase', () => ({ supabase: { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) } }));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
vi.stubGlobal('navigator', { onLine: true });

const { execute, flush, outboxItems, forceMine, _resetKnown } = await import('./outbox');

beforeEach(() => {
  server.rows.clear(); server.down = false; server.failAfterCommit = false; server.calls = 0; server.clock = 0;
  store.clear(); _resetKnown();
});

describe('UAT-06: offline, restart, reconnect: every write lands exactly once', () => {
  it('queues while offline, survives a restart (it is in storage), and replays once', async () => {
    server.down = true;
    const r = await execute([{ kind: 'insert', table: 'costs', row: { id: 'c1', amount_eur: 100 } }, { kind: 'insert', table: 'costs', row: { id: 'c2', amount_eur: 50 } }], 'Two bills');
    expect(r.queued).toBe(true);
    expect(outboxItems()).toHaveLength(2);
    server.down = false;
    // Replaying twice (two tabs, or a retry) still gives one row each
    await flush();
    await flush();
    expect([...server.rows.keys()].sort()).toEqual(['c1', 'c2']);
    expect(outboxItems()).toHaveLength(0);
  });
  it('a network drop half way keeps the rest queued, in order', async () => {
    server.rows.set('c1', { id: 'c1', table: 'costs', amount_eur: 1, updated_at: 'v0' });
    let n = 0;
    const realDown = Object.getOwnPropertyDescriptor(server, 'down')!;
    Object.defineProperty(server, 'down', { get: () => n++ >= 1, configurable: true });
    const r = await execute([{ kind: 'insert', table: 'costs', row: { id: 'c9', amount_eur: 5 } }, { kind: 'insert', table: 'costs', row: { id: 'c10', amount_eur: 6 } }], 'Bills');
    Object.defineProperty(server, 'down', realDown);
    server.down = false;
    expect(r.queued).toBe(true);
    expect(outboxItems().map((q) => (q.op as { row: Row }).row.id)).toEqual(['c10']);
    await flush();
    expect(server.rows.has('c10')).toBe(true);
  });
  it('an edit that landed but whose reply was lost is not flagged as a conflict on retry', async () => {
    server.rows.set('j1', { id: 'j1', table: 'jobs', title: 'Book vet', updated_at: 'v0' });
    server.failAfterCommit = true;
    const r = await execute([{ kind: 'update', table: 'jobs', match: { id: 'j1' }, patch: { title: 'Book vet for TB' }, ifUpdatedAt: 'v0' }], 'Job');
    expect(r.queued).toBe(true);
    const res = await flush();
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(server.rows.get('j1')!.title).toBe('Book vet for TB');
  });
  it('two offline edits to the same record both land (the second against the new version)', async () => {
    server.rows.set('g1', { id: 'g1', table: 'animal_groups', breed: null, housed: true, updated_at: 'v0' });
    server.down = true;
    await execute([{ kind: 'update', table: 'animal_groups', match: { id: 'g1' }, patch: { breed: 'Angus' }, ifUpdatedAt: 'v0' }], 'Breed');
    await execute([{ kind: 'update', table: 'animal_groups', match: { id: 'g1' }, patch: { housed: false }, ifUpdatedAt: 'v0' }], 'Housed');
    server.down = false;
    expect(await flush()).toEqual({ sent: 2, failed: 0 });
    expect(server.rows.get('g1')).toMatchObject({ breed: 'Angus', housed: false });
  });
});

describe('UAT-07: the same record changed on two phones', () => {
  it("phone B's offline edit does not overwrite phone A's newer change; the farmer chooses", async () => {
    server.rows.set('c1', { id: 'c1', table: 'costs', amount_eur: 600, updated_at: 'v0' });
    // Phone B goes offline and edits from version v0
    server.down = true;
    await execute([{ kind: 'update', table: 'costs', match: { id: 'c1' }, patch: { amount_eur: 640 }, ifUpdatedAt: 'v0' }], 'Bill changed');
    // Meanwhile phone A changes it online
    server.down = false;
    Object.assign(server.rows.get('c1')!, { amount_eur: 685, updated_at: 'vA' });
    // B reconnects: kept apart as a conflict, A's change stays
    expect(await flush()).toEqual({ sent: 0, failed: 1 });
    expect(server.rows.get('c1')!.amount_eur).toBe(685);
    const q = outboxItems()[0];
    expect(q.conflict).toBe(true);
    expect(q.lastError).toMatch(/another phone/);
    // "Use mine" applies B's edit over it
    await forceMine(q.id);
    expect(server.rows.get('c1')!.amount_eur).toBe(640);
    expect(outboxItems()).toHaveLength(0);
  });
  it('online, a stale edit is refused straight away with a clear message', async () => {
    server.rows.set('c1', { id: 'c1', table: 'costs', amount_eur: 600, updated_at: 'vA' });
    await expect(execute([{ kind: 'update', table: 'costs', match: { id: 'c1' }, patch: { amount_eur: 1 }, ifUpdatedAt: 'v0' }], 'x')).rejects.toThrow(/another phone/);
    expect(server.rows.get('c1')!.amount_eur).toBe(600);
  });
  it('an edit to a record removed elsewhere says so', async () => {
    await expect(execute([{ kind: 'update', table: 'costs', match: { id: 'gone' }, patch: { amount_eur: 1 }, ifUpdatedAt: 'v0' }], 'x')).rejects.toThrow(/Removed/);
  });
});
