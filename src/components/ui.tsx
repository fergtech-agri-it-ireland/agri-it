import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, CircleHelp, Info, Mic, Minus, Phone, Plus, X } from 'lucide-react';
import type { Confidence, ISODate } from '../lib/types';
import { addDays, fmtDate, todayISO } from '../lib/format';
import { telHref } from '../lib/suppliers';

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------
export function Screen({ title, back, right, children, sub }: { title: string; back?: string | true; right?: ReactNode; children: ReactNode; sub?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="pad-bottom mx-auto w-full max-w-xl">
      <header className="sticky top-0 z-20 flex min-h-[4rem] items-center gap-2 bg-pasture/95 px-3 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {back && (
          <button aria-label="Back" onClick={() => (back === true ? nav(-1) : nav(back))}
            className="-ml-1 flex min-h-tap min-w-tap items-center justify-center rounded-full hover:bg-field-light">
            <ArrowLeft className="h-7 w-7" />
          </button>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="h-display truncate text-[2rem]">{title}</h1>
          {sub && <p className="truncate text-sm text-muted">{sub}</p>}
        </div>
        {right}
      </header>
      <main className="space-y-4 px-3 pt-1">{children}</main>
    </div>
  );
}

export function Card({ children, className = '', as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  // Let a caller's background replace the default white (Tailwind can't resolve two bg-* classes by order)
  const bg = /(^|\s)bg-/.test(className) ? '' : 'bg-white';
  return <As className={`rounded-2xl p-4 shadow-lift ${bg} ${className}`}>{children}</As>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 pt-2">
      <h2 className="h-display text-2xl">{children}</h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons: min 56px tall. Primary actions sit at the bottom, in thumb reach.
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'hivis' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-field text-white hover:bg-field-dark active:bg-field-dark',
  hivis: 'bg-hivis text-ink hover:bg-hivis-dark active:bg-hivis-dark',
  secondary: 'bg-white text-ink border-2 border-ink/80 hover:bg-pasture',
  ghost: 'text-field hover:bg-field-light',
  danger: 'bg-white text-danger border-2 border-danger hover:bg-danger-bg'
};
export function Button({ variant = 'primary', block, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  return (
    <button {...rest} className={`inline-flex min-h-tap items-center justify-center gap-2 rounded-2xl px-5 text-lg font-bold transition-colors disabled:opacity-50 ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}>
      {children}
    </button>
  );
}
export function LinkButton({ to, variant = 'primary', block, children, className = '' }: { to: string; variant?: Variant; block?: boolean; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`inline-flex min-h-tap items-center justify-center gap-2 rounded-2xl px-5 text-lg font-bold ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}>
      {children}
    </Link>
  );
}
export function CallButton({ phone, label, variant = 'hivis', block }: { phone: string; label?: string; variant?: Variant; block?: boolean }) {
  return (
    <a href={telHref(phone)} className={`inline-flex min-h-tap items-center justify-center gap-2 rounded-2xl px-5 text-lg font-bold ${variants[variant]} ${block ? 'w-full' : ''}`}>
      <Phone className="h-5 w-5" aria-hidden /> {label ?? phone}
    </a>
  );
}

/** Sticky save bar: the thumb never has to reach for the top of the screen. */
export function SaveBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 z-30 border-t border-line bg-white/95 px-3 py-3 backdrop-blur" style={{ bottom: 0, paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
      <div className="mx-auto flex max-w-xl gap-3">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inputs: numeric keypad, units visible, big text, minimal typing
// ---------------------------------------------------------------------------
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function NumberInput({ label, value, onChange, unit, hint, placeholder, step = 'any', autoFocus, integer }: {
  label: string; value: string; onChange: (v: string) => void; unit?: string; hint?: ReactNode; placeholder?: string; step?: string; autoFocus?: boolean; integer?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="relative">
        <input id={id} className="input pr-16 text-xl font-bold" type="number" inputMode={integer ? 'numeric' : 'decimal'} step={step}
          value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-bold text-muted">{unit}</span>}
      </div>
    </Field>
  );
}

export function TextInput({ label, value, onChange, hint, placeholder, voice, list, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; placeholder?: string; voice?: boolean; list?: string; autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex gap-2">
        <input id={id} className="input" value={value} placeholder={placeholder} list={list} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
        {voice && <VoiceButton onText={(t) => onChange(value ? `${value} ${t}` : t)} />}
      </div>
    </Field>
  );
}

/** Big −/+ stepper for counts: no keyboard needed for small changes. */
export function Stepper({ label, value, onChange, step = 1, min = 0, unit, hint, decimals = 0 }: {
  label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; unit?: string; hint?: ReactNode; decimals?: number;
}) {
  const id = useId();
  const set = (n: number) => onChange(Math.max(min, Number(n.toFixed(decimals))));
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex items-stretch gap-2">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => set(value - step)} className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border-2 border-ink/80 bg-white active:bg-pasture"><Minus className="h-6 w-6" /></button>
        <div className="relative flex-1">
          <input id={id} className="input text-center text-2xl font-bold" type="number" inputMode={decimals ? 'decimal' : 'numeric'} value={Number.isFinite(value) ? value : ''}
            onChange={(e) => set(Number(e.target.value || 0))} />
          {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted">{unit}</span>}
        </div>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + step)} className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border-2 border-ink/80 bg-white active:bg-pasture"><Plus className="h-6 w-6" /></button>
      </div>
    </Field>
  );
}

