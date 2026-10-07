import { RepeatChips } from '../components/RepeatChips';
import { routineFromEntry, type RepeatChoice } from '../lib/routines';
import { useEffect, useState } from 'react';
import { clearPendingPhoto, peekPendingPhoto, peekPendingQueueId, peekPendingRead } from '../lib/pendingPhoto';
import { usable } from '../lib/docket/extract';
import { extractedRecord, isReferenceNote, keepEvidence } from '../lib/docket/flow';
import { dropToRead } from '../lib/docket/photoStore';
import { NotReadTag, ReadSummary, ReadTag } from '../components/PhotoRead';
import { useToast } from '../components/Toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { COST_LABEL, type Cost, type CostCategory } from '../lib/types';
import { eur, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { PhotoInput } from '../components/pickers';

export default function CostForm() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  // "Same as last time" passes ?repeat=<cost id>: everything but the date is copied
  const repeat = b.costs.find((c) => c.id === params.get('repeat'));
  const toast = useToast();
  // Read from a photo: only what the photo showed is filled in
  const [read] = useState(() => peekPendingRead());
  const rCategory = usable(read?.costCategory);
  const rAmount = usable(read?.total) ?? usable(read?.net);
  const rAmountRead = read?.total && read.total.confidence !== 'low' ? read.total : read?.net && read.net.confidence !== 'low' ? read.net : read?.total ?? read?.net;
  const rDate = usable(read?.date);
  const rPayee = usable(read?.supplier)?.payee ?? undefined;
  const rRef = usable(read?.docNumber);
  const rVat = usable(read?.vat);
  const rNote = read ? [rRef && `${read.kind === 'invoice' ? 'Invoice' : read.kind === 'docket' ? 'Docket' : 'Receipt'} ${rRef}`,
    rVat && `VAT ${eur(rVat.eur, true)}${rVat.ratePercent !== null ? ` (${rVat.ratePercent}%)` : ''}`].filter(Boolean).join('. ') : '';
  const [category, setCategory] = useState<CostCategory | null>(read ? rCategory ?? null : repeat?.category ?? (params.get('category') as CostCategory) ?? null);
  const [amount, setAmount] = useState(read ? (rAmount !== undefined ? String(rAmount) : '') : repeat ? String(repeat.amount_eur) : '');
  const [date, setDate] = useState(rDate ?? todayISO());
  const [payee, setPayee] = useState(read ? rPayee ?? '' : repeat?.supplier_name ?? '');
  const [otherLabel, setOtherLabel] = useState(repeat?.other_label ?? '');
  const [note, setNote] = useState(read ? rNote : isReferenceNote(repeat?.description) ? '' : repeat?.description ?? '');
  const [photo, setPhoto] = useState<File | null>(() => peekPendingPhoto());
  const [repeats, setRepeats] = useState<RepeatChoice>('none');
  useEffect(() => () => clearPendingPhoto(), []);
  // Recent payees for this category first: less typing
  const payees = [...new Set(b.costs.filter((c) => !category || c.category === category).map((c) => c.supplier_name).filter(Boolean) as string[])].slice(0, 6);

  const edited = {
    category: !!read?.costCategory && rCategory !== undefined && category !== rCategory,
    amount: rAmount !== undefined && Number(amount) !== rAmount,
    date: rDate !== undefined && date !== rDate,
    payee: rPayee !== undefined && payee !== rPayee
  };
  // Directory supplier only if the farmer kept the payee the photo matched
  const supplierId = read?.supplier?.value.supplierId && !edited.payee && read.supplier.confidence !== 'low' ? read.supplier.value.supplierId : null;

  async function submit() {
    // An invoice is only trusted once confirmed in Records; a receipt in hand is checked as you save
    const evidencePhoto = photo ? await keepEvidence(photo, farmId!, 'invoice', read?.kind !== 'invoice',
      read ? extractedRecord(read, Object.entries(edited).filter(([, v]) => v).map(([k]) => k)) : null) : null;
    const documentId = evidencePhoto?.documentId ?? null;
    const row = {
      id: uuid(), farm_id: farmId!, category: category!, other_label: category === 'other' ? otherLabel || null : null, occurred_on: date,
      amount_eur: Number(amount), supplier_name: payee || null, description: note || null, document_id: documentId,
      ...(supplierId ? { supplier_id: supplierId } : {})
    };
    const rep = repeats === 'none' ? null : routineFromEntry({
      farmId: farmId!, kind: 'expense', title: note || (category === 'other' && otherLabel ? otherLabel : COST_LABEL[category!]), date, amount: Number(amount),
      category: category!, counterparty: payee || null, repeat: repeats, recordTable: 'costs', recordId: row.id, routineId: uuid()
    });
    const ok = await save([{ kind: 'insert', table: 'costs', row }, ...(rep?.ops ?? [])], {
      label: rep ? `Cost saved. Repeats ${repeats}, shows in the diary when due` : 'Cost saved',
      patch: (x) => ({
        ...x, costs: [{ supplier_id: null, ...row, feed_transaction_id: null } as Cost, ...x.costs],
        routines: rep ? [...x.routines, rep.routine] : x.routines, completions: rep ? [...x.completions, rep.completion] : x.completions
      }),
      undo: [
        ...(rep ? [{ kind: 'delete' as const, table: 'routines', match: { id: rep.routine.id } }] : []),
        { kind: 'delete', table: 'costs', match: { id: row.id } }
      ]
    });
    if (!ok) return;
    if (evidencePhoto && await evidencePhoto.later({ table: 'costs', id: row.id })) toast.show({ message: 'Photo kept on this phone. It uploads when you have signal.', tone: 'info' });
    const queueId = peekPendingQueueId();
    if (queueId) dropToRead(queueId);
    nav('/money', { replace: true });
  }

  return (
    <Screen title="Paid a bill" back>
      {read && <ReadSummary read={read} photo={photo} onUse={(f, v) => {
        if (f === 'date') setDate(String(v));
        if (f === 'total') setAmount(String(v));
      }} />}
      <Card className="space-y-5">
        <div>
          <Chips label="What for?" columns={2} value={category} onChange={setCategory}
            options={(Object.keys(COST_LABEL) as CostCategory[]).map((c) => ({ value: c, label: COST_LABEL[c] }))}
            hint={category === 'feed' ? 'Tip: log meal through "Feed arrived" and the cost is added for you, with stock.' : undefined} />
          {read && (read.costCategory ? <ReadTag field="category" read={read.costCategory} edited={edited.category} /> : <NotReadTag field="category" what="what it was for" />)}
        </div>
        {category === 'other' && <TextInput label="Describe it" value={otherLabel} onChange={setOtherLabel} voice />}
        <div>
          <NumberInput label="Amount" value={amount} onChange={setAmount} unit="€" hint={read?.vat && rAmount !== undefined && read.total ? 'The total paid, VAT included' : undefined} />
          {read && (rAmountRead ? <ReadTag field="amount" read={rAmountRead} edited={edited.amount} /> : <NotReadTag field="amount" what="the amount" />)}
        </div>
        <div>
          <DateChips label="Paid on" value={date} onChange={setDate} />
          {read && (read.date && rDate ? <ReadTag field="date" read={read.date} edited={edited.date} /> : <NotReadTag field="date" what="the date (today is filled in)" />)}
        </div>
        <div>
          <TextInput label="Paid to" value={payee} onChange={setPayee} list="payees" />
          {read && (read.supplier ? <ReadTag field="payee" read={read.supplier} edited={edited.payee} /> : <NotReadTag field="payee" what="who it was paid to" />)}
          {payees.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {payees.map((p) => <button key={p} type="button" onClick={() => setPayee(p)} className="min-h-[2.75rem] rounded-full border-2 border-line bg-card px-3 font-bold">{p}</button>)}
            </div>
          )}
          <datalist id="payees">{payees.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <TextInput label="Note (optional)" value={note} onChange={setNote} voice />
        <RepeatChips value={repeats} onChange={setRepeats} date={date} />
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <SaveBar><Button block disabled={!category || !amount} onClick={submit}>Save cost</Button></SaveBar>
    </Screen>
  );
}
