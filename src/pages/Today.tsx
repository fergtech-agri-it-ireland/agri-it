import { setupPlan, setupProgress } from '../lib/setup';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CircleCheck, MessageCircleQuestion, Moon, Phone, Sun, X } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { cashDial, silageDial } from '../lib/dials';
import { useTheme } from '../lib/theme';
import { buildChecklist, checklistProgress } from '../lib/routines';
import { farmTypes, keepsAnimals } from '../lib/farmTypes';
import { ReminderNudge } from '../components/Reminders';
import { PhotoQueueNudge } from '../components/PhotoQueue';
import { eur, fmtDay, fmtKg, todayISO } from '../lib/format';
import { primaryRoute, telHref } from '../lib/suppliers';
import type { FarmBundle } from '../lib/types';
import type { FeedForecast } from '../lib/forecast/feed';
import { IS_LOCAL, NS } from '../lib/env';
import { TodoCard } from '../components/TodoCard';
import { ModuleGrid } from '../components/ModuleGrid';
import { dashboardModules } from '../lib/modules';
import { BackupNudge } from '../components/PhoneStorage';
import { CalvingCard } from '../components/CalvingCard';
import { ReleaseLine } from '../components/ReleaseLine';

type Derived = ReturnType<typeof useDerived>;
const dayFmt = new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });

