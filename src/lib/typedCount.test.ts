import { describe, expect, it } from 'vitest';
import { countFromText, countShown } from './typedCount';

describe('typed counts', () => {
  it('an emptied box means 0 behind the scenes but stays empty on screen', () => {
    expect(countFromText('')).toBe(0);
    expect(countFromText('   ')).toBe(0);
    expect(countShown(0, '')).toBe('');
  });

  it('shows the number when nothing is being typed', () => {
    expect(countShown(0, null)).toBe('0');
    expect(countShown(120, null)).toBe('120');
    expect(countShown(Number.NaN, null)).toBe('');
  });

  it('reads what was typed, with no leading zero left behind', () => {
    expect(countFromText('5')).toBe(5);
    expect(countFromText('05')).toBe(5);
    expect(countFromText('2.5')).toBe(2.5);
    expect(countShown(5, '05')).toBe('05');
  });

  it('ignores text that is not a number', () => {
    expect(countFromText('-')).toBeNull();
    expect(countFromText('abc')).toBeNull();
  });
});
