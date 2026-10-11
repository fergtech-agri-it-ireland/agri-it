/**
 * Silage dry matter help (rule silage-dm@1.0).
 *
 * What exists in published Irish sources, and so what Agri-It can say (checked 11 Oct 2026):
 * - Teagasc's yard tests (squeeze and ball) put silage into a dry matter band (S17).
 * - Teagasc: pit silage is typically about 25% DM, and wilting to about 30% is advised for
 *   pits (S16). Teagasc's only published pit density is for that 25% silage: one tonne per
 *   1.39 m³ (S16).
 * - Northern Ireland averages by cut for 2025 from feed trade samples (S18), and 2022's first
 *   cut average (S19): 8.8 points apart, so a yearly average is only a rough guide.
 * - No published Irish figures by county or by month of cutting were found, so Agri-It
 *   shows none. Republic of Ireland farms get Teagasc's typical figure (S16).
 *
 * Typical figures are shown for information only: they never fill a field. A yard test gives
 * a band, saved as the farmer's own estimate. A lab figure always comes first.
 */
import type { Jurisdiction } from '../types';

export const SILAGE_DM_RULE_VERSION = 'silage-dm@1.0';

/** published: 'YYYY-MM' or 'YYYY-MM-DD'; empty when the source carries no date */
export interface DmSource { code: string; title: string; publisher: string; url: string; published: string }
export const DM_SOURCES: Record<string, DmSource> = {
  S16: { code: 'S16', title: 'A guide to storing silage and managing effluent collection (Today\'s Farm, May-June 2024)', publisher: 'Teagasc', url: 'https://teagasc.ie/wp-content/uploads/media/website/publications/2024/A-guide-to-storing-silage-and-managing-effluent-collection.pdf', published: '2024-05' },
  S17: { code: 'S17', title: 'Visual Assessment of Silage (factsheet)', publisher: 'Teagasc', url: 'https://teagasc.ie/wp-content/uploads/2025/05/Visual-Assessment-of-Silage-Factsheet.pdf', published: '' },
  S18: { code: 'S18', title: 'First cut silage better quality than in 2024 (feed trade data)', publisher: 'Irish Farmers Journal', url: 'https://www.farmersjournal.ie/more/northern-ireland/first-cut-silage-better-quality-than-in-2024-890435', published: '2025-10-22' },
  S19: { code: 'S19', title: 'Northern Ireland: First-cut silage has average DM of just 24% (United Feeds analysis)', publisher: 'Agriland', url: 'https://www.agriland.ie/farming-news/northern-ireland-first-cut-silage-has-average-dm-of-just-24/', published: '2022-10-26' }
};

/** Which cut the silage is from. Bales can be any cut. */
export type SilageCut = 1 | 2 | 3;
export const CUT_LABEL: Record<SilageCut, string> = { 1: 'First cut', 2: 'Second cut', 3: 'Third or later' };

// ---------------------------------------------------------------------------
// Yard tests (Teagasc, S17)
// ---------------------------------------------------------------------------
export type DmTest = 'squeeze_lt20' | 'squeeze_20_25' | 'squeeze_25_30' | 'ball_lt25' | 'ball_25_30' | 'ball_30_40' | 'ball_gt40';
export interface DmTestOption { id: DmTest; test: 'squeeze' | 'ball'; saw: string; low: number | null; high: number | null }
export const DM_TESTS: DmTestOption[] = [
  { id: 'squeeze_lt20', test: 'squeeze', saw: 'Juice runs out easily', low: null, high: 20 },
  { id: 'squeeze_20_25', test: 'squeeze', saw: 'Juice comes out, but only with effort', low: 20, high: 25 },
  { id: 'squeeze_25_30', test: 'squeeze', saw: 'Little or no juice, hands moist', low: 25, high: 30 },
  { id: 'ball_lt25', test: 'ball', saw: 'Ball keeps its shape, some juice', low: null, high: 25 },
  { id: 'ball_25_30', test: 'ball', saw: 'Ball keeps its shape, no juice', low: 25, high: 30 },
  { id: 'ball_30_40', test: 'ball', saw: 'Ball slowly falls apart', low: 30, high: 40 },
  { id: 'ball_gt40', test: 'ball', saw: 'Ball falls apart quickly', low: 40, high: null }
];
export const TEST_HOW: Record<'squeeze' | 'ball', string> = {
  squeeze: 'For wetter silage. Take a handful from the middle of the pit (not the top) and squeeze it hard in your fist. Don\'t wring every drop out of it.',
  ball: 'For drier, chopped silage. Squeeze a handful tightly into a ball for half a minute, then open your hand.'
};

