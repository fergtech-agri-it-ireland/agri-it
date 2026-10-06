import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Banknote, CalendarRange, ClipboardList, CloudOff, Home, Milk, Package, PackageCheck, Plus, RefreshCw, Receipt, Ruler, Tractor, Beef } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBundle, useFarmCtx } from '../lib/data/farm';
import { useDerived, useSnapshotRecorder } from '../lib/data/derived';
import { discard, flush, retryFailed, subscribeOutbox, type Queued } from '../lib/offline/outbox';
import { Button, Sheet } from './ui';
import type { FarmBundle } from '../lib/types';
import { IS_DEMO } from '../lib/env';
import { resetDemo } from '../lib/demo/client';
import { Logo } from './Logo';

/** Demo build only: say plainly this is sample data, and offer a clean restart. */
function DemoBanner() {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="no-print mx-auto flex max-w-xl items-center gap-3 px-3 pt-2">
      <p className="min-w-0 flex-1 rounded-xl bg-hivis px-3 py-2 text-sm font-bold leading-snug text-ink">
        Demo farm with sample data. Changes stay on this device only.
      </p>
      {confirm ? (
        <button onClick={resetDemo} className="min-h-tap shrink-0 rounded-xl bg-ink px-3 text-sm font-bold text-white">Reset now</button>
      ) : (
        <button onClick={() => setConfirm(true)} className="min-h-tap shrink-0 rounded-xl border-2 border-ink/80 bg-white px-3 text-sm font-bold">Reset</button>
      )}
    </div>
  );
}

const tabs = [
  { to: '/', label: 'Today', Icon: Home, end: true },
  { to: '/forecast', label: 'Forecast', Icon: CalendarRange },
  null, // centre record button
  { to: '/money', label: 'Money', Icon: Banknote },
  { to: '/farm', label: 'Farm', Icon: Tractor }
] as const;

/** Farmer intents from spec section 8, each one tap from anywhere. */
const quick = [
  { to: '/record/delivery', label: 'Feed arrived', Icon: PackageCheck },
  { to: '/record/milk', label: 'Milk cheque', Icon: Milk },
  { to: '/record/sale', label: 'Sold animals', Icon: Beef },
  { to: '/record/cost', label: 'Paid a bill', Icon: Receipt },
  { to: '/record/order', label: 'Ordered feed', Icon: Package },
  { to: '/record/count', label: 'Stock count', Icon: Ruler },
  { to: '/records/new', label: 'Farm record', Icon: ClipboardList },
  { to: '/record/income', label: 'Other income', Icon: Banknote }
];

export function RecordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  return (
    <Sheet open={open} onClose={onClose} title="Record">
      <div className="grid grid-cols-2 gap-3 pb-2">
        {quick.map(({ to, label, Icon }) => (
          <button key={to} onClick={() => { onClose(); nav(to); }}
            className="flex min-h-[5.5rem] flex-col items-start justify-between rounded-2xl border-2 border-line bg-pasture p-3 text-left hover:border-field active:bg-field-light">
            <Icon className="h-7 w-7 text-field" aria-hidden />
            <span className="text-lg font-bold leading-tight">{label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

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
  if (online && queue.length === 0) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="no-print fixed left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white shadow-lg" style={{ marginTop: 'env(safe-area-inset-top)' }}>
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

function BottomNav({ onRecord }: { onRecord: () => void }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map((t, i) =>
          t === null ? (
            <li key="rec" className="flex justify-center">
              <button onClick={onRecord} aria-label="Record something"
                className="-mt-6 flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center rounded-full border-4 border-white bg-hivis text-ink shadow-lg active:bg-hivis-dark">
                <Plus className="h-9 w-9" strokeWidth={3} aria-hidden />
              </button>
            </li>
          ) : (
            <li key={i}>
              <NavLink to={t.to} end={'end' in t ? t.end : false}
                className={({ isActive }) => `flex min-h-[4.25rem] flex-col items-center justify-center gap-0.5 text-[0.8rem] font-bold ${isActive ? 'text-field' : 'text-muted'}`}>
                {({ isActive }) => (
                  <>
                    <span className={`flex h-8 w-14 items-center justify-center rounded-full ${isActive ? 'bg-field-light' : ''}`}><t.Icon className="h-6 w-6" aria-hidden /></span>
                    {t.label}
                  </>
                )}
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
  return null;
}

export function AppShell() {
  const [recordOpen, setRecordOpen] = useState(false);
  const { data } = useBundle();
  const loc = useLocation();
  const hideNav = loc.pathname.startsWith('/record') || /\/(new|count|edit)$/.test(loc.pathname) || loc.pathname.includes('/rule/');
  return (
    <>
      <SyncStatus />
      {data && <Recorder bundle={data} />}
      {IS_DEMO && <DemoBanner />}
      <Outlet />
      {!hideNav && <BottomNav onRecord={() => setRecordOpen(true)} />}
      <RecordSheet open={recordOpen} onClose={() => setRecordOpen(false)} />
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
        <p className="h-display text-3xl">Can't load your farm</p>
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
      <div className="flex items-center gap-3 text-field">
        <Logo className="h-10 w-10 animate-pulse" />
        <span className="h-display text-3xl">Agri-It</span>
      </div>
    </div>
  );
}
