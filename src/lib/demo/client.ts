/**
 * In-browser stand-in for the Supabase client, used by the two one-file builds:
 *
 * - demo: a sample farm. Changes are kept in this browser; Reset restores the seed.
 * - phone (IS_LOCAL): the farmer's own farm, starting from reference data only. Every
 *   record is kept in this phone's browser storage and photos in IndexedDB. There is
 *   no server, so nothing leaves the phone.
 *
 * Implements only the parts of the client the app uses, and mirrors the SQL functions
 * in supabase/migrations so screens behave identically.
 */
import { buildReference, buildSeed, DEFAULTS, DEMO_USER, type DB, type Row } from './seed';
import { todayISO } from '../format';
import { IS_LOCAL } from '../env';

const DB_KEY = IS_LOCAL ? 'agri-it:phone-db' : 'agri-it:demo-db';
const SIGNED_OUT_KEY = 'agri-it:demo-signed-out';
// Demo: bump when the seed's shape changes so stored demo data is rebuilt.
// Phone: the farmer's own records. NEVER thrown away on a version change; migrate instead.
const VERSION = IS_LOCAL ? 1 : 4;
const LOCAL_USER = { id: '20000000-0000-0000-0000-0000000000aa', email: 'This phone' };
const USER = IS_LOCAL ? LOCAL_USER : DEMO_USER;
const fresh = (): DB => (IS_LOCAL ? buildReference() : buildSeed());

function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function load(): DB {
  try {
    const raw = store()?.getItem(DB_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { v: number; db: DB };
      if (p.v === VERSION || IS_LOCAL) return p.db;
    }
    // Older demo data: drop it and the app cache built from it, so nothing stale is shown.
    if (raw) { store()?.removeItem('agri-it:cache'); store()?.removeItem('agri-it:outbox'); }
  } catch { /* fall through to a fresh seed */ }
  return fresh();
}
let db: DB = load();
/** False when this browser refused to keep the last change (blocked or full storage). */
export let browserKeepsData = true;
function persist() {
  try {
    const s = store();
    if (!s) throw new Error('no storage');
    s.setItem(DB_KEY, JSON.stringify({ v: VERSION, db }));
    browserKeepsData = true;
  } catch {
    browserKeepsData = false; // keeps working in memory for this visit
  }
}
// The phone build writes the empty farm straight away, so a blocked browser shows up at once
if (IS_LOCAL) persist();

/** Wipe changes and the cached app data, then reload (demo: the sample farm; phone: an empty start). */
export function resetDemo() {
  db = fresh();
  try {
    const s = store();
    s?.removeItem(DB_KEY);
    s?.removeItem('agri-it:cache');
    s?.removeItem('agri-it:outbox');
    s?.removeItem('agri-it:farm');
    s?.removeItem(SIGNED_OUT_KEY);
  } catch { /* ignore */ }
  try { window.sessionStorage.removeItem('agri-it:snapshots'); } catch { /* ignore */ }
  try { window.indexedDB.deleteDatabase(FILES_DB); } catch { /* ignore */ }
  window.location.hash = '#/';
  window.location.reload();
}

/** Phone build: everything needed to rebuild this farm on another phone (records, not photos). */
export function backupJson(): string {
  return JSON.stringify({ app: 'agri-it', kind: 'phone-backup', v: VERSION, saved_at: new Date().toISOString(), db });
}
/** Phone build: replace this phone's records with a backup file, then reload. Throws if the file is not a backup. */
export function restoreBackup(text: string) {
  const p = JSON.parse(text) as { app?: string; kind?: string; db?: DB };
  if (p.app !== 'agri-it' || p.kind !== 'phone-backup' || !p.db || !Array.isArray(p.db.farms)) {
    throw new Error('That file is not an Agri-It backup.');
  }
  db = p.db;
  persist();
  if (!browserKeepsData) throw new Error('This browser would not keep the restored records.');
  try {
    const s = store();
    s?.removeItem('agri-it:cache');
    s?.removeItem('agri-it:outbox');
    s?.removeItem('agri-it:farm');
  } catch { /* ignore */ }
  window.location.hash = '#/';
  window.location.reload();
}
/** Rough size of what this phone holds, for the Settings card. */
export function localSummary() {
  const count = (t: string) => (db[t] ?? []).length;
  return {
    farms: count('farms'),
    records: ['feed_products', 'feed_transactions', 'income', 'costs', 'farm_records', 'jobs', 'silage_stores', 'animal_groups', 'routine_completions'].reduce((a, t) => a + count(t), 0),
    photos: count('documents')
  };
}

