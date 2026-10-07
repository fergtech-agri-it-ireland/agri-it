/**
 * Winter forage budget (MVP spec section 5).
 * Evidence hierarchy: measured stores beat acreage estimates; the farm's own
 * usage per head beats published Teagasc allowances. Missing inputs lower
 * confidence or are asked for. They are never filled with invented values.
 */
import type { AnimalClass, AnimalGroup, Confidence, EvidenceSource, Farm, ForageBenchmark, ISODate, SilageStore } from '../types';
import { ANIMAL_CLASS_LABEL } from '../types';
import { daysBetween, hashString, maxISO } from '../format';

export const FORAGE_RULE_VERSION = 'forage-budget@1.0';
const DAYS_PER_MONTH = 30.4;

export interface StoreEstimate {
  id: string;
  name: string;
  tonnes: number | null; // fresh tonnes remaining
  basis: 'measured' | 'planning_estimate';
  explanation: string;
  missing: string | null;
}

export interface GroupDemand {
  id: string;
  name: string;
  heads: number;
  tPerHeadMonth: number | null;
  source: 'farm_history' | 'benchmark' | 'missing';
  sourceLabel: string;
  tPerMonth: number;
}

export interface ForageForecast {
  stores: StoreEstimate[];
  groups: GroupDemand[];
  availableT: number;
  demandTPerMonth: number;
  winterStart: ISODate | null;
  winterEnd: ISODate | null;
  monthsToCover: number | null;
  needT: number | null;
  reservePercent: number;
  needWithReserveT: number | null;
  balanceT: number | null; // + surplus / - deficit, after reserve
  monthsOfCover: number | null;
  status: 'surplus' | 'tight' | 'deficit' | 'incomplete';
  confidence: Confidence;
  reasons: string[];
  missing: string[];
  inputsHash: string;
  inputs: Record<string, unknown>;
}

export function estimateStore(s: SilageStore): StoreEstimate {
  const n = (v: number | null) => (v === null || v === undefined ? null : Number(v));
  const fed = Number(s.fed_out_tonnes ?? 0);
  switch (s.method) {
    case 'pit_dimensions': {
      const [l, w, h, d] = [n(s.length_m), n(s.width_m), n(s.avg_height_m), n(s.density_kg_m3)];
      if (l === null || w === null || h === null) {
        return { id: s.id, name: s.name, tonnes: null, basis: 'measured', explanation: 'Pit size incomplete', missing: `Enter length, width and height for ${s.name}` };
      }
      if (d === null) {
        return { id: s.id, name: s.name, tonnes: null, basis: 'measured', explanation: `${l} × ${w} × ${h} m = ${(l * w * h).toFixed(0)} m³`, missing: `Add silage density for ${s.name} (from your analysis or advisor)` };
      }
      const t = (l * w * h * d) / 1000 - fed;
      return { id: s.id, name: s.name, tonnes: Math.max(0, t), basis: 'measured', explanation: `${l} × ${w} × ${h} m × ${d} kg/m³${fed ? ` − ${fed} t fed` : ''}`, missing: null };
    }
    case 'bale_count': {
      const [c, wkg] = [n(s.bale_count), n(s.bale_weight_kg)];
      if (c === null || wkg === null) {
        return { id: s.id, name: s.name, tonnes: null, basis: 'measured', explanation: 'Bale details incomplete', missing: `Enter bale count and average bale weight for ${s.name}` };
      }
      return { id: s.id, name: s.name, tonnes: Math.max(0, (c * wkg) / 1000 - fed), basis: 'measured', explanation: `${c} bales × ${wkg} kg${fed ? ` − ${fed} t fed` : ''}`, missing: null };
    }
    case 'measured_tonnes': {
      const t = n(s.measured_tonnes);
      if (t === null) return { id: s.id, name: s.name, tonnes: null, basis: 'measured', explanation: '', missing: `Enter tonnes for ${s.name}` };
      return { id: s.id, name: s.name, tonnes: Math.max(0, t - fed), basis: 'measured', explanation: `${t} t measured${fed ? ` − ${fed} t fed` : ''}`, missing: null };
    }
    case 'acreage': {
      const [a, y] = [n(s.acreage), n(s.yield_t_per_acre)];
      if (a === null || y === null) {
        return { id: s.id, name: s.name, tonnes: null, basis: 'planning_estimate', explanation: '', missing: `Enter acres and expected yield for ${s.name}` };
      }
      return { id: s.id, name: s.name, tonnes: Math.max(0, a * y - fed), basis: 'planning_estimate', explanation: `${a} ac × ${y} t/ac (planning estimate, not measured stock)`, missing: null };
    }
  }
}

/**
 * Teagasc publishes one figure for "in-calf heifers and store cattle". Bullocks and other
 * heifers are store cattle, so they use that published figure, and the screen says which
 * figure was used. Every other class without its own figure asks the farmer.
 */
const BENCHMARK_ALIAS: Partial<Record<AnimalClass, AnimalClass>> = { heifer: 'store_cattle', bullock: 'store_cattle' };
/** Pigs, poultry and horses are not fed pit silage, so they are left out of the winter budget. */
const EATS_SILAGE = (c: AnimalClass) => c !== 'pig' && c !== 'poultry' && c !== 'horse';

