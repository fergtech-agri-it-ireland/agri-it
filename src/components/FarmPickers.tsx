import { useId, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { breedLabel, breedList, breedsFor, cleanBreeds, FARM_TYPES, MAX_BREED_LENGTH, MAX_BREEDS, SPECIES } from '../lib/farmTypes';
import { ANIMAL_CLASS_LABEL, type AnimalClass, type FarmType } from '../lib/types';

/** Pick any mix of farming. Nothing is required and nothing is ruled out. */
export function FarmTypePicker({ value, onChange }: { value: FarmType[]; onChange: (v: FarmType[]) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">What do you farm?</legend>
      <div className="grid grid-cols-2 gap-2">
        {FARM_TYPES.map((t) => {
          const on = value.includes(t.value);
          return (
            <button key={t.value} type="button" aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== t.value) : [...value, t.value])}
              className={`relative flex min-h-[4.25rem] flex-col justify-center rounded-2xl border px-3.5 py-2.5 text-left ${on ? 'border-field bg-field-light' : 'border-line bg-card hover:border-ink/30'}`}>
              <span className="pr-6 text-[0.9375rem] font-bold leading-tight">{t.label}</span>
              <span className="text-xs leading-snug text-muted">{t.sub}</span>
              <span className={`absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full ${on ? 'bg-field text-white' : 'border-2 border-line'}`} aria-hidden>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Any animal class, grouped by species, so bullocks, rams and hoggets are always there. */
export function ClassPicker({ value, onChange, exclude = [] }: { value: AnimalClass | null; onChange: (c: AnimalClass) => void; exclude?: AnimalClass[] }) {
  return (
    <div className="space-y-3">
      {SPECIES.map((s) => {
        const classes = s.classes.filter((c) => !exclude.includes(c));
        if (!classes.length) return null;
        return (
          <fieldset key={s.value}>
            <legend className="eyebrow mb-1.5">{s.label}</legend>
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => (
                <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}
                  className={`min-h-[2.5rem] rounded-full border px-3.5 text-sm font-semibold ${value === c ? 'border-field bg-field text-white' : 'border-line bg-card'}`}>
                  {ANIMAL_CLASS_LABEL[c]}
                </button>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Breeds in the farmer's own words. Tap as many as the group holds (e.g. Holstein Friesian
 * and Jersey cross); anything else is typed and added. Big chips for a gloved thumb.
 */
export function BreedField({ cls, value, onChange, label = 'Breeds (optional)' }: { cls: AnimalClass; value: string[]; onChange: (v: string[]) => void; label?: string }) {
  const id = useId();
  const listId = `${id}-breeds`;
  const [more, setMore] = useState(false);
  const [typed, setTyped] = useState('');
  const has = (x: string) => value.some((v) => v.toLowerCase() === x.toLowerCase());
  const toggle = (x: string) => onChange(has(x) ? value.filter((v) => v.toLowerCase() !== x.toLowerCase()) : cleanBreeds([...value, x]));
  const listed = breedsFor(cls);
  const quick = [...breedList(cls).slice(0, more ? undefined : 5), 'Crossbred', 'Mixed'];
  // Breeds the farmer typed (or picked from "more") that aren't among the quick chips
  const own = value.filter((v) => !quick.some((q) => q.toLowerCase() === v.toLowerCase()));
  const full = value.length >= MAX_BREEDS;
  function addTyped() {
    const t = typed.trim();
    if (!t) return;
    onChange(cleanBreeds([...value, listed.find((x) => x.toLowerCase() === t.toLowerCase()) ?? t]));
    setTyped('');
  }
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <p className="-mt-1 mb-2 text-[0.8125rem] text-muted">{value.length ? `${breedLabel(value)}. Tap to add or take off.` : 'Tap every breed in this group.'}</p>
      <div className="flex flex-wrap gap-2">
        {[...own, ...quick].map((x) => {
          const on = has(x);
          return (
            <button key={x} type="button" aria-pressed={on} disabled={!on && full} onClick={() => toggle(x)}
              className={`flex min-h-[3rem] items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] font-semibold disabled:opacity-40 ${on ? 'border-field bg-field text-white' : 'border-line bg-card'}`}>
              {on && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}{x}
            </button>
          );
        })}
        {!more && breedList(cls).length > 5 && (
          <button type="button" onClick={() => setMore(true)} className="flex min-h-[3rem] items-center gap-1 rounded-full px-3 text-[0.9375rem] font-bold text-accent">
            <Plus className="h-4 w-4" aria-hidden />More breeds
          </button>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor={id}>Type another breed</label>
        <input id={id} className="input min-w-0 flex-1" list={listId} value={typed} disabled={full}
          onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder={full ? `Up to ${MAX_BREEDS} breeds` : 'Type another breed'} maxLength={MAX_BREED_LENGTH} />
        <datalist id={listId}>{listed.filter((x) => !has(x)).map((x) => <option key={x} value={x} />)}</datalist>
        <button type="button" onClick={addTyped} disabled={!typed.trim() || full} aria-label="Add this breed"
          className="flex min-h-[3rem] shrink-0 items-center gap-1 rounded-full border border-field px-4 text-[0.9375rem] font-bold text-accent disabled:opacity-40">
          <Plus className="h-5 w-5" aria-hidden />Add
        </button>
      </div>
    </fieldset>
  );
}
