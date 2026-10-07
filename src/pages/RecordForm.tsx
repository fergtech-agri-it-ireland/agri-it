import { useEffect, useState } from 'react';
import { IN_BROWSER } from '../lib/env';
import { useSearchParams } from 'react-router-dom';
import { clearPendingPhoto, peekPendingPhoto } from '../lib/pendingPhoto';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { uploadDocument } from '../lib/upload';
import type { FarmRecord, RecordType } from '../lib/types';
import { todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { PhotoInput } from '../components/pickers';

export default function RecordForm() {
  useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [type, setType] = useState<RecordType>((params.get('type') as RecordType) ?? 'medicine');
  const [date, setDate] = useState(todayISO());
  const [title, setTitle] = useState('');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('');
  const [animals, setAnimals] = useState('');
  const [withdrawal, setWithdrawal] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [photo, setPhoto] = useState<File | null>(() => peekPendingPhoto());
  useEffect(() => () => clearPendingPhoto(), []);

  async function submit() {
    const documentId = photo && (IN_BROWSER || navigator.onLine) ? await uploadDocument(photo, farmId!, type, true).catch(() => null) : null;
    const details: Record<string, unknown> = {};
    if (product) details.product = product;
    if (qty) details.quantity_kg = Number(qty);
    if (animals) details.animals = Number(animals);
    if (withdrawal) details.withdrawal_days = Number(withdrawal);
    if (type === 'movement') details.direction = direction;
    const row = { id: uuid(), farm_id: farmId!, record_type: type, occurred_on: date, title: title || product || 'Record', details, document_id: documentId, state: 'confirmed' as const };
    const ok = await save([{ kind: 'insert', table: 'farm_records', row }], {
      label: 'Record saved',
      patch: (x) => ({ ...x, records: [row as FarmRecord, ...x.records] }),
      undo: [{ kind: 'delete', table: 'farm_records', match: { id: row.id } }]
    });
    if (ok) nav('/records', { replace: true });
  }

  return (
    <Screen title="Farm record" back>
      <Card className="space-y-5">
        <Chips columns={2} value={type} onChange={setType} options={[
          { value: 'medicine', label: 'Medicine' }, { value: 'fertiliser', label: 'Fertiliser' }, { value: 'movement', label: 'Movement' }, { value: 'other', label: 'Other' }
        ]} />
        {type !== 'movement' && <TextInput label="Product" value={product} onChange={setProduct} voice />}
        {type === 'fertiliser' && <NumberInput label="Quantity" value={qty} onChange={setQty} unit="kg" />}
        {(type === 'medicine' || type === 'movement') && <NumberInput label="Animals" value={animals} onChange={setAnimals} integer />}
        {type === 'medicine' && <NumberInput label="Withdrawal period" value={withdrawal} onChange={setWithdrawal} unit="days" integer />}
        {type === 'movement' && <Chips columns={2} value={direction} onChange={setDirection} options={[{ value: 'out', label: 'Out' }, { value: 'in', label: 'In' }]} />}
        <TextInput label="Note" value={title} onChange={setTitle} voice placeholder="e.g. Dosed weanlings" />
        <DateChips label="Date" value={date} onChange={setDate} />
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <SaveBar><Button block disabled={!title && !product} onClick={submit}>Save record</Button></SaveBar>
    </Screen>
  );
}
