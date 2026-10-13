import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { calfDeadlines } from '../lib/season';
import { planMove } from '../lib/moves';
import { headChangeRow, headsOn } from '../lib/heads';
import { addDays, daysBetween, fmtDay, todayISO, uuid } from '../lib/format';
import type { CalfBirth, FarmBundle } from '../lib/types';
import type { Op } from '../lib/offline/outbox';
import { Button, Card, Chips, DateChips, SaveBar, Screen, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';

/**
 * Calf born: one entry updates the calf group, brings the cow back into the milking group (dairy),
 * and starts the tagging and registration countdowns.
 */
export default function CalfForm() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const [born, setBorn] = useState(today);
  const season = (b.seasons ?? []).filter((s) => !s.archived && daysBetween(addDays(s.calving_start, -60), born) >= 0 && daysBetween(born, addDays(s.calving_end ?? s.calving_start, 120)) >= 0)
    .sort((a, c) => c.calving_start.localeCompare(a.calving_start))[0] ?? null;
  const [calves, setCalves] = useState<'1' | '2' | '3'>('1');
  const [calfGroup, setCalfGroup] = useState<string | null>(season?.calf_group_id ?? b.groups.find((g) => !g.archived && g.animal_class === 'calf')?.id ?? null);
  const dry = b.groups.find((g) => g.id === season?.dry_group_id);
  const milk = b.groups.find((g) => g.id === season?.milking_group_id);
  const dryN = dry ? headsOn(dry, born, b.headHistory.filter((h) => h.animal_group_id === dry.id)) : 0;
  const canMoveCow = season?.herd === 'dairy' && !!dry && !!milk && dryN > 0;
  const [cowBack, setCowBack] = useState(true);
  const [notes, setNotes] = useState('');
  const n = Number(calves);
  const draft: CalfBirth = { id: uuid(), farm_id: farmId!, season_id: season?.id ?? null, born_on: born, calves: n, calf_group_id: calfGroup, tagged_on: null, registered_on: null, notes: notes.trim() || null };
  const dl = calfDeadlines(draft, b.farm.jurisdiction, season?.herd ?? (b.farm.enterprises?.includes('dairy') ? 'dairy' : 'suckler'));
  const cg = b.groups.find((g) => g.id === calfGroup);
  const cowMove = useMemo(() => (canMoveCow && cowBack ? planMove(b, dry!, milk!, 1, born, today) : null), [b, canMoveCow, cowBack, dry, milk, born, today]);

  async function submit() {
    const ops: Op[] = [{ kind: 'insert', table: 'calf_births', row: draft as unknown as Record<string, unknown> }];
    const undo: Op[] = [{ kind: 'delete', table: 'calf_births', match: { id: draft.id } }];
    const patches: ((x: FarmBundle) => FarmBundle)[] = [(x) => ({ ...x, births: [...(x.births ?? []), draft] })];
    if (cg) {
      const was = headsOn(cg, born, b.headHistory.filter((h) => h.animal_group_id === cg.id));
      const id = uuid();
      ops.push({ kind: 'rpc', fn: 'set_head_count', args: { p_group_id: cg.id, p_head_count: was + n, p_reason: 'calved', p_effective_on: born, p_id: id } });
      undo.push({ kind: 'rpc', fn: 'set_head_count', args: { p_group_id: cg.id, p_head_count: was, p_reason: 'calf undone', p_effective_on: born } });
      const row = { ...headChangeRow(cg, was + n, born, 'calved', was), id };
      patches.push((x) => ({ ...x, headHistory: [...x.headHistory, row], groups: x.groups.map((g) => (g.id === cg.id ? { ...g, head_count: born <= today ? g.head_count + n : g.head_count, head_count_updated_at: new Date().toISOString() } : g)) }));
    }
    if (cowMove) { ops.push(...cowMove.ops); undo.push(...cowMove.undo); patches.push(cowMove.patch); }
    const ok = await save(ops, {
      label: `${n === 1 ? 'Calf' : `${n} calves`} recorded. Tag by ${fmtDay(dl.tagBy)}`,
      patch: (x) => patches.reduce((acc, p) => p(acc), x),
      undo, undoLabel: 'Calf removed'
    });
    if (ok) nav('/calving', { replace: true });
  }

  return (
    <Screen title="Calf born" back>
      <Card className="space-y-5">
        <DateChips label="Born" value={born} onChange={setBorn} />
        <Chips label="How many?" columns={3} value={calves} onChange={setCalves} options={[{ value: '1', label: 'One' }, { value: '2', label: 'Twins' }, { value: '3', label: 'Three' }]} />
        <GroupPicker b={b} value={calfGroup} onChange={setCalfGroup} label="Calves go into" />
        {canMoveCow && (
          <label className="flex min-h-tap items-center gap-3 rounded-xl border border-line px-4">
            <input type="checkbox" className="h-6 w-6" checked={cowBack} onChange={(e) => setCowBack(e.target.checked)} />
            <span className="font-semibold">Cow goes back to {milk!.name} ({dry!.name} {dryN} → {dryN - 1})</span>
          </label>
        )}
        <TextInput label="Note (optional)" value={notes} onChange={setNotes} placeholder="e.g. heifer calf, tag 1234" voice />
      </Card>
      <Card className="space-y-1" as="div">
        <p className="font-bold" data-testid="calf-deadlines">Tag by {fmtDay(dl.tagBy)}. Register by {fmtDay(dl.registerBy)}.</p>
        <p className="hint">{b.farm.jurisdiction === 'NI' ? 'NI: dairy calves within 36 hours of birth, others within 20 days; notify within 27 days.' : 'Calves must be tagged before 20 days of age and registered within 27 days.'} Agri-It reminds you until you mark them done. It is not the official register.</p>
        {cg && <p className="text-[0.9375rem]">{cg.name} goes up by {n}.{cowMove ? ` One cow back into ${milk!.name}, so her feeding plan counts again.` : ''}</p>}
        {!season && <p className="text-[0.9375rem] text-muted">No calving season covers this date. It's still recorded with its deadlines.</p>}
      </Card>
      <SaveBar><Button block onClick={submit}>Save</Button></SaveBar>
    </Screen>
  );
}
