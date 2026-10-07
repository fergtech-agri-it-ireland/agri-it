import { useState } from 'react';
import { IN_BROWSER } from '../lib/env';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Check, CloudOff, Plus, Undo2 } from 'lucide-react';
import { useFarmCtx, useSave } from '../lib/data/farm';
import { execute, type Op } from '../lib/offline/outbox';
import { uploadDocument } from '../lib/upload';
import type { SavedSummary } from '../lib/saved';
import { fmtNum } from '../lib/format';
import { useToast } from '../components/Toast';
import { Card } from '../components/ui';

/** What just changed, then a clear next step: done, add the docket, record another, or undo. */
export default function Saved() {
  const s = useLocation().state as SavedSummary | null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useSave();
  const { farmId } = useFarmCtx();
  const [photoDone, setPhotoDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!s) return <Navigate to="/" replace />;

  async function undo() {
    if (!s?.undo) return;
    setBusy(true);
    try {
      await execute(s.undo, s.undoLabel ?? 'Undone');
      await qc.invalidateQueries({ queryKey: ['bundle'] });
      toast.show({ message: s.undoLabel ?? 'Undone', tone: 'success' });
      nav('/', { replace: true });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: 'error' });
      setBusy(false);
    }
  }

  async function attach(file: File | null) {
    if (!file || !s?.photo || !farmId) return;
    setBusy(true);
    try {
      const docId = await uploadDocument(file, farmId, s.photo.recordType, true);
      const ops: Op[] = [{ kind: 'update', table: s.photo.table, match: { id: s.photo.id }, patch: { document_id: docId } }];
      // A delivery's cost row carries the same docket
      if (s.photo.table === 'feed_transactions') ops.push({ kind: 'update', table: 'costs', match: { feed_transaction_id: s.photo.id }, patch: { document_id: docId } });
      if (await save(ops, { label: 'Photo attached' })) setPhotoDone(true);
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: 'error' });
    }
    setBusy(false);
  }

  const max = s.compare ? Math.max(s.compare.before, s.compare.after, 1) : 1;
  const canPhoto = s.photo && !photoDone && (IN_BROWSER || navigator.onLine);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1.75rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-3.5">
        <span className="flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-full bg-ok text-oninverse">
          <Check className="h-9 w-9" strokeWidth={3} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="h-display text-[2.25rem]" tabIndex={-1}>{s.title}</h1>
          <p className="mt-1 text-muted">{s.subtitle}</p>
        </div>
      </div>

      {s.queued && (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-field-light px-3 py-2 font-bold text-accent">
          <CloudOff className="h-5 w-5 shrink-0" aria-hidden />Saved on this phone. It will sync when you have signal.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {s.compare && (
          <Card>
            <p className="mb-3 font-bold">{s.compare.label}</p>
            <div className="grid grid-cols-[4rem_minmax(0,1fr)_3.5rem] items-center gap-x-2.5 gap-y-3">
              <span className="font-bold text-muted">Before</span>
              <span className="h-[1.625rem] overflow-hidden rounded-lg bg-track"><span className="block h-full bg-muted/50" style={{ width: `${(s.compare.before / max) * 100}%` }} /></span>
              <span className="numeral text-right text-3xl leading-none">{fmtNum(s.compare.before)}</span>
              <span className="font-bold">Now</span>
              <span className="h-[1.625rem] overflow-hidden rounded-lg bg-track"><span className="block h-full bg-field" style={{ width: `${(s.compare.after / max) * 100}%` }} /></span>
              <span className="numeral text-right text-3xl leading-none text-ok">{fmtNum(s.compare.after)}</span>
            </div>
            <p className="sr-only">{s.compare.label}: was {s.compare.before} {s.compare.unit}, now {s.compare.after} {s.compare.unit}.</p>
          </Card>
        )}

        {s.rows.length > 0 && (
          <div className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card shadow-lift">
            {s.rows.map((r) => (
              <div key={r.label} className="flex min-h-[4rem] items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 text-muted">{r.label}</span>
                <span className="max-w-[62%] shrink-0 text-right">
                  {r.before && r.before !== r.after && <><s className="text-[0.95rem] text-muted">{r.before}</s><span className="sr-only"> changed to </span></>}
                  <b className="block">{r.after}</b>
                  {r.sub && <span className="text-[0.95rem] text-muted">{r.sub}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {s.note && <p className="px-1 text-[0.95rem] text-muted">{s.note}</p>}
      </div>

      <div className="mt-auto flex flex-col gap-2.5 pt-6">
        {canPhoto && (
          <label className="flex min-h-[3.75rem] cursor-pointer items-center justify-center gap-2.5 rounded-[1.125rem] border-2 border-ink bg-card text-lg font-bold">
            <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" disabled={busy} onChange={(e) => attach(e.target.files?.[0] ?? null)} />
            <Camera className="h-6 w-6" aria-hidden />{busy ? 'Attaching' : 'Add the docket photo'}
          </label>
        )}
        {photoDone && <p className="text-center font-bold text-ok">Photo attached</p>}
        <Link to="/" replace className="flex min-h-[4rem] items-center justify-center rounded-[1.125rem] bg-field text-[1.1875rem] font-bold text-white">Done</Link>
        <div className="grid grid-cols-2 gap-2">
          <Link to={s.again.to} replace className="flex min-h-tap items-center justify-center gap-2 rounded-xl font-bold text-accent hover:bg-field-light">
            <Plus className="h-5 w-5" aria-hidden />{s.again.label}
          </Link>
          {s.undo && (
            <button onClick={undo} disabled={busy} className="flex min-h-tap items-center justify-center gap-2 rounded-xl font-bold text-accent hover:bg-field-light">
              <Undo2 className="h-5 w-5" aria-hidden />Undo
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
