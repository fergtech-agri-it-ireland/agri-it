import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, Clock, HelpCircle, Loader2, ScanText } from 'lucide-react';
import { useFarmCtx, useFarmData, useSave } from '../lib/data/farm';
import { ANIMAL_STATUS_LABEL, type Animal, type AnimalStatus } from '../lib/types';
import { fmtDate, todayISO, uuid } from '../lib/format';
import { ANIMAL_CARD_RULE, formatTag, parseTag, readAnimalCard, TAG_HELP, tagProblem, type AnimalCardRead, type TagRead } from '../lib/animalId';
import { NotReadable, readLines } from '../lib/docket/flow';
import { warmReader, type ReadProgress } from '../lib/docket/reader';
import { IN_FRAME, IS_DEMO, IS_LOCAL } from '../lib/env';
import { Button, Card, Chips, DateChips, Empty, Field, SaveBar, Screen, Sheet, TextInput } from '../components/ui';
import { GroupPicker } from '../components/pickers';
import { ScanButton } from '../components/ScanButton';
import { usePhotoUrl } from '../components/PhotoRead';

type Phase =
  | { stage: 'reading'; progress: ReadProgress }
  | { stage: 'read'; read: AnimalCardRead }
  | { stage: 'unavailable'; message: string }
  | { stage: 'unreadable'; message: string };

const STEPS: { step: ReadProgress['step']; label: string }[] = [
  { step: 'cleaning', label: 'Straightening and brightening' },
  { step: 'loading', label: 'Getting the reader ready' },
  { step: 'reading', label: 'Reading the text' },
  { step: 'sorting', label: 'Finding the tag number' }
];
const SURE = { high: 'sure', medium: 'fairly sure', low: 'not sure' } as const;

/**
 * Add an animal, or change one. Scan the blue identity card (or type the tag number): the photo is
 * read on the phone, the tag number is offered with how sure the reader was, and nothing is saved
 * until the farmer taps Save. The photo itself is not kept.
 */
