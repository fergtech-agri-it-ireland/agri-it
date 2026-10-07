import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { backupJson, browserKeepsData, localSummary, resetDemo, restoreBackup } from '../lib/demo/client';
import { todayISO } from '../lib/format';
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
  const sum = localSummary();

  const download = async () => {
    if (IN_FRAME) {
      // Downloads are blocked in a shared page: copy the backup instead, or show it to select
      const text = backupJson();
      try {
        await navigator.clipboard.writeText(text);
        setShown(null);
        setMsg('Backup copied. Paste it into an email to yourself or a note, and keep it.');
      } catch {
        setShown(text);
        setMsg('Select all the text below, copy it, and paste it into an email to yourself.');
      }
      return;
    }
    const blob = new Blob([backupJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agri-it-${farmName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setMsg('Backup saved to your downloads. Keep it somewhere safe, like email to yourself or Google Drive.');
  };
  const restore = async (f: File | null) => {
    if (!f) return;
    try { restoreBackup(await f.text()); } catch (e) { setMsg((e as Error).message); }
  };
  const restoreText = () => {
    try { restoreBackup(pasted.trim()); } catch (e) { setMsg(e instanceof SyntaxError ? 'That text is not a complete Agri-It backup. Copy all of it and try again.' : (e as Error).message); }
  };

  return (
    <>
      <SectionTitle>Kept on this phone</SectionTitle>
      <Card>
        <p className="text-base">Your records are kept on this phone only. Nothing is sent anywhere. {sum.records} records saved{sum.photos ? `, ${sum.photos} photos` : ''}.</p>
        {!browserKeepsData && <p className="mt-2 font-bold text-danger">This browser is not keeping your records (private mode or storage blocked). Open Agri-It in a normal browser tab.</p>}
        <p className="mt-2 text-sm text-muted">Add Agri-It to your home screen so the phone keeps your records. Clearing your browser data deletes them. Take a backup now and then: it holds your records, not photos.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={download}><Download className="h-5 w-5" />Back up</Button>
          <Button variant="secondary" onClick={() => (IN_FRAME ? setPasting(!pasting) : file.current?.click())}><Upload className="h-5 w-5" />Restore</Button>
        </div>
        {shown && <textarea id="backup-text" readOnly className="input mt-3 h-32 w-full font-mono text-xs" value={shown} onFocus={(e) => e.currentTarget.select()} />}
        {pasting && (
          <div className="mt-3 space-y-2">
            <label htmlFor="restore-text" className="block font-bold">Paste your backup</label>
            <textarea id="restore-text" className="input h-32 w-full font-mono text-xs" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <p className="text-sm text-muted">This replaces everything on this phone with the backup.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => file.current?.click()}>Pick a file</Button>
              <Button variant="primary" disabled={!pasted.trim()} onClick={restoreText}>Restore</Button>
            </div>
          </div>
        )}
        <input ref={file} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => restore(e.target.files?.[0] ?? null)} />
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
