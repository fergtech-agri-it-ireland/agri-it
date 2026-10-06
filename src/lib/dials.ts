/**
 * The three Today dials: Feed, Silage, Cash. Pure so it can be tested.
 * Each ring fills only against a real denominator:
 *   Feed   = lowest days of cover / the farmer's own target (Settings)
 *   Silage = silage in store / winter need (before reserve)
 *   Cash   = full when the 90-day outlook never goes below zero
 */
import type { FeedForecast } from './forecast/feed';
import type { ForageForecast } from './forecast/forage';
import type { DialTone } from '../components/Dial';
import type { FeedProduct } from './types';
import { eurCompact, fmtDay, fmtNum } from './format';

export interface DialSpec {
  id: 'feed' | 'silage' | 'cash';
  label: string;
  value: string;
  unit: string;
  fraction: number;
  tone: DialTone;
  status: string;
  description: string;
  to: string;
}

export function feedDial(products: FeedProduct[], feed: Map<string, FeedForecast>, targetDays: number): DialSpec {
  const live = products.filter((p) => !p.archived).map((p) => ({ p, f: feed.get(p.id)! })).filter((x) => x.f);
  const base = { id: 'feed' as const, label: 'Feed' };
  if (live.length === 0) {
    return { ...base, value: '+', unit: 'add feed', fraction: 0, tone: 'info', status: 'Add a feed', description: 'no bought-in feed set up', to: '/feed/new' };
  }
  const forecastable = live.filter((x) => x.f.daysRemaining !== null);
  if (forecastable.length === 0) {
    const first = live[0];
    const missing = first.f.status === 'no_stock_record' ? 'Add a count' : 'Add a plan';
    return { ...base, value: '?', unit: 'days', fraction: 0, tone: 'info', status: missing, description: `${first.p.name} needs a ${missing === 'Add a count' ? 'stock count' : 'feeding plan'}`, to: `/feed/${first.p.id}` };
  }
  const lowest = forecastable.sort((a, b) => (a.f.daysRemaining ?? 0) - (b.f.daysRemaining ?? 0))[0];
  const days = Math.floor(lowest.f.daysRemaining ?? 0);
  const anyNow = live.some((x) => x.f.status === 'order_now');
  const anySoon = live.some((x) => x.f.status === 'order_soon');
  const tone: DialTone = anyNow ? 'urgent' : anySoon ? 'warn' : days < targetDays ? 'warn' : 'ok';
  const status = anyNow ? 'Order now' : anySoon ? 'Order soon' : days < targetDays ? 'Below target' : 'On track';
  return {
    ...base, value: days > 99 ? '99+' : String(days), unit: days === 1 ? 'day' : 'days', fraction: days / targetDays, tone, status,
    description: `${lowest.p.name} has ${days} days left, runs out ${fmtDay(lowest.f.runOutDate)}. ${status}.`,
    to: `/feed/${lowest.p.id}`
  };
}

export function silageDial(forage: ForageForecast): DialSpec {
  const base = { id: 'silage' as const, label: 'Silage', to: '/forecast?tab=forage' };
  if (forage.status === 'incomplete' || !forage.needT) {
    return { ...base, value: '?', unit: 'of winter', fraction: 0, tone: 'info', status: 'Add details', description: 'silage budget needs details' };
  }
  const share = forage.availableT / forage.needT;
  const pct = Math.round(share * 100);
  if (forage.status === 'deficit') {
    const short = Math.round(forage.needT - forage.availableT);
    return { ...base, value: `${pct}%`, unit: 'of winter', fraction: share, tone: 'urgent', status: `${fmtNum(short)} t short`, description: `${pct}% of winter covered, ${short} tonnes short before reserve` };
  }
  if (forage.status === 'tight') {
    return { ...base, value: `${Math.min(pct, 999)}%`, unit: 'of winter', fraction: 1, tone: 'warn', status: 'Reserve short', description: `winter covered but not your ${forage.reservePercent}% reserve` };
  }
  return { ...base, value: `${Math.min(pct, 999)}%`, unit: 'of winter', fraction: 1, tone: 'ok', status: 'Covered', description: `winter covered with your ${forage.reservePercent}% reserve` };
}

export function cashDial(cash: { balance: number } | null, lowest: { closing: number } | null): DialSpec {
  const base = { id: 'cash' as const, label: 'Cash' };
  if (!cash) {
    return { ...base, value: '€?', unit: 'in bank', fraction: 0, tone: 'info', status: 'Add balance', description: 'add your bank balance to track cash', to: '/settings' };
  }
  const low = lowest?.closing ?? cash.balance;
  const negative = Math.min(cash.balance, low) < 0;
  return {
    ...base, value: eurCompact(cash.balance), unit: 'recorded', fraction: negative ? 0.25 : 1,
    tone: negative ? 'urgent' : 'ok', status: negative ? 'May go overdrawn' : 'OK 90 days',
    description: `${eurCompact(cash.balance)} recorded. ${negative ? `Could go below zero, lowest about ${eurCompact(low)}` : 'Stays positive for the next 90 days'}.`,
    to: '/forecast?tab=cash'
  };
}
