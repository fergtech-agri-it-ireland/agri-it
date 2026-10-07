import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { buildChecklist } from '../lib/routines';
import { stockAt, usageModel, rulesForDay, headsFor } from '../lib/forecast/feed';
import { addOptions, farmTypes } from '../lib/farmTypes';
import { Checklist } from '../components/Checklist';
import { DiaryHistory } from '../components/DiaryHistory';
import { COST_LABEL, INCOME_LABEL, RECORD_LABEL, type FarmBundle } from '../lib/types';
import { addDays, eur, fmtDay, fmtKg, fmtNum, todayISO } from '../lib/format';

const longDay = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayTitle = (d: string, today: string) => (d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : fmtDay(d));

/** One section of the day, like a meal in a food diary: a title, its total, its lines, and Add. */
function Section({ title, total, children, add, label }: { title: string; total?: string; children?: ReactNode; add: { to: string; label: string }; label?: string }) {
  return (
    <section aria-label={label ?? title} className="overflow-hidden rounded-[1.125rem] bg-card shadow-lift">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-[1.0625rem] font-bold">{title}</h2>
        {total && <span className="text-[0.9375rem] font-bold">{total}</span>}
      </div>
      {children && <ul className="divide-y divide-line border-t border-line">{children}</ul>}
      <Link to={add.to} className="flex min-h-[3rem] items-center border-t border-line px-4 text-[0.8125rem] font-bold uppercase tracking-wide text-accent">{add.label}</Link>
    </section>
  );
}
function Line({ title, sub, right, to }: { title: string; sub?: string; right?: string; to?: string }) {
  const inner = (
    <>
      <span className="min-w-0 flex-1"><b className="block text-[0.9375rem] font-semibold leading-snug">{title}</b>{sub && <span className="text-[0.8125rem] text-muted">{sub}</span>}</span>
      {right && <span className="shrink-0 text-[0.9375rem] tabular-nums">{right}</span>}
    </>
  );
  return <li>{to ? <Link to={to} className="flex min-h-[3.5rem] items-center gap-3 px-4 py-2 hover:bg-pasture">{inner}</Link> : <div className="flex min-h-[3.5rem] items-center gap-3 px-4 py-2">{inner}</div>}</li>;
}

/** Start − fed + delivered = in the bin, for one feed on one day (the food diary's sum at the top). */
function binSum(b: FarmBundle, productId: string, day: string, today: string) {
  const groups = new Map(b.groups.map((g) => [g.id, g]));
  const txns = b.txns.filter((t) => t.feed_product_id === productId);
  const rules = b.rules.filter((r) => r.feed_product_id === productId);
  const logs = b.feedLogs.filter((l) => l.feed_product_id === productId);
  const { stock } = stockAt(txns, rules, groups, day, undefined, logs);
  if (stock === null) return null;
  const delivered = txns.filter((t) => (t.txn_type === 'delivery' || t.txn_type === 'adjustment') && t.effective_on === day).reduce((s, t) => s + Number(t.quantity_kg), 0);
  const usage = usageModel(rules, groups, logs);
  // Today counts only what was ticked off; a past day counts what was fed (ticked, or the plan)
  const fed = day === today ? usage.confirmed(day) : usage.use(day);
  const start = stock - delivered;
  return { start, fed, delivered, now: start - fed + delivered };
}

