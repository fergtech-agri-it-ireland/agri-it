import { useState } from 'react';
import { Circle, CheckCircle2 } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { addDays, fmtDay, todayISO, uuid } from '../lib/format';
import { Button, Card, ChangeLink, DateChips, List, Row, Screen, Sheet, TextInput } from '../components/ui';
import type { Job } from '../lib/types';

export default function Jobs() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(todayISO());
  const open = b.jobs.filter((j) => !j.done_at && !j.dismissed_at).sort((a, c) => (a.due_on ?? '9').localeCompare(c.due_on ?? '9'));
  const [editing, setEditing] = useState<Job | null>(null);
  const [moveTo, setMoveTo] = useState(addDays(todayISO(), 1));
  const patchJob = (j: Job, patch: Partial<Job>, label: string) => save([{ kind: 'update', table: 'jobs', match: { id: j.id }, patch }], {
    label, patch: (x) => ({ ...x, jobs: x.jobs.map((y) => (y.id === j.id ? { ...y, ...patch } : y)) }),
    undo: [{ kind: 'update', table: 'jobs', match: { id: j.id }, patch: { due_on: j.due_on, dismissed_at: j.dismissed_at ?? null } }]
  });
  const done = b.jobs.filter((j) => j.done_at).slice(0, 5);
  const toggle = (id: string, doneAt: string | null) => save([{ kind: 'update', table: 'jobs', match: { id }, patch: { done_at: doneAt } }], {
    label: doneAt ? 'Done' : 'Back on the list', patch: (x) => ({ ...x, jobs: x.jobs.map((j) => (j.id === id ? { ...j, done_at: doneAt } : j)) })
  });

  async function add() {
    const row = { id: uuid(), farm_id: farmId!, title, due_on: due, done_at: null };
    await save([{ kind: 'insert', table: 'jobs', row }], { label: 'Job added', patch: (x) => ({ ...x, jobs: [...x.jobs, row] }) });
    setTitle('');
  }

  return (
    <Screen title="Jobs" back="/farm">
      <Card className="space-y-4">
        <TextInput label="New job" value={title} onChange={setTitle} voice placeholder="e.g. Book vet" />
        <DateChips label="Due" value={due} onChange={setDue} allowFuture />
        <Button block disabled={!title.trim()} onClick={add}>Add job</Button>
      </Card>
      <List>
        {open.length === 0 && <Row title="Nothing to do" />}
        {open.map((j) => (
          <div key={j.id} className="flex items-center">
            <button className="block min-w-0 flex-1 text-left" onClick={() => toggle(j.id, new Date().toISOString())}>
              <Row icon={<Circle className="h-7 w-7 text-accent" aria-label="Mark done" />} title={j.title} sub={j.due_on ? `${j.due_on < todayISO() ? 'Overdue, stays here until done. ' : ''}Due ${fmtDay(j.due_on)}` : undefined} />
            </button>
            <ChangeLink to={`/edit/job/${j.id}`} what={`job ${j.title}`} />
            <Button variant="ghost" className="mr-2 shrink-0" aria-label={`Move or take off: ${j.title}`} onClick={() => { setMoveTo(addDays(todayISO(), 1)); setEditing(j); }}>Move</Button>
          </div>
        ))}
      </List>
      {done.length > 0 && (
        <List>
          {done.map((j) => (
            <button key={j.id} className="block w-full text-left" onClick={() => toggle(j.id, null)}>
              <Row icon={<CheckCircle2 className="h-7 w-7 text-ok" aria-label="Done" />} title={<span className="text-muted line-through">{j.title}</span>} />
            </button>
          ))}
        </List>
      )}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.title ?? ''}>
        {editing && (
          <div className="space-y-4 pb-2">
            <DateChips label="Move to" value={moveTo} onChange={setMoveTo} allowFuture />
            <Button block onClick={() => { patchJob(editing, { due_on: moveTo }, `Moved to ${fmtDay(moveTo)}`); setEditing(null); }}>Move to {fmtDay(moveTo)}</Button>
            <Button block variant="secondary" onClick={() => { patchJob(editing, { dismissed_at: new Date().toISOString() }, 'Taken off the list'); setEditing(null); }}>No longer needed: take it off</Button>
            <p className="text-sm text-muted">Overdue jobs stay on Today until they are done, moved or taken off.</p>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
