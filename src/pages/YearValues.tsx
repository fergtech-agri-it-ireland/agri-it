import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { ANIMAL_CLASS_LABEL, VALUE_BASIS_LABEL, YEAR_VALUE_LABEL, type AnimalGroup, type FarmBundle, type ISODate, type ValueBasis, type YearEndValue, type YearValueKind } from '../lib/types';
import { fyRange } from '../lib/forecast/money';
import { headsAtEndOf } from '../lib/reports/common';
import { deemedCostPercent } from '../lib/reports/rules';
import { eur, fmtDate, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, Empty, NumberInput, Screen, SectionTitle, TextInput } from '../components/ui';

const BASES: ValueBasis[] = ['market_value', 'cost', 'deemed_cost', 'net_realisable_value', 'accountant', 'farmer_estimate'];
const BASIS_HELP: Record<ValueBasis, string> = {
  market_value: 'What it would sell for at the year end', cost: 'What it cost you', deemed_cost: 'A set share of market value, where cost cannot be worked out',
  net_realisable_value: 'Selling price less selling costs, if lower than cost', accountant: 'The figure your accountant gave you', farmer_estimate: 'Your own rough figure'
};
const OTHER_KINDS: YearValueKind[] = ['debtors', 'crops_in_store', 'machinery', 'buildings', 'land', 'other_asset'];

function previousBasis(b: FarmBundle, v: { kind: YearValueKind; animal_group_id: string | null; label: string }, asAt: ISODate): ValueBasis | null {
  const earlier = (b.yearValues ?? []).filter((x) => x.as_at < asAt && x.kind === v.kind && (v.animal_group_id ? x.animal_group_id === v.animal_group_id : x.label.toLowerCase() === v.label.toLowerCase()))
    .sort((x, y) => y.as_at.localeCompare(x.as_at))[0];
  return earlier?.basis ?? null;
}

function GroupValue({ g, asAt, existing }: { g: AnimalGroup; asAt: ISODate; existing: YearEndValue | undefined }) {
  const b = useFarmData();
  const save = useSave();
  const heads = headsAtEndOf(g, (b.headHistory ?? []).filter((h) => h.animal_group_id === g.id), asAt);
  const [count, setCount] = useState(String(existing?.head_count ?? heads));
  const [basis, setBasis] = useState<ValueBasis>(existing?.basis ?? 'market_value');
  const pct = deemedCostPercent(g.animal_class);
  const [unit, setUnit] = useState(existing ? String(basis === 'deemed_cost' ? existing.market_unit_value_eur ?? '' : existing.unit_value_eur ?? '') : '');
  const market = Number(unit);
  const perHead = basis === 'deemed_cost' && pct !== null ? Math.round(market * pct) / 100 : market;
  const total = Math.round(Number(count) * perHead * 100) / 100;
  const valid = unit !== '' && Number(count) >= 0 && count !== '' && perHead >= 0;
  const before = previousBasis(b, { kind: 'livestock', animal_group_id: g.id, label: g.name }, asAt);
  const changed = before !== null && before !== basis;
  const dirty = !existing || existing.head_count !== Number(count) || existing.basis !== basis || Number(existing.value_eur) !== total;
  const row = (): YearEndValue => ({
    id: existing?.id ?? uuid(), farm_id: b.farm.id, kind: 'livestock', as_at: asAt, label: g.name, animal_group_id: g.id, head_count: Number(count), unit_value_eur: perHead,
    value_eur: total, basis, market_unit_value_eur: basis === 'deemed_cost' ? market : null, note: existing?.note ?? null
  });
  return (
    <Card className="space-y-3">
      <div><p className="text-[1.0625rem] font-bold">{g.name}</p><p className="text-[0.8125rem] text-muted">{ANIMAL_CLASS_LABEL[g.animal_class]}. {heads} head on {fmtDate(asAt)} from your records.</p></div>
      <Chips columns={2} value={basis} onChange={setBasis} options={BASES.filter((x) => x !== 'deemed_cost' || pct !== null).map((x) => ({ value: x, label: VALUE_BASIS_LABEL[x], sub: x === 'deemed_cost' && pct !== null ? `${pct}% of market value` : undefined }))} hint={BASIS_HELP[basis]} />
      <div className="grid grid-cols-2 gap-3">
        <NumberInput label="Head" value={count} onChange={setCount} integer unit="head" />
        <NumberInput label={basis === 'deemed_cost' ? 'Market value per head' : 'Value per head'} value={unit} onChange={setUnit} />
      </div>
      {valid && <p className="rounded-xl bg-field-light px-3 py-2 font-bold text-accent">{basis === 'deemed_cost' ? `${eur(perHead, true)} a head at ${pct}%. ` : ''}Total {eur(total, true)}</p>}
      {changed && <p className="rounded-xl bg-warn-bg px-3 py-2 text-[0.9375rem]">Last year you used {VALUE_BASIS_LABEL[before!].toLowerCase()}. Accounts keep the same basis from year to year, so check with your accountant before changing it.</p>}
      <Button block disabled={!valid || !dirty} onClick={() => {
        const r = row();
        return save([existing ? { kind: 'update', table: 'year_end_values', match: { id: r.id }, patch: { head_count: r.head_count, unit_value_eur: r.unit_value_eur, value_eur: r.value_eur, basis: r.basis, market_unit_value_eur: r.market_unit_value_eur } } : { kind: 'insert', table: 'year_end_values', row: r as unknown as Record<string, unknown> }], {
          label: `${g.name} valued at ${eur(r.value_eur, true)}`,
          patch: (x) => ({ ...x, yearValues: [...(x.yearValues ?? []).filter((v) => v.id !== r.id), r] }),
          undo: existing ? [{ kind: 'update', table: 'year_end_values', match: { id: existing.id }, patch: { head_count: existing.head_count, unit_value_eur: existing.unit_value_eur, value_eur: existing.value_eur, basis: existing.basis, market_unit_value_eur: existing.market_unit_value_eur } }] : [{ kind: 'delete', table: 'year_end_values', match: { id: r.id } }]
        });
      }}>{existing ? 'Save change' : `Save ${g.name}`}</Button>
    </Card>
  );
}

