import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, PencilLine, ScanText } from 'lucide-react';
import type { DocketRead, Read, ReadConfidence } from '../lib/docket/extract';
import { kindLabel } from '../lib/docket/extract';
import { eur, fmtDay, fmtKg } from '../lib/format';
import { Button, Card, Sheet, ToneIcon } from './ui';

const SURE: Record<ReadConfidence, string> = { high: 'sure', medium: 'fairly sure', low: 'not sure' };

/** Under a field: where its value came from. Icon and words, never colour alone. */
export function ReadTag({ field, read, edited }: { field: string; read?: Read<unknown>; edited?: boolean }) {
  if (!read) return null;
  if (edited) {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-[0.95rem] text-muted" data-read-tag={field} data-read-state="changed">
        <PencilLine className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />You changed what was read from the photo.
      </p>
    );
  }
  const usable = read.confidence !== 'low';
  return (
    <p className={`mt-1.5 flex items-start gap-1.5 rounded-lg px-2 py-1 text-[0.95rem] ${usable ? 'bg-field-light' : 'bg-hivis/30'}`} data-read-tag={field} data-read-state={read.confidence}>
      <ScanText className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <span>
        <b>{usable ? 'Read from photo' : 'Not filled in'}, {SURE[read.confidence]}.</b>{' '}
        {read.note && <>{read.note}. </>}
        <span className="text-muted">From &ldquo;{read.from.length > 60 ? `${read.from.slice(0, 57)}...` : read.from}&rdquo;</span>
      </span>
    </p>
  );
}

/** Under a field the photo should have had but didn't: say so, never fill a guess. */
export function NotReadTag({ field, what }: { field: string; what: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[0.95rem] text-muted" data-read-tag={field} data-read-state="missing">
      <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Couldn&apos;t read {what} from the photo. Fill it in yourself.
    </p>
  );
}

export function usePhotoUrl(photo: Blob | null): string | null {
  const url = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

export type SuggestionUse = (field: DocketRead['suggestions'][number]['field'], value: number | string) => void;

/** Top of the form: what was read, the document's own sums, what's missing. */
export function ReadSummary({ read, photo, onUse }: { read: DocketRead; photo: Blob | null; onUse: SuggestionUse }) {
  const url = usePhotoUrl(photo);
  const [big, setBig] = useState(false);
  const [used, setUsed] = useState<string[]>([]);
  const shown = (s: DocketRead['suggestions'][number]) =>
    s.field === 'quantity' ? fmtKg(Number(s.value)) : s.field === 'date' ? fmtDay(String(s.value)) : eur(Number(s.value), true);
  return (
    <Card>
      <div className="space-y-3" data-testid="read-summary">
      <div className="flex gap-3">
        {url && (
          <button type="button" onClick={() => setBig(true)} className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-line" aria-label="See the photo">
            <img src={url} alt="" className="h-full w-full object-cover" />
          </button>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.95rem] font-bold text-accent"><ScanText className="h-5 w-5" aria-hidden />Read from photo</p>
          <p className="text-xl font-bold leading-tight" data-testid="read-kind">{kindLabel(read)}</p>
          <p className="text-[0.95rem] text-muted">{read.reader}. Text {read.pageConfidence >= 85 ? 'clear' : read.pageConfidence >= 65 ? 'mostly clear' : 'hard to read'}.</p>
        </div>
      </div>

      {read.checks.map((c) => (
        <p key={c.text} className="flex items-start gap-2 text-[0.95rem]" data-testid={c.ok ? 'read-check-ok' : 'read-check-bad'}>
          <ToneIcon tone={c.ok ? 'ok' : 'warn'} className="mt-0.5 h-5 w-5 shrink-0" />{c.text}
        </p>
      ))}

      {read.suggestions.filter((s) => !used.includes(s.field)).map((s) => (
        <div key={s.field + s.text} className="flex items-center gap-2 rounded-xl bg-hivis/30 p-2" data-testid="read-suggestion">
          <HelpCircle className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 text-[0.95rem]">{s.text}. Not filled in.</span>
          <Button variant="secondary" className="shrink-0" onClick={() => { onUse(s.field, s.value); setUsed((u) => [...u, s.field]); }}>Use {shown(s)}</Button>
        </div>
      ))}

      {read.missing.length > 0 && (
        <p className="flex items-start gap-2 text-[0.95rem]" data-testid="read-missing">
          <ToneIcon tone="info" className="mt-0.5 h-5 w-5 shrink-0" />Couldn&apos;t read: {read.missing.join(', ')}. Fill {read.missing.length > 1 ? 'these' : 'this'} in yourself.
        </p>
      )}
      <p className="rounded-xl bg-pasture px-3 py-2 font-bold">Check each value against the paper, then save. Nothing is recorded until you tap Save.</p>

      </div>
      <Sheet open={big} onClose={() => setBig(false)} title="The photo">
        {url && <img src={url} alt="The docket photo" className="w-full rounded-xl" />}
      </Sheet>
    </Card>
  );
}