export function forecastForage(input: {
  farm: Farm; stores: SilageStore[]; groups: AnimalGroup[]; benchmarks: ForageBenchmark[];
  evidence: EvidenceSource[]; today: ISODate; reserveOverride?: number; scenario?: boolean;
}): ForageForecast {
  const { farm, today } = input;
  const reasons: string[] = [];
  const missing: string[] = [];

  const stores = input.stores.map(estimateStore);
  stores.forEach((s) => s.missing && missing.push(s.missing));
  const availableT = stores.reduce((sum, s) => sum + (s.tonnes ?? 0), 0);

  const latestBench = new Map<string, ForageBenchmark>();
  for (const b of input.benchmarks) {
    const cur = latestBench.get(b.animal_class);
    if (b.valid_from <= today && (!cur || b.valid_from > cur.valid_from)) latestBench.set(b.animal_class, b);
  }
  const srcTitle = (code: string) => {
    const e = input.evidence.find((x) => x.code === code);
    return e ? `${e.publisher} (${code})` : code;
  };

  const groups: GroupDemand[] = input.groups
    .filter((g) => !g.archived && g.housed && g.head_count > 0 && EATS_SILAGE(g.animal_class))
    .map((g) => {
      if (g.forage_t_per_head_month !== null && g.forage_t_per_head_month !== undefined) {
        const t = Number(g.forage_t_per_head_month);
        return { id: g.id, name: g.name, heads: g.head_count, tPerHeadMonth: t, source: 'farm_history' as const, sourceLabel: 'Your farm usage', tPerMonth: t * g.head_count };
      }
      const alias = BENCHMARK_ALIAS[g.animal_class];
      const b = latestBench.get(g.animal_class) ?? (alias ? latestBench.get(alias) : undefined);
      if (b) {
        const t = Number(b.fresh_tonnes_per_month);
        const as = b.animal_class !== g.animal_class ? `, ${ANIMAL_CLASS_LABEL[b.animal_class].toLowerCase()} figure` : '';
        return { id: g.id, name: g.name, heads: g.head_count, tPerHeadMonth: t, source: 'benchmark' as const, sourceLabel: `Published allowance${as}, ${srcTitle(b.source_code)}`, tPerMonth: t * g.head_count };
      }
      missing.push(`Monthly silage use per head for ${g.name} (no published allowance for ${ANIMAL_CLASS_LABEL[g.animal_class].toLowerCase()})`);
      return { id: g.id, name: g.name, heads: g.head_count, tPerHeadMonth: null, source: 'missing' as const, sourceLabel: 'Needs your figure', tPerMonth: 0 };
    });
  const demandTPerMonth = groups.reduce((s, g) => s + g.tPerMonth, 0);

  const winterStart = farm.housing_start ? maxISO(farm.housing_start, today) : null;
  const winterEnd = farm.turnout_date;
  let monthsToCover: number | null = null;
  if (!farm.housing_start || !farm.turnout_date) missing.push('Housing and turnout dates');
  else if (winterStart && winterEnd && winterEnd > winterStart) monthsToCover = daysBetween(winterStart, winterEnd) / DAYS_PER_MONTH;
  else monthsToCover = 0;

  const reservePercent = input.reserveOverride ?? farm.forage_reserve_percent;
  const needT = monthsToCover !== null ? demandTPerMonth * monthsToCover : null;
  const needWithReserveT = needT !== null ? needT * (1 + reservePercent / 100) : null;
  const balanceT = needWithReserveT !== null ? availableT - needWithReserveT : null;
  const monthsOfCover = demandTPerMonth > 0 ? availableT / demandTPerMonth : null;

  let status: ForageForecast['status'] = 'incomplete';
  if (balanceT !== null && needT !== null && stores.length > 0 && demandTPerMonth > 0) {
    if (availableT < needT) status = 'deficit';
    else if (balanceT < 0) status = 'tight'; // covers the winter but eats into the reserve
    else status = 'surplus';
  }

  // Confidence
  let level = 0;
  const lower = (to: number, why: string) => { level = Math.max(level, to); reasons.push(why); };
  if (stores.length === 0) lower(2, 'No silage or bales recorded.');
  if (stores.some((s) => s.basis === 'planning_estimate' && s.tonnes !== null)) lower(2, 'Some stock is an acreage × yield estimate, not measured.');
  if (stores.some((s) => s.tonnes === null)) lower(2, 'Some stores are missing measurements.');
  if (groups.some((g) => g.source === 'missing')) lower(2, 'Some groups have no usage figure.');
  if (groups.some((g) => g.source === 'benchmark')) lower(1, 'Uses published planning allowances. Your own farm usage is more accurate.');
  if (monthsToCover === null) lower(2, 'Housing and turnout dates are not set.');
  const confidence: Confidence = input.scenario ? 'scenario' : (['high', 'medium', 'low'] as const)[level];

  const inputs = {
    rule_version: FORAGE_RULE_VERSION, today, reservePercent,
    stores: stores.map((s) => [s.id, s.tonnes, s.basis]),
    groups: groups.map((g) => [g.id, g.heads, g.tPerHeadMonth, g.source]),
    winter: [winterStart, winterEnd]
  };
  return {
    stores, groups, availableT, demandTPerMonth, winterStart, winterEnd, monthsToCover, needT,
    reservePercent, needWithReserveT, balanceT, monthsOfCover, status, confidence, reasons, missing,
    inputsHash: hashString(JSON.stringify(inputs)), inputs
  };
}
