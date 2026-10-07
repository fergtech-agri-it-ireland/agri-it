import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, CloudOff, LayoutGrid, LineChart, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBundle, useFarmCtx } from '../lib/data/farm';
import { useDerived, useSnapshotRecorder } from '../lib/data/derived';
import { discard, flush, retryFailed, subscribeOutbox, type Queued } from '../lib/offline/outbox';
import { Button, Sheet } from './ui';
import type { FarmBundle } from '../lib/types';
import { IN_BROWSER, IS_DEMO } from '../lib/env';
import { resetDemo } from '../lib/demo/client';
import { Logo } from './Logo';
import { useReminderClock } from '../lib/reminderClock';

/** Demo build only: say plainly this is sample data, and offer a clean restart. */
function DemoBanner() {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="no-print mx-auto flex max-w-xl items-center gap-3 px-3 pt-2">
      <p className="min-w-0 flex-1 rounded-xl bg-warn-bg px-3 py-2 text-[0.8125rem] font-semibold leading-snug text-warn">
        Demo farm with sample data. Changes stay on this device only.
      </p>
      {confirm ? (
        <button onClick={resetDemo} className="min-h-[2.5rem] shrink-0 rounded-full bg-inverse px-4 text-sm font-bold text-oninverse">Reset now</button>
      ) : (
        <button onClick={() => setConfirm(true)} className="min-h-[2.5rem] shrink-0 rounded-full border border-line bg-card px-4 text-sm font-bold">Reset</button>
      )}
    </div>
  );
}

const tabs = [
  { to: '/', label: 'Dashboard', Icon: LayoutGrid, end: true, also: [] as string[] },
  { to: '/diary', label: 'Diary', Icon: BookOpen, also: [] as string[] },
  null, // centre add button
  { to: '/progress', label: 'Progress', Icon: LineChart, also: ['/forecast'] },
  { to: '/more', label: 'More', Icon: MoreHorizontal, also: ['/money', '/farm', '/suppliers', '/records', '/routines', '/settings', '/ask', '/feed'] }
] as const;

function SyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  useEffect(() => subscribeOutbox(setQueue), []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const failed = queue.filter((q) => q.lastError);
  if (IN_BROWSER || (online && queue.length === 0)) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="no-print fixed left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-inverse px-4 py-2 text-sm font-bold text-oninverse shadow-lg" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        {online ? <RefreshCw className="h-4 w-4" aria-hidden /> : <CloudOff className="h-4 w-4" aria-hidden />}
        {!online ? `Offline${queue.length ? `, ${queue.length} to sync` : ''}` : failed.length ? `${failed.length} couldn't save` : `${queue.length} waiting to sync`}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sync">
        <p className="mb-3 text-muted">{online ? 'Connected.' : 'No signal. Everything you record is kept on this phone and sent when you are back online.'}</p>
        <ul className="mb-4 max-h-64 space-y-2 overflow-auto">
          {queue.map((q) => (
            <li key={q.id} className="rounded-xl border-2 border-line p-3">
              <p className="font-bold">{q.label}</p>
              {q.lastError && <p className="text-sm text-danger">{q.lastError}</p>}
              {q.lastError && <Button variant="ghost" className="mt-1 min-h-0 px-0 py-1 text-base" onClick={() => discard(q.id)}>Discard</Button>}
            </li>
          ))}
        </ul>
        {online && queue.length > 0 && (
          <Button block onClick={async () => { await (failed.length ? retryFailed() : flush()); qc.invalidateQueries({ queryKey: ['bundle'] }); }}>Sync now</Button>
        )}
      </Sheet>
    </>
  );
}

function BottomNav() {
  const loc = useLocation();
  return (
    <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map((t, i) =>
          t === null ? (
            <li key="add" className="flex justify-center">
              <Link to="/record" aria-label="Add to diary"
                className="-mt-4 flex h-14 w-14 items-center justify-center rounded-full bg-field text-white shadow-float active:bg-field-dark">
                <Plus className="h-7 w-7" strokeWidth={2.75} aria-hidden />
              </Link>
            </li>
          ) : (
            <li key={i}>
              <NavLink to={t.to} end={'end' in t ? t.end : false}
                className={({ isActive }) => {
                  const on = isActive || t.also.some((p) => loc.pathname.startsWith(p));
                  return `flex min-h-[3.75rem] flex-col items-center justify-center gap-1 text-[0.6875rem] font-bold ${on ? 'text-accent' : 'text-muted'}`;
                }}>
                <t.Icon className="h-[1.375rem] w-[1.375rem]" aria-hidden />
                {t.label}
              </NavLink>
            </li>
          )
        )}
      </ul>
    </nav>
  );
}

function Recorder({ bundle }: { bundle: FarmBundle }) {
  const d = useDerived(bundle);
  useSnapshotRecorder(bundle, d);
  useReminderClock(bundle, d.priorities.filter((p) => p.tone === 'urgent').map((p) => p.title));
  return null;
}

export function AppShell() {
  const { data } = useBundle();
  const loc = useLocation();
  const hideNav = loc.pathname.startsWith('/record') || /^\/routines\/.+/.test(loc.pathname) || /\/(new|count|edit)$/.test(loc.pathname) || loc.pathname.includes('/rule/') || loc.pathname === '/farm/types' || loc.pathname === '/money/budget';
  return (
    <>
      <SyncStatus />
      {data && <Recorder bundle={data} />}
      {IS_DEMO && <DemoBanner />}
      <Outlet />
      {!hideNav && <BottomNav />}
    </>
  );
}

/** Gatekeeper: signed in → has a farm → farm data loaded (from cache when offline). */
export function RequireFarm() {
  const { session, sessionLoading, farms, farmsLoading, farmId } = useFarmCtx();
  const bundle = useBundle();
  if (sessionLoading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  if (farmsLoading && !bundle.data) return <Splash />;
  if (!farmId && farms.length === 0 && !bundle.data) return <Navigate to="/onboarding" replace />;
  if (bundle.isError && !bundle.data) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="h-display text-xl">Can't load your farm</p>
        <p className="mt-2 text-muted">{(bundle.error as Error).message}</p>
        <Button className="mt-4" onClick={() => bundle.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!bundle.data) return <Splash />;
  return <AppShell />;
}

export function Splash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center">
      <div className="flex items-center gap-3 text-accent">
        <Logo className="h-10 w-10 animate-pulse" />
        <span className="h-display text-2xl">Agri-It</span>
      </div>
    </div>
  );
}
