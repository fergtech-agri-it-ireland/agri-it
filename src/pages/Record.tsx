import { useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banknote, Beef, Camera, ClipboardList, Milk, Package, PackageCheck, Receipt, Ruler, Truck, X } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { COST_LABEL } from '../lib/types';
import { eur, fmtDay, fmtKg, fmtNum } from '../lib/format';
import { setPendingPhoto } from '../lib/pendingPhoto';
import { Sheet } from '../components/ui';

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

export default function Record() {
  const b = useFarmData();
  const nav = useNavigate();
  const [photo, setPhoto] = useState<File | null>(null);

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
      title: bill.description ?? bill.other_label ?? COST_LABEL[bill.category],
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
        <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only"
          onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-hivis text-onhivis"><Camera className="h-8 w-8" aria-hidden /></span>
        <span className="min-w-0"><b className="block text-[1.1875rem]">Photo a docket or invoice</b><span className="text-[0.95rem] text-white/85">Take the photo, say what it is, then check and save</span></span>
      </label>

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

      <Sheet open={!!photo} onClose={() => setPhoto(null)} title="What is this?">
        <div className="grid gap-2 pb-2">
          {PHOTO_KINDS.map(({ to, label, sub, Icon }) => (
            <button key={to} onClick={() => { setPendingPhoto(photo); nav(to); }}
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
