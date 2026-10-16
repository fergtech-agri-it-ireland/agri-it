import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { COST_LABEL, INCOME_LABEL, type BudgetLine, type CostCategory, type IncomeType } from '../lib/types';
import { cur, eur, fmtMonth, monthKey, todayISO, uuid } from '../lib/format';
import { fyRange, monthsBetween } from '../lib/forecast/money';
import { paidOn } from '../lib/forecast/bills';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, SaveBar, Screen, SectionTitle } from '../components/ui';

const LINES: { kind: 'income' | 'cost'; category: string; label: string }[] = [
  ...(['milk', 'livestock', 'crop', 'grant', 'other'] as IncomeType[]).map((c) => ({ kind: 'income' as const, category: c, label: INCOME_LABEL[c] })),
  ...(Object.keys(COST_LABEL) as CostCategory[]).map((c) => ({ kind: 'cost' as const, category: c, label: COST_LABEL[c] }))
];
const keyOf = (kind: string, cat: string) => `${kind}:${cat}`;

/**
 * The budget for the financial year, line by line and month by month (16 Oct 2026).
 * Teagasc: start with what you know, use last year's pattern for the rest. "Fill from last
 * year" copies what was actually recorded in each month of the year before; the farmer
 * changes anything. Lines that loans, repeats or scheme payments already plan are said so.
 */
