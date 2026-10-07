/**
 * Where a docket photo gets read. One interface, two readers:
 *
 * - phoneReader: open-source OCR (Tesseract) running on the phone. Free, the photo
 *   never leaves the phone, works offline once its files (about 7 MB) are cached.
 *   This is the reader today.
 * - serverReader: a better reader behind a Supabase edge function, for once Agri-It
 *   is hosted. Not built yet. Its contract: POST the photo (JPEG) with the user's
 *   token, get back `{ reader: string, lines: { text, confidence }[] }`. It returns
 *   TEXT LINES, not field values, so the same tested rules in extract.ts decide every
 *   value whichever reader ran, and a value can never appear that is not on the page.
 *
 * Both return text lines; extract.ts turns lines into values.
 */
import type { OcrLine } from './extract';
import { IN_BROWSER } from '../env';

export interface ReadProgress { step: 'cleaning' | 'loading' | 'reading' | 'sorting'; progress: number }

export interface PhotoReader {
  id: string;
  /** Shown to the farmer under "Read with". */
  label: string;
  read(image: HTMLCanvasElement | Blob, onProgress?: (p: ReadProgress) => void): Promise<OcrLine[]>;
}

// Tesseract file locations. The app serves its own copies (scripts/copy-ocr-assets.mjs
// puts them in /ocr/ and the service worker caches them on first use). The one-file
// builds (demo, phone) cannot carry 7 MB, so they load the same versions from the public CDN.
const TESSERACT_VERSION = '7.0.0';
const CORE_VERSION = '7.0.0';
const DATA_VERSION = '1.0.0';
const PATHS = IN_BROWSER
  ? {
      workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`,
      corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VERSION}`,
      langPath: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@${DATA_VERSION}/4.0.0_best_int`,
      workerBlobURL: true
    }
  : { workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr', workerBlobURL: false };

type TWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerPromise: Promise<TWorker> | null = null;
let progressSink: ((p: ReadProgress) => void) | undefined;
/** Give up starting if nothing has happened for this long (a blocked or dead download). */
const IDLE_LIMIT_MS = 30_000;

function getWorker(): Promise<TWorker> {
  if (!workerPromise) {
    const attempt = (async () => {
      // Check the reader's files can be reached first: a blocked page or no signal fails
      // here in a moment, instead of the worker failing quietly in the background
      try {
        const res = await fetch(PATHS.workerPath, { cache: 'force-cache' });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        throw new ReaderUnavailable('Photo reading could not start.');
      }
      const { createWorker, OEM } = await import('tesseract.js');
      let lastActivity = Date.now();
      let fail: (e: Error) => void = () => {};
      const failed = new Promise<never>((_, reject) => { fail = reject; });
      const idle = setInterval(() => {
        if (Date.now() - lastActivity > IDLE_LIMIT_MS) fail(new ReaderUnavailable('Photo reading could not start.'));
      }, 1000);
      const created = createWorker('eng', OEM.LSTM_ONLY, {
        ...PATHS,
        gzip: true,
        errorHandler: (e: unknown) => fail(new ReaderUnavailable(String(e))),
        logger: (m) => {
          lastActivity = Date.now();
          if (!progressSink) return;
          if (m.status === 'recognizing text') progressSink({ step: 'reading', progress: m.progress });
          else progressSink({ step: 'loading', progress: m.progress });
        }
      });
      try {
        // Tesseract's defaults (automatic page layout) read yard photos best; forcing a DPI
        // or page mode lost whole pages in testing.
        return await Promise.race([created, failed]);
      } catch (e) {
        created.then((w) => w.terminate()).catch(() => {});
        throw e instanceof ReaderUnavailable ? e : new ReaderUnavailable((e as Error)?.message ?? String(e));
      } finally {
        clearInterval(idle);
      }
    })();
    workerPromise = attempt;
    attempt.catch(() => { if (workerPromise === attempt) workerPromise = null; });
  }
  return workerPromise;
}

/** The reader could not start (files not cached and no signal, or blocked by the page). */
export class ReaderUnavailable extends Error {}

export const phoneReader: PhotoReader = {
  id: 'phone-tesseract-7',
  label: 'Read on this phone',
  async read(image, onProgress) {
    progressSink = onProgress;
    try {
      onProgress?.({ step: 'loading', progress: 0 });
      const worker = await getWorker();
      const r = await worker.recognize(image, { rotateAuto: true }, { blocks: true, text: false });
      const lines: OcrLine[] = [];
      for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
        const text = l.text.replace(/\s+/g, ' ').trim();
        if (text) lines.push({ text, confidence: Math.round(l.confidence) });
      }
      return lines;
    } finally {
      progressSink = undefined;
    }
  }
};

/** Start the reader early (on the Record screen, with signal) so its files are cached for the yard. */
export function warmReader(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  getWorker().catch(() => { /* tried; the real read will explain */ });
}

/** The reader to use right now. The server reader slots in here once it exists. */
export function currentReader(): PhotoReader {
  return phoneReader;
}
