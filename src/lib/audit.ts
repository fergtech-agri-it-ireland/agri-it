/** Plain words for an audit trail entry: "Bill to Local vet changed: amount €600 → €685". */
import type { AuditEntry, FarmBundle } from './types';
import { COST_LABEL, INCOME_LABEL, type CostCategory, type IncomeType } from './types';
import { eur, fmtDay, fmtKg } from './format';

const THING: Record<string, string> = {
  costs: 'Cost', income: 'Income', feed_transactions: 'Feed', animal_groups: 'Animal group', feeding_rules: 'Feeding plan',
  documents: 'Document', farm_records: 'Record', budget_lines: 'Budget', jobs: 'Job', feed_products: 'Feed', silage_stores: 'Silage store', calving_seasons: 'Calving season', calf_births: 'Calf born'
};
const FIELD: Record<string, string> = {
  amount_eur: 'amount', occurred_on: 'date', paid_on: 'paid on', due_on: 'due', payment_status: 'paid or owed', invoice_ref: 'invoice no.',
  vat_eur: 'VAT', quantity_kg: 'quantity', head_count: 'head', kg_per_head_per_feed: 'kg per head', feeds_per_day: 'feeds a day',
  total_price_eur: 'price', price_per_tonne_eur: '€/t', order_status: 'order', evidence: 'checked against', state: 'confirmed', title: 'title',
  done_at: 'done', dismissed_at: 'taken off the list', archived: 'archived', name: 'name', supplier_name: 'paid to', category: 'category',
  end_date: 'ends', start_date: 'starts', document_id: 'photo', enterprise: 'enterprise', description: 'note'
};
const SKIP = new Set(['id', 'farm_id', 'created_at', 'created_by', 'head_count_updated_at']);

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank';
  if (field.endsWith('_eur')) return eur(Number(v), true);
  if (field === 'quantity_kg') return fmtKg(Number(v));
  if (/(_on|_date)$/.test(field) && typeof v === 'string') return fmtDay(v.slice(0, 10));
  if (field === 'done_at' || field === 'dismissed_at') return 'yes';
  if (field === 'document_id') return 'attached';
  return String(v);
}

function name(e: AuditEntry, b: Pick<FarmBundle, 'products' | 'groups'>): string {
  const r = (e.new_row ?? e.old_row ?? {}) as Record<string, unknown>;
  switch (e.table_name) {
    case 'costs': return `${COST_LABEL[r.category as CostCategory] ?? 'Cost'}${r.supplier_name ? ` to ${r.supplier_name}` : ''}, ${eur(Number(r.amount_eur), true)}`;
    case 'income': return `${INCOME_LABEL[r.income_type as IncomeType] ?? 'Income'}, ${eur(Number(r.amount_eur), true)}`;
    case 'feed_transactions': {
      const p = b.products.find((x) => x.id === r.feed_product_id)?.name ?? 'Feed';
      const kind = r.txn_type === 'delivery' ? 'delivery' : r.txn_type === 'order' ? 'order' : r.txn_type === 'count' ? 'count' : String(r.txn_type ?? '');
      return `${p} ${kind}, ${fmtKg(Number(r.quantity_kg))}`;
    }
    case 'animal_groups': return String(r.name ?? 'Group');
    case 'feeding_rules': return `Feeding plan for ${b.groups.find((g) => g.id === r.animal_group_id)?.name ?? 'a group'}`;
    default: return `${THING[e.table_name] ?? e.table_name}${r.title ? `: ${r.title}` : r.name ? `: ${r.name}` : ''}`;
  }
}

export function describeChange(e: AuditEntry, b: Pick<FarmBundle, 'products' | 'groups'>): { title: string; detail: string } {
  const n = name(e, b);
  if (e.action === 'insert') return { title: `Added: ${n}`, detail: '' };
  if (e.action === 'delete') return { title: `Removed: ${n}`, detail: '' };
  const o = e.old_row ?? {};
  const w = e.new_row ?? {};
  const changes = Object.keys(w).filter((k) => !SKIP.has(k) && JSON.stringify(o[k] ?? null) !== JSON.stringify(w[k] ?? null))
    .map((k) => `${FIELD[k] ?? k.replace(/_/g, ' ')} ${show(k, o[k])} → ${show(k, w[k])}`);
  return { title: `Changed: ${n}`, detail: changes.slice(0, 4).join(', ') };
}
