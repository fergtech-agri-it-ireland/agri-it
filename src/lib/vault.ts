/**
 * The records vault (review gap P1): every record, invoice, docket and photo in one
 * searchable list, each linked to what it belongs to (supplier, animal group, feed, bill).
 * Stored documents are evidence for the farmer, an adviser or an inspection; they do not
 * replace an official notification or a statutory register.
 */
import type { FarmBundle, ISODate } from './types';
import { COST_LABEL, RECORD_LABEL } from './types';
import { eur, fmtKg } from './format';

export type VaultKind = 'medicine' | 'fertiliser' | 'movement' | 'other' | 'invoice' | 'docket';
export const VAULT_LABEL: Record<VaultKind, string> = {
  medicine: 'Medicine', fertiliser: 'Fertiliser', movement: 'Movement', other: 'Other record', invoice: 'Invoice or bill', docket: 'Feed docket'
};

export interface VaultItem {
  id: string;
  kind: VaultKind;
  date: ISODate;
  title: string;
  /** Linked supplier, group, feed and amounts, in words. */
  sub: string;
  links: { label: string; to: string }[];
  documentId: string | null;
  storagePath: string | null;
  fileName: string | null;
  confirmed: boolean;
  /** Everything searchable, lower case. */
  text: string;
}

export function vaultItems(b: Pick<FarmBundle, 'records' | 'documents' | 'costs' | 'txns' | 'products' | 'suppliers' | 'groups'>): VaultItem[] {
  const doc = (id: string | null) => (id ? b.documents.find((d) => d.id === id) : undefined);
  const supplier = (id: string | null) => (id ? b.suppliers.find((s) => s.id === id)?.name : undefined);
  const items: VaultItem[] = [];
  const used = new Set<string>();

  for (const r of b.records) {
    const det = r.details as Record<string, string | number | undefined>;
    const group = det.animal_group_id ? b.groups.find((g) => g.id === det.animal_group_id) : undefined;
    const kind: VaultKind = r.record_type === 'medicine' || r.record_type === 'fertiliser' || r.record_type === 'movement' ? r.record_type : 'other';
    const bits = [det.product, det.quantity_kg && `${det.quantity_kg} kg`, det.animals && `${det.animals} animals`, group?.name,
      det.withdrawal_days && `${det.withdrawal_days}-day withdrawal`, det.batch && `batch ${det.batch}`, det.supplier].filter(Boolean) as string[];
    const d = doc(r.document_id);
    if (d) used.add(d.id);
    items.push({
      id: `rec:${r.id}`, kind, date: r.occurred_on, title: r.title, sub: bits.join(', '),
      links: group ? [{ label: group.name, to: '/farm/groups' }] : [],
      documentId: r.document_id, storagePath: d?.storage_path ?? null, fileName: d?.file_name ?? null, confirmed: r.state === 'confirmed',
      text: [r.title, ...bits, RECORD_LABEL[r.record_type]].join(' ').toLowerCase()
    });
  }
  for (const c of b.costs.filter((x) => x.document_id || x.invoice_ref)) {
    const d = doc(c.document_id);
    if (d) used.add(d.id);
    const who = c.supplier_name ?? supplier(c.supplier_id) ?? '';
    const title = `${who || COST_LABEL[c.category]}${c.invoice_ref ? `, invoice ${c.invoice_ref}` : ''}`;
    items.push({
      id: `cost:${c.id}`, kind: 'invoice', date: c.occurred_on, title,
      sub: [eur(Number(c.amount_eur), true), COST_LABEL[c.category], c.vat_eur ? `VAT ${eur(Number(c.vat_eur), true)}` : null, c.payment_status === 'owed' ? 'owed' : 'paid'].filter(Boolean).join(', '),
      links: [{ label: c.payment_status === 'owed' ? 'Bills to pay' : 'Money', to: c.payment_status === 'owed' ? '/money/bills' : '/money' }],
      documentId: c.document_id, storagePath: d?.storage_path ?? null, fileName: d?.file_name ?? null, confirmed: d ? d.state === 'confirmed' : true,
      text: [title, who, c.description, c.invoice_ref, COST_LABEL[c.category], String(c.amount_eur)].join(' ').toLowerCase()
    });
  }
  for (const t of b.txns.filter((x) => x.txn_type === 'delivery' && x.document_id)) {
    const d = doc(t.document_id);
    if (!d || used.has(d.id)) continue;
    used.add(d.id);
    const p = b.products.find((x) => x.id === t.feed_product_id);
    const who = supplier(t.supplier_id) ?? '';
    items.push({
      id: `txn:${t.id}`, kind: 'docket', date: t.effective_on, title: `${p?.name ?? 'Feed'} delivery${who ? `, ${who}` : ''}`,
      sub: [fmtKg(Number(t.quantity_kg)), t.notes].filter(Boolean).join(', '),
      links: p ? [{ label: p.name, to: `/feed/${p.id}` }] : [],
      documentId: t.document_id, storagePath: d.storage_path, fileName: d.file_name, confirmed: d.state === 'confirmed',
      text: [p?.name, who, t.notes, 'docket delivery'].join(' ').toLowerCase()
    });
  }
  // Photos kept on their own (e.g. read from a photo, then the record removed)
  for (const d of b.documents.filter((x) => !used.has(x.id))) {
    items.push({
      id: `doc:${d.id}`, kind: d.record_type === 'feed_docket' ? 'docket' : 'invoice', date: d.created_at.slice(0, 10), title: d.file_name ?? RECORD_LABEL[d.record_type],
      sub: d.state === 'confirmed' ? 'Photo' : 'Photo, not confirmed yet', links: [],
      documentId: d.id, storagePath: d.storage_path, fileName: d.file_name, confirmed: d.state === 'confirmed',
      text: [d.file_name, RECORD_LABEL[d.record_type]].join(' ').toLowerCase()
    });
  }
  return items.sort((a, c) => c.date.localeCompare(a.date));
}

/** Every word typed must appear somewhere in the item (supplier, product, invoice no., amount...). */
export function searchVault(items: VaultItem[], q: string, kind: VaultKind | 'all' = 'all', from?: ISODate, to?: ISODate): VaultItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => (kind === 'all' || i.kind === kind) && (!from || i.date >= from) && (!to || i.date <= to)
    && words.every((w) => i.text.includes(w) || i.date.includes(w)));
}

export function vaultCsv(items: VaultItem[]): string {
  const row = (r: (string | null)[]) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
  return [
    row(['Date', 'Kind', 'What', 'Details', 'Confirmed', 'Attachment']),
    ...items.map((i) => row([i.date, VAULT_LABEL[i.kind], i.title, i.sub, i.confirmed ? 'Yes' : 'No', i.documentId ? `attachments/${attachmentName(i.documentId, i.fileName)}` : '']))
  ].join('\n');
}

/** Stable file name for an attachment in an export: the document id keeps names unique. */
export function attachmentName(documentId: string, fileName: string | null): string {
  const ext = (fileName?.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const base = (fileName?.replace(/\.[^.]+$/, '') ?? 'document').replace(/[^\w-]+/g, '-').slice(0, 40);
  return `${base}-${documentId.slice(0, 8)}.${ext}`;
}
