import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { MAX_AT_ONCE, parseTagList, planAdd, type NewAnimalDetails } from '../lib/animalBulk';
import { CLASS_RANK } from '../lib/lifeStages';
import { SPECIES_LABEL, type AnimalSpecies } from '../lib/types';
import { formatTag } from '../lib/animalId';
import { fmtNum, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, Field, SaveBar, Screen, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';

/** Add a lot of animals in one go: a list of tags that share a kind, group, breed and birth date. */
export default function AnimalMany() {
  const b = useFarmData();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const [species, setSpecies] = useState<AnimalSpecies>('cattle');
  const [text, setText] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sex, setSex] = useState<'female' | 'male' | ''>('');
  const [castrated, setCastrated] = useState<'yes' | 'no' | ''>('');
  const [breed, setBreed] = useState('');
  const [born, setBorn] = useState('');
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => parseTagList(text, species), [text, species]);
  const existing = useMemo(() => new Set(b.animals.map((a) => a.tag_number)), [b.animals]);
  const details: NewAnimalDetails = { species, groupId, sex: sex || null, castrated: sex === 'male' && castrated ? castrated === 'yes' : null, breed, bornOn: born };
  const plan = useMemo(() => planAdd(list, existing, details, b.farm.id, uuid), [list, existing, species, groupId, sex, castrated, breed, born, b.farm.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = plan.rows.length;
  const tooMany = n > MAX_AT_ONCE;
  const badBorn = born && born > today ? 'Born cannot be in the future.' : null;
  const ready = n > 0 && !tooMany && !badBorn && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    const ok = await save(plan.ops, {
      label: `${fmtNum(n)} animal${n === 1 ? '' : 's'} added`,
      patch: (x) => ({ ...x, animals: [...x.animals, ...plan.rows] }),
      undo: plan.undo
    });
    setBusy(false);
    if (ok) nav('/animals/herd', { replace: true });
  }

  return (
    <Screen title="Add several" back="/animals/add">
      <Card className="space-y-4">
        <Chips label="What kind of animal?" value={species} onChange={setSpecies} columns={3}
          options={(Object.keys(SPECIES_LABEL) as AnimalSpecies[]).map((k) => ({ value: k, label: SPECIES_LABEL[k] }))} />
        <Field label="Tag numbers" htmlFor="tags" hint={species === 'cattle' ? 'One per line, or separated by commas or spaces. Paste them straight from a spreadsheet or the herd register.' : 'One per line, or separated by commas.'}>
          <textarea id="tags" className="input min-h-[10rem] font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={species === 'cattle' ? '372 12 34567 8 1234\n372 12 34567 8 1235' : 'A101\nA102'} spellCheck={false} autoCapitalize="characters" />
        </Field>
        {text.trim() !== '' && (
          <div data-testid="many-summary" className="space-y-1 rounded-xl bg-field-light px-3 py-2 text-[0.9375rem]">
            <p><b>{fmtNum(n)}</b> {n === 1 ? 'animal' : 'animals'} will be added.</p>
            {plan.alreadyHere.length > 0 && <p className="text-muted">{fmtNum(plan.alreadyHere.length)} already on the farm, so skipped.</p>}
            {list.repeated.length > 0 && <p className="text-muted">{fmtNum(list.repeated.length)} given twice, added once.</p>}
            {list.unreadable.length > 0 && (
              <p role="alert" className="font-semibold text-danger">{fmtNum(list.unreadable.length)} could not be read as a tag: {list.unreadable.slice(0, 3).map((u) => `"${u.length > 24 ? `${u.slice(0, 21)}...` : u}"`).join(', ')}{list.unreadable.length > 3 ? ' and more' : ''}. They will not be added.</p>
            )}
            {plan.alreadyHere.length > 0 && plan.alreadyHere.length <= 3 && <p className="text-muted">Already here: {plan.alreadyHere.map((t) => formatTag(t)).join(', ')}.</p>}
            {tooMany && <p role="alert" className="font-bold text-danger">That is more than {fmtNum(MAX_AT_ONCE)} at once. Add them in smaller lists.</p>}
          </div>
        )}
      </Card>
      <Card className="space-y-4">
        <p className="text-[0.9375rem] text-muted">Details that every animal in the list shares. All optional: you can fill them in later.</p>
        <GroupPicker b={b} value={groupId} label="Which group?" onChange={(g) => {
          setGroupId(g === groupId ? null : g);
          const sp = CLASS_RANK[b.groups.find((x) => x.id === g)?.animal_class ?? 'other']?.species;
          if (g !== groupId && sp && sp !== species && !text.trim()) setSpecies(sp);
        }} />
        <Chips label="Sex" value={sex} onChange={(v) => { setSex(v); if (v !== 'male') setCastrated(''); }} columns={3} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: '', label: 'Not said' }]} />
        {sex === 'male' && ['cattle', 'sheep', 'goat', 'pig', 'horse'].includes(species) && (
          <Chips label={species === 'cattle' ? 'Bull or bullock?' : 'Castrated?'} value={castrated} onChange={setCastrated} columns={3}
            options={[{ value: 'no', label: species === 'cattle' ? 'Bull' : 'No' }, { value: 'yes', label: species === 'cattle' ? 'Bullock' : 'Yes' }, { value: '', label: 'Not said' }]} />
        )}
        <TextInput label="Breed" value={breed} onChange={setBreed} placeholder="e.g. Angus, or Suffolk cross" />
        <Field label="Born" htmlFor="born" hint="If they were all born in the same week, pick the middle of it. Agri-It works out calf, weanling and the rest from this.">
          <input id="born" type="date" className="input" max={today} value={born} onChange={(e) => setBorn(e.target.value)} />
        </Field>
        {badBorn && <p role="alert" className="font-bold text-danger">{badBorn}</p>}
      </Card>
      <p className="px-1 text-[0.8125rem] text-muted">Group head counts are not changed, because they drive your feed forecasts. Set them on the <Link to="/farm/groups" className="font-bold text-accent underline">group pages</Link>. You can undo straight after saving.</p>
      <SaveBar><Button block disabled={!ready} onClick={submit}>{n > 0 ? `Add ${fmtNum(n)} ${n === 1 ? 'animal' : 'animals'}` : 'Add animals'}</Button></SaveBar>
    </Screen>
  );
}
