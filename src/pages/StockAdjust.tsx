import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import type { FeedTransaction, FertiliserStock } from '../lib/types';
import { fmtKg, todayISO, uuid } from '../lib/format';
import { ADJUST_REASONS, REASON_TEXT, TAKES_OFF, signedKg, type StockReason } from '../lib/stockReasons';
import { Button, Card, Chips, DateChips, Empty, List, NumberInput, Row, SaveBar, Screen, SectionTitle, TextInput } from '../components/ui';
import { ChevronRight } from 'lucide-react';
import { QuantityInput } from '../components/pickers';

type FertUnit = 't' | 'bags500' | 'bags50' | 'kg';
const FERT_FACTOR: Record<FertUnit, number> = { t: 1000, bags500: 500, bags50: 50, kg: 1 };

/**
 * Stock adjustment with a reason (G11): wasted or spoiled, unplanned use, sold or returned, or a
 * counting error. It changes the stock, never the feeding plan or the farmer's rates.
 */
export default function StockAdjust({ what }: { what: 'feed' | 'fertiliser' }) {
  const { id } = useParams();
  const b = useFarmData();
  const d = useDerived(b);
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [reason, setReason] = useState<StockReason | null>(null);
  const [direction, setDirection] = useState<'less' | 'more'>('less');
  const [kg, setKg] = useState('');
  const [unit, setUnit] = useState<'kg' | 't'>('kg');
  const [fertUnit, setFertUnit] = useState<FertUnit>('bags50');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const feed = what === 'feed' ? b.products.find((p) => p.id === id) : undefined;
  const fert = what === 'fertiliser' ? b.fertilisers.find((p) => p.id === id) : undefined;
  const name = feed?.name ?? fert?.name;
  if (!name) return <Screen title="Adjust stock" back><Empty title="Not found" /></Screen>;
  const amountKg = what === 'feed' ? Number(kg) : Math.round(Number(qty) * FERT_FACTOR[fertUnit] * 10) / 10;
  const now = what === 'feed' ? d.feed.get(id!)?.stockKg ?? null : d.fertiliser.products.find((x) => x.product.id === id)?.stockKg ?? null;
  const takesOff = reason ? TAKES_OFF[reason] : null;
  const signed = reason && amountKg > 0 ? signedKg(amountKg, reason, direction) : 0;
  const words = REASON_TEXT[what];

  async function submit() {
    if (!reason || !(amountKg > 0)) return;
    const notes = note.trim() || null;
    const back = what === 'feed' ? `/feed/${id}` : `/fertiliser/${id}`;
    if (what === 'feed') {
      const row = { id: uuid(), farm_id: farmId!, feed_product_id: id!, txn_type: 'adjustment' as const, quantity_kg: signed, effective_on: date, evidence: 'measured' as const, reason, notes };
      const ok = await save([{ kind: 'insert', table: 'feed_transactions', row }], {
        label: `${name}: ${signed < 0 ? 'took off' : 'added'} ${fmtKg(Math.abs(signed))}`,
        patch: (x) => ({ ...x, txns: [...x.txns, { ...row, order_date: null, delivery_date: null, expected_delivery_date: null, order_status: null, linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null, document_id: null, created_at: new Date().toISOString() } as FeedTransaction] }),
        undo: [{ kind: 'delete', table: 'feed_transactions', match: { id: row.id } }]
      });
      if (ok) nav(back, { replace: true });
    } else {
      const row: FertiliserStock = { id: uuid(), farm_id: farmId!, product_id: id!, kind: 'adjustment', quantity_kg: signed, on_date: date, evidence: 'measured', supplier_id: null, cost_id: null, notes, reason };
      const ok = await save([{ kind: 'insert', table: 'fertiliser_stock', row: { ...row } }], {
        label: `${name}: ${signed < 0 ? 'took off' : 'added'} ${fmtKg(Math.abs(signed))}`,
        patch: (x) => ({ ...x, fertStock: [...x.fertStock, { ...row, created_at: new Date().toISOString() }] }),
        undo: [{ kind: 'delete', table: 'fertiliser_stock', match: { id: row.id } }]
      });
      if (ok) nav(back, { replace: true });
    }
  }

  return (
    <Screen title="Adjust stock" back sub={name}>
      <Card className="space-y-5">
        <Chips label="What happened?" value={reason} onChange={setReason}
          options={ADJUST_REASONS.map((r) => ({ value: r, label: words[r] }))} />
        {reason && takesOff === null && (
          <Chips label="Is there more or less than recorded?" columns={2} value={direction} onChange={setDirection}
            options={[{ value: 'less', label: 'Less than recorded' }, { value: 'more', label: 'More than recorded' }]} />
        )}
        {what === 'feed'
          ? <QuantityInput label={takesOff === false || (takesOff === null && direction === 'more') ? 'How much to add' : 'How much to take off'} kg={kg} onKg={setKg} unit={unit} onUnit={setUnit} />
          : (
            <>
              <Chips columns={2} value={fertUnit} onChange={setFertUnit} options={[{ value: 'bags50', label: '50 kg bags' }, { value: 'bags500', label: '500 kg bags' }, { value: 't', label: 'Tonnes' }, { value: 'kg', label: 'kg' }]} />
              <NumberInput label="How much" value={qty} onChange={setQty} unit={fertUnit === 'bags50' || fertUnit === 'bags500' ? 'bags' : fertUnit} />
            </>
          )}
        <DateChips label="When" value={date} onChange={setDate} />
        <TextInput label="Note (optional)" value={note} onChange={setNote} placeholder={what === 'feed' ? 'e.g. wet meal at the bottom of the bin' : 'e.g. two bags split in the rain'} />
        {reason && amountKg > 0 && now !== null && (
          <p className="rounded-xl bg-pasture p-3 text-[0.9375rem]">Stock goes from <b>{fmtKg(now)}</b> to about <b>{fmtKg(Math.max(0, now + signed))}</b>. {what === 'feed' ? 'Your feeding plan stays as it is.' : 'Your spreading rates stay as they are.'}</p>
        )}
      </Card>
      <SaveBar><Button block disabled={!reason || !(amountKg > 0)} onClick={submit}>Save adjustment</Button></SaveBar>
    </Screen>
  );
}

/** Add > Wasted, used elsewhere or sold: pick the feed or fertiliser first. */
export function AdjustPick() {
  const b = useFarmData();
  const feeds = b.products.filter((p) => !p.archived);
  const ferts = b.fertilisers.filter((p) => !p.archived);
  return (
    <Screen title="Adjust stock" back>
      {feeds.length + ferts.length === 0 && <Empty title="No feed or fertiliser yet" body="Add a feed or a fertiliser first." />}
      {feeds.length > 0 && <><SectionTitle>Feed</SectionTitle><List>{feeds.map((p) => <Row key={p.id} to={`/feed/${p.id}/adjust`} title={p.name} right={<ChevronRight className="h-5 w-5 text-muted" />} />)}</List></>}
      {ferts.length > 0 && <><SectionTitle>Fertiliser</SectionTitle><List>{ferts.map((p) => <Row key={p.id} to={`/fertiliser/${p.id}/adjust`} title={p.name} right={<ChevronRight className="h-5 w-5 text-muted" />} />)}</List></>}
    </Screen>
  );
}
