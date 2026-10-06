import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
interface ToastData { message: string; tone: Tone; action?: { label: string; run: () => void | Promise<void> } }
interface ToastApi { show: (t: ToastData) => void }

const Ctx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(Ctx);

/** Undo instead of "Are you sure?": saving is instant, mistakes are one tap to reverse. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastData & { key: number }) | null>(null);
  const timer = useRef<number>();

  const show = useCallback((t: ToastData) => {
    window.clearTimeout(timer.current);
    setToast({ ...t, key: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), t.action ? 7000 : 4000);
  }, []);

  const Icon = toast?.tone === 'error' ? AlertTriangle : toast?.tone === 'info' ? CloudOff : CheckCircle2;

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3" style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
        {toast && (
          <div key={toast.key} role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`anim-toast pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-oninverse shadow-lg ${toast.tone === 'error' ? 'bg-danger' : 'bg-inverse'}`}>
            <Icon aria-hidden className="h-6 w-6 shrink-0" />
            <p className="flex-1 font-bold leading-snug">{toast.message}</p>
            {toast.action && (
              <button className="min-h-tap rounded-xl px-4 font-bold underline underline-offset-4"
                onClick={async () => { setToast(null); await toast.action!.run(); }}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
