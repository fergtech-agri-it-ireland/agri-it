import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Landmark, Repeat, Sprout, Target } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { yearPlan, type PlanLine, type PlanSource } from '../lib/forecast/plan';
import { fyRange } from '../lib/forecast/money';
import { eur, fmtMonthYear, todayISO } from '../lib/format';
import { Card, Chips, Explain, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';

const SOURCE_WORD: Record<PlanSource, string> = { repeat: 'repeat', loan: 'loan schedule', scheme: 'scheme date', budget: 'budget', owed: 'bill owed' };
const GROUP_WORD: Record<PlanLine['group'], string> = { receipts: 'Money in', farm: 'Farm costs', loans: 'Loans and leases', capital: 'Machinery, buildings, land', household: 'Household' };

/**
 * The year plan: Teagasc's cash flow budget, month by month, with what actually happened
 * beside it and the bank balance carried forward to show the tight months early.
 */
export default function YearPlan() {
  const b = useFarmData();
  const today = todayISO();
  const [offset, setOffset] = useState<'0' | '1'>('0');
  const [view, setView] = useState<'months' | 'lines'>('months');
  const [open, setOpen] = useState<string | null>(today.slice(0, 7));
  const p = yearPlan(b, today, Number(offset));
  const net = p.totals.plannedIn - p.totals.plannedOut;

  return (
    <Screen title="Year plan" back="/money" sub={`Cash plan, ${p.fy.label}`}>
      <Chips columns={2} value={offset} onChange={setOffset} options={[{ value: '0', label: `This year (${fyRange(b.farm, today).label})` }, { value: '1', label: `Next (${fyRange(b.farm, today, 1).label})` }]} />
      <Card>
        <div className="grid grid-cols-3 gap-2">
          <div className="amount-cell"><p className="text-sm text-muted">Planned in</p><p className="numeral amount">{eur(p.totals.plannedIn)}</p></div>
          <div className="amount-cell"><p className="text-sm text-muted">Planned out</p><p className="numeral amount">{eur(p.totals.plannedOut)}</p></div>
          <div className="amount-cell"><p className="text-sm text-muted">Difference</p><p className={`numeral amount ${net < 0 ? 'text-danger' : ''}`}>{eur(net)}</p></div>
        </div>
        {offset === '0' && <p className="mt-2 text-[0.9375rem]">So far: {eur(p.totals.actualIn)} in, {eur(p.totals.actualOut)} paid out.</p>}
        {p.low && p.low.bank !== null && (
          <p className={`mt-2 flex items-start gap-2 rounded-xl p-3 ${p.lowWarning ? 'bg-warn-bg' : 'bg-field-light'}`}>
            <ToneIcon tone={p.lowWarning ? 'warn' : 'ok'} className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              Lowest point: <b>{eur(p.low.bank)}</b> at the end of {fmtMonthYear(p.low.month)}.
              {p.lowWarning === 'past_limit' && ` That's past your ${eur(p.overdraft)} overdraft limit: talk to the bank early, or move a payment.`}
              {p.lowWarning === 'overdrawn' && (p.overdraft ? ` Within your ${eur(p.overdraft)} overdraft.` : ' Overdrawn, with no overdraft added.')}
              {offset === '1' && ' Carried on from this year\'s plan.'}
            </span>
          </p>
        )}
        <Explain>
          Laid out like Teagasc's cash flow budget: money in, farm costs, loans, household, then the bank carried forward month by month.
          Planned comes from your repeats, loan schedules, scheme dates and your budget (a budget line is left out in a month something exact already covers).
          The bank figure starts from your recorded cash today and adds what's still to come. Rule {p.ruleVersion}.
        </Explain>
      </Card>

      {p.gaps.length > 0 && (
        <List>{p.gaps.map((g) => <Row key={g.id} to={g.to} icon={<ToneIcon tone="info" />} title={g.text} right={<span className="font-bold text-accent">{g.fix}</span>} />)}</List>
      )}

      <Chips columns={2} value={view} onChange={setView} options={[{ value: 'months', label: 'By month' }, { value: 'lines', label: 'By line' }]} />

      {view === 'months' ? (
        <ul className="space-y-2">
          {p.months.map((m) => {
            const isOpen = open === m.month;
            const lines = p.lines.filter((l) => l.cells[m.month].planned || l.cells[m.month].actual);
            return (
              <li key={m.month} className="rounded-[1.125rem] bg-card shadow-lift">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.month)} className="flex min-h-[3.5rem] w-full items-center gap-3 p-4 text-left">
                  <span className="w-20 shrink-0 font-bold">{fmtMonthYear(m.month)}{m.status === 'now' && <span className="block text-xs font-semibold text-accent">This month</span>}</span>
                  <span className="min-w-0 flex-1 text-[0.9375rem]">
                    <span className="block">{m.status === 'past' ? `${eur(m.actualIn)} in, ${eur(m.actualOut)} out` : `${eur(m.plannedIn)} in, ${eur(m.plannedOut)} out`}</span>
                    {m.bank !== null && <span className={`block text-sm ${m.bank < 0 ? 'text-danger' : 'text-muted'}`}>Bank {eur(m.bank)} {m.bankBasis === 'projected' ? '(plan)' : '(recorded)'}</span>}
                  </span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {isOpen && (
                  <div className="border-t border-line px-4 pb-3 pt-2">
                    {lines.length === 0 ? <p className="text-muted">Nothing planned or recorded.</p> : (
                      <table className="w-full text-[0.9375rem]">
                        <thead><tr className="text-left text-sm text-muted"><th className="py-1 font-semibold">Line</th><th className="text-right font-semibold">Plan</th><th className="text-right font-semibold">Actual</th></tr></thead>
                        <tbody>
                          {lines.map((l) => {
                            const c = l.cells[m.month];
                            return (
                              <tr key={l.key} className="border-t border-line align-top">
                                <td className="py-1.5 pr-2">{l.kind === 'in' ? '+ ' : '− '}{l.label}{c.sources.length > 0 && <span className="block text-xs text-muted">{c.sources.map((s) => SOURCE_WORD[s]).join(', ')}</span>}</td>
                                <td className="py-1.5 text-right">{c.planned ? eur(c.planned) : ''}</td>
                                <td className="py-1.5 text-right font-semibold">{c.actual ? eur(c.actual) : m.status === 'ahead' ? '' : '0'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        (['receipts', 'farm', 'loans', 'capital', 'household'] as const).map((g) => {
          const lines = p.lines.filter((l) => l.group === g);
          if (!lines.length) return null;
          return (
            <div key={g}>
              <SectionTitle>{GROUP_WORD[g]}</SectionTitle>
              <Card className="space-y-2">
                {lines.map((l) => {
                  const diff = l.actual - l.planned;
                  return (
                    <div key={l.key} className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{l.label}</span>
                      <span className="text-right text-[0.9375rem]">{eur(l.actual)} of {eur(l.planned)}
                        {offset === '0' && l.planned > 0 && <span className={`block text-sm ${(l.kind === 'out' ? diff > 0 : diff < 0) ? 'text-danger' : 'text-muted'}`}>{diff >= 0 ? '+' : '−'}{eur(Math.abs(diff))} so far</span>}
                      </span>
                    </div>
                  );
                })}
              </Card>
            </div>
          );
        })
      )}

      <SectionTitle>Change the plan</SectionTitle>
      <List>
        <Row to="/money/budget" icon={<Target className="h-6 w-6 text-accent" />} title="Budget, month by month" sub="Milk, sales, feed, fertiliser and the rest" right={<ChevronRight className="h-5 w-5 text-muted" />} />
        <Row to="/money/payments" icon={<Sprout className="h-6 w-6 text-accent" />} title="Scheme payments" sub="BISS, Eco, ANC, ACRES and others on their dates" right={<ChevronRight className="h-5 w-5 text-muted" />} />
        <Row to="/money/loans" icon={<Landmark className="h-6 w-6 text-accent" />} title="Loans and overdraft" sub="Repayments, interest and the limit" right={<ChevronRight className="h-5 w-5 text-muted" />} />
        <Row to="/routines" icon={<Repeat className="h-6 w-6 text-accent" />} title="Regular bills and income" sub="Repeats you tick off" right={<ChevronRight className="h-5 w-5 text-muted" />} />
      </List>
      <p className="px-1 text-sm text-muted">A plan, not a promise: it's only as good as what's in it. Nothing here is advice. <Link className="underline" to="/money/year-end">Year-end pack</Link></p>
    </Screen>
  );
}
