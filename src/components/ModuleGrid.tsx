import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, ClipboardList, FileBarChart, Landmark, Map as MapIcon, Milk, Sprout, Truck, Users, Warehouse, Wheat } from 'lucide-react';
import type { ModuleKey, ModuleTile, ModuleTone } from '../lib/modules';

const ICON: Record<ModuleKey, ComponentType<{ className?: string }>> = {
  feed: Wheat, silage: Warehouse, animals: Users, milk: Milk, fields: MapIcon, crops: Sprout, money: Banknote, loans: Landmark, reports: FileBarChart, records: ClipboardList, suppliers: Truck
};
const BADGE: Record<ModuleTone, string> = { urgent: 'bg-danger-bg text-danger', warn: 'bg-warn-bg text-warn', info: 'bg-field-light text-accent' };

/**
 * The modules, as tiles: each opens that part of Agri-It for the detailed work. All tiles are the
 * same size (every row is as tall as the tallest tile, and a long live line stops at three lines). One live line,
 * and a badge for what is waiting there (the same items as in the To do card).
 */
export function ModuleGrid({ tiles }: { tiles: ModuleTile[] }) {
  return (
    <section aria-label="Modules">
      <div className="flex items-baseline px-1 pb-2">
        <h2 className="flex-1 text-[1.0625rem] font-bold">Modules</h2>
        <Link to="/more" className="inline-flex min-h-[2.75rem] items-center text-sm font-bold text-accent">See all</Link>
      </div>
      <ul className="grid grid-cols-2 auto-rows-fr gap-3">
        {tiles.map((t) => {
          const Icon = ICON[t.key];
          return (
            <li key={t.key} className="h-full">
              <Link to={t.to} data-module={t.key} aria-label={`${t.title}: ${t.line}${t.count ? `. ${t.count} waiting` : ''}`}
                className="relative flex h-full min-h-[8.5rem] flex-col gap-2.5 rounded-[1.125rem] bg-card p-3.5 shadow-lift">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-field-light text-accent"><Icon className="h-5 w-5" aria-hidden /></span>
                <span className="block"><b className="block text-[0.9375rem] font-bold leading-snug">{t.title}</b><span className="line-clamp-3 text-[0.8125rem] leading-snug text-muted">{t.line}</span></span>
                {t.count > 0 && (
                  <span aria-hidden className={`absolute right-3 top-3 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-extrabold ${BADGE[t.tone]}`}>{t.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
