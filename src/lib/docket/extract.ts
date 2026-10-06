/**
 * Docket reading rules (rule version docket-read@1.0).
 *
 * Takes the text lines a reader found on a photo (on-phone OCR now, a server reader
 * later) and works out what the document is and which values it shows. Pure: no
 * browser APIs, so it is unit-tested and gives the same answer whichever reader ran.
 *
 * Rules that matter:
 * - A value is only returned if it was found in the text. Nothing is guessed.
 * - Each value says how sure it is (high, medium, low) and which line it came from.
 * - Arithmetic on the document itself (quantity x price = total, net + VAT = total)
 *   can raise or lower confidence, and can settle a unit the reader smudged.
 * - Low-confidence values are offered as suggestions, never filled in.
 */
import type { CostCategory, ISODate } from '../types';
import { daysBetween } from '../format';

export const DOCKET_RULE = 'docket-read@1.0';

export type ReadConfidence = 'high' | 'medium' | 'low';
export type DocKind = 'docket' | 'invoice' | 'receipt' | 'unknown';

/** One line of text from the reader, with its own 0 to 100 confidence. */
export interface OcrLine { text: string; confidence: number }

export interface Read<T> {
  value: T;
  confidence: ReadConfidence;
  /** The line of the photo the value was read from, so the farmer can check it. */
  from: string;
  note?: string;
}

export interface MatchContext {
  suppliers: { id: string; name: string; network?: string | null }[];
  products: { id: string; name: string; supplier_id: string | null }[];
  /** Names the farmer has typed in "Paid to" before, in their own spelling. */
  payees: string[];
  today: ISODate;
}

export interface DocketRead {
  rule: typeof DOCKET_RULE;
  reader: string;
  kind: DocKind;
  kindConfidence: ReadConfidence;
  isFeed: boolean;
  /** Which form opens: a feed delivery, or "Paid a bill". */
  route: 'delivery' | 'cost';
  supplier?: Read<{ text: string; supplierId: string | null; payee: string | null }>;
  date?: Read<ISODate>;
  product?: Read<{ text: string; feedProductId: string | null; name: string | null }>;
  quantity?: Read<{ kg: number; shown: string }>;
  pricePerTonne?: Read<number>;
  total?: Read<number>;
  net?: Read<number>;
  vat?: Read<{ eur: number; ratePercent: number | null }>;
  docNumber?: Read<string>;
  costCategory?: Read<CostCategory>;
  /** Arithmetic checks done on the document's own figures. */
  checks: { ok: boolean; text: string }[];
  /** Things seen but not trusted enough to fill in: shown as "tap to use". */
  suggestions: { field: 'quantity' | 'date' | 'pricePerTonne' | 'total'; text: string; value: number | string }[];
  /** Fields the form needs that could not be read, in plain words. */
  missing: string[];
  /** Overall reader confidence for the page, 0 to 100. */
  pageConfidence: number;
}

export const KIND_LABEL: Record<DocKind, string> = {
  docket: 'Delivery docket',
  invoice: 'Supplier invoice',
  receipt: 'Bill or receipt',
  unknown: 'Document'
};

export function kindLabel(r: Pick<DocketRead, 'kind' | 'isFeed'>): string {
  if (r.kind === 'docket') return r.isFeed ? 'Feed delivery docket' : 'Delivery docket';
  if (r.kind === 'invoice') return r.isFeed ? 'Feed invoice' : 'Supplier invoice';
  return KIND_LABEL[r.kind];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Lower case, accents off ("Tirlán" reads as "tirlan"), tidy spaces. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Fix letters the reader mistakes for digits, only inside things that are clearly numbers. */
function fixDigits(token: string): string {
  if (!/\d/.test(token) || !/^[\dOoIlS,.]+$/.test(token) || !/[.,]/.test(token)) return token;
  return token.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5');
}

export interface NumberToken { value: number; raw: string; index: number; end: number; percent: boolean; after: string }

/** Every number on a line, with what follows it (so "16%" and "3.00t" are told apart). */
export function numbersIn(line: string): NumberToken[] {
  const fixed = line.split(/(\s+)/).map(fixDigits).join('');
  const out: NumberToken[] = [];
  const re = /(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+,\d{2}(?!\d)|\d+)(?![\d])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fixed))) {
    const raw = m[1];
    let value: number;
    if (/^\d+,\d{2}$/.test(raw)) value = Number(raw.replace(',', '.')); // 202,60
    else value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const after = fixed.slice(m.index + raw.length, m.index + raw.length + 12);
    out.push({ value, raw, index: m.index, end: m.index + raw.length, percent: /^\s*%/.test(after), after });
  }
  return out;
}

