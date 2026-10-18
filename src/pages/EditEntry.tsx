import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import type { Op } from '../lib/offline/outbox';
import type { Cost, FarmBundle, FeedTransaction, FertiliserStock, Income, ISODate } from '../lib/types';
import { COST_LABEL, INCOME_LABEL, type CostCategory } from '../lib/types';
import { billOwner, editFeedTxn, priceFor, scaleSpread } from '../lib/editEntry';
import { cur, eur, fmtDay, fmtKg, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, Empty, Field, LinkButton, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { QuantityInput, SupplierPicker } from '../components/pickers';

/**
 * Change something already saved: a delivery, order, stock check, bill, income, fertiliser
 * delivery or spreading, a job or a record. One screen, reached from the diary and from every
 * list that shows the record. Linked records (a delivery's bill, a spreading's fields) move
 * together, and Undo puts every old value back.
 */
type Kind = 'feed' | 'cost' | 'income' | 'fert' | 'spread' | 'job' | 'record';

/** The values a patch is about to replace, so Undo can put them back */
function was(row: object, patch: Record<string, unknown>): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return Object.fromEntries(Object.keys(patch).map((k) => [k, r[k] ?? null]));
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

export default function EditEntry() {
  const { kind, id } = useParams<{ kind: Kind; id: string }>();
  const b = useFarmData();
  const missing = <Screen title="Not found" back><Empty title="That record isn't here any more" action={<LinkButton to="/diary">Back to the diary</LinkButton>} /></Screen>;
  if (kind === 'feed') { const t = b.txns.find((x) => x.id === id); return t ? <FeedEditor key={t.id} t={t} b={b} /> : missing; }
  if (kind === 'cost') { const c = b.costs.find((x) => x.id === id); return c ? <CostEditor key={c.id} c={c} b={b} /> : missing; }
  if (kind === 'income') { const i = b.income.find((x) => x.id === id); return i ? <IncomeEditor key={i.id} i={i} /> : missing; }
  if (kind === 'fert') { const s = b.fertStock.find((x) => x.id === id); return s ? <FertEditor key={s.id} s={s} b={b} /> : missing; }
  if (kind === 'spread') { const s = b.spreads.find((x) => x.id === id); return s ? <SpreadEditor key={s.id} id={s.id} b={b} /> : missing; }
  if (kind === 'job') { const j = b.jobs.find((x) => x.id === id); return j ? <JobEditor key={j.id} id={j.id} b={b} /> : missing; }
  if (kind === 'record') { const r = b.records.find((x) => x.id === id); return r ? <RecordEditor key={r.id} id={r.id} b={b} /> : missing; }
  return missing;
}

function useDone() {
  const nav = useNavigate();
  const loc = useLocation();
  // Land on the screen you came from; a link opened straight in falls back to the diary
  return () => (loc.key !== 'default' ? nav(-1) : nav('/diary', { replace: true }));
}

// ---------------------------------------------------------------------------
// Feed: delivery, order, count, adjustment, opening stock
// ---------------------------------------------------------------------------
const FEED_TITLE: Record<string, string> = { delivery: 'Change a delivery', order: 'Change an order', count: 'Change a stock check', adjustment: 'Change a stock adjustment', opening: 'Change opening stock' };

function FeedEditor({ t, b }: { t: FeedTransaction; b: FarmBundle }) {
  const save = useSave();
  const done = useDone();
  const product = b.products.find((p) => p.id === t.feed_product_id);
  const cost = b.costs.find((c) => c.feed_transaction_id === t.id);
  const money = b.role !== 'worker';
  const isOrder = t.txn_type === 'order';
  const isDelivery = t.txn_type === 'delivery';
  const [kg, setKg] = useState(String(t.quantity_kg));
  const [unit, setUnit] = useState<'kg' | 't'>(Math.abs(Number(t.quantity_kg)) >= 1000 && t.txn_type !== 'adjustment' ? 't' : 'kg');
  const [date, setDate] = useState<ISODate>((isOrder ? t.order_date : isDelivery ? t.delivery_date : null) ?? t.effective_on);
  const [expectedOn, setExpectedOn] = useState<ISODate | null>(t.expected_delivery_date);
  const [supplierId, setSupplierId] = useState<string | null>(t.supplier_id);
  const [priceMode, setPriceMode] = useState<'per_t' | 'total'>(isDelivery && t.price_per_tonne_eur === null && t.total_price_eur !== null ? 'total' : 'per_t');
  const [price, setPrice] = useState(String(priceMode === 'total' ? t.total_price_eur ?? '' : t.price_per_tonne_eur ?? ''));
  const [notes, setNotes] = useState(t.notes ?? '');
  const qty = Number(kg);
  const valid = kg.trim() !== '' && Number.isFinite(qty) && (t.txn_type === 'adjustment' || qty > 0 || t.txn_type === 'count' || t.txn_type === 'opening');
  const { total, perT } = priceFor(qty, priceMode, price);

  async function submit() {
    const supplierName = b.suppliers.find((s) => s.id === supplierId)?.name ?? null;
    const r = editFeedTxn(t, { kg: qty, date, supplierId, priceMode, price, expectedOn, notes }, cost, {
      canWriteMoney: money, productName: product?.name ?? 'Feed', supplierName, newCostId: uuid()
    });
    const ops: Op[] = [{ kind: 'update', table: 'feed_transactions', match: { id: t.id }, patch: r.txn }];
    const undo: Op[] = [{ kind: 'update', table: 'feed_transactions', match: { id: t.id }, patch: was(t, r.txn) }];
    const rc = r.cost;
    let nextCosts = b.costs;
    if (rc?.action === 'update' && cost) {
      ops.push({ kind: 'update', table: 'costs', match: { id: rc.id }, patch: rc.patch });
      undo.push({ kind: 'update', table: 'costs', match: { id: rc.id }, patch: was(cost, rc.patch) });
      nextCosts = b.costs.map((c) => (c.id === rc.id ? { ...c, ...rc.patch } : c));
    } else if (rc?.action === 'insert') {
      ops.push({ kind: 'insert', table: 'costs', row: rc.row as Record<string, unknown> });
      undo.push({ kind: 'delete', table: 'costs', match: { id: rc.row.id } });
      nextCosts = [{ other_label: null, supplier_name: null, ...rc.row } as Cost, ...b.costs];
    } else if (rc?.action === 'delete' && cost) {
      ops.push({ kind: 'delete', table: 'costs', match: { id: rc.id } });
      undo.push({ kind: 'insert', table: 'costs', row: { ...cost } as unknown as Record<string, unknown> });
      nextCosts = b.costs.filter((c) => c.id !== rc.id);
    }
    const ok = await save(ops, {
      label: 'Changed. Stock, run-out and costs are updated',
      patch: (x) => ({ ...x, txns: x.txns.map((y) => (y.id === t.id ? { ...y, ...r.txn } : y)), costs: nextCosts }),
      undo, undoLabel: 'Change undone'
    });
    if (ok) done();
  }

  return (
    <Screen title={FEED_TITLE[t.txn_type] ?? 'Change this'} back sub={product?.name}>
      <Card className="space-y-5">
        {t.txn_type === 'adjustment'
          ? <NumberInput label="How much, in kg" value={kg} onChange={setKg} unit="kg" hint="Minus for stock taken out (wasted, fed elsewhere, sold). Plus for stock found." />
          : <QuantityInput label={t.txn_type === 'count' ? 'What was in the bin' : t.txn_type === 'order' ? 'How much was ordered' : t.txn_type === 'opening' ? 'Opening stock' : 'How much came'} kg={kg} onKg={setKg} unit={unit} onUnit={setUnit} />}
        <DateChips label={isOrder ? 'Ordered on' : isDelivery ? 'Delivered on' : 'Date'} value={date} onChange={setDate} allowFuture={isOrder} />
        {isOrder && (
          <Field label="Expected on (optional)" htmlFor="exp" hint="Only if the supplier gave you a day. It isn't stock until it arrives.">
            <input id="exp" type="date" className="input" value={expectedOn ?? ''} onChange={(e) => setExpectedOn(e.target.value || null)} />
          </Field>
        )}
        {(isDelivery || isOrder) && <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />}
        {(isDelivery || isOrder) && money && (
          <>
            {isDelivery && <Chips label="Price" columns={2} value={priceMode} onChange={(m) => { setPriceMode(m); setPrice(m === 'total' ? String(total ?? '') : String(perT ?? '')); }} options={[{ value: 'per_t', label: `${cur()} per tonne` }, { value: 'total', label: `Total ${cur()}` }]} />}
            <NumberInput label={isOrder ? 'Agreed price per tonne (optional)' : priceMode === 'per_t' ? 'Price per tonne' : 'Total price'} value={price} onChange={setPrice} unit={cur()}
              hint={isDelivery && total !== null && perT !== null ? `${priceMode === 'per_t' ? `Total ${eur(total, true)}` : `${eur(perT, true)} per tonne`}. The bill${cost ? '' : ' (added now)'} follows this.` : isOrder ? 'A commitment, never a cost until it arrives.' : 'Leave empty for no price. Any bill for this delivery is taken off.'} />
            {isDelivery && cost?.payment_status === 'paid' && <p className="rounded-xl bg-pasture p-3 text-[0.9375rem]">The bill is marked paid. Its amount changes with the price; change how and when it was paid from Bills.</p>}
          </>
        )}
        <TextInput label="Note (optional)" value={notes} onChange={setNotes} voice />
      </Card>
      <SaveBar><Button block disabled={!valid} onClick={submit}>Save changes</Button></SaveBar>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Bills and costs
// ---------------------------------------------------------------------------
function CostEditor({ c, b }: { c: Cost; b: FarmBundle }) {
  const save = useSave();
  const done = useDone();
  const fertCostIds = new Set(b.fertStock.map((s) => s.cost_id).filter(Boolean) as string[]);
  const owner = billOwner(c, fertCostIds);
  const ownerId = owner === 'feed_delivery' ? c.feed_transaction_id : b.fertStock.find((s) => s.cost_id === c.id)?.id;
  const [category, setCategory] = useState<CostCategory>(c.category);
  const [amount, setAmount] = useState(String(c.amount_eur));
  const [date, setDate] = useState<ISODate>(c.occurred_on);
  const [payee, setPayee] = useState(c.supplier_name ?? '');
  const [note, setNote] = useState(c.description ?? '');
  const [payState, setPayState] = useState<'paid' | 'owed'>(c.payment_status === 'owed' ? 'owed' : 'paid');
  const [paidOn, setPaidOn] = useState<ISODate>(c.paid_on ?? c.occurred_on);
  const [dueOn, setDueOn] = useState(c.due_on ?? '');
  const [ref, setRef] = useState(c.invoice_ref ?? '');
  const [vat, setVat] = useState(c.vat_eur === null || c.vat_eur === undefined ? '' : String(c.vat_eur));

  async function submit() {
    const patch: Partial<Cost> = {
      ...(owner ? {} : { category, amount_eur: Number(amount), occurred_on: date }),
      supplier_name: payee.trim() || null, description: note.trim() || null,
      payment_status: payState, paid_on: payState === 'paid' ? paidOn : null, due_on: payState === 'owed' && dueOn ? dueOn : null,
      invoice_ref: ref.trim() || null, vat_eur: num(vat)
    };
    const ok = await save([{ kind: 'update', table: 'costs', match: { id: c.id }, patch }], {
      label: 'Bill changed. Cash, budget and the year-end pack are updated',
      patch: (x) => ({ ...x, costs: x.costs.map((y) => (y.id === c.id ? { ...y, ...patch } : y)) }),
      undo: [{ kind: 'update', table: 'costs', match: { id: c.id }, patch: was(c, patch) }], undoLabel: 'Change undone'
    });
    if (ok) done();
  }

  return (
    <Screen title={c.payment_status === 'owed' ? 'Change a bill' : 'Change a cost'} back sub={c.supplier_name ?? COST_LABEL[c.category]}>
      <Card className="space-y-5">
        {owner ? (
          <div className="rounded-xl bg-pasture p-3">
            <p className="font-bold">{eur(Number(c.amount_eur), true)} on {fmtDay(c.occurred_on)}, {COST_LABEL[c.category]}</p>
            <p className="text-[0.9375rem]">This bill comes from a {owner === 'feed_delivery' ? 'feed' : 'fertiliser'} delivery. To change the amount or the day, change the delivery and the bill follows.</p>
            {ownerId && <LinkButton to={`/edit/${owner === 'feed_delivery' ? 'feed' : 'fert'}/${ownerId}`} variant="secondary" className="mt-2">Change the delivery</LinkButton>}
          </div>
        ) : (
          <>
            <Chips label="What for?" columns={2} value={category} onChange={setCategory} options={(Object.keys(COST_LABEL) as CostCategory[]).map((k) => ({ value: k, label: COST_LABEL[k] }))} />
            <NumberInput label="Amount" value={amount} onChange={setAmount} unit={cur()} />
            <DateChips label={payState === 'paid' ? 'Bill date' : 'Bill date'} value={date} onChange={setDate} />
          </>
        )}
        <Chips label="Paid yet?" columns={2} value={payState} onChange={setPayState} options={[{ value: 'paid', label: 'Paid' }, { value: 'owed', label: 'Still to pay' }]}
          hint={payState === 'owed' ? 'Cash only moves when you mark it paid.' : undefined} />
        {payState === 'paid'
          ? <DateChips label="Paid on" value={paidOn} onChange={setPaidOn} />
          : <Field label="Due by (optional)" htmlFor="due"><input id="due" type="date" className="input" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>}
        <TextInput label="Paid to" value={payee} onChange={setPayee} />
        <div className="grid grid-cols-2 gap-2">
          <TextInput label="Invoice no. (optional)" value={ref} onChange={setRef} />
          <NumberInput label="VAT in it (optional)" value={vat} onChange={setVat} unit={cur()} />
        </div>
        <TextInput label="Note (optional)" value={note} onChange={setNote} voice />
      </Card>
      <SaveBar><Button block disabled={(!owner && (!amount || Number(amount) < 0))} onClick={submit}>Save changes</Button></SaveBar>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Income: milk cheques, sales, grants, grain
// ---------------------------------------------------------------------------
function IncomeEditor({ i }: { i: Income }) {
  const save = useSave();
  const done = useDone();
  const [amount, setAmount] = useState(String(i.amount_eur));
  const [date, setDate] = useState<ISODate>(i.occurred_on);
  const [from, setFrom] = useState(i.counterparty ?? '');
  const [desc, setDesc] = useState(i.description ?? '');
  const [litres, setLitres] = useState(i.milk_litres === null ? '' : String(i.milk_litres));
  const [fat, setFat] = useState(i.fat_kg === null ? '' : String(i.fat_kg));
  const [protein, setProtein] = useState(i.protein_kg === null ? '' : String(i.protein_kg));
  const [head, setHead] = useState(i.head_count === null ? '' : String(i.head_count));

  async function submit() {
    const patch: Partial<Income> = {
      amount_eur: Number(amount), occurred_on: date, counterparty: from.trim() || null, description: desc.trim() || null,
      ...(i.income_type === 'milk' ? { milk_litres: num(litres), fat_kg: num(fat), protein_kg: num(protein) } : {}),
      ...(i.income_type === 'livestock' ? { head_count: num(head) } : {})
    };
    const ok = await save([{ kind: 'update', table: 'income', match: { id: i.id }, patch }], {
      label: 'Changed. Income, cash and the year-end pack are updated',
      patch: (x) => ({ ...x, income: x.income.map((y) => (y.id === i.id ? { ...y, ...patch } : y)) }),
      undo: [{ kind: 'update', table: 'income', match: { id: i.id }, patch: was(i, patch) }], undoLabel: 'Change undone'
    });
    if (ok) done();
  }

  return (
    <Screen title={i.income_type === 'milk' ? 'Change a milk cheque' : i.income_type === 'livestock' ? 'Change a sale' : 'Change income'} back sub={INCOME_LABEL[i.income_type]}>
      <Card className="space-y-5">
        <NumberInput label="Amount received" value={amount} onChange={setAmount} unit={cur()} />
        <DateChips label="Received" value={date} onChange={setDate} />
        {i.income_type === 'milk' && (
          <>
            <NumberInput label="Litres (optional)" value={litres} onChange={setLitres} unit="L" />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Fat" value={fat} onChange={setFat} unit="kg" />
              <NumberInput label="Protein" value={protein} onChange={setProtein} unit="kg" />
            </div>
          </>
        )}
        {i.income_type === 'livestock' && (
          <NumberInput label="How many head" value={head} onChange={setHead} integer unit="head"
            hint="This changes the sale only. If the group's head count should change too, change it on Animals, from the day of the sale." />
        )}
        <TextInput label={i.income_type === 'milk' ? 'Processor' : 'From'} value={from} onChange={setFrom} />
        <TextInput label="What for (optional)" value={desc} onChange={setDesc} voice />
      </Card>
      <SaveBar><Button block disabled={!amount || Number(amount) < 0} onClick={submit}>Save changes</Button></SaveBar>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Fertiliser: delivery, check, adjustment, order, opening
// ---------------------------------------------------------------------------
const FERT_TITLE: Record<FertiliserStock['kind'], string> = { opening: 'Change opening stock', delivery: 'Change a fertiliser delivery', count: 'Change a stock check', adjustment: 'Change a stock adjustment', order: 'Change a fertiliser order' };

function FertEditor({ s, b }: { s: FertiliserStock; b: FarmBundle }) {
  const save = useSave();
  const done = useDone();
  const product = b.fertilisers.find((p) => p.id === s.product_id);
  const [kg, setKg] = useState(String(s.quantity_kg));
  const [unit, setUnit] = useState<'kg' | 't'>(Math.abs(Number(s.quantity_kg)) >= 1000 && s.kind !== 'adjustment' ? 't' : 'kg');
  const [date, setDate] = useState<ISODate>(s.on_date);
  const [expected, setExpected] = useState(s.expected_on ?? '');
  const [supplierId, setSupplierId] = useState<string | null>(s.supplier_id);
  const [ppt, setPpt] = useState(s.price_per_tonne_eur === null || s.price_per_tonne_eur === undefined ? '' : String(s.price_per_tonne_eur));
  const [notes, setNotes] = useState(s.notes ?? '');
  const hasSupplier = s.kind === 'delivery' || s.kind === 'order';

  async function submit() {
    const patch: Partial<FertiliserStock> = {
      quantity_kg: Number(kg), on_date: date, notes: notes.trim() || null,
      ...(hasSupplier ? { supplier_id: supplierId } : {}),
      ...(s.kind === 'order' ? { expected_on: expected || null, price_per_tonne_eur: num(ppt) } : {})
    };
    const ok = await save([{ kind: 'update', table: 'fertiliser_stock', match: { id: s.id }, patch }], {
      label: 'Changed. Fertiliser stock is updated',
      patch: (x) => ({ ...x, fertStock: x.fertStock.map((y) => (y.id === s.id ? { ...y, ...patch } : y)) }),
      undo: [{ kind: 'update', table: 'fertiliser_stock', match: { id: s.id }, patch: was(s, patch) }], undoLabel: 'Change undone'
    });
    if (ok) done();
  }

  return (
    <Screen title={FERT_TITLE[s.kind]} back sub={product?.name}>
      <Card className="space-y-5">
        {s.kind === 'adjustment'
          ? <NumberInput label="How much, in kg" value={kg} onChange={setKg} unit="kg" hint="Minus for stock taken out, plus for stock found." />
          : <QuantityInput label={s.kind === 'count' ? 'What is in the shed' : s.kind === 'order' ? 'How much was ordered' : 'How much'} kg={kg} onKg={setKg} unit={unit} onUnit={setUnit} />}
        <DateChips label={s.kind === 'order' ? 'Ordered on' : 'Date'} value={date} onChange={setDate} allowFuture={s.kind === 'order'} />
        {s.kind === 'order' && (
          <>
            <Field label="Expected on (optional)" htmlFor="fexp"><input id="fexp" type="date" className="input" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            {b.role !== 'worker' && <NumberInput label="Agreed price per tonne (optional)" value={ppt} onChange={setPpt} unit={cur()} />}
          </>
        )}
        {hasSupplier && <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />}
        {s.kind === 'delivery' && s.cost_id && (
          <p className="rounded-xl bg-pasture p-3 text-[0.9375rem]">The price is on the bill. <Link className="font-bold text-accent underline" to={`/edit/cost/${s.cost_id}`}>Change the bill</Link></p>
        )}
        <TextInput label="Note (optional)" value={notes} onChange={setNotes} voice />
      </Card>
      <SaveBar><Button block disabled={kg.trim() === '' || !Number.isFinite(Number(kg))} onClick={submit}>Save changes</Button></SaveBar>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// A spreading: total and day (each field's share moves with the total)
// ---------------------------------------------------------------------------
function SpreadEditor({ id, b }: { id: string; b: FarmBundle }) {
  const save = useSave();
  const done = useDone();
  const s = b.spreads.find((x) => x.id === id)!;
  const product = b.fertilisers.find((p) => p.id === s.product_id);
  const [kg, setKg] = useState(String(s.total_kg));
  const [unit, setUnit] = useState<'kg' | 't'>('kg');
  const [date, setDate] = useState<ISODate>(s.spread_on);
  const [notes, setNotes] = useState(s.notes ?? '');
  const fields = b.spreadFields.filter((f) => f.spread_id === s.id);

  async function submit() {
    const scaled = scaleSpread(s, b.spreadFields, Number(kg));
    const spreadPatch = { ...scaled.spread, spread_on: date, notes: notes.trim() || null };
    const ops: Op[] = [
      { kind: 'update', table: 'fertiliser_spreads', match: { id: s.id }, patch: spreadPatch },
      ...scaled.fields.map((f) => ({ kind: 'update' as const, table: 'fertiliser_spread_fields', match: { id: f.id }, patch: { kg: f.kg } }))
    ];
    const undo: Op[] = [
      { kind: 'update', table: 'fertiliser_spreads', match: { id: s.id }, patch: was(s, spreadPatch) },
      ...fields.map((f) => ({ kind: 'update' as const, table: 'fertiliser_spread_fields', match: { id: f.id }, patch: { kg: f.kg } }))
    ];
    const ok = await save(ops, {
      label: 'Changed. Fertiliser stock and field dates are updated',
      patch: (x) => ({
        ...x, spreads: x.spreads.map((y) => (y.id === s.id ? { ...y, ...spreadPatch } : y)),
        spreadFields: x.spreadFields.map((y) => { const n = scaled.fields.find((f) => f.id === y.id); return n ? { ...y, kg: n.kg } : y; })
      }),
      undo, undoLabel: 'Change undone'
    });
    if (ok) done();
  }

  return (
    <Screen title="Change a spreading" back sub={product?.name}>
      <Card className="space-y-5">
        <QuantityInput label="Total spread" kg={kg} onKg={setKg} unit={unit} onUnit={setUnit}
          hint={fields.length > 1 ? `Each of the ${fields.length} fields keeps its share of the new total.` : undefined} />
        <DateChips label="Spread on" value={date} onChange={setDate} />
        <TextInput label="Note (optional)" value={notes} onChange={setNotes} voice />
        <p className="text-[0.9375rem] text-muted">{fmtKg(Number(s.total_kg))} before. Fields are changed on the Fields screen.</p>
      </Card>
      <SaveBar><Button block disabled={!kg || Number(kg) <= 0} onClick={submit}>Save changes</Button></SaveBar>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Jobs and records
// ---------------------------------------------------------------------------
function JobEditor({ id, b }: { id: string; b: FarmBundle }) {
  const save = useSave();
  const done = useDone();
  const j = b.jobs.find((x) => x.id === id)!;
  const [title, setTitle] = useState(j.title);
  const [due, setDue] = useState<ISODate | ''>(j.due_on ?? '');
  async function submit() {
    const patch = { title: title.trim(), due_on: due || null };
    const ok = await save([{ kind: 'update', table: 'jobs', match: { id: j.id }, patch }], {
      label: 'Job changed', patch: (x) => ({ ...x, jobs: x.jobs.map((y) => (y.id === j.id ? { ...y, ...patch } : y)) }),
      undo: [{ kind: 'update', table: 'jobs', match: { id: j.id }, patch: was(j, patch) }], undoLabel: 'Change undone'
    });
    if (ok) done();
  }
  return (
    <Screen title="Change a job" back>
      <Card className="space-y-5">
        <TextInput label="Job" value={title} onChange={setTitle} voice />
        <DateChips label="Due" value={due || j.due_on || new Date().toISOString().slice(0, 10)} onChange={setDue} allowFuture />
        {due && <Button variant="ghost" onClick={() => setDue('')}>No due date</Button>}
      </Card>
      <SaveBar><Button block disabled={!title.trim()} onClick={submit}>Save changes</Button></SaveBar>
    </Screen>
  );
}

function RecordEditor({ id, b }: { id: string; b: FarmBundle }) {
  const save = useSave();
  const done = useDone();
  const r = b.records.find((x) => x.id === id)!;
  const [title, setTitle] = useState(r.title);
  const [date, setDate] = useState<ISODate>(r.occurred_on);
  async function submit() {
    const patch = { title: title.trim(), occurred_on: date };
    const ok = await save([{ kind: 'update', table: 'farm_records', match: { id: r.id }, patch }], {
      label: 'Record changed', patch: (x) => ({ ...x, records: x.records.map((y) => (y.id === r.id ? { ...y, ...patch } : y)) }),
      undo: [{ kind: 'update', table: 'farm_records', match: { id: r.id }, patch: was(r, patch) }], undoLabel: 'Change undone'
    });
    if (ok) done();
  }
  return (
    <Screen title="Change a record" back>
      <Card className="space-y-5">
        <TextInput label="Title" value={title} onChange={setTitle} voice />
        <DateChips label="Date" value={date} onChange={setDate} />
      </Card>
      <SaveBar><Button block disabled={!title.trim()} onClick={submit}>Save changes</Button></SaveBar>
    </Screen>
  );
}
