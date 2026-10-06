import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { eur, todayISO, uuid } from '../lib/format';
import { Button, Card, DateChips, Empty, LinkButton, NumberInput, SaveBar, Screen, Stepper, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';

/** One entry updates income, the group's head count, and so every feed and forage forecast. */
export default function AnimalSaleForm() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const last = b.income.filter((i) => i.income_type === 'livestock')[0];
  const [groupId, setGroupId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [buyer, setBuyer] = useState(last?.counterparty ?? '');
  const [reduce, setReduce] = useState(true);
  const group = b.groups.find((g) => g.id === groupId);
  if (!b.groups.some((g) => !g.archived)) return <Screen title="Sold animals" back><Empty title="Add your animal groups first" action={<LinkButton to="/farm/groups">Add groups</LinkButton>} /></Screen>;

  async function submit() {
    const id = uuid();
    const ok = await save([{ kind: 'rpc', fn: 'record_animal_sale', args: {
      p_id: id, p_farm_id: farmId, p_group_id: groupId, p_head_count: count, p_amount_eur: Number(amount), p_occurred_on: date,
      p_counterparty: buyer || null, p_reduce_group: reduce
    } }], {
      label: `Sale saved${reduce && group ? `. ${group.name} now ${Math.max(0, group.head_count - count)}` : ''}`,
      patch: (x) => ({
        ...x,
        groups: reduce ? x.groups.map((g) => (g.id === groupId ? { ...g, head_count: Math.max(0, g.head_count - count), head_count_updated_at: new Date().toISOString() } : g)) : x.groups,
        income: [{ id, farm_id: farmId!, income_type: 'livestock', occurred_on: date, amount_eur: Number(amount), counterparty: buyer || null, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: groupId, head_count: count, description: `${count} sold`, document_id: null }, ...x.income]
      }),
      undo: [{ kind: 'rpc', fn: 'undo_animal_sale', args: { p_income_id: id } }],
      undoLabel: 'Sale removed'
    });
    if (ok) nav('/money', { replace: true });
  }

  return (
    <Screen title="Sold animals" back>
      <Card className="space-y-5">
        <GroupPicker b={b} value={groupId} onChange={setGroupId} label="From which group?" />
        <Stepper label="How many?" value={count} min={1} onChange={setCount} unit="head" />
        <NumberInput label="Total received" value={amount} onChange={setAmount} unit="€" hint={amount && count ? `${eur(Number(amount) / count)} per head` : undefined} />
        <DateChips label="Sold on" value={date} onChange={setDate} />
        <TextInput label="Sold to" value={buyer} onChange={setBuyer} placeholder="e.g. Mart, factory, private" />
        {group && (
          <label className="flex min-h-tap items-center gap-3 font-bold">
            <input type="checkbox" className="h-6 w-6 accent-field" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />
            Take {count} off {group.name} ({group.head_count} → {Math.max(0, group.head_count - count)})
          </label>
        )}
      </Card>
      <SaveBar><Button block disabled={!groupId || !amount || count < 1} onClick={submit}>Save sale</Button></SaveBar>
    </Screen>
  );
}
