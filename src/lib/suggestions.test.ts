import { describe, expect, it } from 'vitest';
import { suggestions, recurringCostSuggestions, housingSuggestions, headCountSuggestions, feedOrderSuggestions, calfSuggestions, seasonSuggestions, silageSuggestions } from './suggestions';
import { feedForecasts, derive } from './data/derived';
import type { AnimalGroup, CalvingSeason, Cost, Farm, FarmBundle, FeedingRule, FeedProduct, FeedTransaction } from './types';

const TODAY = '2026-11-25';
const farm = {
  id: 'f', name: 'Test', jurisdiction: 'ROI', enterprise: 'dairy', enterprises: ['dairy'], financial_year_start_month: 1, opening_cash_eur: 10000,
  opening_cash_date: '2026-01-01', default_lead_time_days: 3, forage_reserve_percent: 15, feed_target_days: 30, housing_start: '2026-11-15', turnout_date: '2027-03-01'
} as unknown as Farm;
const group = (x: Partial<AnimalGroup>): AnimalGroup => ({
  id: 'g', farm_id: 'f', name: 'Cows', animal_class: 'dairy_cow', head_count: 100, head_count_updated_at: `${TODAY}T08:00:00Z`, forage_t_per_head_month: null, housed: true, archived: false, sort_order: 1, ...x
});
const bundle = (over: Partial<FarmBundle> = {}): FarmBundle => ({
  farm, groups: [group({})], crops: [], suppliers: [{ id: 'tir', name: 'Tirlán' } as FarmBundle['suppliers'][number]], branches: [], supplierSettings: [], products: [],
  txns: [], rules: [], silage: [], benchmarks: [], evidence: [], income: [], costs: [], budget: [], records: [], documents: [], jobs: [], routines: [], completions: [], feedLogs: [], headHistory: [],
  seasons: [], births: [], decisions: [], fields: [], fertilisers: [], fertStock: [], spreads: [], spreadFields: [], loans: [], loanStatements: [], expected: [], yearValues: [], ...over
});
const cost = (id: string, on: string, amt = 210): Cost => ({
  id, farm_id: 'f', category: 'utilities', other_label: null, occurred_on: on, amount_eur: amt, supplier_id: null, supplier_name: 'ESB', feed_transaction_id: null, description: null, document_id: null
});

