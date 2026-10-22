/**
 * Cattle tag numbers and the Irish animal identity card (the blue card). Rule `animal-card@1.0`.
 *
 * What the research says (checked 22 Oct 2026, Irish Farmers Journal "Cattle tag numbers change
 * after 18 years" and the ICAR Ireland eartag example):
 * - Tags and cards issued since 1 November 2016 are 15 digits: 372 (Ireland), 2 digits for the
 *   bovine range, 5 for the herd, 1 check digit, 4 for the animal.
 * - Older tags are IE followed by 12 digits: 2 county digits, 5 herd, 1 check digit, 4 animal.
 *   Calves born since 1 January 1999 carry this form, so it is still on many animals.
 * - Agri-It does not know the check digit rule, so it never says a number is "valid". It checks
 *   the shape only (prefix and digit count) and shows the number exactly as read.
 *
 * Reading a photo: the lines the reader found are searched for numbers of that shape. Letters the
 * reader often takes for digits (O, I, l, S, B, Z) are fixed only inside a number, and the value
 * says when that happened. One number on the card is offered as the animal's, with how sure the
 * reader was. Two or more (the card can also show the dam or the herd) are all "not sure": the
 * farmer picks. Nothing is filled in as sure unless it was clear, and nothing is saved until the
 * farmer taps Save. Pure, so it gives the same answer whichever reader ran.
 */
import type { ISODate } from './types';
import type { OcrLine, Read } from './docket/extract';

export const ANIMAL_CARD_RULE = 'animal-card@1.0';

export type TagKind = 'ie372' | 'ie_old';

export interface TagParts {
  kind: TagKind;
  /** No spaces: 372123456781234 or IE123456781234 */
  canonical: string;
  prefix: '372' | 'IE';
  /** Bovine range (372 tags) or county (IE tags), 2 digits */
  range: string;
  herd: string;
  check: string;
  /** The 4 digits printed biggest on the tag */
  animal: string;
}

export const TAG_HELP = 'Tags issued since November 2016 are 15 digits starting 372. Older tags are IE and 12 digits.';

/** A tag as typed or read: spaces, dots and dashes ignored, upper case. Null unless it has the shape of an Irish cattle tag. */
export function parseTag(input: string): TagParts | null {
  const s = input.toUpperCase().replace(/[\s.\-_/]+/g, '');
  const m = /^(372|IE)(\d{12})$/.exec(s);
  if (!m) return null;
  const d = m[2];
  const prefix = m[1] as '372' | 'IE';
  return { kind: prefix === '372' ? 'ie372' : 'ie_old', canonical: `${prefix}${d}`, prefix, range: d.slice(0, 2), herd: d.slice(2, 7), check: d.slice(7, 8), animal: d.slice(8, 12) };
}

/** How a stored tag is shown: 372 12 34567 8 1234. Anything that is not a cattle tag shape is shown as stored. */
export function formatTag(canonical: string): string {
  const p = parseTag(canonical);
  return p ? `${p.prefix} ${p.range} ${p.herd} ${p.check} ${p.animal}` : canonical;
}

/** Why a typed number cannot be used yet, in plain words. Null when it is fine. */
export function tagProblem(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s.\-_/]+/g, '');
  if (!s) return null;
  if (parseTag(s)) return null;
  if (/^\d+$/.test(s)) return s.length === 15 ? 'A 15 digit tag starts with 372.' : `That is ${s.length} digits. A tag is 15 digits starting 372.`;
  if (/^IE\d*$/.test(s)) return `IE tags have 12 digits after the IE. That is ${s.length - 2}.`;
  return 'A tag is 372 and 12 digits, or IE and 12 digits.';
}

// ---------------------------------------------------------------------------
// Reading the card
// ---------------------------------------------------------------------------

