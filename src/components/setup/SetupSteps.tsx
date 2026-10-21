/**
 * The steps of "Set up your farm" (lib/setup.ts). Each step asks a few plain questions, saves
 * straight away, and moves on. Every step can be skipped; nothing is recorded unless saved.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, Plus, X } from 'lucide-react';
import type { AnimalClass, AnimalGroup, CalvingSeason, Crop, ExpectedIncome, FarmBundle, FeedProduct, FeedTransaction, FeedingRule, Loan, Routine, SilageStore } from '../../lib/types';
import { ANIMAL_CLASS_LABEL, COST_LABEL, type CostCategory } from '../../lib/types';
import { addDays, cur, eur, fmtDay, todayISO, uuid } from '../../lib/format';
import { countFromText, countShown } from '../../lib/typedCount';
import { breedLabel, breedPatch, COMMON_CROPS, currentHarvest, farmTypes, groupBreeds, speciesOf, suggestedClasses } from '../../lib/farmTypes';
import { useFarmCtx, useSave } from '../../lib/data/farm';
import type { Op } from '../../lib/offline/outbox';
import { BILL_IDEAS, calvingHint, EVERY_LABEL, fyHint, jobIdeasFor, monthChips, withMark, type JobIdea } from '../../lib/setup';
import { balanceOn, KIND_LABEL, loanLine } from '../../lib/loans';
import { Button, Chips, Field, NumberInput, SaveBar, TextInput } from '../ui';
import { BreedField, ClassPicker } from '../FarmPickers';
import { QuantityInput, SupplierPicker } from '../pickers';
import { ProductPick } from '../ProductPick';
import { LoanEditor } from '../LoanEditor';
import { SchemePlanner } from '../SchemePlanner';

export interface StepProps { b: FarmBundle; next: () => void }

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Save and next, or skip. Pinned to the bottom, in thumb reach. */
export function StepActions({ onSave, saveLabel = 'Save and next', canSave = true, busy, next, skipLabel = 'Skip this' }: {
  onSave?: () => void; saveLabel?: string; canSave?: boolean; busy?: boolean; next: () => void; skipLabel?: string;
}) {
  return (
    <SaveBar>
      <Button variant="secondary" onClick={next}>{skipLabel}</Button>
      {onSave && <Button block disabled={!canSave || busy} onClick={onSave}>{busy ? 'Saving' : saveLabel}</Button>}
    </SaveBar>
  );
}

/** A compact −/+ with the number typed in between, for long lists of counts. */
export function MiniStepper({ label, value, onChange, step, unit }: { label: string; value: number; onChange: (n: number) => void; step: number; unit?: string }) {
  // What is typed stays exactly as typed until the farmer leaves the box, so a 0 can be deleted
  const [typed, setTyped] = useState<string | null>(null);
  const set = (n: number) => onChange(Math.max(0, Math.round(n)));
  const tap = (n: number) => { setTyped(null); set(n); };
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => tap(value - step)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line"><Minus className="h-4 w-4" aria-hidden /></button>
      <label className="relative">
        <span className="sr-only">{label}</span>
        <input type="number" inputMode="numeric" value={countShown(value, typed)} onFocus={(e) => e.currentTarget.select()} onBlur={() => setTyped(null)}
          onChange={(e) => { setTyped(e.target.value); const n = countFromText(e.target.value); if (n !== null) set(n); }}
          className={`h-10 w-[4.25rem] rounded-xl border border-line bg-card text-center font-bold ${unit ? 'pr-5' : ''}`} />
        {unit && <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[0.6875rem] font-bold text-muted">{unit}</span>}
      </label>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => tap(value + step)} className="flex h-10 w-10 items-center justify-center rounded-full bg-field text-white"><Plus className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}

