import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Pencil, Phone } from 'lucide-react';
import { useFarmData, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { countVariances, rulesForDay, runoutSteps } from '../lib/forecast/feed';
import { priceHistory } from '../lib/forecast/prices';
import { PriceHistoryCard } from '../components/Prices';
import { supabase } from '../lib/supabase';
import { EVIDENCE_LABEL } from '../lib/types';
import { eur, fmtDate, fmtDay, fmtKg, fmtNum } from '../lib/format';
import { resolveContacts, telHref } from '../lib/suppliers';
import { Button, CallButton, Card, ConfidenceBadge, Empty, Explain, LinkButton, List, Row, Screen, SectionTitle } from '../components/ui';

export default function FeedDetail() {
  const { id } = useParams();
  const b = useFarmData();
  const d = useDerived(b);
  const save = useSave();
  const product = b.products.find((p) => p.id === id);
  const f = product ? d.feed.get(product.id) : undefined;

  // Forecast history (governance): what the forecast said before, and why it moved
  const snaps = useQuery({
    queryKey: ['snapshots', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('forecast_snapshots').select('generated_at, output, confidence, rule_version')
        .eq('subject_id', id!).eq('forecast_type', 'feed_runout').order('generated_at', { ascending: false }).limit(6);
      return (data ?? []) as { generated_at: string; output: { run_out: string | null; daily_use_kg: number; stock_kg: number }; confidence: string; rule_version: string }[];
    }
  });

  if (!product || !f) return <Screen title="Feed" back="/forecast"><Empty title="Feed not found" /></Screen>;

  const prices = priceHistory(d.prices, product.id, d.today);
  const rules = b.rules.filter((r) => r.feed_product_id === product.id).sort((a, c) => Number(a.is_temporary) - Number(c.is_temporary));
  const txns = b.txns.filter((t) => t.feed_product_id === product.id).sort((a, c) => c.effective_on.localeCompare(a.effective_on));
  const variances = countVariances(txns, rules, b.groups, b.feedLogs.filter((l) => l.feed_product_id === product.id));
  const supplier = b.suppliers.find((s) => s.id === product.supplier_id);
  const contacts = supplier ? resolveContacts(supplier, b.branches, b.supplierSettings.find((s) => s.supplier_id === supplier.id), b.farm) : null;
  const prev = (snaps.data ?? []).find((s) => s.output.run_out !== f.runOutDate);

  // The sum (after MyFitnessPal's remaining-calories equation): stock minus each stretch of planned use
  const steps = f.stockKg !== null && f.stockKg > 0 ? runoutSteps(f.stockKg, rules, b.groups, d.today, f.confirmedTodayKg > 0 ? f.remainingTodayKg : undefined) : [];
  const lastCount = [...txns].find((t) => t.txn_type === 'count' || t.txn_type === 'opening');
  const deliveredSince = lastCount ? txns.filter((t) => t.txn_type === 'delivery' && t.effective_on > lastCount.effective_on).reduce((s, t) => s + Number(t.quantity_kg), 0) : 0;
  const stockBasis = lastCount
    ? `${lastCount.txn_type === 'count' ? 'Counted' : 'Opening stock'} ${fmtDay(lastCount.effective_on)}${deliveredSince ? `, then ${fmtKg(deliveredSince)} delivered` : ''}, less planned use`
    : 'From deliveries only, no count yet';
  const stepLabel = (from: string, to: string, i: number) => {
    const start = i === 0 && from === d.today ? 'Today' : fmtDay(from);
    return from === to ? start : `${start} to ${fmtDay(to)}`;
  };
  const tempLabel = (day: string) => rulesForDay(rules, day).find((r) => r.is_temporary)?.label;
  const lastDelivery = txns.find((t) => t.txn_type === 'delivery');
  const shares = f.activeRules.filter((r) => r.dailyKg > 0);
  const shades = ['bg-field', 'bg-field/60', 'bg-field/35', 'bg-field/20'];
  const orderTone = f.status === 'order_now' ? 'bg-danger-bg text-danger' : f.status === 'order_soon' ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok';
  const phone = contacts?.routes[0];
  // Every line of the sum in kg so it visibly adds up (8,600 − 840 − 4,000 = 3,760)
  const kgx = (n: number) => `${Math.round(n).toLocaleString('en-IE')} kg`;

  return (
    <Screen title={product.name} back="/" sub={[product.storage_location, supplier ? `from ${supplier.name}` : null].filter(Boolean).join(', ')}
      right={<Link to={`/feed/${product.id}/edit`} aria-label="Edit feed" className="flex min-h-tap min-w-tap items-center justify-center rounded-full hover:bg-field-light"><Pencil className="h-6 w-6" /></Link>}>

      {f.stockKg === null ? (
        <Empty title="How much is in the bin?" body="Add a stock count and Agri-It works out when it runs out." action={<LinkButton to={`/feed/${product.id}/count`} variant="hivis">Add a stock count</LinkButton>} />
      ) : (
        <section aria-label="How the run-out date is worked out" className="rounded-[1.375rem] bg-card px-4 pb-3 pt-3.5 shadow-lift" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5">
            <span><b className="block">In the bin now</b><span className="text-sm text-muted">{stockBasis}</span></span>
            <b className="shrink-0 text-[1.1875rem]">{kgx(f.stockKg)}</b>
          </div>
          {steps.map((st, i) => st.final ? (
            <div key={st.from} className="flex items-baseline justify-between gap-3 border-b-2 border-ink py-2.5">
              <span><b className="block">{steps.length > 1 ? 'Left after that' : 'At your feeding plan'}</b><span className="text-sm text-muted">{kgx(st.startKg)} at {kgx(st.kgPerDay)} a day</span></span>
              <b className="shrink-0 text-[1.1875rem]">{Math.floor(st.days)} {Math.floor(st.days) === 1 ? 'day' : 'days'}</b>
            </div>
          ) : (
            <div key={st.from} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5">
              <span><b className="block">{stepLabel(st.from, st.to, i)}</b><span className="text-sm text-muted">{tempLabel(st.from) ? `${tempLabel(st.from)}: ` : ''}{kgx(st.kgPerDay)} a day for {st.days} {st.days === 1 ? 'day' : 'days'}</span></span>
              <b className="shrink-0 text-[1.1875rem] text-muted">−{kgx(st.usedKg)}</b>
            </div>
          ))}
          {steps.length === 0 ? (
            <div className="pt-3">
              <p className="font-bold">No feeding plan, so no run-out date.</p>
              <LinkButton to={`/feed/${product.id}/rule/new`} variant="hivis" className="mt-2">Add who eats it</LinkButton>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 pt-2.5">
              <span>
                <b className="block text-[1.1875rem]">{f.runOutDate ? `Runs out ${fmtDay(f.runOutDate)}` : 'Lasts over a year'}</b>
                <span className="text-sm text-muted">{f.safetyLabel} spare kept{f.leadTimeDays !== null ? `, ${f.leadTimeDays} days for delivery` : ''}</span>
              </span>
              <span className="numeral shrink-0 text-[2.75rem] leading-none">{f.daysRemaining !== null ? Math.floor(f.daysRemaining) : '365+'}<span className="font-sans text-sm font-bold"> days</span></span>
            </div>
          )}
          {steps.length > 0 && (f.orderByDate ? (
            <p className={`mt-3 flex items-center gap-2.5 rounded-[0.875rem] px-3 py-2.5 font-bold ${orderTone}`}>
              <CalendarDays className="h-[1.375rem] w-[1.375rem] shrink-0" aria-hidden />
              {f.status === 'order_now' ? `Order now. The order-by date was ${fmtDay(f.orderByDate)}` : `Order by ${fmtDay(f.orderByDate)}`}
            </p>
          ) : f.reorderDate && (
            <Link to={`/feed/${product.id}/edit`} className="mt-3 flex min-h-tap items-center gap-2.5 rounded-[0.875rem] bg-field-light px-3 font-bold text-accent">
              <CalendarDays className="h-[1.375rem] w-[1.375rem] shrink-0" aria-hidden />Reorder point {fmtDay(f.reorderDate)}. Set a delivery time for an order-by date
            </Link>
          ))}
          <div className="mt-3 flex justify-end"><ConfidenceBadge level={f.confidence} /></div>
        </section>
      )}

      {f.openOrders.length > 0 && (
        <List>
          {f.openOrders.map((o) => (
            <Row key={o.id} to={`/record/delivery?feed=${product.id}&order=${o.id}`} title={`Ordered ${fmtKg(o.kg)}, not delivered`}
              sub={o.expected ? `Expected ${fmtDay(o.expected)}. Not counted as stock until you confirm it arrived.` : 'Not counted as stock until delivered.'}
              right={<span className="font-bold text-accent">Confirm</span>} />
          ))}
        </List>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {phone ? (
          <a href={telHref(phone.phone)} className="flex min-h-[4.25rem] flex-col items-center justify-center rounded-[1.125rem] bg-card leading-tight shadow-lift">
            <span className="flex items-center gap-1.5 font-bold"><Phone className="h-5 w-5" aria-hidden />Call {supplier?.name.split(' ')[0]}</span>
            <span className="text-sm text-muted">{phone.phone}</span>
          </a>
        ) : (
          <LinkButton to={`/feed/${product.id}/count`} variant="secondary">Stock count</LinkButton>
        )}
        <Link to={`/record/order?feed=${product.id}${lastDelivery ? `&kg=${lastDelivery.quantity_kg}` : ''}`} className="flex min-h-[4.25rem] flex-col items-center justify-center rounded-[1.125rem] bg-field leading-tight text-white">
          <b>{lastDelivery ? `Order ${fmtKg(Number(lastDelivery.quantity_kg))} again` : 'Record an order'}</b>
          {lastDelivery?.price_per_tonne_eur && <span className="text-sm">Last price {eur(Number(lastDelivery.price_per_tonne_eur))}/t</span>}
        </Link>
        <LinkButton to={`/record/delivery?feed=${product.id}`} variant="primary">Feed arrived</LinkButton>
        {phone ? <LinkButton to={`/feed/${product.id}/count`} variant="secondary">Stock count</LinkButton> : <span />}
      </div>

      <SectionTitle action={<Link to={`/feed/${product.id}/rule/new`} className="flex min-h-tap items-center px-2 font-bold text-accent">Add group</Link>}>Who eats it</SectionTitle>
      {rules.length === 0 ? (
        <Empty title="No feeding plan" body="Tell Agri-It which groups eat this feed and how much. It never suggests a rate." action={<LinkButton to={`/feed/${product.id}/rule/new`} variant="hivis">Add a group</LinkButton>} />
      ) : (
        <div className="rounded-[1.375rem] bg-card px-4 pb-1 pt-3 shadow-lift">
          {shares.length > 0 && (
            <div className="flex h-[1.125rem] gap-0.5 overflow-hidden rounded-md" aria-hidden>
              {shares.map((r, i) => <span key={r.ruleId} className={shades[i % shades.length]} style={{ flex: `${r.dailyKg} 1 0` }} />)}
            </div>
          )}
          <div className="divide-y divide-line">
            {rules.map((r) => {
              const g = b.groups.find((x) => x.id === r.animal_group_id);
              const heads = r.head_count_override ?? g?.head_count ?? 0;
              const daily = heads * r.kg_per_head_per_feed * r.feeds_per_day;
              const idx = shares.findIndex((x) => x.ruleId === r.id);
              return (
                <Link key={r.id} to={`/feed/${product.id}/rule/${r.id}`} className="flex min-h-[3.75rem] items-center gap-3 py-2">
                  <span className={`h-3.5 w-3.5 shrink-0 rounded ${idx >= 0 ? shades[idx % shades.length] : 'border-2 border-dashed border-line'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <b className="block leading-snug">{g?.name ?? 'Group'}, {fmtKg(daily)} a day {r.is_temporary && <span className="ml-1 rounded bg-hivis px-1.5 text-sm text-onhivis">Temporary</span>}</b>
                    <span className="text-sm text-muted">{heads} head, {fmtNum(Number(r.kg_per_head_per_feed))} kg {r.feeds_per_day === 1 ? 'once' : r.feeds_per_day === 2 ? 'twice' : `${fmtNum(Number(r.feeds_per_day))} times`} a day{r.is_temporary || r.end_date ? `, ${fmtDay(r.start_date)} to ${r.end_date ? fmtDay(r.end_date) : 'ongoing'}` : ''}</span>
                  </span>
                  <span className="font-bold text-accent">Change</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <Explain>
        <p className="font-bold">Stock</p>
        {f.ledger.map((l, i) => <p key={i}>{fmtDate(l.date)}: {l.label} {l.kg >= 0 ? '+' : '−'}{fmtKg(Math.abs(l.kg))}{l.evidence ? ` (${EVIDENCE_LABEL[l.evidence]})` : ''}</p>)}
        <p className="font-bold">= {f.stockKg !== null ? fmtKg(f.stockKg) : 'unknown'} now</p>
        <p className="pt-2 font-bold">Daily use today</p>
        {f.activeRules.map((r) => <p key={r.ruleId}>{r.groupName}: {r.heads} × {r.kgPerHeadPerFeed} kg × {r.feedsPerDay} = {fmtKg(r.dailyKg)}</p>)}
        <p className="font-bold">= {fmtKg(f.dailyUseKg)}/day (your feeding plan, not a recommendation)</p>
        <p className="pt-2">Safety stock {f.safetyLabel} = {fmtKg(f.safetyKg)}. Reorder when stock reaches it: {fmtDay(f.reorderDate) || 'not within a year'}.</p>
        <p>Lead time: {f.leadTimeDays !== null ? `${f.leadTimeDays} days (set on ${f.leadTimeSource === 'feed' ? 'this feed' : f.leadTimeSource === 'supplier' ? 'the supplier' : 'your farm'})` : 'not set, so no order-by date'}.</p>
        <div className="pt-2"><ConfidenceBadge level={f.confidence} /></div>
        {f.reasons.map((r) => <p key={r} className="text-muted">{r}</p>)}
        {prev && <p className="pt-2">Previously forecast to run out {fmtDay(prev.output.run_out)} (at {fmtKg(prev.output.daily_use_kg)}/day, {fmtDate(prev.generated_at.slice(0, 10))}). It changed because stock or the feeding plan changed.</p>}
      </Explain>

      <PriceHistoryCard h={prices} />

      {f.pricePerTonne !== null && (
        <Card>
          <p className="font-bold">Feeding cost at that price</p>
          <div className="mt-2 grid grid-cols-2 gap-y-2">
            {!prices.latest && <><span className="text-muted">Last price</span><span className="text-right font-bold">{eur(f.pricePerTonne)}/t</span></>}
            <span className="text-muted">Per day</span><span className="text-right font-bold">{eur(f.costPerDay, true)}</span>
            <span className="text-muted">Per head per day</span><span className="text-right font-bold">{eur(f.costPerHeadPerDay, true)}</span>
            {f.costUntilReorder !== null && <><span className="text-muted">Until reorder</span><span className="text-right font-bold">{eur(f.costUntilReorder)}</span></>}
          </div>
        </Card>
      )}

      {contacts && supplier && (
        <Card>
          <p className="font-bold">Order from {supplier.name}</p>
          {contacts.routes.length > 0 ? contacts.routes.slice(0, 2).map((r) => (
            <div key={r.kind + r.phone} className="mt-2">
              <p className="mb-1 font-bold">{r.title}</p>
              <CallButton phone={r.phone} label={r.phone} variant={r.kind === 'my_rep' ? 'hivis' : 'secondary'} block />
              {r.verifiedOn && <p className="mt-1 text-sm text-muted">Verified {fmtDate(r.verifiedOn)}</p>}
            </div>
          )) : <p className="text-muted">{contacts.note}</p>}
          {contacts.ambiguous && <LinkButton to={`/suppliers/${supplier.id}`} variant="ghost" block className="mt-2">Set my rep</LinkButton>}
        </Card>
      )}

      {variances.length > 0 && (
        <Card>
          <p className="font-bold">Predicted vs counted</p>
          <p className="text-sm text-muted">Agri-It never changes your feeding rate on its own. If counts keep coming in lower, check the rate you entered.</p>
          {variances.slice(-4).reverse().map((v) => (
            <p key={v.date} className="mt-1">{fmtDay(v.date)}: expected {fmtKg(v.predictedKg)}, counted {fmtKg(v.countedKg)} ({v.varianceKg >= 0 ? '+' : '−'}{fmtKg(Math.abs(v.varianceKg))}{v.variancePct !== null ? `, ${fmtNum(v.variancePct)}%` : ''})</p>
          ))}
        </Card>
      )}

      <SectionTitle>History</SectionTitle>
      <List>
        {txns.filter((t) => t.txn_type !== 'order' || t.order_status !== 'delivered').slice(0, 15).map((t) => (
          <Row key={t.id} title={`${{ opening: 'Opening stock', order: 'Order', delivery: 'Delivery', count: 'Stock count', adjustment: 'Adjustment' }[t.txn_type]}: ${fmtKg(Number(t.quantity_kg))}`}
            sub={`${fmtDate(t.effective_on)}. ${EVIDENCE_LABEL[t.evidence]}${t.total_price_eur ? `. ${eur(Number(t.total_price_eur))}` : ''}${t.order_status === 'cancelled' ? '. Cancelled' : ''}`}
            right={t.txn_type === 'order' && t.order_status === 'open'
              ? <Button variant="ghost" onClick={() => save([{ kind: 'update', table: 'feed_transactions', match: { id: t.id }, patch: { order_status: 'cancelled' } }], { label: 'Order cancelled', undo: [{ kind: 'update', table: 'feed_transactions', match: { id: t.id }, patch: { order_status: 'open' } }] })}>Cancel</Button>
              : undefined} />
        ))}
      </List>
    </Screen>
  );
}
