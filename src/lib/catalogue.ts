/**
 * Pick lists for common bulk farm inputs (14 Oct 2026). The farmer can always type their own.
 *
 * - Plain names for the common items, with no supplier attached.
 * - A supplier's own product names only where that supplier lists them on its website, with the
 *   page and the day checked. Agri-It never says a supplier sells something it doesn't list.
 * - `cso`: the CSO series this item can be compared with (tables AJM08 feed, AJM09 fertiliser),
 *   only where the product is the same thing (same analysis, same protein band). Nothing else
 *   is compared.
 * - `exempt`: lime and straight potash, which the nitrates rules allow all year.
 *
 * Nothing here says what a product contains beyond its name, and Agri-It never works out a
 * ration or a fertiliser rate from it.
 */
export type CatalogueKind = 'feed' | 'fertiliser' | 'other';

export interface CatalogueItem {
  key: string;
  name: string;
  kind: CatalogueKind;
  /** Short heading the pick list groups by */
  group: string;
  /** The CSO series label (exactly as in cso-prices.json) this item compares with */
  cso?: string;
  /** Spread all year (lime, straight potash) */
  exempt?: boolean;
  /** Only for items a supplier lists: the directory supplier id and where it lists it */
  supplierId?: string;
  source?: { url: string; checkedOn: string };
}

const HOWARD = '10000000-0000-0000-0000-00000000000a';
const howardFeed = (path: string) => ({ url: `https://www.howardfarms.ie/${path}/`, checkedOn: '2026-10-14' });
const howardFert = { url: 'https://www.howardfarms.ie/fertilizer-range/', checkedOn: '2026-10-14' };

