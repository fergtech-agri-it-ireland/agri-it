/**
 * Hand-off for "Photo a docket": the Record screen takes the photo first, then the
 * farmer says what it is, and that form opens with the photo already attached.
 */
let pending: File | null = null;

export function setPendingPhoto(f: File | null) {
  pending = f;
}
/** Read without clearing (safe to call from a state initialiser that may run twice). */
export function peekPendingPhoto(): File | null {
  return pending;
}
export function clearPendingPhoto() {
  pending = null;
}
