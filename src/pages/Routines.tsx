import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Briefcase, ChevronRight, Package, Plus, Receipt, Ruler, Truck, Warehouse } from 'lucide-react';
import { useFarmData, useSave } from '../lib/data/farm';
import { nextDue, routineSummary, scheduleLabel } from '../lib/routines';
import { ROUTINE_KIND_LABEL, type FeedingRule, type RoutineKind } from '../lib/types';
import { fmtDay, fmtKg, todayISO } from '../lib/format';
import { headsFor } from '../lib/forecast/feed';
import { LinkButton, Screen, SectionTitle } from '../components/ui';

const ICON: Record<RoutineKind, ComponentType<{ className?: string }>> = { expense: Receipt, income: Banknote, job: Briefcase, count: Ruler, order: Truck, silage: Warehouse };
const SECTIONS: { title: string; kinds: RoutineKind[] }[] = [
  { title: 'Stock and feed', kinds: ['silage', 'count', 'order'] },
  { title: 'Money', kinds: ['expense', 'income'] },
  { title: 'Jobs', kinds: ['job'] }
];

/** Everything that repeats, in one place. Each shows on Today when due, ready to tick off. */
export default function Routines() {
  const b = useFarmData();
  const save = useSave();
  const today = todayISO();
  const groups = new Map(b.groups.map((g) => [g.id, g]));
  const rules = b.rules.filter((r) => (r.end_date === null || r.end_date >= today) && b.products.some((p) => p.id === r.feed_product_id && !p.archived));

  const toggleRule = (r: FeedingRule, on: boolean) =>
    save([{ kind: 'update', table: 'feeding_rules', match: { id: r.id }, patch: { confirm_daily: on } }], {
      label: on ? 'Shows on Today to tick off' : 'Won’t ask any more. The plan is assumed fed',
      patch: (x) => ({ ...x, rules: x.rules.map((y) => (y.id === r.id ? { ...y, confirm_daily: on } : y)) })
    });

  return (
    <Screen title="Routines" back="/farm" sub="Repeating work you tick off on Today">
      <LinkButton to="/routines/new" variant="hivis" block><Plus className="h-6 w-6" aria-hidden />Add a routine</LinkButton>
      <p className="px-1 text-[0.95rem] text-muted">Each routine shows on Today when it's due. Ticking it off records what actually happened, so stock, costs and cash stay right. Nothing is recorded until you tick it.</p>

      <SectionTitle>Feeding</SectionTitle>
      {rules.length === 0 ? (
        <p className="px-1 text-muted">No feeding plans yet. Add one from a feed and it repeats every day.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card shadow-lift">
          {rules.map((r) => {
            const g = groups.get(r.animal_group_id);
            const p = b.products.find((x) => x.id === r.feed_product_id);
            const daily = headsFor(r, groups) * Number(r.kg_per_head_per_feed) * Number(r.feeds_per_day);
            const id = `tick-${r.id}`;
            return (
              <li key={r.id} className="flex min-h-[4.5rem] items-center gap-3 px-4 py-2">
                <Package className="h-7 w-7 shrink-0 text-accent" aria-hidden />
                <Link to={`/feed/${r.feed_product_id}/rule/${r.id}`} className="min-w-0 flex-1">
                  <b className="block leading-snug">{g?.name}: {fmtKg(daily)} {p?.name}</b>
                  <span className="text-[0.95rem] text-muted">{r.is_temporary && r.end_date ? `Every day until ${fmtDay(r.end_date)}` : r.start_date > today ? `Every day from ${fmtDay(r.start_date)}` : 'Every day'}</span>
                </Link>
                <label htmlFor={id} className="flex min-h-tap shrink-0 cursor-pointer items-center gap-2 text-sm font-bold">
                  <input id={id} type="checkbox" className="h-6 w-6 accent-field" checked={r.confirm_daily !== false} onChange={(e) => toggleRule(r, e.target.checked)} />
                  Tick off
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {SECTIONS.map((sec) => {
        const list = b.routines.filter((r) => sec.kinds.includes(r.kind));
        return (
          <section key={sec.title} className="space-y-2">
            <SectionTitle>{sec.title}</SectionTitle>
            {list.length === 0 ? (
              <Link to={`/routines/new?kind=${sec.kinds[0]}`} className="flex min-h-tap items-center gap-2 rounded-2xl px-2 font-bold text-accent hover:bg-field-light">
                <Plus className="h-5 w-5" aria-hidden />Add a {ROUTINE_KIND_LABEL[sec.kinds[0]].toLowerCase()}
              </Link>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card shadow-lift">
                {list.map((r) => {
                  const Icon = ICON[r.kind];
                  const next = r.active ? nextDue(r, today) : null;
                  return (
                    <li key={r.id}>
                      <Link to={`/routines/${r.id}`} className="flex min-h-[4.5rem] items-center gap-3 px-4 py-2 hover:bg-pasture">
                        <Icon className="h-7 w-7 shrink-0 text-accent" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <b className={`block leading-snug ${r.active ? '' : 'text-muted'}`}>{r.title}</b>
                          <span className="text-[0.95rem] text-muted">
                            {scheduleLabel(r)}. {routineSummary(r, b)}{routineSummary(r, b) ? '. ' : ''}
                            {r.active ? (next ? (next === today ? 'Due today' : `Next ${fmtDay(next)}`) : 'Finished') : 'Paused'}
                          </span>
                        </span>
                        <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </Screen>
  );
}
