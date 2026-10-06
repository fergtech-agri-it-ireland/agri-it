import { useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { supplierOptions } from '../components/pickers';
import { uuid } from '../lib/format';
import type { Supplier } from '../lib/types';
import { Button, List, Row, Screen, Sheet, TextInput } from '../components/ui';

export default function Suppliers() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const list = supplierOptions(b);
  const mine = new Set(b.supplierSettings.filter((s) => s.rep_phone || s.last_used_at).map((s) => s.supplier_id));

  async function add() {
    const row = { id: uuid(), farm_id: farmId!, name, central_phone: phone || null, central_phone_label: phone ? 'Phone' : null, coverage: [b.farm.jurisdiction] };
    await save([{ kind: 'insert', table: 'suppliers', row }], {
      label: 'Supplier added',
      patch: (x) => ({ ...x, suppliers: [...x.suppliers, { ...row, network: null, secondary_phone: null, secondary_phone_label: null, website: null, local_contact_method: null, source_url: null, verified_on: null, needs_live_directory: false } as Supplier] })
    });
    setOpen(false); setName(''); setPhone('');
  }

  return (
    <Screen title="Suppliers" back="/farm" right={<Button variant="hivis" onClick={() => setOpen(true)}>Add</Button>}>
      <p className="px-1 text-muted">Numbers in the directory show when they were last verified. Set your own rep and it's always first.</p>
      <List>
        {list.map((s) => (
          <Row key={s.id} to={`/suppliers/${s.id}`} title={s.name}
            sub={s.farm_id ? 'Added by you' : s.verified_on ? <span className="inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4" aria-hidden />Directory, {s.coverage.join(' and ')}</span> : 'Needs a verified number'}
            right={<span className="flex items-center gap-2">{mine.has(s.id) && <span className="rounded bg-field-light px-2 text-sm font-bold text-accent">Yours</span>}<ChevronRight className="h-5 w-5 text-muted" /></span>} />
        ))}
      </List>
      <Sheet open={open} onClose={() => setOpen(false)} title="Local supplier">
        <div className="space-y-4">
          <TextInput label="Name" value={name} onChange={setName} placeholder="e.g. local merchant" />
          <div><label className="label" htmlFor="sp">Phone</label><input id="sp" className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <Button block disabled={!name.trim()} onClick={add}>Add supplier</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
