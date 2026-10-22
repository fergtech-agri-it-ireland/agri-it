import { describe, expect, it } from 'vitest';
import { formatTag, parseTag, readAnimalCard, tagProblem } from './animalId';
import type { OcrLine } from './docket/extract';

const L = (conf: number, ...t: string[]): OcrLine[] => t.map((text) => ({ text, confidence: conf }));

describe('tag numbers', () => {
  it('reads a 15 digit tag however it is spaced', () => {
    for (const s of ['372123456781234', '372 12 34567 8 1234', '372-12-34567-8-1234', ' 372.12345.6781234 ']) {
      const p = parseTag(s)!;
      expect(p.canonical).toBe('372123456781234');
      expect([p.prefix, p.range, p.herd, p.check, p.animal]).toEqual(['372', '12', '34567', '8', '1234']);
      expect(p.kind).toBe('ie372');
    }
  });
  it('reads the older IE form, in any case', () => {
    const p = parseTag('ie 04 12345 6 7890')!;
    expect(p.canonical).toBe('IE041234567890');
    expect(p.kind).toBe('ie_old');
    expect(formatTag('IE041234567890')).toBe('IE 04 12345 6 7890');
    expect(formatTag('372123456781234')).toBe('372 12 34567 8 1234');
  });
  it('does not accept anything of the wrong shape, and says why', () => {
    expect(parseTag('12345678901')).toBeNull();
    expect(parseTag('IE12345')).toBeNull();
    expect(parseTag('373123456781234')).toBeNull();
    expect(parseTag('372 1234567812345')).toBeNull(); // 13 digits after 372
    expect(tagProblem('')).toBeNull();
    expect(tagProblem('372123456781234')).toBeNull();
    expect(tagProblem('3721234567')).toBe('That is 10 digits. A tag is 15 digits starting 372.');
    expect(tagProblem('123456789012345')).toBe('A 15 digit tag starts with 372.');
    expect(tagProblem('IE12345')).toBe('IE tags have 12 digits after the IE. That is 5.');
    expect(tagProblem('abc')).toBe('A tag is 372 and 12 digits, or IE and 12 digits.');
  });
  it('shows a stored value that is not a cattle tag exactly as stored', () => {
    expect(formatTag('IE-SHEEP-7')).toBe('IE-SHEEP-7');
  });
});

describe('reading the animal identity card', () => {
  it('one clean tag number is the animal\'s: high', () => {
    const r = readAnimalCard(L(92, 'ANIMAL IDENTITY CARD', 'Tag number 372 12 34567 8 1234', 'Breed AA Sex F'), 'test');
    expect(r.tags).toHaveLength(1);
    expect(r.tags[0].value.canonical).toBe('372123456781234');
    expect(r.tags[0].confidence).toBe('high');
    expect(r.tags[0].swapped).toBe(false);
    expect(r.tags[0].from).toBe('Tag number 372 12 34567 8 1234');
    expect(r.missing).toEqual([]);
  });

  it('a number read from a blurry line is fairly sure, not sure', () => {
    const r = readAnimalCard(L(58, '372 12 34567 8 1234'), 'test');
    expect(r.tags[0].confidence).toBe('medium');
  });

  it('fixes letters the reader took for digits inside the number and says so', () => {
    const r = readAnimalCard(L(90, 'IE 0l 2345S 6 78OB'), 'test');
    expect(r.tags[0].value.canonical).toBe('IE012345567808');
    expect(r.tags[0].swapped).toBe(true);
    expect(r.tags[0].confidence).toBe('medium');
    expect(r.tags[0].note).toMatch(/read as digits/);
  });

  it('two numbers on the card (dam, herd): none is chosen for the farmer', () => {
    const r = readAnimalCard(L(95, '372 12 34567 8 1234', 'Dam 372 12 34567 2 0456'), 'test');
    expect(r.tags.map((t) => t.value.canonical)).toEqual(['372123456781234', '372123456720456']);
    expect(r.tags.every((t) => t.confidence === 'low')).toBe(true);
    expect(r.tags[0].note).toMatch(/pick/);
  });

  it('the same number twice is one number', () => {
    const r = readAnimalCard(L(95, '372 12 34567 8 1234', '372123456781234'), 'test');
    expect(r.tags).toHaveLength(1);
  });

  it('does not take part of a longer number, a phone number or a herd number for a tag', () => {
    const r = readAnimalCard(L(95, 'Tel 0876 372 123 456 781 2345', 'Herd 1234567', 'Eircode V94 1234'), 'test');
    expect(r.tags).toHaveLength(0);
    expect(r.missing).toEqual(['the tag number']);
  });

  it('a date of birth is only ever a suggestion, from next to the words', () => {
    const r = readAnimalCard(L(90, '372 12 34567 8 1234', 'Date of birth: 05/02/2024', 'Calved 01/01/2023'), 'test');
    expect(r.bornOn?.value).toBe('2024-02-05');
    expect(r.bornOn?.confidence).toBe('low');
    const none = readAnimalCard(L(90, '372 12 34567 8 1234', '05/02/2024'), 'test');
    expect(none.bornOn).toBeUndefined();
    const bad = readAnimalCard(L(90, 'Date of birth 31/02/2024'), 'test');
    expect(bad.bornOn).toBeUndefined();
  });

  it('an empty page reads nothing', () => {
    const r = readAnimalCard([], 'test');
    expect(r.tags).toEqual([]);
    expect(r.pageConfidence).toBe(0);
  });
});
