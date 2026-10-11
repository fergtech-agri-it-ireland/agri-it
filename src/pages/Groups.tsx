import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { ANIMAL_CLASS_LABEL, type AnimalClass, type AnimalGroup, type FarmBundle, type HeadCountChange } from '../lib/types';
import { fmtDay, fmtRelative, todayISO, uuid } from '../lib/format';
import { headChangeRow, headsOn, upcomingHeadChanges } from '../lib/heads';
import { Button, Card, DateChips, Empty, NumberInput, Screen, Sheet, Stepper, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';
import { BreedField, ClassPicker } from '../components/FarmPickers';
import { speciesOf } from '../lib/farmTypes';

function GroupCard({ g, history }: { g: AnimalGroup; history: HeadCountChange[] }) {
  const save = useSave();
  const today = todayISO();
  const [count, setCount] = useState(g.head_count);
  const [from, setFrom] = useState(today);
  const [showHistory, setShowHistory] = useState(false);
  const upcoming = upcomingHeadChanges(history, today);
  const past = history.filter((h) => h.effective_on <= today).sort((a, c) => c.effective_on.localeCompare(a.effective_on) || c.created_at.localeCompare(a.created_at));
  const [usage, setUsage] = useState(g.forage_t_per_head_month !== null ? String(g.forage_t_per_head_month) : '');
  const [more, setMore] = useState(false);
  const [breed, setBreed] = useState(g.breed ?? '');
  const dirty = count !== g.head_count;
  const updated = g.head_count_updated_at.slice(0, 10);
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-[1.0625rem] font-bold">{g.name}</p><p className="text-[0.8125rem] text-muted">{[ANIMAL_CLASS_LABEL[g.animal_class], g.breed].filter(Boolean).join(', ')}. Count updated {fmtRelative(updated)}</p></div>
      </div>
      {upcoming.map((h) => <p key={h.id} className="rounded-xl bg-field-light px-3 py-2 text-[0.9375rem] font-semibold text-accent">Goes to {h.head_count} head on {fmtDay(h.effective_on)} ({h.reason})</p>)}
      <Stepper label="Head" value={count} onChange={setCount} unit="head" />
      {dirty ? (
        <>
          <DateChips label="Since when?" value={from} onChange={setFrom} allowFuture />
          <p className="hint">Feed already eaten before this day keeps the old number. A later date only changes the forecast from then.</p>
          <Button block onClick={() => {
            const id = uuid();
            const row = { ...headChangeRow(g, count, from, 'manual', headsOn(g, from, history)), id };
            return save([{ kind: 'rpc', fn: 'set_head_count', args: { p_group_id: g.id, p_head_count: count, p_reason: 'manual', p_effective_on: from, p_id: id } }], {
              label: from > today ? `${g.name}: ${count} head from ${fmtDay(from)}. Forecasts use it from then` : `${g.name}: ${count} head${from < today ? ` since ${fmtDay(from)}` : ''}. Feed forecasts updated`,
              patch: (x) => {
                const hist = [...x.headHistory, row];
                return { ...x, headHistory: hist, groups: x.groups.map((y) => (y.id === g.id ? { ...y, head_count: headsOn(y, today, hist.filter((h) => h.animal_group_id === g.id)), head_count_updated_at: new Date().toISOString() } : y)) };
              },
              undo: [{ kind: 'delete', table: 'head_count_history', match: { id } }, { kind: 'rpc', fn: 'set_head_count', args: { p_group_id: g.id, p_head_count: g.head_count, p_reason: 'undo', p_effective_on: today } }]
            });
          }}>Save {count} head{from !== today ? ` from ${fmtDay(from)}` : ''}</Button>
        </>
      ) : (
        <Button variant="ghost" block onClick={() => save([{ kind: 'rpc', fn: 'set_head_count', args: { p_group_id: g.id, p_head_count: g.head_count, p_reason: 'confirmed' } }], {
          label: 'Count confirmed',
          patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, head_count_updated_at: new Date().toISOString() } : y)) })
        })}>Still {g.head_count}: confirm</Button>
      )}
      {past.length > 0 && (
        <button type="button" className="min-h-[2.75rem] text-sm font-bold text-accent" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide count history' : `Count history (${past.length})`}</button>
      )}
      {showHistory && (
        <ul className="divide-y divide-line rounded-xl border border-line text-[0.9375rem]">
          {past.slice(0, 8).map((h) => (
            <li key={h.id} className="flex justify-between gap-2 px-3 py-2"><span>{fmtDay(h.effective_on)}: {h.reason}</span><b>{h.previous_count !== null && h.previous_count !== undefined ? `${h.previous_count} → ` : ''}{h.head_count}</b></li>
          ))}
        </ul>
      )}
      <button type="button" className="min-h-[2.75rem] text-sm font-bold text-accent" onClick={() => setMore(!more)}>{more ? 'Hide details' : 'Breed, winter and housing'}</button>
      {more && (
        <div className="space-y-3">
          <BreedField cls={g.animal_class} value={breed} onChange={setBreed} label="Breed" />
          {(breed.trim() || null) !== (g.breed ?? null) && (
            <Button variant="secondary" block onClick={() => save([{ kind: 'update', table: 'animal_groups', match: { id: g.id }, patch: { breed: breed.trim() || null } }], { label: 'Breed saved', patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, breed: breed.trim() || null } : y)) }) })}>Save breed</Button>
          )}
          {speciesOf(g.animal_class) !== 'pigs' && speciesOf(g.animal_class) !== 'poultry' && speciesOf(g.animal_class) !== 'horses' && <label className="flex min-h-tap items-center gap-3 text-[0.9375rem] font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-field" checked={g.housed} onChange={(e) => save([{ kind: 'update', table: 'animal_groups', match: { id: g.id }, patch: { housed: e.target.checked } }], { label: 'Saved', patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, housed: e.target.checked } : y)) }) })} />
            Housed for winter (counts toward silage need)
          </label>}
          <NumberInput label="Your silage use per head per month (optional)" value={usage} onChange={setUsage} unit="t"
            hint="From your own past winters. Used instead of the published allowance." />
          <Button variant="secondary" block onClick={() => save([{ kind: 'update', table: 'animal_groups', match: { id: g.id }, patch: { forage_t_per_head_month: usage === '' ? null : Number(usage) } }], { label: 'Saved', patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, forage_t_per_head_month: usage === '' ? null : Number(usage) } : y)) }) })}>Save usage</Button>
          <Button variant="danger" block onClick={() => save([{ kind: 'update', table: 'animal_groups', match: { id: g.id }, patch: { archived: true } }], { label: `${g.name} archived`, patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, archived: true } : y)) }), undo: [{ kind: 'update', table: 'animal_groups', match: { id: g.id }, patch: { archived: false } }] })}>Archive group</Button>
        </div>
      )}
    </Card>
  );
}

