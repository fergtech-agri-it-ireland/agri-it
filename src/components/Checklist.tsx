import { useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Briefcase, Check, ClipboardCheck, Minus, Package, Receipt, Ruler, Truck, Warehouse } from 'lucide-react';
import { useFarmCtx, useSave } from '../lib/data/farm';
import type { FeedForecast } from '../lib/forecast/feed';
import { checklistProgress, type ChecklistItem, type ChecklistKind } from '../lib/routines';
import { completeRoutine, tickAllFeeding, tickFeeding, untick, type TickAction } from '../lib/routineActions';
import type { FarmBundle } from '../lib/types';
import { eur, fmtDay, fmtKg, fmtNum } from '../lib/format';
import { Button, NumberInput, SectionTitle, Sheet } from './ui';

const ICON: Record<ChecklistKind, ComponentType<{ className?: string }>> = {
  feeding: Package, silage: Warehouse, count: Ruler, order: Truck, job: Briefcase, expense: Receipt, income: Banknote
};

const amountText = (i: ChecklistItem, n: number | null) =>
  n === null ? '' : i.unit === '€' ? eur(n) : i.unit === 't' ? `${fmtNum(n)} t` : fmtKg(n);

/** Words for a ticked item: what actually happened. */
function doneText(i: ChecklistItem) {
  if (i.status === 'skipped') return 'Skipped';
  const a = amountText(i, i.actual);
  switch (i.kind) {
    case 'feeding': return i.actual !== i.planned ? `Fed ${a} (plan ${amountText(i, i.planned)})` : `Fed ${a}`;
    case 'expense': return `Paid ${a}`;
    case 'income': return `Received ${a}`;
    case 'order': return `Ordered ${a}`;
    case 'silage': return `Fed out ${a}`;
    case 'count': return a ? `Counted ${a}` : 'Counted';
    default: return 'Done';
  }
}
const SAVE_VERB: Record<ChecklistKind, string> = { feeding: 'Fed', expense: 'Paid', income: 'Received', order: 'Ordered', silage: 'Fed out', job: 'Done', count: 'Counted' };

/**
 * Today's checklist. Everything recurring that the farmer confirms: feeding from the plan,
 * bills, income, jobs, stock counts, orders and silage feed-out. Ticking records what
 * actually happened, and every forecast updates from it.
 */
