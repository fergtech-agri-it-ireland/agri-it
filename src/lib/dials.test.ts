import { describe, expect, it } from 'vitest';
import { cashDial, feedDial, silageDial } from './dials';
import type { FeedForecast } from './forecast/feed';
import type { ForageForecast } from './forecast/forage';
import type { FeedProduct } from './types';

const product = (id: string, name: string): FeedProduct => ({
  id, farm_id: 'f', supplier_id: null, name, storage_location: null, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: 3, archived: false
});
const fc = (p: Partial<FeedForecast>): FeedForecast => ({ status: 'ok', daysRemaining: 40, runOutDate: '2026-11-15', ...p } as FeedForecast);

describe('feedDial', () => {
  const products = [product('a', 'Dairy nut'), product('b', 'Calf ration')];
  it('shows the lowest feed against the farmer target and its order status', () => {
    const d = feedDial(products, new Map([['a', fc({ daysRemaining: 26.4, status: 'ok' })], ['b', fc({ daysRemaining: 12.5, status: 'order_soon' })]]), 30);
    expect(d.value).toBe('12');
    expect(d.fraction).toBeCloseTo(12 / 30);
    expect(d.tone).toBe('warn');
    expect(d.status).toBe('Order soon');
    expect(d.to).toBe('/feed/b');
  });
  it('is on track when every feed is above target', () => {
    const d = feedDial(products, new Map([['a', fc({ daysRemaining: 45 })], ['b', fc({ daysRemaining: 33 })]]), 30);
    expect(d.tone).toBe('ok');
    expect(d.fraction).toBeGreaterThanOrEqual(1);
  });
  it('asks for a count instead of inventing days', () => {
    const d = feedDial([products[0]], new Map([['a', fc({ daysRemaining: null, status: 'no_stock_record' })]]), 30);
    expect(d.value).toBe('?');
    expect(d.fraction).toBe(0);
    expect(d.status).toBe('Add a count');
  });
  it('invites you to add a feed when there are none', () => {
    expect(feedDial([], new Map(), 30).to).toBe('/feed/new');
  });
});

describe('silageDial', () => {
  const forage = (p: Partial<ForageForecast>) => ({ status: 'surplus', availableT: 1200, needT: 1000, reservePercent: 15, ...p } as ForageForecast);
  it('shows share of winter need and tonnes short', () => {
    const d = silageDial(forage({ status: 'deficit', availableT: 904, needT: 1037 }));
    expect(d.value).toBe('87%');
    expect(d.status).toBe('133 t short');
    expect(d.tone).toBe('urgent');
  });
  it('flags a short reserve as tight, not urgent', () => {
    expect(silageDial(forage({ status: 'tight', availableT: 1050, needT: 1000 })).tone).toBe('warn');
  });
  it('asks for details when the budget is incomplete', () => {
    expect(silageDial(forage({ status: 'incomplete', needT: null })).status).toBe('Add details');
  });
});

describe('cashDial', () => {
  it('is full and OK when the 90-day low stays positive', () => {
    const d = cashDial({ balance: 126940 }, { closing: 126940 });
    expect(d.fraction).toBe(1);
    expect(d.status).toBe('OK 90 days');
    expect(d.value).toMatch(/127K/);
  });
  it('warns when the outlook goes below zero', () => {
    expect(cashDial({ balance: 5000 }, { closing: -2000 }).tone).toBe('urgent');
  });
  it('asks for a balance when none is set', () => {
    expect(cashDial(null, null).to).toBe('/settings');
  });
});
