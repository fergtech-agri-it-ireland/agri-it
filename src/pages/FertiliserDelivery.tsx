import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import type { Cost, FertiliserStock } from '../lib/types';
import { cur, eur, fmtDay, fmtKg, todayISO, uuid } from '../lib/format';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, DateChips, Empty, Field, LinkButton, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { SupplierPicker } from '../components/pickers';

type Unit = 't' | 'bags500' | 'bags50' | 'kg';
const FACTOR: Record<Unit, number> = { t: 1000, bags500: 500, bags50: 50, kg: 1 };

/**
 * Fertiliser arrived: adds to the stock, and (for anyone who handles money) records the bill,
 * paid now or on account, so it shows in Bills to pay, cash and the year-end pack.
 */
export default function FertiliserDelivery() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const d = useDerived(b);
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
  const [priceMode, setPriceMode] = useState<'per_t' | 'total'>('per_t');
  const [price, setPrice] = useState('');
  // Same as the last fertiliser bill to this supplier: paid now or on account
  const lastBill = b.costs.filter((c) => c.category === 'fertiliser' && c.supplier_id && c.supplier_id === supplierId).sort((x, y) => y.occurred_on.localeCompare(x.occurred_on))[0];
  const [pay, setPay] = useState<'paid' | 'owed'>(lastBill?.payment_status === 'owed' ? 'owed' : 'paid');
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const money = b.role !== 'worker';
  const kg = Math.round(Number(qty) * FACTOR[unit] * 10) / 10;
  const total = price === '' ? null : priceMode === 'per_t' ? Math.round(Number(price) * (kg / 1000) * 100) / 100 : Number(price);
  const state = d.fertiliser.products.find((x) => x.product.id === productId);

  function pickProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p?.supplier_id) setSupplierId(p.supplier_id);
  }

  async function submit() {
    if (!product || !(kg > 0)) return;
    const supplier = b.suppliers.find((s) => s.id === supplierId);
    const cost = money && total !== null && total > 0 ? {
      id: uuid(), farm_id: farmId!, category: 'fertiliser' as const, other_label: null, occurred_on: date, amount_eur: total,
      supplier_id: supplier && !supplier.farm_id ? supplier.id : supplier?.id ?? null, supplier_name: supplier?.name ?? null,
      description: `${product.name}, ${fmtKg(kg)}${note.trim() ? `. ${note.trim()}` : ''}`, document_id: null,
      payment_status: pay, paid_on: pay === 'paid' ? date : null, due_on: pay === 'owed' && dueOn ? dueOn : null
    } : null;
    const row: FertiliserStock = { id: uuid(), farm_id: farmId!, product_id: product.id, kind: 'delivery', quantity_kg: kg, on_date: date, evidence: 'docket', supplier_id: supplierId, cost_id: cost?.id ?? null, notes: note.trim() || null };
    const ops: Op[] = [
      ...(cost ? [{ kind: 'insert' as const, table: 'costs', row: { ...cost } }] : []),
      { kind: 'insert', table: 'fertiliser_stock', row: { ...row } }
    ];
    const ok = await save(ops, {
      label: `${fmtKg(kg)} of ${product.name} added to stock${cost ? (pay === 'owed' ? `. Bill of ${eur(cost.amount_eur)} owed` : `. ${eur(cost.amount_eur)} paid`) : ''}`,
      patch: (x) => ({
        ...x,
        fertStock: [...x.fertStock, { ...row, created_at: new Date().toISOString() }],
        costs: cost ? [{ ...cost, feed_transaction_id: null } as Cost, ...x.costs] : x.costs
      }),
      undo: [
        { kind: 'delete', table: 'fertiliser_stock', match: { id: row.id } },
        ...(cost ? [{ kind: 'delete' as const, table: 'costs', match: { id: cost.id } }] : [])
      ]
    });
    if (ok) nav(`/fertiliser/${product.id}`, { replace: true });
  }

  if (!products.length) {
    return (
      <Screen title="Fertiliser arrived" back>
        <Empty title="Add the fertiliser first" body="Say what it is (pick from the list or type it), then record deliveries of it." action={<LinkButton to="/fertiliser/new">Add a fertiliser</LinkButton>} />
      </Screen>
    );
  }

  return (
    <Screen title="Fertiliser arrived" back>
      <Card className="space-y-5">
        <Chips label="Which fertiliser?" columns={2} value={productId} onChange={pickProduct}
          options={products.map((p) => ({ value: p.id, label: p.name, sub: b.suppliers.find((s) => s.id === p.supplier_id)?.name }))} />
        <LinkButton to="/fertiliser/new" variant="secondary" block>Something new</LinkButton>
        <Chips label="How much?" columns={2} value={unit} onChange={setUnit} options={[{ value: 't', label: 'Tonnes' }, { value: 'bags500', label: '500 kg bags' }, { value: 'bags50', label: '50 kg bags' }, { value: 'kg', label: 'kg' }]} />
        <NumberInput label="Quantity" value={qty} onChange={setQty} unit={unit === 't' ? 't' : unit === 'kg' ? 'kg' : 'bags'} hint={kg > 0 && unit !== 'kg' ? fmtKg(kg) : undefined} />
        <DateChips label="Delivered" value={date} onChange={setDate} />
        <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />
        {state && state.basis !== 'nothing' && kg > 0 && <p className="rounded-xl bg-field-light p-3 text-[0.9375rem] font-semibold">{fmtKg(state.stockKg)} in stock now, {fmtKg(state.stockKg + kg)} after this</p>}
      </Card>
      {money && (
        <Card className="space-y-4">
          <Chips label="Price (optional)" columns={2} value={priceMode} onChange={setPriceMode} options={[{ value: 'per_t', label: `${cur()} per tonne` }, { value: 'total', label: 'Total' }]} />
          <NumberInput label={priceMode === 'per_t' ? 'Price per tonne' : 'Total for this load'} value={price} onChange={setPrice} unit={priceMode === 'per_t' ? `${cur()}/t` : cur()}
            hint={total !== null && priceMode === 'per_t' && kg > 0 ? `${eur(total, true)} for this load` : 'Only what you paid or were charged. It goes in Bills and Money.'} />
          {total !== null && total > 0 && (
            <>
              <Chips label="Paid yet?" columns={2} value={pay} onChange={setPay} options={[{ value: 'paid', label: 'Paid' }, { value: 'owed', label: 'On account' }]}
                hint={pay === 'owed' ? 'Shows in Bills to pay. Cash moves when you mark it paid.' : undefined} />
              {pay === 'owed' && (
                <Field label="Due by (optional)" htmlFor="fert-due">
                  <input id="fert-due" type="date" className="input" value={dueOn} min={date} onChange={(e) => setDueOn(e.target.value)} />
                </Field>
              )}
            </>
          )}
          {lastBill && <p className="text-sm text-muted">Last fertiliser bill to {lastBill.supplier_name}: {eur(Number(lastBill.amount_eur))} on {fmtDay(lastBill.occurred_on)}{lastBill.payment_status === 'owed' ? ', on account' : ''}.</p>}
        </Card>
      )}
      <Card><TextInput label="Note (optional)" value={note} onChange={setNote} voice /></Card>
      <SaveBar><Button block disabled={!product || !(kg > 0)} onClick={submit}>Save delivery</Button></SaveBar>
    </Screen>
  );
}
