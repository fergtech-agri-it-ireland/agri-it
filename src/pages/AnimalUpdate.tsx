import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { PAGE_SIZE, applyFilter, viewAll } from '../lib/animalQuery';
import { changeProblem, describeChange, planChange, type Change } from '../lib/animalBulk';
import { formatTag } from '../lib/animalId';
import { fmtDate, fmtNum, todayISO } from '../lib/format';
import { AnimalFilterBar, filterFromParams, filterToParams } from '../components/AnimalFilterBar';
import { Button, Card, Chips, DateChips, Field, Sheet, TextInput, Screen } from '../components/ui';

type Kind = 'sold' | 'died' | 'moved_off' | 'group' | 'breed' | 'born' | 'back';
const KINDS: { value: Kind; label: string }[] = [
  { value: 'sold', label: 'Sold' }, { value: 'died', label: 'Died' }, { value: 'moved_off', label: 'Moved off' },
  { value: 'group', label: 'Change group' }, { value: 'breed', label: 'Set breed' }, { value: 'born', label: 'Set date born' }, { value: 'back', label: 'Put back on the farm' }
];

/** Change a whole filtered set of animals at once, or a ticked few, and undo it. */
export default function AnimalUpdate() {
  const b = useFarmData();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => filterFromParams(params), [params]);
  const views = useMemo(() => viewAll(b, today), [b, today]);
  const hits = useMemo(() => applyFilter(views, filter).sort((x, y) => x.a.tag_number.localeCompare(y.a.tag_number)), [views, filter]);
  const [pick, setPick] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState(1);
  const [kind, setKind] = useState<Kind>('sold');
  const [on, setOn] = useState(today);
  const [groupId, setGroupId] = useState<string>('none');
  const [breed, setBreed] = useState('');
  const [born, setBorn] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const chosen = useMemo(() => (pick ? hits.filter((v) => ticked.has(v.a.id)) : hits), [pick, hits, ticked]);
  const animals = useMemo(() => chosen.map((v) => v.a), [chosen]);
  const change: Change | null = kind === 'sold' || kind === 'died' || kind === 'moved_off' ? { kind: 'left', status: kind, on }
    : kind === 'group' ? { kind: 'group', groupId: groupId === 'none' ? null : groupId }
    : kind === 'breed' ? { kind: 'breed', breed }
    : kind === 'born' ? (born ? { kind: 'born', on: born } : null)
    : { kind: 'back' };
  const problem = change ? changeProblem(change, animals, today) : null;
  const ready = !!change && animals.length > 0 && !problem;
  const live = b.groups.filter((g) => !g.archived);
  const shown = hits.slice(0, pages * PAGE_SIZE);

  async function run() {
    if (!change || busy) return;
    setBusy(true);
    const plan = planChange(animals, change);
    const ids = new Set(animals.map((a) => a.id));
    const n = animals.length;
    const ok = await save(plan.ops, {
      label: `${fmtNum(n)} ${n === 1 ? 'animal' : 'animals'} ${describeChange(change, b.groups)}`,
      patch: (x) => ({ ...x, animals: x.animals.map((a) => (ids.has(a.id) ? { ...a, ...plan.patch } : a)) }),
      undo: plan.undo
    });
    setBusy(false);
    if (ok) { setConfirm(false); nav('/animals/herd', { replace: true }); }
  }

  return (
    <Screen title="Update many" back="/animals" sub="Change a whole set at once">
      <AnimalFilterBar views={views} groups={b.groups} filter={filter} onChange={(f) => { setPages(1); setParams(filterToParams(f), { replace: true }); }} />
      <Card className="space-y-3">
        <p data-testid="update-count" className="text-[1.0625rem] font-bold">{fmtNum(chosen.length)} {chosen.length === 1 ? 'animal' : 'animals'} will be changed</p>
        <Chips value={pick ? 'pick' : 'all'} onChange={(v) => { setPick(v === 'pick'); setTicked(new Set()); }} columns={2}
          options={[{ value: 'all', label: `All ${fmtNum(hits.length)} matching` }, { value: 'pick', label: 'Pick which ones' }]} />
        {pick && (
          <div className="space-y-2">
            <div className="flex gap-2 text-sm font-bold text-accent">
              <button type="button" className="min-h-[2.75rem]" onClick={() => setTicked(new Set(hits.map((v) => v.a.id)))}>Tick all {fmtNum(hits.length)}</button>
              <button type="button" className="min-h-[2.75rem]" onClick={() => setTicked(new Set())}>Clear</button>
            </div>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {shown.map((v) => (
                <li key={v.a.id}>
                  <label className="flex min-h-[3rem] items-center gap-3 px-3 text-[0.9375rem]">
                    <input type="checkbox" className="h-5 w-5" checked={ticked.has(v.a.id)} onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(v.a.id); else n.delete(v.a.id); return n; })} />
                    <span className="min-w-0 flex-1"><b>{formatTag(v.a.tag_number)}</b><span className="block text-[0.8125rem] text-muted">{v.stage.label}{v.group ? `, ${v.group.name}` : ''}</span></span>
                  </label>
                </li>
              ))}
            </ul>
            {shown.length < hits.length && <Button variant="secondary" block onClick={() => setPages(pages + 1)}>Show more</Button>}
          </div>
        )}
      </Card>
      <Card className="space-y-4">
        <Chips label="What happened?" value={kind} onChange={setKind} columns={2} options={KINDS} />
        {(kind === 'sold' || kind === 'died' || kind === 'moved_off') && <DateChips label={kind === 'sold' ? 'Sold on' : kind === 'died' ? 'Died on' : 'Left on'} value={on} onChange={setOn} />}
        {kind === 'group' && (
          <Field label="New group" htmlFor="grp">
            <select id="grp" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="none">No group</option>
              {live.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        )}
        {kind === 'breed' && <TextInput label="Breed" value={breed} onChange={setBreed} hint="Leave empty to clear the breed." />}
        {kind === 'born' && <Field label="Date born" htmlFor="b"><input id="b" type="date" className="input" max={today} value={born} onChange={(e) => setBorn(e.target.value)} /></Field>}
        {problem && <p role="alert" className="font-bold text-danger">{problem}</p>}
        <Button block disabled={!ready} onClick={() => setConfirm(true)}>Review the change</Button>
      </Card>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Make this change?">
        <div className="space-y-3 pb-2">
          <p data-testid="confirm-text" className="text-[1.0625rem]"><b>{fmtNum(animals.length)} {animals.length === 1 ? 'animal' : 'animals'}</b> will be {change ? describeChange(change, b.groups) : ''}{change?.kind === 'left' ? ` on ${fmtDate(change.on)}` : ''}.</p>
          <p className="text-[0.9375rem] text-muted">Group head counts and money are not changed{change?.kind === 'left' && change.status === 'sold' ? ', so add the sale to your money records separately' : ''}. You can undo it straight after.</p>
          <div className="flex gap-3"><Button variant="secondary" block onClick={() => setConfirm(false)}>Cancel</Button><Button block disabled={busy} onClick={run}>Yes, change them</Button></div>
        </div>
      </Sheet>
    </Screen>
  );
}