export default function Budget() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const today = todayISO();
  const [offset, setOffset] = useState<'0' | '1'>('0');
  const fy = fyRange(b.farm, today, Number(offset));
  const months = monthsBetween(monthKey(fy.start), monthKey(fy.end));
  const ym = (m: string) => [Number(m.slice(0, 4)), Number(m.slice(5, 7))] as const;
  const initial = useMemo(() => {
    const v: Record<string, Record<string, string>> = {};
    for (const l of LINES) {
      v[keyOf(l.kind, l.category)] = Object.fromEntries(months.map((m) => {
        const [y, mm] = ym(m);
        const row = b.budget.filter((x) => x.kind === l.kind && x.category === l.category && x.year === y && x.month === mm).reduce((t, x) => t + Number(x.amount_eur), 0);
        return [m, row ? String(Math.round(row)) : ''];
      }));
    }
    return v;
  }, [b.budget, fy.start]); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState(initial);
  const [shownFor, setShownFor] = useState(fy.start);
  if (shownFor !== fy.start) { setValues(initial); setShownFor(fy.start); }
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<'income' | 'cost'>('income');

  const loansPlanned = (b.loans ?? []).some((l) => !l.archived && l.kind !== 'overdraft' && l.repayment_eur);
  const schemesPlanned = (b.expected ?? []).some((e) => e.expected_on >= fy.start && e.expected_on <= fy.end);
  const repeats = new Set(b.routines.filter((r) => r.active && Number(r.amount) > 0 && (r.kind === 'income' || r.kind === 'expense')).map((r) => keyOf(r.kind === 'income' ? 'income' : 'cost', String(r.category))));
  const covered = (l: { kind: string; category: string }) =>
    l.kind === 'cost' && l.category === 'loan_repayment' && loansPlanned ? 'Planned from your loans' :
    l.kind === 'income' && l.category === 'grant' && schemesPlanned ? 'Scheme payments are planned on their dates; add other grants here' :
    repeats.has(keyOf(l.kind, l.category)) ? 'A repeat plans this; a budget figure is only used in months it doesn\'t cover' : null;

  const lineTotal = (k: string) => months.reduce((t, m) => t + Number(values[k]?.[m] || 0), 0);
  const kindTotal = (kd: string) => LINES.filter((l) => l.kind === kd).reduce((t, l) => t + lineTotal(keyOf(l.kind, l.category)), 0);
  const setMonth = (k: string, m: string, v: string) => setValues({ ...values, [k]: { ...values[k], [m]: v } });
  const setAll = (k: string, v: string) => setValues({ ...values, [k]: Object.fromEntries(months.map((m) => [m, v])) });

  /** Last year's recorded money, by month: income on its date, costs when paid. */
  function fillFromLastYear() {
    const last = fyRange(b.farm, today, Number(offset) - 1);
    const shift = (d: string) => { const y = Number(d.slice(0, 4)) + 1; return `${y}-${d.slice(5, 7)}`; };
    const next: typeof values = {};
    for (const l of LINES) {
      const k = keyOf(l.kind, l.category);
      const sums: Record<string, number> = {};
      if (l.kind === 'income') for (const i of b.income) { if (i.income_type === l.category && i.occurred_on >= last.start && i.occurred_on <= last.end) sums[shift(i.occurred_on)] = (sums[shift(i.occurred_on)] ?? 0) + Number(i.amount_eur); }
      else for (const c of b.costs) { const p = paidOn(c); if (c.category === l.category && p && p >= last.start && p <= last.end) sums[shift(p)] = (sums[shift(p)] ?? 0) + Number(c.amount_eur); }
      next[k] = Object.fromEntries(months.map((m) => [m, sums[m] ? String(Math.round(sums[m])) : values[k]?.[m] ?? '']));
    }
    setValues(next);
  }
  const lastYearHas = (() => {
    const last = fyRange(b.farm, today, Number(offset) - 1);
    return b.income.some((i) => i.occurred_on >= last.start && i.occurred_on <= last.end) || b.costs.some((c) => c.occurred_on >= last.start && c.occurred_on <= last.end);
  })();

  async function submit() {
    const ops: Op[] = [];
    const set = new Set(months.map((m) => { const [y, mm] = ym(m); return `${y}-${mm}`; }));
    const keep = b.budget.filter((x) => !(x.month != null && set.has(`${x.year}-${x.month}`)));
    const next: BudgetLine[] = [...keep];
    for (const l of LINES) {
      for (const m of months) {
        const [y, mm] = ym(m);
        ops.push({ kind: 'delete', table: 'budget_lines', match: { farm_id: farmId, year: y, month: mm, kind: l.kind, category: l.category } });
        const v = values[keyOf(l.kind, l.category)]?.[m];
        if (v && Number(v) > 0) {
          const row = { id: uuid(), farm_id: farmId!, year: y, month: mm, kind: l.kind, category: l.category, amount_eur: Number(v) };
          ops.push({ kind: 'insert', table: 'budget_lines', row });
          next.push(row);
        }
      }
    }
    await save(ops, { label: 'Budget saved', patch: (x) => ({ ...x, budget: next }) });
  }

  return (
    <Screen title={`Budget ${fy.label}`} back="/money/plan" sub="Month by month. Feeds the year plan and the alerts.">
      <Chips columns={2} value={offset} onChange={setOffset} options={[{ value: '0', label: `This year (${fyRange(b.farm, today).label})` }, { value: '1', label: 'Next year' }]} />
      {lastYearHas && <Button variant="secondary" block onClick={fillFromLastYear}>Fill from last year's records</Button>}
      <Chips columns={2} value={kind} onChange={setKind} options={[{ value: 'income', label: `Money in ${eur(kindTotal('income'))}` }, { value: 'cost', label: `Money out ${eur(kindTotal('cost'))}` }]} />
      <SectionTitle>{kind === 'income' ? 'Money in' : 'Money out'}</SectionTitle>
      <ul className="space-y-2">
        {LINES.filter((l) => l.kind === kind).map((l) => {
          const k = keyOf(l.kind, l.category);
          const isOpen = open === k;
          const note = covered(l);
          const vals = months.map((m) => values[k]?.[m] ?? '');
          const same = vals.every((v) => v === vals[0]) ? vals[0] : '';
          return (
            <li key={k} className="rounded-[1.125rem] bg-card shadow-lift">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k)} className="flex min-h-[3.5rem] w-full items-center gap-3 p-4 text-left">
                <span className="min-w-0 flex-1"><span className="block font-bold">{l.label}</span>{note && <span className="block text-sm text-muted">{note}</span>}</span>
                <span className="font-bold">{eur(lineTotal(k))}</span>
                <ChevronDown className={`h-5 w-5 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
                  <label className="block">
                    <span className="label">Same every month</span>
                    <div className="relative"><input className="input pr-12 font-semibold" type="number" inputMode="decimal" value={same} placeholder="Type to set all 12" onChange={(e) => setAll(k, e.target.value)} />
                      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-bold text-muted">{cur()}</span></div>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {months.map((m) => (
                      <label key={m} className="block">
                        <span className="text-sm font-semibold text-muted">{fmtMonth(m)}</span>
                        <input className="input !min-h-[2.75rem] px-2 text-center font-semibold" type="number" inputMode="decimal" aria-label={`${l.label} ${fmtMonth(m)}`} value={values[k]?.[m] ?? ''} onChange={(e) => setMonth(k, m, e.target.value)} />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Card><p className="font-bold">Planned difference: {eur(kindTotal('income') - kindTotal('cost'))}</p><p className="text-sm text-muted">Budget only. The <Link className="underline" to="/money/plan">year plan</Link> adds loans, repeats and scheme payments on their dates.</p></Card>
      <SaveBar><Button block onClick={submit}>Save budget</Button></SaveBar>
    </Screen>
  );
}