function OtherValue({ v, asAt }: { v: YearEndValue; asAt: ISODate }) {
  const save = useSave();
  return (
    <Card className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="font-bold">{YEAR_VALUE_LABEL[v.kind]}: {v.label}</p><p className="text-sm text-muted">{VALUE_BASIS_LABEL[v.basis]}{v.note ? `. ${v.note}` : ''}</p></div>
      <div className="text-right"><b>{eur(Number(v.value_eur), true)}</b>
        <button type="button" className="block min-h-[2.75rem] text-sm font-bold text-danger" onClick={() => save([{ kind: 'delete', table: 'year_end_values', match: { id: v.id } }], {
          label: `${v.label} removed`, patch: (x) => ({ ...x, yearValues: (x.yearValues ?? []).filter((y) => y.id !== v.id) }),
          undo: [{ kind: 'insert', table: 'year_end_values', row: v as unknown as Record<string, unknown> }]
        })}>Remove<span className="sr-only"> {v.label} for {fmtDate(asAt)}</span></button></div>
    </Card>
  );
}

function AddOther({ asAt }: { asAt: ISODate }) {
  const b = useFarmData();
  const save = useSave();
  const [kind, setKind] = useState<YearValueKind>('debtors');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState<ValueBasis>('farmer_estimate');
  const [note, setNote] = useState('');
  const clash = (b.yearValues ?? []).some((v) => v.as_at === asAt && v.kind === kind && !v.animal_group_id && v.label.toLowerCase() === label.trim().toLowerCase());
  const valid = label.trim() !== '' && amount !== '' && Number(amount) >= 0 && !clash;
  const before = label.trim() ? previousBasis(b, { kind, animal_group_id: null, label: label.trim() }, asAt) : null;
  return (
    <Card className="space-y-3">
      <Chips columns={2} label="What is it?" value={kind} onChange={setKind} options={OTHER_KINDS.map((k) => ({ value: k, label: YEAR_VALUE_LABEL[k] }))} />
      <TextInput label="Name" value={label} onChange={setLabel} placeholder={kind === 'debtors' ? 'December milk cheque' : kind === 'machinery' ? 'Tractors and machinery' : 'What it is'} />
      <NumberInput label="Value" value={amount} onChange={setAmount} />
      <Chips columns={2} label="How was it valued?" value={basis} onChange={setBasis} options={BASES.filter((x) => x !== 'deemed_cost').map((x) => ({ value: x, label: VALUE_BASIS_LABEL[x] }))} hint={BASIS_HELP[basis]} />
      <TextInput label="Note (optional)" value={note} onChange={setNote} placeholder="Paid in January" />
      {clash && <p className="text-[0.9375rem] text-danger">There is already a {YEAR_VALUE_LABEL[kind].toLowerCase()} called "{label.trim()}" for this date. Remove it first or use another name.</p>}
      {before && before !== basis && <p className="rounded-xl bg-warn-bg px-3 py-2 text-[0.9375rem]">Last year you used {VALUE_BASIS_LABEL[before].toLowerCase()} for this. Keep the same basis unless your accountant says otherwise.</p>}
      <Button block disabled={!valid} onClick={async () => {
        const r: YearEndValue = { id: uuid(), farm_id: b.farm.id, kind, as_at: asAt, label: label.trim(), animal_group_id: null, head_count: null, unit_value_eur: null, value_eur: Math.round(Number(amount) * 100) / 100, basis, market_unit_value_eur: null, note: note.trim() || null };
        const ok = await save([{ kind: 'insert', table: 'year_end_values', row: r as unknown as Record<string, unknown> }], {
          label: `${r.label} saved at ${eur(r.value_eur, true)}`, patch: (x) => ({ ...x, yearValues: [...(x.yearValues ?? []), r] }), undo: [{ kind: 'delete', table: 'year_end_values', match: { id: r.id } }]
        });
        if (ok) { setLabel(''); setAmount(''); setNote(''); }
      }}>Save</Button>
    </Card>
  );
}

