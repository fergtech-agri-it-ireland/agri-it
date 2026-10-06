import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { Income } from '../lib/types';
import { todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';

export default function IncomeForm() {
  useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [type, setType] = useState<'grant' | 'other'>('grant');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [from, setFrom] = useState('');
  const [desc, setDesc] = useState('');

  async function submit() {
    const row = { id: uuid(), farm_id: farmId!, income_type: type, occurred_on: date, amount_eur: Number(amount), counterparty: from || null, description: desc || null };
    const ok = await save([{ kind: 'insert', table: 'income', row }], {
      label: 'Income saved',
      patch: (x) => ({ ...x, income: [{ ...row, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, document_id: null } as Income, ...x.income] }),
      undo: [{ kind: 'delete', table: 'income', match: { id: row.id } }]
    });
    if (ok) nav('/money', { replace: true });
  }

  return (
    <Screen title="Other income" back>
      <Card className="space-y-5">
        <Chips columns={2} value={type} onChange={setType} options={[{ value: 'grant', label: 'Grant or scheme' }, { value: 'other', label: 'Other' }]} />
        <NumberInput label="Amount" value={amount} onChange={setAmount} unit="€" />
        <DateChips label="Received" value={date} onChange={setDate} />
        <TextInput label="From" value={from} onChange={setFrom} placeholder="e.g. Department of Agriculture" />
        <TextInput label="What for (optional)" value={desc} onChange={setDesc} voice />
      </Card>
      <SaveBar><Button block disabled={!amount} onClick={submit}>Save income</Button></SaveBar>
    </Screen>
  );
}
