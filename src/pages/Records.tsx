import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Search } from 'lucide-react';
import { useFarmData, useSave } from '../lib/data/farm';
import { documentUrl } from '../lib/upload';
import { RECORD_LABEL } from '../lib/types';
import { eur, fmtDate, fmtKg } from '../lib/format';
import { searchVault, vaultCsv, vaultItems, VAULT_LABEL, type VaultKind } from '../lib/vault';
import { buildZip, download } from '../lib/exportPack';
import { IN_FRAME, IS_DEMO } from '../lib/env';
import { useToast } from '../components/Toast';
import { Button, Card, Chips, LinkButton, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';

export default function Records() {
  const b = useFarmData();
  const save = useSave();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | VaultKind>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const unconfirmedDocs = b.documents.filter((d) => d.state === 'unconfirmed');
  const all = useMemo(() => vaultItems(b), [b]);
  const found = searchVault(all, q, filter);
  async function exportFound(zip: boolean) {
    const csv = vaultCsv(found);
    if (!zip) {
      if (IN_FRAME) { try { await navigator.clipboard.writeText(csv); toast.show({ message: 'Copied. Paste it into an email or spreadsheet.', tone: 'success' }); } catch { toast.show({ message: 'Could not copy here.', tone: 'error' }); } return; }
      download(new Blob([`\ufeff${csv}`], { type: 'text/csv' }), 'agri-it-records.csv');
      return;
    }
    setBusy(true);
    const docs = found.map((i) => b.documents.find((d) => d.id === i.documentId)).filter((d): d is NonNullable<typeof d> => !!d);
    const { blob, attached, missing } = await buildZip([{ name: 'records.csv', text: csv }], docs);
    setBusy(false);
    download(blob, 'agri-it-records.zip');
    toast.show({ message: `${found.length} records and ${attached} photo${attached === 1 ? '' : 's'}${missing.length ? `. ${missing.length} not on this phone` : ''}`, tone: missing.length ? 'info' : 'success' });
  }
  // Completeness: deliveries and big costs without paperwork
  const deliveriesNoDocket = b.txns.filter((t) => t.txn_type === 'delivery' && !t.document_id).length;
  const costsNoInvoice = b.costs.filter((c) => !c.document_id && Number(c.amount_eur) >= 500).length;

  return (
    <Screen title="Records" back="/farm" right={<LinkButton to="/records/new" variant="hivis">Add</LinkButton>}>
      <Card>
        <p className="font-bold">Completeness</p>
        <p className="mt-1 flex items-center gap-2"><ToneIcon tone={deliveriesNoDocket ? 'warn' : 'ok'} className="h-5 w-5" />{deliveriesNoDocket} feed deliveries without a docket photo</p>
        <p className="mt-1 flex items-center gap-2"><ToneIcon tone={costsNoInvoice ? 'warn' : 'ok'} className="h-5 w-5" />{costsNoInvoice} costs over {eur(500)} without an invoice</p>
        <p className="mt-1 flex items-center gap-2"><ToneIcon tone={unconfirmedDocs.length ? 'warn' : 'ok'} className="h-5 w-5" />{unconfirmedDocs.length} documents waiting to be confirmed</p>
      </Card>

      {unconfirmedDocs.length > 0 && (
        <>
          <SectionTitle>Confirm these</SectionTitle>
          <p className="px-1 text-sm text-muted">Values from photos are only trusted once you've checked them.</p>
          <List>
            {unconfirmedDocs.map((d) => {
              // A delivery whose quantity came from this invoice: confirming says what arrived matches
              const fromInvoice = b.txns.filter((t) => t.document_id === d.id && t.evidence === 'invoice_derived');
              const cost = b.costs.find((c) => c.document_id === d.id);
              const ex = d.extracted as { fields?: { supplier?: { value: { payee?: string; text: string } } } } | null | undefined;
              const who = ex?.fields?.supplier?.value.payee ?? ex?.fields?.supplier?.value.text;
              const what = fromInvoice[0] ? `${fmtKg(Number(fromInvoice[0].quantity_kg))} delivered` : cost ? eur(Number(cost.amount_eur), true) : null;
              const ops = [
                { kind: 'update' as const, table: 'documents', match: { id: d.id }, patch: { state: 'confirmed' } },
                ...fromInvoice.map((t) => ({ kind: 'update' as const, table: 'feed_transactions', match: { id: t.id }, patch: { evidence: 'confirmed_docket' } }))
              ];
              return (
                <Row key={d.id} title={[who, what].filter(Boolean).join(', ') || d.file_name || RECORD_LABEL[d.record_type]}
                  sub={`${ex ? 'Read from photo' : RECORD_LABEL[d.record_type]}, ${fmtDate(d.created_at.slice(0, 10))}${fromInvoice.length ? '. Confirm once what arrived matches' : ''}`}
                  right={<div className="flex gap-1">
                    {d.storage_path && <Button variant="ghost" onClick={async () => { const u = await documentUrl(d.storage_path!); if (u) window.open(u, '_blank'); }}>View</Button>}
                    <Button variant="secondary" onClick={() => save(ops, {
                      label: fromInvoice.length ? 'Confirmed. Forecast confidence updated' : 'Confirmed',
                      patch: (x) => ({
                        ...x,
                        documents: x.documents.map((y) => (y.id === d.id ? { ...y, state: 'confirmed' } : y)),
                        txns: x.txns.map((t) => (fromInvoice.some((f) => f.id === t.id) ? { ...t, evidence: 'confirmed_docket' } : t))
                      })
                    })}>Confirm</Button>
                  </div>} />
              );
            })}
          </List>
        </>
      )}

      <SectionTitle>Find a record</SectionTitle>
      <label className="flex min-h-tap items-center gap-2 rounded-xl border-2 border-line bg-card px-3">
        <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        <input type="search" aria-label="Search records" placeholder="Supplier, product, invoice no., amount, month" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-tap w-full bg-transparent outline-none" />
      </label>
      <Chips<'all' | VaultKind> value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...(Object.keys(VAULT_LABEL) as VaultKind[]).map((k) => ({ value: k, label: VAULT_LABEL[k] }))]} />
      {found.length === 0 ? <Card><p className="text-muted">{q || filter !== 'all' ? 'Nothing matches.' : 'No records here yet.'}</p></Card> : (
        <List>
          {found.slice(0, 80).map((i) => (
            <Row key={i.id} title={i.title}
              sub={<>{VAULT_LABEL[i.kind]}, {fmtDate(i.date)}{i.sub ? `. ${i.sub}` : ''}{!i.confirmed && <b className="text-warn">. Not confirmed</b>}
                {i.links.map((l) => <Link key={l.to + l.label} to={l.to} className="ml-2 font-bold text-accent underline">{l.label}</Link>)}</>}
              right={i.storagePath ? <Button variant="ghost" onClick={async () => { const u = await documentUrl(i.storagePath!); if (u) window.open(u, '_blank'); }}>Photo</Button> : undefined} />
          ))}
        </List>
      )}
      {found.length > 80 && <p className="px-1 text-sm text-muted">Showing 80 of {found.length}. Search to narrow it down; the export includes all of them.</p>}
      {found.length > 0 && (IS_DEMO
        ? <p className="rounded-xl bg-field-light px-4 py-3 font-bold text-accent">Export works in the installed app.</p>
        : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => exportFound(false)}><Download className="h-5 w-5" />{IN_FRAME ? 'Copy list' : 'Export list'}</Button>
            {!IN_FRAME && <Button variant="secondary" disabled={busy} onClick={() => exportFound(true)}><Download className="h-5 w-5" />{busy ? 'Packing' : 'With photos (zip)'}</Button>}
          </div>
        ))}
      <Card className="border border-line">
        <p className="font-bold">Evidence, not an official register</p>
        <p className="text-[0.9375rem] text-muted">Photos are kept as taken and every change is in the change history. Keeping a record here does not replace notifying the Department or keeping a statutory register (animal medicines, movements, fertiliser). Check what applies to your farm with the authority or your adviser.</p>
      </Card>
    </Screen>
  );
}