// ---------------------------------------------------------------------------
// Photos and files: IndexedDB on the phone build (too big for localStorage),
// memory only in the demo.
// ---------------------------------------------------------------------------
const FILES_DB = 'agri-it-files';
function filesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(FILES_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function fileOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await filesDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction('files', mode).objectStore('files'));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}
const fileUrls = new Map<string, string>();
async function keepFile(path: string, file: Blob) {
  fileUrls.set(path, URL.createObjectURL(file));
  if (IS_LOCAL) {
    try { await fileOp('readwrite', (s) => s.put(file, path)); } catch { /* kept for this visit only */ }
  }
}
async function fileUrl(path: string): Promise<string | null> {
  if (fileUrls.has(path)) return fileUrls.get(path)!;
  if (!IS_LOCAL) return null;
  try {
    const blob = await fileOp<Blob | undefined>('readonly', (s) => s.get(path));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    fileUrls.set(path, url);
    return url;
  } catch { return null; }
}

const uuid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
const ok = <T>(data: T) => ({ data, error: null as null | { message: string } });
const fail = (message: string) => ({ data: null, error: { message } });
const table = (t: string) => (db[t] ??= []);
function withDefaults(t: string, r: Row): Row {
  const base: Row = { ...(DEFAULTS[t]?.() ?? {}) };
  if (!('id' in r) && t !== 'farm_supplier_settings' && t !== 'farm_members') base.id = uuid();
  if (t !== 'forecast_snapshots') base.created_at = nowISO();
  return { ...base, ...r };
}
/** ON DELETE CASCADE / SET NULL rules the app relies on. */
function cascade(t: string, removed: Row[]) {
  const ids = new Set(removed.map((r) => r.id));
  if (!ids.size) return;
  if (t === 'feed_transactions') {
    db.costs = table('costs').filter((c) => !ids.has(c.feed_transaction_id));
    for (const x of table('feed_transactions')) if (ids.has(x.linked_order_id)) x.linked_order_id = null;
  }
  if (t === 'feed_products') {
    const tx = table('feed_transactions').filter((x) => ids.has(x.feed_product_id));
    db.feed_transactions = table('feed_transactions').filter((x) => !ids.has(x.feed_product_id));
    const rules = table('feeding_rules').filter((x) => ids.has(x.feed_product_id));
    db.feeding_rules = table('feeding_rules').filter((x) => !ids.has(x.feed_product_id));
    cascade('feed_transactions', tx);
    cascade('feeding_rules', rules);
    const rt = table('routines').filter((x) => ids.has(x.feed_product_id));
    db.routines = table('routines').filter((x) => !ids.has(x.feed_product_id));
    cascade('routines', rt);
  }
  if (t === 'feeding_rules') db.feed_use_logs = table('feed_use_logs').filter((x) => !ids.has(x.feeding_rule_id));
  if (t === 'routines') db.routine_completions = table('routine_completions').filter((x) => !ids.has(x.routine_id));
  if (t === 'silage_stores') {
    const rt = table('routines').filter((x) => ids.has(x.silage_store_id));
    db.routines = table('routines').filter((x) => !ids.has(x.silage_store_id));
    cascade('routines', rt);
  }
  if (t === 'animal_groups') {
    const rules = table('feeding_rules').filter((x) => ids.has(x.animal_group_id));
    db.feeding_rules = table('feeding_rules').filter((x) => !ids.has(x.animal_group_id));
    cascade('feeding_rules', rules);
    for (const x of table('income')) if (ids.has(x.animal_group_id)) x.animal_group_id = null;
  }
  if (t === 'documents') {
    for (const k of ['feed_transactions', 'income', 'costs', 'farm_records']) for (const x of table(k)) if (ids.has(x.document_id)) x.document_id = null;
  }
}

