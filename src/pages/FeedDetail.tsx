import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Pencil } from 'lucide-react';
import { useFarmData, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { countVariances } from '../lib/forecast/feed';
import { supabase } from '../lib/supabase';
import { EVIDENCE_LABEL } from '../lib/types';
import { eur, fmtDate, fmtDay, fmtKg, fmtNum } from '../lib/format';
import { resolveContacts } from '../lib/suppliers';
import { Button, CallButton, Card, ConfidenceBadge, Empty, Explain, LinkButton, List, Row, Screen, SectionTitle } from '../components/ui';
import { FeedGauge } from '../components/FeedGauge';

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

  const rules = b.rules.filter((r) => r.feed_product_id === product.id).sort((a, c) => Number(a.is_temporary) - Number(c.is_temporary));
  const txns = b.txns.filter((t) => t.feed_product_id === product.id).sort((a, c) => c.effective_on.localeCompare(a.effective_on));
  const variances = countVariances(txns, rules, b.groups);
  const supplier = b.suppliers.find((s) => s.id === product.supplier_id);
  const contacts = supplier ? resolveContacts(supplier, b.branches, b.supplierSettings.find((s) => s.supplier_id === supplier.id), b.farm) : null;
  const prev = (snaps.data ?? []).find((s) => s.output.run_out !== f.runOutDate);

  return (
    <Screen title={product.name} back="/forecast" sub={[supplier?.name, product.storage_location].filter(Boolean).join(', ')}
      right={<Link to={`/feed/${product.id}/edit`} aria-label="Edit feed" className="flex min-h-tap min-w-tap items-center justify-center rounded-full hover:bg-field-light"><Pencil className="h-6 w-6" /></Link>}>
      <FeedGauge product={product} f={f} phone={contacts?.routes[0]?.phone} />

      <div className="grid grid-cols-2 gap-2">
        <LinkButton to={`/record/delivery?feed=${product.id}`} variant="primary">Feed arrived</LinkButton>
        <LinkButton to={`/feed/${product.id}/count`} variant="secondary">Stock count</LinkButton>
      </div>

      {f.upcomingChanges.length > 0 && (
        <Card>
          <p className="font-bold">Coming up</p>
          {f.upcomingChanges.map((c) => <p key={c.date}>{fmtDay(c.date)}: {c.reason}, use becomes {fmtKg(c.dailyUseKg)}/day</p>)}
        </Card>
      )}

      {f.openOrders.length > 0 && (
        <List>
          {f.openOrders.map((o) => (
            <Row key={o.id} to={`/record/delivery?feed=${product.id}&order=${o.id}`} title={`Ordered ${fmtKg(o.kg)}, not delivered`}
              sub={o.expected ? `Expected ${fmtDay(o.expected)}. Not counted as stock until you confirm it arrived.` : 'Not counted as stock until delivered.'}
              right={<span className="font-bold text-field">Confirm</span>} />
          ))}
        </List>
      )}

      <SectionTitle action={<Link to={`/feed/${product.id}/rule/new`} className="min-h-tap px-2 py-3 font-bold text-field">Add group</Link>}>Your feeding plan</SectionTitle>
      {rules.length === 0 ? (
        <Empty title="No feeding plan" body="Tell Agri-It which groups eat this feed and how much. It never suggests a rate." action={<LinkButton to={`/feed/${product.id}/rule/new`} variant="hivis">Add a group</LinkButton>} />
      ) : (
        <List>
          {rules.map((r) => {
            const g = b.groups.find((x) => x.id === r.animal_group_id);
            const heads = r.head_count_override ?? g?.head_count ?? 0;
            return (
              <Row key={r.id} to={`/feed/${product.id}/rule/${r.id}`}
                title={<>{g?.name ?? 'Group'} {r.is_temporary && <span className="ml-1 rounded bg-hivis px-1.5 text-sm">Temporary</span>}</>}
                sub={`${heads} head × ${fmtNum(Number(r.kg_per_head_per_feed))} kg × ${fmtNum(Number(r.feeds_per_day))}/day = ${fmtKg(heads * r.kg_per_head_per_feed * r.feeds_per_day)}/day${r.is_temporary || r.end_date ? `, ${fmtDay(r.start_date)} to ${r.end_date ? fmtDay(r.end_date) : 'ongoing'}` : ''}`}
                right={<ChevronRight className="h-5 w-5 text-muted" />} />
            );
          })}
        </List>
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

      {f.pricePerTonne !== null && (
        <Card>
          <p className="font-bold">Cost</p>
          <div className="mt-2 grid grid-cols-2 gap-y-2">
            <span className="text-muted">Last price</span><span className="text-right font-bold">{eur(f.pricePerTonne)}/t</span>
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
