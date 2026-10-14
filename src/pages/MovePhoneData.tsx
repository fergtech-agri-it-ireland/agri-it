import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Smartphone, ClipboardPaste, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFarmCtx } from '../lib/data/farm';
import { Button, Card, Chips, Screen, SectionTitle } from '../components/ui';
import { Splash } from '../components/Layout';
import {
  backupFarms, chunkPlan, IMPORT_ORDER, parseBackup, planPhoneImport, resultLine, sumResults, TABLE_LABEL,
  type ImportResult, type PhoneBackup
} from '../lib/phoneImport';
import { farmTypes } from '../lib/farmTypes';
import { unpackBackup } from '../lib/phoneBackup';

/** The phone app keeps its records under this key, on the same web address as the online app. */
const PHONE_DB_KEY = 'agri-it:phone-db';
const PHONE_FILES_DB = 'agri-it-files';

/** The phone app's records, when it has been used in this same browser. */
function phoneRecordsHere(): PhoneBackup | null {
  try {
    const raw = localStorage.getItem(PHONE_DB_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { v: number; db: PhoneBackup['db'] };
    if (!p?.db?.farms?.length) return null;
    return { app: 'agri-it', kind: 'phone-backup', v: p.v, db: p.db };
  } catch { return null; }
}

/** A photo the phone app kept in this browser, if it is here. */
function phonePhoto(path: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(PHONE_FILES_DB);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('files')) { d.close(); return resolve(null); }
        const g = d.transaction('files').objectStore('files').get(path);
        g.onsuccess = () => { d.close(); resolve((g.result as Blob) ?? null); };
        g.onerror = () => { d.close(); resolve(null); };
      };
    } catch { resolve(null); }
  });
}

type Source = 'here' | 'file' | 'paste';

/**
 * Move my phone data to my account. Takes the phone app's backup (or the phone app's records
 * in this same browser) and copies them into a farm in this account. Nothing is recorded until
 * the farmer taps Move; running it again adds nothing.
 */
