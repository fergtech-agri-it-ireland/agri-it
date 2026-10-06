import { useState } from 'react';
import { Circle, CheckCircle2 } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { fmtDay, todayISO, uuid } from '../lib/format';
import { Button, Card, DateChips, List, Row, Screen, TextInput } from '../components/ui';

export default function Jobs() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(todayISO());
  const open = b.jobs.filter((j) => !j.done_at).sort((a, c) => (a.due_on ?? '9').localeCompare(c.due_on ?? '9'));
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
          <button key={j.id} className="block w-full text-left" onClick={() => toggle(j.id, new Date().toISOString())}>
            <Row icon={<Circle className="h-7 w-7 text-field" aria-label="Mark done" />} title={j.title} sub={j.due_on ? `${j.due_on < todayISO() ? 'Overdue, ' : ''}due ${fmtDay(j.due_on)}` : undefined} />
          </button>
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
    </Screen>
  );
}
