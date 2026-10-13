import { describe, expect, it } from 'vitest';
import { autoDensity, bandLabel, canOfferTeagascDensity, densityFromDm, DM_SOURCES, DM_TESTS, dmSummary, offerTeagascDensity, TEAGASC_DENSITY_25DM, typicalDm } from './silageDm';
import { estimateStore, forecastForage } from './forage';
import type { Farm, SilageStore } from '../types';

const pit = (x: Partial<SilageStore> = {}): SilageStore => ({
  id: 'p', farm_id: 'f', name: 'Main pit', method: 'pit_dimensions', acreage: null, yield_t_per_acre: null,
  length_m: 30, width_m: 10, avg_height_m: 2, density_kg_m3: null, bale_count: null, bale_weight_kg: null, measured_tonnes: null,
  dm_percent: null, dmd_percent: null, crude_protein_percent: null, ph: null, measured_on: '2026-10-11', fed_out_tonnes: 0, notes: null, ...x
});

describe('silage dry matter help', () => {
  it('yard tests give the Teagasc bands, nothing more exact', () => {
    expect(DM_TESTS.filter((t) => t.test === 'squeeze').map((t) => bandLabel(t.low, t.high))).toEqual(['under 20%', '20 to 25%', '25 to 30%']);
    expect(DM_TESTS.filter((t) => t.test === 'ball').map((t) => bandLabel(t.low, t.high))).toEqual(['under 25%', '25 to 30%', '30 to 40%', 'over 40%']);
  });

  it('a lab figure always wins over a yard test, and both say where they came from', () => {
    expect(dmSummary({ dm_percent: 28.5, dm_test: 'ball_30_40' })).toMatchObject({ basis: 'lab', text: '28.5% dry matter (silage test)' });
    expect(dmSummary({ dm_percent: null, dm_test: 'squeeze_20_25' })).toMatchObject({ basis: 'yard_test', sourceCode: 'S17', text: 'About 20 to 25% dry matter (squeeze test, your estimate)' });
    expect(dmSummary({ dm_percent: null, dm_test: null })).toBeNull();
    expect(dmSummary({ dm_percent: null, dm_test: 'made_up' })).toBeNull();
  });

  it('typical figures match the farm\'s side of the border and always name a source', () => {
    const roi = typicalDm('ROI', 1);
    expect(roi[0].text).toContain('about 25%');
    expect(roi.every((l) => DM_SOURCES[l.sourceCode])).toBe(true);
    expect(roi.map((l) => l.text).join(' ')).not.toMatch(/32\.8|Northern Ireland/);
    const ni2 = typicalDm('NI', 2);
    expect(ni2[0].text).toContain('30.8%');
    expect(ni2.some((l) => l.text.includes('24%'))).toBe(false); // the 2022 figure is for first cut only
    expect(typicalDm('NI', 1).some((l) => l.text.includes('24%'))).toBe(true);
    expect(typicalDm('NI', null)[0].text).toMatch(/32\.8%.*30\.8%.*34\.8%/);
  });

  it('Teagasc density is one tonne per 1.39 m3, offered only for pits that may be about 25% DM', () => {
    expect(TEAGASC_DENSITY_25DM).toBe(719);
    expect(canOfferTeagascDensity(pit())).toBe(true);
    expect(canOfferTeagascDensity(pit({ dm_percent: 25.3 }))).toBe(true);
    expect(canOfferTeagascDensity(pit({ dm_percent: 32 }))).toBe(false);
    expect(canOfferTeagascDensity(pit({ dm_test: 'squeeze_25_30' }))).toBe(true);
    expect(canOfferTeagascDensity(pit({ dm_test: 'ball_30_40' }))).toBe(false);
    expect(canOfferTeagascDensity(pit({ dm_test: 'squeeze_lt20' }))).toBe(false);
    expect(canOfferTeagascDensity(pit({ method: 'bale_count' }))).toBe(false);
  });

  it('a pit on Teagasc\'s density says so and lowers the winter plan to Medium', () => {
    const own = estimateStore(pit({ density_kg_m3: 719, density_basis: 'own' }));
    const pub = estimateStore(pit({ density_kg_m3: 719, density_basis: 'teagasc_25dm' }));
    expect(own.tonnes).toBe(pub.tonnes);
    expect(pub.explanation).toContain('Teagasc figure for silage of about 25% dry matter');
    expect(own.publishedDensity).toBe(false);
    const farm = { housing_start: '2026-11-01', turnout_date: '2027-03-01', forage_reserve_percent: 15 } as Farm;
    const groups = [{ id: 'g', name: 'Cows', animal_class: 'dairy_cow', head_count: 50, housed: true, archived: false, forage_t_per_head_month: 1.5 }] as never;
    const base = { farm, groups, benchmarks: [], evidence: [], today: '2026-10-11' };
    expect(forecastForage({ ...base, stores: [pit({ density_kg_m3: 719, density_basis: 'own' })] }).confidence).toBe('high');
    const f = forecastForage({ ...base, stores: [pit({ density_kg_m3: 719, density_basis: 'teagasc_25dm' })] });
    expect(f.confidence).toBe('medium');
    expect(f.reasons.join(' ')).toContain("Teagasc's density");
  });

  it('density comes from the dry matter with the published table, straight-line between rows', () => {
    expect(densityFromDm(20)).toBe(770);
    expect(densityFromDm(25)).toBe(680);
    expect(densityFromDm(30)).toBe(600);
    expect(densityFromDm(27.5)).toBe(640);
    expect(densityFromDm(18)).toBe(810);
    expect(densityFromDm(45)).toBe(420);
    expect(densityFromDm(17)).toBeNull();
    expect(densityFromDm(50)).toBeNull();
    expect(DM_SOURCES.S20.publisher).toBe('DAERA');
  });

  it('a pit with a lab dry matter and no density gets tonnes worked out, at Medium confidence', () => {
    const e = estimateStore(pit({ dm_percent: 30 }));
    expect(e.tonnes).toBeCloseTo(360); // 600 m³ × 600 kg/m³
    expect(e.dmTonnes).toBeCloseTo(108);
    expect(e.autoDensity?.basis).toBe('lab');
    expect(e.explanation).toContain('worked out from 30% dry matter');
    expect(e.missing).toBeNull();
    const farm = { housing_start: '2026-11-01', turnout_date: '2027-03-01', forage_reserve_percent: 15 } as Farm;
    const groups = [{ id: 'g', name: 'Cows', animal_class: 'dairy_cow', head_count: 50, housed: true, archived: false, forage_t_per_head_month: 1.5 }] as never;
    const f = forecastForage({ farm, groups, benchmarks: [], evidence: [], today: '2026-10-11', stores: [pit({ dm_percent: 30 })] });
    expect(f.availableT).toBeCloseTo(360);
    expect(f.confidence).toBe('medium');
    expect(f.reasons.join(' ')).toContain('worked out from its dry matter');
  });

  it('a yard-test band gives a range and the plan counts the careful, drier end', () => {
    const a = autoDensity(pit({ dm_test: 'squeeze_20_25' }))!;
    expect(a).toMatchObject({ kgM3: 680, highKgM3: 770, basis: 'yard_test' });
    const e = estimateStore(pit({ dm_test: 'squeeze_20_25' }));
    expect(e.tonnes).toBeCloseTo(408);
    expect(e.tonnesHigh).toBeCloseTo(462);
    // open-ended bands close at the edge of the table
    expect(autoDensity(pit({ dm_test: 'squeeze_lt20' }))).toMatchObject({ kgM3: 770, highKgM3: 810 });
    expect(autoDensity(pit({ dm_test: 'ball_gt40' }))).toMatchObject({ kgM3: 420, highKgM3: 480 });
  });

  it('the farmer\'s own density always wins, and bales never get a worked-out density', () => {
    expect(autoDensity(pit({ dm_percent: 30, density_kg_m3: 700 }))).toBeNull();
    expect(estimateStore(pit({ dm_percent: 30, density_kg_m3: 700, density_basis: 'own' })).tonnes).toBeCloseTo(420);
    expect(autoDensity(pit({ method: 'bale_count', dm_percent: 30 }))).toBeNull();
    expect(autoDensity(pit())).toBeNull(); // with no jurisdiction there is no best guess either

  });

  it('Teagasc\'s 25% density is only offered when nothing is known about the dry matter', () => {
    expect(offerTeagascDensity(pit())).toBe(true);
    expect(offerTeagascDensity(pit({ dm_percent: 25 }))).toBe(false);
    expect(offerTeagascDensity(pit({ dm_test: 'squeeze_20_25' }))).toBe(false);
    expect(offerTeagascDensity(pit({ density_kg_m3: 700 }))).toBe(false);
  });

  it('nothing known: a best guess from typical silage on the farm\'s side of the border, at Low confidence', () => {
    const roi = estimateStore(pit());
    expect(roi).toMatchObject({ bestGuess: true });
    expect(roi.tonnes).toBeCloseTo(408); // 600 m³ × 680 (Teagasc typical 25%)
    expect(roi.tonnesLow).toBeCloseTo(360); // 30% DM
    expect(roi.tonnesHigh).toBeCloseTo(462); // 20% DM
    const ni = estimateStore(pit({ cut: 2 }), 'NI');
    expect(ni.autoDensity).toMatchObject({ basis: 'typical', dmUsed: 30.8 });
    expect(ni.autoDensity!.sources).toContain('S18');
    const farm = { jurisdiction: 'ROI', housing_start: '2026-11-01', turnout_date: '2027-03-01', forage_reserve_percent: 15 } as Farm;
    const groups = [{ id: 'g', name: 'Cows', animal_class: 'dairy_cow', head_count: 50, housed: true, archived: false, forage_t_per_head_month: 1.5 }] as never;
    const f = forecastForage({ farm, groups, benchmarks: [], evidence: [], today: '2026-10-11', stores: [pit()] });
    expect(f.status).not.toBe('incomplete');
    expect(f.confidence).toBe('low');
    expect(f.reasons.join(' ')).toContain('squeeze test');
    // a squeeze test replaces the guess
    expect(estimateStore(pit({ dm_test: 'squeeze_25_30' })).bestGuess).toBe(false);
  });

  it('bales with no weight use a typical 600 kg bale (700 kg well packed)', () => {
    const e = estimateStore(pit({ method: 'bale_count', bale_count: 200, length_m: null, width_m: null, avg_height_m: null }));
    expect(e).toMatchObject({ tonnes: 120, tonnesHigh: 140, bestGuess: true });
    expect(DM_SOURCES.S22.publisher).toBe('Agriland');
    expect(estimateStore(pit({ method: 'bale_count', bale_count: 200, bale_weight_kg: 750 })).bestGuess).toBeUndefined();
  });
});
