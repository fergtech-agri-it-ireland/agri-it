/**
 * "Move my phone data to my account" (online build).
 *
 * The phone app's backup (Settings > Kept on this phone > Back up) is the whole in-browser
 * database: { app: 'agri-it', kind: 'phone-backup', v, saved_at, db: { table: rows[] } }.
 * This module turns it into a plan for one farm in the online account:
 *
 * - every record keeps its own id, dates and paid/owed state, so running it twice adds nothing
 *   (the server inserts with ON CONFLICT DO NOTHING);
 * - farm_id is changed to the online farm, and photo paths move to that farm's folder;
 * - shared reference data (evidence sources, Teagasc allowances, the supplier directory and its
 *   branches) is left out: the server has its own copy with the same ids;
 * - who-did-what (members, the on-phone change history) and forecast snapshots are left out:
 *   the account has its own people, and the server writes its own history as rows arrive.
 *
 * Pure: no browser or network, so it is unit tested with a real backup from `build:phone`.
 * The server side is public.import_phone_backup (migration 20261011000400_online.sql).
 */

import { groupBreeds } from './farmTypes';

export type Row = Record<string, unknown>;

export interface PhoneBackup {
  app: 'agri-it';
  kind: 'phone-backup';
  v: number;
  saved_at?: string;
  db: Record<string, Row[]>;
}

/** Tables copied, in the order the server inserts them (parents before children). */
export const IMPORT_ORDER = [
  'suppliers', 'farm_supplier_settings',
  'animal_groups', 'head_count_history', 'crops', 'documents',
  'feed_products', 'feed_transactions', 'feeding_rules', 'feed_use_logs',
  'silage_stores', 'routines',
  // Before costs: a loan repayment points at its loan (16 Oct 2026)
  'loans', 'loan_statements',
  'income', 'costs', 'expected_income', 'routine_completions',
  'budget_lines', 'farm_records', 'jobs',
  'calving_seasons', 'calf_births', 'suggestion_decisions',
  // After costs: a fertiliser delivery points at its bill
  'fields', 'fertiliser_products', 'fertiliser_stock', 'fertiliser_spreads', 'fertiliser_spread_fields',
  // After the animal groups they point at (21 Oct 2026)
  'year_end_values'
] as const;
export type ImportTable = (typeof IMPORT_ORDER)[number];

/** Farm settings that come from the phone. Name, county and Eircode stay as set online. */
export const FARM_SETTINGS = [
  'enterprises', 'enterprise', 'financial_year_start_month', 'opening_cash_eur', 'opening_cash_date',
  'default_lead_time_days', 'forage_reserve_percent', 'housing_start', 'turnout_date',
  'feed_target_days', 'bill_warning_days', 'order_warning_days',
  'herd_number', 'acres_owned', 'acres_rented', 'vat_status', 'accountant_name', 'accountant_contact', 'milk_buyer', 'setup'
] as const;

/** Friendly names for the summary before the farmer confirms. */
export const TABLE_LABEL: Record<ImportTable, string> = {
  suppliers: 'suppliers you added', farm_supplier_settings: 'supplier settings and "my rep"',
  animal_groups: 'animal groups', head_count_history: 'head count changes', crops: 'crops', documents: 'photos and documents',
  feed_products: 'feeds', feed_transactions: 'feed deliveries, orders and counts', feeding_rules: 'feeding plans', feed_use_logs: 'ticked-off feeding',
  silage_stores: 'silage and bales', routines: 'routines', income: 'income', costs: 'bills and costs', routine_completions: 'ticked-off routines',
  budget_lines: 'budget lines', farm_records: 'records', jobs: 'jobs',
  calving_seasons: 'calving seasons', calf_births: 'calves born', suggestion_decisions: 'answers to suggestions',
  fields: 'fields', fertiliser_products: 'fertilisers', fertiliser_stock: 'fertiliser orders, deliveries and stock checks',
  fertiliser_spreads: 'spreading', fertiliser_spread_fields: 'spreading by field',
  loans: 'loans, hire purchase and overdrafts', loan_statements: 'loan statements', expected_income: 'scheme payments expected',
  year_end_values: 'year-end values'
};

export interface ImportPlan {
  phoneFarmId: string;
  phoneFarmName: string;
  /** The phone farm as it was, for creating a new online farm from it. */
  phoneFarm: Row;
  farmId: string;
  farm: Row;
  rows: Record<ImportTable, Row[]>;
  counts: Partial<Record<ImportTable, number>>;
  total: number;
  /** Old photo path to new photo path, for copying photos still kept in this browser. */
  photoPaths: { from: string; to: string }[];
}

/** Read and check a backup file or pasted text. Throws a message the farmer can act on. */
export function parseBackup(text: string): PhoneBackup {
  let p: unknown;
  try { p = JSON.parse(text.trim()); } catch {
    throw new Error('That is not a complete Agri-It backup. Copy all of it, or pick the backup file, and try again.');
  }
  const b = p as Partial<PhoneBackup>;
  if (!b || b.app !== 'agri-it' || b.kind !== 'phone-backup' || !b.db || typeof b.db !== 'object' || !Array.isArray(b.db.farms)) {
    throw new Error('That file is not an Agri-It phone backup. In the phone app, open Settings, then Kept on this phone, then Back up.');
  }
  return b as PhoneBackup;
}

