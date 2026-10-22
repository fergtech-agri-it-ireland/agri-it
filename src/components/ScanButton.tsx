import { ScanLine } from 'lucide-react';
import { IS_DEMO } from '../lib/env';

/**
 * Opens the camera (or, in the demo page, the photo picker) and hands the photo to `onFile`.
 * Used by the animal list and the animal form to scan the identity card.
 */
export function ScanButton({ onFile, label, variant = 'primary' }: { onFile: (f: File) => void; label: string; variant?: 'primary' | 'secondary' }) {
  return (
    <label className={`inline-flex min-h-tap w-full cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-base font-bold ${variant === 'primary' ? 'bg-field text-white active:bg-field-dark' : 'border-2 border-line bg-card text-ink active:bg-field-light'}`}>
      {/* The demo page can't use the camera, so it opens the file picker instead */}
      <input type="file" accept="image/*" {...(IS_DEMO ? {} : { capture: 'environment' as const })} className="sr-only" data-testid="card-input"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      <ScanLine className="h-5 w-5" aria-hidden />{label}
    </label>
  );
}
