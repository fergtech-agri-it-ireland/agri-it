import { describe, expect, it } from 'vitest';
import { addOptions, breedsFor, farmGuide, farmTypes, legacyEnterprise, speciesOf, suggestedClasses } from './farmTypes';
import type { Farm, FarmBundle, FarmType } from './types';

const farm = (enterprises: FarmType[] | undefined, extra: Partial<Farm> = {}): Farm => ({
  id: 'f', name: 'Test', eircode: null, county: 'Tipperary', jurisdiction: 'ROI', enterprise: 'dairy', enterprises,
  financial_year_start_month: 1, opening_cash_eur: null, opening_cash_date: null, default_lead_time_days: null,
  forage_reserve_percent: 15, feed_target_days: 30, housing_start: null, turnout_date: null, ...extra
});
const bundle = (f: Farm, extra: Partial<FarmBundle> = {}) =>
  ({ farm: f, groups: [], crops: [], products: [], silage: [], income: [], costs: [], ...extra }) as unknown as FarmBundle;

describe('farm types', () => {
  it('works out the list for farms saved with the old single type', () => {
    expect(farmTypes(farm(undefined, { enterprise: 'mixed' }))).toEqual(['dairy', 'suckler']);
    expect(farmTypes(farm(undefined, { enterprise: 'sheep' }))).toEqual(['sheep']);
    expect(farmTypes(farm(['dairy', 'sheep', 'tillage']))).toEqual(['dairy', 'sheep', 'tillage']);
    expect(farmTypes(farm([]))).toEqual([]);
  });
  it('keeps the old single type in step', () => {
    expect(legacyEnterprise(['dairy', 'tillage'])).toBe('mixed');
    expect(legacyEnterprise(['sheep'])).toBe('sheep');
    expect(legacyEnterprise(['calf_rearing'])).toBe('other');
    expect(legacyEnterprise([])).toBe('other');
  });
  it('suggests animals for every type picked, once each', () => {
    const s = suggestedClasses(['dairy', 'sheep', 'beef']);
    expect(s).toContain('bullock');
    expect(s).toContain('ewe');
    expect(s).toContain('dairy_cow');
    expect(new Set(s).size).toBe(s.length);
    expect(suggestedClasses(['tillage'])).toEqual([]);
  });
  it('offers breeds that suit the animal', () => {
    expect(speciesOf('bullock')).toBe('cattle');
    expect(speciesOf('hogget')).toBe('sheep');
    expect(breedsFor('ewe')).toContain('Texel');
    expect(breedsFor('ewe')).not.toContain('Holstein Friesian');
    expect(breedsFor('dairy_cow')).toContain('Holstein Friesian');
    expect(breedsFor('pig').at(-1)).toBe('Mixed');
    expect(breedsFor('bullock')[0]).toBe('Aberdeen Angus');
    expect(breedsFor('dairy_cow')[0]).toBe('Holstein Friesian');
  });
});

describe('getting started guide', () => {
  it('asks what you farm when nothing is picked', () => {
    const g = farmGuide(bundle(farm([])));
    expect(g[0].id).toBe('types');
    expect(g.map((s) => s.id)).toContain('animals');
  });
  it('steers a tillage farm to crops, inputs and grain, not animals or silage', () => {
    const ids = farmGuide(bundle(farm(['tillage']))).map((s) => s.id);
    expect(ids).toEqual(['crops', 'inputs', 'grain', 'cash']);
  });
  it('steers a dairy and sheep farm to milk and lamb sales as well as feed', () => {
    const g = farmGuide(bundle(farm(['dairy', 'sheep'])));
    const ids = g.map((s) => s.id);
    expect(ids).toEqual(['animals', 'feed', 'silage', 'milk', 'sale', 'cash']);
    expect(g.find((s) => s.id === 'sale')!.title).toBe('Record a sale of lambs');
  });
  it('ticks steps off from what is recorded', () => {
    const g = farmGuide(bundle(farm(['tillage'], { opening_cash_eur: 1000 }), {
      crops: [{ id: 'c', farm_id: 'f', name: 'Winter wheat', variety: null, acres: 40, harvest_year: 2027, sown_on: null, archived: false }],
      costs: [{ category: 'seed_sprays' }] as FarmBundle['costs']
    }));
    expect(g.filter((s) => s.done).map((s) => s.id)).toEqual(['crops', 'inputs', 'cash']);
  });
});

describe('add options', () => {
  it('puts the farmer’s own kinds first and hides nothing', () => {
    const all = addOptions(['tillage']);
    expect(all.length).toBe(addOptions(['dairy']).length);
    expect(all.slice(0, 2).map((o) => o.id)).toEqual(['grain', 'inputs']);
    expect(all.find((o) => o.id === 'milk')!.relevant).toBe(false);
  });
  it('treats every option as relevant before farm types are picked', () => {
    expect(addOptions([]).every((o) => o.relevant)).toBe(true);
  });
  it('names sheep sales for a sheep-only farm', () => {
    expect(addOptions(['sheep']).find((o) => o.id === 'sale')!.label).toBe('Sold lambs or sheep');
  });
});
