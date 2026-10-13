import { Link } from 'react-router-dom';
import { Baby, ChevronRight } from 'lucide-react';
import type { FarmBundle, ISODate } from '../lib/types';
import { seasonSteps, stepWhen } from '../lib/season';
import { daysBetween, fmtDay } from '../lib/format';

/** The calving season on the dashboard: days to the first calf and the next steps. */
export function CalvingCard({ b, today }: { b: FarmBundle; today: ISODate }) {
  const season = (b.seasons ?? []).filter((s) => !s.archived && (s.calving_end ?? s.calving_start) >= today).sort((a, c) => a.calving_start.localeCompare(c.calving_start))[0];
  if (!season) {
    return (
      <Link to="/calving/season/new" className="flex items-center gap-3 rounded-[1.125rem] bg-card p-4 shadow-lift">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-field-light text-accent"><Baby className="h-5 w-5" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <b className="block text-[1.0625rem]">Plan your calving season</b>
          <span className="text-[0.875rem] text-muted">Give the date the first calf is due. Agri-It lays out drying off, minerals, tags and the calving checklist, and keeps the tagging deadlines.</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      </Link>
    );
  }
  const steps = seasonSteps(season, b.decisions ?? [], today, b.farm).filter((s) => s.status === 'open' && stepWhen(s, today) !== null);
  const toFirst = daysBetween(today, season.calving_start);
  const born = (b.births ?? []).filter((x) => x.season_id === season.id).reduce((n, x) => n + x.calves, 0);
  const due = season.cows_due ?? 0;
  return (
    <Link to="/calving" className="block rounded-[1.125rem] bg-card p-4 shadow-lift" aria-label={`${season.label}: open the calving plan`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[1.0625rem] font-bold">{season.label}</h2>
        <span className="text-[0.8125rem] text-muted">{toFirst > 0 ? `First calf in ${toFirst} days` : born ? `${born}${due ? ` of ${due}` : ''} calved` : 'Calving now'}</span>
      </div>
      {toFirst <= 0 && due > 0 && (
        <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-pasture"><div className="h-full rounded-full bg-field" style={{ width: `${Math.min(100, (born / due) * 100)}%` }} /></div>
      )}
      <ul className="mt-2 space-y-1">
        {steps.slice(0, 3).map((s) => (
          <li key={s.key} className="flex justify-between gap-2 text-[0.875rem]">
            <span className="min-w-0 truncate">{s.title}</span>
            <span className={`shrink-0 ${s.date < today ? 'font-bold text-warn' : 'text-muted'}`}>{s.date <= today ? 'Now' : fmtDay(s.date)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1 text-sm font-bold text-accent">See the whole plan<ChevronRight className="h-4 w-4" aria-hidden /></p>
    </Link>
  );
}
