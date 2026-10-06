import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { PriceCheck, PriceHistory } from '../lib/forecast/prices';
import { eur, fmtDate, fmtDay, fmtMonth, fmtNum } from '../lib/format';
import { Card } from './ui';

const perT = (n: number) => `${eur(n)}/t`;

/** Trend in words and an arrow: never colour alone. */
export function PriceTrend({ pct, diff }: { pct: number; diff?: number }) {
  const up = pct >= 3, down = pct <= -3;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : ArrowRight;
  const words = up ? 'up' : down ? 'down' : 'about the same';
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${up ? 'text-warn' : down ? 'text-ok' : 'text-muted'}`}>
      <Icon className="h-5 w-5" aria-hidden />
      {words}{up || down
        ? ` ${diff !== undefined ? `${eur(Math.abs(diff))}/t, ` : ''}${fmtNum(Math.abs(pct))}%`
        : diff !== undefined && Math.abs(diff) >= 0.5 ? ` (${diff > 0 ? '+' : '−'}${eur(Math.abs(diff))}/t)` : ''}
    </span>
  );
}

/** What this feed has cost per tonne, delivery by delivery. Only prices actually paid. */
export function PriceHistoryCard({ h }: { h: PriceHistory }) {
  if (!h.latest) return null;
  const pts = h.points.slice(-8);
  const lo = Math.min(...pts.map((p) => p.eurPerT));
  const hi = Math.max(...pts.map((p) => p.eurPerT));
  // Bars start from just under the cheapest price, so a €10 change is visible
  const floor = Math.max(0, lo - Math.max(10, (hi - lo) * 0.6));
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold">Price paid</p>
        <p className="numeral text-3xl">{perT(h.latest.eurPerT)}</p>
      </div>
      <p className="text-[0.95rem]">
        Last delivery {fmtDay(h.latest.date)} from {h.latest.supplierName}.
        {h.previous && h.changePct !== null && <> Since the one before ({perT(h.previous.eurPerT)}): <PriceTrend pct={h.changePct} diff={h.latest.eurPerT - h.previous.eurPerT} /></>}
      </p>
      {pts.length > 1 && (
        <div className="flex items-end gap-1.5" style={{ height: 96 }} role="img"
          aria-label={`Price per tonne for the last ${pts.length} deliveries, from ${perT(pts[0].eurPerT)} to ${perT(pts.at(-1)!.eurPerT)}`}>
          {pts.map((p) => (
            <div key={p.txnId} className="flex h-full flex-1 flex-col justify-end" title={`${fmtDate(p.date)}: ${perT(p.eurPerT)}, ${p.supplierName}`}>
              <div className={`rounded-t ${p === h.latest ? 'bg-field' : 'bg-field/40'}`} style={{ height: `${Math.max(8, ((p.eurPerT - floor) / Math.max(1, hi - floor)) * 100)}%` }} />
            </div>
          ))}
        </div>
      )}
      {pts.length > 1 && (
        <div className="-mt-1 flex gap-1.5" aria-hidden>
          {pts.map((p) => <span key={p.txnId} className="flex-1 text-center text-xs font-bold text-muted">{fmtMonth(p.date.slice(0, 7))}</span>)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-y-1.5 text-[0.95rem]">
        {h.avg12m !== null && <><span className="text-muted">Average, last 12 months</span><span className="text-right font-bold">{perT(h.avg12m)}</span></>}
        {h.min && h.max && h.min !== h.max && <><span className="text-muted">Lowest paid</span><span className="text-right font-bold">{perT(h.min.eurPerT)} <span className="font-normal text-muted">{fmtDay(h.min.date)}</span></span>
          <span className="text-muted">Highest paid</span><span className="text-right font-bold">{perT(h.max.eurPerT)} <span className="font-normal text-muted">{fmtDay(h.max.date)}</span></span></>}
      </div>
      {h.bySupplier.length > 1 && (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="text-sm font-bold text-muted">Last price by supplier</p>
          {h.bySupplier.map((s) => (
            <p key={s.supplierName} className="flex justify-between gap-2"><span>{s.supplierName}</span><span><b>{perT(s.latest.eurPerT)}</b> <span className="text-sm text-muted">{fmtDay(s.latest.date)}</span></span></p>
          ))}
        </div>
      )}
      <p className="hint">From your own priced deliveries. Agri-It never guesses a supplier's price.</p>
    </Card>
  );
}

/** Shown under the price field while entering a delivery. */
export function PriceCheckNote({ c }: { c: PriceCheck | null }) {
  if (!c) return null;
  const who = c.sameSupplier ? `your last delivery from ${c.against.supplierName}` : `your last delivery (${c.against.supplierName})`;
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 rounded-xl px-3 py-2 text-[0.95rem] ${c.trend === 'up' ? 'bg-warn-bg' : 'bg-pasture'}`}>
      <PriceTrend pct={c.changePct} diff={c.diffPerT} />
      <span>on {who}: {perT(c.against.eurPerT)} on {fmtDay(c.against.date)}</span>
    </p>
  );
}
