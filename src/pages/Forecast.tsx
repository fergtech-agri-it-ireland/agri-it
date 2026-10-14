import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { useDerived, silageWithFedOut } from '../lib/data/derived';
import { forecastForage, silageSummary } from '../lib/forecast/forage';
import { cashForecast90, reconcileCash } from '../lib/forecast/money';
import { eur, fmtDay, fmtMonth, fmtNum, todayISO, cur } from '../lib/format';
import { primaryRoute } from '../lib/suppliers';
import { Button, Card, ConfidenceBadge, Explain, LinkButton, NumberInput, Screen, Stepper, ToneIcon } from '../components/ui';
import { FeedGauge } from '../components/FeedGauge';

type Tab = 'feed' | 'forage' | 'cash';

export default function Forecast() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'feed';
  return (
    <Screen title="Progress">
      <div role="tablist" aria-label="Progress" className="flex rounded-full bg-track p-1 text-sm font-bold">
        {([['feed', 'Feed'], ['forage', 'Silage'], ['cash', 'Cash']] as const).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setParams({ tab: t }, { replace: true })}
            className={`min-h-[2.25rem] flex-1 rounded-full ${tab === t ? 'bg-card text-ink shadow-lift' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      {tab === 'feed' && <FeedTab />}
      {tab === 'forage' && <ForageTab />}
      {tab === 'cash' && <CashTab />}
    </Screen>
  );
}

function FeedTab() {
  const b = useFarmData();
  const d = useDerived(b);
  const list = b.products.filter((p) => !p.archived);
  return (
    <>
      {list.map((p) => <FeedGauge key={p.id} product={p} f={d.feed.get(p.id)!} phone={primaryRoute(b.suppliers.find((s) => s.id === p.supplier_id), b)?.phone} />)}
      <LinkButton to="/feed/new" variant="secondary" block>Add a feed</LinkButton>
      <p className="px-1 text-sm text-muted">Run-out dates are arithmetic from your own feeding plan. They are not feeding advice.</p>
    </>
  );
}

function ForageTab() {
  const b = useFarmData();
  const d = useDerived(b);
  const [scenario, setScenario] = useState(false);
  const [reserve, setReserve] = useState(b.farm.forage_reserve_percent);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const f = scenario
    ? forecastForage({
        farm: b.farm, stores: silageWithFedOut(b), benchmarks: b.benchmarks, evidence: b.evidence, today: todayISO(), reserveOverride: reserve, scenario: true,
        groups: b.groups.map((g) => ({ ...g, head_count: Math.max(0, g.head_count + (extra[g.id] ?? 0)) }))
      })
    : d.forage;
  const sum = silageSummary(f);
  const headline = { deficit: 'Short for the winter', tight: 'Tight: reserve not fully covered', surplus: 'Covered, with reserve', incomplete: 'Needs more detail' }[f.status];
  const tone = f.status === 'deficit' ? 'urgent' : f.status === 'tight' ? 'warn' : f.status === 'surplus' ? 'ok' : 'info';
  const src = b.evidence.find((e) => e.code === 'S3');

  return (
    <>
      <Card>
        <div className="flex items-center gap-2"><ToneIcon tone={tone} /><p className="text-xl font-bold">{headline}</p></div>
        {sum ? (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="amount-cell"><p className="numeral amount [--amount-max:1.875rem]">{fmtNum(sum.storeT)}</p><p className="text-sm text-muted">t in store</p></div>
              <div className="amount-cell"><p className="numeral amount [--amount-max:1.875rem]">{fmtNum(sum.winterNeedT)}</p><p className="text-sm text-muted">t for the winter</p></div>
              <div className="amount-cell"><p className="numeral amount [--amount-max:1.875rem]">{fmtNum(sum.reserveT)}</p><p className="text-sm text-muted">t reserve ({f.reservePercent}%)</p></div>
            </div>
            <p className="mt-3 font-bold">{sum.line}.</p>
            <p className="mt-1 text-sm text-muted">{fmtNum(sum.storeT)} in store against {fmtNum(sum.winterNeedT)} + {fmtNum(sum.reserveT)} reserve = {fmtNum(sum.targetT)} t. {sum.percentOfWinter}% of the winter covered.</p>
          </>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div><p className="numeral text-3xl">{fmtNum(Math.round(f.availableT))}</p><p className="text-sm text-muted">t in store</p></div>
            <div><p className="numeral text-3xl">?</p><p className="text-sm text-muted">t for the winter</p></div>
            <div><p className="numeral text-3xl">?</p><p className="text-sm text-muted">t reserve</p></div>
          </div>
        )}
        <div className="mt-3"><ConfidenceBadge level={f.confidence} /></div>
      </Card>

      {f.missing.length > 0 && (
        <Card className="border-2 border-warn/40">
          <p className="font-bold">To firm this up, add:</p>
          <ul className="mt-1 list-disc pl-5">{f.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {(f.stores.length === 0 || f.stores.some((x) => x.missing)) && <LinkButton to="/farm/silage" variant="secondary">Silage stores</LinkButton>}
            {f.groups.some((g) => g.source === 'missing') && <LinkButton to="/farm/groups" variant="secondary">Group usage</LinkButton>}
            {f.monthsToCover === null && <LinkButton to="/settings" variant="secondary">Housing dates</LinkButton>}
          </div>
        </Card>
      )}

      <Card>
        <label className="flex min-h-tap items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6 accent-field" checked={scenario} onChange={(e) => setScenario(e.target.checked)} />
          What if? (doesn't change your records)
        </label>
        {scenario && (
          <div className="mt-3 space-y-4">
            <Stepper label="Reserve" value={reserve} step={5} onChange={setReserve} unit="%" hint="Teagasc suggests carrying roughly 15 to 20% extra for bad weather (S3)." />
            {b.groups.filter((g) => !g.archived && g.housed).map((g) => (
              <Stepper key={g.id} label={`${g.name}: change in head`} value={extra[g.id] ?? 0} min={-g.head_count} step={5} onChange={(n) => setExtra({ ...extra, [g.id]: n })} />
            ))}
          </div>
        )}
      </Card>

      <Explain>
        <p className="font-bold">In store</p>
        {f.stores.map((s) => <p key={s.id}>{s.name}: {s.tonnes !== null ? `${fmtNum(Math.round(s.tonnes))} t` : 'missing'} {s.explanation && `(${s.explanation})`}</p>)}
        <p className="pt-2 font-bold">Demand per month</p>
        {f.groups.map((g) => <p key={g.id}>{g.name}: {g.heads} × {g.tPerHeadMonth ?? '?'} t = {fmtNum(Math.round(g.tPerMonth))} t a month{g.months !== null ? ` for ${g.months.toFixed(1)} months (${g.inNow ? 'in now' : g.inFrom ? `in from ${fmtDay(g.inFrom)}` : 'no date to come in'})` : ''}. Source: {g.sourceLabel}</p>)}
        <p className="pt-2">Winter: {fmtDay(f.winterStart)} to {fmtDay(f.winterEnd)} ({f.monthsToCover !== null ? fmtNum(f.monthsToCover) : '?'} months) × {fmtNum(Math.round(f.demandTPerMonth))} t/month, plus {f.reservePercent}% reserve.</p>
        {f.reasons.map((r) => <p key={r} className="text-muted">{r}</p>)}
        {src && <p className="pt-2 text-sm">Published allowances: <a className="underline" href={src.url} target="_blank" rel="noreferrer">{src.publisher}, {src.title}</a>. Recheck your budget at housing: stock numbers, intakes and weather change.</p>}
      </Explain>
    </>
  );
}

const NO_WHAT_IF = (today: string) => ({ incomePct: 0, costPct: 0, oneOff: 0, oneOffOn: today });

function CashTab() {
  const b = useFarmData();
  const d = useDerived(b);
  const [whatIf, setWhatIf] = useState(() => NO_WHAT_IF(d.today));
  if (!d.cash) {
    return (
      <Card>
        <p className="font-bold">Add your bank balance</p>
        <p className="text-muted">Read the balance your bank shows now. Agri-It adds the income and takes away the bills you record from tomorrow on.</p>
        <BankCheck recorded={null} open />
      </Card>
    );
  }
  const plan = whatIf.incomePct || whatIf.costPct || whatIf.oneOff ? cashForecast90(b.farm, b.income, b.costs, b.budget, d.today, { incomePct: whatIf.incomePct, costPct: whatIf.costPct, oneOffEur: whatIf.oneOff, oneOffOn: whatIf.oneOffOn }, b.routines) : d.cash90;
  const max = Math.max(1, ...plan.rows.map((r) => Math.abs(r.closing)), Math.abs(d.cash.balance));
  return (
    <>
      <Card>
        <p className="text-muted">Recorded cash</p>
        <p className="numeral text-5xl">{eur(d.cash.balance)}</p>
        <p className="text-sm text-muted">Not your bank balance: {eur(d.cash.opening)} from the bank {d.cash.openingDate > d.today ? 'at the end of today' : `on ${fmtDay(d.cash.openingDate)}`}, plus what you've recorded since. Bills count when they're paid.</p>
        <p className={`mt-2 text-[0.9375rem] font-bold ${d.cashGaps.stale ? 'text-warn' : ''}`}>{checkedLine(d.cashGaps.daysSinceCheck)}</p>
        {d.money.owedTotal > 0 && <p className="mt-1 text-[0.9375rem]"><Link to="/money/bills" className="font-bold text-accent underline">{eur(d.money.owedTotal)} of bills owed</Link> come off in the forecast below, on their due dates{d.money.undatedCount || d.money.overdueCount ? ' (overdue or undated ones this month)' : ''}.</p>}
        <BankCheck recorded={d.cash.balance} />
      </Card>
      {d.cashGaps.gaps.filter((g) => g.id !== 'no-balance' && g.id !== 'stale').length > 0 && (
        <Card className="border-2 border-warn/40">
          <p className="font-bold">What the forecast can't see</p>
          <p className="text-sm text-muted">Agri-It only knows what you record. These are likely missing, so the real figure may be lower or higher.</p>
          <ul className="mt-2 space-y-2">
            {d.cashGaps.gaps.filter((g) => g.id !== 'no-balance' && g.id !== 'stale').map((g) => (
              <li key={g.id} className="text-[0.9375rem]">{g.text} {<Link to={g.to} className="font-bold text-accent underline">{g.fix}</Link>}</li>
            ))}
          </ul>
        </Card>
      )}
      <Card className={plan.scenario ? 'border-2 border-hivis' : ''}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-bold">Next 90 days</p>
          {plan.scenario && <ConfidenceBadge level="scenario" />}
        </div>
        <div className="space-y-3">
          {plan.rows.map((r) => (
            <div key={r.month}>
              <div className="flex justify-between font-bold"><span>{fmtMonth(r.month)}</span><span>{eur(r.closing)}</span></div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-pasture">
                <div className={`h-full ${r.closing < 0 ? 'bg-danger' : 'bg-field'}`} style={{ width: `${(Math.abs(r.closing) / max) * 100}%` }} />
              </div>
              <p className="text-sm text-muted">
                {flowLine(r) || 'Nothing known or budgeted'}
              </p>
            </div>
          ))}
        </div>
        {!d.cash90.hasBudget && <p className="mt-3 text-sm">Only items you've entered with future dates and bills owed are included. <Link className="underline" to="/money/budget">Add a budget</Link> to project regular income and costs.</p>}
        {d.money.committedTotal > 0 && <p className="mt-2 text-sm text-muted">Not counted: {eur(d.money.committedTotal)} on order. It becomes a bill when it is delivered.</p>}
      </Card>
      <Card className="space-y-3">
        <p className="font-bold">What if?</p>
        <p className="text-sm text-muted">Try a change without recording anything. Shown as a scenario, never as the forecast.</p>
        <Stepper label="Income (milk price, sales)" value={whatIf.incomePct} min={-50} step={5} onChange={(n) => setWhatIf({ ...whatIf, incomePct: n })} unit="%" />
        <Stepper label="Costs (feed, fertiliser, bills)" value={whatIf.costPct} min={-50} step={5} onChange={(n) => setWhatIf({ ...whatIf, costPct: n })} unit="%" />
        <Stepper label="A one-off spend" value={whatIf.oneOff} step={1000} onChange={(n) => setWhatIf({ ...whatIf, oneOff: n })} unit={cur()} />
        {whatIf.oneOff > 0 && <label className="block"><span className="label">On</span><input type="date" className="input" value={whatIf.oneOffOn} min={d.today} onChange={(e) => setWhatIf({ ...whatIf, oneOffOn: e.target.value })} /></label>}
        {plan.scenario && plan.lowest && <p className="font-bold">{plan.lowest.closing < 0 ? `Goes overdrawn: about ${eur(plan.lowest.closing)} by the end of ${fmtMonth(plan.lowest.month)}` : `Lowest about ${eur(plan.lowest.closing)} in ${fmtMonth(plan.lowest.month)}`}</p>}
        {plan.scenario && <button className="min-h-tap text-sm font-bold text-accent" onClick={() => setWhatIf(NO_WHAT_IF(d.today))}>Back to the forecast</button>}
      </Card>
      <Explain>
        <p>Closing balance = recorded cash + known future items (bills owed, entries with a later date) + your repeats (Routines) + budget amounts for anything not already entered.</p>
        <p>Recorded cash is not a bank balance. Check it against the bank now and then: the difference is something not recorded, or not yet through the bank.</p>
        <p>Known items and budget assumptions are always shown separately.</p>
      </Explain>
    </>
  );
}

function checkedLine(days: number | null): string {
  if (days === null) return 'Never checked against the bank.';
  if (days === 0) return 'Checked against the bank today.';
  return `Last checked against the bank ${days === 1 ? 'yesterday' : `${days} days ago`}.${days > 30 ? ' Check it again: anything not recorded since is missing.' : ''}`;
}

/**
 * Check against the bank (review G02): the farmer types what the bank shows now. Agri-It
 * keeps it as the balance at the end of today and says how far the recorded figure was out.
 */
function BankCheck({ recorded, open = false }: { recorded: number | null; open?: boolean }) {
  const b = useFarmData();
  const save = useSave();
  const [editing, setEditing] = useState(open);
  const [bank, setBank] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const today = todayISO();
  const go = async () => {
    const r = reconcileCash(recorded, Number(bank), today);
    const patch = { opening_cash_eur: r.opening_cash_eur, opening_cash_date: r.opening_cash_date };
    const ok = await save([{ kind: 'update', table: 'farms', match: { id: b.farm.id }, patch }], { label: 'Bank balance saved', patch: (x) => ({ ...x, farm: { ...x.farm, ...patch } }) });
    if (!ok) return;
    setEditing(open);
    setBank('');
    const diff = r.difference;
    setResult(diff === null ? 'Saved. Cash is tracked from here.'
      : Math.abs(diff) < 1 ? 'Matches what you recorded.'
      : diff > 0 ? `Your bank has ${eur(diff)} more than recorded: income not recorded, or a bill recorded as paid that hasn't gone through yet.`
      : `Your bank has ${eur(-diff)} less than recorded: a payment not recorded, or income recorded that hasn't arrived yet.`);
  };
  if (!editing) {
    return (
      <>
        <Button variant="secondary" block className="mt-3" onClick={() => { setEditing(true); setResult(null); }}>Check against the bank</Button>
        {result && <p className="mt-2 font-bold" role="status">{result}</p>}
      </>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <NumberInput label="What your bank shows now" value={bank} onChange={setBank} unit={cur()} autoFocus={!open}
        hint="Anything you've already recorded for today is taken as in this figure." />
      <div className={open ? '' : 'grid grid-cols-2 gap-2'}>
        {!open && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
        <Button variant="primary" block={open} disabled={bank === '' || Number.isNaN(Number(bank))} onClick={go}>Save balance</Button>
      </div>
      {result && <p className="font-bold" role="status">{result}</p>}
    </div>
  );
}

/** "Known: +€X / −€Y (bills owed €Z). Repeats: ... Budget: ..." leaving out parts that are nothing. */
function flowLine(r: { knownIn: number; knownOut: number; owedOut: number; regularIn: number; regularOut: number; assumedIn: number; assumedOut: number }): string {
  const pair = (i: number, o: number) => [i > 0 ? `+${eur(i)}` : '', o > 0 ? `−\u2060${eur(o)}` : ''].filter(Boolean).join(' / ');
  const parts: string[] = [];
  if (r.knownIn > 0 || r.knownOut > 0) parts.push(`Known: ${pair(r.knownIn, r.knownOut)}${r.owedOut > 0 ? ` (bills owed ${eur(r.owedOut)})` : ''}`);
  if (r.regularIn > 0 || r.regularOut > 0) parts.push(`Repeats: ${pair(r.regularIn, r.regularOut)}`);
  if (r.assumedIn > 0 || r.assumedOut > 0) parts.push(`Budget: ${pair(r.assumedIn, r.assumedOut)}`);
  return parts.join('. ');
}
