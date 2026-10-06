import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { FeedingRule } from '../lib/types';
import { addDays, fmtKg, todayISO, uuid } from '../lib/format';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, DateChips, Empty, LinkButton, SaveBar, Screen, Stepper, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';

/**
 * A rule = group × heads × kg/head/feed × feeds/day. Changing the rate of an
 * ongoing rule closes the old one yesterday and starts a new one today, so
 * past stock calculations stay exactly as they were.
 */
export default function FeedingRuleForm() {
  const { id, ruleId } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const product = b.products.find((p) => p.id === id);
  const existing = b.rules.find((r) => r.id === ruleId);
  const [groupId, setGroupId] = useState<string | null>(existing?.animal_group_id ?? null);
  const [useGroupCount, setUseGroupCount] = useState(existing ? existing.head_count_override === null : true);
  const [heads, setHeads] = useState<number>(existing?.head_count_override ?? 0);
  const [kg, setKg] = useState<number>(existing ? Number(existing.kg_per_head_per_feed) : 1);
  const [feeds, setFeeds] = useState<string>(String(existing ? Number(existing.feeds_per_day) : 2));
  const [temporary, setTemporary] = useState(existing?.is_temporary ?? false);
  const [start, setStart] = useState(existing?.start_date && existing.start_date > today ? existing.start_date : today);
  const [end, setEnd] = useState(existing?.end_date ?? addDays(today, 14));
  const [label, setLabel] = useState(existing?.label ?? '');

  if (!product) return <Screen title="Feeding plan" back><Empty title="Feed not found" /></Screen>;
  if (b.groups.filter((g) => !g.archived).length === 0) {
    return <Screen title="Feeding plan" back><Empty title="Add an animal group first" body="Feeding plans are per group, e.g. 120 dairy cows." action={<LinkButton to="/farm/groups">Add groups</LinkButton>} /></Screen>;
  }
  const group = b.groups.find((g) => g.id === groupId);
  const effHeads = useGroupCount ? group?.head_count ?? 0 : heads;
  const daily = effHeads * kg * Number(feeds);

  async function submit() {
    const base = {
      farm_id: farmId, feed_product_id: product!.id, animal_group_id: groupId, head_count_override: useGroupCount ? null : heads,
      kg_per_head_per_feed: kg, feeds_per_day: Number(feeds), is_temporary: temporary, label: label || null,
      end_date: temporary ? end : null
    };
    const ops: Op[] = [];
    let patchRules = (rs: FeedingRule[]) => rs;
    if (existing && existing.start_date < today && !temporary && !existing.is_temporary) {
      // New rate from today; keep history intact
      const newId = uuid();
      ops.push({ kind: 'update', table: 'feeding_rules', match: { id: existing.id }, patch: { end_date: addDays(today, -1) } });
      ops.push({ kind: 'insert', table: 'feeding_rules', row: { id: newId, ...base, start_date: today } });
      patchRules = (rs) => [...rs.map((r) => (r.id === existing.id ? { ...r, end_date: addDays(today, -1) } : r)), { id: newId, ...base, start_date: today } as FeedingRule];
    } else if (existing) {
      ops.push({ kind: 'update', table: 'feeding_rules', match: { id: existing.id }, patch: { ...base, start_date: temporary ? start : existing.start_date } });
      patchRules = (rs) => rs.map((r) => (r.id === existing.id ? { ...r, ...base, start_date: temporary ? start : existing.start_date } as FeedingRule : r));
    } else {
      const newId = uuid();
      const row = { id: newId, ...base, start_date: temporary ? start : today };
      ops.push({ kind: 'insert', table: 'feeding_rules', row });
      patchRules = (rs) => [...rs, row as FeedingRule];
    }
    const ok = await save(ops, { label: 'Feeding plan saved', patch: (x) => ({ ...x, rules: patchRules(x.rules) }) });
    if (ok) nav(`/feed/${product!.id}`, { replace: true });
  }

  async function remove() {
    if (!existing) return;
    const ok = await save([{ kind: 'delete', table: 'feeding_rules', match: { id: existing.id } }], {
      label: 'Feeding plan removed',
      patch: (x) => ({ ...x, rules: x.rules.filter((r) => r.id !== existing.id) }),
      undo: [{ kind: 'insert', table: 'feeding_rules', row: { ...existing } as unknown as Record<string, unknown> }]
    });
    if (ok) nav(`/feed/${product!.id}`, { replace: true });
  }

  return (
    <Screen title={existing ? 'Change feeding rate' : 'Who eats it?'} sub={product.name} back>
      <Card className="space-y-5">
        <GroupPicker b={b} value={groupId} onChange={setGroupId} />
        {group && (
          <label className="flex min-h-tap items-center gap-3 font-bold">
            <input type="checkbox" className="h-6 w-6 accent-field" checked={useGroupCount} onChange={(e) => { setUseGroupCount(e.target.checked); if (!e.target.checked) setHeads(group.head_count); }} />
            All {group.head_count} in the group (updates when numbers change)
          </label>
        )}
        {!useGroupCount && <Stepper label="How many get it?" value={heads} step={5} onChange={setHeads} unit="head" />}
        <Stepper label="kg per head per feed" value={kg} step={0.5} decimals={2} onChange={setKg} unit="kg" />
        <Chips label="Feeds per day" columns={3} value={feeds} onChange={setFeeds} options={[{ value: '1', label: 'Once' }, { value: '2', label: 'Twice' }, { value: '3', label: '3 times' }]} />
      </Card>
      <Card className="space-y-4">
        <label className="flex min-h-tap items-center gap-3 font-bold">
          <input type="checkbox" className="h-6 w-6 accent-field" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
          Only for a while (temporary plan)
        </label>
        {temporary && (
          <>
            <p className="hint">Replaces this group's normal rate between these dates, then goes back automatically.</p>
            <DateChips label="Starts" value={start} onChange={setStart} allowFuture />
            <div><label className="label" htmlFor="end">Ends</label><input id="end" type="date" className="input" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            <TextInput label="Reason (optional)" value={label} onChange={setLabel} placeholder="e.g. Grass short" voice />
          </>
        )}
      </Card>
      <Card className="bg-field text-white">
        <p className="text-white/85">Daily use from this group</p>
        <p className="numeral text-5xl">{fmtKg(daily)}<span className="font-sans text-lg">/day</span></p>
        <p className="text-sm text-white/85">{effHeads} × {kg} kg × {feeds}. Your plan: Agri-It doesn't recommend rates.</p>
      </Card>
      {existing && <Button variant="danger" block onClick={remove}>Remove this group from the plan</Button>}
      <SaveBar><Button block disabled={!groupId || daily <= 0} onClick={submit}>Save plan</Button></SaveBar>
    </Screen>
  );
}
