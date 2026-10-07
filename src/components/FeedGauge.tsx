import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { FeedForecast } from '../lib/forecast/feed';
import type { FeedProduct } from '../lib/types';
import { fmtDay, fmtKg, fmtRelative } from '../lib/format';
import { CallButton, ConfidenceBadge, ToneIcon } from './ui';

/** Silo level: fill = current stock vs the fullest it has been since the last count; the notch is the reorder line. */
export function SiloBar({ f }: { f: FeedForecast }) {
  const peak = Math.max(f.stockKg ?? 0, ...f.ledger.filter((l) => l.kg > 0).map((l) => l.kg), f.safetyKg * 2, 1);
  const pct = Math.max(0, Math.min(100, ((f.stockKg ?? 0) / peak) * 100));
  const safety = Math.min(100, (f.safetyKg / peak) * 100);
  const fill = f.status === 'order_now' ? 'bg-danger' : f.status === 'order_soon' ? 'bg-hivis' : 'bg-field';
  return (
    <div className="relative h-full w-7 shrink-0 overflow-hidden rounded-t-full rounded-b-md border border-line bg-track" role="img"
      aria-label={`${Math.round(pct)}% of recent peak stock`}>
      <div className={`absolute inset-x-0 bottom-0 ${fill}`} style={{ height: `${pct}%` }} />
      <div className="absolute inset-x-0 border-t-2 border-dashed border-ink" style={{ bottom: `${safety}%` }} title="Reorder line" />
    </div>
  );
}

export function FeedGauge({ product, f, phone, compact }: { product: FeedProduct; f: FeedForecast; phone?: string | null; compact?: boolean }) {
  const orderBy = f.orderByDate;
  const tone = f.status === 'order_now' ? 'urgent' : f.status === 'order_soon' ? 'warn' : f.status === 'ok' ? 'ok' : 'info';
  const days = f.daysRemaining !== null ? Math.floor(f.daysRemaining) : null;

  return (
    <article className="overflow-hidden rounded-2xl bg-card shadow-lift">
      <Link to={`/feed/${product.id}`} className="flex gap-4 p-4 pb-3 hover:bg-pasture/60">
        <div className="h-[6.5rem]"><SiloBar f={f} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-lg font-bold">{product.name}</h3>
            <ChevronRight className="h-6 w-6 shrink-0 text-muted" aria-hidden />
          </div>
          {f.status === 'no_stock_record' ? (
            <p className="mt-2 text-muted">No stock count yet</p>
          ) : f.status === 'no_plan' ? (
            <p className="mt-2 text-muted">{fmtKg(f.stockKg ?? 0)} in store. No feeding plan.</p>
          ) : (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="numeral text-5xl leading-none">{days ?? '365+'}</span>
                <span className="text-lg font-bold">{days === 1 ? 'day left' : 'days left'}</span>
              </p>
              <p className="text-muted">
                {fmtKg(f.stockKg ?? 0)} in store, {fmtKg(f.dailyUseKg)}/day
                {f.runOutDate && <>. Runs out {fmtDay(f.runOutDate)}</>}
              </p>
            </>
          )}
          {!compact && <div className="mt-2"><ConfidenceBadge level={f.confidence} /></div>}
        </div>
      </Link>

      {(f.status === 'order_now' || f.status === 'order_soon' || f.status === 'ok') && (
        <div className={`flex items-center gap-3 px-4 py-3 ${f.status === 'ok' || f.openOrders.length > 0 ? 'border-t border-line bg-card' : 'bg-hivis'}`}>
          <ToneIcon tone={tone} className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1 leading-tight">
            {f.openOrders.length > 0 ? (
              <p className="font-bold">
                Ordered {fmtKg(f.openOrders.reduce((s, o) => s + o.kg, 0))}{f.openOrders[0].expected && `, due ${fmtDay(f.openOrders[0].expected)}`}
                <span className="block text-sm font-normal">Not counted until it arrives{f.runOutWithOpenOrders && `. With it, lasts to ${fmtDay(f.runOutWithOpenOrders)}`}</span>
              </p>
            ) : orderBy ? (
              <p className="font-bold">
                {f.status === 'order_now' ? 'Order now' : `Order by ${fmtDay(orderBy)}`}
                <span className="block text-sm font-normal">
                  {f.status === 'order_now' ? `Order-by date was ${fmtDay(orderBy)}` : fmtRelative(orderBy)}, {f.leadTimeDays}-day lead time
                </span>
              </p>
            ) : (
              <p className="font-bold">
                Reorder point {fmtDay(f.reorderDate)}
                <Link to={`/feed/${product.id}/edit`} className="block text-sm font-normal underline">Set a lead time for an order-by date</Link>
              </p>
            )}
          </div>
          {phone && f.status !== 'ok' && f.openOrders.length === 0 && <CallButton phone={phone} label="Call" variant={f.status === 'order_now' ? 'primary' : 'secondary'} />}
        </div>
      )}
    </article>
  );
}
