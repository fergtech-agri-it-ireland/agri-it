import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { FertiliserStock } from '../lib/types';
import { cur, eur, fmtDay, fmtKg, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, Empty, Field, LinkButton, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { SupplierPicker } from '../components/pickers';

type Unit = 't' | 'bags500' | 'bags50' | 'kg';
const FACTOR: Record<Unit, number> = { t: 1000, bags500: 500, bags50: 50, kg: 1 };

/**
 * Fertiliser ordered, not here yet (14 Oct 2026, like feed): a commitment. It shows as On order,
 * never as stock, a cost or cash, until it's delivered. No delivery date is guessed.
 */
export default function FertiliserOrder() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const products = b.fertilisers.filter((p) => !p.archived);
  const [productId, setProductId] = useState<string | null>(params.get('product') ?? (products.length === 1 ? products[0].id : null));
  const product = products.find((p) => p.id === productId) ?? null;
  const [supplierId, setSupplierId] = useState<string | null>(product?.supplier_id ?? null);
  const [unit, setUnit] = useState<Unit>('t');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(todayISO());
  const [knowWhen, setKnowWhen] = useState(false);
  const [expected, setExpected] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const money = b.role !== 'worker';
  const kg = Math.round(Number(qty) * FACTOR[unit] * 10) / 10;

  function pickProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p?.supplier_id) setSupplierId(p.supplier_id);
  }

  async function submit() {
    if (!product || !(kg > 0)) return;
    const row: FertiliserStock = {
      id: uuid(), farm_id: farmId!, product_id: product.id, kind: 'order', quantity_kg: kg, on_date: date, evidence: 'farmer_estimate',
      supplier_id: supplierId, cost_id: null, notes: note.trim() || null, order_status: 'open',
      expected_on: knowWhen && expected ? expected : null,
      price_per_tonne_eur: money && price !== '' && Number(price) > 0 ? Number(price) : null
    };
    const ok = await save([{ kind: 'insert', table: 'fertiliser_stock', row: { ...row } }], {
      label: `${fmtKg(kg)} of ${product.name} on order`,
      patch: (x) => ({ ...x, fertStock: [...x.fertStock, { ...row, created_at: new Date().toISOString() }] }),
      undo: [{ kind: 'delete', table: 'fertiliser_stock', match: { id: row.id } }]
    });
    if (ok) nav(`/fertiliser/${product.id}`, { replace: true });
  }

  if (!products.length) {
    return (
      <Screen title="Fertiliser order" back>
        <Empty title="Add the fertiliser first" body="Say what it is (pick from the list or type it), then record orders and deliveries of it." action={<LinkButton to="/fertiliser/new">Add a fertiliser</LinkButton>} />
      </Screen>
    );
  }

  return (
    <Screen title="Fertiliser order" back sub="Ordered, not here yet">
      <Card className="space-y-5">
        <Chips label="Which fertiliser?" columns={2} value={productId} onChange={pickProduct}
          options={products.map((p) => ({ value: p.id, label: p.name, sub: b.suppliers.find((s) => s.id === p.supplier_id)?.name }))} />
        <Chips label="How much?" columns={2} value={unit} onChange={setUnit} options={[{ value: 't', label: 'Tonnes' }, { value: 'bags500', label: '500 kg bags' }, { value: 'bags50', label: '50 kg bags' }, { value: 'kg', label: 'kg' }]} />
        <NumberInput label="Quantity ordered" value={qty} onChange={setQty} unit={unit === 't' ? 't' : unit === 'kg' ? 'kg' : 'bags'} hint={kg > 0 && unit !== 'kg' ? fmtKg(kg) : undefined} />
        <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />
        <DateChips label="Ordered" value={date} onChange={setDate} />
        <label className="flex min-h-tap items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6 accent-field" checked={knowWhen} onChange={(e) => setKnowWhen(e.target.checked)} />
          The supplier said when it's coming
        </label>
        {knowWhen && (
          <Field label="Expected" htmlFor="fert-exp"><input id="fert-exp" type="date" className="input" value={expected} min={date} onChange={(e) => setExpected(e.target.value)} /></Field>
        )}
      </Card>
      {money && (
        <Card className="space-y-2">
          <NumberInput label="Agreed price per tonne (optional)" value={price} onChange={setPrice} unit={`${cur()}/t`}
            hint={price !== '' && kg > 0 ? `About ${eur(Number(price) * kg / 1000)} on order. Not a bill until it's delivered` : 'Only a price you agreed. Shows as On order, never as a cost.'} />
        </Card>
      )}
      <Card><TextInput label="Note (optional)" value={note} onChange={setNote} voice /></Card>
      {knowWhen && expected && <p className="px-1 text-sm text-muted">Agri-It will ask if it arrived after {fmtDay(expected)}.</p>}
      <SaveBar><Button block disabled={!product || !(kg > 0)} onClick={submit}>Save order</Button></SaveBar>
    </Screen>
  );
}
