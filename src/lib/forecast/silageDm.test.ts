import { describe, expect, it } from 'vitest';
import { bandLabel, canOfferTeagascDensity, DM_SOURCES, DM_TESTS, dmSummary, TEAGASC_DENSITY_25DM, typicalDm } from './silageDm';
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
});
