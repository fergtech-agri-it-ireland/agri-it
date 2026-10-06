import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, Check, Info } from 'lucide-react';

export type DialTone = 'ok' | 'warn' | 'urgent' | 'info';

const ring: Record<DialTone, string> = { ok: 'stroke-ok', warn: 'stroke-hivis-dark', urgent: 'stroke-danger', info: 'stroke-field' };
const chip: Record<DialTone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  urgent: 'bg-danger-bg text-danger',
  info: 'bg-field-light text-accent'
};
const ChipIcon = { ok: Check, warn: AlertTriangle, urgent: AlertOctagon, info: Info };

/**
 * One of the three Today dials (after WHOOP's recovery/strain/sleep dials).
 * The ring only fills against a real denominator (your feed target, winter need, 90-day outlook),
 * and the status is always icon + words so it reads in glare and without colour.
 */
export function Dial({ to, label, value, unit, fraction, tone, status, description }: {
  to: string; label: string; value: string; unit: string; fraction: number; tone: DialTone; status: string; description: string;
}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  const Icon = ChipIcon[tone];
  return (
    <Link to={to} aria-label={`${label}: ${description}`}
      className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-0.5 py-1 hover:bg-pasture active:bg-field-light">
      <span className="relative block h-[6.5rem] w-[6.5rem]" aria-hidden>
        <svg viewBox="0 0 104 104" className="h-full w-full -rotate-90">
          <circle cx="52" cy="52" r={r} fill="none" strokeWidth="10" className="stroke-track" />
          {f > 0 && <circle cx="52" cy="52" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className={ring[tone]} strokeDasharray={`${f * c} ${c}`} />}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`numeral leading-[0.9] ${value.length > 4 ? 'text-[1.6rem]' : value.length > 3 ? 'text-[2.1rem]' : 'text-[2.4rem]'}`}>{value}</span>
          <span className="text-[0.8rem] font-bold text-muted">{unit}</span>
        </span>
      </span>
      <span className="text-lg font-bold leading-none" aria-hidden>{label}</span>
      <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[0.8rem] font-bold ${chip[tone]}`} aria-hidden>
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.75} /><span className="truncate">{status}</span>
      </span>
    </Link>
  );
}