/** The farms in a backup (usually one). */
export function backupFarms(b: PhoneBackup): { id: string; name: string }[] {
  return (b.db.farms ?? []).map((f) => ({ id: String(f.id), name: String(f.name ?? 'Farm') }));
}

const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Build the plan. `farmId` is the online farm the records go into. If the backup holds more
 * than one farm, `phoneFarmId` says which.
 */
export function planPhoneImport(b: PhoneBackup, farmId: string, phoneFarmId?: string): ImportPlan {
  const farms = b.db.farms ?? [];
  if (!farms.length) throw new Error('This backup has no farm in it yet.');
  const phoneFarm = phoneFarmId ? farms.find((f) => f.id === phoneFarmId) : farms[0];
  if (!phoneFarm) throw new Error('That farm is not in this backup.');
  if (farms.length > 1 && !phoneFarmId) throw new Error('This backup holds more than one farm. Pick which one to move.');
  const from = String(phoneFarm.id);

  const farm: Row = {};
  for (const k of FARM_SETTINGS) if (k in phoneFarm && phoneFarm[k] !== undefined) farm[k] = phoneFarm[k];

  const ofFarm = (r: Row) => r.farm_id === from;
  const rows = {} as Record<ImportTable, Row[]>;
  const counts: Partial<Record<ImportTable, number>> = {};
  const photoPaths: { from: string; to: string }[] = [];

  for (const t of IMPORT_ORDER) {
    let src = (b.db[t] ?? []).filter((r) => r && typeof r === 'object');
    // Only this farm's rows: the shared supplier directory (farm_id null) is already online
    src = src.filter(ofFarm);
    // Rows without a proper id can't be matched on a second run, so they are not copied
    if (t !== 'farm_supplier_settings') src = src.filter((r) => isUuid(r.id));

    let out = src.map((r) => {
      const x: Row = { ...r };
      x.farm_id = farmId;
      if (t === 'documents' && typeof x.storage_path === 'string') {
        const to = x.storage_path.startsWith(`${from}/`) ? `${farmId}/${x.storage_path.slice(from.length + 1)}` : `${farmId}/${x.storage_path.split('/').pop()}`;
        photoPaths.push({ from: x.storage_path, to });
        x.storage_path = to;
      }
      // Older phone records have no payment fields: they were paid on the day (as on the phone)
      if (t === 'costs' && !x.payment_status) x.payment_status = 'paid';
      // Groups saved before breeds were a list (14 Oct 2026): a single breed becomes a list of one
      if (t === 'animal_groups' && !Array.isArray(x.breeds)) x.breeds = groupBreeds(x as { breed?: string | null });
      return x;
    });
    // Orders before the deliveries that point at them
    if (t === 'feed_transactions') out = [...out.filter((r) => r.txn_type === 'order'), ...out.filter((r) => r.txn_type !== 'order')];
    if (t === 'fertiliser_stock') out = [...out.filter((r) => r.kind === 'order'), ...out.filter((r) => r.kind !== 'order')];
    rows[t] = out;
    if (out.length) counts[t] = out.length;
  }
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  return { phoneFarmId: from, phoneFarmName: String(phoneFarm.name ?? 'Farm'), phoneFarm, farmId, farm, rows, counts, total, photoPaths };
}

/** Split a plan into calls of a sensible size, keeping the table order. Safe because each call is idempotent. */
export function chunkPlan(plan: ImportPlan, maxRows = 1500): Partial<Record<ImportTable, Row[]>>[] {
  const out: Partial<Record<ImportTable, Row[]>>[] = [];
  let cur: Partial<Record<ImportTable, Row[]>> = {};
  let n = 0;
  for (const t of IMPORT_ORDER) {
    for (const r of plan.rows[t]) {
      if (n >= maxRows) { out.push(cur); cur = {}; n = 0; }
      (cur[t] ??= []).push(r);
      n++;
    }
  }
  if (n) out.push(cur);
  return out;
}

export interface ImportResult { added: number; already: number; blocked: number; failed: number; firstError: string | null }

/** Add up what the server said for each call. */
export function sumResults(rs: ImportResult[]): ImportResult {
  return rs.reduce((a, r) => ({
    added: a.added + r.added, already: a.already + r.already, blocked: a.blocked + r.blocked, failed: a.failed + r.failed,
    firstError: a.firstError ?? r.firstError
  }), { added: 0, already: 0, blocked: 0, failed: 0, firstError: null });
}

/** One line for the farmer after the move. */
export function resultLine(r: ImportResult): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} record${r.added === 1 ? '' : 's'} moved`);
  if (r.already) parts.push(`${r.already} already here`);
  if (!parts.length) parts.push('Nothing new to move');
  let s = parts.join(', ') + '.';
  if (r.blocked) s += ` ${r.blocked} ${r.blocked === 1 ? 'belongs' : 'belong'} to another farm in Agri-It and were left alone.`;
  if (r.failed) s += ` ${r.failed} could not be moved${r.firstError ? ` (${r.firstError})` : ''}.`;
  return s;
}
