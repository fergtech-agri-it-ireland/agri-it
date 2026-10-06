/**
 * Photos kept on the phone until they can be dealt with. Two queues:
 *
 * - toRead: photos taken when the reader could not start (no signal before its files
 *   were cached). They are read when signal returns; the farmer then checks and saves.
 *   Nothing is recorded from them until the farmer taps Save.
 * - toUpload: evidence photos for records saved offline. Uploaded and linked to the
 *   record (document_id) once the record itself has synced.
 *
 * IndexedDB, because photos are too big for localStorage. If the browser blocks it
 * (private mode, some embedded pages) the queues live in memory for this visit.
 */
import type { OcrLine } from './extract';

export interface ToRead {
  id: string;
  farmId: string;
  blob: Blob;
  name: string;
  addedAt: string;
  status: 'waiting' | 'read' | 'failed';
  lines?: OcrLine[];
  reader?: string;
  error?: string;
}

export interface ToUpload {
  id: string;
  farmId: string;
  blob: Blob;
  name: string;
  recordType: 'feed_docket' | 'invoice';
  confirmed: boolean;
  extracted: unknown;
  link: { table: 'feed_transactions' | 'costs'; id: string };
  addedAt: string;
}

const DB = 'agri-it-photos';
type StoreName = 'toRead' | 'toUpload';
const memory: Record<StoreName, Map<string, unknown>> = { toRead: new Map(), toUpload: new Map() };
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('toRead', { keyPath: 'id' });
          req.result.createObjectStore('toUpload', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

const listeners = new Set<() => void>();
export function subscribePhotos(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function changed() {
  listeners.forEach((l) => l());
}

async function put<T extends { id: string }>(store: StoreName, item: T) {
  try {
    if ((await tx(store, 'readwrite', (s) => s.put(item))) === undefined) memory[store].set(item.id, item);
  } catch {
    memory[store].set(item.id, item);
  }
  changed();
}
async function all<T>(store: StoreName): Promise<T[]> {
  let rows: T[] = [];
  try {
    rows = ((await tx(store, 'readonly', (s) => s.getAll())) as T[] | undefined) ?? [];
  } catch { /* fall through to memory */ }
  return [...rows, ...([...memory[store].values()] as T[])];
}
async function remove(store: StoreName, id: string) {
  memory[store].delete(id);
  try { await tx(store, 'readwrite', (s) => s.delete(id)); } catch { /* gone from memory at least */ }
  changed();
}

export const keepToRead = (p: ToRead) => put('toRead', p);
export const updateToRead = (p: ToRead) => put('toRead', p);
export const listToRead = async (farmId: string) => (await all<ToRead>('toRead')).filter((p) => p.farmId === farmId).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
export const dropToRead = (id: string) => remove('toRead', id);

export const keepToUpload = (p: ToUpload) => put('toUpload', p);
export const listToUpload = () => all<ToUpload>('toUpload');
export const dropToUpload = (id: string) => remove('toUpload', id);
