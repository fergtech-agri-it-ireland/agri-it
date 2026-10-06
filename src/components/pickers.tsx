import type { FarmBundle } from '../lib/types';
import { Chips } from './ui';

/** Recent suppliers first (spec 4.1), then the rest of the directory, then "Other". */
export function supplierOptions(b: FarmBundle) {
  const used = new Map(b.supplierSettings.map((s) => [s.supplier_id, s.last_used_at ?? '']));
  return b.suppliers
    .filter((s) => s.coverage.includes(b.farm.jurisdiction) || s.farm_id)
    .sort((a, c) => (used.get(c.id) ?? '').localeCompare(used.get(a.id) ?? '') || a.name.localeCompare(c.name));
}

export function SupplierPicker({ b, value, onChange, label = 'Supplier' }: { b: FarmBundle; value: string | null; onChange: (id: string) => void; label?: string }) {
  const list = supplierOptions(b);
  const recent = list.slice(0, 4);
  const rest = list.slice(4);
  return (
    <div className="space-y-2">
      <Chips label={label} columns={2} value={value && recent.some((s) => s.id === value) ? value : null} onChange={onChange}
        options={recent.map((s) => ({ value: s.id, label: s.name }))} />
      {rest.length > 0 && (
        <select aria-label="Other suppliers" className="input" value={value && rest.some((s) => s.id === value) ? value : ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
          <option value="">More suppliers</option>
          {rest.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}

export function FeedPicker({ b, value, onChange }: { b: FarmBundle; value: string | null; onChange: (id: string) => void }) {
  const list = b.products.filter((p) => !p.archived);
  return <Chips label="Which feed?" columns={2} value={value} onChange={onChange} options={list.map((p) => ({ value: p.id, label: p.name, sub: p.storage_location ?? undefined }))} />;
}

export function GroupPicker({ b, value, onChange, label = 'Which group?' }: { b: FarmBundle; value: string | null; onChange: (id: string) => void; label?: string }) {
  return <Chips label={label} columns={2} value={value} onChange={onChange}
    options={b.groups.filter((g) => !g.archived).map((g) => ({ value: g.id, label: g.name, sub: `${g.head_count} head` }))} />;
}

/** Quantity with a kg / tonnes switch. Always returns kg (spec: stored internally as kg). */
export function QuantityInput({ label, kg, onKg, unit, onUnit, hint }: {
  label: string; kg: string; onKg: (kg: string) => void; unit: 'kg' | 't'; onUnit: (u: 'kg' | 't') => void; hint?: string;
}) {
  const shown = kg === '' ? '' : unit === 't' ? String(Number(kg) / 1000) : kg;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="label mb-0" htmlFor="qty">{label}</label>
        <div className="flex rounded-xl border-2 border-line p-0.5" role="group" aria-label="Unit">
          {(['t', 'kg'] as const).map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => onUnit(u)}
              className={`min-h-[2.75rem] min-w-[4.5rem] rounded-lg px-2 font-bold ${unit === u ? 'bg-field text-white' : ''}`}>{u === 't' ? 'tonnes' : 'kg'}</button>
          ))}
        </div>
      </div>
      <input id="qty" className="input text-2xl font-bold" type="number" inputMode="decimal" value={shown}
        onChange={(e) => onKg(e.target.value === '' ? '' : String(unit === 't' ? Number(e.target.value) * 1000 : Number(e.target.value)))} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Photo of a docket or invoice: opens the camera on phones. */
export function PhotoInput({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  return (
    <div>
      <span className="label">Photo of docket or invoice (optional)</span>
      <label className="flex min-h-tap cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-pasture px-4 font-bold">
        <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        {file ? `Attached: ${file.name}` : 'Take photo'}
      </label>
      {file && <button type="button" className="mt-1 text-sm font-bold text-accent underline" onClick={() => onFile(null)}>Remove photo</button>}
      {!navigator.onLine && <p className="hint">You're offline. Photos can only be attached with signal; the rest saves now.</p>}
    </div>
  );
}
