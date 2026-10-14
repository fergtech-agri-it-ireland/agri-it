/**
 * Full phone backup (advisory review G01, gate G4): one zip file that holds every record
 * AND every photo, invoice and docket kept on the phone, so a farm can be rebuilt on a
 * different phone with nothing left behind.
 *
 * Layout of the zip:
 *   agri-it-backup.json        { app: 'agri-it', kind: 'phone-backup', v, saved_at, db, files: [...] }
 *   files/0001.<ext>           the file bytes, in the order listed in `files`
 *
 * `files` lists { path, type, entry } for each photo: `path` is the storage path the
 * records point at (documents.storage_path), `entry` is the zip entry holding its bytes.
 * Paths are kept in the JSON, not used as zip names, so any character in a path is safe.
 *
 * Older backups were the JSON on its own (records only). Both are still accepted.
 * Pure: no browser storage here, so it is unit tested directly.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const BACKUP_ENTRY = 'agri-it-backup.json';

export interface BackupFile { path: string; type: string; data: Uint8Array }
export interface FileIndexEntry { path: string; type: string; entry: string; bytes: number }
export interface UnpackedBackup {
  /** The backup JSON as text (same shape as the older records-only backup, plus `files`). */
  json: string;
  files: BackupFile[];
  /** True when this was a full backup (zip); false for an older records-only file. */
  full: boolean;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf'
};
function extFor(path: string, type: string): string {
  if (EXT[type]) return EXT[type];
  const m = /\.([a-z0-9]{1,5})$/i.exec(path);
  return m ? m[1].toLowerCase() : 'bin';
}

/** Build the zip: records JSON plus every file. Photos are already compressed, so they are stored as they are. */
export function packBackup(backupJson: string, files: BackupFile[]): Uint8Array {
  const parsed = JSON.parse(backupJson) as Record<string, unknown>;
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const index: FileIndexEntry[] = files.map((f, i) => {
    const entry = `files/${String(i + 1).padStart(4, '0')}.${extFor(f.path, f.type)}`;
    entries[entry] = [f.data, { level: 0 }];
    return { path: f.path, type: f.type, entry, bytes: f.data.byteLength };
  });
  entries[BACKUP_ENTRY] = strToU8(JSON.stringify({ ...parsed, files: index }));
  return zipSync(entries, { level: 6 });
}

/** True for a zip file (starts PK\x03\x04). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Read a full (zip) or older (JSON) backup. Throws a plain-English error for anything else. */
export function unpackBackup(bytes: Uint8Array): UnpackedBackup {
  if (!isZip(bytes)) {
    const json = strFromU8(bytes).replace(/^﻿/, '');
    return { json, files: [], full: false };
  }
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { throw new Error('That backup file is damaged and could not be opened.'); }
  const raw = entries[BACKUP_ENTRY];
  if (!raw) throw new Error('That file is not an Agri-It backup.');
  const json = strFromU8(raw);
  let index: FileIndexEntry[] = [];
  try { index = ((JSON.parse(json) as { files?: FileIndexEntry[] }).files ?? []); } catch { throw new Error('That backup file is damaged and could not be opened.'); }
  const files: BackupFile[] = [];
  for (const f of index) {
    const data = entries[f.entry];
    // A file that should be there but is not, or came out the wrong size, means the zip is damaged
    if (!data || data.byteLength !== f.bytes) throw new Error('That backup file is damaged: some photos are missing from it.');
    files.push({ path: f.path, type: f.type, data });
  }
  return { json, files, full: true };
}

interface DocLike { id?: unknown; storage_path?: unknown; file_name?: unknown }

/**
 * What a backup holds against what the records point at. `missing` lists photos the records
 * mention that are not in the backup (for example a photo that never finished saving).
 */
export function backupCompleteness(db: { documents?: DocLike[] }, filePaths: string[]): { photos: number; missing: string[] } {
  const have = new Set(filePaths);
  const wanted = (db.documents ?? []).map((d) => String(d.storage_path ?? '')).filter(Boolean);
  const missing = [...new Set(wanted.filter((p) => !have.has(p)))];
  return { photos: wanted.length - missing.length, missing };
}

/** One line for the farmer about what a backup holds. */
export function backupLine(records: number, photos: number, missing: number): string {
  const r = `${records} record${records === 1 ? '' : 's'}`;
  const p = `${photos} photo${photos === 1 ? '' : 's'}`;
  if (!missing) return `${r} and ${p}.`;
  return `${r} and ${p}. ${missing} photo${missing === 1 ? ' is' : 's are'} no longer on this phone and could not be included.`;
}

const LAST_KEY = 'agri-it:last-backup';
/** When this phone last saved a full backup (ISO date), or null. */
export function lastBackupOn(): string | null {
  try { return window.localStorage.getItem(LAST_KEY); } catch { return null; }
}
export function markBackedUp(day: string) {
  try { window.localStorage.setItem(LAST_KEY, day); } catch { /* ignore */ }
}
/**
 * Should Today ask for a backup? Once a farm has a handful of records, if there has never
 * been a full backup, or the last one is more than 30 days old.
 */
export function backupDue(records: number, last: string | null, today: string): boolean {
  if (records < 10) return false;
  if (!last) return true;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000;
  return days > 30;
}