export default function MovePhoneData() {
  const { session, sessionLoading, farms, farmsLoading, selectFarm, refreshFarms } = useFarmCtx();
  const nav = useNavigate();
  const qc = useQueryClient();
  const here = useMemo(phoneRecordsHere, []);
  const [source, setSource] = useState<Source>(here ? 'here' : 'file');
  const [backup, setBackup] = useState<PhoneBackup | null>(here);
  const [pasted, setPasted] = useState('');
  // Photos carried inside a full (zip) backup file, by their phone path
  const [zipPhotos, setZipPhotos] = useState<Map<string, Blob>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [phoneFarmId, setPhoneFarmId] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('new');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ result: ImportResult; photos: number; farmId: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const userId = session?.user.id;

  // Farms this person owns: only an owner can move records into a farm
  const owned = useQuery({
    queryKey: ['owned-farms', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error: e } = await supabase.from('farm_members').select('farm_id, role').eq('user_id', userId!);
      if (e) throw e;
      return (data as { farm_id: string; role: string }[]).filter((m) => m.role === 'owner').map((m) => m.farm_id);
    }
  });
  const ownedFarms = farms.filter((f) => owned.data?.includes(f.id));
  useEffect(() => { if (ownedFarms.length === 1 && target === 'new') setTarget(ownedFarms[0].id); }, [ownedFarms.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const phoneFarms = backup ? backupFarms(backup) : [];
  const chosenPhoneFarm = phoneFarmId ?? phoneFarms[0]?.id ?? null;
  const plan = useMemo(() => {
    if (!backup || !chosenPhoneFarm) return null;
    try { return planPhoneImport(backup, target === 'new' ? '00000000-0000-4000-8000-000000000000' : target, chosenPhoneFarm); } catch { return null; }
  }, [backup, chosenPhoneFarm, target]);

  if (sessionLoading || farmsLoading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;

  const read = (text: string, photos: Map<string, Blob> = new Map()) => {
    setError(null);
    setZipPhotos(photos);
    try { const b = parseBackup(text); setBackup(b); setPhoneFarmId(null); } catch (e) { setBackup(null); setError((e as Error).message); }
  };
  const pick = (s: Source) => { setSource(s); setError(null); setBackup(s === 'here' ? here : null); };

  async function move() {
    if (!backup || !chosenPhoneFarm) return;
    setBusy(true); setError(null);
    try {
      let farmId = target;
      if (target === 'new') {
        // A new online farm, named and placed like the phone farm
        const pf = backup.db.farms.find((f) => f.id === chosenPhoneFarm)!;
        const { data, error: e } = await supabase.rpc('create_farm', {
          p_name: String(pf.name ?? 'My farm'), p_county: String(pf.county ?? ''), p_eircode: (pf.eircode as string) ?? null,
          p_jurisdiction: (pf.jurisdiction as string) ?? 'ROI', p_enterprises: farmTypes(pf as never),
          p_default_lead_time_days: (pf.default_lead_time_days as number) ?? null
        });
        if (e) throw new Error(e.message);
        farmId = String(data);
      }
      const p = planPhoneImport(backup, farmId, chosenPhoneFarm);
      const results: ImportResult[] = [];
      const chunks = chunkPlan(p);
      for (let i = 0; i < Math.max(chunks.length, 1); i++) {
        const { data, error: e } = await supabase.rpc('import_phone_backup', { p_farm_id: farmId, p_farm: i === 0 ? p.farm : {}, p_rows: chunks[i] ?? {} });
        if (e) throw new Error(e.message);
        results.push(data as ImportResult);
      }
      // Photos the phone app kept in this browser go to the farm's folder
      let photos = 0;
      for (const ph of p.photoPaths) {
        const blob = zipPhotos.get(ph.from) ?? (await phonePhoto(ph.from));
        if (!blob) continue;
        const { error: e } = await supabase.storage.from('records').upload(ph.to, blob, { upsert: false, contentType: blob.type || 'image/jpeg' });
        if (!e || /exist/i.test(e.message)) photos++;
      }
      await refreshFarms();
      selectFarm(farmId);
      await qc.invalidateQueries({ queryKey: ['bundle'] });
      setDone({ result: sumResults(results), photos, farmId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen title="Phone data moved" back="/settings">
        <Card>
          <p className="flex items-start gap-3 text-lg font-bold"><CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-accent" aria-hidden />{resultLine(done.result)}</p>
          {done.photos > 0 && <p className="mt-2">{done.photos} photo{done.photos === 1 ? '' : 's'} copied from this phone.</p>}
          {plan && plan.photoPaths.length > done.photos && (
            <p className="mt-2 text-sm text-muted">Some photos were not in this backup. Use a full backup file (Back up in the phone app), or open this page on the phone they were taken on.</p>
          )}
          <p className="mt-2 text-sm text-muted">The phone app still has its own copy. Nothing there was changed or deleted.</p>
        </Card>
        <Button block onClick={() => nav('/', { replace: true })}>Open the farm</Button>
      </Screen>
    );
  }

  return (
    <Screen title="Move my phone data" back={farms.length ? '/settings' : '/onboarding'}>
      <Card>
        <p>Copy the records from the Agri-It phone app into your account, so they are kept safe online and can be shared with your farm. Every record keeps its date, and bills keep whether they are paid or still owed.</p>
        <p className="mt-2 text-sm text-muted">Safe to do twice: anything already moved is skipped. The phone app keeps its own copy.</p>
      </Card>

      <SectionTitle>Where are the records?</SectionTitle>
      <Chips<Source> columns={here ? 3 : 2} value={source} onChange={pick} options={[
        ...(here ? [{ value: 'here' as Source, label: <span className="flex flex-col items-center gap-1"><Smartphone className="h-6 w-6" aria-hidden />On this phone</span> }] : []),
        { value: 'file', label: <span className="flex flex-col items-center gap-1"><FileUp className="h-6 w-6" aria-hidden />Backup file</span> },
        { value: 'paste', label: <span className="flex flex-col items-center gap-1"><ClipboardPaste className="h-6 w-6" aria-hidden />Paste it</span> }
      ]} />
      {source === 'here' && here && <p className="px-1 text-sm text-muted">Found the phone app's records in this browser.</p>}
      {source === 'file' && (
        <Card>
          <p className="text-sm">In the phone app: Settings, then Kept on this phone, then <b>Back up</b>. Then pick that file here.</p>
          <Button variant="secondary" block className="mt-3" onClick={() => file.current?.click()}><FileUp className="h-6 w-6" aria-hidden />Pick the backup file</Button>
          <input ref={file} type="file" accept=".zip,application/zip,application/json,.json" className="sr-only" aria-label="Backup file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const un = unpackBackup(new Uint8Array(await f.arrayBuffer()));
                read(un.json, new Map(un.files.map((x) => [x.path, new Blob([x.data as BlobPart], { type: x.type })])));
              } catch (err) { setBackup(null); setError((err as Error).message); }
            }} />
        </Card>
      )}
      {source === 'paste' && (
        <Card className="space-y-2">
          <label htmlFor="paste-backup" className="block font-bold">Paste the backup text</label>
          <textarea id="paste-backup" className="input h-32 w-full font-mono text-xs" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <Button variant="secondary" block disabled={!pasted.trim()} onClick={() => read(pasted)}>Use this backup</Button>
        </Card>
      )}
      {error && <p className="px-1 font-bold text-danger" role="alert">{error}</p>}

      {backup && phoneFarms.length > 1 && (
        <Chips label="Which phone farm?" columns={2} value={chosenPhoneFarm} onChange={setPhoneFarmId} options={phoneFarms.map((f) => ({ value: f.id, label: f.name }))} />
      )}

      {backup && plan && (
        <>
          <SectionTitle>What will be moved</SectionTitle>
          <Card>
            <p className="font-bold">{plan.phoneFarmName}: {plan.total} record{plan.total === 1 ? '' : 's'}</p>
            <ul className="mt-2 space-y-1 text-[0.95rem]">
              {IMPORT_ORDER.filter((t) => plan.counts[t]).map((t) => <li key={t}>{plan.counts[t]} {TABLE_LABEL[t]}</li>)}
            </ul>
            <p className="mt-2 text-sm text-muted">Your bank balance, financial year and feed settings come from the phone too. The supplier directory is already online.</p>
          </Card>

          <SectionTitle>Into which farm?</SectionTitle>
          <Chips columns={2} value={target} onChange={setTarget} options={[
            ...ownedFarms.map((f) => ({ value: f.id, label: f.name })),
            { value: 'new', label: `New farm: ${plan.phoneFarmName}` }
          ]} />
          <Button variant="hivis" block disabled={busy} onClick={move}>{busy ? 'Moving…' : `Move ${plan.total} record${plan.total === 1 ? '' : 's'}`}</Button>
        </>
      )}
    </Screen>
  );
}
