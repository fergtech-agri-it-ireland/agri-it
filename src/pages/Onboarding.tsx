import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useFarmCtx } from '../lib/data/farm';
import { ANIMAL_CLASS_LABEL, COUNTIES_NI, COUNTIES_ROI, type AnimalClass, type Enterprise, type Jurisdiction } from '../lib/types';
import { Button, Card, Chips, Field, SaveBar, Stepper, TextInput } from '../components/ui';

const PRESETS: Record<Enterprise, AnimalClass[]> = {
  dairy: ['dairy_cow', 'in_calf_heifer', 'calf'],
  suckler: ['suckler_cow', 'weanling', 'calf'],
  beef: ['store_cattle', 'finishing_cattle', 'weanling'],
  mixed: ['dairy_cow', 'suckler_cow', 'weanling'],
  sheep: ['ewe', 'lamb'],
  tillage: [],
  other: ['other']
};

/** Three short steps. Everything else can be added later from the Farm tab. */
export default function Onboarding() {
  const { session, sessionLoading, selectFarm, refreshFarms } = useFarmCtx();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('ROI');
  const [county, setCounty] = useState('');
  const [eircode, setEircode] = useState('');
  const [enterprise, setEnterprise] = useState<Enterprise>('dairy');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!sessionLoading && !session) return <Navigate to="/login" replace />;
  const counties = jurisdiction === 'ROI' ? COUNTIES_ROI : COUNTIES_NI;

  async function finish() {
    setBusy(true); setError(null);
    const { data: farmId, error } = await supabase.rpc('create_farm', {
      p_name: name, p_county: county, p_eircode: eircode || null, p_jurisdiction: jurisdiction, p_enterprise: enterprise
    });
    if (error || !farmId) { setBusy(false); setError(error?.message ?? 'Could not create farm'); return; }
    const groups = PRESETS[enterprise].filter((c) => (counts[c] ?? 0) > 0).map((c, i) => ({
      farm_id: farmId, name: ANIMAL_CLASS_LABEL[c], animal_class: c, head_count: counts[c], sort_order: i
    }));
    if (groups.length) await supabase.from('animal_groups').insert(groups);
    selectFarm(farmId as string);
    await refreshFarms();
    await qc.invalidateQueries();
    nav('/', { replace: true });
  }

  return (
    <div className="pad-bottom mx-auto max-w-xl px-3 pt-6">
      <p className="px-1 text-muted">Step {step} of 3</p>
      <h1 className="h-display px-1 text-4xl">{step === 1 ? 'Your farm' : step === 2 ? 'What do you farm?' : 'Your stock'}</h1>
      <Card className="mt-4 space-y-5">
        {step === 1 && (
          <>
            <TextInput label="Farm name" value={name} onChange={setName} placeholder="e.g. Glenview Farm" autoFocus />
            <Chips label="Where is the farm?" columns={2} value={jurisdiction} onChange={(v) => { setJurisdiction(v); setCounty(''); }}
              options={[{ value: 'ROI', label: 'Republic of Ireland' }, { value: 'NI', label: 'Northern Ireland' }]} />
            <Field label="County" htmlFor="county" hint="Used to find your nearest supplier branch. We never need GPS.">
              <select id="county" className="input" value={county} onChange={(e) => setCounty(e.target.value)}>
                <option value="">Choose county</option>
                {counties.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <TextInput label={jurisdiction === 'ROI' ? 'Eircode (optional)' : 'Postcode (optional)'} value={eircode} onChange={(v) => setEircode(v.toUpperCase())} />
          </>
        )}
        {step === 2 && (
          <Chips columns={2} value={enterprise} onChange={setEnterprise} options={[
            { value: 'dairy', label: 'Dairy' }, { value: 'suckler', label: 'Suckler' }, { value: 'beef', label: 'Beef / drystock' },
            { value: 'mixed', label: 'Mixed' }, { value: 'sheep', label: 'Sheep' }, { value: 'tillage', label: 'Tillage' }
          ]} />
        )}
        {step === 3 && (
          <>
            <p className="text-muted">Rough numbers are fine. You can add or change groups any time, and sales update them for you.</p>
            {PRESETS[enterprise].length === 0 && <p>No animal groups needed. You can add some later.</p>}
            {PRESETS[enterprise].map((c) => (
              <Stepper key={c} label={ANIMAL_CLASS_LABEL[c]} value={counts[c] ?? 0} step={5} onChange={(n) => setCounts({ ...counts, [c]: n })} unit="head" />
            ))}
          </>
        )}
        {error && <p role="alert" className="rounded-xl bg-danger-bg p-3 font-bold text-danger">{error}</p>}
      </Card>
      <SaveBar>
        {step > 1 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3
          ? <Button block disabled={step === 1 && (!name.trim() || !county)} onClick={() => setStep(step + 1)}>Next</Button>
          : <Button block disabled={busy} onClick={finish}>{busy ? 'Setting up' : 'Start using Agri-It'}</Button>}
      </SaveBar>
    </div>
  );
}
