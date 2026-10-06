import { useMemo, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, Beef, CalendarCheck, ChevronRight, MessageCircleQuestion, Milk, Moon, Package, PackageCheck, Receipt, Sun, Truck, Users, Warehouse
} from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived, type Priority } from '../lib/data/derived';
import { cashDial, feedDial, silageDial } from '../lib/dials';
import { useTheme } from '../lib/theme';
import { buildChecklist } from '../lib/routines';
import { Checklist } from '../components/Checklist';
import { ReminderNudge } from '../components/Reminders';
import { PhotoQueueNudge } from '../components/PhotoQueue';
import { addDays, fmtDay, fmtKg, todayISO } from '../lib/format';
import { primaryRoute } from '../lib/suppliers';
import { Card, LinkButton, Screen, SectionTitle } from '../components/ui';
import { Dial } from '../components/Dial';
import { FeedGauge } from '../components/FeedGauge';

const rank = { order_now: 0, order_soon: 1, no_stock_record: 2, no_plan: 3, ok: 4 } as const;
const weekdayFmt = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' });
const greeting = (h = new Date().getHours()) => (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');

const iconFor = (p: Priority): ComponentType<{ className?: string }> => {
  if (p.id.startsWith('order-')) return Truck;
  if (p.id.startsWith('feed-')) return Package;
  if (p.id === 'forage') return Warehouse;
  if (p.id.startsWith('job-')) return CalendarCheck;
  if (p.id === 'heads') return Users;
  return Banknote;
};
const tileTone: Record<Priority['tone'], string> = {
  urgent: 'bg-danger-bg text-danger',
  warn: 'bg-warn-bg text-warn',
  info: 'bg-field-light text-accent',
  ok: 'bg-ok-bg text-ok'
};

export default function Today() {
  const b = useFarmData();
  const d = useDerived(b);
  const theme = useTheme();
  const [showAll, setShowAll] = useState(false);

  const products = b.products.filter((p) => !p.archived)
    .map((p) => ({ p, f: d.feed.get(p.id)! }))
    .sort((a, c) => rank[a.f.status] - rank[c.f.status] || (a.f.daysRemaining ?? 999) - (c.f.daysRemaining ?? 999));
  const dials = [
    feedDial(b.products, d.feed, b.farm.feed_target_days ?? 30),
    silageDial(d.forage),
    cashDial(d.cash, d.cash90.lowest)
  ];
  const shown = showAll ? d.priorities : d.priorities.slice(0, 3);

  // Today's checklist: feeding from the plan, bills, income, jobs, counts, orders, silage feed-out
  const today = todayISO();
  const checklist = useMemo(() => buildChecklist(b, today), [b, today]);
  const changes = products.flatMap(({ p, f }) => f.upcomingChanges.filter((c) => c.date <= addDays(todayISO(), 7)).slice(0, 1).map((c) => ({
    key: `${p.id}-${c.date}`, text: `${p.name}: ${c.reason} ${fmtDay(c.date)}, ${fmtKg(c.dailyUseKg)} a day`, to: `/feed/${p.id}`
  })));

  const doNext = (
    <section aria-labelledby="donext" className="space-y-2">
      <SectionTitle><span id="donext">{theme.dawn ? 'Then' : 'Do next'}</span></SectionTitle>
      {d.priorities.length === 0 ? (
        <Card className="font-bold">Nothing urgent. Feed, silage and cash look in hand.</Card>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card shadow-lift">
          {shown.map((p) => {
            const Icon = iconFor(p);
            return (
              <Link key={p.id} to={p.to} className="flex min-h-[4.5rem] items-center gap-3.5 px-4 py-2.5 hover:bg-pasture">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[0.875rem] ${tileTone[p.tone]}`}>
                  <Icon className="h-7 w-7" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{p.tone === 'urgent' ? 'Urgent: ' : p.tone === 'warn' ? 'Soon: ' : ''}</span>
                  <b className="block leading-snug">{p.title}</b>
                  <span className="text-[0.95rem] text-muted">{p.detail}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
              </Link>
            );
          })}
          {d.priorities.length > 3 && (
            <button className="min-h-tap w-full px-4 text-left font-bold text-accent" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show ${d.priorities.length - 3} more`}
            </button>
          )}
        </div>
      )}
    </section>
  );

  const checks = (
    <>
      <Checklist b={b} items={checklist} today={today} feed={d.feed} title={theme.dawn ? (new Date().getHours() < 12 ? 'Before milking' : 'Evening jobs') : "Today's jobs"} />
      {checklist.length > 0 && <ReminderNudge />}
      <PhotoQueueNudge />
      {changes.length > 0 && (
        <div className="space-y-1">
          {changes.map((c) => (
            <Link key={c.key} to={c.to} className="flex min-h-tap items-center gap-2 rounded-xl px-2 text-[0.95rem] font-bold text-warn hover:bg-warn-bg">
              <CalendarCheck className="h-5 w-5 shrink-0" aria-hidden />{c.text}
            </Link>
          ))}
        </div>
      )}
    </>
  );

  return (
    <Screen title={b.farm.name} sub={theme.dawn ? `${greeting()}. ${fmtDay(todayISO())}` : weekdayFmt.format(new Date())}
      right={
        <div className="flex gap-2">
          <button onClick={theme.toggleDawn} aria-label={theme.dawn ? 'Switch to day screen' : 'Switch to dawn mode'}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-ink shadow-lift">
            {theme.dawn ? <Sun className="h-6 w-6" aria-hidden /> : <Moon className="h-6 w-6" aria-hidden />}
          </button>
          <Link to="/ask" aria-label="Ask Agri-It" className="flex min-h-tap items-center gap-1.5 rounded-full bg-card px-4 font-bold text-accent shadow-lift">
            <MessageCircleQuestion className="h-5 w-5" aria-hidden />Ask
          </Link>
        </div>
      }>

      <section aria-label="Farm at a glance" className="grid grid-cols-3 gap-1 rounded-[1.375rem] bg-card px-2 pb-3.5 pt-3 shadow-lift">
        {dials.map(({ id, ...x }) => <Dial key={id} {...x} />)}
      </section>

      {checks}
      {doNext}

      <div className="grid grid-cols-4 gap-2" aria-label="Quick record">
        {[
          { to: '/record/delivery', label: 'Feed arrived', Icon: PackageCheck },
          { to: '/record/milk', label: 'Milk cheque', Icon: Milk },
          { to: '/record/sale', label: 'Sold animals', Icon: Beef },
          { to: '/record/cost', label: 'Paid a bill', Icon: Receipt }
        ].map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex min-h-[5.75rem] flex-col items-center justify-center gap-1.5 rounded-[1.125rem] bg-card px-1 text-center text-sm font-bold leading-tight shadow-lift active:bg-field-light">
            <Icon className="h-8 w-8 text-accent" aria-hidden />{label}
          </Link>
        ))}
      </div>

      <SectionTitle action={<Link to="/feed/new" className="flex min-h-tap items-center px-2 font-bold text-accent">Add feed</Link>}>Bought-in feed</SectionTitle>
      {products.length === 0 ? (
        <Card>
          <p className="font-bold">Track meal and nuts</p>
          <p className="text-muted">Add a feed, how much is in the bin, and who eats it. Agri-It tells you when to order.</p>
          <LinkButton to="/feed/new" className="mt-3" variant="hivis">Add your first feed</LinkButton>
        </Card>
      ) : (
        products.map(({ p, f }) => (
          <FeedGauge key={p.id} product={p} f={f} compact phone={primaryRoute(b.suppliers.find((s) => s.id === p.supplier_id), b)?.phone} />
        ))
      )}
    </Screen>
  );
}

