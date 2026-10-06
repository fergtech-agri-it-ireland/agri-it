/**
 * Daily reminders: a nudge at the farmer's chosen times to tick off feeding and anything
 * else due today. A reminder only points at the checklist. It never records anything
 * (nothing is recorded until the farmer ticks or saves it).
 *
 * This file is pure (no browser APIs) so it can be unit tested. The browser side lives in
 * reminderClock.ts and the service worker add-on in public/reminder-sw.js.
 */
import type { FarmBundle, ISODate } from './types';
import { buildChecklist, type ChecklistItem } from './routines';
import { addDays } from './format';

export type SlotId = 'morning' | 'evening';

export interface ReminderPrefs {
  morning: string | null; // "HH:MM" local time, or null when off
  evening: string | null;
}

export const DEFAULT_PREFS: ReminderPrefs = { morning: null, evening: null };
export const MORNING_TIMES = ['06:00', '07:00', '08:00', '09:00'];
export const EVENING_TIMES = ['17:00', '18:00', '19:00', '20:00'];
/** A reminder that's this late is dropped: a 7am nudge at 3pm is noise. */
export const REMINDER_WINDOW_MIN = 180;
/** How many days ahead the service worker can remind from, if the app isn't opened. */
export const DIGEST_DAYS = 7;

export function parsePrefs(raw: string | null): ReminderPrefs {
  try {
    const p = JSON.parse(raw ?? '');
    const ok = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
    return { morning: ok(p?.morning), evening: ok(p?.evening) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const anyOn = (p: ReminderPrefs) => !!(p.morning || p.evening);

/** "07:00" → "7am", "18:30" → "6:30pm". */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`;
}

export interface DayDigest {
  date: ISODate;
  feeding: number; // feeding ticks due that day
  other: number; // bills, income, jobs, counts, orders, silage
  earlier: number; // not ticked on earlier days (mentioned, never the headline)
  lines: string[]; // first few items, for the notification body
  urgent: string[]; // e.g. "Order Dairy nut 16% now" (only for today: priorities can change)
  /** Ready-made words, so the service worker needs no logic of its own. */
  messages: Record<SlotId, ReminderMessage | null>;
}

export interface Digest {
  generatedAt: string;
  farmName: string;
  prefs: ReminderPrefs;
  days: DayDigest[];
}

/** What is still to tick on `day` (items due that day only; earlier misses aren't carried forward). */
export function dueOn(b: Parameters<typeof buildChecklist>[0], day: ISODate): ChecklistItem[] {
  return buildChecklist(b, day).filter((i) => i.date === day && i.status === 'pending');
}

/**
 * The digest the service worker reads when the app isn't open. Built from the farm data
 * on the phone each time the app opens, for today and the next few days.
 */
export function buildDigest(
  b: Parameters<typeof buildChecklist>[0] & Pick<FarmBundle, 'farm'>, today: ISODate, prefs: ReminderPrefs, urgentToday: string[], now = new Date()
): Digest {
  const days: DayDigest[] = [];
  for (let i = 0; i < DIGEST_DAYS; i++) {
    const day = addDays(today, i);
    const items = dueOn(b, day);
    const d: Omit<DayDigest, 'messages'> = {
      date: day,
      // today only: things from the last few days that were never ticked
      earlier: i === 0 ? buildChecklist(b, day).filter((x) => x.date < day && x.status === 'pending').length : 0,
      feeding: items.filter((x) => x.kind === 'feeding').length,
      other: items.filter((x) => x.kind !== 'feeding').length,
      lines: items.slice(0, 3).map((x) => x.title),
      urgent: i === 0 ? urgentToday.slice(0, 2) : []
    };
    days.push({ ...d, messages: { morning: reminderMessage(d, 'morning'), evening: reminderMessage(d, 'evening') } });
  }
  return { generatedAt: now.toISOString(), farmName: b.farm.name, prefs, days };
}

export interface ReminderMessage {
  title: string;
  body: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The words on the phone's lock screen. Null when there is nothing to tick and nothing urgent. */
export function reminderMessage(day: Omit<DayDigest, 'messages'>, slot: SlotId): ReminderMessage | null {
  const total = day.feeding + day.other;
  if (total === 0 && day.urgent.length === 0) return null;
  const parts = [day.feeding ? plural(day.feeding, 'feeding tick') : '', day.other ? plural(day.other, 'job') : ''].filter(Boolean);
  const title = total === 0 ? day.urgent[0] : `${slot === 'morning' ? 'Today' : 'Still to tick off'}: ${parts.join(' and ')}`;
  const more = total - day.lines.length;
  const body = [
    ...(total ? [day.lines.join(', ') + (more > 0 ? `, and ${more} more` : '')] : []),
    ...(total ? day.urgent : day.urgent.slice(1)),
    ...(day.earlier ? [`Plus ${day.earlier} not ticked from earlier days`] : [])
  ].filter(Boolean).join('. ');
  return { title, body: body || 'Open Agri-It to see what is due.' };
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Which reminder (if any) is due right now: its time has passed today, it's within the
 * window, and it hasn't been shown today. `shown` maps slot to the local day last shown.
 * The evening slot wins if both are due (it is the more recent).
 */
export function slotDue(prefs: ReminderPrefs, now: Date, shown: Partial<Record<SlotId, string>>): { slot: SlotId; day: ISODate } | null {
  const day = localDay(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const slot of ['evening', 'morning'] as SlotId[]) {
    const t = prefs[slot];
    if (!t || shown[slot] === day) continue;
    const at = minutes(t);
    if (nowMin >= at && nowMin < at + REMINDER_WINDOW_MIN) return { slot, day };
  }
  return null;
}

/** The next time a reminder will go off, for the Settings screen. */
export function nextReminder(prefs: ReminderPrefs, now: Date): { slot: SlotId; time: string; tomorrow: boolean } | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const set = (['morning', 'evening'] as SlotId[]).filter((s) => prefs[s]).map((s) => ({ slot: s, time: prefs[s]!, at: minutes(prefs[s]!) })).sort((a, c) => a.at - c.at);
  if (!set.length) return null;
  const later = set.find((x) => x.at > nowMin);
  const pick = later ?? set[0];
  return { slot: pick.slot, time: pick.time, tomorrow: !later };
}

/**
 * A calendar file with a daily alarm at each reminder time. Works on every phone with no
 * server and no notification permission: the phone's own calendar does the reminding.
 */
export function remindersIcs(prefs: ReminderPrefs, appUrl: string, startDay: ISODate, uidSeed: string): string {
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ymd = startDay.replace(/-/g, '');
  const events = (['morning', 'evening'] as SlotId[]).filter((s) => prefs[s]).map((s) => {
    const t = prefs[s]!.replace(':', '');
    const summary = s === 'morning' ? 'Agri-It: tick off today\'s feeding and jobs' : 'Agri-It: anything left to tick off?';
    return [
      'BEGIN:VEVENT',
      `UID:agri-it-${s}-${uidSeed}@agri-it`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ymd}T${t}00`,
      'DURATION:PT10M',
      'RRULE:FREQ=DAILY',
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(`Open Agri-It: ${appUrl}`)}`,
      `URL:${esc(appUrl)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(summary)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    ].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agri-It//Reminders//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
