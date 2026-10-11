import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { applyInvoice, deliveryCost, planInvoice, similarCost, uninvoicedDeliveries } from '../lib/forecast/bills';
import { clearPendingPhoto, peekPendingPhoto, peekPendingQueueId, peekPendingRead } from '../lib/pendingPhoto';
import { usable } from '../lib/docket/extract';
import { extractedRecord, keepEvidence } from '../lib/docket/flow';
import { dropToRead } from '../lib/docket/photoStore';
import { ReadSummary } from '../components/PhotoRead';
import { useToast } from '../components/Toast';
import { eur, fmtDay, fmtKg, todayISO, uuid } from '../lib/format';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, DateChips, Field, LinkButton, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { PhotoInput, SupplierPicker } from '../components/pickers';

/**
 * A supplier invoice for feed already delivered (review gap P0: order-to-payment).
 * The invoice is put on the deliveries it covers: their costs become the invoice amounts,
 * so the feed is counted once, at the price actually charged. It can be paid now or owed.
 */
export default function InvoiceForm() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const toast = useToast();
  const today = todayISO();
  const [read] = useState(() => peekPendingRead());
  const [photo, setPhoto] = useState<File | null>(() => peekPendingPhoto());
  useEffect(() => () => clearPendingPhoto(), []);

  const rSupplier = usable(read?.supplier)?.supplierId ?? null;
  const [supplierId, setSupplierId] = useState<string | null>(params.get('supplier') ?? rSupplier ?? null);
  const [date, setDate] = useState(params.get('date') ?? usable(read?.date) ?? today);
  const [ref, setRef] = useState(params.get('ref') ?? usable(read?.docNumber) ?? '');
  const [total, setTotal] = useState(params.get('total') ?? (usable(read?.total) !== undefined ? String(usable(read?.total)) : ''));
  const [vat, setVat] = useState(params.get('vat') ?? (usable(read?.vat) ? String(usable(read?.vat)!.eur) : ''));
  const [payState, setPayState] = useState<'owed' | 'paid'>('owed');
  const [dueOn, setDueOn] = useState('');
  const [paidOn, setPaidOn] = useState(today);

  const candidates = useMemo(() => uninvoicedDeliveries(b, supplierId, date), [b, supplierId, date]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // Until the farmer changes it: the delivery matching the photo's quantity, else every candidate
  const readKg = read?.quantity && read.quantity.confidence !== 'low' ? read.quantity.value.kg : null;
  const sized = readKg === null ? [] : candidates.filter((t) => Math.abs(Number(t.quantity_kg) - readKg) <= readKg * 0.05);
  const chosen = picked ?? new Set((sized.length ? sized : candidates).map((t) => t.id));
  const toggle = (id: string) => setPicked(() => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const supplierName = b.suppliers.find((s) => s.id === supplierId)?.name ?? null;
  const newIds = useMemo(() => Object.fromEntries(candidates.map((t) => [t.id, uuid()])), [candidates]);
  const plan = useMemo(() => {
    try {
      return planInvoice(b, {
        supplierId, supplierName, ref: ref.trim() || null, invoiceDate: date, dueOn: dueOn || null, total: Number(total), vat: vat === '' ? null : Number(vat),
        documentId: null, paidOn: payState === 'paid' ? paidOn : null, deliveryIds: candidates.filter((t) => chosen.has(t.id)).map((t) => t.id), newIds
      });
    } catch { return null; }
  }, [b, supplierId, supplierName, ref, date, dueOn, total, vat, payState, paidOn, candidates, chosen, newIds]);
  const dupe = ref.trim() ? similarCost(b, { amount: -1, payee: null, date, ref: ref.trim() }) : undefined;

  async function submit() {
    if (!plan) return;
    const evidence = photo ? await keepEvidence(photo, farmId!, 'invoice', true, read ? extractedRecord(read, []) : null) : null;
    const documentId = evidence?.documentId ?? null;
    const final = planInvoice(b, {
      supplierId, supplierName, ref: ref.trim() || null, invoiceDate: date, dueOn: dueOn || null, total: Number(total), vat: vat === '' ? null : Number(vat),
      documentId, paidOn: payState === 'paid' ? paidOn : null, deliveryIds: plan.lines.map((l) => l.delivery.id), newIds
    });
    const ops: Op[] = final.ops.map((o) => (o.kind === 'insert'
      ? { kind: 'insert', table: o.table, row: o.row! }
      : { kind: 'update', table: o.table, match: o.match!, patch: o.patch! }));
    // Undo puts every cost and delivery back exactly as it was
    const undo: Op[] = final.lines.flatMap((l): Op[] => {
      const t = l.delivery;
      const back: Op[] = [{ kind: 'update', table: 'feed_transactions', match: { id: t.id }, patch: { total_price_eur: t.total_price_eur, price_per_tonne_eur: t.price_per_tonne_eur } }];
      if (l.newCost) back.push({ kind: 'delete', table: 'costs', match: { id: l.costId } });
      else {
        const c = deliveryCost(b, t.id)!;
        back.push({ kind: 'update', table: 'costs', match: { id: c.id }, patch: { amount_eur: c.amount_eur, vat_eur: c.vat_eur ?? null, invoice_ref: c.invoice_ref ?? null, due_on: c.due_on ?? null, payment_status: c.payment_status ?? 'paid', paid_on: c.paid_on ?? null, document_id: c.document_id } });
      }
      return back;
    });
    const ok = await save(ops, {
      label: `Invoice matched to ${final.lines.length} deliver${final.lines.length === 1 ? 'y' : 'ies'}${payState === 'owed' ? `. Owed${dueOn ? `, due ${fmtDay(dueOn)}` : ''}` : '. Paid'}`,
      patch: (x) => applyInvoice(x, final),
      undo,
      undoLabel: 'Invoice taken off'
    });
    if (!ok) return;
    if (evidence && final.lines[0]) {
      const queued = await evidence.later({ table: 'costs', id: final.lines[0].costId });
      if (queued) toast.show({ message: 'Photo kept on this phone. It uploads when you have signal.', tone: 'info' });
    }
    const queueId = peekPendingQueueId();
    if (queueId) dropToRead(queueId);
    nav(payState === 'owed' ? '/money/bills' : '/money', { replace: true });
  }

  return (
    <Screen title="Feed invoice" back sub="For feed already delivered">
      {read && <ReadSummary read={read} photo={photo} onUse={(f, v) => { if (f === 'date') setDate(String(v)); if (f === 'total') setTotal(String(v)); }} />}
      <Card className="space-y-5">
        <SupplierPicker b={b} value={supplierId} onChange={(id) => { setSupplierId(id); setPicked(null); }} label="From" />
        <div className="grid grid-cols-2 gap-2">
          <TextInput label="Invoice no." value={ref} onChange={setRef} />
          <NumberInput label="Total, VAT in" value={total} onChange={setTotal} unit="€" />
        </div>
        <NumberInput label="VAT in it (optional)" value={vat} onChange={setVat} unit="€" />
        <DateChips label="Invoice date" value={date} onChange={(d) => { setDate(d); setPicked(null); }} />
        {dupe && <p role="alert" className="rounded-xl bg-warn-bg p-3 font-semibold text-warn">Invoice {ref} is already recorded ({eur(Number(dupe.amount_eur), true)}, {fmtDay(dupe.occurred_on)}).</p>}
      </Card>

      <Card className="space-y-2">
        <p className="text-[1.0625rem] font-bold">Which deliveries is it for?</p>
        {candidates.length === 0 ? (
          <>
            <p className="text-muted">No deliveries {supplierName ? `from ${supplierName} ` : ''}without an invoice in the four months before {fmtDay(date)}.</p>
            <LinkButton to={`/record/cost?category=feed&owed=1`} variant="secondary" block>Record it as a bill instead</LinkButton>
          </>
        ) : (
          <ul className="divide-y divide-line">
            {candidates.map((t) => {
              const c = deliveryCost(b, t.id);
              const line = plan?.lines.find((l) => l.delivery.id === t.id);
              const name = b.products.find((p) => p.id === t.feed_product_id)?.name ?? 'Feed';
              return (
                <li key={t.id}>
                  <label className="flex min-h-[3.5rem] items-center gap-3">
                    <input type="checkbox" className="h-6 w-6 accent-field" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} />
                    <span className="min-w-0 flex-1">
                      <b className="block">{name}, {fmtKg(Number(t.quantity_kg))}</b>
                      <span className="text-sm text-muted">Delivered {fmtDay(t.effective_on)}. {c ? `Docket ${eur(Number(c.amount_eur), true)}` : 'No price yet'}</span>
                    </span>
                    {line && <b className="shrink-0">{eur(line.after, true)}</b>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {plan && (
          <p className="rounded-xl bg-field-light p-3 text-[0.9375rem]">
            {plan.priced > 0
              ? <>The invoice replaces the docket prices: {eur(plan.before, true)} becomes {eur(plan.after, true)}{Math.abs(plan.difference) >= 0.01 && <> ({plan.difference > 0 ? '+' : '−'}{eur(Math.abs(plan.difference), true)})</>}. </>
              : <>Puts {eur(plan.after, true)} on these deliveries. </>}
            Nothing is added twice.
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <Chips label="Paid yet?" columns={2} value={payState} onChange={setPayState} options={[{ value: 'owed', label: 'Still to pay' }, { value: 'paid', label: 'Paid' }]} />
        {payState === 'owed'
          ? <Field label="Due by (optional)" htmlFor="due"><input id="due" type="date" className="input" value={dueOn} min={date} onChange={(e) => setDueOn(e.target.value)} /></Field>
          : <DateChips label="Paid on" value={paidOn} onChange={setPaidOn} />}
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <SaveBar><Button block disabled={!plan} onClick={submit}>Match invoice</Button></SaveBar>
    </Screen>
  );
}
