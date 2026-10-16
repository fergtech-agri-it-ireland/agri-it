import { useEffect, useState } from 'react';
import { jurisdictionInfo } from '../lib/jurisdiction';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFarmCtx } from '../lib/data/farm';
import { COUNTIES_NI, COUNTIES_ROI, type FarmType, type Jurisdiction } from '../lib/types';
import { Button, Chips, Field, SaveBar, TextInput } from '../components/ui';
import { FarmTypePicker } from '../components/FarmPickers';
import { Logo } from '../components/Logo';
import { IS_ONLINE } from '../lib/env';
import { ReleaseLine } from '../components/ReleaseLine';
import { fyHint } from '../lib/setup';

type Step = 'farm' | 'types';

/**
 * Sign-up: just the farm and what it does (16 Oct 2026). Everything else Agri-It needs is
 * gathered next, in "Set up your farm" (pages/Setup.tsx), in short stages built from these
 * answers, each saving as it goes. Nothing is required beyond a name and county.
 */
export default function Onboarding() {
  const { session, sessionLoading, selectFarm, refreshFarms, farms } = useFarmCtx();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('farm');
  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('ROI');
  const [county, setCounty] = useState('');
  const [eircode, setEircode] = useState('');
  const [types, setTypes] = useState<FarmType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  // Leave only once the new farm is in the farm list the app shell reads. Leaving straight
  // after the refetch raced the list update, and the shell sent new farmers back to step 1.
  useEffect(() => {
    if (created && farms.some((f) => f.id === created)) nav('/setup', { replace: true });
  }, [created, farms, nav]);

  const steps: Step[] = ['farm', 'types'];
  const at = steps.indexOf(step);
  const last = at === steps.length - 1;

  if (!sessionLoading && !session) return <Navigate to="/login" replace />;
  const counties = jurisdiction === 'ROI' ? COUNTIES_ROI : COUNTIES_NI;

  function next() {
    setStep(steps[at + 1]);
    window.scrollTo(0, 0);
  }

  async function finish() {
    setBusy(true); setError(null);
    const { data: farmId, error } = await supabase.rpc('create_farm', {
      p_name: name, p_county: county, p_eircode: eircode || null, p_jurisdiction: jurisdiction, p_enterprises: types
    });
    if (error || !farmId) { setBusy(false); setError(error?.message ?? 'Could not create farm'); return; }
    // The financial year most farms on this side of the border use, so the money screens work at once;
    // the farmer confirms or changes it in the last setup stage
    await supabase.from('farms').update({ financial_year_start_month: fyHint(jurisdiction).month }).eq('id', farmId as string);
    selectFarm(farmId as string);
    await refreshFarms();
    await qc.invalidateQueries();
    setCreated(farmId as string);
  }

  const titles: Record<Step, [string, string]> = {
    farm: ['Your farm', 'Used to find your nearest supplier branch. We never need GPS.'],
    types: ['What do you farm?', 'Pick everything you do. Dairy and sheep and tillage is fine. Next, Agri-It asks only about what you picked.']
  };

  return (
    <div className="pad-bottom mx-auto min-h-[100dvh] max-w-xl bg-card px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        {at > 0 ? (
          <button aria-label="Back" onClick={() => setStep(steps[at - 1])} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-pasture"><ChevronLeft className="h-6 w-6" /></button>
        ) : <Logo className="h-8 w-8" />}
        <div className="flex flex-1 gap-1.5" aria-label={`Step ${at + 1} of ${steps.length}`}>
          {steps.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= at ? 'bg-field' : 'bg-track'}`} />)}
        </div>
      </div>
      <p className="mt-4 text-[0.8125rem] font-semibold text-muted">Step {at + 1} of {steps.length}</p>
      <h1 className="h-display text-[1.75rem]">{titles[step][0]}</h1>
      <p className="mt-1 text-[0.9375rem] text-muted">{titles[step][1]}</p>

      <div className="mt-5 space-y-5">
        {step === 'farm' && (
          <>
            <TextInput label="Farm name" value={name} onChange={setName} placeholder="e.g. Glenview Farm" autoFocus />
            <Chips label="Where is the farm?" columns={2} value={jurisdiction} onChange={(v) => { setJurisdiction(v); setCounty(''); }}
              options={[{ value: 'ROI', label: 'Republic of Ireland' }, { value: 'NI', label: 'Northern Ireland' }]}
              hint={`Money in ${jurisdictionInfo(jurisdiction).currencyName}. Deadlines and contacts for ${jurisdictionInfo(jurisdiction).name}${jurisdiction === 'NI' ? ' (DAERA)' : ''}.`} />
            <Field label="County" htmlFor="county">
              <select id="county" className="input" value={county} onChange={(e) => setCounty(e.target.value)}>
                <option value="">Choose county</option>
                {counties.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <TextInput label={jurisdiction === 'ROI' ? 'Eircode (optional)' : 'Postcode (optional)'} value={eircode} onChange={(v) => setEircode(v.toUpperCase())} />
            {IS_ONLINE && (
              <Link to="/move-phone-data" className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-card p-4 font-bold shadow-sm">
                <Smartphone className="h-7 w-7 shrink-0 text-accent" aria-hidden />
                <span>Used the Agri-It phone app already?<span className="block text-sm font-normal text-muted">Move those records into your account instead of starting again</span></span>
              </Link>
            )}
          </>
        )}

        {step === 'types' && <FarmTypePicker value={types} onChange={setTypes} />}

        {error && <p role="alert" className="rounded-xl bg-danger-bg p-3 font-bold text-danger">{error}</p>}
      </div>

      <ReleaseLine className="pb-28" />

      <SaveBar>
        {!last ? (
          <Button block disabled={!name.trim() || !county} onClick={next}>Next</Button>
        ) : (
          <Button block disabled={busy} onClick={finish}>{busy ? 'Setting up' : types.length ? 'Next: set up your farm' : 'Skip for now'}</Button>
        )}
      </SaveBar>
    </div>
  );
}