export function Checklist({ b, items, today, feed, title }: {
  b: FarmBundle; items: ChecklistItem[]; today: string; feed: Map<string, FeedForecast>; title: string;
}) {
  const save = useSave();
  const { farmId } = useFarmCtx();
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [amount, setAmount] = useState('');
  const [showDone, setShowDone] = useState(false);
  if (items.length === 0) return null;

  const progress = checklistProgress(items, today);
  const pendingToday = items.filter((i) => i.date === today && i.status === 'pending');
  const earlier = items.filter((i) => i.date < today);
  const doneToday = items.filter((i) => i.date === today && i.status !== 'pending');
  const feedingOpen = pendingToday.filter((i) => i.kind === 'feeding');

  async function run(action: TickAction, item?: ChecklistItem, actual?: number) {
    let label = action.label;
    // Say what's left straight away: the point of ticking it off
    if (item?.kind === 'feeding' && item.productId && actual !== undefined) {
      const f = feed.get(item.productId);
      const product = b.products.find((p) => p.id === item.productId)?.name;
      if (f?.stockKg !== null && f?.stockKg !== undefined && item.date === today) label += `. ${product}: about ${fmtKg(Math.max(0, f.stockKg - actual))} left`;
    }
    await save(action.ops, { label, patch: action.patch, undo: action.undo.length ? action.undo : undefined, undoLabel: 'Unticked' });
  }

  function tick(i: ChecklistItem) {
    if (i.status !== 'pending') return run(untick(i));
    if (i.kind === 'feeding') return run(tickFeeding(i, farmId!, i.planned ?? 0), i, i.planned ?? 0);
    if (i.planned === null && i.kind !== 'job') return openEdit(i); // amount varies: ask
    return run(completeRoutine(i, b, i.planned));
  }
  function openEdit(i: ChecklistItem) {
    setAmount(i.planned !== null ? String(i.planned) : '');
    setEditing(i);
  }
  async function saveEdit(skip: boolean) {
    const i = editing!;
    setEditing(null);
    const n = amount === '' ? null : Number(amount);
    if (i.kind === 'feeding') return run(tickFeeding(i, farmId!, n ?? 0, skip), i, skip ? 0 : n ?? 0);
    return run(completeRoutine(i, b, n, skip));
  }

  const row = (i: ChecklistItem) => {
    const Icon = ICON[i.kind];
    const done = i.status !== 'pending';
    const countLink = i.kind === 'count' && !done ? `/feed/${i.routine!.feed_product_id}/count?routine=${i.routine!.id}&due=${i.date}` : null;
    return (
      <li key={i.key} className="flex min-h-[4.5rem] items-center gap-3 px-3 py-2">
        {countLink ? (
          <Link to={countLink} aria-label={`Count now: ${i.title}`}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink/70 text-ink">
            <Ruler className="h-6 w-6" aria-hidden />
          </Link>
        ) : (
          <button onClick={() => tick(i)} aria-pressed={done}
            aria-label={done ? `Untick: ${i.title}` : `${SAVE_VERB[i.kind]}${i.planned !== null ? ` ${amountText(i, i.planned)}` : ''}: ${i.title}`}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] transition-colors ${
              i.status === 'done' ? 'border-ok bg-ok text-oninverse' : i.status === 'skipped' ? 'border-line bg-track text-muted' : 'border-ink/70 bg-card hover:bg-field-light'}`}>
            {i.status === 'done' ? <Check className="h-8 w-8" strokeWidth={3} aria-hidden /> : i.status === 'skipped' ? <Minus className="h-7 w-7" strokeWidth={3} aria-hidden /> : null}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className={`flex items-start gap-1.5 font-bold leading-snug ${done ? 'text-muted' : ''}`}>
            <Icon className="mt-[0.2rem] h-[1.125rem] w-[1.125rem] shrink-0 text-accent" aria-hidden /><span className="min-w-0">{i.title}</span>
          </p>
          <p className="text-[0.95rem] text-muted">
            {i.date < today && <b className="text-warn">{fmtDay(i.date)}. </b>}
            {done ? doneText(i) : i.sub}
          </p>
        </div>
        {!done && i.kind !== 'count' && (
          <button onClick={() => openEdit(i)} className="min-h-tap shrink-0 rounded-xl px-2.5 font-bold text-accent hover:bg-field-light">Change</button>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="checklist-title" className="space-y-2">
      <SectionTitle action={<span className="pb-1 text-[0.95rem] font-bold text-muted">{progress.done} of {progress.total} done</span>}>
        <span id="checklist-title">{title}</span>
      </SectionTitle>
      <div className="h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-label="Today's checklist" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
      </div>

      {feedingOpen.length >= 2 && (
        <button onClick={() => run(tickAllFeeding(feedingOpen, farmId!))}
          className="flex min-h-[3.75rem] w-full items-center justify-center gap-2.5 rounded-[1.125rem] bg-hivis px-4 text-lg font-bold text-onhivis active:bg-hivis-dark">
          <ClipboardCheck className="h-6 w-6" aria-hidden />All fed as planned ({fmtKg(feedingOpen.reduce((s, i) => s + (i.planned ?? 0), 0))})
        </button>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card shadow-lift">
        {pendingToday.map(row)}
        {pendingToday.length === 0 && earlier.length === 0 && (
          <li className="flex min-h-[4rem] items-center gap-3 px-4 font-bold text-ok"><Check className="h-6 w-6" aria-hidden />All done for today</li>
        )}
        {earlier.length > 0 && (
          <li className="bg-warn-bg px-4 py-2 text-[0.95rem] font-bold text-warn">From earlier, not ticked off yet</li>
        )}
        {earlier.map(row)}
        {doneToday.length > 0 && (
          <li>
            <button onClick={() => setShowDone(!showDone)} className="min-h-tap w-full px-4 text-left font-bold text-accent">
              {showDone ? 'Hide done' : `Show done (${doneToday.length})`}
            </button>
          </li>
        )}
        {showDone && doneToday.map(row)}
      </ul>

      <Link to="/routines" className="flex min-h-tap items-center px-2 text-[0.95rem] font-bold text-accent">Add or change routines</Link>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.title ?? ''}>
        {editing && (
          <div className="space-y-4 pb-2">
            {editing.unit && (
              <NumberInput autoFocus label={editing.kind === 'feeding' ? 'How much was fed?' : editing.unit === '€' ? 'Amount' : 'How much?'}
                value={amount} onChange={setAmount} unit={editing.unit}
                hint={editing.planned !== null ? `Planned ${amountText(editing, editing.planned)}${editing.date < (today) ? `, due ${fmtDay(editing.date)}` : ''}` : 'This one varies, so enter what it was.'} />
            )}
            <Button block disabled={!!editing.unit && amount === ''} onClick={() => saveEdit(false)}>
              {SAVE_VERB[editing.kind]}{editing.unit && amount !== '' ? ` ${amountText(editing, Number(amount))}` : ''}
            </Button>
            <Button block variant="secondary" onClick={() => saveEdit(true)}>Skip this time</Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
