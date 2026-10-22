import { useMemo, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpCircle, CalendarClock, FilePlus2, ListChecks, Search, Users } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { dueToMoveUp, summarise, viewAll } from '../lib/animalQuery';
import { SPECIES_LABEL } from '../lib/types';
import { fmtNum, todayISO } from '../lib/format';
import { Screen } from '../components/ui';

interface Tile { id: string; title: string; line: string; to: string; Icon: ComponentType<{ className?: string }>; count?: number }

/**
 * The animals module: what you can do with your animals, as tiles that are all the same size.
 * Add them (scan a card, type a tag, paste a list), find and manage them, change many at once, move
 * the ones that have grown into their next group, and see the groups and head counts that drive the
 * feed forecasts.
 */
export default function Animals() {
  const b = useFarmData();
  const today = todayISO();
  const views = useMemo(() => viewAll(b, today), [b, today]);
  const kinds = useMemo(() => summarise(views), [views]);
  const due = useMemo(() => dueToMoveUp(views, b.groups), [views, b.groups]);
  const here = kinds.reduce((s, k) => s + k.count, 0);
  const dueN = due.reduce((s, d) => s + d.views.length, 0);
  const live = b.groups.filter((g) => !g.archived);

  const tiles: Tile[] = [
    { id: 'add', title: 'Add animals', line: 'Scan a card, type a tag or paste a list', to: '/animals/add', Icon: FilePlus2 },
    { id: 'herd', title: 'Find and manage', line: here ? `${fmtNum(here)} on the farm: ${kinds.slice(0, 3).map((k) => `${fmtNum(k.count)} ${SPECIES_LABEL[k.species].toLowerCase()}`).join(', ')}` : 'None added yet', to: '/animals/herd', Icon: Search },
    { id: 'update', title: 'Update many', line: 'Sold, died, moved off, new group or breed', to: '/animals/update', Icon: ListChecks },
    { id: 'moveup', title: 'Move up a stage', line: dueN ? `${fmtNum(dueN)} ${dueN === 1 ? 'has' : 'have'} outgrown ${dueN === 1 ? 'its' : 'their'} group` : 'Nobody is due to move', to: '/animals/moveup', Icon: ArrowUpCircle, count: dueN },
    { id: 'groups', title: 'Groups and head counts', line: live.length ? `${live.length} group${live.length === 1 ? '' : 's'}: these drive your feed forecasts` : 'Add your groups', to: '/farm/groups', Icon: Users },
    { id: 'stages', title: 'Life stages', line: 'How old before a calf is a weanling', to: '/animals/stages', Icon: CalendarClock }
  ];

  return (
    <Screen title="Animals" back="/more" sub={here ? `${fmtNum(here)} animals recorded one by one` : 'Record animals one by one, by tag number'}>
      <ul className="grid grid-cols-2 auto-rows-fr gap-3">
        {tiles.map((t) => (
          <li key={t.id} className="h-full">
            <Link to={t.to} data-animal-tile={t.id} aria-label={`${t.title}: ${t.line}${t.count ? `. ${t.count} waiting` : ''}`}
              className="relative flex h-full min-h-[8.5rem] flex-col gap-2.5 rounded-[1.125rem] bg-card p-3.5 shadow-lift">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-field-light text-accent"><t.Icon className="h-5 w-5" aria-hidden /></span>
              <span className="block"><b className="block text-[0.9375rem] font-bold leading-snug">{t.title}</b><span className="line-clamp-3 text-[0.8125rem] leading-snug text-muted">{t.line}</span></span>
              {!!t.count && <span aria-hidden className="absolute right-3 top-3 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-warn-bg px-1.5 text-xs font-extrabold text-warn">{fmtNum(t.count)}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-1 text-[0.8125rem] text-muted">Animals recorded here are your own records, with tag numbers. Group head counts drive the feed and silage forecasts and are only changed on the group pages or when you choose to. This is not the official herd register.</p>
    </Screen>
  );
}
