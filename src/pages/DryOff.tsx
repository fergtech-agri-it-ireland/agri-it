import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { feedImpact, planMove } from '../lib/moves';
import { stepDecisionKey } from '../lib/season';
import { decisionOp } from '../lib/suggestions';
import { headsOn } from '../lib/heads';
import { fmtDay, fmtKg, todayISO } from '../lib/format';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, DateChips, Empty, LinkButton, SaveBar, Screen, Stepper } from '../components/ui';
import { GroupPicker } from '../components/pickers';

/**
 * Dry off a batch of cows: one move from the milking group to the dry group. The feed forecasts
 * follow by themselves, because each feed's use is worked out from the groups it is fed to.
 */
export default function DryOff() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const today = todayISO();
  const season = (b.seasons ?? []).find((s) => s.id === params.get('season')) ?? (b.seasons ?? []).find((s) => !s.archived && s.herd === 'dairy');
  const batch = params.get('batch') === 'thin' ? 'thin' : 'main';
  const [fromId, setFromId] = useState<string | null>(season?.milking_group_id ?? null);
  const [toId, setToId] = useState<string | null>(season?.dry_group_id ?? null);
  const from = b.groups.find((g) => g.id === fromId);
  const to = b.groups.find((g) => g.id === toId);
  const [on, setOn] = useState(today);
  const fromN = from ? headsOn(from, on, b.headHistory.filter((h) => h.animal_group_id === from.id)) : 0;
  const [n, setN] = useState<number>(batch === 'thin' ? season?.thin_count || 1 : fromN || 1);
  const [finished, setFinished] = useState(batch === 'thin');
  const plan = useMemo(() => (from && to && n > 0 && n <= fromN ? planMove(b, from, to, n, on, today) : null), [b, from, to, n, on, today, fromN]);
  const impact = useMemo(() => (plan ? feedImpact(b, plan.patch, today) : []), [b, plan, today]);

  if (!season) return <Screen title="Dry off cows" back="/calving"><Empty title="Plan your calving season first" action={<LinkButton to="/calving/season/new">Plan it</LinkButton>} /></Screen>;
  const allOut = n === fromN;

  async function submit() {
    if (!plan || !from || !to) return;
    const ops: Op[] = [...plan.ops];
    let patch = plan.patch;
    if (finished || allOut) {
      const { op, row } = decisionOp(farmId!, stepDecisionKey(season!.id, batch === 'thin' ? 'dry_thin' : 'dry_main'), 'done', today);
      ops.push(op);
      const p0 = patch;
      patch = (x) => ({ ...p0(x), decisions: [...(x.decisions ?? []), row] });
    }
    const ok = await save(ops, { label: `${n} dried off on ${fmtDay(on)}. Feed forecasts updated`, patch, undo: plan.undo, undoLabel: 'Moved back' });
    if (ok) nav('/calving', { replace: true });
  }

  return (
    <Screen title={batch === 'thin' ? 'Dry off thin cows' : 'Dry off cows'} back="/calving">
      <Card className="space-y-5">
        <GroupPicker b={{ ...b, groups: b.groups.filter((g) => !g.archived && g.id !== toId) }} value={fromId} onChange={setFromId} label="From (milking)" />
        <GroupPicker b={{ ...b, groups: b.groups.filter((g) => !g.archived && g.id !== fromId) }} value={toId} onChange={setToId} label="To (dry)" />
        <Stepper label="How many cows?" value={n} min={1} onChange={setN} unit="cows" hint={from ? `${fromN} in ${from.name} on that day` : undefined} />
        <DateChips label="Dried off on" value={on} onChange={setOn} allowFuture />
        {from && n > fromN && <p role="alert" className="font-bold text-danger">{from.name} only has {fromN} cows on that day.</p>}
        {!allOut && (
          <label className="flex min-h-tap items-center gap-3 rounded-xl border border-line px-4">
            <input type="checkbox" className="h-6 w-6" checked={finished} onChange={(e) => setFinished(e.target.checked)} />
            <span className="font-semibold">That's {batch === 'thin' ? 'all the thin cows' : 'the last of them'}: take it off my list</span>
          </label>
        )}
      </Card>
      {plan && (
        <Card className="space-y-2" as="div">
          <h2 className="text-lg font-bold">What this changes</h2>
          <p>{from!.name} {fromN} → {fromN - n}. {to!.name} → {headsOn(to!, on, b.headHistory.filter((h) => h.animal_group_id === to!.id)) + n}.</p>
          {impact.length ? impact.map((i) => (
            <p key={i.productId} data-testid="feed-impact"><b>{i.name}:</b> {fmtKg(i.beforeKg)} → {fmtKg(i.afterKg)} a day{i.beforeRunOut !== i.afterRunOut ? `. Runs out ${i.afterRunOut ? fmtDay(i.afterRunOut) : 'later than your plan shows'} instead of ${fmtDay(i.beforeRunOut)}` : ''}.</p>
          )) : <p className="text-muted">No feed plan changes: neither group has a feeding plan that differs.</p>}
          <p className="hint">Worked out from your feeding plans. Agri-It doesn't set dry cow feeding: change the plan for {to!.name} if your feeding changes.</p>
        </Card>
      )}
      <SaveBar><Button block onClick={submit} disabled={!plan}>Dry off {n}</Button></SaveBar>
    </Screen>
  );
}
