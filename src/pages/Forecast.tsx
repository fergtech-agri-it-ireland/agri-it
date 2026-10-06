import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFarmData } from '../lib/data/farm';
import { useDerived, silageWithFedOut } from '../lib/data/derived';
import { forecastForage } from '../lib/forecast/forage';
import { eur, fmtDay, fmtMonth, fmtNum, todayISO } from '../lib/format';
import { primaryRoute } from '../lib/suppliers';
import { Card, Chips, ConfidenceBadge, Explain, LinkButton, Screen, Stepper, ToneIcon } from '../components/ui';
import { FeedGauge } from '../components/FeedGauge';

type Tab = 'feed' | 'forage' | 'cash';

export default function Forecast() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'feed';
  return (
    <Screen title="Forecast">
      <Chips columns={3} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })}
        options={[{ value: 'feed', label: 'Feed' }, { value: 'forage', label: 'Silage' }, { value: 'cash', label: 'Cash' }]} />
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
  const headline = { deficit: 'Short for the winter', tight: 'Tight: reserve not fully covered', surplus: 'Covered, with reserve', incomplete: 'Needs more detail' }[f.status];
  const tone = f.status === 'deficit' ? 'urgent' : f.status === 'tight' ? 'warn' : f.status === 'surplus' ? 'ok' : 'info';
  const src = b.evidence.find((e) => e.code === 'S3');

  return (
    <>
      <Card>
        <div className="flex items-center gap-2"><ToneIcon tone={tone} /><p className="text-xl font-bold">{headline}</p></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><p className="numeral text-3xl">{fmtNum(Math.round(f.availableT))}</p><p className="text-sm text-muted">t in store</p></div>
          <div><p className="numeral text-3xl">{f.needWithReserveT !== null ? fmtNum(Math.round(f.needWithReserveT)) : '?'}</p><p className="text-sm text-muted">t needed incl. {f.reservePercent}%</p></div>
          <div><p className="numeral text-3xl">{f.balanceT !== null ? (f.balanceT >= 0 ? '+' : '') + fmtNum(Math.round(f.balanceT)) : '?'}</p><p className="text-sm text-muted">t balance</p></div>
        </div>
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
        {f.groups.map((g) => <p key={g.id}>{g.name}: {g.heads} × {g.tPerHeadMonth ?? '?'} t = {fmtNum(Math.round(g.tPerMonth))} t. Source: {g.sourceLabel}</p>)}
        <p className="pt-2">Winter: {fmtDay(f.winterStart)} to {fmtDay(f.winterEnd)} ({f.monthsToCover !== null ? fmtNum(f.monthsToCover) : '?'} months) × {fmtNum(Math.round(f.demandTPerMonth))} t/month, plus {f.reservePercent}% reserve.</p>
        {f.reasons.map((r) => <p key={r} className="text-muted">{r}</p>)}
        {src && <p className="pt-2 text-sm">Published allowances: <a className="underline" href={src.url} target="_blank" rel="noreferrer">{src.publisher}, {src.title}</a>. Recheck your budget at housing: stock numbers, intakes and weather change.</p>}
      </Explain>
    </>
  );
}

function CashTab() {
  const b = useFarmData();
  const d = useDerived(b);
  if (!d.cash) {
    return (
      <Card>
        <p className="font-bold">Add your bank balance</p>
        <p className="text-muted">Enter the balance on a recent date. Agri-It adds your recorded income and takes away costs from there.</p>
        <LinkButton to="/settings" className="mt-3" variant="hivis">Add opening balance</LinkButton>
      </Card>
    );
  }
  const max = Math.max(1, ...d.cash90.rows.map((r) => Math.abs(r.closing)), Math.abs(d.cash.balance));
  return (
    <>
      <Card>
        <p className="text-muted">Recorded cash now</p>
        <p className="numeral text-5xl">{eur(d.cash.balance)}</p>
        <p className="text-sm text-muted">From {eur(d.cash.opening)} on {fmtDay(d.cash.openingDate)}. Not a bank statement.</p>
      </Card>
      <Card>
        <p className="mb-3 font-bold">Next 90 days</p>
        <div className="space-y-3">
          {d.cash90.rows.map((r) => (
            <div key={r.month}>
              <div className="flex justify-between font-bold"><span>{fmtMonth(r.month)}</span><span>{eur(r.closing)}</span></div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-pasture">
                <div className={`h-full ${r.closing < 0 ? 'bg-danger' : 'bg-field'}`} style={{ width: `${(Math.abs(r.closing) / max) * 100}%` }} />
              </div>
              <p className="text-sm text-muted">
                Known: +{eur(r.knownIn)} / −{eur(r.knownOut)}
                {(r.assumedIn > 0 || r.assumedOut > 0) && <>. Budget: +{eur(r.assumedIn)} / −{eur(r.assumedOut)}</>}
              </p>
            </div>
          ))}
        </div>
        {!d.cash90.hasBudget && <p className="mt-3 text-sm">Only items you've entered with future dates are included. <Link className="underline" to="/money/budget">Add a budget</Link> to project regular income and costs.</p>}
      </Card>
      <Explain>
        <p>Closing balance = recorded cash now + known future items + budget amounts for months where nothing is entered yet.</p>
        <p>Known items and budget assumptions are always shown separately.</p>
      </Explain>
    </>
  );
}
