import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDot, Clock, MinusCircle } from 'lucide-react';
import { useFarmData, useSave } from '../lib/data/farm';
import { setupPlan, setupProgress, withMark, type SetupStage, type StageKey, type StepKey } from '../lib/setup';
import { Button, Card, Screen } from '../components/ui';
import { ReleaseLine } from '../components/ReleaseLine';
import {
  AccountantStep, BankStep, CalvingStep, CropsStep, FieldsStep, GroupsStep, HerdStep, JobsStep, LandStep, LoansStep, MealStep,
  MilkStep, RegularStep, SchemesStep, SilageStep, WhereStep, YearStep, type StepProps
} from '../components/setup/SetupSteps';

const STEP: Record<StepKey, (p: StepProps) => JSX.Element> = {
  land: LandStep, herd: HerdStep, groups: GroupsStep, where: WhereStep, calving: CalvingStep, meal: MealStep, silage: SilageStep,
  jobs: JobsStep, crops: CropsStep, fields: FieldsStep, milk: MilkStep, schemes: SchemesStep, regular: RegularStep, loans: LoansStep,
  bank: BankStep, year: YearStep, accountant: AccountantStep
};

const STATUS_WORD: Record<SetupStage['status'], string> = { done: 'Done', skipped: 'Skipped for now', started: 'Started', todo: 'To do' };

/** "Set up your farm": every stage for this farm, how far along, and the next one to do. */
export default function Setup() {
  const b = useFarmData();
  const stages = useMemo(() => setupPlan(b), [b]);
  const p = setupProgress(stages);
  const [params] = useSearchParams();
  const justDone = params.get('done');

  return (
    <Screen title="Set up your farm" back="/" sub={`${p.finished} of ${p.total} stages done`}>
      <div className="flex gap-1.5 px-1" aria-hidden>
        {stages.map((s) => <span key={s.key} className={`h-1.5 flex-1 rounded-full ${s.status === 'done' || s.status === 'skipped' ? 'bg-field' : s.status === 'started' ? 'bg-hivis' : 'bg-track'}`} />)}
      </div>
      {p.complete ? (
        <Card className="bg-field-light">
          <p className="text-lg font-bold">All set up.</p>
          <p className="mt-1">Everything Agri-It needs is in. Change any of it from here or from More.</p>
          <Link to="/" className="mt-3 inline-flex min-h-tap items-center rounded-full bg-field px-5 font-bold text-white">Go to the dashboard</Link>
        </Card>
      ) : p.next && (
        <Card>
          {justDone && <p className="mb-1 font-bold text-accent">{stages.find((s) => s.key === justDone)?.title ?? 'That'} is done.</p>}
          <p className="text-sm font-semibold text-muted">Next{p.minutesLeft ? `, about ${p.minutesLeft} minutes for the rest` : ''}</p>
          <p className="text-xl font-bold">{p.next.title}</p>
          <p className="text-[0.9375rem] text-muted">{p.next.why}</p>
          <Link to={`/setup/${p.next.key}`} className="mt-3 flex min-h-tap w-full items-center justify-center rounded-full bg-field px-5 font-bold text-white">
            {p.next.status === 'started' ? 'Carry on' : 'Start'}
          </Link>
          <p className="mt-2 text-center text-sm text-muted">Each step saves as you go. Stop any time and carry on from the dashboard.</p>
        </Card>
      )}
      <ul className="space-y-2">
        {stages.map((s) => {
          const Icon = s.status === 'done' ? CheckCircle2 : s.status === 'skipped' ? MinusCircle : s.status === 'started' ? CircleDot : Circle;
          const doneSteps = s.steps.filter((x) => x.done).length;
          return (
            <li key={s.key}>
              <Link to={`/setup/${s.key}`} className="flex min-h-[4rem] items-center gap-3 rounded-[1.125rem] bg-card p-4 shadow-lift">
                <Icon className={`h-7 w-7 shrink-0 ${s.status === 'done' ? 'text-accent' : s.status === 'started' ? 'text-warn' : 'text-muted'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{s.title}</span>
                  <span className="block text-sm text-muted">{STATUS_WORD[s.status]}{s.steps.length > 1 ? `, ${doneSteps} of ${s.steps.length} steps` : ''}{s.status === 'todo' ? ` · about ${s.minutes} min` : ''}</span>
                </span>
                <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="flex items-center gap-1.5 px-1 text-sm text-muted"><Clock className="h-4 w-4" aria-hidden />Only what your farm needs: the stages follow what you said you farm.</p>
    </Screen>
  );
}

/** One stage, a step at a time. Each step saves as it goes; the stage is marked done at the end. */
export function SetupStageScreen() {
  const { stage: key } = useParams();
  const b = useFarmData();
  const nav = useNavigate();
  const save = useSave();
  const stages = useMemo(() => setupPlan(b), [b]);
  const stage = stages.find((s) => s.key === key);
  // Start on the first step not yet done (all done: from the top, to change things)
  const [at, setAt] = useState(() => {
    if (!stage) return 0;
    const i = stage.steps.findIndex((s) => !s.done);
    return i < 0 ? 0 : i;
  });
  useEffect(() => { window.scrollTo(0, 0); }, [at]);
  // The latest stage, for deciding done or skipped when the last step moves on (steps hold older closures)
  const latest = useRef(stage);
  latest.current = stage;
  if (!stage) return <Navigate to="/setup" replace />;
  const step = stage.steps[Math.min(at, stage.steps.length - 1)];
  const Step = STEP[step.key];

  async function finishStage(mark: 'done' | 'skipped') {
    const setup = withMark(b.farm.setup, stage!.key as StageKey, mark);
    await save([{ kind: 'update', table: 'farms', match: { id: b.farm.id }, patch: { setup } }], { label: mark === 'done' ? `${stage!.title}: done` : `${stage!.title}: skipped for now`, quiet: true, patch: (x) => ({ ...x, farm: { ...x.farm, setup } }) });
    nav(`/setup?done=${mark === 'done' ? stage!.key : ''}`, { replace: true });
  }
  // Walked through to the end: done if anything in it is filled in, else skipped for now.
  // A short delay lets the step's own save reach the cached farm first.
  const next = () => (at + 1 < stage.steps.length ? setAt(at + 1)
    : setTimeout(() => finishStage(latest.current?.status === 'done' || latest.current?.steps.some((s) => s.done) ? 'done' : 'skipped'), 0));

  return (
    <div className="pad-bottom mx-auto min-h-[100dvh] max-w-xl bg-card px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        <button aria-label="Back" onClick={() => (at > 0 ? setAt(at - 1) : nav('/setup'))} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-pasture"><ChevronLeft className="h-6 w-6" /></button>
        <div className="flex flex-1 gap-1.5" aria-label={`Step ${at + 1} of ${stage.steps.length}`}>
          {stage.steps.map((s, i) => <span key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= at ? 'bg-field' : 'bg-track'}`} />)}
        </div>
        <Button variant="ghost" className="!min-h-0 !px-3 py-2 text-sm" onClick={() => finishStage('skipped')}>Later</Button>
      </div>
      <p className="mt-4 text-[0.8125rem] font-semibold text-muted">{stage.title}{stage.steps.length > 1 ? `, step ${at + 1} of ${stage.steps.length}` : ''}</p>
      <h1 className="h-display text-[1.75rem]">{step.title}</h1>
      <div className="mt-5" key={step.key}>
        <Step b={b} next={next} />
      </div>
      <ReleaseLine className="pb-28" />
    </div>
  );
}
