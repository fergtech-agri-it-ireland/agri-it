/**
 * Hand-off for "Photo a docket": the Record screen takes (and reads) the photo, then
 * the form opens with the photo attached and, if it was read, the values prefilled.
 */
import type { DocketRead } from './docket/extract';

let pending: File | null = null;
let pendingRead: DocketRead | null = null;
let pendingQueueId: string | null = null;

/** `queueId` is set when the photo came from the read-later queue, so saving clears it. */
export function setPendingPhoto(f: File | null, read: DocketRead | null = null, queueId: string | null = null) {
  pending = f;
  pendingRead = f ? read : null;
  pendingQueueId = f ? queueId : null;
}
/** Read without clearing (safe to call from a state initialiser that may run twice). */
export function peekPendingPhoto(): File | null {
  return pending;
}
export function peekPendingRead(): DocketRead | null {
  return pendingRead;
}
export function peekPendingQueueId(): string | null {
  return pendingQueueId;
}
export function clearPendingPhoto() {
  pending = null;
  pendingRead = null;
  pendingQueueId = null;
}
