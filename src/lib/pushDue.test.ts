/**
 * The server push (edge function push-reminders) sends exactly the message the app's
 * reminder digest built, at the farmer's time in their own time zone, once a day.
 */
import { describe, expect, it } from 'vitest';
import { dueMessage, localClock } from '../../supabase/functions/push-reminders/due';
import { buildDigest } from './reminders';
import type { AnimalGroup, FarmBundle, FeedProduct, FeedingRule } from './types';

const TODAY = '2026-10-06';
const group: AnimalGroup = { id: 'cows', farm_id: 'f', name: 'Dairy cows', animal_class: 'dairy_cow', head_count: 120, head_count_updated_at: '2026-10-05T00:00:00Z', forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0 } as AnimalGroup;
const product = { id: 'nut', farm_id: 'f', supplier_id: null, name: 'Dairy nut', storage_location: null, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: 3, archived: false } as FeedProduct;
const rule = { id: 'r', farm_id: 'f', feed_product_id: 'nut', animal_group_id: 'cows', head_count_override: null, kg_per_head_per_feed: 1, feeds_per_day: 2, start_date: '2026-09-01', end_date: null, is_temporary: false, label: null, confirm_daily: true, created_at: '2026-10-01T06:00:00Z' } as FeedingRule;
const b = { farm: { name: 'Glenview' }, rules: [rule], groups: [group], products: [product], silage: [], routines: [], completions: [], feedLogs: [] } as unknown as FarmBundle;
const prefs = { morning: '07:00', evening: '18:00' };
const digest = buildDigest(b, TODAY, prefs, []);

// 6 Oct 2026 is Irish Summer Time (UTC+1): 07:00 in Dublin is 06:00 UTC
const utc = (hhmm: string, day = TODAY) => new Date(`${day}T${hhmm}:00Z`);

describe('server reminders', () => {
  it('reads the clock in the farmer\'s own time zone', () => {
    expect(localClock(utc('06:00'), 'Europe/Dublin')).toEqual({ day: TODAY, minutes: 7 * 60 });
    expect(localClock(utc('23:30', '2026-10-05'), 'Europe/Dublin')).toEqual({ day: TODAY, minutes: 30 });
    // An unknown zone falls back to Ireland instead of failing
    expect(localClock(utc('06:00'), 'Not/AZone').minutes).toBe(7 * 60);
  });

  it('sends the digest\'s own words at the farmer\'s time, within three hours', () => {
    const sub = { time_zone: 'Europe/Dublin', digest, last_sent: {} };
    expect(dueMessage(sub, utc('05:59'))).toBeNull(); // 06:59 in Dublin
    const due = dueMessage(sub, utc('06:00'));
    expect(due).not.toBeNull();
    expect(due!.slot).toBe('morning');
    expect(due!.day).toBe(TODAY);
    expect(due!.message).toEqual(digest.days[0].messages.morning);
    expect(dueMessage(sub, utc('09:00'))).toBeNull(); // 10:00 in Dublin: too late to be useful
  });

  it('sends each reminder once a day', () => {
    const sub = { time_zone: 'Europe/Dublin', digest, last_sent: { morning: TODAY } };
    expect(dueMessage(sub, utc('06:30'))).toBeNull();
    expect(dueMessage({ ...sub, last_sent: { morning: '2026-10-05' } }, utc('06:30'))?.slot).toBe('morning');
  });

  it('sends nothing when there is nothing for that day, or the app was not opened for a week', () => {
    const quiet = { ...digest, days: digest.days.map((d) => ({ ...d, messages: { morning: null, evening: null } })) };
    expect(dueMessage({ time_zone: 'Europe/Dublin', digest: quiet, last_sent: {} }, utc('06:00'))).toBeNull();
    expect(dueMessage({ time_zone: 'Europe/Dublin', digest, last_sent: {} }, utc('06:00', '2026-10-20'))).toBeNull();
    expect(dueMessage({ time_zone: 'Europe/Dublin', digest: null, last_sent: {} }, utc('06:00'))).toBeNull();
  });

  it('follows the times the farmer set, and off means off', () => {
    const off = { ...digest, prefs: { morning: null, evening: null } };
    expect(dueMessage({ time_zone: 'Europe/Dublin', digest: off, last_sent: {} }, utc('06:00'))).toBeNull();
  });
});
