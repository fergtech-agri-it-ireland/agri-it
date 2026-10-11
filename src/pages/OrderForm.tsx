import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { resolveLeadTime } from '../lib/forecast/feed';
import type { FeedTransaction } from '../lib/types';
import { addDays, eur, todayISO, uuid } from '../lib/format';
import { Button, Card, DateChips, Empty, LinkButton, NumberInput, SaveBar, Screen } from '../components/ui';
import { FeedPicker, QuantityInput, SupplierPicker } from '../components/pickers';

/** Planned orders are kept separate from stock until the delivery is confirmed. */
export default function OrderForm() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const products = b.products.filter((p) => !p.archived);
  const expectedFor = (pid: string | null, sid: string | null) => {
    const p = b.products.find((x) => x.id === pid);
    if (!p) return addDays(today, 3);
    const lead = resolveLeadTime(p, b.supplierSettings.find((s) => s.supplier_id === sid), b.farm.default_lead_time_days);
    return addDays(today, lead.days ?? 3);
  };
  const initial = params.get('feed') ?? (products.length === 1 ? products[0].id : null);
  const [feedId, setFeedId] = useState<string | null>(initial);
  const [supplierId, setSupplierId] = useState<string | null>(b.products.find((p) => p.id === initial)?.supplier_id ?? null);
  const [kg, setKg] = useState(params.get('kg') ?? '');
  const [unit, setUnit] = useState<'kg' | 't'>('t');
  const [expected, setExpected] = useState(expectedFor(initial, supplierId));
  const lastPaid = (pid: string | null) => b.txns.filter((t) => t.txn_type === 'delivery' && t.feed_product_id === pid && t.price_per_tonne_eur !== null)
    .sort((a, c) => c.effective_on.localeCompare(a.effective_on))[0]?.price_per_tonne_eur ?? null;
  const [price, setPrice] = useState(() => { const p = lastPaid(initial); return p !== null ? String(p) : ''; });
  const money = b.role !== 'worker';
  if (!products.length) return <Screen title="Ordered feed" back><Empty title="Add a feed first" action={<LinkButton to="/feed/new">Add a feed</LinkButton>} /></Screen>;

  async function submit() {
    const perT = price === '' || !money ? null : Number(price);
    const row = {
      id: uuid(), farm_id: farmId!, feed_product_id: feedId!, txn_type: 'order' as const, quantity_kg: Number(kg), order_date: today,
      expected_delivery_date: expected, effective_on: expected, order_status: 'open' as const, supplier_id: supplierId, evidence: 'unconfirmed' as const,
      price_per_tonne_eur: perT, total_price_eur: perT === null ? null : Math.round(perT * Number(kg) / 10) / 100
    };
    const ok = await save([{ kind: 'insert', table: 'feed_transactions', row }], {
      label: 'Order saved',
      patch: (x) => ({ ...x, txns: [...x.txns, { ...row, delivery_date: null, linked_order_id: null, document_id: null, notes: null, created_at: new Date().toISOString() } as FeedTransaction] }),
      undo: [{ kind: 'delete', table: 'feed_transactions', match: { id: row.id } }]
    });
    if (ok) nav(`/feed/${feedId}`, { replace: true });
  }

  return (
    <Screen title="Ordered feed" back>
      <Card className="space-y-5">
        <FeedPicker b={b} value={feedId} onChange={(id) => { setFeedId(id); const s = b.products.find((p) => p.id === id)?.supplier_id ?? null; setSupplierId(s); setExpected(expectedFor(id, s)); const p = lastPaid(id); setPrice(p !== null ? String(p) : ''); }} />
        <QuantityInput label="How much did you order?" kg={kg} onKg={setKg} unit={unit} onUnit={setUnit} />
        <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />
        <DateChips label="Expected delivery" value={expected} onChange={setExpected} allowFuture />
        {money && <NumberInput label="Agreed price per tonne (optional)" value={price} onChange={setPrice} unit="€"
          hint={price && kg ? `About ${eur(Number(price) * Number(kg) / 1000)} committed. Filled in from the last price you paid: change it to what was agreed.` : 'Shows as money committed, kept apart from bills owed and paid.'} />}
        <p className="hint">Not counted as stock, a cost or cash until it arrives. Agri-It will ask you on the day.</p>
      </Card>
      <SaveBar><Button block disabled={!feedId || !kg} onClick={submit}>Save order</Button></SaveBar>
    </Screen>
  );
}
