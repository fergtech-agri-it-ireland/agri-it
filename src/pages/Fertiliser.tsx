import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink, Plus, Sprout } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import type { FertiliserStock } from '../lib/types';
import { eur, fmtDate, fmtDay, fmtKg, todayISO, uuid } from '../lib/format';
import { GUIDANCE, needsRecheck, ruleSourceLine } from '../lib/spreading';
import { catalogueItem } from '../lib/catalogue';
import { Button, Card, Chips, Empty, Explain, LinkButton, List, NumberInput, Row, Screen, SectionTitle, Sheet } from '../components/ui';
import { CsoCompare } from '../components/CsoCompare';
import { WhyDifferent } from '../components/WhyDifferent';
import { REASON_SHORT, REASON_TEXT, reasonTally, worthAsking, type StockReason } from '../lib/stockReasons';
import { fertiliserVariances } from '../lib/forecast/fertiliser';
import { openFertOrders } from '../lib/forecast/bills';

/** Fertiliser: the spreading season, what's in the shed, and which fields are due. */
export default function Fertiliser() {
  const b = useFarmData();
  const d = useDerived(b);
  const f = d.fertiliser;
  const today = todayISO();
  const s = f.season;
  const zone = s ? (s.rule.zone === 'NI' ? 'Northern Ireland' : `Zone ${s.rule.zone}`) : null;
  const recent = [...b.spreads].sort((x, y) => y.spread_on.localeCompare(x.spread_on) || (y.created_at ?? '').localeCompare(x.created_at ?? '')).slice(0, 8);
  return (
    <Screen title="Fertiliser" back="/more" right={<LinkButton to="/fertiliser/new"><Plus className="h-5 w-5" aria-hidden />Add</LinkButton>}>
      <Card className="space-y-2">
        <p className="eyebrow">Spreading season{zone ? `, ${zone}` : ''}</p>
        {s ? (
          <>
            <p className="text-lg font-bold">{s.open ? `Open until ${fmtDay(s.lastDay)}` : `Closed until ${fmtDay(s.closedTo)}`}</p>
            <p className="text-[0.9375rem]">{s.open ? `Chemical fertiliser can't be spread from ${fmtDate(s.closedFrom)}.` : `Spreading opens again on ${fmtDate(s.opensOn)}.`} {s.rule.exempt}</p>
            {needsRecheck(s.rule, today) && <p className="text-sm font-semibold text-warn">These dates are due a recheck against the official source.</p>}
            <Explain title="Where these dates come from">
              <p>{s.rule.text}</p>
              <p className="text-muted">{ruleSourceLine(s.rule)}</p>
              {s.rule.note && <p className="text-muted">{s.rule.note}</p>}
              <a className="inline-flex min-h-[2.75rem] items-center gap-1 font-bold text-accent underline" href={s.rule.source.url} target="_blank" rel="noreferrer">Read the official source<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
            </Explain>
            {s.open && f.firstRound && (
              <p className="rounded-xl bg-pasture p-3 text-[0.9375rem]"><b>{GUIDANCE.first_n.source.publisher}:</b> {GUIDANCE.first_n.text} Agri-It doesn't know your soil or the forecast, so the call is yours.</p>
            )}
          </>
        ) : <p className="text-[0.9375rem]">Agri-It doesn't know the closed period for {b.farm.county || 'your county'}, so it shows no spreading dates. Check your county in Settings.</p>}
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <LinkButton to="/record/spread" block><Sprout className="h-5 w-5" aria-hidden />Spread</LinkButton>
        <LinkButton to="/record/fertiliser" variant="secondary" block>Delivery</LinkButton>
      </div>

      <SectionTitle>In the shed</SectionTitle>
      {f.products.length === 0
        ? <Empty title="No fertiliser yet" body="Add what's in the shed, with how much is there. Deliveries add to it and spreading takes from it." action={<LinkButton to="/fertiliser/new">Add a fertiliser</LinkButton>} />
        : (
          <List>
            {f.products.map((x) => (
              <Row key={x.product.id} to={`/fertiliser/${x.product.id}`} title={x.product.name}
                sub={x.basis === 'nothing' ? 'No stock recorded' : `${x.basis === 'counted' && x.lastCheck ? `Checked ${fmtDay(x.lastCheck.on_date)}` : x.basis === 'opening_estimate' ? 'From a rough guess' : 'From deliveries only'}${x.low ? ' · low' : ''}`}
                right={<span className={`amount font-bold ${x.low ? 'text-warn' : ''}`}>{x.basis === 'nothing' ? '' : fmtKg(x.stockKg)}</span>} />
            ))}
          </List>
        )}

      <SectionTitle action={<LinkButton to="/farm/fields" variant="secondary">Fields</LinkButton>}>Fields due</SectionTitle>
      {b.fields.filter((x) => !x.archived).length === 0
        ? <Empty title="No fields yet" body="Add your fields to record spreading on each one and get flagged when it's due again." action={<LinkButton to="/farm/fields">Add fields</LinkButton>} />
        : f.due.filter((x) => x.kind !== 'cut_passed').length === 0
          ? <p className="px-1 text-[0.9375rem] text-muted">{s && !s.open ? 'Nothing is due while spreading is closed.' : 'Nothing due on your rounds right now. Give a grazing field a round, or a silage field a cutting date, in Fields.'}</p>
          : (
            <List>
              {f.due.filter((x) => x.kind !== 'cut_passed').map((x) => (
                <Row key={x.field.id} to={`/record/spread?field=${x.field.id}`} title={x.field.name}
                  sub={x.kind === 'silage' ? `Spread by ${fmtDay(x.dueOn)}, cutting about ${fmtDay(x.field.cut_on)}` : `${x.dueOn < today ? 'Due since' : 'Due'} ${fmtDay(x.dueOn)}, every ${x.field.spread_every_days} days`}
                  right={<span className="font-bold text-accent">Spread</span>} />
              ))}
            </List>
          )}

      {recent.length > 0 && (
        <>
          <SectionTitle>Recent spreading</SectionTitle>
          <List>
            {recent.map((r) => {
              const names = b.spreadFields.filter((x) => x.spread_id === r.id).map((x) => b.fields.find((y) => y.id === x.field_id)?.name).filter(Boolean);
              return <Row key={r.id} title={`${b.fertilisers.find((p) => p.id === r.product_id)?.name ?? 'Fertiliser'}: ${fmtKg(Number(r.total_kg))}`}
                sub={`${fmtDay(r.spread_on)} · ${names.length > 2 ? `${names.length} fields` : names.join(', ')}${r.kg_per_acre ? ` · ${Math.round(Number(r.kg_per_acre))} kg/ac` : ''}`} />;
            })}
          </List>
        </>
      )}
    </Screen>
  );
}

/** One fertiliser: stock, its history, a stock check, and the CSO comparison. */
export function FertiliserDetail() {
  const { id } = useParams();
  const b = useFarmData();
  const d = useDerived(b);
  const { farmId } = useFarmCtx();
  const save = useSave();
  const state = d.fertiliser.products.find((x) => x.product.id === id);
  const [checking, setChecking] = useState(false);
  const [kg, setKg] = useState('');
  const [unit, setUnit] = useState<'t' | 'bags' | 'kg'>('t');
  const [reason, setReason] = useState<StockReason | null>(null);
  if (!state) return <Screen title="Fertiliser" back="/fertiliser"><Empty title="Not found" /></Screen>;
  const p = state.product;
  const supplier = b.suppliers.find((s) => s.id === p.supplier_id);
  const rows = [
    ...b.fertStock.filter((r) => r.product_id === p.id).map((r) => ({ on: r.on_date, at: r.created_at ?? '', text: r.kind === 'order' ? `Ordered ${fmtKg(Number(r.quantity_kg))}${r.order_status === 'cancelled' ? ' (cancelled)' : r.order_status === 'delivered' ? ' (delivered)' : ''}` : r.kind === 'delivery' ? `Delivered ${fmtKg(Number(r.quantity_kg))}${r.linked_order_id ? ' against an order' : ''}` : r.kind === 'count' ? `Stock check: ${fmtKg(Number(r.quantity_kg))}${r.reason ? `. Why: ${REASON_SHORT[r.reason]}` : ''}` : r.kind === 'adjustment' ? `${Number(r.quantity_kg) < 0 ? 'Taken off' : 'Added'} ${fmtKg(Math.abs(Number(r.quantity_kg)))}${r.reason ? `: ${REASON_TEXT.fertiliser[r.reason]}` : ''}` : `Opening stock: ${fmtKg(Number(r.quantity_kg))}${r.evidence === 'farmer_estimate' ? ' (rough guess)' : ''}`, cost: r.cost_id ? b.costs.find((c) => c.id === r.cost_id) : undefined })),
    ...b.spreads.filter((r) => r.product_id === p.id).map((r) => ({ on: r.spread_on, at: r.created_at ?? '', text: `Spread ${fmtKg(Number(r.total_kg))} on ${b.spreadFields.filter((x) => x.spread_id === r.id).length} field(s)`, cost: undefined }))
  ].sort((x, y) => y.on.localeCompare(x.on) || y.at.localeCompare(x.at)).slice(0, 15);
  const factor = unit === 't' ? 1000 : unit === 'bags' ? 500 : 1;
  const countedKg = Math.round(Number(kg) * factor * 10) / 10;
  // G11: a check a fair way off what the records say asks why (optional)
  const expected = state.basis === 'nothing' ? null : state.stockKg - state.overspentKg;
  const ask = kg !== '' && worthAsking(countedKg, expected);
  const variances = fertiliserVariances(b, p);
  const orders = openFertOrders(b.fertStock, p.id);
  async function cancelOrder(orderId: string) {
    await save([{ kind: 'update', table: 'fertiliser_stock', match: { id: orderId }, patch: { order_status: 'cancelled' } }], {
      label: 'Order cancelled',
      patch: (x) => ({ ...x, fertStock: x.fertStock.map((r) => (r.id === orderId ? { ...r, order_status: 'cancelled' as const } : r)) }),
      undo: [{ kind: 'update', table: 'fertiliser_stock', match: { id: orderId }, patch: { order_status: 'open' } }]
    });
  }

  async function check() {
    const row: FertiliserStock = { id: uuid(), farm_id: farmId!, product_id: p.id, kind: 'count', quantity_kg: countedKg, on_date: todayISO(), evidence: 'measured', supplier_id: null, cost_id: null, notes: null, reason: ask ? reason : null };
    const ok = await save([{ kind: 'insert', table: 'fertiliser_stock', row: { ...row } }], {
      label: `${p.name}: ${fmtKg(row.quantity_kg)} in stock`, patch: (x) => ({ ...x, fertStock: [...x.fertStock, { ...row, created_at: new Date().toISOString() }] }),
      undo: [{ kind: 'delete', table: 'fertiliser_stock', match: { id: row.id } }]
    });
    if (ok) { setChecking(false); setKg(''); setReason(null); }
  }

  return (
    <Screen title={p.name} back="/fertiliser" sub={supplier?.name}>
      <Card className="space-y-2">
        <p className="eyebrow">In stock</p>
        <p className="amount text-3xl font-bold">{state.basis === 'nothing' ? 'Not recorded' : fmtKg(state.stockKg)}</p>
        <p className="text-[0.9375rem] text-muted">
          {state.basis === 'counted' && state.lastCheck ? `Last checked ${fmtDay(state.lastCheck.on_date)}, plus deliveries, less spreading since.` : state.basis === 'opening_estimate' ? 'From your rough guess, plus deliveries, less spreading since. A stock check makes it exact.' : state.basis === 'deliveries_only' ? 'From deliveries less spreading. A stock check makes it exact.' : 'Add a delivery or a stock check.'}
          {p.low_stock_kg !== null && ` Your low level: ${fmtKg(Number(p.low_stock_kg))}.`}
        </p>
        {state.overspentKg > 0 && <p className="rounded-xl bg-warn-bg p-3 text-[0.9375rem] font-semibold text-warn">{fmtKg(state.overspentKg)} more spread than recorded. Do a stock check.</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variant="secondary" block onClick={() => setChecking(true)}>Stock check</Button>
          <LinkButton to={`/record/fertiliser?product=${p.id}`} variant="secondary" block>Delivery</LinkButton>
        </div>
        <LinkButton to={`/record/spread?product=${p.id}`} block><Sprout className="h-5 w-5" aria-hidden />Spread it</LinkButton>
        <div className="grid grid-cols-2 gap-2">
          <LinkButton to={`/record/fertiliser-order?product=${p.id}`} variant="secondary" block>Order</LinkButton>
          <LinkButton to={`/fertiliser/${p.id}/adjust`} variant="secondary" block>Wasted or sold</LinkButton>
        </div>
      </Card>
      {orders.length > 0 && (
        <Card className="space-y-2" aria-label="On order">
          <p className="eyebrow">On order</p>
          {orders.map((o) => (
            <div key={o.id} className="space-y-2 border-t border-line pt-2 first:border-0 first:pt-0" data-fert-order={o.id}>
              <p className="text-[0.9375rem]"><b>{fmtKg(o.remainingKg)}</b> still to come{o.remainingKg < Number(o.quantity_kg) ? ` of ${fmtKg(Number(o.quantity_kg))}` : ''}. Ordered {fmtDay(o.on_date)}{o.expected_on ? `, due ${fmtDay(o.expected_on)}` : ', no date given'}{b.role !== 'worker' && o.price_per_tonne_eur ? `. Agreed ${eur(Number(o.price_per_tonne_eur))}/t` : ''}</p>
              <div className="grid grid-cols-2 gap-2">
                <LinkButton to={`/record/fertiliser?product=${p.id}&order=${o.id}`} block>It arrived</LinkButton>
                <Button variant="ghost" block onClick={() => cancelOrder(o.id)}>Cancel order</Button>
              </div>
            </div>
          ))}
          <p className="text-sm text-muted">Not in stock and not a bill until it's delivered.</p>
        </Card>
      )}
      {variances.length > 0 && (
        <Card>
          <p className="font-bold">Recorded vs checked</p>
          <p className="text-sm text-muted">What the records said was in the shed just before each stock check. Agri-It never changes your spreading rates.</p>
          {variances.slice(-4).reverse().map((v) => (
            <div key={`${v.date}-${v.countedKg}`} className="mt-2" data-variance={v.date}>
              <p>{fmtDay(v.date)}: expected {fmtKg(v.predictedKg)}, checked {fmtKg(v.countedKg)} ({v.varianceKg >= 0 ? '+' : '−'}{fmtKg(Math.abs(v.varianceKg))})</p>
              {v.reason && <p className="text-sm font-semibold">Why: {REASON_TEXT.fertiliser[v.reason]}</p>}
              {v.adjustments.length > 0 && <p className="text-sm text-muted">Taken into account: {v.adjustments.map((a) => `${a.kg < 0 ? '−' : '+'}${fmtKg(Math.abs(a.kg))} ${a.reason ? REASON_SHORT[a.reason] : 'adjusted'}`).join(', ')}</p>}
            </div>
          ))}
          {reasonTally(variances) && <p className="mt-2 text-sm text-muted">Reasons given: {reasonTally(variances)}</p>}
        </Card>
      )}
      {b.role !== 'worker' && (
        <Card className="space-y-2">
          <p className="eyebrow">Price</p>
          {state.lastPrice ? <p className="text-[0.9375rem]">Last paid <b>{eur(state.lastPrice.eurPerT)}/t</b> on {fmtDay(state.lastPrice.on)}</p> : <p className="text-[0.9375rem] text-muted">No priced delivery yet.</p>}
          <CsoCompare catalogueKey={p.catalogue_key} jurisdiction={b.farm.jurisdiction} paid={state.lastPrice} />
        </Card>
      )}
      {catalogueItem(p.catalogue_key)?.exempt && <p className="px-1 text-sm text-muted">{catalogueItem(p.catalogue_key)!.name}: lime and straight potash can be spread all year, so it doesn't count as a round of nitrogen.</p>}
      <SectionTitle action={<LinkButton to={`/fertiliser/${p.id}/edit`} variant="secondary">Edit</LinkButton>}>History</SectionTitle>
      {rows.length ? <List>{rows.map((r, i) => <Row key={i} title={r.text} sub={`${fmtDay(r.on)}${r.cost && b.role !== 'worker' ? ` · ${eur(Number(r.cost.amount_eur))}${r.cost.payment_status === 'owed' ? ' owed' : ''}` : ''}`} />)}</List> : <p className="px-1 text-muted">Nothing recorded yet.</p>}
      <Sheet open={checking} onClose={() => setChecking(false)} title={`How much ${p.name} is there?`}>
        <div className="space-y-4">
          <Chips columns={3} value={unit} onChange={setUnit} options={[{ value: 't', label: 'Tonnes' }, { value: 'bags', label: '500 kg bags' }, { value: 'kg', label: 'kg' }]} />
          <NumberInput label="In the shed now" value={kg} onChange={setKg} unit={unit === 'bags' ? 'bags' : unit} autoFocus />
          {ask && expected !== null && <WhyDifferent what="fertiliser" countedKg={countedKg} expectedKg={expected} value={reason} onChange={setReason} />}
          <Button block disabled={kg === '' || Number(kg) < 0} onClick={check}>Save stock check</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