/** A white card with a title row, like every card on the dashboard. */
function Tile({ title, meta, to, children, label }: { title: string; meta?: ReactNode; to?: string; children: ReactNode; label?: string }) {
  const head = (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-[1.0625rem] font-bold">{title}</h2>
      {meta && <span className="text-[0.8125rem] text-muted">{meta}</span>}
    </div>
  );
  return (
    <section aria-label={label ?? title} className="rounded-[1.125rem] bg-card p-4 shadow-lift">
      {to ? <Link to={to} className="block">{head}</Link> : head}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Bar({ fraction, tone = 'field' }: { fraction: number; tone?: 'field' | 'money' | 'silage' | 'warn' | 'danger' | 'muted' }) {
  const fill = { field: 'bg-field', money: 'bg-money', silage: 'bg-silage', warn: 'bg-hivis', danger: 'bg-danger', muted: 'bg-muted/50' }[tone];
  return (
    <div className="h-2 overflow-hidden rounded-full bg-track">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed: one ring for the feed that runs out first (calories remaining, for meal)
// ---------------------------------------------------------------------------
function FeedCard({ b, d }: { b: FarmBundle; d: Derived }) {
  const live = b.products.filter((p) => !p.archived).map((p) => ({ p, f: d.feed.get(p.id)! })).filter((x) => x.f);
  if (live.length === 0) {
    return (
      <Tile title="Feed" label="Feed">
        <p className="text-[0.9375rem] text-muted">Add the meal or nuts you buy, how much is in the bin and who eats it. Agri-It tells you when to order.</p>
        <Link to="/feed/new" className="mt-3 inline-flex min-h-[2.75rem] items-center rounded-full bg-field px-5 text-[0.9375rem] font-bold text-white">Add a feed</Link>
      </Tile>
    );
  }
  const sorted = [...live].sort((a, c) => (a.f.daysRemaining ?? 9999) - (c.f.daysRemaining ?? 9999));
  const { p, f } = sorted[0];
  const target = b.farm.feed_target_days ?? 30;
  const days = f.daysRemaining === null ? null : Math.floor(f.daysRemaining);
  const tone = f.status === 'order_now' ? 'danger' : f.status === 'order_soon' || (days !== null && days < target) ? 'warn' : 'ok';
  const ring = { danger: 'rgb(var(--danger))', warn: 'rgb(var(--hivis))', ok: 'rgb(var(--field))' }[tone];
  const C = 2 * Math.PI * 52;
  const frac = days === null ? 0 : Math.min(1, days / target);
  const phone = primaryRoute(b.suppliers.find((s) => s.id === p.supplier_id), b)?.phone;
  const supplier = b.suppliers.find((s) => s.id === p.supplier_id)?.name;

  return (
    <Tile title="Feed" meta={p.name} to={`/feed/${p.id}`} label="Feed">
      <Link to={`/feed/${p.id}`} className="flex items-center gap-5" aria-label={days === null ? `${p.name}: needs details` : `${p.name}: ${days} days left`}>
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 128 128" className="h-32 w-32 -rotate-90" aria-hidden>
            <circle cx="64" cy="64" r="52" fill="none" stroke="rgb(var(--track))" strokeWidth="12" />
            <circle cx="64" cy="64" r="52" fill="none" stroke={ring} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${frac * C} ${C}`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="numeral text-[2.125rem] leading-none">{days === null ? '?' : days > 99 ? '99+' : days}</span>
            <span className="text-xs font-semibold text-muted">{days === 1 ? 'day left' : 'days left'}</span>
          </div>
        </div>
        <dl className="min-w-0 flex-1 space-y-2.5">
          <div><dt className="text-xs text-muted">Your target</dt><dd className="font-bold">{target} days</dd></div>
          <div><dt className="text-xs text-muted">In the bin</dt><dd className="font-bold">{f.stockKg === null ? 'Not counted' : fmtKg(f.stockKg)}</dd></div>
          <div><dt className="text-xs text-muted">Using</dt><dd className="font-bold">{f.dailyUseKg > 0 ? `${fmtKg(f.dailyUseKg)} a day` : 'No plan yet'}</dd></div>
        </dl>
      </Link>

      <FeedStatus f={f} phone={phone} supplier={supplier} productId={p.id} />

      {sorted.length > 1 && (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {sorted.slice(1).map(({ p: o, f: of }) => (
            <li key={o.id}>
              <Link to={`/feed/${o.id}`} className="flex min-h-[3rem] items-center gap-3 text-[0.9375rem]">
                <span className="min-w-0 flex-1 truncate font-semibold">{o.name}</span>
                <span className={of.status === 'order_now' ? 'font-bold text-danger' : of.status === 'order_soon' ? 'font-bold text-warn' : 'text-muted'}>
                  {of.daysRemaining === null ? (of.status === 'no_plan' ? 'Add a plan' : 'Add a count') : `${Math.floor(of.daysRemaining)} days`}
                </span>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function FeedStatus({ f, phone, supplier, productId }: { f: FeedForecast; phone?: string | null; supplier?: string; productId: string }) {
  if (f.status === 'no_plan' || f.status === 'no_stock_record') {
    const plan = f.status === 'no_plan';
    return (
      <Link to={plan ? `/feed/${productId}/rule/new` : `/feed/${productId}/count`} className="mt-3 flex min-h-[3rem] items-center gap-2 rounded-xl bg-field-light px-3 text-[0.9375rem] font-bold text-accent">
        {plan ? 'Add who eats it, to see when it runs out' : 'Add how much is in the bin'}<ChevronRight className="ml-auto h-4 w-4" aria-hidden />
      </Link>
    );
  }
  const urgent = f.status === 'order_now' || f.status === 'order_soon';
  const lead = f.leadTimeDays !== null && supplier ? `${supplier}, ${f.leadTimeDays} day lead time` : supplier ?? '';
  const ordered = f.openOrders.reduce((s, o) => s + o.kg, 0);
  return (
    <div className={`mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 ${urgent ? (f.status === 'order_now' ? 'bg-danger-bg' : 'bg-warn-bg') : 'bg-ok-bg'}`}>
      <div className="min-w-0 flex-1">
        <p className={`text-[0.9375rem] font-bold ${f.status === 'order_now' ? 'text-danger' : urgent ? 'text-warn' : 'text-ok'}`}>
          {ordered > 0 ? `${fmtKg(ordered)} on order` : f.ordersToPlace.length ? `Order to place: ${fmtKg(f.ordersToPlace[0].kg)}` : f.status === 'order_now' ? 'Order now' : f.orderByDate ? `${urgent ? 'Order' : 'Next order'} by ${fmtDay(f.orderByDate)}` : urgent ? 'Order soon' : 'On track'}
        </p>
        <p className="text-[0.8125rem] text-ink/80">Runs out {fmtDay(f.runOutDate)}{lead ? `. ${lead}` : ''}</p>
      </div>
      {urgent && phone && ordered === 0 && (
        <a href={telHref(phone)} className="flex min-h-[2.5rem] shrink-0 items-center gap-1.5 rounded-full bg-inverse px-4 text-sm font-bold text-oninverse">
          <Phone className="h-4 w-4" aria-hidden />Call
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small cards: silage, cash
// ---------------------------------------------------------------------------
type MiniProps = { title: string; value: string; sub: string; fraction: number; tone: 'field' | 'money' | 'silage' | 'warn' | 'danger' | 'muted'; to: string; className?: string };
function Mini({ title, value, sub, fraction, tone, to, className = '' }: MiniProps) {
  return (
    <Link to={to} aria-label={`${title}: ${value}. ${sub}`} className={`flex flex-col gap-2 rounded-[1.125rem] bg-card p-3.5 shadow-lift ${className}`}>
      <span className="text-[0.9375rem] font-bold">{title}</span>
      <span className="numeral text-[1.375rem] leading-none">{value}</span>
      <Bar fraction={fraction} tone={tone} />
      <span className="text-xs text-muted">{sub}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Set up your farm (16 Oct 2026): the next stage to do, until every stage is done or skipped
// ---------------------------------------------------------------------------
function GuideCard({ b }: { b: FarmBundle }) {
  const key = `${NS}:guide-hidden:${b.farm.id}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const stages = setupPlan(b);
  const p = setupProgress(stages);
  if (hidden || p.complete || b.role === 'worker') return null;
  const next = stages.filter((s) => s.status === 'started' || s.status === 'todo').slice(0, 3);
  return (
    <section aria-label="Set up your farm" className="rounded-[1.125rem] bg-card p-4 shadow-lift">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.0625rem] font-bold">Set up your farm</h2>
          <p className="text-[0.8125rem] text-muted">{p.finished} of {p.total} stages done{p.minutesLeft ? `, about ${p.minutesLeft} minutes left` : ''}. Picked for the farming you do.</p>
        </div>
        <button aria-label="Hide set up your farm" onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } setHidden(true); }}
          className="-mr-2 -mt-1 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-pasture"><X className="h-5 w-5" aria-hidden /></button>
      </div>
      <div className="mt-2"><Bar fraction={p.finished / p.total} /></div>
      <ul className="mt-2 divide-y divide-line">
        {next.map((s) => (
          <li key={s.key}>
            <Link to={`/setup/${s.key}`} className="flex min-h-[3.25rem] items-center gap-3">
              <span className={`h-5 w-5 shrink-0 rounded-full border-2 ${s.status === 'started' ? 'border-hivis bg-hivis/30' : 'border-line'}`} aria-hidden />
              <span className="min-w-0 flex-1"><b className="block text-[0.9375rem] font-semibold leading-snug">{s.title}</b><span className="text-[0.8125rem] text-muted">{s.why}</span></span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/setup" className="mt-1 inline-block min-h-tap py-3 font-bold text-accent">See every stage</Link>
    </section>
  );
}


export default function Today() {
  const b = useFarmData();
  const d = useDerived(b);
  const theme = useTheme();
  const today = todayISO();
  const types = farmTypes(b.farm);
  const animals = keepsAnimals(types) || types.length === 0;
  const checklist = useMemo(() => buildChecklist(b, today), [b, today]);
  const progress = checklistProgress(checklist, today);
  const silage = silageDial(d.forage);
  const cash = cashDial(d.cash, d.cash90.lowest);
  const toneOf = (t: string) => (t === 'urgent' ? 'danger' : t === 'warn' ? 'warn' : t === 'ok' ? 'field' : 'muted') as 'danger' | 'warn' | 'field' | 'muted';
  const showSilage = animals || b.silage.length > 0;
  const money = b.role !== 'worker';
  const modules = dashboardModules(b, d, today);

  // Key numbers: the few figures a farmer wants at a glance. Each opens its module.
  const keyTiles: MiniProps[] = [];
  if (showSilage) {
    keyTiles.push({ title: 'Silage', value: silage.value === '?' ? 'Add details' : silage.value, sub: silage.value === '?' ? 'Is there enough for winter?' : `of winter. ${silage.status}`,
      fraction: silage.fraction, tone: silage.tone === 'ok' ? 'silage' : toneOf(silage.tone), to: silage.value === '?' ? '/farm/silage' : '/progress?tab=forage' });
  }
  if (money) {
    keyTiles.push({ title: 'Cash', value: d.cash ? eur(d.cash.balance) : 'Add balance', sub: d.cash ? (d.cashGaps.stale ? 'Recorded. Check bank' : `Recorded. ${cash.status}`) : 'Unlocks the cash forecast',
      fraction: cash.fraction, tone: cash.tone === 'ok' ? 'money' : toneOf(cash.tone), to: d.cash ? '/progress?tab=cash' : '/settings' });
    const m = d.money;
    const owedLine = m.overdueCount > 0 ? `${m.overdueCount} overdue` : m.dueSoon(b.farm.bill_warning_days ?? 7).length > 0 ? `${m.dueSoon(b.farm.bill_warning_days ?? 7).length} due soon` : m.owedTotal > 0 ? 'None due yet' : 'Nothing owed';
    keyTiles.push({ title: 'Bills owed', value: eur(m.owedTotal), sub: owedLine, fraction: m.owedTotal > 0 ? m.overdueTotal / m.owedTotal : 0,
      tone: m.overdueCount > 0 ? 'danger' : 'muted', to: '/money/bills' });
  }

  // The feed card already says when to order the feed that runs out first
  const live = b.products.filter((p) => !p.archived);
  const firstFeed = [...live].sort((a, c) => (d.feed.get(a.id)?.daysRemaining ?? 9999) - (d.feed.get(c.id)?.daysRemaining ?? 9999))[0];
  const next = d.priorities.filter((p) => !(firstFeed && p.id === `feed-${firstFeed.id}`));

  return (
    <div className="pad-bottom mx-auto w-full max-w-xl">
      <header className="flex items-center gap-2 px-4 pb-2 pt-[calc(1rem+env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold text-muted">{dayFmt.format(new Date())}, {b.farm.name}</p>
          <h1 className="h-display text-[1.75rem]">Today</h1>
        </div>
        <button onClick={theme.toggleDawn} aria-label={theme.dawn ? 'Switch to day screen' : 'Switch to dawn mode'}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-lift">
          {theme.dawn ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
        </button>
        <Link to="/ask" aria-label="Ask Agri-It" className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-accent shadow-lift">
          <MessageCircleQuestion className="h-5 w-5" aria-hidden />
        </Link>
      </header>

      <main className="space-y-3 px-3">
        <GuideCard b={b} />
        {(animals || live.length > 0) && <FeedCard b={b} d={d} />}

        {keyTiles.length > 0 && (
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3">
            {keyTiles.map((t, i) => <Mini key={t.title} {...t} className={keyTiles.length % 2 === 1 && i === keyTiles.length - 1 ? 'col-span-2' : ''} />)}
          </section>
        )}

        <TodoCard farmId={b.farm.id} today={today} suggestions={d.suggestions} priorities={next} alsoShown={d.suggestions.map((x) => `sugg:${x.key}`)} />

        {checklist.length > 0 && (
          <Link to="/diary" aria-label={`Today's diary: ${progress.done} of ${progress.total} ticked off`} className="block rounded-[1.125rem] bg-card p-4 shadow-lift">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[1.0625rem] font-bold">Today's diary</h2>
              <span className="text-[0.8125rem] text-muted">{progress.done} of {progress.total} ticked off</span>
            </div>
            <div className="mt-2.5"><Bar fraction={progress.total ? progress.done / progress.total : 0} /></div>
            <p className="mt-2 flex items-center gap-1 text-sm font-bold text-accent">
              {progress.done === progress.total ? <><CircleCheck className="h-4 w-4" aria-hidden />All done</> : 'Tick off feeding and jobs'}<ChevronRight className="h-4 w-4" aria-hidden />
            </p>
          </Link>
        )}
        <PhotoQueueNudge />
        {IS_LOCAL && <BackupNudge />}

        {(types.includes('dairy') || types.includes('suckler') || (b.seasons ?? []).length > 0) && <CalvingCard b={b} today={today} />}

        <ModuleGrid tiles={modules} />
        {checklist.length > 0 && <ReminderNudge />}
      </main>
      <ReleaseLine />
    </div>
  );
}
