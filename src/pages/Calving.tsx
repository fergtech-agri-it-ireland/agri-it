import { Check, ChevronRight, ExternalLink } from 'lucide-react';
import { StatutoryNote } from '../components/StatutoryNote';
import { ruleFor } from '../lib/deadlines';
import { Link } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { calfDeadlines, SEASON_SOURCES, seasonSteps, stepWhen } from '../lib/season';
import { stepSuggestion } from '../lib/suggestions';
import { SuggestionCard } from '../components/ReadyToApprove';
import { daysBetween, fmtDay, todayISO } from '../lib/format';
import type { CalfBirth, CalvingSeason } from '../lib/types';
import { Card, Empty, LinkButton, Screen } from '../components/ui';

/** The calving season: the plan worked out from its dates, and every calf with its deadlines. */
export default function Calving() {
  const b = useFarmData();
  const today = todayISO();
  const seasons = (b.seasons ?? []).filter((s) => !s.archived).sort((a, c) => a.calving_start.localeCompare(c.calving_start));
  if (!seasons.length) {
    return (
      <Screen title="Calving" back="/more">
        <Empty title="No calving season planned" body="Give the date the first calf is due. Agri-It lays out drying off, pre-calver minerals, calf tags and the calving checklist, then keeps every calf's tagging and registration dates."
          action={<LinkButton to="/calving/season/new" variant="hivis">Plan it</LinkButton>} />
      </Screen>
    );
  }
  return (
    <Screen title="Calving" back="/more" right={<LinkButton to="/record/calf" variant="hivis">Calf born</LinkButton>}>
      {seasons.map((s) => <SeasonPlan key={s.id} season={s} today={today} />)}
      <Births season={null} />
      <LinkButton to="/calving/season/new" variant="secondary" block>Plan another season</LinkButton>
    </Screen>
  );
}