describe('ready to approve', () => {
  it('spots a monthly bill and drafts a routine from it, only with the farm\'s own figures', () => {
    const b = bundle({ costs: [cost('a', '2026-09-02', 190), cost('b', '2026-10-04', 205), cost('c', '2026-11-03', 210)] });
    const [s] = recurringCostSuggestions(b, TODAY);
    expect(s.title).toContain('ESB looks monthly');
    expect(s.approve!.ops[0]).toMatchObject({ kind: 'insert', table: 'routines', row: { kind: 'expense', frequency: 'monthly', day_of_month: 3, amount: 210, counterparty: 'ESB', category: 'utilities' } });
    // already a routine, too few bills, or irregular: nothing suggested
    expect(recurringCostSuggestions({ ...b, routines: [{ kind: 'expense', active: true, counterparty: 'esb', category: 'utilities' } as FarmBundle['routines'][number]] }, TODAY)).toEqual([]);
    expect(recurringCostSuggestions(bundle({ costs: [cost('a', '2026-09-02'), cost('b', '2026-10-04')] }), TODAY)).toEqual([]);
    expect(recurringCostSuggestions(bundle({ costs: [cost('a', '2026-07-01'), cost('b', '2026-09-20'), cost('c', '2026-10-04')] }), TODAY)).toEqual([]);
    // a farm worker doesn't get money suggestions
    expect(suggestions({ ...b, role: 'worker' }, new Map(), TODAY).some((x) => x.key.startsWith('recurring'))).toBe(false);
  });

  it('asks if groups out at grass are in, once their day to come in has come', () => {
    const b = bundle({ groups: [group({ at_grass: true }), group({ id: 'w', name: 'Weanlings', animal_class: 'weanling', head_count: 30, at_grass: true, housed_from: '2026-12-01' }), group({ id: 'p', name: 'Pigs', animal_class: 'pig', at_grass: true })] });
    const [s] = housingSuggestions(b, TODAY);
    expect(s.detail).toBe('Cows (100)'); // weanlings not due till December; pigs aren't in the silage plan
    const after = s.approve!.patch(b);
    expect(after.groups[0]).toMatchObject({ at_grass: false, housed_from: TODAY });
    expect(housingSuggestions(after, TODAY)).toEqual([]);
    expect(housingSuggestions(b, '2026-11-01')).toEqual([]); // before the farm's housing date
    expect(housingSuggestions(b, '2026-12-01')[0].detail).toBe('Cows (100), Weanlings (30)');
    expect(housingSuggestions(bundle(), '2027-03-10')[0].title).toBe("Set next winter's dates");
  });

  it('confirms stale head counts in one tap', () => {
    const b = bundle({ groups: [group({ head_count_updated_at: '2026-09-01T08:00:00Z' })] });
    const [s] = headCountSuggestions(b, TODAY);
    expect(s.title).toBe('Still 100 in Cows?');
    expect(s.approve!.ops[0]).toMatchObject({ kind: 'rpc', fn: 'set_head_count', args: { p_head_count: 100, p_reason: 'confirmed' } });
    expect(headCountSuggestions(s.approve!.patch(b), TODAY)).toEqual([]);
  });

  it('drafts a feed order from the last order, never a price or a made-up delivery time', () => {
    const p: FeedProduct = { id: 'nut', farm_id: 'f', supplier_id: 'tir', name: 'Dairy nut', storage_location: null, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: null, archived: false };
    const rule: FeedingRule = { id: 'r', farm_id: 'f', feed_product_id: 'nut', animal_group_id: 'g', head_count_override: null, kg_per_head_per_feed: 1, feeds_per_day: 2, start_date: '2026-11-01', end_date: null, is_temporary: false, label: null, confirm_daily: false };
    const deliv = { id: 'd', farm_id: 'f', feed_product_id: 'nut', txn_type: 'delivery', quantity_kg: 8000, effective_on: '2026-11-10', delivery_date: '2026-11-10', order_date: null, expected_delivery_date: null, order_status: null, evidence: 'confirmed_docket', supplier_id: 'tir', price_per_tonne_eur: 400, total_price_eur: 3200 } as unknown as FeedTransaction;
    const count = { ...deliv, id: 'c', txn_type: 'count', quantity_kg: 1000, effective_on: '2026-11-10', evidence: 'measured' } as FeedTransaction;
    const b = bundle({ products: [p], rules: [rule], txns: [count, deliv] });
    const feed = feedForecasts(b, TODAY);
    const [s] = feedOrderSuggestions(b, feed, TODAY);
    expect(s.title).toBe('Order 8 t of Dairy nut from Tirlán?');
    const row = (s.approve!.ops[0] as { row: Record<string, unknown> }).row;
    expect(row).toMatchObject({ txn_type: 'order', quantity_kg: 8000, order_status: 'open', price_per_tonne_eur: null, expected_delivery_date: '2026-11-28' });
    // the plain "order now" line on Today gives way to the drafted order
    const d = derive(b, TODAY);
    expect(d.priorities.some((x) => x.id === 'feed-nut')).toBe(false);
    expect(d.suggestions[0].key).toBe(s.key);
    // with an order already open, nothing is drafted
    expect(feedOrderSuggestions(s.approve!.patch(b), feedForecasts(s.approve!.patch(b), TODAY), TODAY)).toEqual([]);
  });

  it('season steps arrive a week ahead; approving adds the jobs and takes the step off', () => {
    const season: CalvingSeason = { id: 's', farm_id: 'f', label: 'Spring 2027', herd: 'dairy', calving_start: '2027-02-01', calving_end: null, cows_due: 100, thin_count: null, dry_weeks: 8, dry_weeks_thin: 10, milking_group_id: 'g', dry_group_id: null, calf_group_id: null, archived: false };
    const b = bundle({ seasons: [season] });
    const now = seasonSuggestions(b, '2026-11-20');
    const bcs = now.find((x) => x.key === 'season:s:bcs')!;
    expect(bcs.when).toBe('overdue');
    expect(now.find((x) => x.key === 'season:s:dry_thin')!.to!.href).toContain('/calving/dry-off?season=s&batch=thin');
    const after = bcs.approve!.patch(b);
    expect(after.jobs.map((j) => j.title)).toEqual(['Body condition score the cows']);
    expect(after.jobs[0].due_on).toBe('2026-11-20');
    expect(seasonSuggestions(after, '2026-11-20').some((x) => x.key === 'season:s:bcs')).toBe(false);
    expect(seasonSuggestions(b, '2026-10-13')).toEqual([]); // nothing due yet
  });

  it('calf tags are a legal deadline: they can\'t be put off or turned down', () => {
    const b = bundle({ births: [{ id: 'x', farm_id: 'f', season_id: null, born_on: '2026-11-01', calves: 2, calf_group_id: null, tagged_on: null, registered_on: null, notes: null }] });
    const [tag] = calfSuggestions(b, TODAY);
    expect(tag).toMatchObject({ title: 'Tag 2 calves', when: 'overdue', canDecline: false });
    const after = tag.approve!.patch(b);
    expect(after.births[0].tagged_on).toBe(TODAY);
    expect(calfSuggestions(after, TODAY).map((x) => x.title)).toEqual(['Register 2 calves']);
  });

  it('a measured pit with no dry matter asks for the one-minute yard test', () => {
    const pit = { id: 'p', farm_id: 'f', name: 'Main pit', method: 'pit_dimensions', length_m: 30, width_m: 10, avg_height_m: 2, density_kg_m3: null, dm_percent: null, measured_on: TODAY, fed_out_tonnes: 0 } as FarmBundle['silage'][number];
    expect(silageSuggestions(bundle({ silage: [pit] }), TODAY)[0].to!.href).toBe('/farm/silage/p/edit');
    expect(silageSuggestions(bundle({ silage: [{ ...pit, dm_test: 'squeeze_20_25' }] }), TODAY)).toEqual([]);
  });

  it('not now hides a suggestion for a week; no hides it for good', () => {
    const b = bundle({ groups: [group({ at_grass: true })] });
    const key = housingSuggestions(b, TODAY)[0].key;
    const snoozed = { ...b, decisions: [{ id: 'd', farm_id: 'f', key, decision: 'snoozed' as const, until: '2026-12-02', decided_at: '' }] };
    expect(housingSuggestions(snoozed, TODAY)).toEqual([]);
    expect(housingSuggestions(snoozed, '2026-12-02')).toHaveLength(1);
    const no = { ...b, decisions: [{ id: 'd', farm_id: 'f', key, decision: 'dismissed' as const, until: null, decided_at: '' }] };
    expect(housingSuggestions(no, '2027-01-10')).toEqual([]);
  });
});
