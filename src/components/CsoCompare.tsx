import { ExternalLink } from 'lucide-react';
import { compareWithCso, csoMonthLabel, noComparisonReason } from '../lib/cso/compare';
import { eur, fmtDate, fmtDay } from '../lib/format';
import type { ISODate, Jurisdiction } from '../lib/types';

/**
 * Your price paid against the CSO's national average for the same kind of product. Always
 * labelled as a national average (excl. VAT), with its month and the day it was fetched.
 * Never a quote, and never shown for a product the CSO doesn't cover.
 */
export function CsoCompare({ catalogueKey, jurisdiction, paid }: { catalogueKey: string | null | undefined; jurisdiction: Jurisdiction; paid: { eurPerT: number; on: ISODate } | null }) {
  const c = compareWithCso(catalogueKey, jurisdiction, paid);
  if (!c) {
    const why = noComparisonReason(catalogueKey, jurisdiction, !!paid);
    return why ? <p className="text-sm text-muted">{why}</p> : null;
  }
  const same = Math.abs(c.diffPct) < 3;
  return (
    <div className="space-y-2 rounded-xl bg-pasture p-3">
      <p className="eyebrow">Against the national average</p>
      <div className="grid grid-cols-2 gap-2">
        <div><p className="text-sm text-muted">You paid ({fmtDay(c.paidOn)})</p><p className="amount text-xl font-bold">{eur(c.paidEurPerT)}/t</p></div>
        <div><p className="text-sm text-muted">CSO average, {csoMonthLabel(c.cso.month)}</p><p className="amount text-xl font-bold">{eur(c.cso.eurPerT)}/t</p></div>
      </div>
      <p className="text-[0.9375rem] font-semibold">
        {same ? 'About the same as the national average' : `${eur(Math.abs(c.diffEur))}/t (${Math.abs(c.diffPct)}%) ${c.diffEur > 0 ? 'above' : 'below'} the national average`}
        {c.cso.latestInstead ? `. The CSO hasn't published ${csoMonthLabel(c.paidOn.slice(0, 7))} yet, so this is its latest month.` : '.'}
      </p>
      <p className="text-sm text-muted">
        CSO national average price paid by farmers, excluding VAT, fetched {fmtDate(c.cso.fetchedOn)}. Not a quote from any supplier: your price may include delivery, VAT or a different pack size.{' '}
        <a className="inline-flex items-center gap-1 font-bold text-accent underline" href={c.cso.tableUrl} target="_blank" rel="noreferrer">CSO table<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
      </p>
    </div>
  );
}
