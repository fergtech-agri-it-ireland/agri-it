import { useMemo } from 'react';
import { Search } from 'lucide-react';
import { SPECIES_LABEL, type AnimalGroup } from '../lib/types';
import { NO_FILTER, applyFilter, breedsIn, summarise, type AnimalFilter, type AnimalView } from '../lib/animalQuery';
import { fmtNum } from '../lib/format';
import { Chips } from './ui';

/**
 * Narrow a long list of animals: search by any part of the tag or by breed, then by status, kind of
 * animal and life stage, with group, sex and breed under "More". The counts beside each choice are
 * for the whole farm, so the farmer sees where the animals are without opening a list.
 */
export function AnimalFilterBar({ views, groups, filter, onChange, showStatus = true }: { views: AnimalView[]; groups: AnimalGroup[]; filter: AnimalFilter; onChange: (f: AnimalFilter) => void; showStatus?: boolean }) {
  const set = (p: Partial<AnimalFilter>) => onChange({ ...filter, ...p });
  const byStatus = useMemo(() => applyFilter(views, { ...NO_FILTER, status: filter.status }), [views, filter.status]);
  const kinds = useMemo(() => summarise(byStatus, filter.status === 'left'), [byStatus, filter.status]);
  const onCount = useMemo(() => views.filter((v) => v.a.status === 'on_farm').length, [views]);
  const breeds = useMemo(() => breedsIn(views), [views]);
  const oneKind = kinds.length === 1 ? kinds[0] : null;
  const chosen = filter.species === 'all' ? oneKind : kinds.find((k) => k.species === filter.species) ?? null;
  const more = filter.group !== 'all' || filter.sex !== 'all' || filter.breed !== 'all';
  const usedGroups = groups.filter((g) => !g.archived);
  return (
    <div className="space-y-3">
      <label className="flex h-12 items-center gap-2.5 rounded-full bg-card px-4 text-muted shadow-lift">
        <Search className="h-5 w-5 shrink-0" aria-hidden />
        <input type="search" aria-label="Search tags" value={filter.text} onChange={(e) => set({ text: e.target.value })} placeholder="Search by any part of the tag, or breed" className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none" />
      </label>
      {showStatus && (
        <Chips value={filter.status} onChange={(status) => set({ status, species: 'all', stage: 'all' })} columns={3}
          options={[{ value: 'on', label: `On the farm (${fmtNum(onCount)})` }, { value: 'left', label: `Left (${fmtNum(views.length - onCount)})` }, { value: 'all', label: 'All' }]} />
      )}
      {kinds.length > 1 && (
        <Chips value={filter.species} onChange={(species) => set({ species, stage: 'all' })}
          options={[{ value: 'all' as const, label: `All kinds (${fmtNum(byStatus.length)})` }, ...kinds.map((k) => ({ value: k.species, label: `${SPECIES_LABEL[k.species]} (${fmtNum(k.count)})` }))]} />
      )}
      {chosen && chosen.stages.length > 1 && (
        <Chips value={filter.stage} onChange={(stage) => set({ stage })}
          options={[{ value: 'all', label: 'All stages' }, ...chosen.stages.map((s) => ({ value: s.key, label: `${s.plural} (${fmtNum(s.count)})` }))]} />
      )}
      <details open={more} className="rounded-xl border border-line bg-card px-3">
        <summary className="flex min-h-[2.75rem] cursor-pointer items-center text-[0.9375rem] font-bold text-accent">More filters{more ? ' (on)' : ''}</summary>
        <div className="grid grid-cols-1 gap-3 pb-3 pt-1">
          <label className="block"><span className="label">Group</span>
            <select aria-label="Group" className="input" value={filter.group} onChange={(e) => set({ group: e.target.value })}>
              <option value="all">Any group</option>
              {usedGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="none">In no group</option>
            </select></label>
          <label className="block"><span className="label">Sex</span>
            <select aria-label="Sex" className="input" value={filter.sex} onChange={(e) => set({ sex: e.target.value as AnimalFilter['sex'] })}>
              <option value="all">Any</option><option value="female">Female</option><option value="male">Male</option><option value="none">Not said</option>
            </select></label>
          {breeds.length > 0 && (
            <label className="block"><span className="label">Breed</span>
              <select aria-label="Breed" className="input" value={filter.breed} onChange={(e) => set({ breed: e.target.value })}>
                <option value="all">Any breed</option>
                {breeds.map((x) => <option key={x} value={x}>{x}</option>)}
              </select></label>
          )}
          {more && <button type="button" onClick={() => set({ group: 'all', sex: 'all', breed: 'all' })} className="min-h-[2.75rem] text-left text-sm font-bold text-accent">Clear these</button>}
        </div>
      </details>
    </div>
  );
}

/** The filter as it is carried in a link, so one screen can open another with the same animals. */
export function filterToParams(f: AnimalFilter): URLSearchParams {
  const p = new URLSearchParams();
  (Object.keys(f) as (keyof AnimalFilter)[]).forEach((k) => { if (f[k] !== NO_FILTER[k]) p.set(k, String(f[k])); });
  return p;
}
export function filterFromParams(p: URLSearchParams): AnimalFilter {
  const f = { ...NO_FILTER } as Record<string, string>;
  for (const k of Object.keys(NO_FILTER)) { const v = p.get(k); if (v) f[k] = v; }
  return f as unknown as AnimalFilter;
}
