import { CircleCheck } from 'lucide-react';
import type { Priority } from '../lib/data/derived';
import type { Suggestion } from '../lib/suggestions';
import { ReadyToApprove } from './ReadyToApprove';
import { Attention } from './Attention';

/**
 * One place for everything waiting on the farmer: what Agri-It has drafted for a one-tap approve,
 * then what needs attention, overdue first. Both lists keep their own rules (Not now, bundles,
 * nothing recorded before approval); this is the one card around them.
 */
export function TodoCard({ farmId, today, suggestions, priorities, alsoShown }: { farmId: string; today: string; suggestions: Suggestion[]; priorities: Priority[]; alsoShown: string[] }) {
  const empty = suggestions.length === 0 && priorities.length === 0;
  return (
    <section aria-label="To do" className="overflow-hidden rounded-[1.125rem] bg-card shadow-lift">
      <div className="flex items-baseline gap-2 px-4 pt-4">
        <h2 className="flex-1 text-[1.0625rem] font-bold">To do</h2>
        {suggestions.length > 0 && <span className="text-[0.8125rem] text-muted">{suggestions.length} ready to approve</span>}
      </div>
      {empty && (
        <p className="flex items-center gap-2 px-4 pb-4 pt-2 text-[0.9375rem] text-muted"><CircleCheck className="h-5 w-5 text-accent" aria-hidden />All clear. Nothing needs you right now.</p>
      )}
      <ReadyToApprove items={suggestions} embedded />
      <Attention farmId={farmId} items={priorities} today={today} alsoShown={alsoShown} embedded />
      <div className="h-2" aria-hidden />
    </section>
  );
}
