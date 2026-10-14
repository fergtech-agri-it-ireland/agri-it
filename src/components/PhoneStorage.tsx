import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, Upload } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { backupJson, browserKeepsData, fullBackup, localSummary, resetDemo, restoreBackup, restoreFile } from '../lib/demo/client';
import { backupDue, backupLine, lastBackupOn, markBackedUp } from '../lib/phoneBackup';
import { fmtDate, todayISO } from '../lib/format';
import { IN_FRAME } from '../lib/env';
import { Button, Card, SectionTitle } from './ui';

/**
 * Phone-only build: the farm lives in this phone's browser and nowhere else.
 * Say so plainly, and give the farmer a way to keep a copy and move phones.
 */
export function PhoneStorageCard({ farmName }: { farmName: string }) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(lastBackupOn);
  const sum = localSummary();
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash === '#kept-on-this-phone') document.getElementById('kept-on-this-phone')?.scrollIntoView({ block: 'start' });
  }, [loc.hash]);

  const download = async () => {
    if (IN_FRAME) {
      // Downloads are blocked in a shared page: copy the backup instead, or show it to select
      const text = backupJson();
      try {
        await navigator.clipboard.writeText(text);
        setShown(null);
        setMsg('Records copied (not photos: a shared link cannot save files). Paste them into an email to yourself. For a full backup with photos, use the app added to your home screen.');
      } catch {
        setShown(text);
        setMsg('Select all the text below, copy it, and paste it into an email to yourself.');
      }
      return;
    }
    setBusy(true);
    try {
      const b = await fullBackup();
      const blob = new Blob([b.bytes as BlobPart], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `agri-it-${farmName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${todayISO()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      markBackedUp(todayISO());
      setLast(todayISO());
      setMsg(`Backup saved to your downloads: ${backupLine(b.records, b.photos, b.missing.length)} Keep it somewhere off this phone, like email to yourself or Google Drive.`);
    } catch {
      setMsg('The backup could not be made. Try again, or free up space on the phone.');
    } finally {
      setBusy(false);
    }
  };
  const restore = async (f: File | null) => {
    if (!f) return;
    setBusy(true);
    try { await restoreFile(new Uint8Array(await f.arrayBuffer())); } catch (e) { setMsg((e as Error).message); setBusy(false); }
  };
  const restoreText = () => {
    try { restoreBackup(pasted.trim()); } catch (e) { setMsg(e instanceof SyntaxError ? 'That text is not a complete Agri-It backup. Copy all of it and try again.' : (e as Error).message); }
  };

  return (
    <>
      <div id="kept-on-this-phone"><SectionTitle>Kept on this phone</SectionTitle></div>
      <Card>
        <p className="text-base">Your records are kept on this phone only. Nothing is sent anywhere. {sum.records} records saved{sum.photos ? `, ${sum.photos} photos` : ''}.</p>
        {!browserKeepsData && <p className="mt-2 font-bold text-danger">This browser is not keeping your records (private mode or storage blocked). Open Agri-It in a normal browser tab.</p>}
        <p className="mt-2 text-sm text-muted">Add Agri-It to your home screen so the phone keeps your records. Clearing your browser data, or losing the phone, deletes them. {IN_FRAME ? 'In this shared link a backup holds your records, not photos.' : 'A backup holds every record and every photo, invoice and docket, and restores on another phone.'}</p>
        <p className="mt-2 text-sm font-bold">{last ? `Last full backup: ${fmtDate(last)}` : 'No full backup taken on this phone yet.'}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="primary" disabled={busy} onClick={download}><Download className="h-5 w-5" />{busy ? 'Working…' : 'Back up'}</Button>
          <Button variant="secondary" onClick={() => (IN_FRAME ? setPasting(!pasting) : file.current?.click())}><Upload className="h-5 w-5" />Restore</Button>
        </div>
        {shown && <textarea id="backup-text" readOnly className="input mt-3 h-32 w-full font-mono text-xs" value={shown} onFocus={(e) => e.currentTarget.select()} />}
        {pasting && (
          <div className="mt-3 space-y-2">
            <label htmlFor="restore-text" className="block font-bold">Paste your backup</label>
            <textarea id="restore-text" className="input h-32 w-full font-mono text-xs" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <p className="text-sm text-muted">This replaces every record on this phone with the backup.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => file.current?.click()}>Pick a file</Button>
              <Button variant="primary" disabled={!pasted.trim()} onClick={restoreText}>Restore</Button>
            </div>
          </div>
        )}
        <input ref={file} type="file" accept=".zip,application/zip,application/json,.json" className="sr-only" onChange={(e) => restore(e.target.files?.[0] ?? null)} />
        {msg && <p className="mt-2 text-sm font-bold">{msg}</p>}
        {confirmWipe ? (
          <div className="mt-3 rounded-xl border-2 border-danger p-3">
            <p className="font-bold">Delete every record and photo on this phone? This can't be undone.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmWipe(false)}>Keep them</Button>
              <Button variant="danger" onClick={resetDemo}>Delete all</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" block className="mt-2" onClick={() => setConfirmWipe(true)}>Delete everything and start again</Button>
        )}
      </Card>
    </>
  );
}

/**
 * Today, phone build: the farm lives on one phone, so ask for a full backup once there is
 * something worth keeping and none has been taken in the last 30 days (review G01).
 */
export function BackupNudge() {
  const records = localSummary().records;
  if (!backupDue(records, lastBackupOn(), todayISO())) return null;
  const last = lastBackupOn();
  return (
    <Link to="/settings#kept-on-this-phone" className="flex items-center gap-3 rounded-[1.125rem] border-2 border-hivis bg-card p-4 shadow-lift">
      <Download className="h-6 w-6 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-bold">Back up your farm</span>
        <span className="block text-sm text-muted">{last ? `Last backup ${fmtDate(last)}.` : 'No backup yet.'} Your {records} records and photos are only on this phone.</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
