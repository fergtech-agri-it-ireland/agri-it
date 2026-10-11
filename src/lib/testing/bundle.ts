/**
 * Tests: a FarmBundle straight from the in-browser database (the same tables the app reads),
 * so end-to-end checks run the real RPC mirrors and the real forecast engines together.
 */
import type { FarmBundle } from '../types';
import { normalizeBundle } from '../data/farm';

type Row = Record<string, unknown>;
export function bundleFrom(db: Record<string, Row[]>, farmId: string): FarmBundle {
  const mine = (t: string) => (db[t] ?? []).filter((r) => r.farm_id === farmId);
  const b = {
    farm: (db.farms ?? []).find((f) => f.id === farmId),
    groups: mine('animal_groups'), crops: mine('crops'),
    suppliers: (db.suppliers ?? []).filter((s) => s.farm_id === null || s.farm_id === farmId),
    branches: db.supplier_branches ?? [], supplierSettings: mine('farm_supplier_settings'),
    products: mine('feed_products'), txns: mine('feed_transactions'), rules: mine('feeding_rules'), silage: mine('silage_stores'),
    benchmarks: db.forage_benchmarks ?? [], evidence: db.evidence_sources ?? [],
    income: mine('income'), costs: mine('costs'), budget: mine('budget_lines'), records: mine('farm_records'), documents: mine('documents'),
    jobs: mine('jobs'), routines: mine('routines'), completions: mine('routine_completions'), feedLogs: mine('feed_use_logs'),
    headHistory: mine('head_count_history'), role: 'owner'
  };
  return normalizeBundle(JSON.parse(JSON.stringify(b)) as FarmBundle);
}
