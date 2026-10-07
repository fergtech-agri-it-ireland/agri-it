import { useId, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { breedList, breedsFor, FARM_TYPES, SPECIES } from '../lib/farmTypes';
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

/** Breed in the farmer's own words: the common ones one tap away, anything else typed. */
export function BreedField({ cls, value, onChange, label = 'Breed (optional)' }: { cls: AnimalClass; value: string; onChange: (v: string) => void; label?: string }) {
  const id = useId();
  const listId = `${id}-breeds`;
  const [more, setMore] = useState(false);
  const quick = [...breedList(cls).slice(0, more ? undefined : 5), 'Crossbred', 'Mixed'];
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Type a breed or pick one" maxLength={60} />
      <datalist id={listId}>{breedsFor(cls).map((x) => <option key={x} value={x} />)}</datalist>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {quick.map((x) => (
          <button key={x} type="button" aria-pressed={value === x} onClick={() => onChange(value === x ? '' : x)}
            className={`min-h-[2.25rem] rounded-full border px-3 text-[0.8125rem] font-semibold ${value === x ? 'border-field bg-field text-white' : 'border-line bg-card'}`}>{x}</button>
        ))}
        {!more && breedList(cls).length > 5 && (
          <button type="button" onClick={() => setMore(true)} className="flex min-h-[2.25rem] items-center gap-1 rounded-full px-2 text-[0.8125rem] font-bold text-accent">
            <Plus className="h-3.5 w-3.5" aria-hidden />More breeds
          </button>
        )}
      </div>
    </div>
  );
}
