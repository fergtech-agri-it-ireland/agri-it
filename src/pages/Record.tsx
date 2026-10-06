import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banknote, Beef, Camera, Check, ClipboardList, Clock, ImagePlus, Loader2, Milk, Package, PackageCheck, Receipt, Ruler, ScanText, Truck, X } from 'lucide-react';
import { useFarmCtx, useFarmData } from '../lib/data/farm';
import { COST_LABEL } from '../lib/types';
import { eur, fmtDay, fmtKg, fmtNum } from '../lib/format';
import { setPendingPhoto } from '../lib/pendingPhoto';
import { Button, Sheet } from '../components/ui';
import { IS_DEMO } from '../lib/env';
import { interpret, isReferenceNote, NotReadable, readLines } from '../lib/docket/flow';
import { warmReader, type ReadProgress } from '../lib/docket/reader';
import { keepToRead } from '../lib/docket/photoStore';
import { kindLabel, type DocketRead } from '../lib/docket/extract';
import { PhotoQueueList, readHeadline } from '../components/PhotoQueue';
import { useToast } from '../components/Toast';

type Icon = ComponentType<{ className?: string }>;

/** Farmer intents from spec section 8, each one tap from here. */
const NEW: { to: string; label: string; Icon: Icon }[] = [
  { to: '/record/delivery', label: 'Feed arrived', Icon: PackageCheck },
  { to: '/record/order', label: 'Ordered feed', Icon: Truck },
  { to: '/record/milk', label: 'Milk cheque', Icon: Milk },
  { to: '/record/sale', label: 'Sold animals', Icon: Beef },
  { to: '/record/cost', label: 'Paid a bill', Icon: Receipt },
  { to: '/record/count', label: 'Stock count', Icon: Ruler },
  { to: '/records/new', label: 'Farm record', Icon: ClipboardList },
  { to: '/record/income', label: 'Other income', Icon: Banknote }
];

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

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <h1 className="h-display text-[2.25rem]">Record</h1>
        <button onClick={() => nav(-1)} aria-label="Close" className="-mr-2 flex h-14 w-14 items-center justify-center rounded-full hover:bg-field-light">
          <X className="h-7 w-7" aria-hidden />
        </button>
      </div>

      <label className="mt-2 flex min-h-[5.25rem] cursor-pointer items-center gap-3.5 rounded-[1.375rem] bg-field px-4 py-3 text-white">
        {/* The demo page can't use the camera, so it opens the file picker instead */}
        <input type="file" accept="image/*,application/pdf" {...(IS_DEMO ? {} : { capture: 'environment' as const })} className="sr-only" data-testid="photo-input"
          onChange={(e) => { choose(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-hivis text-onhivis">{IS_DEMO ? <ImagePlus className="h-8 w-8" aria-hidden /> : <Camera className="h-8 w-8" aria-hidden />}</span>
        <span className="min-w-0"><b className="block text-[1.1875rem]">{IS_DEMO ? 'Pick a docket or invoice photo' : 'Photo a docket or invoice'}</b><span className="text-[0.95rem] text-white/85">Agri-It reads it and fills in the form. You check, then save.</span></span>
      </label>

      {samples && (
        <div className="mt-2" data-testid="samples">
          <p className="px-1 text-[0.95rem] font-bold text-muted">Or try a sample photo</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {samples.SAMPLES.map((s) => (
              <button key={s.name} onClick={async () => choose(await samples.sampleFile(s))} className="flex flex-col items-center gap-1 rounded-2xl bg-card p-2 text-center shadow-lift active:bg-field-light" data-sample={s.name}>
                <img src={s.url} alt="" className="h-20 w-full rounded-lg object-cover" />
                <b className="text-[0.95rem] leading-tight">{s.label}</b>
                <span className="text-xs leading-tight text-muted">{s.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <PhotoQueueList />

      {repeats.length > 0 && (
        <>
          <h2 className="h-display mb-2 mt-5 text-2xl">Same as last time</h2>
          <div className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card shadow-lift">
            {repeats.map((r) => (
              <Link key={r.key} to={r.to} className="flex min-h-[4.5rem] items-center gap-3 py-2 pl-3.5 pr-2.5 hover:bg-pasture">
                <r.Icon className="h-[1.875rem] w-[1.875rem] shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1"><b className="block leading-snug">{r.title}</b><span className="text-[0.95rem] text-muted">{r.sub}</span></span>
                <span className="flex min-h-[3.5rem] min-w-[4rem] shrink-0 items-center justify-center rounded-2xl bg-hivis px-3 font-bold text-onhivis" aria-hidden>Add</span>
              </Link>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-sm text-muted">Opens the form filled in from last time, dated today. Check it, then save.</p>
        </>
      )}

      <h2 className="h-display mb-2 mt-5 text-2xl">Something new</h2>
      <div className="grid grid-cols-2 gap-2">
        {NEW.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex min-h-[4.25rem] items-center gap-3 rounded-[1.125rem] bg-card px-3 py-2 font-bold leading-tight shadow-lift active:bg-field-light">
            <Icon className="h-[1.875rem] w-[1.875rem] shrink-0 text-accent" aria-hidden />{label}
          </Link>
        ))}
      </div>

      <Sheet open={!!photo} onClose={close} title={phase?.stage === 'reading' ? 'Reading the photo' : phase?.stage === 'read' ? 'Read from photo' : 'What is this?'}>
        {phase?.stage === 'reading' && (
          <div className="space-y-2 pb-3" data-testid="reading">
            {STEPS.map((s, i) => {
              const at = STEPS.findIndex((x) => x.step === phase.progress.step);
              const state = i < at ? 'done' : i === at ? 'now' : 'next';
              return (
                <p key={s.step} className={`flex min-h-[2.75rem] items-center gap-2.5 text-lg ${state === 'next' ? 'text-muted' : 'font-bold'}`}>
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
            <div className="rounded-2xl border-2 border-field bg-pasture p-3">
              <p className="flex items-center gap-1.5 font-bold text-accent"><ScanText className="h-5 w-5" aria-hidden />Looks like</p>
              <p className="text-2xl font-bold leading-tight" data-testid="read-result-kind">{kindLabel(phase.read)}</p>
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
              : 'Can\'t read photos on this phone right now. The reader needs signal once to set itself up.'}</p>
            <Button block onClick={keepForLater}>Read it when I have signal</Button>
            <p className="font-bold">Or fill it in yourself. It&apos;s a:</p>
          </div>
        )}
        {phase?.stage === 'unreadable' && <p className="pb-3 text-lg" data-testid="read-unreadable">{phase.message} Say what it is and fill it in; the file is kept with the record.</p>}

        <div className={`grid gap-2 pb-2 ${phase?.stage === 'reading' ? 'hidden' : ''}`}>
          {PHOTO_KINDS.map(({ to, label, sub, Icon }) => (
            <button key={to} onClick={() => open(to, phase?.stage === 'read' && (to === '/record/delivery' || to === '/record/cost') ? phase.read : null)}
              className="flex min-h-[4.5rem] items-center gap-3.5 rounded-2xl border-2 border-line bg-pasture px-4 text-left hover:border-field active:bg-field-light">
              <Icon className="h-8 w-8 shrink-0 text-accent" aria-hidden />
              <span><b className="block text-lg leading-tight">{label}</b><span className="text-[0.95rem] text-muted">{sub}</span></span>
            </button>
          ))}
        </div>
      </Sheet>
    </main>
  );
}
