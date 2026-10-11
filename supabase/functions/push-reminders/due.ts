/**
 * Which reminder, if any, a push subscription should get right now.
 *
 * Pure (no Deno or browser APIs): used by the edge function and unit tested from
 * src/lib/pushDue.test.ts. Same rules as the phone's own clock (src/lib/reminders.ts
 * slotDue): a slot is due from its time for up to three hours, once a day, and the words
 * are exactly the message the app put in its digest for that day. If the digest has no
 * message for today (nothing to tick off, or the app hasn't been opened for a week),
 * nothing is sent.
 */
export type SlotId = 'morning' | 'evening';
export interface ReminderMessage { title: string; body: string }
export interface DigestLike {
  prefs?: { morning?: string | null; evening?: string | null };
  days?: { date: string; messages?: Partial<Record<SlotId, ReminderMessage | null>> }[];
}
export interface SubscriptionLike {
  time_zone?: string | null;
  digest?: DigestLike | null;
  last_sent?: Partial<Record<SlotId, string>> | null;
}

export const WINDOW_MIN = 180;

/** Local date (YYYY-MM-DD) and minutes past midnight in a time zone. */
export function localClock(now: Date, timeZone: string): { day: string; minutes: number } {
  let tz = timeZone;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { tz = 'Europe/Dublin'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** The reminder to send now, or null. `slot` and `day` are what to record in last_sent. */
export function dueMessage(sub: SubscriptionLike, now: Date): { slot: SlotId; day: string; message: ReminderMessage } | null {
  const d = sub.digest;
  if (!d?.prefs) return null;
  const { day, minutes } = localClock(now, sub.time_zone || 'Europe/Dublin');
  const sent = sub.last_sent ?? {};
  for (const slot of ['evening', 'morning'] as SlotId[]) {
    const t = d.prefs[slot];
    if (!t || !/^\d{2}:\d{2}$/.test(t) || sent[slot] === day) continue;
    const at = toMin(t);
    if (minutes < at || minutes >= at + WINDOW_MIN) continue;
    const msg = d.days?.find((x) => x.date === day)?.messages?.[slot];
    if (!msg?.title) return null;
    return { slot, day, message: { title: msg.title, body: msg.body ?? '' } };
  }
  return null;
}