export default function Groups() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const [open, setOpen] = useState(false);
  const [cls, setCls] = useState<AnimalClass | null>(null);
  const [name, setName] = useState('');
  const [count, setCount] = useState(10);
  const [breed, setBreed] = useState('');
  const groups = b.groups.filter((g) => !g.archived);
  const [moving, setMoving] = useState(false);

  async function add() {
    const row = { id: uuid(), farm_id: farmId!, name: name || ANIMAL_CLASS_LABEL[cls!], animal_class: cls!, breed: breed.trim() || null, head_count: count, sort_order: groups.length };
    await save([{ kind: 'insert', table: 'animal_groups', row }], {
      label: 'Group added',
      patch: (x) => ({ ...x, groups: [...x.groups, { ...row, head_count_updated_at: new Date().toISOString(), forage_t_per_head_month: null, housed: true, archived: false }] })
    });
    setOpen(false); setCls(null); setName(''); setCount(10); setBreed('');
  }

  return (
    <Screen title="Animals and breeds" back right={<Button onClick={() => setOpen(true)}>Add</Button>}>
      <p className="px-1 text-[0.9375rem] text-muted">Head counts drive every feed and silage forecast. Each change is kept with its date, so past feeding keeps the numbers you had then. Sales update them for you.</p>
      {groups.length >= 2 && <Button variant="secondary" block onClick={() => setMoving(true)}><ArrowRightLeft className="h-5 w-5" aria-hidden />Move animals between groups</Button>}
      {groups.length === 0 ? <Empty title="No groups yet" body="Cattle, sheep, goats, pigs, poultry or horses: add a group for each." action={<Button onClick={() => setOpen(true)}>Add a group</Button>} /> : groups.map((g) => <GroupCard key={g.id + g.head_count} g={g} history={b.headHistory.filter((h) => h.animal_group_id === g.id)} />)}
      <MoveSheet b={b} open={moving} onClose={() => setMoving(false)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="New animal group">
        <div className="max-h-[70vh] space-y-4 overflow-auto pb-2">
          <ClassPicker value={cls} onChange={(c) => { setCls(c); setName(ANIMAL_CLASS_LABEL[c]); setBreed(''); }} />
          {cls && (
            <>
              <TextInput label="Name" value={name} onChange={setName} hint="Your own name for the group, e.g. Spring calvers or Texel ewes" />
              <BreedField cls={cls} value={breed} onChange={setBreed} />
              <Stepper label="Head" value={count} step={speciesOf(cls) === 'sheep' || speciesOf(cls) === 'poultry' ? 10 : 5} onChange={setCount} />
            </>
          )}
          <Button block disabled={!cls} onClick={add}>Add group</Button>
        </div>
      </Sheet>
    </Screen>
  );
}

