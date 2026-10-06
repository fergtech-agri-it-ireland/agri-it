import { useState } from 'react';
import { useFarmData, useSave } from '../lib/data/farm';
import { documentUrl } from '../lib/upload';
import { RECORD_LABEL, type RecordType } from '../lib/types';
import { eur, fmtDate } from '../lib/format';
import { Button, Card, Chips, LinkButton, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';

export default function Records() {
  const b = useFarmData();
  const save = useSave();
  const [filter, setFilter] = useState<'all' | RecordType>('all');
  const unconfirmedDocs = b.documents.filter((d) => d.state === 'unconfirmed');
  const records = b.records.filter((r) => filter === 'all' || r.record_type === filter);
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
            {unconfirmedDocs.map((d) => (
              <Row key={d.id} title={d.file_name ?? RECORD_LABEL[d.record_type]} sub={`${RECORD_LABEL[d.record_type]}, ${fmtDate(d.created_at.slice(0, 10))}`}
                right={<div className="flex gap-1">
                  {d.storage_path && <Button variant="ghost" onClick={async () => { const u = await documentUrl(d.storage_path!); if (u) window.open(u, '_blank'); }}>View</Button>}
                  <Button variant="secondary" onClick={() => save([{ kind: 'update', table: 'documents', match: { id: d.id }, patch: { state: 'confirmed' } }], { label: 'Confirmed', patch: (x) => ({ ...x, documents: x.documents.map((y) => (y.id === d.id ? { ...y, state: 'confirmed' } : y)) }) })}>Confirm</Button>
                </div>} />
            ))}
          </List>
        </>
      )}

      <Chips value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'fertiliser', label: 'Fertiliser' }, { value: 'medicine', label: 'Medicine' }, { value: 'movement', label: 'Movements' }, { value: 'other', label: 'Other' }]} />
      {records.length === 0 ? <Card><p className="text-muted">No records here yet.</p></Card> : (
        <List>
          {records.map((r) => {
            const det = r.details as Record<string, string | number>;
            const bits = [det.product, det.quantity_kg && `${det.quantity_kg} kg`, det.animals && `${det.animals} animals`, det.withdrawal_days && `${det.withdrawal_days}-day withdrawal`].filter(Boolean);
            return <Row key={r.id} title={r.title} sub={`${RECORD_LABEL[r.record_type]}, ${fmtDate(r.occurred_on)}${bits.length ? `. ${bits.join(', ')}` : ''}`} />;
          })}
        </List>
      )}
    </Screen>
  );
}