/** A box with a tick, for picking from a list. */
function Tick({ on, onClick, title, sub, children }: { on: boolean; onClick: () => void; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <li className={`rounded-2xl border px-3.5 py-2.5 ${on ? 'border-field' : 'border-line'}`}>
      <button type="button" aria-pressed={on} onClick={onClick} className="flex min-h-[2.75rem] w-full items-center gap-3 text-left">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${on ? 'border-field bg-field text-white' : 'border-line'}`}>{on && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}</span>
        <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span>{sub && <span className="block text-sm text-muted">{sub}</span>}</span>
      </button>
      {on && children && <div className="mt-2 space-y-3 pb-1">{children}</div>}
    </li>
  );
}

/** Already there: say what, and where to change it, instead of asking again. */
function AlreadyHave({ children, to, label }: { children: ReactNode; to: string; label: string }) {
  return (
    <div className="rounded-2xl bg-field-light p-4">
      <div className="text-[0.9375rem]">{children}</div>
      <Link to={to} className="mt-2 inline-block font-bold text-accent underline">{label}</Link>
    </div>
  );
}

const farmPatch = (patch: Record<string, unknown>): Op => ({ kind: 'update', table: 'farms', match: { id: '__farm__' }, patch });
function useFarmSave() {
  const save = useSave();
  const { farmId } = useFarmCtx();
  return {
    farmId: farmId!,
    run: (ops: Op[], label: string, patch?: (x: FarmBundle) => FarmBundle) =>
      save(ops.map((o) => (o.kind === 'update' && o.table === 'farms' ? { ...o, match: { id: farmId } } : o)), { label, patch, quiet: false })
  };
}

// ---------------------------------------------------------------------------
// Your farm
// ---------------------------------------------------------------------------
export function LandStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const [owned, setOwned] = useState(b.farm.acres_owned != null ? String(b.farm.acres_owned) : '');
  const [rented, setRented] = useState(b.farm.acres_rented != null ? String(b.farm.acres_rented) : '');
  const [rent, setRent] = useState('');
  const [rentMonth, setRentMonth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const hasRent = b.routines.some((r) => r.category === 'land_rent');
  async function save() {
    setBusy(true);
    const patch = { acres_owned: owned === '' ? null : Number(owned), acres_rented: rented === '' ? null : Number(rented) };
    const ops: Op[] = [farmPatch(patch)];
    let routine: Routine | null = null;
    if (!hasRent && Number(rented) > 0 && Number(rent) > 0 && rentMonth) {
      const today = todayISO();
      const y = Number(today.slice(0, 4));
      let start = `${y}-${String(rentMonth).padStart(2, '0')}-01`;
      if (start < today) start = `${y + 1}${start.slice(4)}`;
      routine = { id: uuid(), farm_id: farmId, kind: 'expense', title: 'Land rent', frequency: 'monthly', interval_days: null, weekday: null, day_of_month: 1, interval_months: 12,
        start_date: start, end_date: null, amount: Number(rent), category: 'land_rent', counterparty: null, feed_product_id: null, silage_store_id: null, supplier_id: null, active: true, created_at: new Date().toISOString() };
      const { created_at: _c, ...row } = routine; void _c;
      ops.push({ kind: 'insert', table: 'routines', row });
    }
    const ok = await run(ops, 'Land saved', (x) => ({ ...x, farm: { ...x.farm, ...patch }, routines: routine ? [...x.routines, routine] : x.routines }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-5">
      <NumberInput label="Acres you own and farm" unit="ac" value={owned} onChange={setOwned} hint="Roughly is fine. Hectares × 2.47 = acres." />
      <NumberInput label="Acres you rent in (conacre or lease)" unit="ac" value={rented} onChange={setRented} />
      {Number(rented) > 0 && !hasRent && (
        <div className="space-y-4 rounded-2xl bg-pasture p-4">
          <NumberInput label="Rent for the year (optional)" unit={cur()} value={rent} onChange={setRent} hint="All the land you rent, added up." />
          {Number(rent) > 0 && (
            <Field label="Which month is it paid?" htmlFor="rent-month" hint="It goes in your year plan as a bill you tick off when paid.">
              <select id="rent-month" className="input" value={rentMonth ?? ''} onChange={(e) => setRentMonth(Number(e.target.value) || null)}>
                <option value="">Choose month</option>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Field>
          )}
        </div>
      )}
      <StepActions next={next} busy={busy} canSave={owned !== '' || rented !== ''} onSave={save} />
    </div>
  );
}

export function HerdStep({ b, next }: StepProps) {
  const { run } = useFarmSave();
  const ni = b.farm.jurisdiction === 'NI';
  const [herd, setHerd] = useState(b.farm.herd_number ?? '');
  const [vat, setVat] = useState<'flat_rate' | 'registered' | 'unsure' | null>(b.farm.vat_status ?? null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const patch = { herd_number: herd.trim() ? herd.trim().toUpperCase() : null, vat_status: vat === 'unsure' ? null : vat };
    const ok = await run([farmPatch(patch)], 'Saved', (x) => ({ ...x, farm: { ...x.farm, ...patch } }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-5">
      <TextInput label={ni ? 'Herd number (optional)' : 'Herd number (optional)'} value={herd} onChange={setHerd}
        hint={ni ? 'As on your DAERA herd register.' : 'As on AgFood.ie. Your accountant matches scheme payments to it.'} />
      <Chips label="VAT" value={vat} onChange={setVat} columns={2}
        options={ni
          ? [{ value: 'registered', label: 'VAT registered' }, { value: 'flat_rate', label: 'Not registered' }, { value: 'unsure', label: 'Not sure' }]
          : [{ value: 'flat_rate', label: 'Flat-rate farmer', sub: 'Not registered for VAT' }, { value: 'registered', label: 'VAT registered' }, { value: 'unsure', label: 'Not sure' }]} />
      <StepActions next={next} busy={busy} canSave={!!herd.trim() || !!vat} onSave={save} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your animals
// ---------------------------------------------------------------------------
interface AnimalRow { key: string; cls: AnimalClass; count: number; breeds: string[] }
/** Pigs, poultry and horses are not part of the silage budget. */
const eatsSilage = (cls: AnimalClass) => !['pigs', 'poultry', 'horses'].includes(speciesOf(cls));

export function GroupsStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const types = farmTypes(b.farm);
  const existing = b.groups.filter((g) => !g.archived);
  const [rows, setRows] = useState<AnimalRow[]>(() => suggestedClasses(types).filter((c) => !existing.some((g) => g.animal_class === c)).map((c) => ({ key: c, cls: c, count: 0, breeds: [] })));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const setRow = (key: string, patch: Partial<AnimalRow>) => setRows(rows.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const fill = rows.filter((a) => a.count > 0);
  async function save() {
    setBusy(true);
    const groups: AnimalGroup[] = fill.map((a, i) => ({
      id: uuid(), farm_id: farmId, name: ANIMAL_CLASS_LABEL[a.cls], animal_class: a.cls, ...breedPatch(a.breeds), head_count: a.count, head_count_updated_at: new Date().toISOString(),
      forage_t_per_head_month: null, housed: eatsSilage(a.cls), at_grass: false, housed_from: null, archived: false, sort_order: existing.length + i
    }));
    const ops: Op[] = groups.map((g) => { const { head_count_updated_at: _h, ...row } = g; void _h; return { kind: 'insert' as const, table: 'animal_groups', row: row as unknown as Record<string, unknown> }; });
    const ok = await run(ops, `${groups.length} group${groups.length === 1 ? '' : 's'} added`, (x) => ({ ...x, groups: [...x.groups, ...groups] }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-4">
      {existing.length > 0 && (
        <AlreadyHave to="/farm/groups" label="Change them in Animals and breeds">
          <p className="font-bold">You have {existing.length} group{existing.length === 1 ? '' : 's'}:</p>
          <p>{existing.map((g) => `${g.name} (${g.head_count}${groupBreeds(g).length ? `, ${breedLabel(groupBreeds(g))}` : ''})`).join('; ')}</p>
        </AlreadyHave>
      )}
      <p className="text-[0.9375rem] text-muted">Rough numbers are fine. Tap every breed in a group. You can change all of this later.</p>
      <ul className="space-y-3">
        {rows.map((a) => (
          <li key={a.key} className="rounded-2xl border border-line px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <button aria-label={`Remove ${ANIMAL_CLASS_LABEL[a.cls]}`} onClick={() => setRows(rows.filter((x) => x.key !== a.key))}
                className="-ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-pasture"><X className="h-4 w-4" aria-hidden /></button>
              <p className="min-w-0 flex-1 font-semibold">{ANIMAL_CLASS_LABEL[a.cls]}</p>
              <MiniStepper label={`How many ${ANIMAL_CLASS_LABEL[a.cls].toLowerCase()}`} value={a.count} step={speciesOf(a.cls) === 'sheep' || speciesOf(a.cls) === 'poultry' ? 10 : 5} onChange={(n) => setRow(a.key, { count: n })} />
            </div>
            {a.count > 0 && <div className="mt-2 pb-1"><BreedField cls={a.cls} value={a.breeds} onChange={(v) => setRow(a.key, { breeds: v })} /></div>}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="rounded-2xl bg-pasture p-3.5">
          <div className="mb-2 flex items-center justify-between"><p className="font-bold">Add another kind</p>
            <button aria-label="Close" onClick={() => setAdding(false)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-card"><X className="h-4 w-4" aria-hidden /></button></div>
          <ClassPicker value={null} exclude={[...rows.map((r) => r.cls), ...existing.map((g) => g.animal_class)]} onChange={(c) => { setRows([...rows, { key: `${c}-${Date.now()}`, cls: c, count: 0, breeds: [] }]); setAdding(false); }} />
        </div>
      ) : (
        <Button variant="secondary" block onClick={() => setAdding(true)}><Plus className="h-5 w-5" aria-hidden />Add another kind of animal</Button>
      )}
      <StepActions next={next} busy={busy} canSave={fill.length > 0} onSave={save} skipLabel={existing.length && !fill.length ? 'Next' : 'Skip this'} />
    </div>
  );
}

export function WhereStep({ b, next }: StepProps) {
  const { run } = useFarmSave();
  const today = todayISO();
  const groups = b.groups.filter((g) => !g.archived && eatsSilage(g.animal_class));
  const [housing, setHousing] = useState(b.farm.housing_start ?? '');
  const [turnout, setTurnout] = useState(b.farm.turnout_date ?? '');
  const m = Number(today.slice(5, 7));
  const guess: 'in' | 'out' = m >= 11 || m <= 3 ? 'in' : 'out';
  const [where, setWhere] = useState<Record<string, 'in' | 'out'>>(() => Object.fromEntries(groups.map((g) => [g.id, g.at_grass ? 'out' : g.housed_from ? 'in' : guess])));
  const [inOn, setInOn] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const patch: Record<string, unknown> = {};
    if (housing) patch.housing_start = housing;
    if (turnout) patch.turnout_date = turnout;
    const ops: Op[] = Object.keys(patch).length ? [farmPatch(patch)] : [];
    const changes = groups.map((g) => {
      const w = where[g.id];
      const p = { at_grass: w === 'out', housed_from: w === 'in' ? (housing && housing <= today ? housing : today) : (inOn[g.id] || null) };
      ops.push({ kind: 'update', table: 'animal_groups', match: { id: g.id }, patch: p });
      return [g.id, p] as const;
    });
    const by = new Map(changes);
    const ok = await run(ops, 'Winter dates saved', (x) => ({ ...x, farm: { ...x.farm, ...patch }, groups: x.groups.map((g) => (by.has(g.id) ? { ...g, ...by.get(g.id) } : g)) }));
    setBusy(false);
    if (ok) next();
  }
  const chip = (kind: 'housing' | 'turnout', value: string, set: (v: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {monthChips(kind, today).map((c) => (
        <button key={c.on} type="button" aria-pressed={value === c.on} onClick={() => set(c.on)}
          className={`min-h-[2.75rem] rounded-full border px-4 text-[0.9375rem] font-semibold ${value === c.on ? 'border-field bg-field text-white' : 'border-line bg-card'}`}>{c.label}</button>
      ))}
    </div>
  );
  return (
    <div className="space-y-5">
      <Field label="When do animals come in for the winter?" htmlFor="housing" hint="Tap a month or pick the day. Teagasc's advice: go by how long they were in last winter, and keep a month extra.">
        <div className="space-y-2">{chip('housing', housing, setHousing)}<input id="housing" type="date" className="input" value={housing} onChange={(e) => setHousing(e.target.value)} /></div>
      </Field>
      <Field label="When do you expect to let them out in spring?" htmlFor="turnout" hint="The silage has to last until then.">
        <div className="space-y-2">{chip('turnout', turnout, setTurnout)}<input id="turnout" type="date" className="input" value={turnout} min={housing || undefined} onChange={(e) => setTurnout(e.target.value)} /></div>
      </Field>
      {groups.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="label">Where are they today?</legend>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setWhere(Object.fromEntries(groups.map((g) => [g.id, 'in'])))}>All in</Button>
            <Button variant="secondary" onClick={() => setWhere(Object.fromEntries(groups.map((g) => [g.id, 'out'])))}>All out at grass</Button>
          </div>
          {groups.map((g) => (
            <div key={g.id} className="space-y-2 rounded-2xl border border-line px-3.5 py-3">
              <Chips label={`${g.name} (${g.head_count})`} columns={2} value={where[g.id] ?? null} onChange={(v) => setWhere({ ...where, [g.id]: v })}
                options={[{ value: 'in', label: 'In now' }, { value: 'out', label: 'Out at grass' }]} />
              {where[g.id] === 'out' && (
                <Field label="Coming in about (optional)" htmlFor={`in-${g.id}`} hint={inOn[g.id] ? 'Counted from that day.' : housing && housing > today ? `Blank = with the rest, ${fmtDay(housing)}.` : 'Blank = counted from today, so the plan errs short.'}>
                  <input id={`in-${g.id}`} type="date" className="input" min={today} value={inOn[g.id] ?? ''} onChange={(e) => setInOn({ ...inOn, [g.id]: e.target.value })} />
                </Field>
              )}
            </div>
          ))}
          <p className="hint">Animals out at grass aren't eating silage yet, so they're counted from the day they come in.</p>
        </fieldset>
      )}
      <StepActions next={next} busy={busy} canSave={!!housing || !!turnout || groups.length > 0} onSave={save} />
    </div>
  );
}

export function CalvingStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const types = farmTypes(b.farm);
  const today = todayISO();
  const herd: 'dairy' | 'suckler' = types.includes('dairy') ? 'dairy' : 'suckler';
  const hint = calvingHint(herd, today);
  const seasons = (b.seasons ?? []).filter((s) => !s.archived);
  const [first, setFirst] = useState(hint.on);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const cows = b.groups.find((g) => !g.archived && g.animal_class === (herd === 'dairy' ? 'dairy_cow' : 'suckler_cow'));
    const calves = b.groups.find((g) => !g.archived && g.animal_class === 'calf');
    const m = Number(first.slice(5, 7));
    const season: CalvingSeason = {
      id: uuid(), farm_id: farmId, label: `${m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Autumn'} calving ${first.slice(0, 4)}`, herd, calving_start: first,
      calving_end: null, cows_due: cows?.head_count ?? null, thin_count: null, dry_weeks: 8, dry_weeks_thin: 10,
      milking_group_id: herd === 'dairy' ? cows?.id ?? null : null, dry_group_id: null, calf_group_id: calves?.id ?? null, archived: false
    } as CalvingSeason;
    const ok = await run([{ kind: 'insert', table: 'calving_seasons', row: season as unknown as Record<string, unknown> }], 'Calving season added', (x) => ({ ...x, seasons: [...(x.seasons ?? []), season] }));
    setBusy(false);
    if (ok) next();
  }
  if (seasons.length) {
    return (
      <div className="space-y-4">
        <AlreadyHave to="/calving" label="See the calving plan">
          <p className="font-bold">{seasons[0].label}</p><p>First calf due {fmtDay(seasons[0].calving_start)}.</p>
        </AlreadyHave>
        <StepActions next={next} skipLabel="Next" />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Field label="When is the first calf due?" htmlFor="calf"
        hint={<>{touched ? 'Your date.' : <><b>{hint.label}</b> filled in: change it to yours. {hint.source}.</>} Only know when the bull went in? Add about 283 days (9 months and 10 days).</>}>
        <input id="calf" type="date" className="input" min={today} value={first} onChange={(e) => { setFirst(e.target.value); setTouched(true); }} />
      </Field>
      <p className="rounded-2xl bg-pasture p-4 text-[0.9375rem]">From this date Agri-It lays out body condition, drying off, minerals, calf tags and the calving checklist, each with its Teagasc source. Nothing is added until you approve it.</p>
      <StepActions next={next} busy={busy} canSave={!!first} onSave={save} saveLabel={touched ? 'Save and next' : 'Use this date'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feeding
// ---------------------------------------------------------------------------
export function MealStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const products = b.products.filter((p) => !p.archived);
  const groups = b.groups.filter((g) => !g.archived);
  const [buys, setBuys] = useState<'yes' | 'no' | null>(products.length ? 'yes' : null);
  const [form, setForm] = useState(products.length === 0);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [pick, setPick] = useState<{ name: string; catalogueKey: string | null }>({ name: '', catalogueKey: null });
  const [stock, setStock] = useState('');
  const [unit, setUnit] = useState<'kg' | 't'>('t');
  const [measured, setMeasured] = useState<'measured' | 'farmer_estimate'>('farmer_estimate');
  const [lead, setLead] = useState(b.farm.default_lead_time_days != null ? String(b.farm.default_lead_time_days) : '');
  const [fed, setFed] = useState<Record<string, { kg: string; feeds: number }>>({});
  const [busy, setBusy] = useState(false);
  const rulesOk = Object.values(fed).every((r) => Number(r.kg) > 0);
  async function save() {
    setBusy(true);
    const today = todayISO();
    const pid = uuid();
    const product = { id: pid, farm_id: farmId, name: pick.name.trim(), catalogue_key: pick.catalogueKey, supplier_id: supplierId, storage_location: null,
      safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: lead === '' ? null : Math.max(0, Math.min(60, Math.round(Number(lead)))), analysis: null, archived: false } as unknown as FeedProduct;
    const ops: Op[] = [{ kind: 'insert', table: 'feed_products', row: product as unknown as Record<string, unknown> }];
    let txn: FeedTransaction | null = null;
    if (stock !== '' && Number(stock) >= 0) {
      txn = { id: uuid(), farm_id: farmId, feed_product_id: pid, txn_type: measured === 'measured' ? 'count' : 'opening', quantity_kg: Number(stock), effective_on: today, evidence: measured,
        order_date: null, delivery_date: null, expected_delivery_date: null, order_status: null, linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null, document_id: null, notes: null } as FeedTransaction;
      ops.push({ kind: 'insert', table: 'feed_transactions', row: txn as unknown as Record<string, unknown> });
    }
    const rules: FeedingRule[] = Object.entries(fed).map(([gid, r]) => ({
      id: uuid(), farm_id: farmId, feed_product_id: pid, animal_group_id: gid, head_count_override: null, kg_per_head_per_feed: Number(r.kg), feeds_per_day: r.feeds,
      start_date: today, end_date: null, is_temporary: false, label: null, confirm_daily: true
    }));
    for (const r of rules) ops.push({ kind: 'insert', table: 'feeding_rules', row: r as unknown as Record<string, unknown> });
    if (lead !== '' && b.farm.default_lead_time_days == null) ops.push(farmPatch({ default_lead_time_days: product.lead_time_days }));
    const ok = await run(ops, `${product.name} added`, (x) => ({ ...x, products: [...x.products, product], txns: txn ? [...x.txns, txn] : x.txns, rules: [...x.rules, ...rules] }));
    setBusy(false);
    if (ok) { setForm(false); setPick({ name: '', catalogueKey: null }); setStock(''); setFed({}); }
  }
  return (
    <div className="space-y-5">
      {!products.length && (
        <Chips label="Do you buy meal, nuts or calf ration?" columns={2} value={buys} onChange={(v) => { setBuys(v); if (v === 'no') next(); }}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No, none' }]} />
      )}
      {products.length > 0 && (
        <AlreadyHave to="/" label="See them on the dashboard">
          <p className="font-bold">{products.map((p) => p.name).join(', ')}</p>
          <p>Each one shows days left and when to order.</p>
        </AlreadyHave>
      )}
      {buys === 'yes' && form && (
        <div className="space-y-5">
          <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} label="Who do you buy it from?" />
          <ProductPick kind="feed" supplierId={supplierId} name={pick.name} catalogueKey={pick.catalogueKey} onChange={setPick} label="Which feed?" />
          <QuantityInput label="Roughly how much is in the bin now?" kg={stock} onKg={setStock} unit={unit} onUnit={setUnit} />
          {stock !== '' && <Chips columns={2} value={measured} onChange={setMeasured} options={[{ value: 'farmer_estimate', label: 'A rough guess' }, { value: 'measured', label: 'Measured', sub: 'Dipped or counted' }]} />}
          {groups.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="label">Who gets it, and how much?</legend>
              <ul className="space-y-2">
                {groups.map((g) => {
                  const r = fed[g.id];
                  const twice = g.animal_class === 'dairy_cow';
                  return (
                    <Tick key={g.id} on={!!r} title={`${g.name} (${g.head_count})`} sub={r ? undefined : 'Tap if they get it'}
                      onClick={() => setFed(r ? Object.fromEntries(Object.entries(fed).filter(([k]) => k !== g.id)) : { ...fed, [g.id]: { kg: '', feeds: twice ? 2 : 1 } })}>
                      <NumberInput label="kg each, each feed" unit="kg" value={r?.kg ?? ''} onChange={(v) => setFed({ ...fed, [g.id]: { ...r!, kg: v } })} />
                      <Chips label="Feeds a day" columns={3} value={String(r?.feeds ?? 1)} onChange={(v) => setFed({ ...fed, [g.id]: { ...r!, feeds: Number(v) } })}
                        options={[{ value: '1', label: 'Once' }, { value: '2', label: twice ? 'Twice (milking)' : 'Twice' }, { value: '3', label: '3 times' }]} />
                    </Tick>
                  );
                })}
              </ul>
              <p className="hint">Your own feeding plan. Agri-It never says how much to feed: it works out when the bin runs out.</p>
            </fieldset>
          )}
          <NumberInput label="Days from ordering to delivery (optional)" unit="days" integer value={lead} onChange={setLead}
            hint="From your own experience. Without it there is no order-by date: Agri-It never guesses it." />
          <Button block disabled={!pick.name.trim() || !rulesOk || busy} onClick={save}>{busy ? 'Saving' : 'Save this feed'}</Button>
        </div>
      )}
      {buys === 'yes' && !form && <Button variant="secondary" block onClick={() => setForm(true)}><Plus className="h-5 w-5" aria-hidden />Add another feed</Button>}
      <StepActions next={next} skipLabel={products.length ? 'Next' : 'Skip this'} />
    </div>
  );
}

export function SilageStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const [kind, setKind] = useState<'pit' | 'bales' | 'both' | 'none' | null>(b.silage.length ? null : null);
  const [len, setLen] = useState(''); const [wid, setWid] = useState(''); const [hi, setHi] = useState('');
  const [bales, setBales] = useState(''); const [baleKg, setBaleKg] = useState('');
  const [busy, setBusy] = useState(false);
  const pit = kind === 'pit' || kind === 'both';
  const bale = kind === 'bales' || kind === 'both';
  const ok = (!pit || (Number(len) > 0 && Number(wid) > 0 && Number(hi) > 0)) && (!bale || Number(bales) > 0) && (pit || bale);
  async function save() {
    setBusy(true);
    const base = { farm_id: farmId, acreage: null, yield_t_per_acre: null, length_m: null, width_m: null, avg_height_m: null, density_kg_m3: null, bale_count: null, bale_weight_kg: null,
      measured_tonnes: null, dm_percent: null, dmd_percent: null, crude_protein_percent: null, ph: null, measured_on: todayISO(), fed_out_tonnes: 0, notes: null };
    const stores: SilageStore[] = [];
    if (pit) stores.push({ ...base, id: uuid(), name: 'Silage pit', method: 'pit_dimensions', length_m: Number(len), width_m: Number(wid), avg_height_m: Number(hi) } as SilageStore);
    if (bale) stores.push({ ...base, id: uuid(), name: 'Bales', method: 'bale_count', bale_count: Math.round(Number(bales)), bale_weight_kg: baleKg ? Number(baleKg) : null } as SilageStore);
    const ok2 = await run(stores.map((s) => ({ kind: 'insert' as const, table: 'silage_stores', row: s as unknown as Record<string, unknown> })), 'Silage added', (x) => ({ ...x, silage: [...x.silage, ...stores] }));
    setBusy(false);
    if (ok2) next();
  }
  if (b.silage.length) {
    return (
      <div className="space-y-4">
        <AlreadyHave to="/farm/silage" label="See the winter silage plan"><p className="font-bold">{b.silage.map((s) => s.name).join(', ')}</p></AlreadyHave>
        <StepActions next={next} skipLabel="Next" />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Chips label="What silage do you have for the winter?" columns={2} value={kind} onChange={(v) => { setKind(v); if (v === 'none') next(); }}
        options={[{ value: 'pit', label: 'A pit' }, { value: 'bales', label: 'Bales' }, { value: 'both', label: 'Both' }, { value: 'none', label: 'None, or I buy it in' }]} />
      {pit && (
        <div className="space-y-3 rounded-2xl bg-pasture p-4">
          <p className="font-bold">The pit, in metres (pace it out: a long stride is about a metre)</p>
          <div className="grid grid-cols-3 gap-2">
            <NumberInput label="Long" unit="m" value={len} onChange={setLen} />
            <NumberInput label="Wide" unit="m" value={wid} onChange={setWid} />
            <NumberInput label="High" unit="m" value={hi} onChange={setHi} />
          </div>
          <p className="hint">Average height after settling. With no test, Agri-It uses typical silage and says it's a best guess; a one-minute squeeze test firms it up later.</p>
        </div>
      )}
      {bale && (
        <div className="space-y-3 rounded-2xl bg-pasture p-4">
          <NumberInput label="How many bales?" value={bales} onChange={setBales} integer />
          <NumberInput label="Weight of a bale (optional)" unit="kg" value={baleKg} onChange={setBaleKg} hint="Blank = a typical 600 kg bale, shown as a best guess." />
        </div>
      )}
      <StepActions next={next} busy={busy} canSave={ok} onSave={save} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function JobsStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const types = farmTypes(b.farm);
  const ideas = jobIdeasFor(types);
  const have = new Set(b.routines.filter((r) => r.kind === 'job').map((r) => r.title.toLowerCase()));
  const [picked, setPicked] = useState<Record<string, JobIdea>>({});
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (j: JobIdea) => setPicked(picked[j.key] ? Object.fromEntries(Object.entries(picked).filter(([k]) => k !== j.key)) : { ...picked, [j.key]: j });
  async function save() {
    setBusy(true);
    const today = todayISO();
    const list = [...Object.values(picked), ...(own.trim() ? [{ key: 'own', title: own.trim(), for: 'all', frequency: 'daily' } as JobIdea] : [])];
    const routines: Routine[] = list.map((j) => ({
      id: uuid(), farm_id: farmId, kind: 'job', title: j.title, frequency: j.frequency, interval_days: null, weekday: j.frequency === 'weekly' ? j.weekday ?? 1 : null,
      day_of_month: j.frequency === 'monthly' ? j.dayOfMonth ?? 1 : null, interval_months: 1, start_date: today, end_date: null, amount: null, category: null,
      counterparty: null, feed_product_id: null, silage_store_id: null, supplier_id: null, active: true, created_at: new Date().toISOString()
    }));
    const ops: Op[] = routines.map((r) => { const { created_at: _c, ...row } = r; void _c; return { kind: 'insert' as const, table: 'routines', row: row as unknown as Record<string, unknown> }; });
    const ok = await run(ops, `${routines.length} job${routines.length === 1 ? '' : 's'} added to your diary`, (x) => ({ ...x, routines: [...x.routines, ...routines] }));
    setBusy(false);
    if (ok) next();
  }
  const count = Object.keys(picked).length + (own.trim() ? 1 : 0);
  return (
    <div className="space-y-4">
      <p className="text-[0.9375rem] text-muted">Pick the jobs you'd like ticked off. Feeding from your feeding plans is on the list already. Change how often with the chips.</p>
      <ul className="space-y-2">
        {ideas.filter((j) => !have.has(j.title.toLowerCase())).map((j) => {
          const p = picked[j.key];
          return (
            <Tick key={j.key} on={!!p} onClick={() => toggle(j)} title={j.title}
              sub={j.frequency === 'daily' ? 'Every day' : j.frequency === 'weekly' ? `Weekly, ${WEEKDAYS[j.weekday ?? 1]}` : 'Monthly'}>
              <Chips columns={3} value={p?.frequency ?? j.frequency} onChange={(v) => setPicked({ ...picked, [j.key]: { ...p!, frequency: v } })}
                options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />
              {p?.frequency === 'weekly' && (
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} type="button" aria-pressed={(p.weekday ?? 1) === i} onClick={() => setPicked({ ...picked, [j.key]: { ...p, weekday: i } })}
                      className={`min-h-[2.5rem] rounded-lg border text-sm font-bold ${(p.weekday ?? 1) === i ? 'border-field bg-field text-white' : 'border-line'}`}>{d}</button>
                  ))}
                </div>
              )}
            </Tick>
          );
        })}
      </ul>
      <TextInput label="Another job, in your own words (optional)" value={own} onChange={setOwn} placeholder="e.g. Check the electric fence" voice />
      <p className="text-sm text-muted">Want a nudge at milking time? Turn on reminders in <Link className="font-bold text-accent underline" to="/settings#reminders">Settings</Link>.</p>
      <StepActions next={next} busy={busy} canSave={count > 0} onSave={save} saveLabel={count ? `Add ${count} job${count === 1 ? '' : 's'}` : 'Save and next'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crops and fields
// ---------------------------------------------------------------------------
export function CropsStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const existing = b.crops.filter((c) => !c.archived);
  const [acres, setAcres] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const harvest = currentHarvest();
  async function save() {
    setBusy(true);
    const rows = Object.entries(acres).filter(([, a]) => a > 0).map(([name, a]) => ({ id: uuid(), farm_id: farmId, name, variety: null, acres: a, harvest_year: harvest, sown_on: null, archived: false } as Crop));
    const ok = await run(rows.map((r) => ({ kind: 'insert' as const, table: 'crops', row: r as unknown as Record<string, unknown> })), 'Crops added', (x) => ({ ...x, crops: [...x.crops, ...rows] }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-4">
      {existing.length > 0 && <AlreadyHave to="/farm/crops" label="Change them in Crops"><p>{existing.map((c) => `${c.name} ${c.acres ?? '?'} ac`).join(', ')}</p></AlreadyHave>}
      <p className="text-[0.9375rem] text-muted">Acres for harvest {harvest}. Skip any you don't grow.</p>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {COMMON_CROPS.filter((c) => !existing.some((e) => e.name === c)).map((c) => (
          <li key={c} className="flex items-center gap-2 px-3.5 py-2.5"><p className="min-w-0 flex-1 font-semibold">{c}</p><MiniStepper label={`${c} acres`} value={acres[c] ?? 0} step={5} unit="ac" onChange={(n) => setAcres({ ...acres, [c]: n })} /></li>
        ))}
      </ul>
      <StepActions next={next} busy={busy} canSave={Object.values(acres).some((a) => a > 0)} onSave={save} skipLabel={existing.length ? 'Next' : 'Skip this'} />
    </div>
  );
}

