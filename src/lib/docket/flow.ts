/**
 * Glue between the photo, the reader, the rules and the forms. Browser only.
 */
import type { FarmBundle } from '../types';
import { todayISO } from '../format';
import { IN_BROWSER, IS_DEMO } from '../env';
import { supabase } from '../supabase';
import { uploadDocument } from '../upload';
import { outboxItems } from '../offline/outbox';
import { readDocket, type DocketRead, type MatchContext, type OcrLine } from './extract';
import { preparePhoto, shrinkForStorage } from './prepare';
import { currentReader, ReaderUnavailable, type ReadProgress } from './reader';
import { dropToUpload, keepToUpload, listToRead, listToUpload, updateToRead, type ToRead, type ToUpload } from './photoStore';
import { SAMPLE_TEXT } from '../demo/samples/sampleText';

export { ReaderUnavailable };

export class NotReadable extends Error {}

const SAVED_SAMPLE_READER = 'Saved reading of this sample (live reading is blocked in this page)';
let demoReaderBlocked = false;

export function matchContext(b: FarmBundle): MatchContext {
  return {
    today: todayISO(),
    suppliers: b.suppliers.map((s) => ({ id: s.id, name: s.name, network: s.network })),
    products: b.products.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, supplier_id: p.supplier_id })),
    payees: [...new Set(b.costs.map((c) => c.supplier_name).filter(Boolean) as string[])]
  };
}

/** Photo in, text lines out. Throws ReaderUnavailable (try later) or NotReadable (not a photo). */
export async function readLines(file: Blob & { name?: string }, onProgress?: (p: ReadProgress) => void): Promise<{ lines: OcrLine[]; reader: string }> {
  if (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) throw new NotReadable('Agri-It can\'t read PDFs yet.');
  if (file.type && !file.type.startsWith('image/')) throw new NotReadable('That file is not a photo.');
  onProgress?.({ step: 'cleaning', progress: 0 });
  let image: HTMLCanvasElement;
  try {
    image = await preparePhoto(file);
  } catch {
    throw new NotReadable('That photo could not be opened.');
  }
  const reader = currentReader();
  const sample = IS_DEMO && file.name ? SAMPLE_TEXT[file.name] : undefined;
  // Once the demo page has blocked the reader, don't make the farmer wait for it again
  if (sample && demoReaderBlocked) return { lines: sample, reader: SAVED_SAMPLE_READER };
  try {
    const lines = await reader.read(image, onProgress);
    // Browser tests look at what the reader saw (demo build only)
    if (IS_DEMO) (window as unknown as { __docketDebug?: unknown }).__docketDebug = { lines, prepared: () => image.toDataURL('image/png') };
    return { lines, reader: reader.label };
  } catch (e) {
    // The demo page may block the reader's files. Its sample photos come with the
    // reader's own output, saved when the samples were made, so the flow still works.
    if (e instanceof ReaderUnavailable && IS_DEMO) demoReaderBlocked = true;
    if (sample) return { lines: sample, reader: SAVED_SAMPLE_READER };
    throw e instanceof ReaderUnavailable ? e : new ReaderUnavailable((e as Error)?.message ?? 'Reading failed.');
  }
}

export function interpret(lines: OcrLine[], reader: string, b: FarmBundle): DocketRead {
  return readDocket(lines, matchContext(b), reader);
}

/** Read photos that were kept for later. Safe to call often; does nothing offline or if none wait. */
let reading = false;
export async function readWaiting(farmId: string): Promise<number> {
  if (reading) return 0;
  reading = true;
  let done = 0;
  try {
    for (const p of await listToRead(farmId)) {
      if (p.status !== 'waiting') continue;
      try {
        const file = p.blob instanceof File ? p.blob : new File([p.blob], p.name, { type: p.blob.type || 'image/jpeg' });
        const { lines, reader } = await readLines(file);
        await updateToRead({ ...p, status: 'read', lines, reader });
        done++;
      } catch (e) {
        if (e instanceof ReaderUnavailable) break; // still no reader: try again later
        await updateToRead({ ...p, status: 'failed', error: (e as Error).message } satisfies ToRead);
      }
    }
  } finally {
    reading = false;
  }
  return done;
}

/** Upload evidence photos for records saved offline, once those records have synced. */
let uploading = false;
export async function flushPhotoUploads(): Promise<number> {
  if (uploading || IN_BROWSER || !navigator.onLine || outboxItems().length > 0) return 0;
  uploading = true;
  let sent = 0;
  try {
    for (const u of await listToUpload()) {
      try {
        const file = new File([u.blob], u.name, { type: u.blob.type || 'image/jpeg' });
        const docId = await uploadDocument(file, u.farmId, u.recordType, u.confirmed, u.extracted);
        const { error } = await supabase.from(u.link.table).update({ document_id: docId }).eq('id', u.link.id);
        if (error) throw new Error(error.message);
        await dropToUpload(u.id);
        sent++;
      } catch {
        break; // keep it; try on the next reconnect
      }
    }
  } finally {
    uploading = false;
  }
  return sent;
}

/** A note that is only a document reference ("Receipt 20871. VAT ..."), not worth repeating. */
export const isReferenceNote = (s: string | null | undefined) => !!s && /^(receipt|invoice|docket) \S+(\. vat .*)?$/i.test(s.trim());

/** What gets stored with the document: what was read, how sure, and what the farmer changed. */
export function extractedRecord(read: DocketRead, changed: string[]) {
  const pick = <T,>(r: { value: T; confidence: string; from: string } | undefined) => (r ? { value: r.value, confidence: r.confidence, from: r.from } : null);
  return {
    rule: read.rule, reader: read.reader, read_at: new Date().toISOString(), kind: read.kind, is_feed: read.isFeed, page_confidence: read.pageConfidence,
    fields: {
      supplier: pick(read.supplier), date: pick(read.date), product: pick(read.product), quantity: pick(read.quantity),
      price_per_tonne: pick(read.pricePerTonne), total: pick(read.total), net: pick(read.net), vat: pick(read.vat),
      doc_number: pick(read.docNumber), cost_category: pick(read.costCategory)
    },
    checks: read.checks,
    changed_by_farmer: changed
  };
}

/**
 * Keep the photo as the record's evidence. Uploads now when there's signal and returns
 * the document id; otherwise returns null and `later()` queues it, to be linked to the
 * record once that has synced.
 */
export async function keepEvidence(photo: File, farmId: string, recordType: 'feed_docket' | 'invoice', confirmed: boolean, extracted: unknown) {
  const blob = photo.type.startsWith('image/') ? await shrinkForStorage(photo).catch(() => photo) : photo;
  const file = blob === photo ? photo : new File([blob], photo.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  let documentId: string | null = null;
  if (IN_BROWSER || navigator.onLine) {
    try { documentId = await uploadDocument(file, farmId, recordType, confirmed, extracted); } catch { documentId = null; }
  }
  return {
    documentId,
    later: async (link: ToUpload['link']) => {
      if (documentId || IN_BROWSER) return false;
      await keepToUpload({ id: crypto.randomUUID(), farmId, blob: file, name: file.name, recordType, confirmed, extracted, link, addedAt: new Date().toISOString() });
      return true;
    }
  };
}
