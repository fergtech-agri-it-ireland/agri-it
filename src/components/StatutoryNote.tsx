import { ExternalLink } from 'lucide-react';
import { needsRecheck, ruleSourceLine, type StatutoryRule } from '../lib/deadlines';
import { todayISO } from '../lib/format';

/**
 * Under any statutory deadline (review G06): the rule as the law puts it, its official source
 * and the day it was checked, and a plain reminder that the official system is the record.
 */
export function StatutoryNote({ rules }: { rules: (StatutoryRule | null)[] }) {
  const list = [...new Map(rules.filter((r): r is StatutoryRule => !!r).map((r) => [`${r.id}:${r.herd}:${r.version}`, r])).values()];
  if (!list.length) return null;
  const today = todayISO();
  const systems = [...new Set(list.map((r) => r.officialSystem))];
  return (
    <div className="space-y-1.5 text-[0.8125rem] text-muted" data-testid="statutory-note">
      {list.map((r) => (
        <p key={`${r.id}:${r.herd}`}>
          {r.text}{' '}
          <a href={r.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-accent underline">
            {ruleSourceLine(r).replace(/\.$/, '')}<ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          {needsRecheck(r, today) && <span className="ml-1 font-bold text-warn">Not rechecked since: confirm it with the source.</span>}
        </p>
      ))}
      <p className="font-semibold text-ink/80">Agri-It's dates are reminders, not the official record. Check your deadlines in {systems.join(' or ')}.</p>
    </div>
  );
}
