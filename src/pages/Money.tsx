import { Link } from 'react-router-dom';
import { ChevronRight, FileText, Target } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { monthlyFlows, monthsBetween } from '../lib/forecast/money';
import { COST_LABEL, INCOME_LABEL } from '../lib/types';
import { addDays, eur, fmtDay, fmtMonth, monthKey } from '../lib/format';
import { Card, LinkButton, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';

export default function Money() {
  const b = useFarmData();
  const d = useDerived(b);
  const ye = d.yearEnd;
  const months = monthsBetween(monthKey(addDays(d.today, -150)), monthKey(d.today));
  const flows = monthlyFlows(b.income, b.costs, months);
  const max = Math.max(1, ...flows.flatMap((f) => [f.inflow, f.outflow]));
  const recent = [
    ...b.income.map((i) => ({ id: i.id, date: i.occurred_on, title: i.description ?? INCOME_LABEL[i.income_type], who: i.counterparty, amount: Number(i.amount_eur) })),
    ...b.costs.map((c) => ({ id: c.id, date: c.occurred_on, title: c.description ?? (c.category === 'other' ? c.other_label ?? 'Other' : COST_LABEL[c.category]), who: c.supplier_name, amount: -Number(c.amount_eur) }))
  ].filter((r) => r.date <= d.today).sort((a, c) => c.date.localeCompare(a.date)).slice(0, 12);

  return (
    <Screen title="Money" sub={`Financial year ${ye.fy.label}`}>
      <Card>
        <div className="grid grid-cols-3 gap-2">
          <div><p className="text-sm text-muted">In</p><p className="numeral text-3xl">{eur(ye.totalIncome)}</p></div>
          <div><p className="text-sm text-muted">Out</p><p className="numeral text-3xl">{eur(ye.totalCosts)}</p></div>
          <div><p className="text-sm text-muted">Net cash</p><p className={`numeral text-3xl ${ye.net < 0 ? 'text-danger' : ''}`}>{eur(ye.net)}</p></div>
        </div>
        <div className="mt-4 flex items-end gap-2" style={{ height: 120 }} role="img" aria-label="Money in and out, last six months">
          {flows.map((f) => (
            <div key={f.month} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-[96px] w-full items-end justify-center gap-0.5">
                <div className="w-1/2 rounded-t bg-field" style={{ height: `${(f.inflow / max) * 100}%` }} title={`In ${eur(f.inflow)}`} />
                <div className="w-1/2 rounded-t bg-hivis" style={{ height: `${(f.outflow / max) * 100}%` }} title={`Out ${eur(f.outflow)}`} />
              </div>
              <span className="text-xs font-bold text-muted">{fmtMonth(f.month)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 flex gap-4 text-sm"><span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-field" />In</span><span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-hivis" />Out</span></p>
      </Card>

      <List>
        <Row to="/money/year-end" icon={<FileText className="h-6 w-6 text-field" />} title="Year-end pack for your accountant"
          sub={ye.missing.length ? `${ye.missing.length} gaps to fill first` : 'No gaps flagged'} right={<ChevronRight className="h-5 w-5 text-muted" />} />
        <Row to="/money/budget" icon={<Target className="h-6 w-6 text-field" />} title="Budget" sub={b.budget.length ? 'Compare plan with actual' : 'Not set yet'} right={<ChevronRight className="h-5 w-5 text-muted" />} />
      </List>

      {d.budget.rows.length > 0 && (
        <>
          <SectionTitle>Budget so far</SectionTitle>
          <Card className="space-y-3">
            {!d.budget.adequate && <p className="rounded-xl bg-warn-bg p-3 text-warn">Some months have no records, so over-budget alerts are paused until more is entered.</p>}
            {d.budget.rows.map((r) => {
              const over = r.kind === 'cost' ? r.variance > 0 : r.variance < 0;
              return (
                <div key={r.kind + r.category}>
                  <div className="flex justify-between font-bold"><span>{r.label}</span><span>{eur(r.actual)} of {eur(r.budget)}</span></div>
                  <div className="mt-1 h-3 overflow-hidden rounded-full bg-pasture"><div className={`h-full ${over ? (r.kind === 'cost' ? 'bg-danger' : 'bg-hivis') : 'bg-field'}`} style={{ width: `${Math.min(100, (r.actual / Math.max(1, r.budget)) * 100)}%` }} /></div>
                  <p className="flex items-center gap-1 text-sm">{over && <ToneIcon tone="warn" className="h-4 w-4" />}{r.variance >= 0 ? '+' : '−'}{eur(Math.abs(r.variance))} {r.kind === 'cost' ? (r.variance > 0 ? 'over' : 'under') : (r.variance >= 0 ? 'ahead' : 'behind')}</p>
                </div>
              );
            })}
          </Card>
        </>
      )}

      {ye.supplierTotals.length > 0 && (
        <>
          <SectionTitle>Biggest payees this year</SectionTitle>
          <List>{ye.supplierTotals.slice(0, 5).map((s) => <Row key={s.name} title={s.name} right={<span className="font-bold">{eur(s.total)}</span>} />)}</List>
        </>
      )}

      <SectionTitle action={<Link to="/record/cost" className="min-h-tap px-2 py-3 font-bold text-field">Add</Link>}>Recent</SectionTitle>
      {recent.length === 0 ? (
        <Card><p className="text-muted">Nothing recorded yet.</p><div className="mt-3 flex gap-2"><LinkButton to="/record/milk" variant="secondary">Milk cheque</LinkButton><LinkButton to="/record/cost" variant="secondary">Paid a bill</LinkButton></div></Card>
      ) : (
        <List>{recent.map((r) => <Row key={r.id} title={r.title} sub={[fmtDay(r.date), r.who].filter(Boolean).join(', ')} right={<span className={`font-bold ${r.amount > 0 ? 'text-ok' : ''}`}>{r.amount > 0 ? '+' : '−'}{eur(Math.abs(r.amount))}</span>} />)}</List>
      )}
    </Screen>
  );
}