export default function AnimalForm() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const loc = useLocation();
  const today = todayISO();
  const existing = id ? b.animals.find((a) => a.id === id) : undefined;

  const [tag, setTag] = useState(existing ? formatTag(existing.tag_number) : '');
  const [other, setOther] = useState(!!existing && !parseTag(existing.tag_number));
  const [groupId, setGroupId] = useState<string | null>(existing?.animal_group_id ?? null);
  const [sex, setSex] = useState<'female' | 'male' | ''>(existing?.sex ?? '');
  const [breed, setBreed] = useState(existing?.breed ?? '');
  const [born, setBorn] = useState(existing?.born_on ?? '');
  const [status, setStatus] = useState<AnimalStatus>(existing?.status ?? 'on_farm');
  const [leftOn, setLeftOn] = useState(existing?.left_on ?? today);
  const [note, setNote] = useState(existing?.note ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [big, setBig] = useState(false);
  const [saved, setSaved] = useState<Animal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = useRef(0);
  const url = usePhotoUrl(photo);

  // Get the reader's files cached while there's signal
  useEffect(() => { const t = setTimeout(warmReader, 1500); return () => clearTimeout(t); }, []);

  async function scan(f: File) {
    setPhoto(f);
    setSaved(null);
    // The number comes from this photo only: whatever was in the box from an earlier card goes
    setTag('');
    setOther(false);
    const mine = ++run.current;
    setPhase({ stage: 'reading', progress: { step: 'cleaning', progress: 0 } });
    try {
      const { lines, reader } = await readLines(f, (p) => { if (run.current === mine) setPhase({ stage: 'reading', progress: p }); });
      if (run.current !== mine) return;
      setPhase({ stage: 'reading', progress: { step: 'sorting', progress: 1 } });
      const read = readAnimalCard(lines, reader);
      setPhase({ stage: 'read', read });
      // One number, read clearly or fairly clearly, goes into the box. Several: the farmer picks.
      if (read.tags.length === 1 && read.tags[0].confidence !== 'low') { setTag(formatTag(read.tags[0].value.canonical)); setOther(false); }
    } catch (e) {
      if (run.current !== mine) return;
      setPhase(e instanceof NotReadable ? { stage: 'unreadable', message: e.message } : { stage: 'unavailable', message: (e as Error).message });
    }
  }
  // A photo taken on the animal list comes with us
  const arrived = useRef(false);
  useEffect(() => {
    const f = (loc.state as { photo?: File } | null)?.photo;
    if (f && !arrived.current && !existing) { arrived.current = true; void scan(f); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = other ? null : parseTag(tag);
  const canonical = other ? tag.toUpperCase().replace(/\s+/g, '') : parsed?.canonical ?? '';
  const problem = other ? (canonical.length > 30 ? 'That is too long for a tag.' : null) : tagProblem(tag);
  const dupe = canonical ? b.animals.find((a) => a.id !== existing?.id && a.tag_number === canonical) : undefined;
  const read = phase?.stage === 'read' ? phase.read : null;
  const fromCard: TagRead | undefined = read?.tags.find((t) => t.value.canonical === canonical);
  const datesBad = (born && born > today) ? 'Born cannot be in the future.' : status !== 'on_farm' && born && leftOn < born ? 'It cannot leave before it was born.' : null;
  const ready = canonical.length >= 3 && !problem && !dupe && !datesBad;

  const rowFrom = (animalId: string): Animal => ({
    id: animalId, farm_id: farmId!, tag_number: canonical, tag_source: fromCard ? 'card_photo' : (existing?.tag_source === 'card_photo' && existing.tag_number === canonical ? 'card_photo' : 'typed'),
    animal_group_id: groupId, sex: sex || null, breed: breed.trim() || null, born_on: born || null,
    status, left_on: status === 'on_farm' ? null : leftOn, note: note.trim() || null
  });

  async function submit() {
    if (!ready) return;
    if (existing) {
      const next = rowFrom(existing.id);
      const patch = { tag_number: next.tag_number, tag_source: next.tag_source, animal_group_id: next.animal_group_id, sex: next.sex, breed: next.breed, born_on: next.born_on, status: next.status, left_on: next.left_on, note: next.note };
      const old = { tag_number: existing.tag_number, tag_source: existing.tag_source, animal_group_id: existing.animal_group_id, sex: existing.sex, breed: existing.breed, born_on: existing.born_on, status: existing.status, left_on: existing.left_on, note: existing.note };
      const ok = await save([{ kind: 'update', table: 'animals', match: { id: existing.id }, patch }], {
        label: `${formatTag(next.tag_number)} saved`,
        patch: (x) => ({ ...x, animals: x.animals.map((a) => (a.id === existing.id ? { ...a, ...patch } : a)) }),
        undo: [{ kind: 'update', table: 'animals', match: { id: existing.id }, patch: old }]
      });
      if (ok) nav(-1);
      return;
    }
    const row = rowFrom(uuid());
    const ok = await save([{ kind: 'insert', table: 'animals', row: { ...row } }], {
      label: `${formatTag(row.tag_number)} added`,
      patch: (x) => ({ ...x, animals: [...x.animals, row] }),
      undo: [{ kind: 'delete', table: 'animals', match: { id: row.id } }]
    });
    if (ok) { setSaved(row); setPhoto(null); setPhase(null); setTag(''); setOther(false); setBorn(''); setSex(''); setBreed(''); setNote(''); setStatus('on_farm'); }
  }

  async function remove() {
    if (!existing) return;
    const { created_at: _c, updated_at: _u, ...row } = existing; // eslint-disable-line @typescript-eslint/no-unused-vars
    const ok = await save([{ kind: 'delete', table: 'animals', match: { id: existing.id } }], {
      label: `${formatTag(existing.tag_number)} deleted`,
      patch: (x) => ({ ...x, animals: x.animals.filter((a) => a.id !== existing.id) }),
      undo: [{ kind: 'insert', table: 'animals', row: { ...row } }]
    });
    if (ok) { setConfirmDelete(false); nav('/animals', { replace: true }); }
  }

  if (id && !existing) return <Screen title="Animal" back="/animals"><Empty title="Animal not found" body="It may have been deleted on another phone." action={<Link to="/animals" className="font-bold text-accent">Back to the animals</Link>} /></Screen>;

  const group = b.groups.find((g) => g.id === groupId);
  const unavailableText = IS_DEMO
    ? 'Can\'t read this photo here: the demo page blocks the photo reader. In the app, the reader sets itself up the first time you have signal. Type the tag number below.'
    : IS_LOCAL && IN_FRAME
      ? 'Photo reading does not work in this shared link yet. Type the tag number below.'
      : 'Can\'t read photos on this phone right now. The reader needs signal once to set itself up. Type the tag number below.';

  return (
    <Screen title={existing ? 'Change animal' : 'Add an animal'} back="/animals">
      {saved && (
        <Card className="space-y-3 bg-field-light" >
          <div data-testid="animal-saved">
            <p className="flex items-center gap-1.5 font-bold text-accent"><Check className="h-5 w-5" aria-hidden />Added</p>
            <p className="text-xl font-extrabold leading-tight">{formatTag(saved.tag_number)}</p>
            <p className="text-[0.9375rem] text-muted">{[b.groups.find((g) => g.id === saved.animal_group_id)?.name, saved.sex === 'female' ? 'Female' : saved.sex === 'male' ? 'Male' : null].filter(Boolean).join(', ') || 'No group yet'}</p>
          </div>
          <ScanButton onFile={scan} label="Scan the next card" />
          <Button variant="secondary" block onClick={() => nav('/animals')}>Done</Button>
        </Card>
      )}

      {!existing && !saved && (
        <Card className="space-y-2">
          <ScanButton onFile={scan} label={IS_DEMO ? 'Pick a photo of the animal card' : 'Scan the blue animal card'} />
          <p className="text-[0.8125rem] text-muted">The card is read on this phone and the tag number is filled in. You check it against the card, then save. The photo is not kept.</p>
        </Card>
      )}

      {phase?.stage === 'reading' && (
        <Card className="space-y-1" >
          <div data-testid="reading">
            {STEPS.map((s, i) => {
              const at = STEPS.findIndex((x) => x.step === phase.progress.step);
              const state = i < at ? 'done' : i === at ? 'now' : 'next';
              return (
                <p key={s.step} className={`flex min-h-[2.5rem] items-center gap-2.5 ${state === 'next' ? 'text-muted' : 'font-bold'}`}>
                  {state === 'done' ? <Check className="h-5 w-5 text-ok" aria-hidden /> : state === 'now' ? <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden /> : <Clock className="h-5 w-5" aria-hidden />}
                  {s.label}{state === 'now' && phase.progress.progress > 0 && phase.progress.progress < 1 ? ` ${Math.round(phase.progress.progress * 100)}%` : ''}
                </p>
              );
            })}
          </div>
        </Card>
      )}

      {phase?.stage === 'unavailable' && <Card><p data-testid="read-unavailable" className="text-[0.9375rem]">{unavailableText}</p></Card>}
      {phase?.stage === 'unreadable' && <Card><p data-testid="read-unreadable" className="text-[0.9375rem]">{phase.message} Type the tag number below.</p></Card>}

      {read && (
        <Card className="space-y-3" >
          <div data-testid="card-read" data-rule={ANIMAL_CARD_RULE}>
            <div className="flex gap-3">
              {url && (
                <button type="button" onClick={() => setBig(true)} className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-line" aria-label="See the photo">
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              )}
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[0.95rem] font-bold text-accent"><ScanText className="h-5 w-5" aria-hidden />Read from the card</p>
                <p className="text-[0.95rem] text-muted">{read.reader}. Text {read.pageConfidence >= 85 ? 'clear' : read.pageConfidence >= 65 ? 'mostly clear' : 'hard to read'}.</p>
              </div>
            </div>

            {read.tags.length === 0 && (
              <p className="mt-3 flex items-start gap-2 text-[0.95rem]" data-testid="no-tag"><HelpCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />Couldn&apos;t find a tag number on the photo. Try again with the card flat and the number in the middle of the photo, or type it below.</p>
            )}
            {read.tags.length === 1 && (
              <p className="mt-3 text-[0.95rem]" data-testid="one-tag"><b>{formatTag(read.tags[0].value.canonical)}</b>: {SURE[read.tags[0].confidence]}.{read.tags[0].note ? ` ${read.tags[0].note}.` : ''} Check it against the card.</p>
            )}
            {read.tags.length > 1 && (
              <div className="mt-3 space-y-2" data-testid="many-tags">
                <p className="text-[0.95rem] font-bold">More than one number on the card. Which is this animal&apos;s?</p>
                {read.tags.map((t) => (
                  <button key={t.value.canonical} type="button" data-tag={t.value.canonical} onClick={() => { setTag(formatTag(t.value.canonical)); setOther(false); }}
                    className={`flex min-h-[3.5rem] w-full flex-col items-start justify-center rounded-xl border px-3 py-2 text-left ${canonical === t.value.canonical ? 'border-field bg-field-light' : 'border-line bg-card'}`}>
                    <b className="text-[1.0625rem]">{formatTag(t.value.canonical)}</b>
                    <span className="text-[0.8125rem] text-muted">From &ldquo;{t.from.length > 50 ? `${t.from.slice(0, 47)}...` : t.from}&rdquo;</span>
                  </button>
                ))}
              </div>
            )}
            {read.bornOn && !born && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-hivis/30 p-2" data-testid="born-suggestion">
                <p className="min-w-0 flex-1 text-[0.95rem]">Date of birth on the card: <b>{fmtDate(read.bornOn.value)}</b>. Not sure of it.</p>
                <Button variant="secondary" onClick={() => setBorn(read.bornOn!.value)}>Use it</Button>
              </div>
            )}
            <p className="mt-3 text-[0.8125rem] text-muted">Agri-It checks the shape of the number (372 and 12 digits, or IE and 12 digits), not whether the tag exists. Always check it against the card.</p>
          </div>
        </Card>
      )}

      {!saved && (
        <Card className="space-y-4">
          {other ? (
            <TextInput label="Tag or number" value={tag} onChange={setTag} hint="Any number you use for this animal: a sheep or pig tag, a horse's passport number or your own number." autoFocus />
          ) : (
            <TextInput label="Tag number" value={tag} onChange={setTag} placeholder="372 12 34567 8 1234" hint={TAG_HELP} />
          )}
          {parsed && <p className="text-[0.95rem] font-semibold" data-testid="tag-shown">{formatTag(parsed.canonical)}{fromCard ? ' (read from the card)' : ''}</p>}
          {tag && problem && <p role="alert" className="font-bold text-danger">{problem}</p>}
          {dupe && <p role="alert" className="font-bold text-danger" data-testid="tag-dupe">That tag is already on the farm. <Link to={`/animals/${dupe.id}`} className="underline">Open it</Link></p>}
          <button type="button" className="min-h-[2.75rem] text-sm font-bold text-accent" onClick={() => { setOther(!other); }}>
            {other ? 'It is a cattle tag' : 'Not a cattle tag? Type any number'}
          </button>

          <GroupPicker b={b} value={groupId} onChange={(g) => setGroupId(g === groupId ? null : g)} label="Which group? (optional)" />
          {group && <p className="hint">Tap the group again to leave it out. Group head counts are not changed.</p>}
          <Chips label="Sex" value={sex} onChange={setSex} columns={3} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: '', label: 'Not said' }]} />
          <TextInput label="Breed (optional)" value={breed} onChange={setBreed} placeholder="e.g. Angus, or Holstein Friesian" />
          <Field label="Born (optional)" htmlFor="born"><input id="born" type="date" className="input" max={today} value={born} onChange={(e) => setBorn(e.target.value)} /></Field>
          <Chips label="Where is it now?" value={status} onChange={setStatus} columns={2} options={(Object.keys(ANIMAL_STATUS_LABEL) as AnimalStatus[]).map((s) => ({ value: s, label: ANIMAL_STATUS_LABEL[s] }))} />
          {status !== 'on_farm' && <DateChips label={status === 'sold' ? 'Sold on' : status === 'died' ? 'Died on' : 'Left on'} value={leftOn} onChange={setLeftOn} />}
          {datesBad && <p role="alert" className="font-bold text-danger">{datesBad}</p>}
          <TextInput label="Note (optional)" value={note} onChange={setNote} voice />
          {existing && <Button variant="danger" block onClick={() => setConfirmDelete(true)}>Delete this animal</Button>}
        </Card>
      )}

      {!saved && (
        <SaveBar>
          <Button block disabled={!ready} onClick={submit}>{existing ? 'Save changes' : 'Save animal'}</Button>
        </SaveBar>
      )}

      <Sheet open={big} onClose={() => setBig(false)} title="The photo">
        {url && <img src={url} alt="The photo of the animal card" className="max-h-[70vh] w-full rounded-xl object-contain" />}
      </Sheet>
      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this animal?">
        <div className="space-y-3 pb-2">
          <p className="text-[0.9375rem]">You are about to delete <b>{existing ? formatTag(existing.tag_number) : ''}</b>. Only this animal&apos;s record is removed. The group&apos;s head count, feed forecasts and money are not changed. You can undo it straight after.</p>
          <Button variant="danger" block onClick={remove}>Yes, delete</Button>
          <Button variant="secondary" block onClick={() => setConfirmDelete(false)}>No, keep it</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