/** Move animals from one group to another on a day: both counts change together, with the date. */
function MoveSheet({ b, open, onClose }: { b: FarmBundle; open: boolean; onClose: () => void }) {
  const save = useSave();
  const { farmId } = useFarmCtx();
  const today = todayISO();
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [n, setN] = useState(1);
  const [on, setOn] = useState(today);
  const from = b.groups.find((g) => g.id === fromId);
  const to = b.groups.find((g) => g.id === toId);
  const hist = (id: string) => b.headHistory.filter((h) => h.animal_group_id === id);
  const fromN = from ? headsOn(from, on, hist(from.id)) : 0;
  const toN = to ? headsOn(to, on, hist(to.id)) : 0;
  async function move() {
    if (!from || !to) return;
    const id = uuid();
    const rows = [{ ...headChangeRow(from, fromN - n, on, `moved to ${to.name}`, fromN), id }, headChangeRow(to, toN + n, on, `moved from ${from.name}`, toN)];
    const ok = await save([{ kind: 'rpc', fn: 'move_animals', args: { p_id: id, p_farm_id: farmId, p_from: from.id, p_to: to.id, p_count: n, p_effective_on: on } }], {
      label: `Moved ${n} from ${from.name} to ${to.name}. Feed forecasts updated`,
      patch: (x) => {
        const all = [...x.headHistory, ...rows];
        return { ...x, headHistory: all, groups: x.groups.map((g) => (g.id === from.id || g.id === to.id ? { ...g, head_count: headsOn(g, today, all.filter((h) => h.animal_group_id === g.id)), head_count_updated_at: new Date().toISOString() } : g)) };
      },
      undo: [{ kind: 'rpc', fn: 'move_animals', args: { p_id: uuid(), p_farm_id: farmId, p_from: to.id, p_to: from.id, p_count: n, p_effective_on: on } }],
      undoLabel: 'Moved back'
    });
    if (ok) { onClose(); setFromId(null); setToId(null); setN(1); setOn(today); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Move animals">
      <div className="max-h-[70vh] space-y-4 overflow-auto pb-2">
        <GroupPicker b={b} value={fromId} onChange={(id) => { setFromId(id); if (id === toId) setToId(null); }} label="From" />
        <GroupPicker b={{ ...b, groups: b.groups.filter((g) => g.id !== fromId) }} value={toId} onChange={setToId} label="To" />
        <Stepper label="How many?" value={n} min={1} onChange={setN} unit="head" />
        <DateChips label="Moved on" value={on} onChange={setOn} allowFuture />
        {from && to && <p className="text-[0.9375rem]">{from.name} {fromN} → {Math.max(0, fromN - n)}. {to.name} {toN} → {toN + n}.</p>}
        {from && n > fromN && <p role="alert" className="font-bold text-danger">{from.name} only has {fromN} head on that day.</p>}
        <Button block disabled={!from || !to || n < 1 || n > fromN} onClick={move}>Move {n}</Button>
        <p className="text-sm text-muted">Feeding before the move keeps the old numbers. Group counts here are for feed and money planning, not the official herd register.</p>
      </div>
    </Sheet>
  );
}