export const CATALOGUE: CatalogueItem[] = [
  // Feeds: plain names
  { key: 'dairy_nuts_16_18', name: 'Dairy nuts 16 to 18% protein', kind: 'feed', group: 'Dairy', cso: 'Dairy nuts and cubes (16-18% protein)' },
  { key: 'dairy_nuts_14', name: 'Dairy nuts 14% protein', kind: 'feed', group: 'Dairy' },
  { key: 'dairy_ration_16_18', name: 'Dairy ration (coarse) 16 to 18% protein', kind: 'feed', group: 'Dairy', cso: 'Dairy meal (16-18% protein)' },
  { key: 'calf_nuts', name: 'Calf nuts 16 to 18% protein', kind: 'feed', group: 'Calves', cso: 'Calf nuts and cubes (16-18% protein)' },
  { key: 'calf_ration', name: 'Calf ration (coarse)', kind: 'feed', group: 'Calves' },
  { key: 'milk_replacer', name: 'Calf milk replacer', kind: 'feed', group: 'Calves', cso: 'Milk replacer' },
  { key: 'beef_nuts', name: 'Beef nuts 13 to 15% protein', kind: 'feed', group: 'Beef', cso: 'Cattle fattening nuts and cubes (13-15% protein)' },
  { key: 'beef_ration', name: 'Beef ration (coarse) 13 to 15% protein', kind: 'feed', group: 'Beef', cso: 'Cattle fattening meal (13-15% protein)' },
  { key: 'ewe_nuts', name: 'Ewe nuts 16 to 20% protein', kind: 'feed', group: 'Sheep', cso: 'Ewe pellets/nuts (16-20%)' },
  { key: 'ewe_ration', name: 'Ewe ration (coarse) 16 to 20% protein', kind: 'feed', group: 'Sheep', cso: 'Ewe feed coarse (16-20% protein)' },
  { key: 'lamb_feed', name: 'Lamb feed 16 to 20% protein', kind: 'feed', group: 'Sheep', cso: 'Lamb feed (16-20% protein)' },
  { key: 'rolled_barley', name: 'Rolled barley', kind: 'feed', group: 'Straights', cso: 'Rolled barley' },
  { key: 'wheat', name: 'Wheat', kind: 'feed', group: 'Straights', cso: 'Wheat' },
  { key: 'maize_meal', name: 'Maize meal', kind: 'feed', group: 'Straights', cso: 'Maize meal' },
  { key: 'soya_meal', name: 'Soya bean meal', kind: 'feed', group: 'Straights', cso: 'Soya bean meal' },
  { key: 'soya_hulls', name: 'Soya hulls', kind: 'feed', group: 'Straights' },
  { key: 'beet_pulp', name: 'Beet pulp', kind: 'feed', group: 'Straights' },
  { key: 'distillers', name: 'Distillers grains', kind: 'feed', group: 'Straights' },
  { key: 'minerals_bulk', name: 'Cattle minerals (bulk)', kind: 'feed', group: 'Minerals' },
  { key: 'pre_calver', name: 'Pre-calver minerals', kind: 'feed', group: 'Minerals' },

  // Fertiliser: plain names by analysis
  { key: 'can', name: 'CAN (27% N)', kind: 'fertiliser', group: 'Nitrogen', cso: 'Calcium Ammonium Nitrate (27.5% N)' },
  { key: 'protected_urea', name: 'Protected urea (46% N)', kind: 'fertiliser', group: 'Nitrogen' },
  { key: 'asn', name: 'ASN (26% N)', kind: 'fertiliser', group: 'Nitrogen', cso: 'Ammonium Sulphate Nitrate (26%)' },
  { key: 'sulphate_ammonia', name: 'Sulphate of ammonia (21% N)', kind: 'fertiliser', group: 'Nitrogen', cso: 'Sulphate of Ammonia (21%)' },
  { key: 'npk_27_2_5_5', name: '27-2.5-5', kind: 'fertiliser', group: 'Compounds', cso: 'Compound 27-2.5-5' },
  { key: 'npk_24_2_5_10', name: '24-2.5-10', kind: 'fertiliser', group: 'Compounds', cso: 'Compound 24-2.5-10' },
  { key: 'npk_18_6_12', name: '18-6-12', kind: 'fertiliser', group: 'Compounds', cso: 'Compound 18-6-12' },
  { key: 'npk_10_10_20', name: '10-10-20', kind: 'fertiliser', group: 'Compounds', cso: 'Compound 10-10-20' },
  { key: 'npk_14_7_14', name: '14-7-14', kind: 'fertiliser', group: 'Compounds', cso: 'Compound 14-7-14' },
  { key: 'npk_13_6_20', name: '13-6-20', kind: 'fertiliser', group: 'Compounds', cso: 'Compound 13-6-20' },
  { key: 'npk_20_4_10', name: '20-4-10', kind: 'fertiliser', group: 'Compounds', cso: 'Compound 20-4-10' },
  { key: 'npk_0_7_30', name: '0-7-30', kind: 'fertiliser', group: 'P and K', cso: 'Compound 0-7-30' },
  { key: 'npk_0_10_20', name: '0-10-20', kind: 'fertiliser', group: 'P and K', cso: 'Compound 0-10-20' },
  { key: 'potash', name: 'Muriate of potash (50% K)', kind: 'fertiliser', group: 'P and K', cso: 'Muriate of Potash (50% K)', exempt: true },
  { key: 'super_p', name: 'Granular superphosphate (16% P)', kind: 'fertiliser', group: 'P and K', cso: 'Granular Superphosphate (16% P)' },
  { key: 'lime', name: 'Ground limestone (lime)', kind: 'fertiliser', group: 'Lime', exempt: true },
  { key: 'granulated_lime', name: 'Granulated lime', kind: 'fertiliser', group: 'Lime', exempt: true },

  // Other bulk inputs: bought and paid for, not kept as stock
  { key: 'straw', name: 'Straw (bedding)', kind: 'other', group: 'Bedding' },
  { key: 'sawdust', name: 'Sawdust or wood shavings', kind: 'other', group: 'Bedding' },
  { key: 'pit_cover', name: 'Silage pit cover', kind: 'other', group: 'Silage plastic' },
  { key: 'bale_wrap', name: 'Bale wrap', kind: 'other', group: 'Silage plastic' },
  { key: 'net_wrap', name: 'Net wrap', kind: 'other', group: 'Silage plastic' },

  // Howard Farms: its own product names, as listed on its website (checked 14 Oct 2026)
  ...([
    ['grass_match_dairy', 'Grass Match Dairy 14-15%', 'dairy-feeds'], ['dairy_elite_nut', 'Dairy Elite Nut 14-18%', 'dairy-feeds'],
    ['rejuvenate_dry_cow', 'Rejuvenate Dry Cow Feed', 'dairy-feeds'], ['replacement_heifer', 'Replacement Heifer Feed 19%', 'dairy-feeds'],
    ['five_way_beef', '5-way Beef 14%', 'beef-feed'], ['beefmax_store', 'BeefMax Store Cattle Concentrate', 'beef-feed'],
    ['bull_finisher', 'Bull Finisher 12%', 'beef-feed'], ['bull_power', 'Bull Power 12%', 'beef-feed'], ['bull_power_plus', 'Bull Power Plus 12%', 'beef-feed'],
    ['baby_calf_weanling', 'Baby Calf to Weanling 16%', 'calf-feeds'], ['calfmax_premium_19', 'CalfMax Premium Calf 19%', 'calf-feeds'],
    ['calfmax_premium_16', 'CalfMax Premium Calf 16% with Flakes', 'calf-feeds']
  ] as const).map(([k, name, path]): CatalogueItem => ({ key: `howard_${k}`, name, kind: 'feed', group: 'Howard Farms', supplierId: HOWARD, source: howardFeed(path) })),
  ...([
    ['green_sward', 'Green Sward 27-2.5-5', 'Compound 27-2.5-5'], ['silage_cut', 'Silage Cut 24-2.5-10', 'Compound 24-2.5-10'],
    ['new_18s', "New 18's 18-6-12", 'Compound 18-6-12'], ['can_27', 'CAN 27', 'Calcium Ammonium Nitrate (27.5% N)'],
    ['granular_urea', 'Granular Urea 46% N', 'Urea (46% N)'],
    ['axan', 'AXAN 27% N + 3.6% S', undefined], ['sulphan', 'Sulphan 24% N + 6% S', undefined],
    ['extra_grass', 'Extra Grass 27-2.2-4.2 + 2.4% S', undefined], ['sulphur_sward', 'Sulphur Sward 27-1.76-3.3 + 2.4% S', undefined],
    ['zero_p_sward', 'Zero P Sward 26-0-5 + 4% S', undefined], ['zero_p_cut', 'Zero P Cut 24-0-10 + 2% S', undefined],
    ['sulphur_cut', 'Sulphur Cut 22-1.7-11.6', undefined], ['silage_booster', 'Silage Booster 20-2.2-12.5', undefined],
    ['multi_crop', 'Multi Crop 8-10-20 + 2% S', undefined], ['nutri_booster', 'Nutri-Booster 25% N + 2% S + Na + Se', undefined],
    ['super_booster', 'Super Booster 25-2.2-4.2 + Na + Se', undefined], ['activa_s', 'Activa S 16-6.5-12.5 + 2.6% S', undefined],
    ['tropicote', 'Tropicote 15.5% N + 19% Ca', undefined]
  ] as const).map(([k, name, cso]): CatalogueItem => ({ key: `howard_${k}`, name, kind: 'fertiliser', group: 'Howard Farms', supplierId: HOWARD, source: howardFert, ...(cso ? { cso } : {}) }))
];

