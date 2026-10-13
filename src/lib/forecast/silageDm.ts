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

export const SILAGE_DM_RULE_VERSION = 'silage-dm@1.1';

/** published: 'YYYY-MM' or 'YYYY-MM-DD'; empty when the source carries no date */
export interface DmSource { code: string; title: string; publisher: string; url: string; published: string }
export const DM_SOURCES: Record<string, DmSource> = {
  S16: { code: 'S16', title: 'A guide to storing silage and managing effluent collection (Today\'s Farm, May-June 2024)', publisher: 'Teagasc', url: 'https://teagasc.ie/wp-content/uploads/media/website/publications/2024/A-guide-to-storing-silage-and-managing-effluent-collection.pdf', published: '2024-05' },
  S17: { code: 'S17', title: 'Visual Assessment of Silage (factsheet)', publisher: 'Teagasc', url: 'https://teagasc.ie/wp-content/uploads/2025/05/Visual-Assessment-of-Silage-Factsheet.pdf', published: '' },
  S18: { code: 'S18', title: 'First cut silage better quality than in 2024 (feed trade data)', publisher: 'Irish Farmers Journal', url: 'https://www.farmersjournal.ie/more/northern-ireland/first-cut-silage-better-quality-than-in-2024-890435', published: '2025-10-22' },
  S19: { code: 'S19', title: 'Northern Ireland: First-cut silage has average DM of just 24% (United Feeds analysis)', publisher: 'Agriland', url: 'https://www.agriland.ie/farming-news/northern-ireland-first-cut-silage-has-average-dm-of-just-24/', published: '2022-10-26' },
  S20: { code: 'S20', title: 'Winter feed planning (silage conversion factors, Table 1)', publisher: 'DAERA', url: 'https://www.daera-ni.gov.uk/news/winter-feed-planning', published: '2017-09-14' },
  S21: { code: 'S21', title: 'Taking stock of winter forage supplies', publisher: 'Irish Farmers Journal', url: 'https://www.farmersjournal.ie/beef/grass-and-feeding/taking-stock-of-winter-forage-supplies-930599', published: '2026-09-02' }
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

/**
 * Teagasc's 25% density is offered only when nothing at all is known about the dry matter. Once
 * there is a lab figure or a yard test, the density is worked out from it (autoDensity).
 */
export function offerTeagascDensity(s: { method: string; density_kg_m3: number | null; dm_percent: number | null; dm_test?: string | null }): boolean {
  if (s.method !== 'pit_dimensions') return false;
  if (s.density_kg_m3 !== null && s.density_kg_m3 !== undefined && String(s.density_kg_m3) !== '') return false;
  const hasLab = s.dm_percent !== null && s.dm_percent !== undefined && String(s.dm_percent) !== '';
  return !hasLab && !DM_TESTS.some((x) => x.id === s.dm_test);
}

export const sourceLink = (code: string) => DM_SOURCES[code];

// ---------------------------------------------------------------------------
// Density worked out from dry matter (rule silage-dm@1.1)
// ---------------------------------------------------------------------------
/**
 * Fresh tonnes per m³ of pit silage at each dry matter. DAERA's conversion table (S20, 20 to 45%);
 * the Irish Farmers Journal (S21, Sept 2026) gives the same 0.77 and 0.68 and adds 0.81 for very
 * wet 18% silage. Between rows the figure is read off a straight line. Outside 18 to 45% Agri-It
 * has no published figure and asks instead.
 * Teagasc's 25% figure (1 t per 1.39 m³, S16) is higher (719 against 680): the table is the more
 * careful of the two, so a winter plan built on it will not count silage you don't have.
 */
export const DM_DENSITY_TABLE: Array<[dm: number, tPerM3: number, source: 'S20' | 'S21']> = [
  [18, 0.81, 'S21'], [20, 0.77, 'S20'], [25, 0.68, 'S20'], [30, 0.6, 'S20'], [35, 0.54, 'S20'], [40, 0.48, 'S20'], [45, 0.42, 'S20']
];
const DM_MIN = 18;
const DM_MAX = 45;

/** kg of fresh silage per m³ for a dry matter %, or null outside the published range. */
export function densityFromDm(dm: number): number | null {
  if (!Number.isFinite(dm) || dm < DM_MIN || dm > DM_MAX) return null;
  for (let i = 0; i < DM_DENSITY_TABLE.length - 1; i++) {
    const [d0, t0] = DM_DENSITY_TABLE[i];
    const [d1, t1] = DM_DENSITY_TABLE[i + 1];
    if (dm >= d0 && dm <= d1) return Math.round((t0 + ((dm - d0) / (d1 - d0)) * (t1 - t0)) * 1000);
  }
  return null;
}

export interface AutoDensity {
  /** The figure the winter plan uses (the drier, lighter end of a yard-test band, so it never overcounts) */
  kgM3: number;
  /** The wetter end of a yard-test band; same as kgM3 for a lab figure */
  highKgM3: number;
  dmUsed: number;
  basis: 'lab' | 'yard_test';
  /** "30% dry matter" or "a yard test of 20 to 25% dry matter" */
  from: string;
  sources: string[];
}

/**
 * Pit density worked out from the store's own dry matter, when the farmer has not given one.
 * A lab figure gives one density. A yard-test band gives a range: open-ended bands are closed at
 * the edge of the published table (under 20% = 18 to 20%, over 40% = 40 to 45%).
 */
export function autoDensity(s: { method: string; density_kg_m3: number | null; dm_percent: number | null; dm_test?: string | null }): AutoDensity | null {
  if (s.method !== 'pit_dimensions') return null;
  if (s.density_kg_m3 !== null && s.density_kg_m3 !== undefined && String(s.density_kg_m3) !== '') return null;
  const src = (lo: number, hi: number) => {
    const codes = new Set<string>(['S20']);
    if (Math.min(lo, hi) < 20) codes.add('S21');
    return [...codes];
  };
  if (s.dm_percent !== null && s.dm_percent !== undefined && String(s.dm_percent) !== '') {
    const dm = Number(s.dm_percent);
    const kg = densityFromDm(dm);
    if (kg === null) return null;
    return { kgM3: kg, highKgM3: kg, dmUsed: dm, basis: 'lab', from: `${dm}% dry matter`, sources: src(dm, dm) };
  }
  const t = DM_TESTS.find((x) => x.id === s.dm_test);
  if (!t) return null;
  const lo = t.low ?? DM_MIN;
  const hi = t.high ?? DM_MAX;
  const light = densityFromDm(hi);
  const heavy = densityFromDm(lo);
  if (light === null || heavy === null) return null;
  return { kgM3: light, highKgM3: heavy, dmUsed: hi, basis: 'yard_test', from: `a ${t.test} test of ${bandLabel(t.low, t.high)} dry matter`, sources: src(lo, hi) };
}
