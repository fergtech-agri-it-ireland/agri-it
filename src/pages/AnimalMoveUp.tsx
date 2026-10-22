import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { dueToMoveUp, reachingSoon, viewAll, type DueGroup } from '../lib/animalQuery';
import { planChange } from '../lib/animalBulk';
import { planMove } from '../lib/moves';
import { fmtNum, todayISO } from '../lib/format';
import { Button, Card, Empty, Field, Screen, SectionTitle } from '../components/ui';

/**
 * Animals that have grown past the group they are in (weanlings still in the Calves group): move
 * them to the group that suits them now. Optionally the head counts of the two groups follow.
 */
export default function AnimalMoveUp() {
  const b = useFarmData();
  const today = todayISO();
  const views = useMemo(() => viewAll(b, today), [b, today]);
  const due = useMemo(() => dueToMoveUp(views, b.groups), [views, b, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const soon = useMemo(() => reachingSoon(views, today, 60), [views, today]);
  const coming = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of soon) { const k = `${v.stage.plural} becoming ${v.stage.next!.label.toLowerCase()}s`; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()];
  }, [soon]);
  return (
    <Screen title="Move up a stage" back="/animals">
      {due.length === 0 ? (
        <Empty title="Nobody is due to move" body="When animals grow past the group they are in, such as weanlings still in the calves group, they are listed here." />
      ) : due.map((d) => <MoveCard key={`${d.from.id}|${d.stageKey}`} d={d} />)}
      {coming.length > 0 && (
        <>
          <SectionTitle>Coming up in the next 2 months</SectionTitle>
          <Card as="div"><ul className="space-y-1 text-[0.9375rem]">{coming.map(([k, n]) => <li key={k}><b>{fmtNum(n)}</b> {k.toLowerCase()}</li>)}</ul></Card>
        </>
      )}
      <p className="px-1 text-[0.8125rem] text-muted">Stages are worked out from the date born using the ages on the <Link to="/animals/stages" className="font-bold text-accent underline">Life stages</Link> screen.</p>
    </Screen>
  );
}

function MoveCard({ d }: { d: DueGroup }) {
  const b = useFarmData();
  const save = useSave();
  const today = todayISO();
  const n = d.views.length;
  const [toId, setToId] = useState(d.targets[0]?.id ?? '');
  const [heads, setHeads] = useState(false);
  const [busy, setBusy] = useState(false);
  const to = d.targets.find((g) => g.id === toId) ?? null;
  const count = Math.min(n, Math.max(0, Math.floor(Number(d.from.head_count ?? 0))));
  const label = n === 1 ? d.stageLabel.toLowerCase() : d.stagePlural.toLowerCase();

  async function go() {
    if (!to || busy) return;
    setBusy(true);
    const animals = d.views.map((v) => v.a);
    const plan = planChange(animals, { kind: 'group', groupId: to.id });
    const ids = new Set(animals.map((a) => a.id));
    const mv = heads && count > 0 ? planMove(b, d.from, to, count, today, today) : null;
    await save([...plan.ops, ...(mv?.ops ?? [])], {
      label: `${fmtNum(n)} ${label} moved to ${to.name}`,
      patch: (x) => { const y = { ...x, animals: x.animals.map((a) => (ids.has(a.id) ? { ...a, ...plan.patch } : a)) }; return mv ? mv.patch(y) : y; },
      undo: [...plan.undo, ...(mv?.undo ?? [])]
    });
    setBusy(false);
  }

  return (
    <Card className="space-y-3" as="article">
      <p data-testid="due-card" className="text-[1.0625rem] font-bold">{fmtNum(n)} {label} in {d.from.name}</p>
      {d.targets.length === 0 ? (
        <p className="text-[0.9375rem] text-muted">You have no group for {d.stagePlural.toLowerCase()} yet. <Link to="/farm/groups" className="font-bold text-accent underline">Add one on the group pages</Link>, then come back.</p>
      ) : (
        <>
          <Field label="Move them to" htmlFor={`to-${d.from.id}-${d.stageKey}`}>
            <select id={`to-${d.from.id}-${d.stageKey}`} className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
              {d.targets.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          {count > 0 && (
            <label className="flex items-start gap-3 text-[0.9375rem]">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={heads} onChange={(e) => setHeads(e.target.checked)} />
              <span>Also move {fmtNum(count)} head from {d.from.name} to {to?.name ?? 'the new group'} in the group head counts. This changes your feed forecasts.</span>
            </label>
          )}
          <Button block disabled={!to || busy} onClick={go}>Move {fmtNum(n)} {label}</Button>
        </>
      )}
    </Card>
  );
}
