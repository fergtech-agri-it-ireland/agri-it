import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, ClipboardList, Clock, ImagePlus, Loader2, Milk, Package, PackageCheck, Plus, Receipt, ScanLine, ScanText, Search, X } from 'lucide-react';
import { addOptions, farmTypes } from '../lib/farmTypes';
import { useFarmCtx, useFarmData } from '../lib/data/farm';
import { COST_LABEL } from '../lib/types';
import { eur, fmtDay, fmtKg, fmtNum } from '../lib/format';
import { setPendingPhoto } from '../lib/pendingPhoto';
import { Button, Sheet } from '../components/ui';
import { IN_FRAME, IS_DEMO, IS_LOCAL } from '../lib/env';
import { interpret, isReferenceNote, NotReadable, readLines } from '../lib/docket/flow';
import { warmReader, type ReadProgress } from '../lib/docket/reader';
import { keepToRead } from '../lib/docket/photoStore';
import { kindLabel, type DocketRead } from '../lib/docket/extract';
import { PhotoQueueList, readHeadline } from '../components/PhotoQueue';
import { useToast } from '../components/Toast';

type Icon = ComponentType<{ className?: string }>;

/** What a docket photo can be, and which form it opens with the photo attached. */
const PHOTO_KINDS: { to: string; label: string; sub: string; Icon: Icon }[] = [
  { to: '/record/delivery', label: 'Feed docket', sub: 'Meal or nuts delivered', Icon: PackageCheck },
  { to: '/record/cost', label: 'Bill or invoice', sub: 'Vet, contractor, fertiliser, ESB', Icon: Receipt },
  { to: '/record/milk', label: 'Milk statement', sub: 'Monthly cheque', Icon: Milk },
  { to: '/records/new', label: 'Other record', sub: 'Medicine, movement, spreading', Icon: ClipboardList }
];

type Phase =
  | { stage: 'reading'; progress: ReadProgress }
  | { stage: 'read'; read: DocketRead }
  | { stage: 'unavailable'; message: string }
  | { stage: 'unreadable'; message: string };

const STEPS: { step: ReadProgress['step']; label: string }[] = [
  { step: 'cleaning', label: 'Straightening and brightening' },
  { step: 'loading', label: 'Getting the reader ready' },
  { step: 'reading', label: 'Reading the text' },
  { step: 'sorting', label: 'Working out what it is' }
];

