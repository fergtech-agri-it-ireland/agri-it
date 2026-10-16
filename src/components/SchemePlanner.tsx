import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ExpectedIncome, FarmBundle } from '../lib/types';
import { cur, eur, todayISO } from '../lib/format';
import { farmTypes } from '../lib/farmTypes';
import { currentSchemeYear, expectedRows, planScheme, schemesFor, schemeSourceLine } from '../lib/schemes';
import { Button, Chips, NumberInput } from './ui';

/**
 * Tick the schemes the farm is in and give the year's total: Agri-It places it on the
 * published advance and balance dates. Parts whose date has passed are left out unless the
 * farmer says they haven't come in yet. Nothing is income until it arrives.
 */
export function SchemePlanner({ b, onSave, busy }: { b: FarmBundle; onSave: (rows: ExpectedIncome[]) => void; busy?: boolean }) {
  const today = todayISO();
  const [year, setYear] = useState(currentSchemeYear(today));
  const rules = schemesFor(b.farm.jurisdiction, farmTypes(b.farm));
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const already = new Set((b.expected ?? []).filter((e) => e.scheme_year === year).map((e) => e.scheme));
  const rows = rules.flatMap((r) => {
    const v = picked[r.key];
    if (v === undefined || !(Number(v) > 0)) return [];
    const parts = planScheme(r, Number(v), year, today).filter((p) => !p.past || include[`${r.key}:${p.part}`]);
    return expectedRows(b.farm.id, r, year, parts);
  });

  return (
    <div className="space-y-4">
      <Chips label="Scheme year" columns={2} value={String(year)} onChange={(v) => { setYear(Number(v)); setPicked({}); }}
        options={[String(currentSchemeYear(today)), String(currentSchemeYear(today) + 1)].map((y) => ({ value: y, label: y }))} />
      <ul className="space-y-3">
        {rules.map((r) => {
          const on = picked[r.key] !== undefined;
          const parts = on && Number(picked[r.key]) > 0 ? planScheme(r, Number(picked[r.key]), year, today) : [];
          return (
            <li key={r.key} className={`rounded-2xl border px-3.5 py-3 ${on ? 'border-field' : 'border-line'}`}>
              <button type="button" aria-pressed={on} disabled={already.has(r.key)} onClick={() => setPicked(on ? Object.fromEntries(Object.entries(picked).filter(([k]) => k !== r.key)) : { ...picked, [r.key]: '' })}
                className="flex min-h-[2.75rem] w-full items-center gap-3 text-left disabled:opacity-60">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${on ? 'border-field bg-field text-white' : 'border-line'}`}>{on ? '✓' : ''}</span>
                <span className="min-w-0 flex-1"><span className="block font-bold">{r.label}</span><span className="block text-sm text-muted">{already.has(r.key) ? `Already planned for ${year}` : r.sub}</span></span>
              </button>
              {on && (
                <div className="mt-3 space-y-3">
                  <NumberInput label={`What do you expect for ${year} in total?`} unit={cur()} value={picked[r.key]} onChange={(v) => setPicked({ ...picked, [r.key]: v })}
                    hint={b.farm.jurisdiction === 'NI' ? 'From DAERA Online Services, or last year\'s payment.' : 'From your AgFood statement, or last year\'s payment.'} />
                  {parts.length > 0 && (
                    <ul className="space-y-1.5">
                      {parts.map((p) => {
                        const k = `${r.key}:${p.part}`;
                        return (
                          <li key={p.part} className="flex items-center justify-between gap-2 text-[0.9375rem]">
                            <span><b>{eur(p.amount, true)}</b> {p.when}{p.on.slice(0, 4) !== String(year) ? ` ${p.on.slice(0, 4)}` : ''}</span>
                            {p.past && (
                              <button type="button" aria-pressed={!!include[k]} onClick={() => setInclude({ ...include, [k]: !include[k] })}
                                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold ${include[k] ? 'border-field bg-field text-white' : 'border-line'}`}>
                                {include[k] ? 'Not in yet' : 'Already in?'}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-sm text-muted">
                    {r.note ? `${r.note} ` : ''}Payments start on these dates and run for a few weeks, once a claim is cleared. {schemeSourceLine(r)}{' '}
                    <a className="inline-flex items-center gap-0.5 font-bold text-accent underline" href={r.sources[0].url} target="_blank" rel="noreferrer">Source<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">Something else, like TAMS or a forestry premium? Add it on Money, Scheme payments, with your own date.</p>
      <Button block disabled={!rows.length || busy} onClick={() => onSave(rows)}>{rows.length ? `Plan ${rows.length} payment${rows.length === 1 ? '' : 's'}` : 'Tick a scheme and give the total'}</Button>
    </div>
  );
}