export default function Diary() {
  const b = useFarmData();
  const d = useDerived(b);
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const history = params.get('tab') === 'history';
  const day = (() => { const p = params.get('d'); return p && /^\d{4}-\d{2}-\d{2}$/.test(p) && p <= today ? p : today; })();
  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (v === null) p.delete(k); else p.set(k, v); }
    setParams(p, { replace: true });
  };
  const isToday = day === today;

  const live = b.products.filter((p) => !p.archived);
  const firstFeed = [...live].sort((a, c) => (d.feed.get(a.id)?.daysRemaining ?? 9999) - (d.feed.get(c.id)?.daysRemaining ?? 9999))[0];
  const [feedId, setFeedId] = useState<string | null>(null);
  const shownFeed = live.find((p) => p.id === feedId) ?? firstFeed;
  const sum = shownFeed ? binSum(b, shownFeed.id, day, today) : null;
  const checklist = useMemo(() => buildChecklist(b, today), [b, today]);
  const types = farmTypes(b.farm);
  const moneyAdd = addOptions(types).find((o) => o.relevant && (o.id === 'milk' || o.id === 'grain'));

  // A past day: what was fed, from the plan and anything ticked off
  const groups = new Map(b.groups.map((g) => [g.id, g]));
  const pastFeeding = isToday ? [] : live.flatMap((p) => rulesForDay(b.rules.filter((r) => r.feed_product_id === p.id), day).map((r) => {
    const g = groups.get(r.animal_group_id);
    const planned = headsFor(r, groups) * Number(r.kg_per_head_per_feed) * Number(r.feeds_per_day);
    const log = b.feedLogs.find((l) => l.feeding_rule_id === r.id && l.used_on === day);
    const kg = log ? Number(log.actual_kg) : planned;
    return { key: r.id, title: `${g?.name ?? 'Group'}: ${p.name}`, sub: log ? (log.status === 'skipped' ? 'Skipped' : 'Ticked off') : 'From your plan, not ticked off', kg };
  })).filter((x) => x.kg > 0 || x.sub === 'Skipped');

  const deliveries = b.txns.filter((t) => (t.txn_type === 'delivery' && t.effective_on === day) || (t.txn_type === 'order' && (t.order_date ?? t.effective_on) === day && t.order_status !== 'cancelled') || (t.txn_type === 'count' && t.effective_on === day));
  const delivered = deliveries.filter((t) => t.txn_type === 'delivery').reduce((s, t) => s + Number(t.quantity_kg), 0);
  const income = b.income.filter((i) => i.occurred_on === day);
  const costs = b.costs.filter((c) => c.occurred_on === day && !c.feed_transaction_id);
  const net = income.reduce((s, i) => s + Number(i.amount_eur), 0) - costs.reduce((s, c) => s + Number(c.amount_eur), 0);
  const records = b.records.filter((r) => r.occurred_on === day);

  return (
    <div className="pad-bottom mx-auto w-full max-w-xl">
      <header className="px-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div role="tablist" aria-label="Diary view" className="mx-auto flex max-w-[16rem] rounded-full bg-track p-1 text-sm font-bold">
          {[{ id: 'day', label: 'Day' }, { id: 'history', label: 'History' }].map((t) => {
            const on = (t.id === 'history') === history;
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => go({ tab: t.id === 'history' ? 'history' : null })}
                className={`min-h-[2.25rem] flex-1 rounded-full ${on ? 'bg-card text-ink shadow-lift' : 'text-muted'}`}>{t.label}</button>
            );
          })}
        </div>
        {!history && (
          <div className="mt-2 flex items-center justify-between">
            <button aria-label="Day before" onClick={() => go({ d: addDays(day, -1) })} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-card">
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>
            <div className="text-center">
              <h1 className="h-display text-[1.375rem]">{dayTitle(day, today)}</h1>
              <p className="text-[0.8125rem] text-muted">{longDay.format(new Date(`${day}T00:00:00Z`))}</p>
            </div>
            <button aria-label="Next day" disabled={isToday} onClick={() => go({ d: addDays(day, 1) === today ? null : addDays(day, 1) })}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-card disabled:opacity-30">
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
          </div>
        )}
        {history && <h1 className="sr-only">Farm diary history</h1>}
      </header>

      <main className="mt-2 space-y-3 px-3">
        {history ? <DiaryHistory /> : (
          <>
            {shownFeed && sum && (
              <section aria-label="In the bin" className="rounded-[1.125rem] bg-card px-3 pb-3 pt-3 shadow-lift">
                <div className="flex items-center justify-between gap-2 px-1">
                  <p className="text-[0.8125rem] font-semibold text-muted">{shownFeed.name} in the bin</p>
                  {live.length > 1 && (
                    <select aria-label="Which feed" value={shownFeed.id} onChange={(e) => setFeedId(e.target.value)}
                      className="max-w-[45%] truncate rounded-full border border-line bg-card px-2 py-1 text-[0.8125rem] font-semibold">
                      {live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-start text-center">
                  <div><p className="numeral text-[1.0625rem]">{fmtNum(Math.round(sum.start))}</p><p className="text-[0.6875rem] text-muted">Start</p></div>
                  <span className="pt-0.5 text-muted" aria-hidden>−</span>
                  <div><p className="numeral text-[1.0625rem]">{fmtNum(Math.round(sum.fed))}</p><p className="text-[0.6875rem] text-muted">Fed</p></div>
                  <span className="pt-0.5 text-muted" aria-hidden>+</span>
                  <div><p className="numeral text-[1.0625rem]">{fmtNum(Math.round(sum.delivered))}</p><p className="text-[0.6875rem] text-muted">Delivered</p></div>
                  <span className="pt-0.5 text-muted" aria-hidden>=</span>
                  <div><p className="numeral text-[1.0625rem] text-accent">{fmtNum(Math.round(Math.max(0, sum.now)))}</p><p className="text-[0.6875rem] text-muted">{isToday ? 'kg now' : 'kg left'}</p></div>
                </div>
                <p className="sr-only">{`Start ${fmtKg(sum.start)}, fed ${fmtKg(sum.fed)}, delivered ${fmtKg(sum.delivered)}, ${fmtKg(Math.max(0, sum.now))} ${isToday ? 'now' : 'left'}`}</p>
              </section>
            )}

            {isToday ? (
              <>
                <Checklist b={b} items={checklist} today={today} feed={d.feed} title="Feeding" kinds={['feeding']}
                  footer={{ to: live[0] ? `/feed/${live[0].id}` : '/feed/new', label: live.length ? 'Change feeding plan' : 'Add a feed' }}
                  empty={live.length ? 'No feeding plan for today.' : 'Add the meal or nuts you buy to tick off feeding here.'} />
                <Checklist b={b} items={checklist} today={today} feed={d.feed} title="Jobs and routines" kinds={['silage', 'count', 'order', 'job', 'expense', 'income']}
                  footer={{ to: '/routines/new', label: 'Add a routine' }} empty="Nothing recurring today. Add bills, jobs or counts that repeat." />
              </>
            ) : pastFeeding.length > 0 && (
              <Section title="Feeding" total={fmtKg(pastFeeding.reduce((s, x) => s + x.kg, 0))} add={{ to: live[0] ? `/feed/${live[0].id}` : '/feed/new', label: 'Feeding plan' }}>
                {pastFeeding.map((x) => <Line key={x.key} title={x.title} sub={x.sub} right={fmtKg(x.kg)} />)}
              </Section>
            )}

            <Section title="Deliveries and orders" total={delivered ? fmtKg(delivered) : undefined} add={{ to: '/record/delivery', label: 'Add delivery' }}>
              {deliveries.length > 0 ? deliveries.map((t) => {
                const p = b.products.find((x) => x.id === t.feed_product_id);
                const supplier = b.suppliers.find((s) => s.id === t.supplier_id)?.name;
                const kind = t.txn_type === 'delivery' ? 'Delivered' : t.txn_type === 'order' ? 'Ordered' : 'Counted';
                return <Line key={t.id} to={p ? `/feed/${p.id}` : undefined} title={p?.name ?? 'Feed'}
                  sub={[kind, supplier, t.price_per_tonne_eur ? `${eur(Number(t.price_per_tonne_eur))}/t` : null].filter(Boolean).join(', ')}
                  right={fmtKg(Number(t.quantity_kg))} />;
              }) : undefined}
            </Section>

            <Section title="Money" total={income.length + costs.length ? `${net >= 0 ? '+' : '−'}${eur(Math.abs(net))}` : undefined}
              add={{ to: moneyAdd ? moneyAdd.to : '/record/cost', label: moneyAdd ? `Add ${moneyAdd.label.toLowerCase()} or bill` : 'Add bill or income' }}>
              {income.length + costs.length > 0 ? [
                ...income.map((i) => <Line key={i.id} to="/money" title={i.income_type === 'milk' ? `Milk cheque${i.counterparty ? `, ${i.counterparty}` : ''}` : i.description ?? INCOME_LABEL[i.income_type]}
                  sub={i.income_type === 'livestock' && i.head_count ? `${i.head_count} head` : INCOME_LABEL[i.income_type]} right={`+${eur(Number(i.amount_eur))}`} />),
                ...costs.map((c) => <Line key={c.id} to="/money" title={c.description ?? c.other_label ?? COST_LABEL[c.category]} sub={[COST_LABEL[c.category], c.supplier_name].filter(Boolean).join(', ')} right={`−${eur(Number(c.amount_eur))}`} />)
              ] : undefined}
            </Section>

            <Section title="Records" add={{ to: '/records/new', label: 'Add a record' }}>
              {records.length > 0 ? records.map((r) => <Line key={r.id} to="/records" title={r.title} sub={RECORD_LABEL[r.record_type]} />) : undefined}
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
