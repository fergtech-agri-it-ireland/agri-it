import { useState } from 'react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { ANIMAL_CLASS_LABEL, type AnimalClass, type AnimalGroup } from '../lib/types';
import { fmtRelative, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, Empty, NumberInput, Screen, Sheet, Stepper, TextInput } from '../components/ui';

function GroupCard({ g }: { g: AnimalGroup }) {
  const save = useSave();
  const [count, setCount] = useState(g.head_count);
  const [usage, setUsage] = useState(g.forage_t_per_head_month !== null ? String(g.forage_t_per_head_month) : '');
  const [more, setMore] = useState(false);
  const dirty = count !== g.head_count;
  const updated = g.head_count_updated_at.slice(0, 10);
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-lg font-bold">{g.name}</p><p className="text-sm text-muted">{ANIMAL_CLASS_LABEL[g.animal_class]}. Count updated {fmtRelative(updated)}</p></div>
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
      <button type="button" className="min-h-tap font-bold text-accent underline" onClick={() => setMore(!more)}>{more ? 'Hide' : 'Winter and housing details'}</button>
      {more && (
        <div className="space-y-3">
          <label className="flex min-h-tap items-center gap-3 font-bold">
            <input type="checkbox" className="h-6 w-6 accent-field" checked={g.housed} onChange={(e) => save([{ kind: 'update', table: 'animal_groups', match: { id: g.id }, patch: { housed: e.target.checked } }], { label: 'Saved', patch: (x) => ({ ...x, groups: x.groups.map((y) => (y.id === g.id ? { ...y, housed: e.target.checked } : y)) }) })} />
            Housed for winter (counts toward silage need)
          </label>
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
  const groups = b.groups.filter((g) => !g.archived);

  async function add() {
    const row = { id: uuid(), farm_id: farmId!, name: name || ANIMAL_CLASS_LABEL[cls!], animal_class: cls!, head_count: count, sort_order: groups.length };
    await save([{ kind: 'insert', table: 'animal_groups', row }], {
      label: 'Group added',
      patch: (x) => ({ ...x, groups: [...x.groups, { ...row, head_count_updated_at: new Date().toISOString(), forage_t_per_head_month: null, housed: true, archived: false }] })
    });
    setOpen(false); setCls(null); setName(''); setCount(10);
  }

  return (
    <Screen title="Animal groups" back="/farm" right={<Button variant="hivis" onClick={() => setOpen(true)}>Add</Button>}>
      <p className="px-1 text-muted">Head counts drive every feed and silage forecast. Sales update them automatically.</p>
      {groups.length === 0 ? <Empty title="No groups yet" action={<Button variant="hivis" onClick={() => setOpen(true)}>Add a group</Button>} /> : groups.map((g) => <GroupCard key={g.id + g.head_count} g={g} />)}
      <Sheet open={open} onClose={() => setOpen(false)} title="New group">
        <div className="max-h-[70vh] space-y-4 overflow-auto pb-2">
          <Chips columns={2} value={cls} onChange={(c) => { setCls(c); setName(ANIMAL_CLASS_LABEL[c]); }} options={(Object.keys(ANIMAL_CLASS_LABEL) as AnimalClass[]).map((c) => ({ value: c, label: ANIMAL_CLASS_LABEL[c] }))} />
          <TextInput label="Name" value={name} onChange={setName} />
          <Stepper label="Head" value={count} step={5} onChange={setCount} />
          <Button block disabled={!cls} onClick={add}>Add group</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
