import { describe, expect, it } from 'vitest';
import { breedLabel, breedPatch, cleanBreeds, groupBreeds, legacyBreed, MAX_BREEDS } from './farmTypes';
import { normalizeBundle } from './data/farm';
import type { FarmBundle } from './types';

describe('breeds as a list (14 Oct 2026)', () => {
  it('reads an older group\'s single breed as a list of one, exactly as written', () => {
    expect(groupBreeds({ breed: 'Texel cross' })).toEqual(['Texel cross']);
    expect(groupBreeds({ breed: 'Holstein Friesian, Jersey' })).toEqual(['Holstein Friesian, Jersey']);
    expect(groupBreeds({ breed: null })).toEqual([]);
    expect(groupBreeds({ breed: '   ' })).toEqual([]);
    expect(groupBreeds({})).toEqual([]);
  });

  it('the list wins once a group has one', () => {
    expect(groupBreeds({ breed: 'Holstein Friesian, Jersey cross', breeds: ['Holstein Friesian', 'Jersey cross'] })).toEqual(['Holstein Friesian', 'Jersey cross']);
    expect(groupBreeds({ breed: 'stale', breeds: [] })).toEqual([]);
  });

  it('tidies a list: trims, drops blanks and repeats (any case), keeps at most eight', () => {
    expect(cleanBreeds(['  Jersey  cross ', '', 'jersey cross', 'Holstein Friesian'])).toEqual(['Jersey cross', 'Holstein Friesian']);
    expect(cleanBreeds(Array.from({ length: 12 }, (_, i) => `Breed ${i}`))).toHaveLength(MAX_BREEDS);
  });

  it('words a list the way a farmer would say it', () => {
    expect(breedLabel([])).toBe('');
    expect(breedLabel(['Jersey'])).toBe('Jersey');
    expect(breedLabel(['Holstein Friesian', 'Jersey cross'])).toBe('Holstein Friesian and Jersey cross');
    expect(breedLabel(['Aberdeen Angus', 'Hereford', 'Limousin'])).toBe('Aberdeen Angus, Hereford and Limousin');
  });

  it('keeps the old breed column in step, within its 60 characters', () => {
    expect(legacyBreed([])).toBeNull();
    expect(legacyBreed(['Holstein Friesian', 'Jersey cross'])).toBe('Holstein Friesian, Jersey cross');
    const long = legacyBreed(['Holstein Friesian', 'British Friesian', 'Jersey cross', 'Norwegian Red']);
    expect(long!.length).toBeLessThanOrEqual(60);
    expect(long!.endsWith('...')).toBe(true);
    expect(breedPatch([' Texel ', 'Suffolk'])).toEqual({ breeds: ['Texel', 'Suffolk'], breed: 'Texel, Suffolk' });
  });

  it('older phone records gain the list when the farm loads, and nothing else changes', () => {
    const old = { id: 'g1', farm_id: 'f', name: 'Ewes', animal_class: 'ewe', breed: 'Texel', head_count: 40, head_count_updated_at: '2026-10-01T00:00:00Z', forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0 };
    const none = { ...old, id: 'g2', breed: null };
    const b = { farm: { id: 'f', jurisdiction: 'ROI', enterprise: 'sheep', enterprises: ['sheep'] }, groups: [old, none], headHistory: [] } as unknown as FarmBundle;
    const n = normalizeBundle(b);
    expect(n.groups.map((g) => g.breeds)).toEqual([['Texel'], []]);
    expect(n.groups[0]).toMatchObject({ breed: 'Texel', head_count: 40, name: 'Ewes' });
    // Already a list: left alone
    expect(normalizeBundle(n).groups[0].breeds).toEqual(['Texel']);
  });
});
