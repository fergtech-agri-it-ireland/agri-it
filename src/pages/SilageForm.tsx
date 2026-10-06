import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { estimateStore } from '../lib/forecast/forage';
import type { SilageMethod, SilageStore } from '../lib/types';
import { fmtNum, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';

const n = (s: string) => (s === '' ? null : Number(s));
const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export default function SilageForm() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const ex = b.silage.find((x) => x.id === id);
  const [name, setName] = useState(ex?.name ?? '');
  const [method, setMethod] = useState<SilageMethod>(ex?.method ?? 'pit_dimensions');
  const [v, setV] = useState<Record<string, string>>({
    acreage: s(ex?.acreage), yield_t_per_acre: s(ex?.yield_t_per_acre), length_m: s(ex?.length_m), width_m: s(ex?.width_m),
    avg_height_m: s(ex?.avg_height_m), density_kg_m3: s(ex?.density_kg_m3), bale_count: s(ex?.bale_count), bale_weight_kg: s(ex?.bale_weight_kg),
    measured_tonnes: s(ex?.measured_tonnes), dm_percent: s(ex?.dm_percent), dmd_percent: s(ex?.dmd_percent), crude_protein_percent: s(ex?.crude_protein_percent),
    ph: s(ex?.ph), fed_out_tonnes: s(ex?.fed_out_tonnes ?? 0)
  });
  const [measuredOn, setMeasuredOn] = useState(ex?.measured_on ?? todayISO());
  const set = (k: string) => (val: string) => setV({ ...v, [k]: val });
  const row = {
    id: ex?.id ?? uuid(), farm_id: farmId!, name: name || (method === 'bale_count' ? 'Bales' : 'Silage pit'), method, measured_on: measuredOn,
    ...Object.fromEntries(Object.entries(v).map(([k, val]) => [k, n(val)])), fed_out_tonnes: n(v.fed_out_tonnes) ?? 0, notes: ex?.notes ?? null
  } as SilageStore;
  const est = estimateStore(row);

  async function submit() {
    const ok = await save([ex ? { kind: 'update', table: 'silage_stores', match: { id: row.id }, patch: row as unknown as Record<string, unknown> } : { kind: 'insert', table: 'silage_stores', row: row as unknown as Record<string, unknown> }], {
      label: 'Silage saved',
      patch: (x) => ({ ...x, silage: ex ? x.silage.map((y) => (y.id === row.id ? row : y)) : [...x.silage, row] })
    });
    if (ok) nav('/farm/silage', { replace: true });
  }
  async function remove() {
    const ok = await save([{ kind: 'delete', table: 'silage_stores', match: { id: row.id } }], { label: 'Removed', patch: (x) => ({ ...x, silage: x.silage.filter((y) => y.id !== row.id) }), undo: [{ kind: 'insert', table: 'silage_stores', row: ex as unknown as Record<string, unknown> }] });
    if (ok) nav('/farm/silage', { replace: true });
  }

  return (
    <Screen title={ex ? 'Edit silage' : 'Add silage'} back="/farm/silage">
      <Card className="space-y-5">
        <TextInput label="Name" value={name} onChange={setName} placeholder="e.g. Main pit" />
        <Chips label="How do you know how much?" columns={2} value={method} onChange={setMethod} options={[
          { value: 'pit_dimensions', label: 'Measured pit', sub: 'Length × width × height' },
          { value: 'bale_count', label: 'Counted bales' },
          { value: 'measured_tonnes', label: 'Weighed', sub: 'Tonnes known' },
          { value: 'acreage', label: 'Acres cut', sub: 'Planning estimate only' }
        ]} />
        {method === 'pit_dimensions' && (
          <div className="grid grid-cols-3 gap-2">
            <NumberInput label="Length" value={v.length_m} onChange={set('length_m')} unit="m" />
            <NumberInput label="Width" value={v.width_m} onChange={set('width_m')} unit="m" />
            <NumberInput label="Avg height" value={v.avg_height_m} onChange={set('avg_height_m')} unit="m" />
          </div>
        )}
        {method === 'pit_dimensions' && <NumberInput label="Density" value={v.density_kg_m3} onChange={set('density_kg_m3')} unit="kg/m³" hint="From your silage analysis or advisor. Agri-It doesn't assume one." />}
        {method === 'bale_count' && <div className="grid grid-cols-2 gap-2"><NumberInput label="Bales" value={v.bale_count} onChange={set('bale_count')} integer /><NumberInput label="Avg bale weight" value={v.bale_weight_kg} onChange={set('bale_weight_kg')} unit="kg" /></div>}
        {method === 'measured_tonnes' && <NumberInput label="Fresh tonnes" value={v.measured_tonnes} onChange={set('measured_tonnes')} unit="t" />}
        {method === 'acreage' && <div className="grid grid-cols-2 gap-2"><NumberInput label="Acres" value={v.acreage} onChange={set('acreage')} unit="ac" /><NumberInput label="Expected yield" value={v.yield_t_per_acre} onChange={set('yield_t_per_acre')} unit="t/ac" /></div>}
        <NumberInput label="Already fed out" value={v.fed_out_tonnes} onChange={set('fed_out_tonnes')} unit="t" />
        <DateChips label="Measured on" value={measuredOn} onChange={setMeasuredOn} />
        <p className="rounded-xl bg-pasture p-3 font-bold">{est.tonnes !== null ? `About ${fmtNum(Math.round(est.tonnes))} t fresh` : est.missing}</p>
      </Card>
      <Card className="space-y-4">
        <p className="font-bold">Lab analysis (optional)</p>
        <p className="hint">Stored for your records and advisor. Agri-It won't build a ration from it.</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="DM" value={v.dm_percent} onChange={set('dm_percent')} unit="%" />
          <NumberInput label="DMD" value={v.dmd_percent} onChange={set('dmd_percent')} unit="%" />
          <NumberInput label="Crude protein" value={v.crude_protein_percent} onChange={set('crude_protein_percent')} unit="%" />
          <NumberInput label="pH" value={v.ph} onChange={set('ph')} />
        </div>
      </Card>
      {ex && <Button variant="danger" block onClick={remove}>Remove</Button>}
      <SaveBar><Button block onClick={submit}>Save</Button></SaveBar>
    </Screen>
  );
}
