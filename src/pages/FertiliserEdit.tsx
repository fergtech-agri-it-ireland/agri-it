import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { FertiliserProduct, FertiliserStock } from '../lib/types';
import { todayISO, uuid } from '../lib/format';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, NumberInput, SaveBar, Screen } from '../components/ui';
import { SupplierPicker } from '../components/pickers';
import { ProductPick } from '../components/ProductPick';

type Unit = 't' | 'bags' | 'kg';
const FACTOR: Record<Unit, number> = { t: 1000, bags: 500, kg: 1 };

/** Add a fertiliser (or lime) kept in stock, or change one. */
export default function FertiliserEdit() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const existing = b.fertilisers.find((p) => p.id === id);
  const [supplierId, setSupplierId] = useState<string | null>(existing?.supplier_id ?? null);
  const [pick, setPick] = useState({ name: existing?.name ?? '', catalogueKey: existing?.catalogue_key ?? null });
  const [lowUnit, setLowUnit] = useState<Unit>('t');
  const [low, setLow] = useState(existing?.low_stock_kg !== null && existing?.low_stock_kg !== undefined ? String(Number(existing.low_stock_kg) / 1000) : '');
  const [stockUnit, setStockUnit] = useState<Unit>('t');
  const [stock, setStock] = useState('');
  const [evidence, setEvidence] = useState<'measured' | 'farmer_estimate'>('measured');

  async function submit() {
    const pid = existing?.id ?? uuid();
    const row = {
      name: pick.name.trim(), catalogue_key: pick.catalogueKey, supplier_id: supplierId,
      low_stock_kg: low === '' ? null : Math.round(Number(low) * FACTOR[lowUnit] * 10) / 10
    };
    const ops: Op[] = existing
      ? [{ kind: 'update', table: 'fertiliser_products', match: { id: pid }, patch: row }]
      : [{ kind: 'insert', table: 'fertiliser_products', row: { id: pid, farm_id: farmId!, ...row } }];
    let opening: FertiliserStock | null = null;
    if (!existing && stock !== '' && Number(stock) >= 0) {
      opening = { id: uuid(), farm_id: farmId!, product_id: pid, kind: evidence === 'measured' ? 'count' : 'opening', quantity_kg: Math.round(Number(stock) * FACTOR[stockUnit] * 10) / 10, on_date: todayISO(), evidence, supplier_id: null, cost_id: null, notes: null };
      ops.push({ kind: 'insert', table: 'fertiliser_stock', row: { ...opening } });
    }
    const ok = await save(ops, {
      label: existing ? 'Fertiliser saved' : `${row.name} added`,
      patch: (x) => ({
        ...x,
        fertilisers: existing ? x.fertilisers.map((p) => (p.id === pid ? { ...p, ...row } : p)) : [...x.fertilisers, { id: pid, farm_id: farmId!, ...row, archived: false } as FertiliserProduct],
        fertStock: opening ? [...x.fertStock, { ...opening, created_at: new Date().toISOString() }] : x.fertStock
      })
    });
    if (ok) nav(`/fertiliser/${pid}`, { replace: true });
  }

  async function archive() {
    if (!existing) return;
    const ok = await save([{ kind: 'update', table: 'fertiliser_products', match: { id: existing.id }, patch: { archived: true } }], {
      label: `${existing.name} taken off the list`, patch: (x) => ({ ...x, fertilisers: x.fertilisers.map((p) => (p.id === existing.id ? { ...p, archived: true } : p)) }),
      undo: [{ kind: 'update', table: 'fertiliser_products', match: { id: existing.id }, patch: { archived: false } }]
    });
    if (ok) nav('/fertiliser', { replace: true });
  }

  return (
    <Screen title={existing ? `Edit ${existing.name}` : 'Add a fertiliser'} back>
      <Card className="space-y-5">
        <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} label="Who do you buy it from? (optional)" />
        <ProductPick kind="fertiliser" supplierId={supplierId} name={pick.name} catalogueKey={pick.catalogueKey} onChange={setPick} label="What is it?" />
      </Card>
      {!existing && (
        <Card className="space-y-4">
          <Chips label="How much is in the shed now? (optional)" columns={3} value={stockUnit} onChange={setStockUnit} options={[{ value: 't', label: 'Tonnes' }, { value: 'bags', label: '500 kg bags' }, { value: 'kg', label: 'kg' }]} />
          <NumberInput label="In the shed" value={stock} onChange={setStock} unit={stockUnit === 'bags' ? 'bags' : stockUnit} />
          {stock !== '' && <Chips columns={2} value={evidence} onChange={setEvidence} options={[{ value: 'measured', label: 'Counted', sub: 'Bags counted or weighed' }, { value: 'farmer_estimate', label: 'Rough guess', sub: 'A stock check later makes it exact' }]} />}
        </Card>
      )}
      <Card className="space-y-4">
        <Chips label="Warn me when it's down to (optional)" columns={3} value={lowUnit} onChange={setLowUnit} options={[{ value: 't', label: 'Tonnes' }, { value: 'bags', label: '500 kg bags' }, { value: 'kg', label: 'kg' }]} />
        <NumberInput label="Low level" value={low} onChange={setLow} unit={lowUnit === 'bags' ? 'bags' : lowUnit} hint="Your own level. Agri-It also warns when the fields due need more than you have." />
      </Card>
      {existing && <Button variant="secondary" block onClick={archive}>Take it off the list</Button>}
      <SaveBar><Button block disabled={!pick.name.trim()} onClick={submit}>{existing ? 'Save' : 'Add fertiliser'}</Button></SaveBar>
    </Screen>
  );
}
