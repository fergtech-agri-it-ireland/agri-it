import { RepeatChips } from '../components/RepeatChips';
import { routineFromEntry, type RepeatChoice } from '../lib/routines';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { farmTypes } from '../lib/farmTypes';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { Income } from '../lib/types';
import { todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';

export default function IncomeForm() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const grower = farmTypes(b.farm).includes('tillage');
  const [type, setType] = useState<'crop' | 'grant' | 'other'>(params.get('type') === 'crop' ? 'crop' : 'grant');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [from, setFrom] = useState('');
  const [desc, setDesc] = useState('');
  const [repeat, setRepeat] = useState<RepeatChoice>('none');

  async function submit() {
    const row = { id: uuid(), farm_id: farmId!, income_type: type, occurred_on: date, amount_eur: Number(amount), counterparty: from || null, description: desc || null };
    const rep = repeat === 'none' ? null : routineFromEntry({
      farmId: farmId!, kind: 'income', title: desc || (type === 'grant' ? 'Grant or scheme payment' : type === 'crop' ? 'Grain or straw sale' : 'Other income'), date, amount: Number(amount),
      category: type, counterparty: from || null, repeat, recordTable: 'income', recordId: row.id, routineId: uuid()
    });
    const ok = await save([{ kind: 'insert', table: 'income', row }, ...(rep?.ops ?? [])], {
      label: 'Income saved',
      patch: (x) => ({ ...x, routines: rep ? [...x.routines, rep.routine] : x.routines, completions: rep ? [...x.completions, rep.completion] : x.completions, income: [{ ...row, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, document_id: null } as Income, ...x.income] }),
      undo: [{ kind: 'delete', table: 'income', match: { id: row.id } }]
    });
    if (ok) nav('/money', { replace: true });
  }

  return (
    <Screen title={type === 'crop' ? 'Grain or straw sale' : 'Income'} back>
      <Card className="space-y-5">
        <Chips columns={grower || type === 'crop' ? 3 : 2} value={type} onChange={setType} options={[
          ...(grower || type === 'crop' ? [{ value: 'crop' as const, label: 'Grain or straw' }] : []),
          { value: 'grant', label: 'Grant or scheme' }, { value: 'other', label: 'Other' }
        ]} />
        <NumberInput label="Amount" value={amount} onChange={setAmount} unit="€" />
        <DateChips label="Received" value={date} onChange={setDate} />
        <TextInput label="From" value={from} onChange={setFrom} placeholder={type === 'crop' ? 'e.g. merchant or neighbour' : 'e.g. Department of Agriculture'} />
        <TextInput label="What for (optional)" value={desc} onChange={setDesc} voice />
        <RepeatChips value={repeat} onChange={setRepeat} date={date} />
      </Card>
      <SaveBar><Button block disabled={!amount} onClick={submit}>Save income</Button></SaveBar>
    </Screen>
  );
}