export function catalogueItem(key: string | null | undefined): CatalogueItem | null {
  return key ? CATALOGUE.find((c) => c.key === key) ?? null : null;
}

/**
 * The pick list for one kind of product: the chosen supplier's own listed items first (if it
 * lists any), then the plain names. Another supplier's listed items never show.
 */
export function pickList(kind: CatalogueKind, supplierId: string | null | undefined): { group: string; items: CatalogueItem[] }[] {
  const mine = CATALOGUE.filter((c) => c.kind === kind && c.supplierId && c.supplierId === supplierId);
  const plain = CATALOGUE.filter((c) => c.kind === kind && !c.supplierId);
  const groups: { group: string; items: CatalogueItem[] }[] = [];
  if (mine.length) groups.push({ group: `Listed by ${mine[0].group}`, items: mine });
  for (const c of plain) {
    const g = groups.find((x) => x.group === c.group);
    if (g) g.items.push(c); else groups.push({ group: c.group, items: [c] });
  }
  return groups;
}

/** Best match for a name the farmer typed, so a typed "CAN" or "18-6-12" can still be compared. Exact plain-name or analysis match only. */
export function matchTyped(kind: CatalogueKind, name: string): CatalogueItem | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n) return null;
  const plain = CATALOGUE.filter((c) => c.kind === kind && !c.supplierId);
  return plain.find((c) => c.name.toLowerCase() === n) ?? (kind === 'fertiliser' && n === 'can' ? catalogueItem('can') : null);
}
