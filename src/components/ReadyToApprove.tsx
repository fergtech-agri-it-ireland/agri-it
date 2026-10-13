import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, ExternalLink, Sparkles } from 'lucide-react';
import { useFarmCtx, useSave } from '../lib/data/farm';
import { decisionOp, type Suggestion } from '../lib/suggestions';
import { SEASON_SOURCES } from '../lib/season';
import { todayISO } from '../lib/format';
import type { FarmBundle } from '../lib/types';

const WHEN: Record<Suggestion['when'], string> = { overdue: 'Overdue', today: 'Today', soon: 'This week', later: 'When you get a minute' };

/**
 * Things Agri-It has worked out and drafted. One tap approves; nothing is recorded before that.
 * Not now = a week; No = gone for good. Legal deadlines (calf tags) can't be turned down.
 */
export function ReadyToApprove({ items, limit = 3 }: { items: Suggestion[]; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, limit);
  return (
    <section aria-label="Ready for you to approve" className="overflow-hidden rounded-[1.125rem] bg-card shadow-lift">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Sparkles className="h-5 w-5 text-accent" aria-hidden />
        <h2 className="flex-1 text-[1.0625rem] font-bold">Ready for you to approve</h2>
        <span className="text-[0.8125rem] text-muted">{items.length}</span>
      </div>
      <p className="px-4 text-[0.8125rem] text-muted">Agri-It has done the work. Nothing is saved until you approve.</p>
      <ul className="mt-2 divide-y divide-line">
        {shown.map((s) => <SuggestionCard key={s.key} s={s} />)}
      </ul>
      {items.length > limit && (
        <button className="min-h-[2.75rem] w-full border-t border-line px-4 text-left text-sm font-bold text-accent" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${items.length - limit} more`}
        </button>
      )}
    </section>
  );
}

export function SuggestionCard({ s }: { s: Suggestion }) {
  const save = useSave();
  const nav = useNavigate();
  const { farmId } = useFarmCtx();
  const [busy, setBusy] = useState(false);
  const today = todayISO();

  async function approve() {
    if (!s.approve) return;
    setBusy(true);
    const ok = await save(s.approve.ops, { label: s.approve.saved, patch: s.approve.patch });
    setBusy(false);
    if (ok && s.approve.then) nav(s.approve.then);
  }
  async function decide(decision: 'snoozed' | 'dismissed') {
    const { op, row } = decisionOp(farmId!, s.key, decision, today);
    await save([op], {
      label: decision === 'snoozed' ? 'Hidden for a week' : 'Got it, it won\'t come up again',
      patch: (x: FarmBundle) => ({ ...x, decisions: [...(x.decisions ?? []), row] }),
      undo: [{ kind: 'delete', table: 'suggestion_decisions', match: { id: row.id } }]
    });
  }

  return (
    <li className="space-y-2 px-4 py-3" data-suggestion={s.key}>
      <p className={`text-[0.75rem] font-bold uppercase tracking-wide ${s.when === 'overdue' ? 'text-danger' : 'text-muted'}`}>{WHEN[s.when]}</p>
      <p className="text-[0.9375rem] font-semibold leading-snug">{s.title}</p>
      <p className="text-[0.875rem]">{s.detail}</p>
      <p className="text-[0.8125rem] text-muted">
        Why: {s.why}
        {s.sourceCodes?.map((c) => SEASON_SOURCES[c]).filter(Boolean).map((src) => (
          <a key={src!.code} href={src!.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-accent underline">
            {src!.publisher}<ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ))}
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {s.approve && (
          <button onClick={approve} disabled={busy} className="inline-flex min-h-[3rem] items-center gap-1.5 rounded-full bg-field px-5 font-bold text-white disabled:opacity-50">
            <Check className="h-5 w-5" strokeWidth={3} aria-hidden />{s.approve.label}
          </button>
        )}
        {s.to && (
          <Link to={s.to.href} className={`inline-flex min-h-[3rem] items-center gap-1 rounded-full px-4 font-bold ${s.approve ? 'text-accent' : 'bg-field text-white'}`}>
            {s.to.label}<ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
        {s.canDecline && (
          <span className="ml-auto flex gap-1">
            <button onClick={() => decide('snoozed')} className="min-h-[3rem] rounded-full px-3 text-sm font-semibold text-muted">Not now</button>
            <button onClick={() => decide('dismissed')} className="min-h-[3rem] rounded-full px-3 text-sm font-semibold text-muted" aria-label={`No: ${s.title}`}>No</button>
          </span>
        )}
      </div>
    </li>
  );
}