// ---------------------------------------------------------------------------
// Query builder: the subset of PostgREST the app uses
// ---------------------------------------------------------------------------
type Filter = (r: Row) => boolean;
type Mode = 'select' | 'insert' | 'upsert' | 'update' | 'delete';

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private one = false;
  private mode: Mode = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private conflict: string[] = ['id'];
  private ignoreDup = false;
  constructor(private t: string) {}

  select() { return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  gte(col: string, v: unknown) { this.filters.push((r) => String(r[col] ?? '') >= String(v)); return this; }
  match(m: Row) { for (const [k, v] of Object.entries(m)) this.eq(k, v); return this; }
  or(expr: string) {
    const parts = expr.split(',').map((p) => p.split('.'));
    this.filters.push((r) => parts.some(([col, op, ...rest]) => {
      const v = rest.join('.');
      if (op === 'is' && v === 'null') return r[col] === null || r[col] === undefined;
      if (op === 'eq') return String(r[col]) === v;
      return false;
    }));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.one = true; return this; }
  insert(rows: Row | Row[]) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.mode = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = (opts?.onConflict ?? 'id').split(',').map((s) => s.trim());
    this.ignoreDup = !!opts?.ignoreDuplicates;
    return this;
  }
  update(p: Row) { this.mode = 'update'; this.patch = p; return this; }
  delete() { this.mode = 'delete'; return this; }

  private run() {
    const rows = table(this.t);
    const hit = (r: Row) => this.filters.every((f) => f(r));
    switch (this.mode) {
      case 'insert': {
        const added = this.payload.map((r) => withDefaults(this.t, r));
        rows.push(...added);
        persist();
        return ok(added);
      }
      case 'upsert': {
        const out: Row[] = [];
        for (const r of this.payload) {
          const existing = rows.find((x) => this.conflict.every((k) => r[k] !== undefined && x[k] === r[k]));
          if (existing) {
            if (!this.ignoreDup) Object.assign(existing, r);
            out.push(existing);
          } else {
            const added = withDefaults(this.t, r);
            rows.push(added);
            out.push(added);
          }
        }
        persist();
        return ok(out);
      }
      case 'update': {
        const changed = rows.filter(hit);
        changed.forEach((r) => Object.assign(r, this.patch));
        persist();
        return ok(changed);
      }
      case 'delete': {
        const removed = rows.filter(hit);
        db[this.t] = rows.filter((r) => !hit(r));
        cascade(this.t, removed);
        persist();
        return ok(removed);
      }
      default: {
        let out = rows.filter(hit).map((r) => ({ ...r }));
        if (this.orders.length) {
          out.sort((a, b) => {
            for (const o of this.orders) {
              const [x, y] = [a[o.col], b[o.col]];
              if (x === y) continue;
              if (x === null || x === undefined) return 1;
              if (y === null || y === undefined) return -1;
              const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
              return o.asc ? c : -c;
            }
            return 0;
          });
        }
        if (this.lim !== null) out = out.slice(0, this.lim);
        if (this.one) return out.length === 1 ? ok(out[0]) : fail(out.length ? 'More than one row returned' : 'Row not found');
        return ok(out);
      }
    }
  }

  then<A = { data: unknown; error: { message: string } | null }, B = never>(
    onFulfilled?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onRejected?: ((e: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(onFulfilled, onRejected);
  }
}

// ---------------------------------------------------------------------------
// RPCs: same behaviour as supabase/migrations/20260929000200_security_and_functions.sql
// ---------------------------------------------------------------------------
type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const find = (t: string, id: unknown) => table(t).find((r) => r.id === id);

function setHeadCount(groupId: string, heads: number, reason = 'manual', effectiveOn = todayISO()) {
  if (heads < 0) throw new Error('Head count cannot be negative');
  const g = find('animal_groups', groupId);
  if (!g) throw new Error('Group not found');
  g.head_count = heads;
  g.head_count_updated_at = nowISO();
  table('head_count_history').push(withDefaults('head_count_history', { farm_id: g.farm_id, animal_group_id: groupId, head_count: heads, effective_on: effectiveOn, reason }));
}

const rpcs: Record<string, (a: Args) => unknown> = {
  create_farm: (a) => {
    const id = uuid();
    table('farms').push({ ...DEFAULTS.farms(), id, name: String(a.p_name).trim(), county: a.p_county, eircode: a.p_eircode ? String(a.p_eircode).trim().toUpperCase() : null, jurisdiction: a.p_jurisdiction ?? 'ROI', enterprise: a.p_enterprise ?? 'dairy', default_lead_time_days: a.p_default_lead_time_days ?? null, created_by: USER.id, created_at: nowISO(), updated_at: nowISO() });
    table('farm_members').push({ farm_id: id, user_id: USER.id, role: 'owner', added_at: nowISO() });
    return id;
  },
  record_feed_delivery: (a) => {
    if (find('feed_transactions', a.p_id)) return a.p_id;
    const qty = Number(a.p_quantity_kg);
    if (!qty || qty <= 0) throw new Error('Quantity must be more than zero');
    let total: number | null = a.p_total_price_eur ?? null;
    let ppt: number | null = a.p_price_per_tonne_eur ?? null;
    if (total === null && ppt !== null) total = Math.round(ppt * qty / 10) / 100;
    if (ppt === null && total !== null) ppt = Math.round((total / (qty / 1000)) * 100) / 100;
    table('feed_transactions').push(withDefaults('feed_transactions', {
      id: a.p_id, farm_id: a.p_farm_id, feed_product_id: a.p_feed_product_id, txn_type: 'delivery', quantity_kg: qty,
      order_date: a.p_order_date ?? null, delivery_date: a.p_delivery_date, effective_on: a.p_delivery_date, supplier_id: a.p_supplier_id ?? null,
      total_price_eur: total, price_per_tonne_eur: ppt, evidence: a.p_evidence ?? 'confirmed_docket', linked_order_id: a.p_linked_order_id ?? null,
      document_id: a.p_document_id ?? null, notes: a.p_notes ?? null
    }));
    if (a.p_linked_order_id) {
      const o = find('feed_transactions', a.p_linked_order_id);
      if (o && o.txn_type === 'order') o.order_status = 'delivered';
    }
    if (total !== null && total > 0) {
      const product = find('feed_products', a.p_feed_product_id);
      const supplier = find('suppliers', a.p_supplier_id);
      table('costs').push(withDefaults('costs', {
        farm_id: a.p_farm_id, category: 'feed', occurred_on: a.p_delivery_date, amount_eur: total, supplier_id: a.p_supplier_id ?? null,
        supplier_name: supplier?.name ?? null, feed_transaction_id: a.p_id, description: `${product?.name ?? 'Feed'} ${Math.round(qty / 10) / 100} t`, document_id: a.p_document_id ?? null
      }));
    }
    if (a.p_supplier_id) {
      const s = table('farm_supplier_settings').find((x) => x.farm_id === a.p_farm_id && x.supplier_id === a.p_supplier_id);
      if (s) s.last_used_at = nowISO();
      else table('farm_supplier_settings').push({ ...DEFAULTS.farm_supplier_settings(), farm_id: a.p_farm_id, supplier_id: a.p_supplier_id, last_used_at: nowISO() });
      const p = find('feed_products', a.p_feed_product_id);
      if (p && !p.supplier_id) p.supplier_id = a.p_supplier_id;
    }
    return a.p_id;
  },
  undo_feed_delivery: (a) => {
    const t = find('feed_transactions', a.p_id);
    if (!t || t.txn_type !== 'delivery') return null;
    db.feed_transactions = table('feed_transactions').filter((x) => x !== t);
    cascade('feed_transactions', [t]);
    if (t.linked_order_id) { const o = find('feed_transactions', t.linked_order_id); if (o) o.order_status = 'open'; }
    return null;
  },
  set_head_count: (a) => { setHeadCount(a.p_group_id, Number(a.p_head_count), a.p_reason ?? 'manual', a.p_effective_on ?? todayISO()); return null; },
  record_animal_sale: (a) => {
    if (find('income', a.p_id)) return a.p_id;
    const n = Number(a.p_head_count);
    if (!n || n <= 0) throw new Error('Enter how many were sold');
    const g = table('animal_groups').find((x) => x.id === a.p_group_id && x.farm_id === a.p_farm_id);
    if (!g) throw new Error('Group not found');
    table('income').push(withDefaults('income', {
      id: a.p_id, farm_id: a.p_farm_id, income_type: 'livestock', occurred_on: a.p_occurred_on, amount_eur: a.p_amount_eur,
      counterparty: a.p_counterparty ?? null, animal_group_id: a.p_group_id, head_count: n, description: `${n} sold from ${g.name}`
    }));
    if (a.p_reduce_group !== false) setHeadCount(a.p_group_id, Math.max(0, Number(g.head_count) - n), 'sale', a.p_occurred_on);
    return a.p_id;
  },
  undo_animal_sale: (a) => {
    const i = table('income').find((x) => x.id === a.p_income_id && x.income_type === 'livestock');
    db.income = table('income').filter((x) => x.id !== a.p_income_id);
    if (i?.animal_group_id && i.head_count) {
      const g = find('animal_groups', i.animal_group_id);
      if (g) setHeadCount(String(g.id), Number(g.head_count) + Number(i.head_count), 'sale undone');
    }
    return null;
  }
};

// ---------------------------------------------------------------------------
// Auth and storage
// ---------------------------------------------------------------------------
type AuthCb = (event: string, session: unknown) => void;
const listeners = new Set<AuthCb>();
function makeSession() {
  return { access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, user: { id: USER.id, email: USER.email, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: nowISO() } };
}
let signedOut = false;
try { signedOut = !IS_LOCAL && store()?.getItem(SIGNED_OUT_KEY) === '1'; } catch { /* ignore */ }
let session: ReturnType<typeof makeSession> | null = signedOut ? null : makeSession();
function setSession(s: typeof session, event: string) {
  session = s;
  try { s ? store()?.removeItem(SIGNED_OUT_KEY) : store()?.setItem(SIGNED_OUT_KEY, '1'); } catch { /* ignore */ }
  listeners.forEach((cb) => cb(event, s));
}

export function createDemoClient() {
  return {
    from: (t: string) => new Query(t),
    rpc: async (fn: string, args: Args = {}) => {
      const impl = rpcs[fn];
      if (!impl) return fail(`Unknown function ${fn}`);
      try {
        const data = impl(args);
        persist();
        return ok(data);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
    auth: {
      getSession: async () => ok({ session }),
      onAuthStateChange: (cb: AuthCb) => {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      signInWithPassword: async () => { const s = makeSession(); setSession(s, 'SIGNED_IN'); return ok({ session: s, user: s.user }); },
      signUp: async () => { const s = makeSession(); setSession(s, 'SIGNED_IN'); return ok({ session: s, user: s.user }); },
      signOut: async () => { if (!IS_LOCAL) setSession(null, 'SIGNED_OUT'); return { error: null }; }
    },
    storage: {
      from: () => ({
        upload: async (path: string, file: File) => { await keepFile(path, file); return ok({ path }); },
        createSignedUrl: async (path: string) => ok({ signedUrl: await fileUrl(path) })
      })
    }
  };
}
