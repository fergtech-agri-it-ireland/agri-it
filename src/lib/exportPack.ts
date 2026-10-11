/**
 * Accountant and inspection exports (review gap P1): CSV files plus the photos and
 * invoices they point to, in one zip. Built on the phone; nothing is sent anywhere.
 */
import { zipSync, strToU8 } from 'fflate';
import { documentUrl } from './upload';
import { attachmentName } from './vault';
import type { DocumentRow } from './types';

export interface PackFile { name: string; text: string }

/** Zip the CSVs and every attachment that can be fetched. Missing ones are listed in a note. */
export async function buildZip(files: PackFile[], docs: DocumentRow[]): Promise<{ blob: Blob; attached: number; missing: string[] }> {
  const entries: Record<string, Uint8Array> = {};
  // A byte-order mark so spreadsheet programs open the euro sign properly
  for (const f of files) entries[f.name] = strToU8(`﻿${f.text}`);
  const missing: string[] = [];
  let attached = 0;
  for (const d of docs) {
    const name = `attachments/${attachmentName(d.id, d.file_name)}`;
    try {
      const url = d.storage_path ? await documentUrl(d.storage_path) : null;
      if (!url) throw new Error('not on this phone');
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      entries[name] = new Uint8Array(await res.arrayBuffer());
      attached++;
    } catch {
      missing.push(name);
    }
  }
  if (missing.length) entries['attachments/MISSING.txt'] = strToU8(`These attachments could not be added (not on this phone, or no signal):\n${missing.join('\n')}\n`);
  const zipped = zipSync(entries, { level: 6 });
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), attached, missing };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