const DIGITISH: Record<string, string> = { O: '0', Q: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2' };
const DIGITISH_CLASS = '[0-9OQILSBZ|]';
const SEP = '[\\s.\\-_]*';
// 372 then twelve digit-like characters; a clean digit before or after means it is part of a longer number
const RE_372 = new RegExp(`(?<![0-9A-Z])3${SEP}7${SEP}2${SEP}((?:${DIGITISH_CLASS}${SEP}){11}${DIGITISH_CLASS})(?![0-9])`, 'gi');
// IE (or the reader's "lE", "1E") then twelve digit-like characters
const RE_IE = new RegExp(`(?<![0-9A-Z])[I1L]${SEP}E${SEP}((?:${DIGITISH_CLASS}${SEP}){11}${DIGITISH_CLASS})(?![0-9])`, 'gi');

export interface TagRead extends Read<TagParts> {
  /** Letters read as digits inside the number: the reader may have got it wrong */
  swapped: boolean;
}

export interface AnimalCardRead {
  rule: typeof ANIMAL_CARD_RULE;
  reader: string;
  /** Every tag-shaped number found, once each, in reading order */
  tags: TagRead[];
  /** A date next to the words date of birth, offered as a suggestion only */
  bornOn?: Read<ISODate>;
  /** Overall reader confidence for the page, 0 to 100 */
  pageConfidence: number;
  /** In plain words: what could not be read */
  missing: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function dobIn(lines: OcrLine[]): Read<ISODate> | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!/\b(date\s*of\s*birth|dob|born|birth)\b/i.test(lines[i].text)) continue;
    // The date may be on the same line or the next one
    for (const l of [lines[i], lines[i + 1]].filter(Boolean)) {
      const m = /\b(\d{1,2})[\s./-]+(\d{1,2})[\s./-]+((?:19|20)\d{2})\b/.exec(l.text);
      if (!m) continue;
      const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3]);
      if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
      const iso = `${y}-${pad(mo)}-${pad(d)}`;
      if (Number.isNaN(Date.parse(iso)) || new Date(iso).getUTCDate() !== d) continue;
      // Day first, as Irish documents print it. Always a suggestion: never filled in unasked.
      return { value: iso, confidence: 'low', from: l.text, note: 'Read next to the words date of birth' };
    }
  }
  return undefined;
}

/** Find the tag numbers (and a date of birth, as a suggestion) in the lines a reader found on a card photo. */
export function readAnimalCard(lines: OcrLine[], reader: string): AnimalCardRead {
  const found: { parts: TagParts; from: string; swapped: boolean; lineConfidence: number }[] = [];
  const seen = new Set<string>();
  const pageConfidence = lines.length ? Math.round(lines.reduce((s, l) => s + l.confidence, 0) / lines.length) : 0;

  for (const line of lines) {
    for (const [re, prefix] of [[RE_372, '372'], [RE_IE, 'IE']] as const) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line.text))) {
        const raw = m[1].replace(/[\s.\-_]/g, '').toUpperCase();
        const swapped = /[^0-9]/.test(raw);
        const digits = raw.replace(/./g, (c) => DIGITISH[c] ?? c);
        const parts = parseTag(`${prefix}${digits}`);
        if (!parts || seen.has(parts.canonical)) continue;
        seen.add(parts.canonical);
        found.push({ parts, from: line.text, swapped, lineConfidence: line.confidence });
      }
    }
  }

  // A single number, read cleanly, is the animal's: high. Read with doubt: medium. Several: the farmer picks.
  const tags: TagRead[] = found.map((f) => {
    const notes: string[] = [];
    if (f.swapped) notes.push('Some letters were read as digits');
    if (found.length > 1) notes.push("More than one number on the card: pick the animal's");
    const confidence = found.length > 1 ? 'low' : !f.swapped && f.lineConfidence >= 75 ? 'high' : 'medium';
    return { value: f.parts, confidence, from: f.from, swapped: f.swapped, note: notes.length ? notes.join('. ') : undefined };
  });

  return { rule: ANIMAL_CARD_RULE, reader, tags, bornOn: dobIn(lines), pageConfidence, missing: tags.length === 0 ? ['the tag number'] : [] };
}
