import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { ExpectedIncome, Income } from '../lib/types';
import { cur, eur, fmtDay, todayISO, uuid } from '../lib/format';
import { stillExpected } from '../lib/schemes';
import { Button, Card, Field, List, NumberInput, Row, Screen, SectionTitle, Sheet, TextInput } from '../components/ui';
import { SchemePlanner } from '../components/SchemePlanner';

/**
 * Scheme payments: what's expected and when, and what has come in. A payment becomes income
 * only when the farmer says it arrived, with the amount that actually came.
 */
export default function Payments() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const expected = stillExpected(b.expected ?? []);
  const received = (b.expected ?? []).filter((e) => e.income_id).sort((a, c) => c.expected_on.localeCompare(a.expected_on));
  const [adding, setAdding] = useState<'scheme' | 'other' | null>(null);
  const [busy, setBusy] = useState(false);
  const came = expected.find((e) => e.id === params.get('id')) ?? null;
  const [amount, setAmount] = useState('');
  const [on, setOn] = useState(today);
  const [label, setLabel] = useState('');
  const [otherAmount, setOtherAmount] = useState('');
  const [otherOn, setOtherOn] = useState('');

  function open(e: ExpectedIncome) { setAmount(String(e.amount_eur)); setOn(today); setParams({ id: e.id }); }
  async function arrived() {
    if (!came) return;
    setBusy(true);
    const income: Income = {
      id: uuid(), farm_id: farmId!, income_type: 'grant', occurred_on: on, amount_eur: Number(amount), counterparty: b.farm.jurisdiction === 'NI' ? 'DAERA' : 'Department of Agriculture',
      milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: came.label, document_id: null, enterprise: null
    };
    const ok = await save([
      { kind: 'insert', table: 'income', row: income as unknown as Record<string, unknown> },
      { kind: 'update', table: 'expected_income', match: { id: came.id }, patch: { income_id: income.id } }
    ], { label: `${came.label} recorded`, patch: (x) => ({ ...x, income: [income, ...x.income], expected: (x.expected ?? []).map((y) => (y.id === came.id ? { ...y, income_id: income.id } : y)) }) });
    setBusy(false);
    if (ok) setParams({});
  }
  async function remove(e: ExpectedIncome) {
    await save([{ kind: 'delete', table: 'expected_income', match: { id: e.id } }], { label: 'Taken off the plan', patch: (x) => ({ ...x, expected: (x.expected ?? []).filter((y) => y.id !== e.id) }),
      undo: [{ kind: 'insert', table: 'expected_income', row: e as unknown as Record<string, unknown> }] });
    setParams({});
  }
  async function plan(rows: ExpectedIncome[]) {
    setBusy(true);
    const ok = await save(rows.map((r) => ({ kind: 'insert' as const, table: 'expected_income', row: r as unknown as Record<string, unknown> })), { label: `${rows.length} payment${rows.length === 1 ? '' : 's'} planned`, patch: (x) => ({ ...x, expected: [...(x.expected ?? []), ...rows] }) });
    setBusy(false);
    if (ok) setAdding(null);
  }
  async function planOther() {
    const row: ExpectedIncome = { id: uuid(), farm_id: farmId!, scheme: 'other', label: label.trim(), scheme_year: Number(otherOn.slice(0, 4)), part: 'full', amount_eur: Number(otherAmount), expected_on: otherOn, rule: null, income_id: null };
    await plan([row]);
    setLabel(''); setOtherAmount(''); setOtherOn('');
  }

  return (
    <Screen title="Scheme payments" back="/money" sub="Expected, and what came in">
      <Card className="text-[0.9375rem]">
        <p>Payments are placed on the Department's published dates (DAERA in Northern Ireland). They start then and run for a few weeks once a claim is cleared. <b>Nothing counts as income until you say it came in.</b></p>
      </Card>
      <SectionTitle>Expected</SectionTitle>
      {expected.length ? (
        <List>
          {expected.map((e) => (
            <Row key={e.id} title={e.label} sub={`${e.expected_on <= today ? 'Due from' : 'From'} ${fmtDay(e.expected_on)}${e.rule ? '' : ' (your date)'}`}
              right={<button onClick={() => open(e)} className="min-h-tap rounded-full px-3 font-bold text-accent">{eur(Number(e.amount_eur))}</button>} />
          ))}
        </List>
      ) : <Card><p className="text-muted">Nothing expected yet.</p></Card>}

      {!adding && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setAdding('scheme')}>Add a scheme</Button>
          <Button variant="secondary" onClick={() => setAdding('other')}>Something else</Button>
        </div>
      )}
      {adding === 'scheme' && <Card><SchemePlanner b={b} onSave={plan} busy={busy} /><Button variant="ghost" block className="mt-2" onClick={() => setAdding(null)}>Cancel</Button></Card>}
      {adding === 'other' && (
        <Card className="space-y-4">
          <TextInput label="What is it?" value={label} onChange={setLabel} placeholder="e.g. TAMS grant, forestry premium" />
          <NumberInput label="Amount expected" unit={cur()} value={otherAmount} onChange={setOtherAmount} />
          <Field label="When do you expect it?" htmlFor="other-on" hint="Your own date: Agri-It has no published date for this.">
            <input id="other-on" type="date" className="input" value={otherOn} onChange={(e) => setOtherOn(e.target.value)} />
          </Field>
          <div className="flex gap-2"><Button variant="secondary" onClick={() => setAdding(null)}>Cancel</Button><Button block disabled={!label.trim() || !(Number(otherAmount) > 0) || !otherOn || busy} onClick={planOther}>Add to the plan</Button></div>
        </Card>
      )}

      {received.length > 0 && (
        <>
          <SectionTitle>Came in</SectionTitle>
          <List>{received.map((e) => {
            const inc = b.income.find((i) => i.id === e.income_id);
            return <Row key={e.id} title={e.label} sub={inc ? `${fmtDay(inc.occurred_on)}` : undefined} right={<b>{eur(Number(inc?.amount_eur ?? e.amount_eur))}</b>} />;
          })}</List>
        </>
      )}

      <Sheet open={!!came} onClose={() => setParams({})} title={came ? `Did the ${came.label} come in?` : ''}>
        {came && (
          <div className="space-y-4">
            <NumberInput label="Amount that came in" unit={cur()} value={amount} onChange={setAmount} hint={`${eur(Number(came.amount_eur))} was expected. Use what your bank shows.`} />
            <Field label="Came in on" htmlFor="came-on"><input id="came-on" type="date" className="input" max={today} value={on} onChange={(e) => setOn(e.target.value)} /></Field>
            <Button block disabled={!(Number(amount) > 0) || busy} onClick={arrived}>Yes, record it</Button>
            <Button variant="danger" block onClick={() => remove(came)}>Not getting it: take it off</Button>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
