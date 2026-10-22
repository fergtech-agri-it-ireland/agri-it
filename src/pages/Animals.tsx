import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { formatTag } from '../lib/animalId';
import { ANIMAL_STATUS_LABEL, type Animal } from '../lib/types';
import { fmtDate, fmtNum } from '../lib/format';
import { Button, Card, Chips, Empty, List, Screen } from '../components/ui';
import { ScanButton } from '../components/ScanButton';
import { IS_DEMO } from '../lib/env';

/** Animals recorded one by one, with their tag numbers. Scan the blue card to add one. */
export default function Animals() {
  const b = useFarmData();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [where, setWhere] = useState<'on' | 'left'>('on');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const groups = b.groups.filter((g) => !g.archived);
  const here = b.animals.filter((a) => a.status === 'on_farm');
  const gone = b.animals.filter((a) => a.status !== 'on_farm');
  const needle = q.replace(/[\s.\-_]+/g, '').toUpperCase();
  const shown = (where === 'on' ? here : gone)
    .filter((a) => groupFilter === 'all' || (groupFilter === 'none' ? !a.animal_group_id : a.animal_group_id === groupFilter))
    .filter((a) => !needle || a.tag_number.includes(needle) || (a.breed ?? '').toUpperCase().includes(q.trim().toUpperCase()))
    .sort((x, y) => x.tag_number.localeCompare(y.tag_number));

  const sub = (a: Animal) => [
    b.groups.find((g) => g.id === a.animal_group_id)?.name,
    a.sex === 'female' ? 'Female' : a.sex === 'male' ? 'Male' : null,
    a.breed,
    a.born_on ? `born ${fmtDate(a.born_on)}` : null,
    a.status !== 'on_farm' ? `${ANIMAL_STATUS_LABEL[a.status].toLowerCase()}${a.left_on ? ` ${fmtDate(a.left_on)}` : ''}` : null
  ].filter(Boolean).join(', ');

  return (
    <Screen title="Animal tags" back="/farm/groups" right={<Button onClick={() => nav('/animals/new')}>Add</Button>}>
      <Card className="space-y-2">
        <ScanButton onFile={(photo) => nav('/animals/new', { state: { photo } })} label={IS_DEMO ? 'Pick a photo of the animal card' : 'Scan the blue animal card'} />
        <p className="text-[0.8125rem] text-muted">Reads the tag number off the identity card on this phone. You check it, then save.</p>
      </Card>

      {b.animals.length === 0 ? (
        <Empty title="No animals recorded yet" body="Scan an animal's identity card, or add one by typing its tag number. Your groups and head counts stay as they are." action={<Link to="/animals/new" className="font-bold text-accent">Add by typing</Link>} />
      ) : (
        <>
          <section className="space-y-1.5">
            <h2 className="eyebrow px-1 pt-2">Tagged against your groups</h2>
            <List>
              {groups.map((g) => {
                const n = here.filter((a) => a.animal_group_id === g.id).length;
                return <div key={g.id} className="flex min-h-[3rem] items-center justify-between gap-2 px-4 py-2 text-[0.9375rem]"><span className="font-semibold">{g.name}</span><span className="text-muted">{fmtNum(n)} of {fmtNum(g.head_count)} head</span></div>;
              })}
              {here.some((a) => !a.animal_group_id) && <div className="flex min-h-[3rem] items-center justify-between gap-2 px-4 py-2 text-[0.9375rem]"><span className="font-semibold">No group</span><span className="text-muted">{fmtNum(here.filter((a) => !a.animal_group_id).length)}</span></div>}
            </List>
          </section>

          <label className="flex h-12 items-center gap-2.5 rounded-full bg-card px-4 text-muted shadow-lift">
            <Search className="h-5 w-5 shrink-0" aria-hidden />
            <input type="search" aria-label="Search tags" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by tag number or breed" className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none" />
          </label>
          <Chips value={where} onChange={setWhere} options={[{ value: 'on', label: `On the farm (${here.length})` }, { value: 'left', label: `Left the farm (${gone.length})` }]} />
          {groups.length > 0 && (
            <Chips value={groupFilter} onChange={setGroupFilter} options={[{ value: 'all', label: 'All groups' }, ...groups.map((g) => ({ value: g.id, label: g.name })), ...(b.animals.some((a) => !a.animal_group_id) ? [{ value: 'none', label: 'No group' }] : [])]} />
          )}
          {shown.length === 0 ? <p className="px-1 text-muted">Nothing matches.</p> : (
            <List>
              {shown.map((a) => (
                <Link key={a.id} to={`/animals/${a.id}`} data-animal={a.tag_number} className="flex min-h-[3.5rem] items-center gap-3 px-4 py-2.5 hover:bg-pasture">
                  <span className="min-w-0 flex-1"><b className="block text-[0.9375rem] font-semibold leading-snug">{formatTag(a.tag_number)}</b><span className="text-[0.8125rem] text-muted">{sub(a) || 'No details yet'}</span></span>
                  <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                </Link>
              ))}
            </List>
          )}
          <p className="px-1 text-[0.8125rem] text-muted">These are your own records, with tag numbers from the cards. Group head counts drive the feed and silage forecasts and are not changed here. This is not the official herd register.</p>
        </>
      )}
    </Screen>
  );
}
