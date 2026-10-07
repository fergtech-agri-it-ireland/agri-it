import { useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Beef, Briefcase, ClipboardCheck, ClipboardList, Milk, Minus, Package, Receipt, Ruler, Trophy, Truck, Warehouse } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { fyRange, monthsBetween } from '../lib/forecast/money';
import { COST_LABEL, INCOME_LABEL, RECORD_LABEL } from '../lib/types';
import { addDays, eur, fmtDay, fmtKg, fmtMonth, fmtMonthYear, fmtNum, monthKey, todayISO } from '../lib/format';
import { Card, Empty, SectionTitle } from './ui';

type Icon = ComponentType<{ className?: string }>;
interface Entry { id: string; date: string; title: string; sub: string; amount: number | null; Icon: Icon; tone: 'feed' | 'in' | 'out' | 'record'; to: string }

const toneTile = { feed: 'bg-field-light text-accent', in: 'bg-ok-bg text-ok', out: 'bg-pasture text-muted', record: 'bg-pasture text-muted' };

/** Everything recorded, newest first, with milk cheques by month (after Strava's progress chart and activity feed). */
export function DiaryHistory() {
  const b = useFarmData();
  const today = todayISO();
  const [limit, setLimit] = useState(40);

  // ---- Progress: monthly milk cheques this financial year (all income if not dairy)
  const fy = fyRange(b.farm, today);
  const months = monthsBetween(monthKey(fy.start), monthKey(today));
  const milk = b.income.filter((i) => i.income_type === 'milk' && i.occurred_on >= fy.start && i.occurred_on <= today);
  const useMilk = milk.length > 0;
  const source = useMilk ? milk : b.income.filter((i) => i.occurred_on >= fy.start && i.occurred_on <= today);
  const byMonth = months.map((m) => {
    const rows = source.filter((i) => monthKey(i.occurred_on) === m);
    const value = rows.reduce((s, i) => s + Number(i.amount_eur), 0);
    const litres = rows.reduce((s, i) => s + Number(i.milk_litres ?? 0), 0);
    const priced = rows.filter((i) => i.milk_litres).reduce((s, i) => s + Number(i.amount_eur), 0);
    return { m, value, cpl: litres > 0 ? (priced / litres) * 100 : null };
  });
  const withValue = byMonth.filter((x) => x.value > 0);
  const max = Math.max(1, ...byMonth.map((x) => x.value));
  const best = withValue.reduce<(typeof byMonth)[number] | null>((a, x) => (!a || x.value > a.value ? x : a), null);
  const latest = withValue.at(-1) ?? null;
  const firstPriced = withValue.find((x) => x.cpl !== null);
  const lastPriced = [...withValue].reverse().find((x) => x.cpl !== null);

  // ---- Timeline
  const entries: Entry[] = [];
  for (const t of b.txns) {
    const p = b.products.find((x) => x.id === t.feed_product_id);
    if (!p) continue;
    const supplier = b.suppliers.find((s) => s.id === t.supplier_id)?.name;
    if (t.txn_type === 'delivery') {
      entries.push({ id: t.id, date: t.effective_on, title: `${p.name}, ${fmtKg(Number(t.quantity_kg))} arrived`, sub: [supplier, t.price_per_tonne_eur ? `${eur(Number(t.price_per_tonne_eur))}/t` : null].filter(Boolean).join(', ') || 'Delivery', amount: t.total_price_eur !== null ? -Number(t.total_price_eur) : null, Icon: Package, tone: 'feed', to: `/feed/${p.id}` });
    } else if (t.txn_type === 'order' && t.order_status !== 'cancelled') {
      entries.push({ id: t.id, date: t.order_date ?? t.effective_on, title: `Ordered ${fmtKg(Number(t.quantity_kg))} ${p.name}`, sub: t.order_status === 'open' ? `Due ${fmtDay(t.expected_delivery_date ?? t.effective_on)}` : 'Delivered', amount: null, Icon: Truck, tone: 'feed', to: `/feed/${p.id}` });
    } else if (t.txn_type === 'count' || t.txn_type === 'opening') {
      entries.push({ id: t.id, date: t.effective_on, title: `${p.name} ${t.txn_type === 'count' ? 'counted' : 'opening stock'}: ${fmtKg(Number(t.quantity_kg))}`, sub: t.notes ?? 'Stock check', amount: null, Icon: Ruler, tone: 'record', to: `/feed/${p.id}` });
    }
  }
  for (const i of b.income) {
    const cpl = i.milk_litres ? (Number(i.amount_eur) / Number(i.milk_litres)) * 100 : null;
    entries.push({
      id: i.id, date: i.occurred_on, amount: Number(i.amount_eur), tone: 'in', to: '/money',
      Icon: i.income_type === 'milk' ? Milk : i.income_type === 'livestock' ? Beef : Banknote,
      title: i.income_type === 'milk' ? `Milk cheque${i.counterparty ? `, ${i.counterparty}` : ''}` : i.description ?? INCOME_LABEL[i.income_type],
      sub: i.income_type === 'milk' && i.milk_litres ? `${fmtNum(Number(i.milk_litres))} L${cpl ? ` at ${fmtNum(cpl)} c/L` : ''}` : i.counterparty ?? INCOME_LABEL[i.income_type]
    });
  }
  for (const c of b.costs.filter((x) => !x.feed_transaction_id)) {
    entries.push({ id: c.id, date: c.occurred_on, amount: -Number(c.amount_eur), tone: 'out', to: '/money', Icon: Receipt, title: c.description ?? c.other_label ?? COST_LABEL[c.category], sub: [COST_LABEL[c.category], c.supplier_name].filter(Boolean).join(', ') });
  }
  // Feeding ticked off on Today: one line per day, what actually went out
  const feedDays = new Map<string, typeof b.feedLogs>();
  for (const l of b.feedLogs) feedDays.set(l.used_on, [...(feedDays.get(l.used_on) ?? []), l]);
  for (const [day, logs] of feedDays) {
    const total = logs.reduce((s, l) => s + Number(l.actual_kg), 0);
    const byFeed = new Map<string, number>();
    for (const l of logs) byFeed.set(l.feed_product_id, (byFeed.get(l.feed_product_id) ?? 0) + Number(l.actual_kg));
    const changed = logs.filter((l) => l.status === 'changed').length;
    const skipped = logs.filter((l) => l.status === 'skipped').length;
    const extras = [changed ? `${changed} changed from plan` : '', skipped ? `${skipped} skipped` : ''].filter(Boolean).join(', ');
    entries.push({
      id: `feedday-${day}`, date: day, amount: null, tone: 'feed', to: '/forecast', Icon: ClipboardCheck,
      title: `Feeding ticked off: ${fmtKg(total)}`,
      sub: [...byFeed].map(([pid, kg]) => `${b.products.find((p) => p.id === pid)?.name ?? 'Feed'} ${fmtKg(kg)}`).join(', ') + (extras ? `. ${extras}` : '')
    });
  }
  // Routine ticks that don't create their own record (jobs, silage feed-out, skips)
  for (const c of b.completions) {
    const r = b.routines.find((x) => x.id === c.routine_id);
    if (!r || (c.status === 'done' && c.record_table)) continue;
    entries.push({
      id: `done-${c.id}`, date: c.due_date, amount: null, tone: 'record', to: `/routines/${r.id}`,
      Icon: c.status === 'skipped' ? Minus : r.kind === 'silage' ? Warehouse : Briefcase,
      title: c.status === 'skipped' ? `Skipped: ${r.title}` : r.kind === 'silage' && c.amount !== null ? `Fed out ${fmtNum(Number(c.amount))} t silage` : `Done: ${r.title}`,
      sub: c.status === 'skipped' ? 'Nothing recorded' : 'Routine'
    });
  }
  for (const r of b.records) {
    entries.push({ id: r.id, date: r.occurred_on, amount: null, tone: 'record', to: '/records', Icon: ClipboardList, title: r.title, sub: RECORD_LABEL[r.record_type] });
  }
  const timeline = entries.filter((e) => e.date <= today).sort((x, y) => y.date.localeCompare(x.date)).slice(0, limit);
  const recentCut = addDays(today, -13);
  const groupOf = (date: string) => (date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : date >= recentCut ? fmtDay(date) : fmtMonthYear(monthKey(date)));
  const groups: { label: string; items: Entry[] }[] = [];
  for (const e of timeline) {
    const label = groupOf(e.date);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <>
      {withValue.length > 0 && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[1.0625rem] font-bold">{useMilk ? 'Milk cheques' : 'Money in'} this year</p>
              {useMilk && lastPriced?.cpl && firstPriced?.cpl && lastPriced !== firstPriced ? (
                <p className="text-[0.95rem] text-muted">{fmtMonthYear(lastPriced.m).split(' ')[0]} {fmtNum(lastPriced.cpl)} c/L, {lastPriced.cpl >= firstPriced.cpl ? 'up' : 'down'} from {fmtNum(firstPriced.cpl)} in {fmtMonthYear(firstPriced.m).split(' ')[0]}</p>
              ) : <p className="text-[0.95rem] text-muted">{fy.label} financial year</p>}
            </div>
            {best && withValue.length > 1 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-bg px-2.5 py-1 text-sm font-bold text-warn">
                <Trophy className="h-4 w-4" aria-hidden />Best: {fmtMonth(best.m)}
              </span>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="grid min-w-full items-end gap-1.5 border-b border-line" style={{ gridTemplateColumns: `repeat(${byMonth.length}, minmax(1.5rem, 1fr))`, height: '7rem' }} aria-hidden>
              {byMonth.map((x) => (
                <span key={x.m} className={`block rounded-t-md ${x === best && withValue.length > 1 ? 'bg-hivis-dark' : x === latest ? 'bg-field' : 'bg-field/35'}`} style={{ height: `${(x.value / max) * 100}%` }} />
              ))}
            </div>
            <div className="mt-1.5 grid gap-1.5 text-center text-xs text-muted" style={{ gridTemplateColumns: `repeat(${byMonth.length}, minmax(1.5rem, 1fr))` }} aria-hidden>
              {byMonth.map((x) => <span key={x.m} className={x === best || x === latest ? 'font-bold text-ink' : ''}>{fmtMonth(x.m).slice(0, 3)}</span>)}
            </div>
          </div>
          <p className="mt-2 text-[0.95rem] text-muted">
            {best && withValue.length > 1 ? `${fmtMonthYear(best.m).split(' ')[0]} ${eur(best.value)} was your biggest month. ` : ''}
            {latest ? `${fmtMonthYear(latest.m).split(' ')[0]} ${eur(latest.value)}.` : ''}
          </p>
          <ul className="sr-only">{byMonth.map((x) => <li key={x.m}>{fmtMonthYear(x.m)}: {eur(x.value)}</li>)}</ul>
        </Card>
      )}

      {groups.length === 0 ? (
        <Empty title="Nothing recorded yet" body="Deliveries, cheques, bills and records all appear here as you add them." />
      ) : groups.map((g) => (
        <section key={g.label} className="space-y-1.5">
          <SectionTitle><span className="eyebrow">{g.label}</span></SectionTitle>
          <div className="divide-y divide-line overflow-hidden rounded-[1.125rem] bg-card shadow-lift">
            {g.items.map((e) => (
              <Link key={e.id} to={e.to} className="flex min-h-[3.75rem] items-center gap-3 px-4 py-2 hover:bg-pasture">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneTile[e.tone]}`}><e.Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[0.9375rem] font-semibold leading-snug">{e.title}</b>
                  <span className="text-[0.8125rem] text-muted">{g.label.includes(' ') && !g.label.startsWith(fmtDay(e.date)) ? `${fmtDay(e.date)}. ` : ''}{e.sub}</span>
                </span>
                {e.amount !== null && (
                  <b className={`shrink-0 tabular-nums ${e.amount > 0 ? 'text-ok' : ''}`}>{e.amount > 0 ? '+' : '−'}{eur(Math.abs(e.amount))}</b>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
      {entries.length > limit && <button className="min-h-tap w-full rounded-full font-bold text-accent hover:bg-field-light" onClick={() => setLimit(limit + 40)}>Show older</button>}
    </>
  );
}