export function bandLabel(low: number | null, high: number | null): string {
  if (low === null && high !== null) return `under ${high}%`;
  if (high === null && low !== null) return `over ${low}%`;
  return `${low} to ${high}%`;
}

/** What the store's dry matter is and where it came from, in words. Null when not known. */
export function dmSummary(s: { dm_percent: number | null; dm_test?: string | null }): { text: string; basis: 'lab' | 'yard_test'; sourceCode: string | null } | null {
  if (s.dm_percent !== null && s.dm_percent !== undefined && String(s.dm_percent) !== '') {
    return { text: `${Number(s.dm_percent)}% dry matter (silage test)`, basis: 'lab', sourceCode: null };
  }
  const t = DM_TESTS.find((x) => x.id === s.dm_test);
  if (!t) return null;
  return { text: `About ${bandLabel(t.low, t.high)} dry matter (${t.test} test, your estimate)`, basis: 'yard_test', sourceCode: 'S17' };
}

// ---------------------------------------------------------------------------
// What's typical (information only)
// ---------------------------------------------------------------------------
export interface TypicalLine { text: string; sourceCode: string }

export function typicalDm(jurisdiction: Jurisdiction, cut: SilageCut | null): TypicalLine[] {
  const out: TypicalLine[] = [];
  if (jurisdiction === 'NI') {
    const y2025: Record<SilageCut, string> = { 1: '32.8%', 2: '30.8%', 3: '34.8%' };
    if (cut) out.push({ text: `${CUT_LABEL[cut]} in Northern Ireland averaged ${y2025[cut]} dry matter in 2025 (early feed trade samples).`, sourceCode: 'S18' });
    else out.push({ text: 'In Northern Ireland in 2025, first cut averaged 32.8% dry matter, second cut 30.8% and third cut 34.8% (early feed trade samples).', sourceCode: 'S18' });
    if (!cut || cut === 1) out.push({ text: 'In 2022 first cut averaged just 24%, so the average moves a lot from year to year.', sourceCode: 'S19' });
  } else {
    out.push({ text: 'Teagasc puts typical pit silage at about 25% dry matter, and advises wilting to about 30% for a pit.', sourceCode: 'S16' });
  }
  out.push({ text: 'Your own silage can be well above or below this. A squeeze or ball test gives a quick guide; a silage test gives the real figure.', sourceCode: 'S17' });
  return out;
}

// ---------------------------------------------------------------------------
// Pit density (Teagasc's one published figure, S16)
// ---------------------------------------------------------------------------
/** Teagasc: pit silage of about 25% DM is one tonne per 1.39 m³ (S16). */
export const TEAGASC_DENSITY_25DM = Math.round(1000 / 1.39); // 719 kg/m³

/**
 * Whether Teagasc's 25% DM density can be offered for this pit. Only when nothing says the
 * silage is far from 25%: no figure at all, a lab figure that rounds to 25, or a yard-test
 * band that includes 25%. Never offered for bales or other methods.
 */
export function canOfferTeagascDensity(s: { method: string; dm_percent: number | null; dm_test?: string | null }): boolean {
  if (s.method !== 'pit_dimensions') return false;
  if (s.dm_percent !== null && s.dm_percent !== undefined && String(s.dm_percent) !== '') return Math.round(Number(s.dm_percent)) === 25;
  const t = DM_TESTS.find((x) => x.id === s.dm_test);
  if (!t) return true;
  return (t.low === null || t.low <= 25) && (t.high === null || t.high >= 25);
}

export const sourceLink = (code: string) => DM_SOURCES[code];
