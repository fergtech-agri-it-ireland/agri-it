import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import type { Evidence, FeedTransaction } from '../lib/types';
import { fmtKg, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, Empty, LinkButton, SaveBar, Screen } from '../components/ui';
import { FeedPicker, QuantityInput } from '../components/pickers';

export default function StockCount() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const b = useFarmData();
  const d = useDerived(b);
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [feedId, setFeedId] = useState<string | null>(id ?? params.get('feed') ?? (b.products.filter((p) => !p.archived).length === 1 ? b.products[0].id : null));
  const [kg, setKg] = useState('');
  const [unit, setUnit] = useState<'kg' | 't'>('t');
  const [evidence, setEvidence] = useState<Evidence>('measured');
  const [date, setDate] = useState(todayISO());
  if (!b.products.some((p) => !p.archived)) return <Screen title="Stock count" back><Empty title="No feeds yet" action={<LinkButton to="/feed/new">Add a feed</LinkButton>} /></Screen>;
  const f = feedId ? d.feed.get(feedId) : undefined;

  async function submit() {
    const row = {
      id: uuid(), farm_id: farmId!, feed_product_id: feedId!, txn_type: 'count' as const, quantity_kg: Number(kg), effective_on: date, evidence,
      notes: evidence === 'measured' ? 'Counted on farm' : 'Estimated'
    };
    const ok = await save([{ kind: 'insert', table: 'feed_transactions', row }], {
      label: 'Stock count saved',
      patch: (x) => ({ ...x, txns: [...x.txns, { ...row, order_date: null, delivery_date: null, expected_delivery_date: null, order_status: null, linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null, document_id: null, created_at: new Date().toISOString() } as FeedTransaction] }),
      undo: [{ kind: 'delete', table: 'feed_transactions', match: { id: row.id } }]
    });
    if (ok) nav(`/feed/${feedId}`, { replace: true });
  }

  return (
    <Screen title="Stock count" back>
      <Card className="space-y-5">
        {!id && <FeedPicker b={b} value={feedId} onChange={setFeedId} />}
        {f && f.stockKg !== null && <p className="rounded-xl bg-pasture p-3">Agri-It expects about <b>{fmtKg(f.stockKg)}</b> today. Your count replaces this and resets the forecast.</p>}
        <QuantityInput label="How much is there?" kg={kg} onKg={setKg} unit={unit} onUnit={setUnit} />
        <Chips columns={2} value={evidence} onChange={setEvidence} options={[
          { value: 'measured', label: 'Measured', sub: 'Dipped, weighed, counted bags' },
          { value: 'farmer_estimate', label: 'Rough guess', sub: 'Lowers confidence' }
        ]} />
        <DateChips label="When" value={date} onChange={setDate} />
      </Card>
      <SaveBar><Button block disabled={!feedId || kg === ''} onClick={submit}>Save count</Button></SaveBar>
    </Screen>
  );
}
