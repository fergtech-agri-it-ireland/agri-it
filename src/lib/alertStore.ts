/**
 * Browser side of alerts.ts: the farmer's "Not now" choices and the pilot's alert counts,
 * kept on this phone only (localStorage), per farm. Nothing here is a farm record.
 */
import { key } from './env';
import type { ISODate } from './types';
import {
  parseSnoozes, parseStats, recordAction, recordShown, snooze, emptyStats,
  type AlertAction, type AlertStats, type SnoozeMap, type SnoozeReason
} from './alerts';

const snoozeKey = (farmId: string) => key(`hidden:${farmId}`);
const statsKey = (farmId: string) => key(`alert-stats:${farmId}`);

function read(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function write(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* storage full or blocked: counts are best effort */ }
}

export const loadSnoozes = (farmId: string): SnoozeMap => parseSnoozes(read(snoozeKey(farmId)));

export function saveSnooze(farmId: string, ids: string[], days: number, reason: SnoozeReason, today: ISODate): SnoozeMap {
  const next = snooze(loadSnoozes(farmId), ids, days, reason, today);
  write(snoozeKey(farmId), JSON.stringify(next));
  for (const id of ids) noteAction(farmId, id, { kind: 'put_off', reason }, today);
  return next;
}

export const loadStats = (farmId: string, today: ISODate): AlertStats => parseStats(read(statsKey(farmId)), today);

export function noteShown(farmId: string, ids: string[], today: ISODate) {
  const before = read(statsKey(farmId));
  const next = JSON.stringify(recordShown(parseStats(before, today), ids, today));
  if (next !== before) write(statsKey(farmId), next);
}

export function noteAction(farmId: string, id: string, a: AlertAction, today: ISODate) {
  write(statsKey(farmId), JSON.stringify(recordAction(loadStats(farmId, today), id, a, today)));
}

export function resetStats(farmId: string, today: ISODate) {
  write(statsKey(farmId), JSON.stringify(emptyStats(today)));
}