export default function YearValues() {
  const b = useFarmData();
  const today = todayISO();
  const ends = [-2, -1, 0].map((o) => ({ offset: o, ...fyRange(b.farm, today, o) }));
  const [sp] = useSearchParams();
  const initial = sp.get('year') === '-1' ? -2 : -1;
  const [asAt, setAsAt] = useState<ISODate>(ends.find((e) => e.offset === initial)!.end);
  const values = useMemo(() => (b.yearValues ?? []).filter((v) => v.as_at === asAt), [b.yearValues, asAt]);
  if (b.role === 'worker') return <Screen title="Year-end values" back="/reports"><Empty title="For the owner and family" body="Money records are not shown to farm workers." /></Screen>;
  const groups = b.groups.filter((g) => values.some((v) => v.animal_group_id === g.id) || (!g.archived && headsAtEndOf(g, (b.headHistory ?? []).filter((h) => h.animal_group_id === g.id), asAt) > 0));
  const others = values.filter((v) => v.kind !== 'livestock');
  const future = asAt > today;
  return (
    <Screen title="Year-end values" back="/reports" sub="What you or your accountant put on things">
      <Card className="border border-line"><p className="text-[0.9375rem]">Agri-It never values your animals or crops. Enter the figure you or your accountant use, and how it was worked out. Nothing counts until you tap Save. The start-of-year value for this year is last year's year-end value.</p></Card>
      <Chips columns={3} label="Value as at" value={asAt} onChange={setAsAt} options={ends.map((e) => ({ value: e.end, label: fmtDate(e.end) }))} />
      {future && <p className="rounded-xl bg-warn-bg px-3 py-2 text-[0.9375rem]">This date has not come yet. Values you save now are an estimate and the profit stays marked provisional until the year ends.</p>}
      <SectionTitle>Livestock</SectionTitle>
      {groups.length === 0 ? <Empty title="No animal groups" body="Add your groups first." /> : groups.map((g) => <GroupValue key={`${g.id}-${asAt}`} g={g} asAt={asAt} existing={values.find((v) => v.animal_group_id === g.id)} />)}
      <SectionTitle>Money owed, crops, machinery, buildings, land</SectionTitle>
      {others.map((v) => <OtherValue key={v.id} v={v} asAt={asAt} />)}
      <AddOther key={asAt} asAt={asAt} />
    </Screen>
  );
}
