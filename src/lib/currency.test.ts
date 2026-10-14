import { afterEach, describe, expect, it } from 'vitest';
import { cur, currencyFor, eur, eurCompact, setCurrency } from './format';
import { jurisdictionInfo } from './jurisdiction';

describe('money in the farm currency (advisory review G05)', () => {
  afterEach(() => setCurrency('EUR'));
  it('Republic farms show euro', () => {
    setCurrency(currencyFor('ROI'));
    expect(eur(1234)).toBe('€1,234');
    expect(eur(12.5, true)).toBe('€12.50');
    expect(cur()).toBe('€');
  });
  it('Northern Ireland farms show pounds, never euro', () => {
    setCurrency(currencyFor('NI'));
    expect(eur(1234)).toBe('£1,234');
    expect(eur(-80, true)).toBe('-\u2060£80.00'); // word joiner: the minus never wraps away from the amount
    expect(eurCompact(127_000)).toMatch(/^£127[kK]$/); // ICU versions differ on the case
    expect(cur()).toBe('£');
  });
  it('names the right department and animal system', () => {
    expect(jurisdictionInfo('NI').department).toBe('DAERA');
    expect(jurisdictionInfo('NI').animalSystem).toMatch(/DAERA Online Services/);
    expect(jurisdictionInfo('ROI').animalSystem).toMatch(/AgFood/);
    expect(jurisdictionInfo(undefined).currency).toBe('EUR');
  });
});
