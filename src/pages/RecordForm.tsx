import { useEffect, useState } from 'react';
import { jurisdictionInfo } from '../lib/jurisdiction';
import { IN_BROWSER } from '../lib/env';
import { useSearchParams } from 'react-router-dom';
import { clearPendingPhoto, peekPendingPhoto } from '../lib/pendingPhoto';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { uploadDocument } from '../lib/upload';
import type { FarmRecord, RecordType } from '../lib/types';
import { todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';
import { GroupPicker, PhotoInput } from '../components/pickers';

export default function RecordForm() {
  const b = useFarmData();
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
  const [groupId, setGroupId] = useState<string | null>(null);
  const [batch, setBatch] = useState('');
  const [from, setFrom] = useState('');
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
    if (groupId && (type === 'medicine' || type === 'movement')) details.animal_group_id = groupId;
    if (batch && type === 'medicine') details.batch = batch;
    if (from && (type === 'medicine' || type === 'fertiliser')) details.supplier = from;
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
        {type === 'medicine' && <TextInput label="Batch no. (optional)" value={batch} onChange={setBatch} />}
        {(type === 'medicine' || type === 'fertiliser') && <TextInput label="Bought from (optional)" value={from} onChange={setFrom} />}
        {(type === 'medicine' || type === 'movement') && b.groups.some((g) => !g.archived) && <GroupPicker b={b} value={groupId} onChange={(id) => setGroupId(id === groupId ? null : id)} label="Which group? (optional)" />}
        {type === 'movement' && <Chips columns={2} value={direction} onChange={setDirection} options={[{ value: 'out', label: 'Out' }, { value: 'in', label: 'In' }]} />}
        <TextInput label="Note" value={title} onChange={setTitle} voice placeholder="e.g. Dosed weanlings" />
        <DateChips label="Date" value={date} onChange={setDate} />
        <PhotoInput file={photo} onFile={setPhoto} />
      </Card>
      <p className="px-1 text-sm text-muted">Kept as your evidence. It does not replace an official register or a notification to {jurisdictionInfo(b.farm.jurisdiction).department}.</p>
      <SaveBar><Button block disabled={!title && !product} onClick={submit}>Save record</Button></SaveBar>
    </Screen>
  );
}
