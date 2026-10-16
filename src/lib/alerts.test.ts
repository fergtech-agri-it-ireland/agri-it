import { describe, expect, it } from 'vitest';
import {
  alertKind, bundleAlerts, canPutOff, emptyStats, isSnoozed, parseSnoozes, recordAction, recordShown, snooze, statsRows, statsText,
  type AlertItem
} from './alerts';
import { reminderHeadlines } from './data/derived';
import { bundledLines } from './reminders';
import type { ChecklistItem } from './routines';

const T = '2026-10-14';
const item = (o: Partial<AlertItem> & { id: string }): AlertItem => ({ tone: 'warn', when: 'soon', title: o.id, detail: '', to: '/', ...o });

describe('bundling (G12)', () => {
  it('turns two or more related items into one line, worst timing first', () => {
    const out = bundleAlerts([
      item({ id: 'fert-round-a', group: 'spread', name: 'Bog field', when: 'soon' }),
      item({ id: 'bills-overdue', when: 'overdue' }),
      item({ id: 'fert-round-b', group: 'spread', name: 'Top field', when: 'overdue' }),
      item({ id: 'fert-silage-c', group: 'spread', name: 'Long acre (for silage)', when: 'soon' })
    ]);
    expect(out.map((x) => x.id)).toEqual(['bundle-spread', 'bills-overdue']);
    const b = out[0];
    expect(b.title).toBe('3 fields to spread');
    expect(b.when).toBe('overdue'); // never calmer than its most pressing member
    expect(b.detail).toBe('1 overdue, 2 coming up. Top field, Bog field, Long acre (for silage)');
    expect(b.members?.map((m) => m.id)).toEqual(['fert-round-b', 'fert-round-a', 'fert-silage-c']);
  });

  it('leaves a single item of a group as it is', () => {
    const out = bundleAlerts([item({ id: 'job-1', group: 'job', name: 'Fix gate' }), item({ id: 'forage' })]);
    expect(out.map((x) => x.id)).toEqual(['job-1', 'forage']);
  });

  it('only lets a bundle be put off when every member is information', () => {
    const info = (id: string) => item({ id, tone: 'info', when: 'later', dismissable: true, group: 'feed-setup' });
    expect(bundleAlerts([info('feed-a'), info('feed-b')])[0].dismissable).toBe(true);
    expect(bundleAlerts([info('feed-a'), item({ id: 'feed-b', group: 'feed-setup' })])[0].dismissable).toBe(false);
  });

  it('bundles phone reminder headlines and suggestions of one kind', () => {
    const lines = reminderHeadlines([
      item({ id: 'place-1', group: 'place-order', when: 'today', title: 'Place the Nut order' }),
      item({ id: 'place-2', group: 'place-order', when: 'today', title: 'Place the Calf nut order' })
    ], [
      { key: 'order:a:x', title: 'Order Nut', when: 'today', tone: 'warn' },
      { key: 'order:b:x', title: 'Order Calf', when: 'today', tone: 'warn' },
      { key: 'calves:tag', title: 'Tag 2 calves', when: 'today', tone: 'warn' }
    ]);
    expect(lines).toEqual(['2 orders to place with the supplier', '2 feed orders to approve', 'Tag 2 calves']);
  });

  it('reminder body gives one line per kind of tick', () => {
    const c = (kind: string, title: string) => ({ kind, title } as unknown as ChecklistItem);
    const r = bundledLines([c('feeding', 'Nut: cows'), c('feeding', 'Nut: heifers'), c('expense', 'Vet'), c('expense', 'ESB'), c('job', 'Gate')], 2);
    expect(r).toEqual({ lines: ['2 feeding ticks', '2 bills to pay'], covers: 4 });
  });
});

describe('Not now (G12)', () => {
  it('only information can be put off; overdue and today cannot, even with an old snooze', () => {
    expect(canPutOff({ tone: 'info', when: 'later', dismissable: true })).toBe(true);
    expect(canPutOff({ tone: 'info', when: 'today', dismissable: true })).toBe(false);
    expect(canPutOff({ tone: 'warn', when: 'later', dismissable: true })).toBe(false);
    const map = snooze({}, ['heads'], 7, 'busy', T);
    expect(isSnoozed(map, { id: 'heads', tone: 'info', when: 'later', dismissable: true }, T)).toBe(true);
    expect(isSnoozed(map, { id: 'heads', tone: 'warn', when: 'overdue', dismissable: true }, T)).toBe(false);
  });

  it('keeps the reason and the chosen time, and comes back after', () => {
    const map = snooze({}, ['a', 'b'], 3, 'elsewhere', T);
    expect(map.a).toEqual({ until: '2026-10-17', reason: 'elsewhere' });
    const x = { id: 'a', tone: 'info' as const, when: 'later' as const, dismissable: true };
    expect(isSnoozed(map, x, '2026-10-16')).toBe(true);
    expect(isSnoozed(map, x, '2026-10-17')).toBe(false);
  });

  it('reads older phones that kept only a date', () => {
    expect(parseSnoozes('{"heads":"2026-10-20"}')).toEqual({ heads: { until: '2026-10-20', reason: null } });
    expect(parseSnoozes('not json')).toEqual({});
  });
});

describe('alert counts for the pilot (G12)', () => {
  it('counts shown once a day, and acted, put off, turned down', () => {
    let s = emptyStats(T);
    s = recordShown(s, ['fert-round-a', 'heads', 'sugg:order:x:y'], T);
    s = recordShown(s, ['fert-round-a', 'heads'], T); // same day: not counted again
    s = recordAction(s, 'fert-round-a', { kind: 'acted' }, T);
    s = recordAction(s, 'fert-round-a', { kind: 'acted' }, T); // once a day
    s = recordAction(s, 'heads', { kind: 'put_off', reason: 'busy' }, T);
    s = recordAction(s, 'sugg:order:x:y', { kind: 'turned_down' }, T);
    expect(s.kinds.fields).toMatchObject({ shown: 1, acted: 1 });
    expect(s.kinds.heads).toMatchObject({ shown: 1, putOff: 1, reasons: { busy: 1, elsewhere: 0, not_relevant: 0 } });
    expect(s.kinds.sugg_order).toMatchObject({ shown: 1, turnedDown: 1 });
  });

  it('next day: still there with nothing done is ignored; gone is acted on', () => {
    let s = recordShown(emptyStats(T), ['forage', 'job-1'], T);
    s = recordShown(s, ['forage'], '2026-10-15');
    expect(s.kinds.silage).toMatchObject({ shown: 2, ignored: 1, acted: 0 });
    expect(s.kinds.jobs).toMatchObject({ shown: 1, acted: 1, ignored: 0 });
  });

  it('names each kind and gives a copyable summary', () => {
    expect(alertKind('fert-silage-x')).toBe('fields');
    expect(alertKind('fert-low-x')).toBe('fertiliser');
    expect(alertKind('feed-uninvoiced')).toBe('bills');
    expect(alertKind('bundle-place-order')).toBe('feed_orders');
    expect(alertKind('sugg:calves:tag')).toBe('sugg_calves');
    const s = recordShown(emptyStats(T), ['forage'], T);
    expect(statsRows(s)[0].label).toBe('Winter silage');
    expect(statsText(s, T)).toContain('Winter silage, 1, 0, 0, 0, 0');
  });
});
