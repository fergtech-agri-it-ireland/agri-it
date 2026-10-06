import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { FarmBundle } from '../types';
import { addDays, todayISO } from '../format';
import { execute, flush, type Op } from '../offline/outbox';
import { useToast } from '../../components/Toast';

// ---------------------------------------------------------------------------
// Session + selected farm
// ---------------------------------------------------------------------------
interface FarmCtx {
  session: Session | null;
  sessionLoading: boolean;
  farmId: string | null;
  farms: { id: string; name: string }[];
  farmsLoading: boolean;
  selectFarm: (id: string) => void;
  refreshFarms: () => Promise<unknown>;
}
const Ctx = createContext<FarmCtx | null>(null);
const FARM_KEY = 'agri-it:farm';

export function FarmProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(FARM_KEY));
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') {
        qc.clear();
        localStorage.removeItem(FARM_KEY);
        setSelected(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const userId = session?.user.id;
  const farmsQ = useQuery({
    queryKey: ['farms', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('farms').select('id, name').order('created_at');
      if (error) throw error;
      return data as { id: string; name: string }[];
    }
  });

  const farms = farmsQ.data ?? [];
  const farmId = selected && farms.some((f) => f.id === selected) ? selected : farms[0]?.id ?? (farmsQ.isFetched ? null : selected);

  const selectFarm = useCallback((id: string) => {
    localStorage.setItem(FARM_KEY, id);
    setSelected(id);
  }, []);

  // Replay offline writes whenever we come back online
  useEffect(() => {
    const onOnline = () => { flush().then(({ sent }) => { if (sent) qc.invalidateQueries({ queryKey: ['bundle'] }); }); };
    window.addEventListener('online', onOnline);
    if (navigator.onLine && userId) onOnline();
    return () => window.removeEventListener('online', onOnline);
  }, [qc, userId]);

  const value = useMemo<FarmCtx>(() => ({
    session, sessionLoading, farmId, farms, farmsLoading: farmsQ.isLoading, selectFarm,
    refreshFarms: () => farmsQ.refetch()
  }), [session, sessionLoading, farmId, farms, farmsQ, selectFarm]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFarmCtx() {
  const c = useContext(Ctx);
  if (!c) throw new Error('FarmProvider missing');
  return c;
}

// ---------------------------------------------------------------------------
// The farm bundle: small-farm data volumes make one cached fetch the simplest
// way to get instant screens and full offline reads.
// ---------------------------------------------------------------------------
async function fetchBundle(farmId: string): Promise<FarmBundle> {
  const since = addDays(todayISO(), -800);
  const q = <T,>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) =>
    Promise.resolve(p).then((r) => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as T; });

  const [farm, groups, suppliers, branches, supplierSettings, products, txns, rules, silage, benchmarks, evidence, income, costs, budget, records, documents, jobs, routines, completions, feedLogs] =
    await Promise.all([
      q(supabase.from('farms').select('*').eq('id', farmId).single()),
      q(supabase.from('animal_groups').select('*').eq('farm_id', farmId).order('sort_order').order('name')),
      q(supabase.from('suppliers').select('*').or(`farm_id.is.null,farm_id.eq.${farmId}`).order('name')),
      q(supabase.from('supplier_branches').select('*')),
      q(supabase.from('farm_supplier_settings').select('*').eq('farm_id', farmId)),
      q(supabase.from('feed_products').select('*').eq('farm_id', farmId).order('name')),
      q(supabase.from('feed_transactions').select('*').eq('farm_id', farmId).order('effective_on')),
      q(supabase.from('feeding_rules').select('*').eq('farm_id', farmId).order('start_date')),
      q(supabase.from('silage_stores').select('*').eq('farm_id', farmId).order('created_at')),
      q(supabase.from('forage_benchmarks').select('*')),
      q(supabase.from('evidence_sources').select('*')),
      q(supabase.from('income').select('*').eq('farm_id', farmId).gte('occurred_on', since).order('occurred_on', { ascending: false })),
      q(supabase.from('costs').select('*').eq('farm_id', farmId).gte('occurred_on', since).order('occurred_on', { ascending: false })),
      q(supabase.from('budget_lines').select('*').eq('farm_id', farmId)),
      q(supabase.from('farm_records').select('*').eq('farm_id', farmId).order('occurred_on', { ascending: false })),
      q(supabase.from('documents').select('*').eq('farm_id', farmId).order('created_at', { ascending: false })),
      q(supabase.from('jobs').select('*').eq('farm_id', farmId).order('due_on')),
      q(supabase.from('routines').select('*').eq('farm_id', farmId).order('created_at')),
      q(supabase.from('routine_completions').select('*').eq('farm_id', farmId).gte('due_date', since).order('due_date')),
      q(supabase.from('feed_use_logs').select('*').eq('farm_id', farmId).gte('used_on', since).order('used_on'))
    ]);
  return { farm, groups, suppliers, branches, supplierSettings, products, txns, rules, silage, benchmarks, evidence, income, costs, budget, records, documents, jobs, routines, completions, feedLogs } as unknown as FarmBundle;
}

