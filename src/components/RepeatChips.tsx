import type { RepeatChoice } from '../lib/routines';
import { Chips } from './ui';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "Does this repeat?" on money forms: turns one entry into a routine ticked off on Today. */
export function RepeatChips({ value, onChange, date }: { value: RepeatChoice; onChange: (v: RepeatChoice) => void; date: string }) {
  const d = new Date(date + 'T00:00:00Z');
  return (
    <Chips<RepeatChoice> label="Does this repeat?" columns={3} value={value} onChange={onChange}
      options={[
        { value: 'none', label: 'No' },
        { value: 'weekly', label: 'Weekly', sub: `${WEEKDAYS[d.getUTCDay()]}s` },
        { value: 'monthly', label: 'Monthly', sub: `On the ${ordinal(d.getUTCDate())}` }
      ]}
      hint={value === 'none' ? undefined : 'It will show on Today when due, ready to tick off. Nothing is recorded until you do.'} />
  );
}
