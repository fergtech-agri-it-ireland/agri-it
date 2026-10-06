import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Beef, ChevronRight, MessageCircleQuestion, Milk, PackageCheck, Receipt } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { eur, fmtDate, fmtNum, todayISO } from '../lib/format';
import { primaryRoute } from '../lib/suppliers';
import { Card, LinkButton, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';
import { FeedGauge } from '../components/FeedGauge';

const rank = { order_now: 0, order_soon: 1, no_stock_record: 2, no_plan: 3, ok: 4 } as const;

export default function Today() {
  const b = useFarmData();
  const d = useDerived(b);
  const [showAll, setShowAll] = useState(false);
  const products = b.products.filter((p) => !p.archived)
    .map((p) => ({ p, f: d.feed.get(p.id)! }))
    .sort((a, c) => rank[a.f.status] - rank[c.f.status] || (a.f.daysRemaining ?? 999) - (c.f.daysRemaining ?? 999));
  const shown = showAll ? d.priorities : d.priorities.slice(0, 4);

  return (
    <Screen title={b.farm.name} sub={fmtDate(todayISO())}
      right={<Link to="/ask" aria-label="Ask Agri-It" className="flex min-h-tap items-center gap-1 rounded-full bg-white px-4 font-bold text-field shadow-lift"><MessageCircleQuestion className="h-5 w-5" aria-hidden />Ask</Link>}>

      {/* What needs doing: the answer first */}
      {d.priorities.length === 0 ? (
        <Card className="flex items-center gap-3"><ToneIcon tone="ok" /><p className="font-bold">Nothing urgent. Feed, silage and cash look in hand.</p></Card>
      ) : (
        <List>
          {shown.map((p) => (
            <Row key={p.id} to={p.to} icon={<ToneIcon tone={p.tone} />} title={p.title} sub={p.detail} right={<ChevronRight className="h-5 w-5 text-muted" aria-hidden />} />
          ))}
          {d.priorities.length > 4 && (
            <button className="min-h-tap w-full px-4 text-left font-bold text-field" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show ${d.priorities.length - 4} more`}
            </button>
          )}
        </List>
      )}

      {/* Most common jobs, big and in reach */}
      <div className="grid grid-cols-4 gap-2" aria-label="Quick record">
        {[
          { to: '/record/delivery', label: 'Feed arrived', Icon: PackageCheck },
          { to: '/record/milk', label: 'Milk cheque', Icon: Milk },
          { to: '/record/sale', label: 'Sold animals', Icon: Beef },
          { to: '/record/cost', label: 'Paid a bill', Icon: Receipt }
        ].map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex min-h-[5rem] flex-col items-center justify-center gap-1 rounded-2xl bg-white px-1 text-center text-sm font-bold leading-tight shadow-lift active:bg-field-light">
            <Icon className="h-7 w-7 text-field" aria-hidden />{label}
          </Link>
        ))}
      </div>

      <SectionTitle action={<Link to="/feed/new" className="flex min-h-tap items-center px-2 font-bold text-field">Add feed</Link>}>Bought-in feed</SectionTitle>
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

      <SectionTitle>Winter and cash</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/forecast?tab=forage" className="rounded-2xl bg-white p-4 shadow-lift">
          <p className="font-bold">Silage</p>
          {d.forage.monthsOfCover !== null ? (
            <p className="numeral mt-1 text-4xl leading-none">{fmtNum(d.forage.monthsOfCover)}<span className="ml-1 font-sans text-base font-bold">months</span></p>
          ) : <p className="mt-1 text-muted">Add silage and stock</p>}
          <p className="mt-1 flex items-center gap-1 text-sm font-bold">
            <ToneIcon tone={d.forage.status === 'deficit' ? 'urgent' : d.forage.status === 'tight' ? 'warn' : d.forage.status === 'surplus' ? 'ok' : 'info'} className="h-4 w-4" />
            {{ deficit: 'Short for winter', tight: 'Tight', surplus: 'Covered + reserve', incomplete: 'Needs details' }[d.forage.status]}
          </p>
        </Link>
        <Link to="/forecast?tab=cash" className="rounded-2xl bg-white p-4 shadow-lift">
          <p className="font-bold">Cash</p>
          {d.cash ? <p className="numeral mt-1 text-4xl leading-none">{eur(d.cash.balance)}</p> : <p className="mt-1 text-muted">Add bank balance</p>}
          {d.cash90.lowest && d.cash && <p className="mt-1 text-sm text-muted">90-day low {eur(d.cash90.lowest.closing)}</p>}
        </Link>
      </div>
    </Screen>
  );
}
