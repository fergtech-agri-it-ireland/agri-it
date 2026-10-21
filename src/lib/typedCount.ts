/**
 * Typing into a count box (head, kg, days).
 *
 * The old boxes turned an empty box straight back into 0, so the 0 could never be deleted and
 * a new number had to be typed in front of or behind it. A box now holds exactly what was typed
 * while it is being edited, and the number behind it is put back on screen when the farmer
 * leaves the box or taps - or +.
 */

/** What the number should be for what was typed: an empty box counts as 0, rubbish is ignored (null). */
export function countFromText(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** What the box shows: what was typed while editing, otherwise the number. */
export function countShown(value: number, typed: string | null): string {
  if (typed !== null) return typed;
  return Number.isFinite(value) ? String(value) : '';
}
