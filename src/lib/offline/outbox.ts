/**
 * Offline-first writes. Farmers record in the yard and in sheds with no signal.
 * Every write carries a client-generated id, so replaying it after reconnecting
 * is idempotent (RPCs return early; inserts upsert with ignoreDuplicates).
 */
import { supabase } from '../supabase';
import { IS_DEMO } from '../env';

export type Op =
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }
  | { kind: 'insert'; table: string; row: Record<string, unknown> }
  | { kind: 'upsert'; table: string; row: Record<string, unknown>; onConflict: string }
  | { kind: 'update'; table: string; match: Record<string, unknown>; patch: Record<string, unknown> }
  | { kind: 'delete'; table: string; match: Record<string, unknown> };

export interface Queued {
  id: string;
  op: Op;
  label: string;
  createdAt: string;
  lastError?: string;
}

const KEY = 'agri-it:outbox';
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
    case 'update':
      res = await supabase.from(op.table).update(op.patch).match(op.match);
      break;
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
  if (!IS_DEMO && typeof navigator !== 'undefined' && !navigator.onLine) {
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
        write(read().map((q) => (q.id === item.id ? { ...q, lastError: (e as Error).message } : q)));
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

export function retryFailed() {
  write(read().map((q) => ({ ...q, lastError: undefined })));
  return flush();
}
