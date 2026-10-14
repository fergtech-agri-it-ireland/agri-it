import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { calvingFromBreeding, GESTATION_DAYS, seasonSteps } from '../lib/season';
import { farmTypes } from '../lib/farmTypes';
import { addDays, fmtDay, todayISO, uuid } from '../lib/format';
import type { AnimalGroup, CalvingSeason, ISODate } from '../lib/types';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, DateChips, Field, NumberInput, SaveBar, Screen, Stepper, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';

const monthName = (d: ISODate) => new Intl.DateTimeFormat('en-IE', { month: 'long' }).format(new Date(`${d}T12:00:00Z`));
function defaultLabel(start: ISODate) {
  const m = Number(start.slice(5, 7));
  const season = m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Autumn';
  return `${season} calving ${start.slice(0, 4)}`;
}

/** Set up or change a calving season: the dates the plan is worked out from. */
export default function SeasonForm() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const ex = (b.seasons ?? []).find((s) => s.id === id);
  const types = farmTypes(b.farm);
  const groups = b.groups.filter((g) => !g.archived);
  const byClass = (c: string) => groups.find((g) => g.animal_class === c);
  const dryGuess = groups.find((g) => /dry/i.test(g.name));
  const calfGuess = byClass('calf');
  const milkGuess = groups.find((g) => g.animal_class === 'dairy_cow' && g.id !== dryGuess?.id);

  const [herd, setHerd] = useState<'dairy' | 'suckler'>(ex?.herd ?? (types.includes('dairy') || !types.includes('suckler') ? 'dairy' : 'suckler'));
  const [how, setHow] = useState<'due' | 'bull'>('due');
  const [start, setStart] = useState<ISODate>(ex?.calving_start ?? addDays(today, 110));
  const [bullIn, setBullIn] = useState<ISODate>(addDays(today, -170));
  const [gest, setGest] = useState<number>(herd === 'dairy' ? GESTATION_DAYS.holstein_friesian : GESTATION_DAYS.all_cattle);
  const [end, setEnd] = useState<string>(ex?.calving_end ?? '');
  const [cows, setCows] = useState<string>(ex?.cows_due != null ? String(ex.cows_due) : String((herd === 'dairy' ? milkGuess : byClass('suckler_cow'))?.head_count ?? ''));
  const [thin, setThin] = useState<string>(ex?.thin_count != null ? String(ex.thin_count) : '');
  const [dryWeeks, setDryWeeks] = useState(ex?.dry_weeks ?? 8);
  const [dryThin, setDryThin] = useState(ex?.dry_weeks_thin ?? 10);
  const [milkId, setMilkId] = useState<string | null>(ex?.milking_group_id ?? milkGuess?.id ?? null);
  const [dryId, setDryId] = useState<string | null>(ex?.dry_group_id ?? dryGuess?.id ?? null);
  const [calfId, setCalfId] = useState<string | null>(ex?.calf_group_id ?? calfGuess?.id ?? null);
  const [makeDry, setMakeDry] = useState(!ex && !dryGuess);
  const [makeCalves, setMakeCalves] = useState(!ex && !calfGuess);
  const first = how === 'bull' ? calvingFromBreeding(bullIn, gest) : start;
  const [label, setLabel] = useState(ex?.label ?? '');

  const newGroup = (name: string, cls: 'dairy_cow' | 'calf'): AnimalGroup => ({
    id: uuid(), farm_id: farmId!, name, animal_class: cls, breed: null, breeds: [], head_count: 0, head_count_updated_at: new Date().toISOString(),
    forage_t_per_head_month: null, housed: true, archived: false, sort_order: groups.length + 1
  });

  const draft: CalvingSeason = {
    id: ex?.id ?? uuid(), farm_id: farmId!, label: label.trim() || defaultLabel(first), herd, calving_start: first,
    calving_end: end && end >= first ? end : null, cows_due: cows === '' ? null : Number(cows), thin_count: herd === 'dairy' && thin !== '' ? Number(thin) : null,
    dry_weeks: dryWeeks, dry_weeks_thin: dryThin, milking_group_id: herd === 'dairy' ? milkId : null, dry_group_id: herd === 'dairy' ? dryId : null,
    calf_group_id: calfId, archived: false
  };
  const preview = seasonSteps(draft, b.decisions ?? [], today, b.farm);

  async function submit() {
    const ops: Op[] = [];
    const added: AnimalGroup[] = [];
    let row = { ...draft };
    if (herd === 'dairy' && makeDry && !dryId) {
      const g = newGroup('Dry cows', 'dairy_cow'); added.push(g); row = { ...row, dry_group_id: g.id };
      ops.push({ kind: 'insert', table: 'animal_groups', row: g as unknown as Record<string, unknown> });
    }
    if (makeCalves && !calfId) {
      const g = newGroup('Calves', 'calf'); added.push(g); row = { ...row, calf_group_id: g.id };
      ops.push({ kind: 'insert', table: 'animal_groups', row: g as unknown as Record<string, unknown> });
    }
    ops.push(ex ? { kind: 'update', table: 'calving_seasons', match: { id: row.id }, patch: row as unknown as Record<string, unknown> } : { kind: 'insert', table: 'calving_seasons', row: row as unknown as Record<string, unknown> });
    const ok = await save(ops, {
      label: ex ? 'Calving plan updated' : `${row.label} planned. First job ${fmtDay(preview[0]?.date)}`,
      patch: (x) => ({ ...x, groups: [...x.groups, ...added], seasons: ex ? (x.seasons ?? []).map((s) => (s.id === row.id ? row : s)) : [...(x.seasons ?? []), row] })
    });
    if (ok) nav('/calving', { replace: true });
  }
  async function archive() {
    const ok = await save([{ kind: 'update', table: 'calving_seasons', match: { id: ex!.id }, patch: { archived: true } }], {
      label: 'Season closed', patch: (x) => ({ ...x, seasons: (x.seasons ?? []).map((s) => (s.id === ex!.id ? { ...s, archived: true } : s)) }),
      undo: [{ kind: 'update', table: 'calving_seasons', match: { id: ex!.id }, patch: { archived: false } }]
    });
    if (ok) nav('/calving', { replace: true });
  }

  return (
    <Screen title={ex ? 'Change calving plan' : 'Plan your calving season'} back="/calving">
      <Card className="space-y-5">
        <Chips label="Which herd?" columns={2} value={herd} onChange={(h) => { setHerd(h); setGest(h === 'dairy' ? GESTATION_DAYS.holstein_friesian : GESTATION_DAYS.all_cattle); }} options={[
          { value: 'dairy', label: 'Dairy cows', sub: 'Dried off before calving' },
          { value: 'suckler', label: 'Suckler cows', sub: 'No drying off' }
        ]} />
        <Chips label="What do you know?" columns={2} value={how} onChange={setHow} options={[
          { value: 'due', label: 'When the first calf is due', sub: 'From scanning or ICBF' },
          { value: 'bull', label: 'When breeding started', sub: 'Bull in or first AI' }
        ]} />
        {how === 'due' ? <DateChips label="First calf due" value={start} onChange={setStart} allowFuture /> : (
          <div className="space-y-3">
            <DateChips label="Bull in or first AI" value={bullIn} onChange={setBullIn} />
            <Chips<string> label="Average time in calf" columns={2} value={String(gest)} onChange={(v) => setGest(Number(v))} options={[
              { value: String(GESTATION_DAYS.holstein_friesian), label: '279 days', sub: 'Holstein Friesian' },
              { value: String(GESTATION_DAYS.all_cattle), label: '283 days', sub: 'All cattle average' }
            ]} hint="ICBF's average gestation lengths (2020). Your own scanning dates are better." />
            <p className="rounded-xl bg-pasture p-3 font-bold">First calf due about {fmtDay(first)}</p>
          </div>
        )}
        <Field label="Last calf due (optional)" htmlFor="season-end" hint="Sets when the last cows are dried off.">
          <input id="season-end" type="date" className="input" value={end} min={first} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <NumberInput label="Cows due to calve" value={cows} onChange={setCows} integer hint="For tags and to track calving. Heifers included." />
        <TextInput label="Name" value={label} onChange={setLabel} placeholder={defaultLabel(first)} />
      </Card>

      {herd === 'dairy' && (
        <Card className="space-y-5">
          <h2 className="text-lg font-bold">Drying off</h2>
          <NumberInput label="Thin cows to dry off early (optional)" value={thin} onChange={setThin} integer hint="Leave blank if you haven't scored them yet: Agri-It reminds you to." />
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="Weeks dry" value={dryWeeks} min={6} onChange={setDryWeeks} unit="wk" />
            <Stepper label="Thin cows" value={dryThin} min={6} onChange={setDryThin} unit="wk" />
          </div>
          <p className="hint">Teagasc: 8 weeks for cows on target, 10 for thin cows (the standard dry period is 60 to 70 days). Change them if your vet or adviser says otherwise.</p>
          <GroupPicker b={{ ...b, groups: groups.filter((g) => g.id !== dryId) }} value={milkId} onChange={setMilkId} label="Cows are milked in" />
          {dryId || !makeDry ? (
            <GroupPicker b={{ ...b, groups: groups.filter((g) => g.id !== milkId) }} value={dryId} onChange={(v) => { setDryId(v); setMakeDry(false); }} label="Dry cows go to" />
          ) : null}
          {!dryId && (
            <label className="flex min-h-tap items-center gap-3 rounded-xl border border-line px-4">
              <input type="checkbox" className="h-6 w-6 accent-[var(--field)]" checked={makeDry} onChange={(e) => setMakeDry(e.target.checked)} />
              <span className="font-semibold">Make a "Dry cows" group</span>
            </label>
          )}
          <p className="hint">Moving cows to the dry group changes what each feed is used for, so your run-out dates update by themselves.</p>
        </Card>
      )}

      <Card className="space-y-4">
        <h2 className="text-lg font-bold">Calves</h2>
        {calfId || !makeCalves ? <GroupPicker b={b} value={calfId} onChange={(v) => { setCalfId(v); setMakeCalves(false); }} label="Calves go into" /> : null}
        {!calfId && (
          <label className="flex min-h-tap items-center gap-3 rounded-xl border border-line px-4">
            <input type="checkbox" className="h-6 w-6" checked={makeCalves} onChange={(e) => setMakeCalves(e.target.checked)} />
            <span className="font-semibold">Make a "Calves" group</span>
          </label>
        )}
      </Card>

      <Card className="space-y-2" as="div">
        <h2 className="text-lg font-bold">Your plan</h2>
        <ol className="space-y-2">
          {preview.map((s) => (
            <li key={s.key} className="flex justify-between gap-3 text-[0.9375rem]">
              <span className="font-semibold">{s.title}</span><span className="shrink-0 text-muted">{fmtDay(s.date)}{s.until ? ` to ${fmtDay(s.until)}` : ''}</span>
            </li>
          ))}
        </ol>
        <p className="hint">Each one comes up on your dashboard to approve. Nothing goes on your job list until you do. First calf {fmtDay(first)}, {monthName(first)}.</p>
      </Card>
      {ex && <Button variant="danger" block onClick={archive}>Close this season</Button>}
      <SaveBar><Button block onClick={submit} disabled={herd === 'dairy' && !milkId}>{ex ? 'Save' : 'Plan it'}</Button></SaveBar>
    </Screen>
  );
}
