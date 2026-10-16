import { useState } from 'react';
import type { Jurisdiction, Loan, LoanFrequency, LoanPurpose } from '../lib/types';
import { addDays, cur, todayISO, uuid } from '../lib/format';
import { FREQ_LABEL, KIND_LABEL, PURPOSE_LABEL } from '../lib/loans';
import { Button, Chips, Field, NumberInput, TextInput } from './ui';

/** Lenders offered one tap away. Any other is typed. Names only: nothing is said about their terms. */
export const LENDERS: Record<Jurisdiction, string[]> = {
  ROI: ['AIB', 'Bank of Ireland', 'PTSB', 'Credit union', 'Co-op (milk-linked)', 'Finance company'],
  NI: ['Danske Bank', 'Ulster Bank', 'Bank of Ireland UK', 'AIB (NI)', 'Credit union', 'Finance company']
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type LoanDraft = Omit<Loan, 'created_at' | 'updated_at'>;

/**
 * Add or change a loan, hire purchase, lease or overdraft. Plain questions, in the order a
 * farmer would read them off the statement. Only the lender and what's owed are needed:
 * anything left blank is simply not worked out (never guessed).
 */
export function LoanEditor({ farmId, jurisdiction, existing, onSave, onCancel, busy }: {
  farmId: string; jurisdiction: Jurisdiction; existing?: Loan | null; busy?: boolean;
  onSave: (row: LoanDraft) => void; onCancel?: () => void;
}) {
  const today = todayISO();
  const [kind, setKind] = useState<Loan['kind']>(existing?.kind ?? 'loan');
  const preset = LENDERS[jurisdiction];
  const [lender, setLender] = useState(existing?.lender ?? '');
  const [purpose, setPurpose] = useState<LoanPurpose | null>(existing?.purpose ?? null);
  const [balance, setBalance] = useState(existing ? String(existing.balance_eur) : '');
  const [balanceOn, setBalanceOn] = useState(existing?.balance_on ?? today);
  const [rate, setRate] = useState(existing?.rate_percent != null ? String(existing.rate_percent) : '');
  const [rateType, setRateType] = useState<'fixed' | 'variable' | null>(existing?.rate_type ?? null);
  const [repay, setRepay] = useState(existing?.repayment_eur != null ? String(existing.repayment_eur) : '');
  const [freq, setFreq] = useState<LoanFrequency>(existing?.frequency ?? 'monthly');
  const [nextDue, setNextDue] = useState(existing?.next_due ?? '');
  const [skip, setSkip] = useState<number[]>(existing?.skip_months ?? []);
  const [seasonal, setSeasonal] = useState((existing?.skip_months ?? []).length > 0);
  const [io, setIo] = useState(existing?.interest_only_until ?? '');
  const [ends, setEnds] = useState(existing?.ends_on ?? '');
  const [limit, setLimit] = useState(existing?.credit_limit_eur != null ? String(existing.credit_limit_eur) : '');
  const [more, setMore] = useState(!!(existing?.interest_only_until || existing?.ends_on));
  const od = kind === 'overdraft';
  const repaying = !od && repay !== '' && Number(repay) > 0;
  const ok = lender.trim() && (od ? true : balance !== '' && Number(balance) >= 0) && (!repaying || !!nextDue);

  function save() {
    onSave({
      id: existing?.id ?? uuid(), farm_id: farmId, lender: lender.trim(), kind, purpose: od ? 'working_capital' : purpose,
      balance_eur: od ? Math.max(0, Number(balance || 0)) : Number(balance), balance_on: balanceOn || today,
      rate_percent: rate === '' ? null : Number(rate), rate_type: rateType,
      repayment_eur: repaying ? Number(repay) : null, frequency: repaying ? freq : null, next_due: repaying ? nextDue : null,
      skip_months: repaying && seasonal ? [...skip].sort((a, b) => a - b) : [],
      interest_only_until: repaying && io ? io : null, ends_on: !od && ends ? ends : null,
      credit_limit_eur: od && limit !== '' ? Number(limit) : null, notes: existing?.notes ?? null, archived: existing?.archived ?? false
    });
  }

  return (
    <div className="space-y-5">
      <Chips label="What is it?" columns={2} value={kind} onChange={setKind}
        options={(['loan', 'hire_purchase', 'lease', 'overdraft'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
      <div className="space-y-2">
        <Chips label="Who with?" value={preset.includes(lender) ? lender : null} onChange={setLender} options={preset.map((p) => ({ value: p, label: p }))} />
        <TextInput label="Or type the name" value={preset.includes(lender) ? '' : lender} onChange={setLender} placeholder="e.g. Kerry Dairy finance, family" />
      </div>
      {!od && (
        <Chips label="What was it for? (optional)" columns={2} value={purpose} onChange={setPurpose}
          options={(Object.keys(PURPOSE_LABEL) as LoanPurpose[]).map((p) => ({ value: p, label: PURPOSE_LABEL[p] }))} />
      )}
      {od ? (
        <>
          <NumberInput label="Overdraft limit" unit={cur()} value={limit} onChange={setLimit} hint="What the bank agreed. The year plan warns before you'd go past it." />
          <NumberInput label="Interest rate (optional)" unit="%" value={rate} onChange={setRate} hint="On your statement. Leave blank if you don't know." />
        </>
      ) : (
        <>
          <NumberInput label="How much is owed now?" unit={cur()} value={balance} onChange={setBalance} hint="From your latest statement or online banking." />
          <Field label="As on" htmlFor="loan-on" hint="The date of that figure.">
            <input id="loan-on" type="date" className="input" max={today} value={balanceOn} onChange={(e) => setBalanceOn(e.target.value)} />
          </Field>
          <NumberInput label="Interest rate (optional)" unit="%" value={rate} onChange={setRate}
            hint="On your loan offer or statement. Leave blank if you don't know: Agri-It won't guess the interest." />
          {rate !== '' && <Chips columns={2} value={rateType} onChange={setRateType} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'variable', label: 'Variable' }]} />}
          <NumberInput label="Repayment (optional)" unit={cur()} value={repay} onChange={setRepay} hint="What comes out of the account each time." />
          {repaying && (
            <>
              <Chips label="How often?" columns={2} value={freq} onChange={setFreq}
                options={(Object.keys(FREQ_LABEL) as LoanFrequency[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))} />
              <Field label="Next repayment" htmlFor="loan-next">
                <input id="loan-next" type="date" className="input" min={addDays(today, -31)} value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
              </Field>
              <Chips label="Any months with no repayment?" columns={2} value={seasonal ? 'yes' : 'no'} onChange={(v) => setSeasonal(v === 'yes')}
                options={[{ value: 'no', label: 'No, every time' }, { value: 'yes', label: 'Yes, some months off', sub: 'e.g. none in winter' }]} />
              {seasonal && (
                <fieldset>
                  <legend className="label">Tap the months with no repayment</legend>
                  <div className="grid grid-cols-4 gap-2">
                    {MONTHS.map((m, i) => {
                      const on = skip.includes(i + 1);
                      return <button key={m} type="button" aria-pressed={on} onClick={() => setSkip(on ? skip.filter((x) => x !== i + 1) : [...skip, i + 1])}
                        className={`min-h-[2.75rem] rounded-xl border font-semibold ${on ? 'border-field bg-field text-white' : 'border-line bg-card'}`}>{m}</button>;
                    })}
                  </div>
                </fieldset>
              )}
            </>
          )}
          {!more ? (
            <Button variant="ghost" onClick={() => setMore(true)}>Interest only, or an end date?</Button>
          ) : (
            <>
              {repaying && (
                <Field label="Interest only until (optional)" htmlFor="loan-io" hint="After it, Agri-It works out the higher repayment from the end date and rate, and says it's worked out.">
                  <input id="loan-io" type="date" className="input" value={io} onChange={(e) => setIo(e.target.value)} />
                </Field>
              )}
              <Field label="Loan ends (optional)" htmlFor="loan-ends">
                <input id="loan-ends" type="date" className="input" min={today} value={ends} onChange={(e) => setEnds(e.target.value)} />
              </Field>
            </>
          )}
        </>
      )}
      <div className="flex gap-2">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button block disabled={!ok || busy} onClick={save}>{existing ? 'Save changes' : 'Save this one'}</Button>
      </div>
    </div>
  );
}