/** Money values on a line: no percentages, no dates, no long reference numbers. */
function amountsIn(line: string): NumberToken[] {
  const n = norm(line);
  if (/\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/.test(n) && !/\d+\.\d{2}\b/.test(n.replace(/\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g, ''))) return [];
  return numbersIn(line.replace(/\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g, ' '))
    .filter((t) => !t.percent && (t.raw.includes('.') || t.raw.includes(',') || /(€|eur)\s*$/i.test(line.slice(0, t.index))))
    .filter((t) => t.raw.replace(/\D/g, '').length <= 9);
}

function ocrConfidence(c: number): ReadConfidence {
  return c >= 85 ? 'high' : c >= 65 ? 'medium' : 'low';
}
const RANK: Record<ReadConfidence, number> = { low: 0, medium: 1, high: 2 };
function minConf(...cs: ReadConfidence[]): ReadConfidence {
  return cs.reduce((a, c) => (RANK[c] < RANK[a] ? c : a), 'high' as ReadConfidence);
}
function atLeast(c: ReadConfidence, floor: ReadConfidence): ReadConfidence {
  return RANK[c] >= RANK[floor] ? c : floor;
}
const money = (n: number) => `€${n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * tol);

// ---------------------------------------------------------------------------
// What kind of document
// ---------------------------------------------------------------------------

const FEED_WORDS = /\b(nuts?|ration|meal|pellets?|crunch|coarse|barley|maize|soya|soybean|beet|pulp|calf|dairy|beef|finisher|weanling|starter|protein|feed|molasses|rolled|distillers|gluten|cubes?|blend|tmr)\b/;
const DOCKET_WORDS = /\b(docket|delivery note|delivery ticket|dispatch|received by|haulier|weighbridge|delivered to|driver)\b/g;
const INVOICE_WORDS = /\b(sales invoice|tax invoice|invoice date|total due|amount due|payment due|due date|statement|credit terms|net amount)\b|^\s*invoice\s*$/g;
const RECEIPT_WORDS = /\b(receipt|paid|thank you|card|cash|change|visa|mastercard|contactless|debit)\b/g;

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

// ---------------------------------------------------------------------------
// Matching against the farm's own suppliers, payees and feeds
// ---------------------------------------------------------------------------

const NAME_STOP = new Set(['agri', 'agribusiness', 'business', 'farm', 'farms', 'co', 'op', 'coop', 'co-op', 'ltd', 'limited', 'the', 'and', '&', 'feeds', 'feed',
  'dairies', 'dairy', 'society', 'cooperative', 'group', 'stores', 'store', 'plc', 'teo', 'valley', 'county', 'irish', 'ireland', 'farmers', 'supplies',
  'services', 'vets', 'veterinary', 'clinic', 'hardware', 'mills', 'sales', 'of', 'st', 'main',
  // Places are on every docket (customer and branch addresses), so they never identify a supplier
  'carlow', 'cavan', 'clare', 'cork', 'donegal', 'dublin', 'galway', 'kerry', 'kildare', 'kilkenny', 'laois', 'leitrim', 'limerick',
  'longford', 'louth', 'mayo', 'meath', 'monaghan', 'offaly', 'roscommon', 'sligo', 'tipperary', 'tipp', 'waterford', 'westmeath',
  'wexford', 'wicklow', 'antrim', 'armagh', 'down', 'fermanagh', 'londonderry', 'derry', 'tyrone']);

function nameTokens(s: string): string[] {
  return norm(s).replace(/[^a-z0-9& -]/g, ' ').split(/[\s-]+/).filter((t) => t.length > 1 && !NAME_STOP.has(t));
}

/** Levenshtein distance capped at 2 (enough for one smudged letter). */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function tokenSeen(tok: string, words: string[]): boolean {
  return words.some((w) => w === tok || (tok.length >= 6 && w.length >= 5 && editDistance(tok, w) <= 1));
}

/** Score how well a known name appears in a piece of text: share of its distinctive words found. */
export function nameScore(name: string, text: string): number {
  const toks = nameTokens(name).filter((t) => t.length >= 4 || /\d/.test(t));
  if (!toks.length) return 0;
  const words = norm(text).replace(/[^a-z0-9& ]/g, ' ').split(/\s+/);
  return toks.filter((t) => tokenSeen(t, words)).length / toks.length;
}

export function matchSupplier(lines: OcrLine[], ctx: MatchContext): { id: string; name: string; line: OcrLine; score: number } | null {
  let best: { id: string; name: string; line: OcrLine; score: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const s of ctx.suppliers) {
      const score = Math.max(nameScore(s.name, line.text), s.network ? nameScore(s.network, line.text) : 0) * (i < 8 ? 1 : 0.8);
      if (score >= 0.99 * (i < 8 ? 1 : 0.8) && (!best || score > best.score)) best = { id: s.id, name: s.name, line, score };
      else if (score >= 0.5 && i < 8 && (!best || score > best.score)) best = { id: s.id, name: s.name, line, score };
    }
  }
  return best;
}

export function matchPayee(text: string, payees: string[]): string | null {
  let best: { p: string; score: number } | null = null;
  for (const p of payees) {
    const s = nameScore(p, text);
    if (s >= 0.6 && (!best || s > best.score)) best = { p, score: s };
  }
  return best?.p ?? null;
}

function productTokens(s: string): string[] {
  return norm(s).replace(/(\d+(?:\.\d+)?)\s*%/g, ' $1% ').replace(/[^a-z0-9%. ]/g, ' ').split(/\s+/)
    .filter((t) => t && !['bulk', 'bag', 'bags', 'cp', 'kg', 't', 'per', 'tonne', 'x', 'the'].includes(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/** Match a product line to one of the farm's feeds. Protein percentages must agree. */
export function matchProduct(line: string, products: MatchContext['products']): { id: string; name: string; score: number } | null {
  const have = productTokens(line);
  const havePct = have.filter((t) => t.endsWith('%'));
  let best: { id: string; name: string; score: number } | null = null;
  for (const p of products) {
    const want = productTokens(p.name);
    const words = want.filter((t) => !/\d/.test(t));
    const pct = want.filter((t) => t.endsWith('%'));
    if (!words.length) continue;
    if (pct.length && havePct.length && !pct.every((x) => havePct.includes(x))) continue; // 16% is not 14%
    const found = words.filter((w) => have.some((h) => h === w || (w.length >= 5 && editDistance(w, h) <= 1))).length;
    let score = found / words.length;
    if (pct.length && !havePct.length) score *= 0.75; // percentage not visible: less sure
    if (score >= 0.6 && (!best || score > best.score)) best = { id: p.id, name: p.name, score };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoOf(y: number, m: number, d: number): ISODate | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31/02 is not a date
  return dt.toISOString().slice(0, 10);
}

/** Dates as Irish paperwork writes them: day first. */
export function datesIn(line: string): ISODate[] {
  const n = norm(line);
  const out: ISODate[] = [];
  for (const m of n.matchAll(/\b(\d{1,2})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{4}|\d{2})\b/g)) {
    const iso = isoOf(Number(m[3]), Number(m[2]), Number(m[1]));
    if (iso) out.push(iso);
  }
  for (const m of n.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4}|\d{2})\b/g)) {
    const mi = MONTHS.indexOf(m[2]);
    const iso = mi >= 0 ? isoOf(Number(m[3]), mi + 1, Number(m[1])) : null;
    if (iso) out.push(iso);
  }
  for (const m of n.matchAll(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[1]);
    const iso = mi >= 0 ? isoOf(Number(m[3]), mi + 1, Number(m[2])) : null;
    if (iso) out.push(iso);
  }
  return out;
}

function readDate(lines: OcrLine[], today: ISODate): Read<ISODate> | undefined {
  let best: { iso: ISODate; rank: number; line: OcrLine } | null = null;
  for (const line of lines) {
    const n = norm(line.text);
    if (/\b(due|expiry|expires|valid until|best before)\b/.test(n)) continue;
    const rank = /\b(delivery date|delivered|date of delivery|despatch date|dispatch date)\b/.test(n) ? 3 : /\b(invoice date|tax point|date)\b/.test(n) ? 2 : 1;
    for (const iso of datesIn(line.text)) if (!best || rank > best.rank) best = { iso, rank, line };
  }
  if (!best) return undefined;
  let confidence = minConf(ocrConfidence(best.line.confidence), best.rank >= 2 ? 'high' : 'medium');
  let note: string | undefined;
  const age = daysBetween(best.iso, today);
  if (age < -3) { confidence = 'low'; note = 'This date is in the future.'; }
  else if (age > 120) { confidence = 'low'; note = 'This date is more than four months ago.'; }
  return { value: best.iso, confidence, from: best.line.text.trim(), note };
}

function readDocNumber(lines: OcrLine[]): Read<string> | undefined {
  let best: { v: string; rank: number; line: OcrLine } | null = null;
  for (const line of lines) {
    const m = line.text.match(/\b(docket|delivery note|invoice|inv|receipt|ticket|doc|document|ref|reference)\.?\s*(?:no\.?|number|num|#)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)\b/i);
    if (!m || /account|a\/c/i.test(line.text.slice(0, m.index ?? 0))) continue;
    if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(m[2])) continue; // that's a date
    const rank = /docket|invoice|inv|delivery note|receipt|ticket/i.test(m[1]) ? 2 : 1;
    if (!best || rank > best.rank) best = { v: m[2].toUpperCase(), rank, line };
  }
  return best ? { value: best.v, confidence: ocrConfidence(best.line.confidence), from: best.line.text.trim() } : undefined;
}

/** The last money amount on a labelled line, or on the next line when a column wrapped. */
function labelledAmount(lines: OcrLine[], i: number): { value: number; line: OcrLine } | null {
  const own = amountsIn(lines[i].text);
  if (own.length) return { value: own[own.length - 1].value, line: lines[i] };
  const next = lines[i + 1];
  if (next && !/[a-z]{3}/i.test(next.text.replace(/eur/gi, ''))) {
    const a = amountsIn(next.text);
    if (a.length === 1) return { value: a[0].value, line: { text: `${lines[i].text} ${next.text}`, confidence: Math.min(lines[i].confidence, next.confidence) } };
  }
  return null;
}

function readTotal(lines: OcrLine[]): Read<number> | undefined {
  let best: { value: number; rank: number; line: OcrLine } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i].text);
    if (/\bsub\s*-?\s*total\b|total\s*(qty|quantity|weight|kg|tonnes|items)/.test(n)) continue;
    const rank = /\b(total due|amount due|grand total|balance due|total payable|amount payable|total to pay|to pay)\b/.test(n) ? 3
      : /\btotal\b/.test(n) ? 2 : /\b(value|amount)\b/.test(n) && !/\bvat\b/.test(n) ? 1 : 0;
    if (!rank) continue;
    const a = labelledAmount(lines, i);
    if (a && (!best || rank >= best.rank)) best = { value: a.value, rank, line: a.line };
  }
  if (!best) return undefined;
  return { value: best.value, confidence: minConf(ocrConfidence(best.line.confidence), best.rank >= 2 ? 'high' : 'medium'), from: best.line.text.trim() };
}

function readNet(lines: OcrLine[]): Read<number> | undefined {
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i].text);
    if (!/\b(net|nett|sub\s*-?\s*total|goods value|goods total)\b/.test(n) || /\b(kg|weight|tonnes)\b/.test(n)) continue;
    const a = labelledAmount(lines, i);
    if (a) return { value: a.value, confidence: ocrConfidence(a.line.confidence), from: a.line.text.trim() };
  }
  return undefined;
}

function readVat(lines: OcrLine[]): Read<{ eur: number; ratePercent: number | null }> | undefined {
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i].text);
    if (!/\bvat\b/.test(n) || /\bvat (no|number|reg)/.test(n)) continue;
    const rate = numbersIn(lines[i].text).find((t) => t.percent)?.value ?? null;
    const a = labelledAmount(lines, i);
    if (a) return { value: { eur: a.value, ratePercent: rate }, confidence: ocrConfidence(a.line.confidence), from: a.line.text.trim() };
  }
  return undefined;
}

const UNIT_RE = /^\s*(tonnes?|tons?|tns?|mt|t|kgs?|kilos?)\b/i;
function unitFactor(u: string): number {
  return /^k/i.test(u) ? 1 : 1000;
}

interface QtyFind { kg: number | null; number: number; shown: string; line: OcrLine; unitRead: boolean }

/** Quantity on a product line (or a labelled Qty line). Unit-less numbers are returned with kg null. */
function findQuantity(line: OcrLine, exclude: number[]): QtyFind | null {
  const text = line.text;
  // "40 x 25kg" or "40 bags x 25 kg"
  const bags = norm(text).match(/\b(\d+)\s*(?:bags?|no\.?)?\s*(?:x|@|of)\s*(\d+(?:\.\d+)?)\s*kg\b/);
  if (bags) {
    const kg = Number(bags[1]) * Number(bags[2]);
    return { kg, number: kg, shown: `${bags[1]} x ${bags[2]} kg`, line, unitRead: true };
  }
  const nums = numbersIn(text).filter((t) => !t.percent);
  for (const t of nums) {
    const u = t.after.match(UNIT_RE);
    if (u && t.value > 0) return { kg: t.value * unitFactor(u[1]), number: t.value, shown: `${t.raw} ${u[1]}`, line, unitRead: true };
  }
  // Unit smudged or in its own column: keep the number, settle the unit later from the sums
  const bare = nums.filter((t) => t.value > 0 && !exclude.some((x) => near(x, t.value, 0.001)));
  if (bare.length) return { kg: null, number: bare[0].value, shown: bare[0].raw, line, unitRead: false };
  return null;
}

function costCategoryOf(text: string, header: string, lines: OcrLine[]): Read<CostCategory> | undefined {
  const rules: [CostCategory, RegExp][] = [
    ['vet_medicine', /\b(vet|vets|veterinary|clinic|medicines?|vaccines?|dose|dosing|injection|antibiotic|calving|tb test|herd test|mastitis)\b/],
    ['fertiliser', /\b(fertili[sz]er|can 27|urea|npk|lime|granular|18-6-12|10-10-20|0-7-30|27% ?n|pasture sward|super phosphate)\b/],
    ['contractor', /\b(contractor|contracting|silage cutting|slurry|spreading|baling|bales? wrapped|hedge ?cutting|mowing|ploughing|harvesting|agitating)\b/],
    ['machinery_fuel', /\b(diesel|fuel|petrol|green diesel|marked gas oil|tyres?|parts|repairs?|service|filters?|hydraulic|lubricants?|adblue)\b/],
    ['utilities', /\b(esb|electricity|electric ireland|energy|water charges|broadband|phone|mobile|kwh)\b/],
    ['feed', FEED_WORDS]
  ];
  const n = norm(text);
  const h = norm(header);
  let best: { c: CostCategory; score: number } | null = null;
  for (const [c, re] of rules) {
    const score = countMatches(n, new RegExp(re.source, 'g')) + 2 * countMatches(h, new RegExp(re.source, 'g'));
    if (score > 0 && (!best || score > best.score)) best = { c, score };
  }
  if (!best) return undefined;
  const re = rules.find(([c]) => c === best!.c)![1];
  const line = lines.find((l) => re.test(norm(l.text)));
  return { value: best.c, confidence: best.score >= 3 ? 'high' : 'medium', from: line?.text ?? header, note: 'Worked out from the words on it' };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function readDocket(rawLines: OcrLine[], ctx: MatchContext, reader: string): DocketRead {
  const lines = rawLines.map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), confidence: l.confidence })).filter((l) => l.text.length > 0);
  const all = norm(lines.map((l) => l.text).join('\n'));
  const pageConfidence = lines.length ? Math.round(lines.reduce((s, l) => s + l.confidence * l.text.length, 0) / lines.reduce((s, l) => s + l.text.length, 0)) : 0;
  const checks: DocketRead['checks'] = [];
  const suggestions: DocketRead['suggestions'] = [];

  // Supplier first: its header lines are not product lines
  const sm = matchSupplier(lines, ctx);
  const headerIdx = lines.findIndex((l, i) => i < 3 && /[a-z]{3}/i.test(l.text) && !/\d/.test(l.text)
    && !/\b(invoice|receipt|docket|delivery|statement|date|no\.?|number|page)\b/i.test(l.text) && (l.text.match(/[a-z]/gi)?.length ?? 0) / l.text.length > 0.6);
  const header = headerIdx >= 0 ? lines[headerIdx] : null;
  let supplier: DocketRead['supplier'];
  if (sm) {
    supplier = { value: { text: sm.line.text, supplierId: sm.id, payee: matchPayee(sm.name, ctx.payees) ?? sm.name },
      confidence: sm.score >= 0.99 ? minConf('high', ocrConfidence(sm.line.confidence) === 'low' ? 'medium' : 'high') : 'medium', from: sm.line.text, note: `Matched to ${sm.name}` };
  } else if (header) {
    const payee = matchPayee(header.text, ctx.payees);
    supplier = { value: { text: header.text, supplierId: null, payee: payee ?? header.text }, confidence: payee ? minConf('high', ocrConfidence(header.confidence)) : minConf('medium', ocrConfidence(header.confidence)), from: header.text,
      note: payee ? `Matched to "${payee}" from your past bills` : 'A new name, not one of your suppliers or past payees' };
  }

  // Product line: a line with feed words and a number, not the header or a column title
  const supplierLines = new Set([sm?.line.text, header?.text].filter(Boolean));
  const productIdx = lines.findIndex((l) => !supplierLines.has(l.text) && FEED_WORDS.test(norm(l.text)) && numbersIn(l.text).some((t) => !t.percent && t.value > 0)
    && !/\b(product|description|item)\b.*\b(qty|quantity|amount)\b/i.test(l.text));
  const productLine = productIdx >= 0 ? lines[productIdx] : null;
  const isFeed = !!productLine || (FEED_WORDS.test(norm(lines.slice(0, 4).map((l) => l.text).join(' '))) && /\b(feed|ration|nut)\b/.test(all));

  // Kind
  const docket = countMatches(all, DOCKET_WORDS);
  const invoice = countMatches(all, INVOICE_WORDS) + (/\binvoice\b/.test(all) ? 0.5 : 0);
  const receipt = countMatches(all, RECEIPT_WORDS);
  let kind: DocKind = 'unknown';
  const top = Math.max(docket, invoice, receipt);
  if (top > 0) kind = docket === top ? 'docket' : invoice === top ? 'invoice' : 'receipt';
  const second = [docket, invoice, receipt].sort((a, b) => b - a)[1];
  const kindConfidence: ReadConfidence = top === 0 ? 'low' : top - second >= 1.5 ? 'high' : top > second ? 'medium' : 'low';

  // Money
  const total = readTotal(lines);
  const net = readNet(lines);
  const vat = readVat(lines);

  // Price per tonne: a labelled line, or the rate on the product line
  let pricePerTonne: Read<number> | undefined;
  for (const line of lines) {
    const n = norm(line.text);
    if (!/(per\s*(tonne|ton|t)\b|\/\s*(t|tn|tonne|ton)\b|price\s*\/?\s*t\b|\brate\b|€\s*\/\s*t)/.test(n) || /\bvat\b/.test(n)) continue;
    const a = amountsIn(line.text).filter((t) => t.value >= 50 && t.value <= 3000);
    if (a.length) { pricePerTonne = { value: a[0].value, confidence: ocrConfidence(line.confidence), from: line.text }; break; }
  }

  // Quantity
  let product: DocketRead['product'];
  let quantity: DocketRead['quantity'];
  if (productLine) {
    const pm = matchProduct(productLine.text, ctx.products);
    const firstQty = numbersIn(productLine.text).find((t) => !t.percent);
    const name = (firstQty ? productLine.text.slice(0, firstQty.index) : productLine.text).trim() || productLine.text;
    product = { value: { text: name, feedProductId: pm?.id ?? null, name: pm?.name ?? null }, confidence: pm ? minConf(pm.score >= 0.99 ? 'high' : 'medium', ocrConfidence(productLine.confidence)) : 'medium',
      from: productLine.text, note: pm ? `Matched to your ${pm.name}` : 'Not one of your feeds yet' };
    const known = [pricePerTonne?.value, total?.value, net?.value].filter((x): x is number => x !== undefined);
    const q = findQuantity(productLine, known);
    // Rate and amount written on the product line itself: "2.50t 388.00 970.00"
    if (q?.kg && !pricePerTonne) {
      const rest = amountsIn(productLine.text).filter((t) => t.value >= 50 && t.value <= 3000 && t.raw !== q.shown.split(' ')[0]);
      const tonnes = q.kg / 1000;
      const amounts = amountsIn(productLine.text).map((t) => t.value);
      const rate = rest.find((r) => amounts.some((a) => near(tonnes * r.value, a)));
      if (rate) pricePerTonne = { value: rate.value, confidence: ocrConfidence(productLine.confidence), from: productLine.text };
    }
    const money = net?.value ?? total?.value;
    if (q && q.kg !== null) {
      quantity = { value: { kg: q.kg, shown: q.shown }, confidence: ocrConfidence(q.line.confidence), from: q.line.text };
    } else if (q && pricePerTonne && money !== undefined) {
      // The unit was not legible: let the document's own sums decide, or leave it blank
      const t = money / pricePerTonne.value;
      if (near(t, q.number)) {
        quantity = { value: { kg: q.number * 1000, shown: `${q.shown} t` }, confidence: 'medium', from: q.line.text, note: 'Unit worked out from price and value' };
      } else if (near(t * 1000, q.number)) {
        quantity = { value: { kg: q.number, shown: `${q.shown} kg` }, confidence: 'medium', from: q.line.text, note: 'Unit worked out from price and value' };
      } else {
        suggestions.push({ field: 'quantity', text: `Saw ${q.shown} but couldn't read the unit`, value: q.number });
      }
    } else if (q) {
      suggestions.push({ field: 'quantity', text: `Saw ${q.shown} but couldn't read the unit`, value: q.number });
    }
  }
  // A labelled quantity line ("Qty: 3.00 t", "Net weight 3,000 kg") if the product line had none
  if (!quantity) {
    for (const line of lines) {
      if (!/\b(qty|quantity|nett? weight|tonnage|weight)\b/i.test(line.text)) continue;
      const q = findQuantity(line, []);
      if (q?.kg) { quantity = { value: { kg: q.kg, shown: q.shown }, confidence: minConf('medium', ocrConfidence(line.confidence)), from: line.text }; break; }
    }
  }

  // Checks on the document's own figures
  if (quantity && pricePerTonne && (net || total)) {
    const goods = net ?? total!;
    const expect = (quantity.value.kg / 1000) * pricePerTonne.value;
    if (near(expect, goods.value)) {
      checks.push({ ok: true, text: `${quantity.value.kg / 1000} t x ${money(pricePerTonne.value)}/t = ${money(expect)}, matches the ${net ? 'net' : 'total'}` });
      quantity.confidence = atLeast(quantity.confidence, 'medium');
      pricePerTonne.confidence = atLeast(pricePerTonne.confidence, 'medium');
      goods.confidence = atLeast(goods.confidence, 'medium');
    } else {
      checks.push({ ok: false, text: `Quantity x price is ${money(expect)}, but the ${net ? 'net' : 'total'} reads ${money(goods.value)}. Check these.` });
      quantity.confidence = minConf(quantity.confidence, 'medium');
      pricePerTonne.confidence = 'low';
      goods.confidence = minConf(goods.confidence, 'medium');
    }
  }
  if (net && vat && total) {
    if (near(net.value + vat.value.eur, total.value, 0.002)) {
      checks.push({ ok: true, text: `Net ${money(net.value)} + VAT ${money(vat.value.eur)} = total ${money(total.value)}` });
      total.confidence = atLeast(total.confidence, 'medium');
      vat.confidence = atLeast(vat.confidence, 'medium');
    } else {
      checks.push({ ok: false, text: `Net + VAT doesn't equal the total (${money(net.value + vat.value.eur)} vs ${money(total.value)}). Check the total.` });
      total.confidence = 'low';
    }
  }

  const date = readDate(lines, ctx.today);
  const docNumber = readDocNumber(lines);
  const route: DocketRead['route'] = isFeed ? 'delivery' : 'cost';
  const costCategory = route === 'cost' ? costCategoryOf(all, header?.text ?? '', lines) : undefined;

  // Low-confidence values are never filled in; offer them instead
  if (date?.confidence === 'low') suggestions.push({ field: 'date', text: `Date might be ${date.value}${date.note ? ` (${date.note.toLowerCase().replace(/\.$/, '')})` : ''}`, value: date.value });
  if (route === 'delivery' && !quantity && pricePerTonne && pricePerTonne.confidence !== 'low' && (net ?? total) && !suggestions.some((s) => s.field === 'quantity')) {
    const t = Math.round(((net ?? total)!.value / pricePerTonne.value) * 100) / 100;
    suggestions.push({ field: 'quantity', text: `Value ÷ price per tonne gives ${t} t`, value: t * 1000 });
  }

  const missing: string[] = [];
  const need: [string, unknown][] = route === 'delivery'
    ? [['feed', product?.value.feedProductId], ['quantity', quantity], ['delivery date', date && date.confidence !== 'low'], ['supplier', supplier], ['price', pricePerTonne ?? total]]
    : [['amount', total ?? net], ['date', date && date.confidence !== 'low'], ['who it was paid to', supplier], ['what it was for', costCategory]];
  for (const [label, v] of need) if (!v) missing.push(label);

  return {
    rule: DOCKET_RULE, reader, kind, kindConfidence, isFeed, route,
    supplier, date, product, quantity, pricePerTonne, total, net, vat, docNumber, costCategory,
    checks, suggestions, missing, pageConfidence
  };
}

/** Only values the farmer can rely on are filled in: high or medium, never low. */
export function usable<T>(r: Read<T> | undefined): T | undefined {
  return r && r.confidence !== 'low' ? r.value : undefined;
}
