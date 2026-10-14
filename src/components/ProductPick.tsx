import { useId, useState } from 'react';
import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import { catalogueItem, pickList, type CatalogueKind } from '../lib/catalogue';
import { fmtDate } from '../lib/format';

/**
 * Pick a product from the list, or type your own. The chosen supplier's own listed products
 * come first (only where it lists them); then plain names. Picking fills the name and records
 * what kind of product it is (for the CSO comparison); typing your own clears that.
 */
export function ProductPick({ kind, supplierId, name, catalogueKey, onChange, label }: {
  kind: CatalogueKind; supplierId: string | null; name: string; catalogueKey: string | null;
  onChange: (v: { name: string; catalogueKey: string | null }) => void; label: string;
}) {
  const id = useId();
  const groups = pickList(kind, supplierId);
  const [open, setOpen] = useState(!name);
  const picked = catalogueItem(catalogueKey);
  return (
    <div className="space-y-2">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" value={name} maxLength={80} placeholder="Pick below or type its name"
        onChange={(e) => onChange({ name: e.target.value, catalogueKey: picked && e.target.value === picked.name ? picked.key : null })} />
      {picked?.source && (
        <p className="hint">
          Listed by {picked.group} on its website, checked {fmtDate(picked.source.checkedOn)}.{' '}
          <a className="inline-flex items-center gap-1 font-bold text-accent underline" href={picked.source.url} target="_blank" rel="noreferrer">See it<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
        </p>
      )}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-[2.75rem] items-center gap-1 text-[0.9375rem] font-bold text-accent">
        <ChevronDown className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />{open ? 'Hide the list' : 'Pick from the list'}
      </button>
      {open && (
        <div className="space-y-3 rounded-2xl bg-pasture p-3">
          {groups.map((g) => (
            <fieldset key={g.group}>
              <legend className="eyebrow mb-1.5">{g.group}</legend>
              <div className="flex flex-wrap gap-2">
                {g.items.map((c) => {
                  const on = c.key === catalogueKey;
                  return (
                    <button key={c.key} type="button" aria-pressed={on} onClick={() => { onChange({ name: c.name, catalogueKey: c.key }); setOpen(false); }}
                      className={`flex min-h-[3rem] items-center gap-1.5 rounded-full border px-4 text-left text-[0.9375rem] font-semibold leading-tight ${on ? 'border-field bg-field text-white' : 'border-line bg-card'}`}>
                      {on && <Check className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden />}{c.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <p className="text-sm text-muted">Not here? Type its name above, as it is on your docket.</p>
        </div>
      )}
    </div>
  );
}