/** Large tap-to-choose options instead of dropdowns. */
export function Chips<T extends string>({ label, options, value, onChange, hint, columns }: {
  label?: string; options: { value: T; label: ReactNode; sub?: string }[]; value: T | null; onChange: (v: T) => void; hint?: ReactNode; columns?: 2 | 3;
}) {
  const grid = columns === 3 ? 'grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'flex flex-wrap';
  return (
    <fieldset>
      {label && <legend className="label">{label}</legend>}
      <div className={`${columns ? 'grid' : ''} ${grid} gap-2`}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
              className={`min-h-tap rounded-xl border-2 px-4 py-2 text-left font-bold leading-tight ${on ? 'border-field bg-field text-white' : 'border-line bg-white text-ink hover:border-ink/60'}`}>
              <span className="flex items-center gap-2">{on && <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />}{o.label}</span>
              {o.sub && <span className={`block text-sm font-normal ${on ? 'text-white/85' : 'text-muted'}`}>{o.sub}</span>}
            </button>
          );
        })}
      </div>
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}

/** Today / Yesterday / pick: most records are for today. */
export function DateChips({ label, value, onChange, allowFuture }: { label: string; value: ISODate; onChange: (d: ISODate) => void; allowFuture?: boolean }) {
  const today = todayISO();
  const quick = allowFuture ? [today, addDays(today, 1), addDays(today, 2)] : [today, addDays(today, -1)];
  const names = allowFuture ? ['Today', 'Tomorrow', 'In 2 days'] : ['Today', 'Yesterday'];
  const isQuick = quick.includes(value);
  const id = useId();
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {quick.map((d, i) => (
          <button key={d} type="button" aria-pressed={value === d} onClick={() => onChange(d)}
            className={`min-h-tap rounded-xl border-2 px-4 font-bold ${value === d ? 'border-field bg-field text-white' : 'border-line bg-white'}`}>{names[i]}</button>
        ))}
        <label htmlFor={id} className={`relative flex min-h-tap flex-1 items-center rounded-xl border-2 px-3 font-bold ${!isQuick ? 'border-field bg-field-light' : 'border-line bg-white'}`}>
          <span className="sr-only">Pick another date</span>
          <input id={id} type="date" className="w-full bg-transparent" value={value} max={allowFuture ? undefined : today} onChange={(e) => e.target.value && onChange(e.target.value)} />
        </label>
      </div>
      {!isQuick && <p className="hint">{fmtDate(value)}</p>}
    </fieldset>
  );
}

/** Dictation for notes: hands are often busy or gloved. Uses the browser's speech API where available. */
export function VoiceButton({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  type SR = new () => { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void };
  const W = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  const Impl = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  useEffect(() => () => recRef.current?.stop(), []);
  if (!Impl) return null;
  return (
    <button type="button" aria-label={on ? 'Stop dictation' : 'Dictate'} aria-pressed={on}
      onClick={() => {
        if (on) { recRef.current?.stop(); return; }
        const r = new Impl();
        r.lang = 'en-IE';
        r.interimResults = false;
        r.onresult = (e) => onText(e.results[0][0].transcript);
        r.onend = () => setOn(false);
        recRef.current = r;
        setOn(true);
        r.start();
      }}
      className={`flex min-h-tap min-w-tap items-center justify-center rounded-xl border-2 ${on ? 'border-danger bg-danger-bg text-danger' : 'border-line bg-white'}`}>
      <Mic className="h-6 w-6" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status: always icon + words, never colour alone (sunlight, colour-blindness)
// ---------------------------------------------------------------------------
export function ConfidenceBadge({ level }: { level: Confidence }) {
  const map: Record<Confidence, { text: string; cls: string; Icon: typeof Info }> = {
    high: { text: 'High confidence', cls: 'bg-ok-bg text-ok', Icon: CheckCircle2 },
    medium: { text: 'Medium confidence', cls: 'bg-warn-bg text-warn', Icon: Info },
    low: { text: 'Low confidence', cls: 'bg-danger-bg text-danger', Icon: AlertTriangle },
    scenario: { text: 'What-if scenario', cls: 'bg-field-light text-field', Icon: CircleHelp }
  };
  const m = map[level];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold ${m.cls}`}><m.Icon className="h-4 w-4" aria-hidden />{m.text}</span>;
}

export function ToneIcon({ tone, className = 'h-6 w-6' }: { tone: 'urgent' | 'warn' | 'info' | 'ok'; className?: string }) {
  if (tone === 'urgent') return <AlertOctagon className={`${className} text-danger`} aria-label="Urgent" />;
  if (tone === 'warn') return <AlertTriangle className={`${className} text-warn`} aria-label="Warning" />;
  if (tone === 'ok') return <CheckCircle2 className={`${className} text-ok`} aria-label="OK" />;
  return <Info className={`${className} text-field`} aria-label="Info" />;
}

/** Simple first, detail on demand: assumptions and formulas one tap deeper. */
export function Explain({ title = 'How this is worked out', children, defaultOpen }: { title?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-xl border-2 border-line bg-white" open={defaultOpen}>
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-2 px-4 font-bold">
        {title}
        <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-2 border-t border-line px-4 py-3 text-[0.95rem]">{children}</div>
    </details>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card className="text-center">
      <p className="h-display text-2xl">{title}</p>
      {body && <p className="mt-1 text-muted">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

export function Row({ to, title, sub, right, icon }: { to?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  const inner = (
    <>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-bold leading-snug">{title}</div>
        {sub && <div className="text-sm text-muted">{sub}</div>}
      </div>
      {right}
    </>
  );
  const cls = 'flex min-h-tap items-center gap-3 px-4 py-3';
  return to ? <Link to={to} className={`${cls} hover:bg-pasture`}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

export function List({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-lift">{children}</div>;
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="anim-sheet absolute inset-x-0 bottom-0 mx-auto max-w-xl rounded-t-3xl bg-white px-4 pt-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-line" aria-hidden />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="h-display text-3xl">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="flex min-h-tap min-w-tap items-center justify-center rounded-full hover:bg-pasture"><X className="h-7 w-7" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
