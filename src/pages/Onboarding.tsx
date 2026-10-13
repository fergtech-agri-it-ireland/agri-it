import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Minus, Plus, Smartphone, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFarmCtx } from '../lib/data/farm';
import { COMMON_CROPS, currentHarvest, grows, keepsAnimals, speciesOf, suggestedClasses } from '../lib/farmTypes';
import { ANIMAL_CLASS_LABEL, COUNTIES_NI, COUNTIES_ROI, type AnimalClass, type FarmType, type Jurisdiction } from '../lib/types';
import { Button, Chips, Field, NumberInput, SaveBar, TextInput } from '../components/ui';
import { fmtDay, todayISO, uuid } from '../lib/format';
import { BreedField, ClassPicker, FarmTypePicker } from '../components/FarmPickers';
import { Logo } from '../components/Logo';
import { IS_ONLINE } from '../lib/env';

type Step = 'farm' | 'types' | 'animals' | 'winter' | 'crops' | 'money';
interface AnimalRow { key: string; cls: AnimalClass; count: number; breed: string }

/**
 * Sign-up. Any mix of farming, any animals, any breed. Nothing is required beyond a
 * name and county: farm types and animals can be skipped and added later.
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
  const [animals, setAnimals] = useState<AnimalRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [crops, setCrops] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [cash, setCash] = useState('');
  const [fyMonth, setFyMonth] = useState(1);
  const [lead, setLead] = useState('');
  // Key dates (all optional): housing, turnout, who is in or out now, first calf due
  const [housing, setHousing] = useState('');
  const [turnout, setTurnout] = useState('');
  const [where, setWhere] = useState<Record<string, 'in' | 'out'>>({});
  const [inOn, setInOn] = useState<Record<string, string>>({});
  const [firstCalf, setFirstCalf] = useState('');

  // Leave only once the new farm is in the farm list the app shell reads. Leaving straight
  // after the refetch raced the list update, and the shell sent new farmers back to step 1.
  useEffect(() => {
    if (created && farms.some((f) => f.id === created)) nav('/', { replace: true });
  }, [created, farms, nav]);

  // Steps follow what they farm: animals for livestock (or when unsure), crops for tillage
  const steps = useMemo<Step[]>(() => {
    const s: Step[] = ['farm', 'types'];
    if (keepsAnimals(types) || types.length === 0) s.push('animals');
    if (animals.some((a) => a.count > 0 && eatsSilage(a.cls))) s.push('winter');
    if (grows(types)) s.push('crops');
    s.push('money');
    return s;
  }, [types, animals]);
  const at = steps.indexOf(step);
  const last = at === steps.length - 1;

  if (!sessionLoading && !session) return <Navigate to="/login" replace />;
  const counties = jurisdiction === 'ROI' ? COUNTIES_ROI : COUNTIES_NI;

  function toAnimals() {
    // Offer the usual groups for what they picked, keeping anything already filled in
    const keep = animals.filter((a) => a.count > 0 || a.breed);
    const offered = suggestedClasses(types).filter((c) => !keep.some((a) => a.cls === c)).map((c) => ({ key: c, cls: c, count: 0, breed: '' }));
    setAnimals([...keep, ...offered]);
  }
  const winterGroups = animals.filter((a) => a.count > 0 && eatsSilage(a.cls));
  const today = todayISO();
  function toWinter() {
    // A first guess the farmer changes: in from November to March, out at grass the rest of the year
    const m = Number(today.slice(5, 7));
    const guess: 'in' | 'out' = m >= 11 || m <= 3 ? 'in' : 'out';
    setWhere(Object.fromEntries(winterGroups.map((a) => [a.key, where[a.key] ?? guess])));
  }
  function next() {
    const n = steps[at + 1];
    if (n === 'animals') toAnimals();
    if (n === 'winter') toWinter();
    setStep(n);
    window.scrollTo(0, 0);
  }
  const setRow = (key: string, patch: Partial<AnimalRow>) => setAnimals(animals.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  async function finish() {
    setBusy(true); setError(null);
    const { data: farmId, error } = await supabase.rpc('create_farm', {
      p_name: name, p_county: county, p_eircode: eircode || null, p_jurisdiction: jurisdiction, p_enterprises: types
    });
    if (error || !farmId) { setBusy(false); setError(error?.message ?? 'Could not create farm'); return; }
    // Opening balances: the bank balance today starts the cash forecast; a lead time is only ever what the farmer says
    const farmPatch: Record<string, unknown> = { financial_year_start_month: fyMonth };
    if (cash !== '') { farmPatch.opening_cash_eur = Number(cash); farmPatch.opening_cash_date = todayISO(); }
    if (lead !== '') farmPatch.default_lead_time_days = Math.max(0, Math.min(60, Math.round(Number(lead))));
    if (housing) farmPatch.housing_start = housing;
    if (turnout) farmPatch.turnout_date = turnout;
    await supabase.from('farms').update(farmPatch).eq('id', farmId as string);
    const groups = animals.filter((a) => a.count > 0).map((a, i) => {
      const w = where[a.key];
      return {
        id: uuid(), farm_id: farmId, name: ANIMAL_CLASS_LABEL[a.cls], animal_class: a.cls, breed: a.breed.trim() || null, head_count: a.count, sort_order: i,
        // Pigs, poultry and horses are not part of the silage budget
        housed: eatsSilage(a.cls),
        // In now: from the housing date if it has passed, else today. Out at grass: the day they come in, if known
        at_grass: eatsSilage(a.cls) && w === 'out',
        housed_from: !eatsSilage(a.cls) || !w ? null : w === 'in' ? (housing && housing <= today ? housing : today) : (inOn[a.key] || null),
        _cls: a.cls
      };
    });
    if (groups.length) await supabase.from('animal_groups').insert(groups.map(({ _cls, ...g }) => g));
    if (firstCalf) {
      const herd = types.includes('dairy') ? 'dairy' : 'suckler';
      const cows = groups.find((g) => g._cls === (herd === 'dairy' ? 'dairy_cow' : 'suckler_cow'));
      const calves = groups.find((g) => g._cls === 'calf');
      const m = Number(firstCalf.slice(5, 7));
      await supabase.from('calving_seasons').insert({
        id: uuid(), farm_id: farmId, label: `${m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Autumn'} calving ${firstCalf.slice(0, 4)}`, herd, calving_start: firstCalf,
        calving_end: null, cows_due: cows?.head_count ?? null, thin_count: null, dry_weeks: 8, dry_weeks_thin: 10,
        milking_group_id: herd === 'dairy' ? cows?.id ?? null : null, dry_group_id: null, calf_group_id: calves?.id ?? null, archived: false
      });
    }
    const harvest = currentHarvest();
    const cropRows = Object.entries(crops).filter(([, ac]) => ac > 0).map(([c, ac]) => ({ farm_id: farmId, name: c, acres: ac, harvest_year: harvest }));
    if (grows(types) && cropRows.length) await supabase.from('crops').insert(cropRows);
    selectFarm(farmId as string);
    await refreshFarms();
    await qc.invalidateQueries();
    setCreated(farmId as string);
  }

  const titles: Record<Step, [string, string]> = {
    farm: ['Your farm', 'Used to find your nearest supplier branch. We never need GPS.'],
    types: ['What do you farm?', 'Pick everything you do. Dairy and sheep and tillage is fine. Not sure? Skip it for now.'],
    animals: ['Your animals', 'Rough numbers are fine. Add any kind of animal and its breed. You can change all of this later.'],
    winter: ['Key dates', 'These make the winter silage plan accurate. Your best guess is fine, and every one can be skipped.'],
    crops: ['Your crops', `Acres for harvest ${currentHarvest()}. Skip any you don't grow.`],
    money: ['Money and feed', 'Two numbers that make the forecasts work from day one. Both can be left blank and added later.']
  };
  const used = animals.map((a) => a.cls);

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
              options={[{ value: 'ROI', label: 'Republic of Ireland' }, { value: 'NI', label: 'Northern Ireland' }]} />
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

        {step === 'animals' && (
          <>
            {animals.length === 0 && <p className="rounded-2xl bg-pasture p-4 text-[0.9375rem]">Add a group for each kind of animal you keep.</p>}
            <ul className="space-y-3">
              {animals.map((a) => (
                <li key={a.key} className="rounded-2xl border border-line px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <button aria-label={`Remove ${ANIMAL_CLASS_LABEL[a.cls]}`} onClick={() => setAnimals(animals.filter((x) => x.key !== a.key))}
                      className="-ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-pasture"><X className="h-4 w-4" aria-hidden /></button>
                    <p className="min-w-0 flex-1 font-semibold">{ANIMAL_CLASS_LABEL[a.cls]}</p>
                    <MiniStepper label={`How many ${ANIMAL_CLASS_LABEL[a.cls].toLowerCase()}`} value={a.count} step={speciesOf(a.cls) === 'sheep' || speciesOf(a.cls) === 'poultry' ? 10 : 5} onChange={(n) => setRow(a.key, { count: n })} />
                  </div>
                  {a.count > 0 && <div className="mt-2 pb-1"><BreedField cls={a.cls} value={a.breed} onChange={(v) => setRow(a.key, { breed: v })} /></div>}
                </li>
              ))}
            </ul>
            {adding ? (
              <div className="rounded-2xl bg-pasture p-3.5">
                <div className="mb-2 flex items-center justify-between"><p className="font-bold">Add another kind</p>
                  <button aria-label="Close" onClick={() => setAdding(false)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-card"><X className="h-4 w-4" aria-hidden /></button></div>
                <ClassPicker value={null} exclude={used} onChange={(c) => { setAnimals([...animals, { key: `${c}-${Date.now()}`, cls: c, count: 0, breed: '' }]); setAdding(false); }} />
              </div>
            ) : (
              <Button variant="secondary" block onClick={() => setAdding(true)}><Plus className="h-5 w-5" aria-hidden />Add another kind of animal</Button>
            )}
          </>
        )}

        {step === 'winter' && (
          <div className="space-y-5">
            <Field label="When do animals come in for the winter?" htmlFor="housing" hint="Your usual housing date, or the day they came in this year.">
              <input id="housing" type="date" className="input" value={housing} onChange={(e) => setHousing(e.target.value)} />
            </Field>
            <Field label="When do you expect to let them out in spring?" htmlFor="turnout" hint="Turnout. The silage has to last until then.">
              <input id="turnout" type="date" className="input" value={turnout} min={housing || undefined} onChange={(e) => setTurnout(e.target.value)} />
            </Field>
            <fieldset className="space-y-3">
              <legend className="label">Where are they today?</legend>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setWhere(Object.fromEntries(winterGroups.map((a) => [a.key, 'in'])))}>All in</Button>
                <Button variant="secondary" onClick={() => setWhere(Object.fromEntries(winterGroups.map((a) => [a.key, 'out'])))}>All out at grass</Button>
              </div>
              {winterGroups.map((a) => (
                <div key={a.key} className="space-y-2 rounded-2xl border border-line px-3.5 py-3">
                  <Chips label={`${ANIMAL_CLASS_LABEL[a.cls]} (${a.count})`} columns={2} value={where[a.key] ?? null}
                    onChange={(v) => setWhere({ ...where, [a.key]: v })}
                    options={[{ value: 'in', label: 'In now' }, { value: 'out', label: 'Out at grass' }]} />
                  {where[a.key] === 'out' && (
                    <Field label="Coming in about (optional)" htmlFor={`in-${a.key}`} hint={inOn[a.key] ? 'Counted from that day.' : housing && housing > today ? `Blank = with the rest, ${fmtDay(housing)}.` : 'Blank = counted from today, so the plan errs short.'}>
                      <input id={`in-${a.key}`} type="date" className="input" min={today} value={inOn[a.key] ?? ''} onChange={(e) => setInOn({ ...inOn, [a.key]: e.target.value })} />
                    </Field>
                  )}
                </div>
              ))}
              <p className="hint">Animals out at grass aren't eating silage yet, so they're counted from the day they come in.</p>
            </fieldset>
            {(types.includes('dairy') || types.includes('suckler')) && (
              <Field label="When is the first calf due? (optional)" htmlFor="calf" hint={`Agri-It lays out drying off, minerals, tags and the calving checklist from it. Only know when the bull went in? Add about 283 days (9 months and 10 days).`}>
                <input id="calf" type="date" className="input" min={today} value={firstCalf} onChange={(e) => setFirstCalf(e.target.value)} />
              </Field>
            )}
          </div>
        )}

        {step === 'crops' && (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {COMMON_CROPS.map((c) => (
              <li key={c} className="flex items-center gap-2 px-3.5 py-2.5"><p className="min-w-0 flex-1 font-semibold">{c}</p><MiniStepper label={`${c} acres`} value={crops[c] ?? 0} step={5} unit="ac" onChange={(n) => setCrops({ ...crops, [c]: n })} /></li>
            ))}
          </ul>
        )}
        {step === 'money' && (
          <div className="space-y-5">
            <NumberInput label="Money in the bank today (optional)" value={cash} onChange={setCash} unit="€"
              hint="Starts your cash position. Agri-It adds income and takes off bills as you pay them. It is never shared." />
            <Field label="Your financial year starts" htmlFor="fy">
              <select id="fy" className="input" value={fyMonth} onChange={(e) => setFyMonth(Number(e.target.value))}>
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
            <NumberInput label="Days from ordering feed to delivery (optional)" value={lead} onChange={setLead} unit="days" integer
              hint="From your own experience. Agri-It never guesses this: without it there is no order-by date." />
          </div>
        )}
        {error && <p role="alert" className="rounded-xl bg-danger-bg p-3 font-bold text-danger">{error}</p>}
      </div>

      <SaveBar>
        {(step === 'types' && types.length === 0) || (step === 'winter' && !housing && !turnout && !firstCalf) ? (
          <Button block variant="secondary" onClick={next}>Skip for now</Button>
        ) : !last ? (
          <Button block disabled={step === 'farm' && (!name.trim() || !county)} onClick={next}>Next</Button>
        ) : (
          <Button block disabled={busy} onClick={finish}>{busy ? 'Setting up' : 'Start using Agri-It'}</Button>
        )}
      </SaveBar>
    </div>
  );
}

/** Pigs, poultry and horses are not part of the silage budget. */
function eatsSilage(cls: AnimalClass) {
  return !['pigs', 'poultry', 'horses'].includes(speciesOf(cls));
}

/** A compact −/+ with the number typed in between, for long lists of counts. */
function MiniStepper({ label, value, onChange, step, unit }: { label: string; value: number; onChange: (n: number) => void; step: number; unit?: string }) {
  const set = (n: number) => onChange(Math.max(0, Math.round(n)));
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => set(value - step)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line"><Minus className="h-4 w-4" aria-hidden /></button>
      <label className="relative">
        <span className="sr-only">{label}</span>
        <input type="number" inputMode="numeric" value={value} onChange={(e) => set(Number(e.target.value || 0))}
          className={`h-10 w-[4.25rem] rounded-xl border border-line bg-card text-center font-bold ${unit ? 'pr-5' : ''}`} />
        {unit && <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[0.6875rem] font-bold text-muted">{unit}</span>}
      </label>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + step)} className="flex h-10 w-10 items-center justify-center rounded-full bg-field text-white"><Plus className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}
