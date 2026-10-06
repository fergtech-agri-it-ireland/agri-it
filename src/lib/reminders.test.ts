import { describe, expect, it } from 'vitest';
import { buildDigest, nextReminder, parsePrefs, reminderMessage, remindersIcs, slotDue, timeLabel } from './reminders';
import type { AnimalGroup, FarmBundle, FeedProduct, FeedingRule, Routine } from './types';

const TODAY = '2026-10-06';
const at = (hhmm: string, day = TODAY) => new Date(`${day}T${hhmm}:00`); // local time, like the phone

const group: AnimalGroup = { id: 'cows', farm_id: 'f', name: 'Dairy cows', animal_class: 'dairy_cow', head_count: 120, head_count_updated_at: '2026-10-05T00:00:00Z', forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0 };
const product: FeedProduct = { id: 'nut', farm_id: 'f', supplier_id: null, name: 'Dairy nut', storage_location: null, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: 3, archived: false };
const rule: FeedingRule = { id: 'r', farm_id: 'f', feed_product_id: 'nut', animal_group_id: 'cows', head_count_override: null, kg_per_head_per_feed: 1, feeds_per_day: 2, start_date: '2026-09-01', end_date: null, is_temporary: false, label: null, confirm_daily: true, created_at: '2026-10-01T06:00:00Z' };
const bill: Routine = { id: 'esb', farm_id: 'f', kind: 'expense', title: 'ESB bill', frequency: 'weekly', interval_days: null, weekday: 4, day_of_month: null, start_date: '2026-01-01', end_date: null, amount: 640, category: 'utilities', counterparty: 'ESB', feed_product_id: null, silage_store_id: null, supplier_id: null, active: true, created_at: '2026-01-01T00:00:00Z' };
const b = { farm: { name: 'Glenview' }, rules: [rule], groups: [group], products: [product], silage: [], routines: [bill], completions: [], feedLogs: [] } as unknown as FarmBundle;

describe('reminder settings', () => {
  it('reads saved times and ignores rubbish', () => {
    expect(parsePrefs('{"morning":"07:00","evening":null}')).toEqual({ morning: '07:00', evening: null });
    expect(parsePrefs('{"morning":"7am"}')).toEqual({ morning: null, evening: null });
    expect(parsePrefs(null)).toEqual({ morning: null, evening: null });
  });
  it('says times the way people do', () => {
    expect(timeLabel('07:00')).toBe('7am');
    expect(timeLabel('18:30')).toBe('6:30pm');
    expect(timeLabel('00:00')).toBe('12am');
    expect(timeLabel('12:00')).toBe('12pm');
  });
});

describe('when a reminder goes off', () => {
  const prefs = { morning: '07:00', evening: '18:00' };
  it('fires after its time, once a day, within three hours', () => {
    expect(slotDue(prefs, at('06:59'), {})).toBeNull();
    expect(slotDue(prefs, at('07:00'), {})).toEqual({ slot: 'morning', day: TODAY });
    expect(slotDue(prefs, at('09:59'), {})).toEqual({ slot: 'morning', day: TODAY });
    expect(slotDue(prefs, at('10:00'), {})).toBeNull(); // too late to be useful
    expect(slotDue(prefs, at('07:30'), { morning: TODAY })).toBeNull(); // already shown
    expect(slotDue(prefs, at('07:30'), { morning: '2026-10-05' })).toEqual({ slot: 'morning', day: TODAY });
    expect(slotDue(prefs, at('18:10'), { morning: TODAY })).toEqual({ slot: 'evening', day: TODAY });
    expect(slotDue({ morning: null, evening: null }, at('07:00'), {})).toBeNull();
  });
  it('next reminder rolls over to tomorrow', () => {
    expect(nextReminder(prefs, at('05:00'))).toEqual({ slot: 'morning', time: '07:00', tomorrow: false });
    expect(nextReminder(prefs, at('12:00'))).toEqual({ slot: 'evening', time: '18:00', tomorrow: false });
    expect(nextReminder(prefs, at('19:00'))).toEqual({ slot: 'morning', time: '07:00', tomorrow: true });
    expect(nextReminder({ morning: null, evening: null }, at('19:00'))).toBeNull();
  });
});

describe('what a reminder says', () => {
  const digest = buildDigest(b, TODAY, { morning: '07:00', evening: null }, ['Order Dairy nut now'], at('06:00'));

  it('covers a week, with feeding every day and the bill on Thursdays', () => {
    expect(digest.days).toHaveLength(7);
    expect(digest.days.map((d) => d.feeding)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(digest.days.map((d) => d.other)).toEqual([0, 0, 1, 0, 0, 0, 0]); // 6 Oct 2026 is a Tuesday
    expect(digest.days[0].urgent).toEqual(['Order Dairy nut now']);
    expect(digest.days[1].urgent).toEqual([]); // priorities can change by tomorrow
  });

  it('morning and evening wording', () => {
    expect(digest.days[0].messages.morning).toEqual({ title: 'Today: 1 feeding tick', body: 'Dairy cows: 240 kg Dairy nut. Order Dairy nut now. Plus 4 not ticked from earlier days' });
    expect(digest.days[2].messages.evening?.title).toBe('Still to tick off: 1 feeding tick and 1 job');
  });

  it('no reminder when nothing is due, unless something is urgent', () => {
    const empty = { date: TODAY, feeding: 0, other: 0, earlier: 0, lines: [], urgent: [] };
    expect(reminderMessage(empty, 'morning')).toBeNull();
    expect(reminderMessage({ ...empty, urgent: ['Order Dairy nut now'] }, 'morning')).toEqual({ title: 'Order Dairy nut now', body: 'Open Agri-It to see what is due.' });
    expect(reminderMessage({ date: TODAY, feeding: 3, other: 2, earlier: 0, lines: ['a', 'b', 'c'], urgent: [] }, 'morning')?.body).toBe('a, b, c, and 2 more');
  });

  it('skips feeding already ticked today', () => {
    const ticked = { ...b, feedLogs: [{ id: 'l', farm_id: 'f', feeding_rule_id: 'r', feed_product_id: 'nut', animal_group_id: 'cows', used_on: TODAY, planned_kg: 240, actual_kg: 240, status: 'fed', created_at: '' }] } as unknown as FarmBundle;
    const day = buildDigest(ticked, TODAY, { morning: '07:00', evening: null }, []).days[0];
    expect(day.feeding).toBe(0);
    expect(day.earlier).toBe(4); // 3 earlier feeding days + last Thursday's bill
    expect(day.messages.morning).toBeNull(); // earlier misses alone never trigger a buzz
  });
});

describe('calendar file', () => {
  it('one daily event with an alarm per reminder time', () => {
    const ics = remindersIcs({ morning: '07:00', evening: '18:00' }, 'https://agri-it.example/', TODAY, 'farm1');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('DTSTART:20261006T070000');
    expect(ics).toContain('DTSTART:20261006T180000');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});
