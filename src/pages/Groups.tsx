import { useState } from 'react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { ANIMAL_CLASS_LABEL, type AnimalClass, type AnimalGroup } from '../lib/types';
import { fmtRelative, todayISO, uuid } from '../lib/format';
import { Button, Card, Empty, NumberInput, Screen, Sheet, Stepper, TextInput } from '../components/ui';
import { BreedField, ClassPicker } from '../components/FarmPickers';
import { speciesOf } from '../lib/farmTypes';

function GroupCard({ g }: { g: AnimalGroup }) {
  const save = useSave();
  const [count, setCount] = useState(g.head_count);
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
      <Stepper label="Head" value={count} onChange={setCount} unit="head" />
      {dirty ? (
        <Button block onClick={() => save([{ kind: 'rpc', fn: 'set_head_count', args: { p_group_id: g.id, p_head_count: count, p_reason: 'manual', p_effective_on: todayISO() } }], {
          label: `${g.name}: ${count} head. Feed forecasts updated`,
          patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, head_count: count, head_count_updated_at: new Date().toISOString() } : y)) }),
          undo: [{ kind: 'rpc', fn: 'set_head_count', args: { p_group_id: g.id, p_head_count: g.head_count, p_reason: 'undo' } }]
        })}>Save {count} head</Button>
      ) : (
        <Button variant="ghost" block onClick={() => save([{ kind: 'rpc', fn: 'set_head_count', args: { p_group_id: g.id, p_head_count: g.head_count, p_reason: 'confirmed' } }], {
          label: 'Count confirmed',
          patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, head_count_updated_at: new Date().toISOString() } : y)) })
        })}>Still {g.head_count}: confirm</Button>
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
      <p className="px-1 text-[0.9375rem] text-muted">Head counts drive every feed and silage forecast. Sales update them for you.</p>
      {groups.length === 0 ? <Empty title="No groups yet" body="Cattle, sheep, goats, pigs, poultry or horses: add a group for each." action={<Button onClick={() => setOpen(true)}>Add a group</Button>} /> : groups.map((g) => <GroupCard key={g.id + g.head_count} g={g} />)}
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
