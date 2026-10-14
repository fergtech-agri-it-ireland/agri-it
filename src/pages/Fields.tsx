import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import type { Field, FieldUse } from '../lib/types';
import { fmtDay, fmtNum, todayISO, uuid } from '../lib/format';
import { lastSpreadOn } from '../lib/forecast/fertiliser';
import { GUIDANCE } from '../lib/spreading';
import { Button, Chips, Empty, Field as FormField, List, NumberInput, Row, Screen, Sheet, TextInput } from '../components/ui';

const USE_LABEL: Record<FieldUse, string> = { grazing: 'Grazing', silage: 'Silage', tillage: 'Tillage', other: 'Other' };

/** The farm's fields. Spreading is recorded per field, and each field can carry the farmer's own round. */
export default function Fields() {
  const b = useFarmData();
  const d = useDerived(b);
  const fields = b.fields.filter((f) => !f.archived);
  const [editing, setEditing] = useState<Field | 'new' | null>(null);
  const today = todayISO();
  const acres = fields.reduce((s, f) => s + Number(f.acres ?? 0), 0);
  return (
    <Screen title="Fields" back right={<Button onClick={() => setEditing('new')}><Plus className="h-5 w-5" aria-hidden />Add</Button>}>
      <p className="px-1 text-[0.9375rem] text-muted">Spreading is recorded field by field. Give a grazing field your own round and Agri-It flags it when it's due again; give a silage field your cutting date and it flags when the nitrogen should go on.</p>
      {fields.length === 0
        ? <Empty title="No fields yet" body="Add your fields with their acres. Rough acres are fine." action={<Button onClick={() => setEditing('new')}>Add a field</Button>} />
        : (
          <>
            <p className="px-1 text-sm font-semibold">{fields.length} field{fields.length > 1 ? 's' : ''}{acres ? `, ${fmtNum(Math.round(acres * 10) / 10)} acres` : ''}</p>
            <List>
              {fields.map((f) => {
                const last = lastSpreadOn(b, f.id, today);
                const due = d.fertiliser.due.find((x) => x.field.id === f.id);
                const plan = f.use === 'silage' && f.cut_on ? `cutting about ${fmtDay(f.cut_on)}` : f.spread_every_days ? `every ${f.spread_every_days} days` : null;
                return (
                  <Row key={f.id} title={f.name}
                    sub={[`${USE_LABEL[f.use]}${f.acres ? `, ${fmtNum(Number(f.acres))} ac` : ''}`, plan, last ? `last spread ${fmtDay(last.on)}` : 'not spread yet'].filter(Boolean).join(' · ')}
                    right={<span className="flex items-center gap-2">
                      {due && due.kind !== 'cut_passed' && <span className="rounded-full bg-hivis/40 px-2 py-0.5 text-xs font-bold">Due</span>}
                      <button type="button" className="min-h-[2.75rem] px-2 font-bold text-accent" onClick={() => setEditing(f)}>Edit</button>
                    </span>} />
                );
              })}
            </List>
          </>
        )}
      {editing && <FieldSheet field={editing === 'new' ? null : editing} count={fields.length} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function FieldSheet({ field, count, onClose }: { field: Field | null; count: number; onClose: () => void }) {
  const { farmId } = useFarmCtx();
  const save = useSave();
  const [name, setName] = useState(field?.name ?? '');
  const [acres, setAcres] = useState(field?.acres !== null && field?.acres !== undefined ? String(field.acres) : '');
  const [use, setUse] = useState<FieldUse>(field?.use ?? 'grazing');
  const [every, setEvery] = useState(field?.spread_every_days ? String(field.spread_every_days) : '');
  const [cutOn, setCutOn] = useState(field?.cut_on ?? '');
  const everyN = every === '' ? null : Math.round(Number(every));
  const everyOk = everyN === null || (everyN >= 7 && everyN <= 120);
  const acresOk = acres === '' || (Number(acres) > 0 && Number(acres) < 10000);

  async function submit() {
    const row = {
      name: name.trim(), acres: acres === '' ? null : Number(acres), use,
      spread_every_days: use === 'silage' || use === 'tillage' ? null : everyN,
      cut_on: use === 'silage' && cutOn ? cutOn : null
    };
    const ok = field
      ? await save([{ kind: 'update', table: 'fields', match: { id: field.id }, patch: row }], { label: 'Field saved', patch: (x) => ({ ...x, fields: x.fields.map((y) => (y.id === field.id ? { ...y, ...row } : y)) }) })
      : await (() => {
        const ins = { id: uuid(), farm_id: farmId!, ...row, sort_order: count };
        return save([{ kind: 'insert', table: 'fields', row: ins }], { label: 'Field added', patch: (x) => ({ ...x, fields: [...x.fields, { ...ins, archived: false } as Field] }) });
      })();
    if (ok) onClose();
  }
  async function archive() {
    if (!field) return;
    const ok = await save([{ kind: 'update', table: 'fields', match: { id: field.id }, patch: { archived: true } }], {
      label: `${field.name} removed from the list`, patch: (x) => ({ ...x, fields: x.fields.map((y) => (y.id === field.id ? { ...y, archived: true } : y)) }),
      undo: [{ kind: 'update', table: 'fields', match: { id: field.id }, patch: { archived: false } }]
    });
    if (ok) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={field ? `Edit ${field.name}` : 'Add a field'}>
      <div className="max-h-[70vh] space-y-4 overflow-auto pb-2">
        <TextInput label="Field name" value={name} onChange={setName} placeholder="e.g. Bottom field, Paddock 4" autoFocus={!field} />
        <NumberInput label="Acres (optional)" value={acres} onChange={setAcres} unit="ac" hint={!acresOk ? 'Check the acres' : 'Used to work out the total for a spreading rate'} />
        <Chips label="Used for" value={use} onChange={setUse} options={(Object.keys(USE_LABEL) as FieldUse[]).map((u) => ({ value: u, label: USE_LABEL[u] }))} />
        {(use === 'grazing' || use === 'other') && (
          <NumberInput label="Spread again every (optional)" value={every} onChange={setEvery} unit="days" integer
            hint={!everyOk ? 'Between 7 and 120 days' : <>Your own round. Agri-It flags the field this many days after it was last spread, only while spreading is allowed. {GUIDANCE.grazing_n.source.publisher}: {GUIDANCE.grazing_n.text.toLowerCase()}</>} />
        )}
        {use === 'silage' && (
          <FormField label="Cutting about (optional)" htmlFor="cut-on" hint={<>{GUIDANCE.silage_n.source.publisher}: {GUIDANCE.silage_n.text} Agri-It flags the field two weeks before that.</>}>
            <input id="cut-on" type="date" className="input" value={cutOn} min={todayISO()} onChange={(e) => setCutOn(e.target.value)} />
          </FormField>
        )}
        <Button block disabled={!name.trim() || !everyOk || !acresOk} onClick={submit}>{field ? 'Save field' : 'Add field'}</Button>
        {field && <Button block variant="secondary" onClick={archive}>Take it off the list</Button>}
      </div>
    </Sheet>
  );
}

export { USE_LABEL };
