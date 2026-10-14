import { describe, expect, it } from 'vitest';
import { silageSummary, type ForageForecast } from './forage';

const base = { stores: [], groups: [], demandTPerMonth: 265, winterStart: null, winterEnd: null, monthsToCover: 3.9, reservePercent: 15, monthsOfCover: null, confidence: 'low', reasons: [], missing: [], inputsHash: '', inputs: {} } as unknown as ForageForecast;
const f = (availableT: number, needT: number, status: ForageForecast['status']): ForageForecast => ({
  ...base, availableT, needT, needWithReserveT: needT * 1.15, balanceT: availableT - needT * 1.15, status
});

describe('one set of silage sums everywhere (review G13)', () => {
  it('short: winter shortfall and reserve shortfall add up', () => {
    const s = silageSummary(f(904.3, 1037.4, 'deficit'))!;
    expect(s).toMatchObject({ storeT: 904, winterNeedT: 1037, reserveT: 156, targetT: 1193, shortOfWinterT: 133, shortOfTargetT: 289, spareT: 0, percentOfWinter: 87 });
    expect(s.storeT + s.shortOfWinterT).toBe(s.winterNeedT);
    expect(s.storeT + s.shortOfTargetT).toBe(s.targetT);
    expect(s.line).toBe('133 t short for the winter, 289 t short counting your 15% reserve (156 t)');
  });
  it('tight: winter covered, reserve not', () => {
    const s = silageSummary(f(1100, 1000, 'tight'))!;
    expect(s.line).toBe('Winter covered, 50 t short of your 15% reserve (150 t)');
  });
  it('covered: says what is to spare after the reserve', () => {
    expect(silageSummary(f(1300, 1000, 'surplus'))!.line).toBe('Winter and your 15% reserve (150 t) covered, 150 t to spare');
  });
  it('nothing to say without a winter need', () => {
    expect(silageSummary(f(900, 0, 'incomplete'))).toBeNull();
  });
});
