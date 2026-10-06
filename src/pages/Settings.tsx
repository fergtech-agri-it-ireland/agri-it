import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { supabase } from '../lib/supabase';
import { COUNTIES_NI, COUNTIES_ROI, type Farm } from '../lib/types';
import { todayISO } from '../lib/format';
import { Button, Card, Chips, DateChips, Field, NumberInput, Screen, SectionTitle, Stepper, TextInput } from '../components/ui';
import { useTheme, type DawnPref } from '../lib/theme';
import { useDerived } from '../lib/data/derived';
import { RemindersCard } from '../components/Reminders';

export default function Settings() {
  const b = useFarmData();
  const { session, farms, farmId, selectFarm } = useFarmCtx();
  const save = useSave();
  const f = b.farm;
  const [name, setName] = useState(f.name);
  const [county, setCounty] = useState(f.county);
  const [eircode, setEircode] = useState(f.eircode ?? '');
  const [cash, setCash] = useState(f.opening_cash_eur !== null ? String(f.opening_cash_eur) : '');
  const [cashDate, setCashDate] = useState(f.opening_cash_date ?? todayISO());
  const [fyMonth, setFyMonth] = useState(String(f.financial_year_start_month));
  const [knowLead, setKnowLead] = useState(f.default_lead_time_days !== null);
  const [lead, setLead] = useState(f.default_lead_time_days ?? 3);
  const [reserve, setReserve] = useState(f.forage_reserve_percent);
  const [housing, setHousing] = useState(f.housing_start ?? '');
  const [turnout, setTurnout] = useState(f.turnout_date ?? '');
  const [feedTarget, setFeedTarget] = useState(f.feed_target_days ?? 30);
  const theme = useTheme();
  const d = useDerived(b);
  const urgent = useMemo(() => d.priorities.filter((p) => p.tone === 'urgent').map((p) => p.title), [d.priorities]);
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get('section') === 'reminders') document.getElementById('reminders')?.scrollIntoView({ block: 'start' });
  }, [params]);

  async function submit() {
    const patch: Partial<Farm> = {
      name, county, eircode: eircode || null, opening_cash_eur: cash === '' ? null : Number(cash), opening_cash_date: cash === '' ? null : cashDate,
      financial_year_start_month: Number(fyMonth), default_lead_time_days: knowLead ? lead : null, forage_reserve_percent: reserve,
      housing_start: housing || null, turnout_date: turnout || null, feed_target_days: feedTarget
    };
    await save([{ kind: 'update', table: 'farms', match: { id: f.id }, patch }], { label: 'Settings saved', patch: (x) => ({ ...x, farm: { ...x.farm, ...patch } }) });
  }

  return (
    <Screen title="Settings" back="/farm">
      <SectionTitle>Screen</SectionTitle>
      <Card className="space-y-4">
        <Chips<DawnPref> label="Dawn mode (dark screen)" columns={3} value={theme.dawnPref} onChange={theme.setDawnPref}
          options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }, { value: 'auto', label: 'Auto', sub: 'Before 8am, after 8pm' }]}
          hint="Easier on the eyes in the parlour before light. Only changes this phone." />
        <label className="flex min-h-tap items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6 accent-field" checked={theme.sunlight} onChange={(e) => theme.setSunlight(e.target.checked)} />
          Sunlight mode (maximum contrast outdoors)
        </label>
      </Card>

      <div id="reminders" className="scroll-mt-20"><SectionTitle>Reminders</SectionTitle></div>
      <RemindersCard b={b} urgentToday={urgent} />

      <SectionTitle>Farm</SectionTitle>
      <Card className="space-y-4">
        <TextInput label="Farm name" value={name} onChange={setName} />
        <Field label="County" htmlFor="c"><select id="c" className="input" value={county} onChange={(e) => setCounty(e.target.value)}>{(f.jurisdiction === 'ROI' ? COUNTIES_ROI : COUNTIES_NI).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <TextInput label={f.jurisdiction === 'ROI' ? 'Eircode' : 'Postcode'} value={eircode} onChange={(v) => setEircode(v.toUpperCase())} />
      </Card>

      <SectionTitle>Money</SectionTitle>
      <Card className="space-y-4">
        <NumberInput label="Bank balance on a known date" value={cash} onChange={setCash} unit="€" hint="Agri-It adds recorded income and takes away costs from this date." />
        {cash !== '' && <DateChips label="Balance was on" value={cashDate} onChange={setCashDate} />}
        <Field label="Financial year starts" htmlFor="fy">
          <select id="fy" className="input" value={fyMonth} onChange={(e) => setFyMonth(e.target.value)}>
            {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
      </Card>

      <SectionTitle>Feed and winter</SectionTitle>
      <Card className="space-y-4">
        <label className="flex min-h-tap items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6 accent-field" checked={knowLead} onChange={(e) => setKnowLead(e.target.checked)} />
          Default delivery time for feed
        </label>
        {knowLead && <Stepper label="Days from order to delivery" value={lead} onChange={setLead} unit="days" hint="Used when a feed or supplier has no lead time of its own." />}
        <Stepper label="Feed you like to have in hand" value={feedTarget} step={5} min={1} onChange={setFeedTarget} unit="days" hint="Fills the Feed dial on Today. Your own comfort level, not a recommendation." />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Housing from" htmlFor="h"><input id="h" type="date" className="input" value={housing} onChange={(e) => setHousing(e.target.value)} /></Field>
          <Field label="Turnout" htmlFor="t"><input id="t" type="date" className="input" value={turnout} onChange={(e) => setTurnout(e.target.value)} /></Field>
        </div>
        <Stepper label="Silage reserve" value={reserve} step={5} onChange={setReserve} unit="%" hint="Teagasc suggests roughly 15 to 20% extra for a bad spring (S3)." />
      </Card>
      <Button block onClick={submit}>Save settings</Button>

      {farms.length > 1 && (
        <>
          <SectionTitle>Switch farm</SectionTitle>
          <Chips columns={2} value={farmId} onChange={selectFarm} options={farms.map((x) => ({ value: x.id, label: x.name }))} />
        </>
      )}
      <Card>
        <p className="text-sm text-muted">Signed in as {session?.user.email}. Your records are private to your farm. Nothing is shared unless you add someone to the farm.</p>
        <Button variant="secondary" block className="mt-3" onClick={() => { localStorage.removeItem('agri-it:cache'); supabase.auth.signOut(); }}>Sign out</Button>
      </Card>
    </Screen>
  );
}
