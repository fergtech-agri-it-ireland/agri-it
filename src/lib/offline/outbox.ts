/**
 * Offline-first writes. Farmers record in the yard and in sheds with no signal.
 * Every write carries a client-generated id, so replaying it after reconnecting
 * is idempotent (RPCs return early; inserts upsert with ignoreDuplicates).
 *
 * Edits to an existing record carry the `updated_at` the farmer was looking at. If someone
 * changed the same record in the meantime (another phone, the office), the edit is not
 * applied over theirs: it waits in Sync as a conflict, and the farmer picks "keep theirs"
 * or "use mine". A retry of an edit that already landed is recognised and not flagged.
 */
import { supabase } from '../supabase';
import { IN_BROWSER, key } from '../env';

export type Op =
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }
  | { kind: 'insert'; table: string; row: Record<string, unknown> }
  | { kind: 'upsert'; table: string; row: Record<string, unknown>; onConflict: string }
  | { kind: 'update'; table: string; match: Record<string, unknown>; patch: Record<string, unknown>; ifUpdatedAt?: string }
  | { kind: 'delete'; table: string; match: Record<string, unknown> };

export interface Queued {
  id: string;
  op: Op;
  label: string;
  createdAt: string;
  lastError?: string;
  /** Someone else changed this record first: the farmer decides which version stays. */
  conflict?: boolean;
}

/** Thrown when an edit would overwrite a newer change made elsewhere. */
export class ConflictError extends Error {
  conflict = true;
  constructor(public removed = false) {
    super(removed
      ? 'Removed on another phone before this change could be saved.'
      : 'Changed on another phone since you opened it, so your change was not saved over theirs.');
  }
}

/**
 * updated_at values this phone has already moved on from, per record. A second offline edit
 * to the same record was made against the same (now stale) value as the first; once the first
 * lands, the second goes against the new value instead of flagging a false conflict.
 */
const known = new Map<string, { seen: Set<string>; latest: string }>();
const rowKey = (t: string, m: Record<string, unknown>) => `${t}:${JSON.stringify(m)}`;
export function _resetKnown() { known.clear(); }

const KEY = key('outbox');
type Listener = (q: Queued[]) => void;
const listeners = new Set<Listener>();

function read(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Queued[];
  } catch {
    return [];
  }
}
function write(q: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full: nothing more we can do offline */
  }
  listeners.forEach((l) => l(q));
}

export function subscribeOutbox(l: Listener): () => void {
  listeners.add(l);
  l(read());
  return () => listeners.delete(l);
}
export function outboxItems() {
  return read();
}
export function discard(id: string) {
  write(read().filter((q) => q.id !== id));
}

export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg);
}

async function run(op: Op): Promise<unknown> {
  let res: { data: unknown; error: { message: string } | null };
  switch (op.kind) {
    case 'rpc':
      res = await supabase.rpc(op.fn, op.args);
      break;
    case 'insert':
      res = await supabase.from(op.table).upsert(op.row, { onConflict: 'id', ignoreDuplicates: true });
      break;
    case 'upsert':
      res = await supabase.from(op.table).upsert(op.row, { onConflict: op.onConflict });
      break;
    case 'update': {
      if (!op.ifUpdatedAt) {
        res = await supabase.from(op.table).update(op.patch).match(op.match);
        break;
      }
      const key = rowKey(op.table, op.match);
      const k = known.get(key);
      const expect = k && k.seen.has(op.ifUpdatedAt) ? k.latest : op.ifUpdatedAt;
      res = await supabase.from(op.table).update(op.patch).match(op.match).eq('updated_at', expect).select('*');
      if (res.error) break;
      const rows = (res.data ?? []) as Record<string, unknown>[];
      if (rows.length) {
        const entry = known.get(key) ?? { seen: new Set<string>(), latest: '' };
        entry.seen.add(op.ifUpdatedAt); entry.seen.add(expect);
        entry.latest = String(rows[0].updated_at ?? expect);
        known.set(key, entry);
        break;
      }
      // Nothing matched: removed, changed by someone else, or our own earlier attempt already landed
      const now = await supabase.from(op.table).select('*').match(op.match);
      if (now.error) { res = now; break; }
      const cur = ((now.data ?? []) as Record<string, unknown>[])[0];
      if (!cur) throw new ConflictError(true);
      const same = Object.entries(op.patch).every(([f, v]) => JSON.stringify(cur[f] ?? null) === JSON.stringify(v ?? null) || Number(cur[f]) === Number(v));
      if (same) break; // our change is already there
      throw new ConflictError(false);
    }
    case 'delete':
      res = await supabase.from(op.table).delete().match(op.match);
      break;
  }
  if (res.error) {
    const err = new Error(res.error.message);
    if (isNetworkError(res.error)) (err as Error & { network?: boolean }).network = true;
    throw err;
  }
  return res.data;
}

/** Run now if we can; queue if offline. Server-side validation errors are thrown to the caller. */
export async function execute(ops: Op[], label: string): Promise<{ queued: boolean }> {
  if (!IN_BROWSER && typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueue(ops, label);
    return { queued: true };
  }
  for (let i = 0; i < ops.length; i++) {
    try {
      await run(ops[i]);
    } catch (e) {
      if ((e as { network?: boolean }).network || isNetworkError(e)) {
        enqueue(ops.slice(i), label);
        return { queued: true };
      }
      throw e;
    }
  }
  return { queued: false };
}

function enqueue(ops: Op[], label: string) {
  const q = read();
  ops.forEach((op, i) => q.push({ id: crypto.randomUUID(), op, label: ops.length > 1 ? `${label} (${i + 1}/${ops.length})` : label, createdAt: new Date().toISOString() }));
  write(q);
}

let flushing = false;
/** Replay queued writes in order. Stops at the first network failure. */
export async function flush(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const item of read()) {
      if (item.lastError) { failed++; continue; }
      try {
        await run(item.op);
        write(read().filter((q) => q.id !== item.id));
        sent++;
      } catch (e) {
        if ((e as { network?: boolean }).network || isNetworkError(e)) break;
        failed++;
        const conflict = e instanceof ConflictError;
        write(read().map((q) => (q.id === item.id ? { ...q, lastError: (e as Error).message, conflict } : q)));
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

export function retryFailed() {
  // Conflicts wait for the farmer's choice; anything else is tried again
  write(read().map((q) => (q.conflict ? q : { ...q, lastError: undefined })));
  return flush();
}

/** "Use mine": apply this edit over the other change. */
export function forceMine(id: string) {
  write(read().map((q) => (q.id === id && q.op.kind === 'update' ? { ...q, op: { ...q.op, ifUpdatedAt: undefined }, lastError: undefined, conflict: false } : q)));
  return flush();
}
