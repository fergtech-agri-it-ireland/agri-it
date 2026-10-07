import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { nextDue, scheduleLabel } from '../lib/routines';
import { COST_LABEL, INCOME_LABEL, ROUTINE_KIND_LABEL, type CostCategory, type IncomeType, type Routine, type RoutineFrequency, type RoutineKind } from '../lib/types';
import { fmtDay, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, Empty, Field, LinkButton, NumberInput, SaveBar, Screen, Stepper, TextInput } from '../components/ui';
import { FeedPicker, QuantityInput, SupplierPicker } from '../components/pickers';

const KIND_OPTIONS: { value: RoutineKind; label: string; sub: string }[] = [
  { value: 'expense', label: 'Bill', sub: 'Loan, ESB, rent, contractor' },
  { value: 'income', label: 'Income', sub: 'Milk cheque, scheme payment' },
  { value: 'job', label: 'Job', sub: 'Check troughs, wash filter' },
  { value: 'count', label: 'Stock count', sub: 'Dip a bin, count bags' },
  { value: 'order', label: 'Feed order', sub: 'Standing order of meal' },
  { value: 'silage', label: 'Silage feed-out', sub: 'Tonnes fed from a pit' }
];
const DEFAULT_TITLE: Record<RoutineKind, string> = { expense: '', income: '', job: '', count: 'Dip the bin', order: 'Feed order', silage: 'Feed out silage' };
const WEEKDAYS: { value: string; label: string }[] = [
  { value: '1', label: 'Mon' }, { value: '2', label: 'Tue' }, { value: '3', label: 'Wed' }, { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' }, { value: '6', label: 'Sat' }, { value: '0', label: 'Sun' }
];

export default function RoutineForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const existing = id ? b.routines.find((r) => r.id === id) : undefined;
  const t0 = new Date(today + 'T00:00:00Z');

  const [kind, setKind] = useState<RoutineKind>(existing?.kind ?? (params.get('kind') as RoutineKind) ?? 'expense');
  const [title, setTitle] = useState(existing?.title ?? DEFAULT_TITLE[(params.get('kind') as RoutineKind) ?? 'expense'] ?? '');
  const [frequency, setFrequency] = useState<RoutineFrequency>(existing?.frequency ?? 'monthly');
  const [weekday, setWeekday] = useState(String(existing?.weekday ?? t0.getUTCDay()));
  const [dom, setDom] = useState(existing?.day_of_month ?? t0.getUTCDate());
  const [every, setEvery] = useState(existing?.interval_days ?? 21);
  const [start, setStart] = useState(existing?.start_date ?? today);
  const [end, setEnd] = useState(existing?.end_date ?? '');
  const [amount, setAmount] = useState(existing?.amount !== null && existing?.amount !== undefined ? String(existing.amount) : '');
  const [unit, setUnit] = useState<'kg' | 't'>('t');
  const [category, setCategory] = useState<string | null>(existing?.category ?? null);
  const [counterparty, setCounterparty] = useState(existing?.counterparty ?? '');
  const [feedId, setFeedId] = useState<string | null>(existing?.feed_product_id ?? (b.products.filter((p) => !p.archived).length === 1 ? b.products[0].id : null));
  const [storeId, setStoreId] = useState<string | null>(existing?.silage_store_id ?? b.silage[0]?.id ?? null);
  const [supplierId, setSupplierId] = useState<string | null>(existing?.supplier_id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (id && !existing) return <Screen title="Routine" back="/routines"><Empty title="Routine not found" action={<LinkButton to="/routines">All routines</LinkButton>} /></Screen>;

  function pickKind(k: RoutineKind) {
    setKind(k);
    if (!title || Object.values(DEFAULT_TITLE).includes(title)) setTitle(DEFAULT_TITLE[k]);
    setCategory(null);
    if (k === 'silage' || k === 'count') setFrequency(k === 'silage' ? 'daily' : 'weekly');
  }

  const draft: Omit<Routine, 'id' | 'created_at'> = {
    farm_id: farmId!, kind, title: title.trim() || (category ? (kind === 'expense' ? COST_LABEL[category as CostCategory] : INCOME_LABEL[category as IncomeType]) : ROUTINE_KIND_LABEL[kind]),
    frequency, interval_days: frequency === 'every_n_days' ? every : null, weekday: frequency === 'weekly' ? Number(weekday) : null,
    day_of_month: frequency === 'monthly' ? dom : null, start_date: start, end_date: end || null,
    amount: amount === '' ? null : Number(amount), category: kind === 'expense' || kind === 'income' ? category : null,
    counterparty: kind === 'expense' || kind === 'income' ? counterparty || null : null,
    feed_product_id: kind === 'count' || kind === 'order' ? feedId : null, silage_store_id: kind === 'silage' ? storeId : null,
    supplier_id: kind === 'order' ? supplierId : null, active: existing?.active ?? true
  };
  const next = nextDue({ ...draft, active: true }, today < start ? start : today);
  const valid = (kind !== 'expense' && kind !== 'income' || !!category) && (kind !== 'count' && kind !== 'order' || !!feedId) && (kind !== 'silage' || !!storeId)
    && (kind !== 'job' || !!title.trim()) && (!end || end >= start);

  async function submit() {
    const rid = existing?.id ?? uuid();
    const ok = await save(
      existing ? [{ kind: 'update', table: 'routines', match: { id: rid }, patch: draft }] : [{ kind: 'insert', table: 'routines', row: { id: rid, ...draft } }],
      {
        label: existing ? 'Routine saved' : `Routine added. ${next ? `First in the diary ${next === today ? 'today' : fmtDay(next)}` : ''}`,
        patch: (x) => ({ ...x, routines: existing ? x.routines.map((r) => (r.id === rid ? { ...r, ...draft } : r)) : [...x.routines, { id: rid, ...draft, created_at: new Date().toISOString() }] }),
        undo: existing ? undefined : [{ kind: 'delete', table: 'routines', match: { id: rid } }]
      }
    );
    if (ok) nav('/routines', { replace: true });
  }
  async function setActive(active: boolean) {
    await save([{ kind: 'update', table: 'routines', match: { id: existing!.id }, patch: { active } }], {
      label: active ? 'Routine back on' : 'Routine paused. History is kept',
      patch: (x) => ({ ...x, routines: x.routines.map((r) => (r.id === existing!.id ? { ...r, active } : r)) })
    });
  }
  async function remove() {
    const ok = await save([{ kind: 'delete', table: 'routines', match: { id: existing!.id } }], {
      label: 'Routine deleted. Records it created are kept',
      patch: (x) => ({ ...x, routines: x.routines.filter((r) => r.id !== existing!.id), completions: x.completions.filter((c) => c.routine_id !== existing!.id) })
    });
    if (ok) nav('/routines', { replace: true });
  }

  const amountLabel = kind === 'expense' ? 'Usual amount' : kind === 'income' ? 'Expected amount' : kind === 'silage' ? 'Tonnes each time' : '';
  return (
    <Screen title={existing ? existing.title : 'New routine'} back="/routines">
      <Card className="space-y-5">
        {!existing && <Chips<RoutineKind> label="What repeats?" columns={2} value={kind} onChange={pickKind} options={KIND_OPTIONS} />}

        {kind === 'expense' && (
          <Chips<string> label="What for?" columns={2} value={category} onChange={setCategory}
            options={(Object.keys(COST_LABEL) as CostCategory[]).map((c) => ({ value: c, label: COST_LABEL[c] }))}
            hint={category === 'feed' ? 'For meal deliveries use a Feed order routine, so stock is tracked too.' : undefined} />
        )}
        {kind === 'income' && (
          <Chips<string> label="What kind?" columns={2} value={category} onChange={setCategory}
            options={(Object.keys(INCOME_LABEL) as IncomeType[]).map((c) => ({ value: c, label: INCOME_LABEL[c] }))} />
        )}
        <TextInput label={kind === 'job' ? 'What needs doing?' : 'Name'} value={title} onChange={setTitle} voice
          placeholder={kind === 'job' ? 'e.g. Check water troughs' : kind === 'expense' ? 'e.g. Loan repayment' : kind === 'income' ? 'e.g. Milk cheque' : ''} />
        {(kind === 'expense' || kind === 'income') && (
          <>
            <TextInput label={kind === 'expense' ? 'Paid to' : 'From'} value={counterparty} onChange={setCounterparty} placeholder={kind === 'expense' ? 'e.g. Bank' : 'e.g. Tirlán'} />
            <NumberInput label={amountLabel} value={amount} onChange={setAmount} unit="€" hint="Leave blank if it changes each time. You'll enter it when you tick it off." />
          </>
        )}
        {(kind === 'count' || kind === 'order') && <FeedPicker b={b} value={feedId} onChange={(v) => { setFeedId(v); setSupplierId(b.products.find((p) => p.id === v)?.supplier_id ?? null); }} />}
        {kind === 'order' && (
          <>
            <QuantityInput label="How much each time?" kg={amount} onKg={setAmount} unit={unit} onUnit={setUnit} hint="Ticking it off records an open order. Stock only goes up when you confirm the delivery." />
            <SupplierPicker b={b} value={supplierId} onChange={setSupplierId} />
          </>
        )}
        {kind === 'silage' && (
          b.silage.length === 0
            ? <Empty title="Add your silage first" action={<LinkButton to="/farm/silage/new">Add silage</LinkButton>} />
            : <>
                <Chips<string> label="From which store?" columns={2} value={storeId} onChange={setStoreId} options={b.silage.map((s) => ({ value: s.id, label: s.name }))} />
                <NumberInput label={amountLabel} value={amount} onChange={setAmount} unit="t" hint="Your usual amount. Change it when you tick off if it was different." />
              </>
        )}
      </Card>

      <Card className="space-y-5">
        <Chips<RoutineFrequency> label="How often?" columns={2} value={frequency} onChange={setFrequency} options={[
          { value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' },
          { value: 'monthly', label: 'Every month' }, { value: 'every_n_days', label: 'Every few days' }
        ]} />
        {frequency === 'weekly' && <Chips<string> label="On" columns={undefined} value={weekday} onChange={setWeekday} options={WEEKDAYS} />}
        {frequency === 'monthly' && <Stepper label="Day of the month" value={dom} min={1} onChange={(n) => setDom(Math.min(31, Math.max(1, n)))} hint="31 means the last day in shorter months." />}
        {frequency === 'every_n_days' && <Stepper label="Every how many days?" value={every} min={2} onChange={(n) => setEvery(Math.max(2, n))} unit="days" />}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Starts" htmlFor="rs"><input id="rs" type="date" className="input" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></Field>
          <Field label="Ends (optional)" htmlFor="re"><input id="re" type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="rounded-xl bg-field-light px-3 py-2.5 font-bold text-accent">
          {scheduleLabel(draft)}. {next ? (next === today ? 'Shows in the diary today.' : `First in the diary ${fmtDay(next)}.`) : 'No dates in range.'}
        </p>
      </Card>

      {existing && (
        <div className="grid gap-2">
          <Button variant="secondary" block onClick={() => setActive(!existing.active)}>{existing.active ? 'Pause this routine' : 'Turn back on'}</Button>
          {confirmDelete
            ? <Button variant="danger" block onClick={remove}>Delete for good. Records it made are kept</Button>
            : <Button variant="ghost" block onClick={() => setConfirmDelete(true)}>Delete routine</Button>}
        </div>
      )}
      <SaveBar><Button block disabled={!valid} onClick={submit}>{existing ? 'Save routine' : 'Add routine'}</Button></SaveBar>
    </Screen>
  );
}
