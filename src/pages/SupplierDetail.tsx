import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { resolveContacts } from '../lib/suppliers';
import { eur, fmtDate } from '../lib/format';
import { Button, CallButton, Card, Empty, Screen, SectionTitle, Stepper, TextInput } from '../components/ui';

export default function SupplierDetail() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const supplier = b.suppliers.find((s) => s.id === id);
  const setting = b.supplierSettings.find((s) => s.supplier_id === id);
  const [repName, setRepName] = useState(setting?.rep_name ?? '');
  const [repPhone, setRepPhone] = useState(setting?.rep_phone ?? '');
  const [account, setAccount] = useState(setting?.account_number ?? '');
  const [knowLead, setKnowLead] = useState(setting?.lead_time_days !== null && setting?.lead_time_days !== undefined);
  const [lead, setLead] = useState<number>(setting?.lead_time_days ?? 3);
  if (!supplier) return <Screen title="Supplier" back="/suppliers"><Empty title="Not found" /></Screen>;
  const c = resolveContacts(supplier, b.branches, setting, b.farm);
  const spend = b.costs.filter((x) => x.supplier_id === supplier.id || x.supplier_name === supplier.name).reduce((s, x) => s + Number(x.amount_eur), 0);

  async function submit() {
    const row = { farm_id: farmId!, supplier_id: supplier!.id, rep_name: repName || null, rep_phone: repPhone || null, account_number: account || null, lead_time_days: knowLead ? lead : null };
    await save([{ kind: 'upsert', table: 'farm_supplier_settings', row, onConflict: 'farm_id,supplier_id' }], {
      label: 'Saved. Forecasts updated',
      patch: (x) => ({ ...x, supplierSettings: [...x.supplierSettings.filter((s) => s.supplier_id !== supplier!.id), { ...row, last_used_at: setting?.last_used_at ?? null }] })
    });
  }

  return (
    <Screen title={supplier.name} back="/suppliers" sub={supplier.network ?? undefined}>
      <Card className="space-y-3">
        {c.routes.length === 0 && <p className="font-bold">No verified number yet.</p>}
        {c.routes.map((r) => (
          <div key={r.kind + r.phone}>
            <p className="mb-1 font-bold">{r.title}</p>
              <CallButton phone={r.phone} label={r.phone} variant={r.kind === 'my_rep' ? 'hivis' : 'secondary'} block />
            <p className="mt-1 text-sm text-muted">{r.kind === 'my_rep' ? 'Set by you' : r.verifiedOn ? `Verified ${fmtDate(r.verifiedOn)}` : 'Not verified'}</p>
          </div>
        ))}
        {c.note && <p className="text-muted">{c.note}</p>}
        {supplier.source_url && <a href={supplier.source_url} target="_blank" rel="noreferrer" className="inline-flex min-h-tap items-center gap-1 font-bold text-accent underline">Check the supplier's own contact page <ExternalLink className="h-4 w-4" /></a>}
        {spend > 0 && <p className="text-sm">You've spent {eur(spend)} with them in the last two years.</p>}
      </Card>
      <SectionTitle>My rep</SectionTitle>
      <Card className="space-y-4">
        <p className="hint">Territories don't always follow the nearest branch. Your own contact always shows first.</p>
        <TextInput label="Name" value={repName} onChange={setRepName} />
        <div><label className="label" htmlFor="rp">Phone</label><input id="rp" className="input" type="tel" inputMode="tel" value={repPhone} onChange={(e) => setRepPhone(e.target.value)} /></div>
        <TextInput label="Account number (optional)" value={account} onChange={setAccount} />
        <label className="flex min-h-tap items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6 accent-field" checked={knowLead} onChange={(e) => setKnowLead(e.target.checked)} />
          I know their usual delivery time
        </label>
        {knowLead && <Stepper label="Days from order to delivery" value={lead} onChange={setLead} unit="days" />}
        <Button block onClick={submit}>Save</Button>
      </Card>
    </Screen>
  );
}
