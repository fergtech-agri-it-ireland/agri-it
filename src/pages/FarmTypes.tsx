import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { farmTypes, legacyEnterprise } from '../lib/farmTypes';
import type { FarmType } from '../lib/types';
import { FarmTypePicker } from '../components/FarmPickers';
import { Button, SaveBar, Screen } from '../components/ui';

/** Change what the farm does at any time. It only changes what Agri-It shows first. */
export default function FarmTypes() {
  const b = useFarmData();
  const save = useSave();
  const nav = useNavigate();
  const before = farmTypes(b.farm);
  const [types, setTypes] = useState<FarmType[]>(before);
  const changed = types.length !== before.length || types.some((t) => !before.includes(t));

  async function submit() {
    const patch = { enterprises: types, enterprise: legacyEnterprise(types) };
    const ok = await save([{ kind: 'update', table: 'farms', match: { id: b.farm.id }, patch }], {
      label: 'Farm types saved',
      patch: (x) => ({ ...x, farm: { ...x.farm, ...patch } }),
      undo: [{ kind: 'update', table: 'farms', match: { id: b.farm.id }, patch: { enterprises: before, enterprise: b.farm.enterprise } }]
    });
    if (ok) nav(-1);
  }

  return (
    <Screen title="What you farm" back>
      <p className="px-1 text-[0.9375rem] text-muted">Pick everything you do. Agri-It puts what matters for your farming first. You can still record anything.</p>
      <FarmTypePicker value={types} onChange={setTypes} />
      <SaveBar><Button block disabled={!changed} onClick={submit}>Save</Button></SaveBar>
    </Screen>
  );
}
