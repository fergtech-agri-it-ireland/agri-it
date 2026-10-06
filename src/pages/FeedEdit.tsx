import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { Evidence, FeedProduct, FeedTransaction } from '../lib/types';
import { todayISO, uuid } from '../lib/format';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, SaveBar, Screen, Stepper, TextInput } from '../components/ui';
import { QuantityInput, SupplierPicker } from '../components/pickers';

export default function FeedEdit() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const existing = b.products.find((p) => p.id === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [supplierId, setSupplierId] = useState<string | null>(existing?.supplier_id ?? null);
  const [storage, setStorage] = useState(existing?.storage_location ?? '');
  const [mode, setMode] = useState<'days' | 'kg'>(existing?.safety_stock_mode ?? 'days');
  const [safety, setSafety] = useState<number>(existing ? Number(existing.safety_stock_value) : 3);
  const [knowLead, setKnowLead] = useState(existing ? existing.lead_time_days !== null : false);
  const [lead, setLead] = useState<number>(existing?.lead_time_days ?? 3);
  const [stockKg, setStockKg] = useState('');
  const [unit, setUnit] = useState<'kg' | 't'>('t');
  const [evidence, setEvidence] = useState<Evidence>('measured');

  const recentNames = [...new Set(b.products.map((p) => p.name))];

  async function submit() {
    const pid = existing?.id ?? uuid();
    const row = {
      id: pid, farm_id: farmId, name: name.trim(), supplier_id: supplierId, storage_location: storage || null,
      safety_stock_mode: mode, safety_stock_value: safety, lead_time_days: knowLead ? lead : null
    };
    const ops: Op[] = existing
      ? [{ kind: 'update', table: 'feed_products', match: { id: pid }, patch: row }]
      : [{ kind: 'insert', table: 'feed_products', row }];
    let txn: FeedTransaction | null = null;
    if (!existing && stockKg !== '' && Number(stockKg) >= 0) {
      txn = {
        id: uuid(), farm_id: farmId!, feed_product_id: pid, txn_type: evidence === 'measured' ? 'count' : 'opening', quantity_kg: Number(stockKg),
        effective_on: todayISO(), evidence, order_date: null, delivery_date: null, expected_delivery_date: null, order_status: null,
        linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null, document_id: null, notes: null, created_at: new Date().toISOString()
      };
      const { created_at: _c, ...insertRow } = txn;
      void _c;
      ops.push({ kind: 'insert', table: 'feed_transactions', row: insertRow });
    }
    const ok = await save(ops, {
      label: existing ? 'Feed updated' : 'Feed added',
      patch: (x) => ({
        ...x,
        products: existing ? x.products.map((p) => (p.id === pid ? { ...p, ...row } as FeedProduct : p)) : [...x.products, { ...row, archived: false } as FeedProduct],
        txns: txn ? [...x.txns, txn] : x.txns
      })
    });
    if (ok) nav(existing ? `/feed/${pid}` : `/feed/${pid}/rule/new`, { replace: true });
  }

  return (
    <Screen title={existing ? 'Edit feed' : 'Add a feed'} back>
      <Card className="space-y-5">
        <TextInput label="Feed name" value={name} onChange={setName} placeholder="e.g. Dairy nut 16%" list="feed-names" autoFocus={!existing}
          hint="As it appears on your docket. Agri-It doesn't guess the nutrition from the name." />
        <datalist id="feed-names">{recentNames.map((n) => <option key={n} value={n} />)}</datalist>
        <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />
        <TextInput label="Bin or store (optional)" value={storage} onChange={setStorage} placeholder="e.g. Bin 1" />
        {!existing && (
          <>
            <QuantityInput label="How much is there now? (optional)" kg={stockKg} onKg={setStockKg} unit={unit} onUnit={setUnit} />
            {stockKg !== '' && (
              <Chips columns={2} value={evidence} onChange={setEvidence} options={[
                { value: 'measured', label: 'Measured', sub: 'Dipped, weighed or counted' },
                { value: 'farmer_estimate', label: 'Rough guess', sub: 'Lowers confidence' }
              ]} />
            )}
          </>
        )}
      </Card>
      <Card className="space-y-5">
        <Chips label="Safety stock" columns={2} value={mode} onChange={setMode}
          options={[{ value: 'days', label: 'Days of feed' }, { value: 'kg', label: 'Fixed amount' }]}
          hint="Agri-It warns you before stock falls to this, not when the bin is empty." />
        <Stepper label={mode === 'days' ? 'Keep at least' : 'Keep at least (kg)'} value={safety} step={mode === 'days' ? 1 : 250} onChange={setSafety} unit={mode === 'days' ? 'days' : 'kg'} />
        <label className="flex min-h-tap items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6 accent-field" checked={knowLead} onChange={(e) => setKnowLead(e.target.checked)} />
          I know how long delivery takes
        </label>
        {knowLead
          ? <Stepper label="Days from order to delivery" value={lead} onChange={setLead} unit="days" />
          : <p className="hint">Leave off if unsure. Agri-It will use your supplier or farm setting, and won't guess.</p>}
      </Card>
      <SaveBar><Button block disabled={!name.trim()} onClick={submit}>{existing ? 'Save changes' : 'Next: who eats it'}</Button></SaveBar>
    </Screen>
  );
}
