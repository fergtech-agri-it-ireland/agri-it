import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { forecastFeed } from '../lib/forecast/feed';
import type { Evidence, FeedTransaction } from '../lib/types';
import { eur, fmtDay, fmtKg, fmtMonth, todayISO, uuid } from '../lib/format';
import { budgetVsActual, fyRange } from '../lib/forecast/money';
import { clearPendingPhoto, peekPendingPhoto, peekPendingQueueId, peekPendingRead } from '../lib/pendingPhoto';
import { usable } from '../lib/docket/extract';
import { extractedRecord, keepEvidence } from '../lib/docket/flow';
import { dropToRead } from '../lib/docket/photoStore';
import { NotReadTag, ReadSummary, ReadTag } from '../components/PhotoRead';
import { showSaved } from '../lib/saved';
import { useToast } from '../components/Toast';
import { Button, Card, Chips, DateChips, Empty, LinkButton, NumberInput, SaveBar, Screen } from '../components/ui';
import { FeedPicker, PhotoInput, QuantityInput, SupplierPicker } from '../components/pickers';
import { priceCheck, pricePoints } from '../lib/forecast/prices';
import { PriceCheckNote } from '../components/Prices';

/** "Feed arrived": feed → quantity → Save. Everything else is prefilled from history. */
export default function DeliveryForm() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const toast = useToast();
  const nav = useNavigate();
  const today = todayISO();
  const products = b.products.filter((p) => !p.archived);
  const lastDelivery = (pid: string | null) => b.txns.filter((t) => t.feed_product_id === pid && t.txn_type === 'delivery').sort((a, c) => c.effective_on.localeCompare(a.effective_on))[0];
  const openOrder = (pid: string | null, oid?: string | null) =>
    b.txns.find((t) => t.txn_type === 'order' && t.order_status === 'open' && (oid ? t.id === oid : t.feed_product_id === pid));

  // Read from a photo: only what the photo showed is filled in, never last time's values
  const [read] = useState(() => peekPendingRead());
  const rFeed = usable(read?.product)?.feedProductId ?? null;
  const rKg = usable(read?.quantity)?.kg;
  const rDate = usable(read?.date);
  const rSupplier = usable(read?.supplier)?.supplierId ?? null;
  const rPerT = usable(read?.pricePerTonne);
  const rTotal = usable(read?.total);

  const initialFeed = read ? rFeed : params.get('feed') ?? (products.length === 1 ? products[0].id : null);
  const initialOrder = openOrder(initialFeed, params.get('order'));
  const initialLast = read ? undefined : lastDelivery(initialFeed);

  const [feedId, setFeedId] = useState<string | null>(initialFeed);
  const [orderId, setOrderId] = useState<string | null>(initialOrder?.id ?? null);
  const [supplierId, setSupplierId] = useState<string | null>(read ? rSupplier : initialOrder?.supplier_id ?? b.products.find((p) => p.id === initialFeed)?.supplier_id ?? null);
  const [kg, setKg] = useState(read ? (rKg !== undefined ? String(rKg) : '') : initialOrder ? String(initialOrder.quantity_kg) : initialLast ? String(initialLast.quantity_kg) : '');
  const [unit, setUnit] = useState<'kg' | 't'>('t');
  const [date, setDate] = useState(rDate ?? today);
  const [priceMode, setPriceMode] = useState<'per_t' | 'total'>(read && rPerT === undefined && rTotal !== undefined ? 'total' : 'per_t');
  const [price, setPrice] = useState(read ? String(rPerT ?? rTotal ?? '') : initialLast?.price_per_tonne_eur ? String(initialLast.price_per_tonne_eur) : '');
  // A docket in hand is checked as you save; an invoice is not proof of what arrived until confirmed
  const [evidence, setEvidence] = useState<Evidence>(!read ? 'confirmed_docket' : read.kind === 'docket' ? 'confirmed_docket' : read.kind === 'unknown' ? 'unconfirmed' : 'invoice_derived');
  const [photo, setPhoto] = useState<File | null>(() => peekPendingPhoto());
  useEffect(() => () => clearPendingPhoto(), []);
  const [busy, setBusy] = useState(false);

  function pickFeed(id: string) {
    setFeedId(id);
    if (read) {
      // Keep what the photo showed; only link an open order and fill a supplier the photo didn't show
      const o = openOrder(id);
      setOrderId(o?.id ?? null);
      if (!supplierId) setSupplierId(o?.supplier_id ?? null);
      return;
    }
    const o = openOrder(id);
    const last = lastDelivery(id);
    setOrderId(o?.id ?? null);
    setSupplierId(o?.supplier_id ?? b.products.find((p) => p.id === id)?.supplier_id ?? null);
    setKg(o ? String(o.quantity_kg) : last ? String(last.quantity_kg) : '');
    setPrice(last?.price_per_tonne_eur ? String(last.price_per_tonne_eur) : '');
  }

  const edited = {
    feed: !!read?.product && feedId !== rFeed,
    quantity: !!read?.quantity && rKg !== undefined && Number(kg) !== rKg,
    date: !!read?.date && rDate !== undefined && date !== rDate,
    supplier: !!read?.supplier && supplierId !== rSupplier,
    price: (rPerT !== undefined || rTotal !== undefined) && price !== String(rPerT ?? rTotal)
  };
  const changed = Object.entries(edited).filter(([, v]) => v).map(([k]) => k);

  const qty = Number(kg);
  const total = price === '' ? null : priceMode === 'total' ? Number(price) : (Number(price) * qty) / 1000;
  const perT = price === '' ? null : priceMode === 'per_t' ? Number(price) : qty > 0 ? Number(price) / (qty / 1000) : null;

  const points = useMemo(() => pricePoints(b), [b]);
  const check = feedId ? priceCheck(points, feedId, supplierId, perT) : null;
  const samePrice = check !== null && Math.abs(check.diffPerT) < 0.005;

  const draft: FeedTransaction | null = feedId && qty > 0 ? {
    id: 'draft', farm_id: farmId!, feed_product_id: feedId, txn_type: 'delivery', quantity_kg: qty, order_date: null, delivery_date: date,
    expected_delivery_date: null, effective_on: date, order_status: null, linked_order_id: orderId, supplier_id: supplierId,
    total_price_eur: total, price_per_tonne_eur: perT, evidence, document_id: null, notes: null, created_at: new Date().toISOString()
  } : null;

  // Live preview: show what the delivery does to the run-out date before saving
  const preview = useMemo(() => {
    if (!draft) return null;
    const p = b.products.find((x) => x.id === feedId)!;
    const input = { product: p, rules: b.rules.filter((r) => r.feed_product_id === feedId), groups: b.groups, supplierSetting: b.supplierSettings.find((s) => s.supplier_id === supplierId), farmLeadTimeDays: b.farm.default_lead_time_days, today, logs: b.feedLogs.filter((l) => l.feed_product_id === feedId) };
    const txns = b.txns.filter((t) => t.feed_product_id === feedId);
    return { before: forecastFeed({ ...input, txns }), after: forecastFeed({ ...input, txns: [...txns, draft] }) };
  }, [draft?.quantity_kg, draft?.effective_on, feedId, supplierId, b]); // eslint-disable-line

  if (!products.length) return <Screen title="Feed arrived" back><Empty title="Add a feed first" body="Takes 30 seconds, then deliveries are one tap." action={<LinkButton to="/feed/new">Add a feed</LinkButton>} /></Screen>;

  async function submit() {
    if (!draft) return;
    setBusy(true);
    const evidencePhoto = photo ? await keepEvidence(photo, farmId!, 'feed_docket', evidence === 'confirmed_docket', read ? extractedRecord(read, changed) : null) : null;
    const documentId = evidencePhoto?.documentId ?? null;
    const reference = usable(read?.docNumber);
    const id = uuid();
    const result = await save([{
      kind: 'rpc', fn: 'record_feed_delivery', args: {
        p_id: id, p_farm_id: farmId, p_feed_product_id: feedId, p_quantity_kg: qty, p_delivery_date: date, p_supplier_id: supplierId,
        p_order_date: orderId ? b.txns.find((t) => t.id === orderId)?.order_date ?? null : null,
        p_total_price_eur: priceMode === 'total' && price !== '' ? Number(price) : null,
        p_price_per_tonne_eur: priceMode === 'per_t' && price !== '' ? Number(price) : null,
        p_evidence: evidence, p_linked_order_id: orderId, p_document_id: documentId,
        p_notes: reference ? `${read?.kind === 'invoice' ? 'Invoice' : read?.kind === 'receipt' ? 'Receipt' : 'Docket'} ${reference}` : null
      }
    }], {
      label: 'Delivery saved',
      quiet: true,
      patch: (x) => ({
        ...x,
        txns: [...x.txns.map((t) => (t.id === orderId ? { ...t, order_status: 'delivered' as const } : t)), { ...draft, id, document_id: documentId }]
      }),
      undo: [{ kind: 'rpc', fn: 'undo_feed_delivery', args: { p_id: id } }],
      undoLabel: 'Delivery removed'
    });
    setBusy(false);
    if (!result) return;
    const photoQueued = evidencePhoto ? await evidencePhoto.later({ table: 'feed_transactions', id }) : false;
    if (photoQueued) toast.show({ message: 'Photo kept on this phone. It uploads when you have signal.', tone: 'info' });
    const queueId = peekPendingQueueId();
    if (queueId) dropToRead(queueId);

    // Before/after for the Saved screen, from the same engines the app uses everywhere
    const product = b.products.find((p) => p.id === feedId)!;
    const supplierName = b.suppliers.find((s) => s.id === supplierId)?.name ?? null;
    const fy = fyRange(b.farm, today);
    const feedSpend = b.costs.filter((c) => c.category === 'feed' && c.occurred_on >= fy.start && c.occurred_on <= fy.end).reduce((s, c) => s + Number(c.amount_eur), 0);
    const feedBudget = budgetVsActual(b.farm, b, today).rows.find((r) => r.kind === 'cost' && r.category === 'feed')?.budget ?? 0;
    const before = preview?.before;
    const after = preview?.after;
    const days = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.floor(n));
    showSaved(nav, result, {
      title: 'Delivery saved',
      subtitle: `${product.name}, ${fmtKg(qty)}${supplierName ? ` from ${supplierName}` : ''}`,
      compare: days(before?.daysRemaining) !== null && days(after?.daysRemaining) !== null
        ? { label: `Days of ${product.name} left`, before: days(before!.daysRemaining)!, after: days(after!.daysRemaining)!, unit: 'days' }
        : undefined,
      rows: [
        ...(after?.runOutDate ? [{ label: 'Runs out', before: before?.runOutDate ? fmtDay(before.runOutDate) : null, after: fmtDay(after.runOutDate) }] : []),
        ...(after?.orderByDate ? [{ label: 'Order by', before: before?.orderByDate ? fmtDay(before.orderByDate) : null, after: fmtDay(after.orderByDate) }] : []),
        ...(total ? [{ label: 'Feed spend this year', before: eur(feedSpend), after: eur(feedSpend + total), sub: feedBudget > 0 ? `of ${eur(feedBudget)} budget so far` : undefined }] : [])
      ],
      note: total
        ? `Also added ${eur(total)} to ${fmtMonth(date.slice(0, 7))} costs${supplierName ? ` and ${supplierName}'s history` : ''}.${check && check.trend !== 'same' ? ` That's ${eur(Math.abs(check.diffPerT))}/t ${check.trend === 'up' ? 'more' : 'less'} than last time (${eur(check.against.eurPerT)}/t).` : ''}`
        : 'No price entered, so costs and cash are unchanged. You can add the invoice later.',
      undo: [{ kind: 'rpc', fn: 'undo_feed_delivery', args: { p_id: id } }],
      undoLabel: 'Delivery removed',
      photo: documentId || photoQueued ? undefined : { table: 'feed_transactions', id, recordType: 'feed_docket' },
      again: { label: 'Another delivery', to: '/record/delivery' }
    });
  }

  const order = orderId ? b.txns.find((t) => t.id === orderId) : null;
  return (
    <Screen title="Feed arrived" back>
      {read && <ReadSummary read={read} photo={photo} onUse={(f, v) => {
        if (f === 'quantity') { setKg(String(v)); setUnit(Number(v) >= 1000 ? 't' : 'kg'); }
        if (f === 'date') setDate(String(v));
        if (f === 'pricePerTonne') { setPriceMode('per_t'); setPrice(String(v)); }
        if (f === 'total') { setPriceMode('total'); setPrice(String(v)); }
      }} />}
      <Card className="space-y-5">
        <div>
          <FeedPicker b={b} value={feedId} onChange={pickFeed} />
          {read?.product && <ReadTag field="feed" read={{ ...read.product, confidence: rFeed ? read.product.confidence : 'low', note: rFeed ? read.product.note : `Read "${read.product.value.text}". It isn't one of your feeds: pick the feed it is, or add it first` }} edited={edited.feed && !!rFeed} />}
          {read && !read.product && <NotReadTag field="feed" what="which feed" />}
        </div>
        {order && (
          <label className="flex min-h-tap items-center gap-3 rounded-xl bg-hivis/30 px-3 font-bold">
            <input type="checkbox" className="h-6 w-6 accent-field" checked={!!orderId} onChange={(e) => setOrderId(e.target.checked ? order.id : null)} />
            This is the {fmtKg(Number(order.quantity_kg))} ordered {fmtDay(order.order_date)}
          </label>
        )}
        <div>
          <QuantityInput label="How much came?" kg={kg} onKg={setKg} unit={unit} onUnit={setUnit} hint={!read && lastDelivery(feedId) ? 'Filled in from your last delivery' : undefined} />
          {read && (read.quantity ? <ReadTag field="quantity" read={read.quantity} edited={edited.quantity} /> : <NotReadTag field="quantity" what="the quantity" />)}
        </div>
        <div>
          <DateChips label="Delivered" value={date} onChange={setDate} />
          {read && (read.date && rDate ? <ReadTag field="date" read={read.date} edited={edited.date} /> : <NotReadTag field="date" what="the date (today is filled in)" />)}
        </div>
      </Card>

      {preview && preview.after.runOutDate && (
        <Card className="bg-field text-white">
          <p className="text-white/85">With this delivery</p>
          <p className="text-xl font-bold">Runs out {fmtDay(preview.after.runOutDate)}{preview.after.orderByDate && `, order by ${fmtDay(preview.after.orderByDate)}`}</p>
          {preview.before.runOutDate && <p className="text-sm text-white/85">Was {fmtDay(preview.before.runOutDate)}</p>}
        </Card>
      )}

      <Card className="space-y-5">
        <div>
          <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />
          {read && (read.supplier
            ? <ReadTag field="supplier" read={{ ...read.supplier, confidence: rSupplier ? read.supplier.confidence : 'low', note: rSupplier ? read.supplier.note : `Read "${read.supplier.value.text}". Not in your suppliers: pick one`, }} edited={edited.supplier && !!rSupplier} />
            : <NotReadTag field="supplier" what="the supplier" />)}
        </div>
        <Chips label="Price" columns={2} value={priceMode} onChange={setPriceMode} options={[{ value: 'per_t', label: '€ per tonne' }, { value: 'total', label: 'Total €' }]} />
        <NumberInput label={priceMode === 'per_t' ? 'Price per tonne' : 'Total price'} value={price} onChange={setPrice} unit="€"
          hint={total !== null && perT !== null
            ? `${priceMode === 'per_t' ? `Total ${eur(total, true)}` : `${eur(perT, true)} per tonne`}${samePrice ? `. Same as your last delivery (${fmtDay(check!.against.date)}): check the docket` : ''}`
            : 'Optional. Adds to feed costs and cash flow.'} />
        {read && (rPerT !== undefined ? <ReadTag field="price" read={read.pricePerTonne} edited={edited.price} />
          : rTotal !== undefined ? <ReadTag field="price" read={read.total} edited={edited.price} />
          : <NotReadTag field="price" what="a price" />)}
        {!samePrice && <PriceCheckNote c={check} />}
        <Chips label="Quantity checked against" columns={3} value={evidence} onChange={setEvidence} options={[
          { value: 'confirmed_docket', label: 'Docket' }, { value: 'invoice_derived', label: 'Invoice' }, { value: 'unconfirmed', label: 'Not checked' }
        ]} hint={read && read.kind !== 'docket'
          ? 'Set to Invoice because this came from an invoice or receipt. Confirm it in Records once you\'ve checked what arrived.'
          : 'Unchecked quantities lower forecast confidence until confirmed.'} />
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <SaveBar><Button block disabled={!draft || busy} onClick={submit}>{busy ? 'Saving' : 'Save delivery'}</Button></SaveBar>
    </Screen>
  );
}
