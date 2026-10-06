import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { COST_LABEL, type Cost, type CostCategory } from '../lib/types';
import { todayISO, uuid } from '../lib/format';
import { uploadDocument } from '../lib/upload';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { PhotoInput } from '../components/pickers';

export default function CostForm() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [category, setCategory] = useState<CostCategory | null>((params.get('category') as CostCategory) ?? null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [payee, setPayee] = useState('');
  const [otherLabel, setOtherLabel] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  // Recent payees for this category first: less typing
  const payees = [...new Set(b.costs.filter((c) => !category || c.category === category).map((c) => c.supplier_name).filter(Boolean) as string[])].slice(0, 6);

  async function submit() {
    const documentId = photo && navigator.onLine ? await uploadDocument(photo, farmId!, 'invoice', true).catch(() => null) : null;
    const row = {
      id: uuid(), farm_id: farmId!, category: category!, other_label: category === 'other' ? otherLabel || null : null, occurred_on: date,
      amount_eur: Number(amount), supplier_name: payee || null, description: note || null, document_id: documentId
    };
    const ok = await save([{ kind: 'insert', table: 'costs', row }], {
      label: 'Cost saved',
      patch: (x) => ({ ...x, costs: [{ ...row, supplier_id: null, feed_transaction_id: null } as Cost, ...x.costs] }),
      undo: [{ kind: 'delete', table: 'costs', match: { id: row.id } }]
    });
    if (ok) nav('/money', { replace: true });
  }

  return (
    <Screen title="Paid a bill" back>
      <Card className="space-y-5">
        <Chips label="What for?" columns={2} value={category} onChange={setCategory}
          options={(Object.keys(COST_LABEL) as CostCategory[]).map((c) => ({ value: c, label: COST_LABEL[c] }))}
          hint={category === 'feed' ? 'Tip: log meal through "Feed arrived" and the cost is added for you, with stock.' : undefined} />
        {category === 'other' && <TextInput label="Describe it" value={otherLabel} onChange={setOtherLabel} voice />}
        <NumberInput label="Amount" value={amount} onChange={setAmount} unit="€" />
        <DateChips label="Paid on" value={date} onChange={setDate} />
        <div>
          <TextInput label="Paid to" value={payee} onChange={setPayee} list="payees" />
          {payees.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {payees.map((p) => <button key={p} type="button" onClick={() => setPayee(p)} className="min-h-[2.75rem] rounded-full border-2 border-line bg-white px-3 font-bold">{p}</button>)}
            </div>
          )}
          <datalist id="payees">{payees.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <TextInput label="Note (optional)" value={note} onChange={setNote} voice />
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <SaveBar><Button block disabled={!category || !amount} onClick={submit}>Save cost</Button></SaveBar>
    </Screen>
  );
}