const LIST_KEYS = ['groups', 'suppliers', 'branches', 'supplierSettings', 'products', 'txns', 'rules', 'silage', 'benchmarks', 'evidence', 'income', 'costs', 'budget', 'records', 'documents', 'jobs', 'routines', 'completions', 'feedLogs'] as const;

/** Data cached by an older version of the app can lack newer lists. Treat a missing list as empty. */
export function normalizeBundle(b: FarmBundle): FarmBundle {
  const missing = LIST_KEYS.filter((k) => !Array.isArray((b as unknown as Record<string, unknown>)[k]));
  if (!missing.length) return b;
  const fixed = { ...b } as unknown as Record<string, unknown>;
  for (const k of missing) fixed[k] = [];
  return fixed as unknown as FarmBundle;
}

export function useBundle() {
  const { farmId } = useFarmCtx();
  return useQuery({
    queryKey: ['bundle', farmId],
    enabled: !!farmId,
    queryFn: () => fetchBundle(farmId!),
    select: normalizeBundle,
    staleTime: 30_000
  });
}

/** For screens rendered inside <RequireFarm>, the bundle is guaranteed loaded. */
export function useFarmData(): FarmBundle {
  const { data } = useBundle();
  if (!data) throw new Error('Farm data not loaded');
  return data;
}

// ---------------------------------------------------------------------------
// Save: optimistic cache patch → execute (or queue offline) → toast with undo
// ---------------------------------------------------------------------------
export interface SaveOptions {
  label: string; // "Delivery saved"
  patch?: (b: FarmBundle) => FarmBundle; // optimistic update so forecasts move instantly
  undo?: Op[];
  undoLabel?: string;
  /** Skip the success toast: the caller shows its own summary (the Saved screen). Errors still toast. */
  quiet?: boolean;
}

/** false = not saved (an error was shown); otherwise whether it reached the server or is queued offline. */
export type SaveResult = false | 'saved' | 'queued';

export function useSave() {
  const qc = useQueryClient();
  const { farmId } = useFarmCtx();
  const toast = useToast();

  return useCallback(async (ops: Op[], opts: SaveOptions): Promise<SaveResult> => {
    const key = ['bundle', farmId];
    const cached = qc.getQueryData<FarmBundle>(key);
    const previous = cached && normalizeBundle(cached);
    if (opts.patch && previous) qc.setQueryData<FarmBundle>(key, opts.patch(previous));
    try {
      const { queued } = await execute(ops, opts.label);
      if (!queued) await qc.invalidateQueries({ queryKey: key });
      if (opts.quiet) return queued ? 'queued' : 'saved';
      toast.show({
        message: queued ? `${opts.label}. Will sync when you have signal.` : opts.label,
        tone: queued ? 'info' : 'success',
        action: opts.undo
          ? {
              label: 'Undo',
              run: async () => {
                if (previous) qc.setQueryData(key, previous);
                await execute(opts.undo!, opts.undoLabel ?? 'Undone');
                await qc.invalidateQueries({ queryKey: key });
              }
            }
          : undefined
      });
      return queued ? 'queued' : 'saved';
    } catch (e) {
      if (previous) qc.setQueryData(key, previous);
      toast.show({ message: (e as Error).message || 'Could not save. Check the details and try again.', tone: 'error' });
      return false;
    }
  }, [qc, farmId, toast]);
}
