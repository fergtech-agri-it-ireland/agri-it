import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { eur, fmtDay, todayISO, uuid } from '../lib/format';
import { forecastFeed } from '../lib/forecast/feed';
import { fyRange } from '../lib/forecast/money';
import { showSaved, type SavedRow } from '../lib/saved';
import { Button, Card, DateChips, Empty, LinkButton, NumberInput, SaveBar, Screen, Stepper, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';

/** One entry updates income, the group's head count, and so every feed and forage forecast. */
export default function AnimalSaleForm() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const last = b.income.filter((i) => i.income_type === 'livestock')[0];
  const [groupId, setGroupId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [buyer, setBuyer] = useState(last?.counterparty ?? '');
  const [reduce, setReduce] = useState(true);
  const group = b.groups.find((g) => g.id === groupId);
  if (!b.groups.some((g) => !g.archived)) return <Screen title="Sold animals" back><Empty title="Add your animal groups first" action={<LinkButton to="/farm/groups">Add groups</LinkButton>} /></Screen>;

  async function submit() {
    const id = uuid();
    const result = await save([{ kind: 'rpc', fn: 'record_animal_sale', args: {
      p_id: id, p_farm_id: farmId, p_group_id: groupId, p_head_count: count, p_amount_eur: Number(amount), p_occurred_on: date,
      p_counterparty: buyer || null, p_reduce_group: reduce
    } }], {
      label: 'Sale saved',
      quiet: true,
      patch: (x) => ({
        ...x,
        groups: reduce ? x.groups.map((g) => (g.id === groupId ? { ...g, head_count: Math.max(0, g.head_count - count), head_count_updated_at: new Date().toISOString() } : g)) : x.groups,
        income: [{ id, farm_id: farmId!, income_type: 'livestock', occurred_on: date, amount_eur: Number(amount), counterparty: buyer || null, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: groupId, head_count: count, description: `${count} sold`, document_id: null }, ...x.income]
      }),
      undo: [{ kind: 'rpc', fn: 'undo_animal_sale', args: { p_income_id: id } }],
      undoLabel: 'Sale removed'
    });
    if (!result || !group) return;

    // Fewer mouths: show how much longer each feed this group eats now lasts
    const today = todayISO();
    const remaining = Math.max(0, group.head_count - count);
    const groupsAfter = b.groups.map((g) => (g.id === group.id ? { ...g, head_count: remaining } : g));
    const feedRows: SavedRow[] = reduce ? b.products.filter((p) => !p.archived && b.rules.some((r) => r.feed_product_id === p.id && r.animal_group_id === group.id)).flatMap((p) => {
      const input = { product: p, txns: b.txns.filter((t) => t.feed_product_id === p.id), rules: b.rules.filter((r) => r.feed_product_id === p.id), supplierSetting: b.supplierSettings.find((s) => s.supplier_id === p.supplier_id), farmLeadTimeDays: b.farm.default_lead_time_days, today };
      const before = forecastFeed({ ...input, groups: b.groups });
      const after = forecastFeed({ ...input, groups: groupsAfter });
      return after.runOutDate ? [{ label: `${p.name} lasts to`, before: before.runOutDate ? fmtDay(before.runOutDate) : null, after: fmtDay(after.runOutDate) }] : [];
    }) : [];
    const fy = fyRange(b.farm, today);
    const salesBefore = b.income.filter((i) => i.income_type === 'livestock' && i.occurred_on >= fy.start && i.occurred_on <= fy.end).reduce((s, i) => s + Number(i.amount_eur), 0);
    showSaved(nav, result, {
      title: 'Sale saved',
      subtitle: `${count} from ${group.name}${amount ? ` for ${eur(Number(amount))}` : ''}`,
      compare: reduce ? { label: `${group.name} head count`, before: group.head_count, after: remaining, unit: 'head' } : undefined,
      rows: [
        ...feedRows,
        ...(amount ? [{ label: 'Livestock sales this year', before: eur(salesBefore), after: eur(salesBefore + Number(amount)) }] : []),
        ...(amount && count ? [{ label: 'Average per head', after: eur(Number(amount) / count) }] : [])
      ],
      note: reduce ? 'Head count history updated. Feed and silage forecasts now use the new number.' : 'Head count left as it was, as you chose.',
      undo: [{ kind: 'rpc', fn: 'undo_animal_sale', args: { p_income_id: id } }],
      undoLabel: 'Sale removed',
      again: { label: 'Another sale', to: '/record/sale' }
    });
  }

  return (
    <Screen title="Sold animals" back>
      <Card className="space-y-5">
        <GroupPicker b={b} value={groupId} onChange={setGroupId} label="From which group?" />
        <Stepper label="How many?" value={count} min={1} onChange={setCount} unit="head" />
        <NumberInput label="Total received" value={amount} onChange={setAmount} unit="€" hint={amount && count ? `${eur(Number(amount) / count)} per head` : undefined} />
        <DateChips label="Sold on" value={date} onChange={setDate} />
        <TextInput label="Sold to" value={buyer} onChange={setBuyer} placeholder="e.g. Mart, factory, private" />
        {group && (
          <label className="flex min-h-tap items-center gap-3 font-bold">
            <input type="checkbox" className="h-6 w-6 accent-field" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />
            Take {count} off {group.name} ({group.head_count} → {Math.max(0, group.head_count - count)})
          </label>
        )}
      </Card>
      <SaveBar><Button block disabled={!groupId || !amount || count < 1} onClick={submit}>Save sale</Button></SaveBar>
    </Screen>
  );
}
