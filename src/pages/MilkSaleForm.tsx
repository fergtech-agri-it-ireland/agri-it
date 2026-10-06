import { RepeatChips } from '../components/RepeatChips';
import { routineFromEntry, type RepeatChoice } from '../lib/routines';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { Income } from '../lib/types';
import { eur, fmtNum, todayISO, uuid } from '../lib/format';
import { budgetVsActual, cashPosition, fyRange } from '../lib/forecast/money';
import { clearPendingPhoto, peekPendingPhoto } from '../lib/pendingPhoto';
import { showSaved } from '../lib/saved';
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
  const [photo, setPhoto] = useState<File | null>(() => peekPendingPhoto());
  const [repeat, setRepeat] = useState<RepeatChoice>('none');
  useEffect(() => () => clearPendingPhoto(), []);
  const cpl = amount && litres ? (Number(amount) / Number(litres)) * 100 : null;

  async function submit() {
    const documentId = photo && navigator.onLine ? await uploadDocument(photo, farmId!, 'invoice', true).catch(() => null) : null;
    const row = {
      id: uuid(), farm_id: farmId!, income_type: 'milk' as const, occurred_on: date, amount_eur: Number(amount), counterparty: buyer || null,
      milk_litres: litres ? Number(litres) : null, fat_kg: fat ? Number(fat) : null, protein_kg: protein ? Number(protein) : null,
      description: 'Milk cheque', document_id: documentId
    };
    const rep = repeat === 'none' ? null : routineFromEntry({
      farmId: farmId!, kind: 'income', title: 'Milk cheque', date, amount: Number(amount), category: 'milk',
      counterparty: buyer || null, repeat, recordTable: 'income', recordId: row.id, routineId: uuid()
    });
    const result = await save([{ kind: 'insert', table: 'income', row }, ...(rep?.ops ?? [])], {
      label: 'Milk cheque saved',
      quiet: true,
      patch: (x) => ({
        ...x, income: [{ ...row, animal_group_id: null, head_count: null } as Income, ...x.income],
        routines: rep ? [...x.routines, rep.routine] : x.routines, completions: rep ? [...x.completions, rep.completion] : x.completions
      }),
      undo: [{ kind: 'delete', table: 'income', match: { id: row.id } }]
    });
    if (!result) return;

    const today = todayISO();
    const fy = fyRange(b.farm, today);
    const milkYear = b.income.filter((i) => i.income_type === 'milk' && i.occurred_on >= fy.start && i.occurred_on <= fy.end);
    const yearBefore = milkYear.reduce((s, i) => s + Number(i.amount_eur), 0);
    const litresYear = milkYear.reduce((s, i) => s + Number(i.milk_litres ?? 0), 0) + Number(litres || 0);
    const yearAfter = yearBefore + (row.occurred_on >= fy.start && row.occurred_on <= fy.end ? row.amount_eur : 0);
    const budget = budgetVsActual(b.farm, b, today).rows.find((r) => r.kind === 'income' && r.category === 'milk')?.budget ?? 0;
    const cash = cashPosition(b.farm, b.income, b.costs, today);
    const litresWithPrice = milkYear.filter((i) => i.milk_litres).reduce((s, i) => s + Number(i.amount_eur), 0) + (litres ? row.amount_eur : 0);
    showSaved(nav, result, {
      title: 'Milk cheque saved',
      subtitle: `${eur(row.amount_eur)}${buyer ? ` from ${buyer}` : ''}${litres ? `, ${fmtNum(Number(litres))} L` : ''}`,
      rows: [
        { label: 'Milk income this year', before: eur(yearBefore), after: eur(yearAfter), sub: budget > 0 ? `of ${eur(budget)} budget so far` : undefined },
        ...(cash && row.occurred_on <= today ? [{ label: 'Cash recorded', before: eur(cash.balance), after: eur(cash.balance + row.amount_eur) }] : []),
        ...(cpl !== null ? [{ label: 'This cheque', after: `${fmtNum(cpl)} c/L`, sub: litresYear > 0 ? `Year average ${fmtNum((litresWithPrice / litresYear) * 100)} c/L` : undefined }] : [])
      ],
      note: `Added to income, cash flow and the year-end pack.${rep ? ` Repeats ${repeat}: the next one shows on Today, ready to tick off with the real amount.` : ''}`,
      undo: [...(rep ? [{ kind: 'delete' as const, table: 'routines', match: { id: rep.routine.id } }] : []), { kind: 'delete', table: 'income', match: { id: row.id } }],
      undoLabel: 'Milk cheque removed',
      photo: documentId ? undefined : { table: 'income', id: row.id, recordType: 'invoice' },
      again: { label: 'Another cheque', to: '/record/milk' }
    });
  }

  return (
    <Screen title="Milk cheque" back>
      <Card className="space-y-5">
        <NumberInput label="Amount received" value={amount} onChange={setAmount} unit="€" autoFocus />
        <NumberInput label="Litres (optional)" value={litres} onChange={setLitres} unit="L" hint={cpl ? `${fmtNum(cpl)} c/L` : last?.milk_litres ? `Last cheque: ${fmtNum(Number(last.milk_litres))} L for ${eur(Number(last.amount_eur))}` : undefined} />
        {!showSolids ? (
          <button type="button" className="min-h-tap font-bold text-accent underline" onClick={() => setShowSolids(true)}>Add fat and protein kg</button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <NumberInput label="Fat" value={fat} onChange={setFat} unit="kg" />
            <NumberInput label="Protein" value={protein} onChange={setProtein} unit="kg" />
          </div>
        )}
        <DateChips label="Paid on" value={date} onChange={setDate} />
        <TextInput label="Processor" value={buyer} onChange={setBuyer} placeholder="e.g. your co-op" />
        <RepeatChips value={repeat} onChange={setRepeat} date={date} />
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <SaveBar><Button block disabled={!amount} onClick={submit}>Save milk cheque</Button></SaveBar>
    </Screen>
  );
}
