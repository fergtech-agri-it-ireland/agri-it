import { Chips } from './ui';
import { FARM_TYPE_LABEL } from '../lib/farmTypes';
import type { FarmType } from '../lib/types';

/** "Which part of the farm?" Only shown on farms that do more than one thing. */
export function EnterpriseChips({ types, value, onChange }: { types: FarmType[]; value: FarmType | null; onChange: (v: FarmType | null) => void }) {
  if (types.length < 2) return null;
  return (
    <Chips<string> label="Which part of the farm? (optional)" columns={2} value={value ?? 'whole'}
      onChange={(v) => onChange(v === 'whole' ? null : (v as FarmType))}
      options={[{ value: 'whole', label: 'Whole farm' }, ...types.map((t) => ({ value: t, label: FARM_TYPE_LABEL[t] }))]}
      hint="Lets Money show what each enterprise earns and costs. Leave on Whole farm for shared costs." />
  );
}
