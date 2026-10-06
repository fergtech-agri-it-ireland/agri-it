import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { Income } from '../lib/types';
import { eur, fmtNum, todayISO, uuid } from '../lib/format';
import { uploadDocument } from '../lib/upload';
import { Button, Card, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { PhotoInput } from '../components/pickers';

export default function MilkSaleForm() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const last = b.income.filter((i) => i.income_type === 'milk').sort((a, c) => c.occurred_on.localeCompare(a.occurred_on))[0];
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [fat, setFat] = useState('');
  const [protein, setProtein] = useState('');
  const [showSolids, setShowSolids] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [buyer, setBuyer] = useState(last?.counterparty ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const cpl = amount && litres ? (Number(amount) / Number(litres)) * 100 : null;

  async function submit() {
    const documentId = photo && navigator.onLine ? await uploadDocument(photo, farmId!, 'invoice', true).catch(() => null) : null;
    const row = {
      id: uuid(), farm_id: farmId!, income_type: 'milk' as const, occurred_on: date, amount_eur: Number(amount), counterparty: buyer || null,
      milk_litres: litres ? Number(litres) : null, fat_kg: fat ? Number(fat) : null, protein_kg: protein ? Number(protein) : null,
      description: 'Milk cheque', document_id: documentId
    };
    const ok = await save([{ kind: 'insert', table: 'income', row }], {
      label: 'Milk cheque saved',
      patch: (x) => ({ ...x, income: [{ ...row, animal_group_id: null, head_count: null } as Income, ...x.income] }),
      undo: [{ kind: 'delete', table: 'income', match: { id: row.id } }]
    });
    if (ok) nav('/money', { replace: true });
  }

  return (
    <Screen title="Milk cheque" back>
      <Card className="space-y-5">
        <NumberInput label="Amount received" value={amount} onChange={setAmount} unit="€" autoFocus />
        <NumberInput label="Litres (optional)" value={litres} onChange={setLitres} unit="L" hint={cpl ? `${fmtNum(cpl)} c/L` : last?.milk_litres ? `Last cheque: ${fmtNum(Number(last.milk_litres))} L for ${eur(Number(last.amount_eur))}` : undefined} />
        {!showSolids ? (
          <button type="button" className="min-h-tap font-bold text-field underline" onClick={() => setShowSolids(true)}>Add fat and protein kg</button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <NumberInput label="Fat" value={fat} onChange={setFat} unit="kg" />
            <NumberInput label="Protein" value={protein} onChange={setProtein} unit="kg" />
          </div>
        )}
        <DateChips label="Paid on" value={date} onChange={setDate} />
        <TextInput label="Processor" value={buyer} onChange={setBuyer} placeholder="e.g. your co-op" />
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <SaveBar><Button block disabled={!amount} onClick={submit}>Save milk cheque</Button></SaveBar>
    </Screen>
  );
}
