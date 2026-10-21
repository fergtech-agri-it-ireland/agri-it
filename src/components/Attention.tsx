import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { WHEN_LABEL, type Priority, type When } from '../lib/data/derived';
import { bundleAlerts, canPutOff, isSnoozed, SNOOZE_DAYS, SNOOZE_REASONS, type AlertItem, type SnoozeReason } from '../lib/alerts';
import { loadSnoozes, noteAction, noteShown, saveSnooze } from '../lib/alertStore';
import { Button, Chips, Sheet, ToneIcon } from './ui';

/**
 * Needs your attention (G12). Related items come as one line each; tap a bundle to see what is
 * in it. Only information has "Not now", which asks why and for how long. Overdue and today
 * always show in full; the rest folds after a few.
 */
export function Attention({ farmId, items, today, alsoShown = [], embedded = false }: { farmId: string; items: Priority[]; today: string; alsoShown?: string[]; embedded?: boolean }) {
  const [snoozes, setSnoozes] = useState(() => loadSnoozes(farmId));
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [putOff, setPutOff] = useState<AlertItem | null>(null);

  const live = useMemo(() => items.filter((p) => !isSnoozed(snoozes, p, today)), [items, snoozes, today]);
  const lines = useMemo(() => bundleAlerts(live), [live]);
  // One call with everything on screen (suggestions too), so a new day is settled against all of it
  const ids = [...live.map((p) => p.id), ...alsoShown].join('|');
  useEffect(() => { noteShown(farmId, ids ? ids.split('|') : [], today); }, [farmId, ids, today]);

  if (!lines.length) return null;
  const pressing = lines.filter((p) => p.when === 'overdue' || p.when === 'today');
  const rest = lines.filter((p) => p.when !== 'overdue' && p.when !== 'today');
  const shown = [...pressing, ...(all ? rest : rest.slice(0, Math.max(0, 3 - pressing.length)))];
  const folded = lines.length - shown.length;
  const byWhen = (['overdue', 'today', 'soon', 'later'] as When[]).map((w) => ({ w, items: shown.filter((p) => p.when === w) })).filter((g) => g.items.length);
  const acted = (id: string) => noteAction(farmId, id, { kind: 'acted' }, today);

  return (
    <section aria-label="Needs your attention" className={embedded ? 'border-t border-line' : 'overflow-hidden rounded-[1.125rem] bg-card shadow-lift'}>
      {embedded
        ? <h3 className="px-4 pt-3 text-[0.9375rem] font-bold">Needs your attention</h3>
        : <h2 className="px-4 pt-4 text-[1.0625rem] font-bold">Needs your attention</h2>}
      {byWhen.map(({ w, items: group }) => (
        <div key={w}>
          <p className={`mt-2 px-4 text-[0.75rem] font-bold uppercase tracking-wide ${w === 'overdue' ? 'text-danger' : 'text-muted'}`}>{WHEN_LABEL[w]}</p>
          <ul className="divide-y divide-line">
            {group.map((p) => {
              const bundle = p.members && p.members.length > 1;
              const expanded = open === p.id;
              const body = (
                <>
                  <ToneIcon tone={p.tone} className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1"><b className="block text-[0.9375rem] font-semibold leading-snug">{p.title}</b><span className="text-[0.8125rem] text-muted">{p.detail}</span></span>
                  {bundle ? <ChevronDown className={`h-5 w-5 shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                    : !canPutOff(p) && <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
                </>
              );
              return (
                <li key={p.id} data-alert={p.id}>
                  <div className="flex items-center hover:bg-pasture">
                    {bundle
                      ? <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)} className="flex min-h-[3.5rem] min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left">{body}</button>
                      : <Link to={p.to} onClick={() => acted(p.id)} className="flex min-h-[3.5rem] min-w-0 flex-1 items-center gap-3 px-4 py-2">{body}</Link>}
                    {canPutOff(p) && (
                      <button onClick={() => setPutOff(p)} aria-label={`Not now: ${p.title}`} className="mr-2 inline-flex min-h-[2.75rem] shrink-0 items-center gap-1 rounded-full px-3 text-[0.8125rem] font-semibold text-muted hover:bg-card">
                        <Clock className="h-4 w-4" aria-hidden />Not now
                      </button>
                    )}
                  </div>
                  {bundle && expanded && (
                    <ul className="border-t border-line bg-pasture/60">
                      {p.members!.map((m) => (
                        <li key={m.id}>
                          <Link to={m.to} onClick={() => acted(m.id)} className="flex min-h-[3.25rem] items-center gap-3 py-2 pl-12 pr-4">
                            <span className="min-w-0 flex-1"><b className="block text-[0.875rem] font-semibold leading-snug">{m.title}</b><span className="text-[0.8125rem] text-muted">{m.detail}</span></span>
                            {m.action && <span className="shrink-0 text-[0.8125rem] font-bold text-accent">{m.action}</span>}
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {(folded > 0 || all) && rest.length > 0 && (
        <button className="mt-1 min-h-[2.75rem] w-full border-t border-line px-4 text-left text-sm font-bold text-accent" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${folded} more`}
        </button>
      )}
      <NotNowSheet item={putOff} onClose={() => setPutOff(null)} onSave={(reason, days) => {
        if (!putOff) return;
        setSnoozes(saveSnooze(farmId, putOff.members?.map((m) => m.id) ?? [putOff.id], days, reason, today));
        setPutOff(null);
      }} />
    </section>
  );
}

/** Why, and for how long. Used for Today's information and for suggestions' Not now. */
export function NotNowSheet({ item, onClose, onSave }: { item: { title: string } | null; onClose: () => void; onSave: (reason: SnoozeReason, days: number) => void }) {
  const [reason, setReason] = useState<SnoozeReason | null>(null);
  const [days, setDays] = useState<string>('7');
  useEffect(() => { if (item) { setReason(null); setDays('7'); } }, [item]);
  return (
    <Sheet open={!!item} onClose={onClose} title="Not now">
      <p className="mb-3 text-[0.9375rem] font-semibold">{item?.title}</p>
      <div className="space-y-4">
        <Chips label="Why?" options={SNOOZE_REASONS} value={reason} onChange={setReason} />
        <Chips label="Show it again" options={SNOOZE_DAYS} value={days} onChange={setDays} columns={2} />
        <Button block disabled={!reason} onClick={() => reason && onSave(reason, Number(days))}>Put it off</Button>
        <p className="text-[0.8125rem] text-muted">Only information can be put off. Anything owed, overdue or due today stays until it's dealt with. Your answers stay on this phone and help us see which reminders are useful.</p>
      </div>
    </Sheet>
  );
}