export function FieldsStep({ b, next }: StepProps) {
  const fields = (b.fields ?? []).filter((f) => !f.archived);
  return (
    <div className="space-y-4">
      {fields.length ? (
        <AlreadyHave to="/farm/fields" label="Add or change fields"><p className="font-bold">{fields.length} field{fields.length === 1 ? '' : 's'}: {fields.map((f) => f.name).join(', ')}</p></AlreadyHave>
      ) : (
        <div className="rounded-2xl bg-pasture p-4 text-[0.9375rem]">
          <p>Name each field, its acres and what it's used for. Spreading reminders (when spreading opens, your own round, silage ground 50 days before cutting) follow from them.</p>
          <Link to="/farm/fields?from=setup" className="mt-3 inline-flex min-h-tap items-center rounded-full bg-field px-5 font-bold text-white">Add your fields</Link>
        </div>
      )}
      <StepActions next={next} skipLabel={fields.length ? 'Next' : 'Later'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money coming in
// ---------------------------------------------------------------------------
const MILK_BUYERS = { ROI: ['Tirlán', 'Dairygold', 'Kerry Dairy Ireland', 'Lakeland Dairies', 'Arrabawn Tipperary', 'Aurivo', 'Carbery (West Cork co-ops)'], NI: ['Dale Farm', 'Lakeland Dairies', 'Strathroy Dairy'] };
export function MilkStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const list = MILK_BUYERS[b.farm.jurisdiction];
  const [buyer, setBuyer] = useState(b.farm.milk_buyer ?? '');
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasRoutine = b.routines.some((r) => r.kind === 'income' && r.category === 'milk');
  async function save() {
    setBusy(true);
    const ops: Op[] = [farmPatch({ milk_buyer: buyer.trim() || null })];
    let routine: Routine | null = null;
    if (day && !hasRoutine) {
      routine = { id: uuid(), farm_id: farmId, kind: 'income', title: 'Milk cheque', frequency: 'monthly', interval_days: null, weekday: null, day_of_month: Number(day), interval_months: 1,
        start_date: todayISO(), end_date: null, amount: null, category: 'milk', counterparty: buyer.trim() || null, feed_product_id: null, silage_store_id: null, supplier_id: null, active: true, created_at: new Date().toISOString() };
      const { created_at: _c, ...row } = routine; void _c;
      ops.push({ kind: 'insert', table: 'routines', row });
    }
    const ok = await run(ops, 'Milk details saved', (x) => ({ ...x, farm: { ...x.farm, milk_buyer: buyer.trim() || null }, routines: routine ? [...x.routines, routine] : x.routines }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Chips label="Who buys your milk?" value={list.includes(buyer) ? buyer : null} onChange={setBuyer} options={list.map((x) => ({ value: x, label: x }))} />
        <TextInput label="Or type it" value={list.includes(buyer) ? '' : buyer} onChange={setBuyer} />
      </div>
      {!hasRoutine && (
        <Chips label="Which day does the milk cheque usually come?" value={day} onChange={setDay} columns={3}
          hint="A reminder each month to put in the cheque (litres and amount from the statement). Amounts change month to month, so none is assumed."
          options={['5', '10', '12', '15', '20', '25'].map((d) => ({ value: d, label: `The ${d}th` }))} />
      )}
      <p className="text-sm text-muted">Have last month's statement to hand? <Link className="font-bold text-accent underline" to="/record/milk">Put it in now</Link>.</p>
      <StepActions next={next} busy={busy} canSave={!!buyer.trim() || !!day} onSave={save} />
    </div>
  );
}

export function SchemesStep({ b, next }: StepProps) {
  const { run } = useFarmSave();
  const [busy, setBusy] = useState(false);
  const planned = (b.expected ?? []).filter((e) => !e.income_id);
  async function save(rows: ExpectedIncome[]) {
    setBusy(true);
    const ok = await run(rows.map((r) => ({ kind: 'insert' as const, table: 'expected_income', row: r as unknown as Record<string, unknown> })), `${rows.length} payment${rows.length === 1 ? '' : 's'} planned`, (x) => ({ ...x, expected: [...(x.expected ?? []), ...rows] }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-4">
      {planned.length > 0 && <AlreadyHave to="/money/payments" label="See scheme payments"><p>{planned.length} payment{planned.length === 1 ? '' : 's'} expected, {eur(planned.reduce((t, e) => t + Number(e.amount_eur), 0))}.</p></AlreadyHave>}
      <p className="text-[0.9375rem] text-muted">Tick the schemes you're in and give what you expect for the year. Agri-It puts each payment on its published date for your cash plan. Nothing counts as income until you say it's in.</p>
      <SchemePlanner b={b} onSave={save} busy={busy} />
      <StepActions next={next} skipLabel={planned.length ? 'Next' : 'Skip this'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regular bills
// ---------------------------------------------------------------------------
interface BillPick { amount: string; every: number; on: string }
export function RegularStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const today = todayISO();
  const firstNext = `${addDays(`${today.slice(0, 7)}-28`, 5).slice(0, 7)}-01`;
  const have = new Set(b.routines.filter((r) => r.kind === 'expense').map((r) => r.title.toLowerCase()));
  const [picked, setPicked] = useState<Record<string, BillPick>>({});
  const [busy, setBusy] = useState(false);
  const ready = Object.entries(picked).filter(([, p]) => Number(p.amount) > 0 && p.on);
  async function save() {
    setBusy(true);
    const routines: Routine[] = ready.map(([key, p]) => {
      const idea = BILL_IDEAS.find((x) => x.key === key)!;
      return { id: uuid(), farm_id: farmId, kind: 'expense', title: idea.title, frequency: 'monthly', interval_days: null, weekday: null, day_of_month: Number(p.on.slice(8, 10)),
        interval_months: p.every, start_date: p.on, end_date: null, amount: Number(p.amount), category: idea.category, counterparty: null,
        feed_product_id: null, silage_store_id: null, supplier_id: null, active: true, created_at: new Date().toISOString() };
    });
    const ops: Op[] = routines.map((r) => { const { created_at: _c, ...row } = r; void _c; return { kind: 'insert' as const, table: 'routines', row: row as unknown as Record<string, unknown> }; });
    const ok = await run(ops, `${routines.length} bill${routines.length === 1 ? '' : 's'} added`, (x) => ({ ...x, routines: [...x.routines, ...routines] }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-4">
      <p className="text-[0.9375rem] text-muted">Bills that come regularly. Each goes in your diary to tick off with the real amount, and in the year plan before it's due. Rough amounts are fine.</p>
      <ul className="space-y-2">
        {BILL_IDEAS.filter((x) => !have.has(x.title.toLowerCase()) && !(x.key === 'rent' && b.routines.some((r) => r.category === 'land_rent'))).map((x) => {
          const p = picked[x.key];
          return (
            <Tick key={x.key} on={!!p} title={x.title} sub={x.category === 'household' ? 'Not a farm cost, but it comes out of the same account' : COST_LABEL[x.category as CostCategory]}
              onClick={() => setPicked(p ? Object.fromEntries(Object.entries(picked).filter(([k]) => k !== x.key)) : { ...picked, [x.key]: { amount: '', every: x.every, on: firstNext } })}>
              <NumberInput label="About how much each time?" unit={cur()} value={p?.amount ?? ''} onChange={(v) => setPicked({ ...picked, [x.key]: { ...p!, amount: v } })} />
              <Chips label="How often?" columns={2} value={String(p?.every ?? x.every)} onChange={(v) => setPicked({ ...picked, [x.key]: { ...p!, every: Number(v) } })}
                options={[1, 2, 3, 6, 12].map((n) => ({ value: String(n), label: EVERY_LABEL[n] }))} />
              <Field label="Next one due" htmlFor={`bill-${x.key}`}>
                <input id={`bill-${x.key}`} type="date" className="input" min={today} value={p?.on ?? ''} onChange={(e) => setPicked({ ...picked, [x.key]: { ...p!, on: e.target.value } })} />
              </Field>
            </Tick>
          );
        })}
      </ul>
      <StepActions next={next} busy={busy} canSave={ready.length > 0} onSave={save} saveLabel={ready.length ? `Add ${ready.length} bill${ready.length === 1 ? '' : 's'}` : 'Save and next'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------
export function LoansStep({ b, next }: StepProps) {
  const { run, farmId } = useFarmSave();
  const loans = (b.loans ?? []).filter((l) => !l.archived);
  const [has, setHas] = useState<'yes' | 'no' | null>(loans.length ? 'yes' : null);
  const [adding, setAdding] = useState(loans.length === 0);
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  async function saveLoan(row: Omit<Loan, 'created_at' | 'updated_at'>) {
    setBusy(true);
    const ok = await run([{ kind: 'insert', table: 'loans', row: row as unknown as Record<string, unknown> }], `${row.lender} saved`, (x) => ({ ...x, loans: [...(x.loans ?? []), row as Loan] }));
    setBusy(false);
    if (ok) setAdding(false);
  }
  async function none() {
    setHas('no');
    const setup = withMark(b.farm.setup, 'loans', 'done');
    await run([farmPatch({ setup })], 'Noted: no loans', (x) => ({ ...x, farm: { ...x.farm, setup } }));
    next();
  }
  return (
    <div className="space-y-5">
      {!loans.length && (
        <Chips label="Does the farm have any loans, hire purchase, leases or an overdraft?" columns={2} value={has} onChange={(v) => (v === 'no' ? none() : setHas(v))}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
      )}
      {loans.length > 0 && (
        <ul className="space-y-2">
          {loans.map((l) => (
            <li key={l.id} className="rounded-2xl border border-line px-3.5 py-3">
              <p className="font-bold">{l.lender} <span className="font-normal text-muted">({KIND_LABEL[l.kind]})</span></p>
              <p className="text-[0.9375rem]">{l.kind === 'overdraft' ? `Limit ${eur(Number(l.credit_limit_eur ?? 0))}` : `${eur(balanceOn(l, b.costs, b.loanStatements ?? [], today))} owed`}{l.repayment_eur ? `, ${eur(Number(l.repayment_eur))} ${loanLine(l)}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
      {has === 'yes' && adding && (
        <div className="rounded-2xl bg-pasture p-4">
          <p className="mb-3 font-bold">{loans.length ? 'Another one' : 'Take your latest statement, one loan at a time'}</p>
          <LoanEditor farmId={farmId} jurisdiction={b.farm.jurisdiction} onSave={saveLoan} busy={busy} onCancel={loans.length ? () => setAdding(false) : undefined} />
        </div>
      )}
      {has === 'yes' && !adding && <Button variant="secondary" block onClick={() => setAdding(true)}><Plus className="h-5 w-5" aria-hidden />Add another loan, HP or overdraft</Button>}
      <p className="text-sm text-muted">Repayments go in your year plan. Each time one is due Agri-It asks if it came out, and at the year end the interest is shown apart from the loan for your accountant.</p>
      <StepActions next={next} skipLabel={loans.length ? 'Next' : 'Skip this'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank and year end
// ---------------------------------------------------------------------------
export function BankStep({ b, next }: StepProps) {
  const { run } = useFarmSave();
  const [side, setSide] = useState<'credit' | 'overdrawn'>(b.farm.opening_cash_eur != null && Number(b.farm.opening_cash_eur) < 0 ? 'overdrawn' : 'credit');
  const [amount, setAmount] = useState(b.farm.opening_cash_eur != null ? String(Math.abs(Number(b.farm.opening_cash_eur))) : '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const today = todayISO();
    const v = Number(amount) * (side === 'overdrawn' ? -1 : 1);
    // Taken as the balance at the end of today, like Check against the bank
    const patch = { opening_cash_eur: v, opening_cash_date: addDays(today, 1) };
    const ok = await run([farmPatch(patch)], 'Bank balance saved', (x) => ({ ...x, farm: { ...x.farm, ...patch } }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-5">
      <Chips label="The farm account today is" columns={2} value={side} onChange={setSide} options={[{ value: 'credit', label: 'In credit' }, { value: 'overdrawn', label: 'Overdrawn' }]} />
      <NumberInput label="By how much?" unit={cur()} value={amount} onChange={setAmount}
        hint="From your banking app. It starts your recorded cash: Agri-It adds income and takes off bills as you record them. Never shared." />
      <StepActions next={next} busy={busy} canSave={amount !== ''} onSave={save} />
    </div>
  );
}

export function YearStep({ b, next }: StepProps) {
  const { run } = useFarmSave();
  const hint = fyHint(b.farm.jurisdiction);
  const [month, setMonth] = useState(b.farm.financial_year_start_month ?? hint.month);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const setup = withMark(b.farm.setup, 'year', 'done');
    const patch = { financial_year_start_month: month, setup };
    const ok = await run([farmPatch(patch)], 'Financial year saved', (x) => ({ ...x, farm: { ...x.farm, ...patch } }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-5">
      <Field label="Your accounts year starts in" htmlFor="fy" hint={hint.why}>
        <select id="fy" className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </Field>
      <StepActions next={next} busy={busy} onSave={save} saveLabel={month === hint.month ? `Yes, ${MONTH_NAMES[month - 1]}` : 'Save and next'} />
    </div>
  );
}

export function AccountantStep({ b, next }: StepProps) {
  const { run } = useFarmSave();
  const [name, setName] = useState(b.farm.accountant_name ?? '');
  const [contact, setContact] = useState(b.farm.accountant_contact ?? '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const patch = { accountant_name: name.trim() || null, accountant_contact: contact.trim() || null };
    const ok = await run([farmPatch(patch)], 'Accountant saved', (x) => ({ ...x, farm: { ...x.farm, ...patch } }));
    setBusy(false);
    if (ok) next();
  }
  return (
    <div className="space-y-5">
      <TextInput label="Accountant or firm" value={name} onChange={setName} placeholder="e.g. Ifac, or your local accountant" />
      <TextInput label="Phone or email (optional)" value={contact} onChange={setContact} />
      <p className="rounded-2xl bg-pasture p-4 text-[0.9375rem]">At the year end, Money, Year-end pack gives them the summary, every transaction, loans with the interest split out, scheme payments and the invoices, plus a checklist of what else to gather.</p>
      <StepActions next={next} busy={busy} canSave={!!name.trim()} onSave={save} />
    </div>
  );
}