function SeasonPlan({ season, today }: { season: CalvingSeason; today: string }) {
  const b = useFarmData();
  const steps = seasonSteps(season, b.decisions ?? [], today, b.farm);
  const born = (b.births ?? []).filter((x) => x.season_id === season.id).reduce((n, x) => n + x.calves, 0);
  const toFirst = daysBetween(today, season.calving_start);
  return (
    <>
      <Card className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">{season.label}</h2>
          <Link to={`/calving/season/${season.id}`} className="text-sm font-bold text-accent">Change</Link>
        </div>
        <p>{season.herd === 'dairy' ? 'Dairy' : 'Suckler'} herd. First calf due {fmtDay(season.calving_start)}{season.calving_end ? `, last ${fmtDay(season.calving_end)}` : ''}.{toFirst > 0 ? ` ${toFirst} days to go.` : ''}</p>
        {(season.cows_due || born > 0) && <p className="font-bold">{born} calved{season.cows_due ? ` of ${season.cows_due} due` : ''}</p>}
      </Card>
      <section aria-label={`${season.label} plan`} className="overflow-hidden rounded-[1.125rem] bg-card shadow-lift">
        <h2 className="px-4 pt-4 text-[1.0625rem] font-bold">The plan</h2>
        <ul className="divide-y divide-line">
          {steps.map((step) => {
            const when = stepWhen(step, today);
            if (step.status === 'open' && when && when !== 'later') return <SuggestionCard key={step.key} s={stepSuggestion(b, season, step, today, when)} />;
            return (
              <li key={step.key} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${step.status === 'done' ? 'bg-field text-white' : 'border border-line'}`}>
                  {step.status === 'done' && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[0.9375rem]">{step.title}</b>
                  <span className="text-[0.8125rem] text-muted">
                    {fmtDay(step.date)}{step.until ? ` to ${fmtDay(step.until)}` : ''}
                    {step.status === 'done' ? ' · Done' : step.status === 'dismissed' ? ' · Not doing' : step.status === 'snoozed' ? ` · Put off to ${fmtDay(step.snoozedUntil)}` : ''}
                  </span>
                  {step.status === 'open' && <span className="block text-[0.8125rem]">{step.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="px-4 pb-3 pt-1 text-[0.8125rem] text-muted">
          Timings from {[...new Set(steps.flatMap((s) => s.sourceCodes))].map((c) => SEASON_SOURCES[c]).map((src, i) => (
            <a key={src.code} href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-accent underline">{i > 0 && ', '}{src.publisher}: {src.title}<ExternalLink className="h-3 w-3" aria-hidden /></a>
          ))}. Agri-It never says how much to feed: that stays with you and your adviser.
        </p>
      </section>
      <Births season={season} />
    </>
  );
}

function Births({ season }: { season: CalvingSeason | null }) {
  const b = useFarmData();
  const save = useSave();
  const today = todayISO();
  const list = (b.births ?? []).filter((x) => (season ? x.season_id === season.id : !x.season_id || !(b.seasons ?? []).some((s) => s.id === x.season_id && !s.archived)))
    .sort((a, c) => c.born_on.localeCompare(a.born_on));
  if (!list.length) return null;
  const herd = season?.herd ?? (b.farm.enterprises?.includes('dairy') ? 'dairy' : 'suckler');
  async function mark(x: CalfBirth, field: 'tagged_on' | 'registered_on', value: string | null) {
    await save([{ kind: 'update', table: 'calf_births', match: { id: x.id }, patch: { [field]: value } }], {
      label: value ? (field === 'tagged_on' ? 'Marked tagged' : 'Marked registered') : 'Undone',
      patch: (bb) => ({ ...bb, births: bb.births.map((y) => (y.id === x.id ? { ...y, [field]: value } : y)) }),
      undo: [{ kind: 'update', table: 'calf_births', match: { id: x.id }, patch: { [field]: x[field] } }]
    });
  }
  return (
    <section aria-label="Calves born" className="overflow-hidden rounded-[1.125rem] bg-card shadow-lift">
      <h2 className="px-4 pt-4 text-[1.0625rem] font-bold">Calves born{season ? '' : ' (no season)'}</h2>
      <ul className="divide-y divide-line">
        {list.map((x) => {
          const d = calfDeadlines(x, b.farm.jurisdiction, herd);
          const pill = (field: 'tagged_on' | 'registered_on', by: string | null, doneOn: string | null, label: string) => (
            <button onClick={() => mark(x, field, doneOn ? null : today)} aria-pressed={!!doneOn}
              className={`min-h-[2.75rem] flex-1 rounded-full border px-3 text-sm font-bold ${doneOn ? 'border-field bg-field text-white' : by && by < today ? 'border-danger text-danger' : 'border-line'}`}>
              {doneOn ? `${label} ✓` : `${label} by ${fmtDay(by)}`}
            </button>
          );
          return (
            <li key={x.id} className="space-y-2 px-4 py-3">
              <p className="font-semibold">{x.calves === 1 ? 'Calf' : `${x.calves} calves`} born {fmtDay(x.born_on)}{x.notes ? `: ${x.notes}` : ''}</p>
              <div className="flex gap-2">
                {pill('tagged_on', d.tagBy, x.tagged_on, 'Tagged')}
                {pill('registered_on', d.registerBy, x.registered_on, 'Registered')}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-4 pb-3 pt-1 text-[0.8125rem] text-muted">
      </p>
      <div className="px-4 pb-1"><StatutoryNote rules={[ruleFor('calf_tag', b.farm.jurisdiction, herd === 'dairy' ? 'dairy' : 'other', today), ruleFor('calf_register', b.farm.jurisdiction, herd === 'dairy' ? 'dairy' : 'other', today)]} /></div>
      <p className="px-4 pb-3 pt-1 text-[0.8125rem] text-muted">
        <Link to="/record/calf" className="ml-1 inline-flex items-center font-bold text-accent">Add a calf<ChevronRight className="h-4 w-4" aria-hidden /></Link>
      </p>
    </section>
  );
}