export default function Record() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const nav = useNavigate();
  const toast = useToast();
  const [photo, setPhoto] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const run = useRef(0);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'recent' | 'all' | null>(null);
  // Sample photos ship in the demo build only
  const [samples, setSamples] = useState<typeof import('../lib/demo/samples') | null>(null);
  useEffect(() => { if (import.meta.env.VITE_DEMO === '1') import('../lib/demo/samples').then(setSamples).catch(() => {}); }, []);
  // Get the reader's files cached while there's signal, ready for the yard
  useEffect(() => { const t = setTimeout(warmReader, 1500); return () => clearTimeout(t); }, []);

  async function choose(f: File | null) {
    setPhoto(f);
    if (!f) return;
    const mine = ++run.current;
    setPhase({ stage: 'reading', progress: { step: 'cleaning', progress: 0 } });
    try {
      const { lines, reader } = await readLines(f, (p) => { if (run.current === mine) setPhase({ stage: 'reading', progress: p }); });
      if (run.current !== mine) return;
      setPhase({ stage: 'reading', progress: { step: 'sorting', progress: 1 } });
      setPhase({ stage: 'read', read: interpret(lines, reader, b) });
    } catch (e) {
      if (run.current !== mine) return;
      setPhase(e instanceof NotReadable ? { stage: 'unreadable', message: e.message } : { stage: 'unavailable', message: (e as Error).message });
    }
  }
  function close() {
    run.current++;
    setPhoto(null);
    setPhase(null);
  }
  function open(to: string, read: DocketRead | null) {
    setPendingPhoto(photo, read);
    nav(to);
  }
  async function keepForLater() {
    if (!photo || !farmId) return;
    await keepToRead({ id: crypto.randomUUID(), farmId, blob: photo, name: photo.name, addedAt: new Date().toISOString(), status: 'waiting' });
    toast.show({ message: 'Photo kept. It will be read when you have signal, then shows here to check.', tone: 'info' });
    close();
  }

  // "Same as last time" (after MyFitnessPal's recent foods): the latest of each everyday entry.
  const repeats: { key: string; to: string; title: string; sub: string; Icon: Icon }[] = [];
  const latestByFeed = new Map<string, (typeof b.txns)[number]>();
  for (const t of [...b.txns].filter((x) => x.txn_type === 'delivery').sort((x, y) => y.effective_on.localeCompare(x.effective_on))) {
    if (!latestByFeed.has(t.feed_product_id)) latestByFeed.set(t.feed_product_id, t);
  }
  for (const t of [...latestByFeed.values()].slice(0, 2)) {
    const p = b.products.find((x) => x.id === t.feed_product_id);
    if (!p || p.archived) continue;
    const supplier = b.suppliers.find((s) => s.id === t.supplier_id)?.name;
    repeats.push({
      key: t.id, to: `/record/delivery?feed=${p.id}`, Icon: Package,
      title: `${p.name}, ${fmtKg(Number(t.quantity_kg))}`,
      sub: [supplier, t.price_per_tonne_eur ? `${eur(Number(t.price_per_tonne_eur))}/t` : null, `last on ${fmtDay(t.effective_on)}`].filter(Boolean).join(', ')
    });
  }
  const milk = b.income.filter((i) => i.income_type === 'milk').sort((x, y) => y.occurred_on.localeCompare(x.occurred_on))[0];
  if (milk) {
    repeats.push({
      key: milk.id, to: '/record/milk', Icon: Milk, title: `Milk cheque${milk.counterparty ? `, ${milk.counterparty}` : ''}`,
      sub: `Last ${eur(Number(milk.amount_eur))}${milk.milk_litres ? ` for ${fmtNum(Number(milk.milk_litres))} L` : ''}`
    });
  }
  const bill = b.costs.filter((c) => !c.feed_transaction_id && c.category !== 'feed').sort((x, y) => y.occurred_on.localeCompare(x.occurred_on))[0];
  if (bill) {
    repeats.push({
      key: bill.id, to: `/record/cost?repeat=${bill.id}`, Icon: Receipt,
      title: (isReferenceNote(bill.description) ? null : bill.description) ?? bill.other_label ?? COST_LABEL[bill.category],
      sub: `Last ${eur(Number(bill.amount_eur))} on ${fmtDay(bill.occurred_on)}${bill.supplier_name ? `, ${bill.supplier_name}` : ''}`
    });
  }

  const types = farmTypes(b.farm);
  const options = addOptions(types);
  const q = query.trim().toLowerCase();
  const match = (...t: string[]) => !q || t.some((x) => x.toLowerCase().includes(q));
  const shownRepeats = repeats.filter((r) => match(r.title, r.sub));
  const shownOptions = options.filter((o) => match(o.label, o.sub));
  const firstUseful = options[0];
  const showTab = q ? 'search' : tab ?? (repeats.length ? 'recent' : 'all');

  const optionRow = (o: (typeof options)[number]) => (
    <Link key={o.id} to={o.to} className="flex min-h-[3.75rem] items-center gap-3 py-2 pl-4 pr-3 hover:bg-pasture">
      <span className="min-w-0 flex-1"><b className="block text-[0.9375rem] font-semibold leading-snug">{o.label}</b><span className="text-[0.8125rem] text-muted">{o.sub}</span></span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
    </Link>
  );
  const repeatRow = (r: (typeof repeats)[number]) => (
    <Link key={r.key} to={r.to} aria-label={`Add again: ${r.title}`} className="flex min-h-[3.75rem] items-center gap-3 py-2 pl-4 pr-3 hover:bg-pasture">
      <span className="min-w-0 flex-1"><b className="block text-[0.9375rem] font-semibold leading-snug">{r.title}</b><span className="text-[0.8125rem] text-muted">{r.sub}</span></span>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-field text-accent" aria-hidden><Plus className="h-5 w-5" strokeWidth={2.75} /></span>
    </Link>
  );

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-xl bg-card pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-1 px-2 pt-2">
        <button onClick={() => nav(-1)} aria-label="Close" className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-pasture">
          <X className="h-6 w-6" aria-hidden />
        </button>
        <h1 className="h-display text-xl">Add to diary</h1>
      </div>

      <div className="px-4 pt-2">
        <label className="flex h-12 items-center gap-2.5 rounded-full bg-pasture px-4 text-muted">
          <Search className="h-5 w-5 shrink-0" aria-hidden />
          <input type="search" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search feed, bills, sales"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-4 pt-3">
        <label className="flex min-h-[5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl bg-field px-2 text-center text-white active:bg-field-dark">
          {/* The demo page can't use the camera, so it opens the file picker instead */}
          <input type="file" accept="image/*,application/pdf" {...(IS_DEMO ? {} : { capture: 'environment' as const })} className="sr-only" data-testid="photo-input"
            onChange={(e) => { choose(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          {IS_DEMO ? <ImagePlus className="h-6 w-6" aria-hidden /> : <ScanLine className="h-6 w-6" aria-hidden />}
          <b className="text-sm leading-tight">{IS_DEMO ? 'Pick a docket photo' : 'Scan a docket'}</b>
        </label>
        {firstUseful && (
          <Link to={firstUseful.to} className="flex min-h-[5rem] flex-col items-center justify-center gap-1.5 rounded-2xl bg-pasture px-2 text-center active:bg-field-light">
            <Plus className="h-6 w-6 text-accent" aria-hidden />
            <b className="text-sm leading-tight">{firstUseful.label}</b>
          </Link>
        )}
      </div>
      <p className="px-4 pt-2 text-[0.8125rem] text-muted">A photo is read on this phone and fills in the form. You check it, then save.</p>

      {samples && (
        <div className="px-4 pt-2" data-testid="samples">
          <p className="eyebrow">Or try a sample photo</p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {samples.SAMPLES.map((s) => (
              <button key={s.name} onClick={async () => choose(await samples.sampleFile(s))} className="flex flex-col items-center gap-1 rounded-xl bg-pasture p-2 text-center active:bg-field-light" data-sample={s.name}>
                <img src={s.url} alt="" className="h-16 w-full rounded-lg object-cover" />
                <b className="text-[0.8125rem] leading-tight">{s.label}</b>
                <span className="text-[0.6875rem] leading-tight text-muted">{s.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4"><PhotoQueueList /></div>

      {showTab !== 'search' && (
        <div role="tablist" aria-label="What to add" className="mt-4 flex gap-6 border-b border-line px-4 text-sm font-bold">
          {repeats.length > 0 && (
            <button role="tab" aria-selected={showTab === 'recent'} onClick={() => setTab('recent')}
              className={`min-h-[2.75rem] ${showTab === 'recent' ? 'text-accent shadow-[inset_0_-3px_0_rgb(var(--accent))]' : 'text-muted'}`}>Recent</button>
          )}
          <button role="tab" aria-selected={showTab === 'all'} onClick={() => setTab('all')}
            className={`min-h-[2.75rem] ${showTab === 'all' ? 'text-accent shadow-[inset_0_-3px_0_rgb(var(--accent))]' : 'text-muted'}`}>Everything</button>
        </div>
      )}

      {showTab === 'recent' && (
        <>
          <div className="divide-y divide-line border-b border-line">{repeats.map(repeatRow)}</div>
          <p className="px-4 pt-2 text-[0.8125rem] text-muted">Opens the form filled in from last time, dated today. Check it, then save.</p>
        </>
      )}
      {showTab === 'all' && (
        <div className="divide-y divide-line border-b border-line">
          {options.filter((o) => o.relevant).map(optionRow)}
          {options.some((o) => !o.relevant) && <p className="eyebrow bg-pasture px-4 py-2">Other things you can add</p>}
          {options.filter((o) => !o.relevant).map(optionRow)}
        </div>
      )}
      {showTab === 'search' && (
        <div className="mt-3 divide-y divide-line border-y border-line">
          {shownRepeats.map(repeatRow)}
          {shownOptions.map(optionRow)}
          {shownRepeats.length + shownOptions.length === 0 && <p className="px-4 py-4 text-muted">Nothing matches &quot;{query}&quot;. Try feed, bill, milk or sale.</p>}
        </div>
      )}

      <Sheet open={!!photo} onClose={close} title={phase?.stage === 'reading' ? 'Reading the photo' : phase?.stage === 'read' ? 'Read from photo' : 'What is this?'}>
        {phase?.stage === 'reading' && (
          <div className="space-y-2 pb-3" data-testid="reading">
            {STEPS.map((s, i) => {
              const at = STEPS.findIndex((x) => x.step === phase.progress.step);
              const state = i < at ? 'done' : i === at ? 'now' : 'next';
              return (
                <p key={s.step} className={`flex min-h-[2.75rem] items-center gap-2.5 ${state === 'next' ? 'text-muted' : 'font-bold'}`}>
                  {state === 'done' ? <Check className="h-6 w-6 text-ok" aria-hidden /> : state === 'now' ? <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden /> : <Clock className="h-6 w-6" aria-hidden />}
                  {s.label}{state === 'now' && phase.progress.progress > 0 && phase.progress.progress < 1 ? ` ${Math.round(phase.progress.progress * 100)}%` : ''}
                </p>
              );
            })}
            <p className="text-sm text-muted">Takes a few seconds. The photo stays on this phone while it&apos;s read.</p>
          </div>
        )}

        {phase?.stage === 'read' && (
          <div className="pb-3" data-testid="read-result">
            <div className="rounded-2xl bg-field-light p-3">
              <p className="flex items-center gap-1.5 font-bold text-accent"><ScanText className="h-5 w-5" aria-hidden />Looks like</p>
              <p className="text-xl font-extrabold leading-tight" data-testid="read-result-kind">{kindLabel(phase.read)}</p>
              <p className="mt-0.5 text-lg">{readHeadline(phase.read)}</p>
              {phase.read.missing.length > 0 && <p className="mt-1 text-[0.95rem] text-muted">To fill in yourself: {phase.read.missing.join(', ')}</p>}
            </div>
            <Button block className="mt-3" onClick={() => open(phase.read.route === 'delivery' ? '/record/delivery' : '/record/cost', phase.read)}>
              Check and save
            </Button>
            <p className="mb-2 mt-4 font-bold">Not right? It&apos;s a:</p>
          </div>
        )}

        {phase?.stage === 'unavailable' && (
          <div className="space-y-3 pb-3" data-testid="read-unavailable">
            <p className="text-lg">{IS_DEMO
              ? 'Can\'t read this photo here: the demo page blocks the photo reader. The sample photos above still work. In the app, the reader sets itself up the first time you have signal.'
              : IS_LOCAL && IN_FRAME
                ? 'Photo reading does not work in this shared link yet. Fill it in yourself. The photo is kept with the record.'
                : 'Can\'t read photos on this phone right now. The reader needs signal once to set itself up.'}</p>
            {!(IS_LOCAL && IN_FRAME) && <Button block onClick={keepForLater}>Read it when I have signal</Button>}
            <p className="font-bold">Or fill it in yourself. It&apos;s a:</p>
          </div>
        )}
        {phase?.stage === 'unreadable' && <p className="pb-3 text-lg" data-testid="read-unreadable">{phase.message} Say what it is and fill it in; the file is kept with the record.</p>}

        <div className={`grid gap-2 pb-2 ${phase?.stage === 'reading' ? 'hidden' : ''}`}>
          {PHOTO_KINDS.map(({ to, label, sub, Icon }) => (
            <button key={to} onClick={() => open(to, phase?.stage === 'read' && (to === '/record/delivery' || to === '/record/cost') ? phase.read : null)}
              className="flex min-h-[3.75rem] items-center gap-3 rounded-2xl border border-line bg-card px-4 text-left hover:border-field active:bg-field-light">
              <Icon className="h-6 w-6 shrink-0 text-accent" aria-hidden />
              <span><b className="block font-semibold leading-tight">{label}</b><span className="text-[0.8125rem] text-muted">{sub}</span></span>
            </button>
          ))}
        </div>
      </Sheet>
    </main>
  );
}
