import { useState } from 'react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { COST_LABEL, INCOME_LABEL, type BudgetLine, type CostCategory, type IncomeType } from '../lib/types';
import { eur, todayISO, uuid } from '../lib/format';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, NumberInput, SaveBar, Screen, SectionTitle } from '../components/ui';

const LINES: { kind: 'income' | 'cost'; category: string; label: string }[] = [
  ...(['milk', 'livestock', 'grant', 'other'] as IncomeType[]).map((c) => ({ kind: 'income' as const, category: c, label: INCOME_LABEL[c] })),
  ...(Object.keys(COST_LABEL) as CostCategory[]).map((c) => ({ kind: 'cost' as const, category: c, label: COST_LABEL[c] }))
];

/** A simple monthly budget: one figure per line, spread across the year. Teagasc: plan annually. */
export default function Budget() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const year = Number(todayISO().slice(0, 4));
  const current = (kind: string, cat: string) => {
    const l = b.budget.filter((x) => x.year === year && x.kind === kind && x.category === cat && x.month !== null);
    return l.length ? String(Math.round(l.reduce((s, x) => s + Number(x.amount_eur), 0) / l.length)) : '';
  };
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(LINES.map((l) => [`${l.kind}:${l.category}`, current(l.kind, l.category)])));
  const total = (kind: string) => LINES.filter((l) => l.kind === kind).reduce((s, l) => s + Number(values[`${l.kind}:${l.category}`] || 0) * 12, 0);

  async function submit() {
    const ops: Op[] = [];
    const next: BudgetLine[] = b.budget.filter((x) => x.year !== year);
    for (const l of LINES) {
      const v = values[`${l.kind}:${l.category}`];
      ops.push({ kind: 'delete', table: 'budget_lines', match: { farm_id: farmId, year, kind: l.kind, category: l.category } });
      if (v && Number(v) > 0) {
        for (let m = 1; m <= 12; m++) {
          const row = { id: uuid(), farm_id: farmId!, year, month: m, kind: l.kind, category: l.category, amount_eur: Number(v) };
          ops.push({ kind: 'insert', table: 'budget_lines', row });
          next.push(row);
        }
      }
    }
    await save(ops, { label: 'Budget saved', patch: (x) => ({ ...x, budget: next }) });
  }

  return (
    <Screen title={`Budget ${year}`} back="/money" sub="Monthly amounts. Used for alerts and the cash forecast.">
      {(['income', 'cost'] as const).map((kind) => (
        <div key={kind} className="space-y-3">
          <SectionTitle>{kind === 'income' ? 'Income per month' : 'Costs per month'}</SectionTitle>
          <Card className="space-y-4">
            {LINES.filter((l) => l.kind === kind).map((l) => (
              <NumberInput key={l.category} label={l.label} unit="€" value={values[`${l.kind}:${l.category}`]} onChange={(v) => setValues({ ...values, [`${l.kind}:${l.category}`]: v })} />
            ))}
            <p className="font-bold">Year: {eur(total(kind))}</p>
          </Card>
        </div>
      ))}
      <Card><p className="font-bold">Planned surplus: {eur(total('income') - total('cost'))}</p></Card>
      <SaveBar><Button block onClick={submit}>Save budget</Button></SaveBar>
    </Screen>
  );
}
