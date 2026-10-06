/**
 * Demo-mode data: a TypeScript mirror of supabase/seed.sql, so the browser-only
 * demo shows exactly the farm a local `supabase db reset` would create.
 * Dates are relative to today, like the SQL seed.
 */
import { addDays, todayISO, toISO } from '../format';

export type Row = Record<string, unknown>;
export type DB = Record<string, Row[]>;

export const DEMO_USER = { id: '20000000-0000-0000-0000-000000000001', email: 'demo@agri-it.local' };

const F = '30000000-0000-0000-0000-000000000001';
const G_COWS = '40000000-0000-0000-0000-000000000001';
const G_HEIF = '40000000-0000-0000-0000-000000000002';
const G_WEAN = '40000000-0000-0000-0000-000000000003';
const G_CALF = '40000000-0000-0000-0000-000000000004';
const P_NUT = '50000000-0000-0000-0000-000000000001';
const P_CALF = '50000000-0000-0000-0000-000000000002';
const TIRLAN = '10000000-0000-0000-0000-000000000001';

/** Column defaults, mirroring the migration, applied to every insert. */
export const DEFAULTS: Record<string, () => Row> = {
  farms: () => ({ eircode: null, jurisdiction: 'ROI', enterprise: 'dairy', financial_year_start_month: 1, opening_cash_eur: null, opening_cash_date: null, default_lead_time_days: null, forage_reserve_percent: 15, housing_start: null, turnout_date: null }),
  animal_groups: () => ({ head_count: 0, head_count_updated_at: new Date().toISOString(), forage_t_per_head_month: null, housed: true, archived: false, sort_order: 0 }),
  head_count_history: () => ({ effective_on: todayISO(), reason: 'manual' }),
  suppliers: () => ({ farm_id: null, network: null, coverage: ['ROI'], central_phone: null, central_phone_label: null, secondary_phone: null, secondary_phone_label: null, website: null, local_contact_method: null, source_url: null, verified_on: null, needs_live_directory: false }),
  farm_supplier_settings: () => ({ rep_name: null, rep_phone: null, lead_time_days: null, account_number: null, last_used_at: null, updated_at: new Date().toISOString() }),
  documents: () => ({ record_type: 'other', storage_path: null, file_name: null, mime_type: null, extracted: null, state: 'unconfirmed' }),
  feed_products: () => ({ supplier_id: null, storage_location: null, safety_stock_mode: 'days', safety_stock_value: 3, lead_time_days: null, analysis: null, archived: false }),
  feed_transactions: () => ({ order_date: null, delivery_date: null, expected_delivery_date: null, order_status: null, linked_order_id: null, supplier_id: null, total_price_eur: null, price_per_tonne_eur: null, evidence: 'farmer_estimate', document_id: null, notes: null }),
  feeding_rules: () => ({ head_count_override: null, start_date: todayISO(), end_date: null, is_temporary: false, label: null }),
  silage_stores: () => ({ acreage: null, yield_t_per_acre: null, length_m: null, width_m: null, avg_height_m: null, density_kg_m3: null, bale_count: null, bale_weight_kg: null, measured_tonnes: null, dm_percent: null, dmd_percent: null, crude_protein_percent: null, ph: null, measured_on: todayISO(), fed_out_tonnes: 0, notes: null }),
  income: () => ({ counterparty: null, milk_litres: null, fat_kg: null, protein_kg: null, animal_group_id: null, head_count: null, description: null, document_id: null }),
  costs: () => ({ other_label: null, supplier_id: null, supplier_name: null, feed_transaction_id: null, description: null, document_id: null }),
  budget_lines: () => ({ month: null }),
  farm_records: () => ({ details: {}, document_id: null, state: 'confirmed' }),
  jobs: () => ({ due_on: null, done_at: null }),
  forecast_snapshots: () => ({ subject_id: null, generated_at: new Date().toISOString() })
};

let n = 0;
const id = () => `d0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const stamp = () => new Date(Date.now() - 1000 * (1000 - n)).toISOString();
function row(table: string, r: Row): Row {
  return { ...(DEFAULTS[table]?.() ?? {}), id: id(), created_at: stamp(), ...r };
}
/** First of the month, `m` months before today's month, plus `plus` days. */
function monthPlus(m: number, plus: number): string {
  const t = new Date(todayISO() + 'T00:00:00Z');
  return addDays(toISO(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - m, 1))), plus);
}

export function buildSeed(): DB {
  n = 0;
  const d = todayISO();
  const D = (k: number) => addDays(d, k);
  const year = Number(d.slice(0, 4));
  const db: DB = {};
  const put = (table: string, rows: Row[]) => { db[table] = [...(db[table] ?? []), ...rows.map((r) => row(table, r))]; };

  put('evidence_sources', [
    { code: 'S1', title: 'Financial Analysis', publisher: 'Teagasc', url: 'https://teagasc.ie/rural-economy/farm-management/financial-analysis/', published_on: null, accessed_on: '2026-09-01' },
    { code: 'S2', title: 'Irish Farm Report 2026', publisher: 'Ifac', url: 'https://www.ifac.ie/irish-farm-report-2026', published_on: null, accessed_on: '2026-09-01' },
    { code: 'S3', title: 'Act Now to Assess Winter Feed Demand and Plan for the Winter Ahead', publisher: 'Teagasc', url: 'https://teagasc.ie/news--events/daily/act-now-to-assess-winter-feed-demand-and-plan-for-the-winter-ahead/', published_on: null, accessed_on: '2026-09-01' },
    { code: 'S4', title: 'Making quality silage on beef farms', publisher: 'Teagasc', url: 'https://teagasc.ie/insights/making-quality-silage-on-beef-farms/', published_on: null, accessed_on: '2026-09-01' },
    { code: 'S5', title: '4 key winter housing considerations', publisher: 'Teagasc', url: 'https://teagasc.ie/news--events/daily/4-key-winter-housing-considerations/', published_on: null, accessed_on: '2026-09-01' },
    { code: 'S6', title: 'Financial Analysis Tools', publisher: 'Teagasc', url: 'https://teagasc.ie/rural-economy/farm-management/financial-analysis/get-farm-financially-fit/tools/', published_on: null, accessed_on: '2026-09-01' }
  ]);
  put('forage_benchmarks', ([['dairy_cow', 1.6], ['suckler_cow', 1.4], ['in_calf_heifer', 1.3], ['store_cattle', 1.3], ['weanling', 0.7]] as const)
    .map(([animal_class, t]) => ({ animal_class, fresh_tonnes_per_month: t, source_code: 'S3', valid_from: '2026-09-01', notes: 'Planning allowance; use farm history where available' })));

  const sup = (sid: string, r: Row) => ({ ...DEFAULTS.suppliers(), ...r, id: sid });
  db.suppliers = [
    sup(TIRLAN, { name: 'Tirlán FarmLife', network: 'GAIN Feeds', coverage: ['ROI'], central_phone: '0818 321 321', central_phone_label: 'Customer services', website: 'https://www.tirlanfarmlife.com', local_contact_method: 'Customer services can connect you to your local Business Manager. Use the Tirlán store finder with your Eircode or town.', source_url: 'https://www.tirlanfarmlife.com/about-us/contact-us/contact', verified_on: '2026-09-01' }),
    sup('10000000-0000-0000-0000-000000000002', { name: 'Dairygold Agri Business', coverage: ['ROI'], central_phone: '025 24411', central_phone_label: 'Agri Business', secondary_phone: '022 31644', secondary_phone_label: 'Inside Sales', website: 'https://www.dairygoldagri.ie', local_contact_method: 'Regional dairy, beef and tillage advisory territories where current; otherwise Inside Sales.', source_url: 'https://www.dairygoldagri.ie/contact-us/', verified_on: '2026-09-01' }),
    sup('10000000-0000-0000-0000-000000000003', { name: 'Lakeland Dairies Agribusiness', coverage: ['ROI', 'NI'], central_phone: '0818 474720', central_phone_label: 'ROI agribusiness', secondary_phone: '+44 28 3026 2311', secondary_phone_label: 'NI agribusiness', website: 'https://lakelanddairies.com', local_contact_method: 'Agribusiness and member-relations contacts. No named rep is publicly mapped, so use the central number.', source_url: 'https://lakelanddairies.com/contact-us', verified_on: '2026-09-01' }),
    sup('10000000-0000-0000-0000-000000000004', { name: 'Aurivo Agribusiness', network: 'Nutrias', coverage: ['ROI'], central_phone: '071 9186500', central_phone_label: 'Agribusiness', website: 'https://www.aurivo.ie', local_contact_method: 'Current Aurivo agribusiness contact or branch data; central number as fallback.', source_url: 'https://www.aurivo.ie/overview/', verified_on: '2026-09-01' }),
    sup('10000000-0000-0000-0000-000000000005', { name: 'Arrabawn Tipperary Co-op', network: "Dan O'Connor Feeds", coverage: ['ROI'], local_contact_method: "Arrabawn and Tipperary Co-op merged in Feb 2025. Contacts must come from the merged co-op's live directory, not legacy Arrabawn data.", source_url: 'https://www.rte.ie/news/business/2025/0228/1499516-arrabawn-tipperary-co-operative-society/', needs_live_directory: true }),
    sup('10000000-0000-0000-0000-000000000006', { name: 'Drummonds', coverage: ['ROI'], central_phone: '01 825 5011', central_phone_label: 'Head office', website: 'https://drummonds.ie', local_contact_method: 'Drummonds publishes branch managers, agronomists and branch phones. Map your farm to the nearest branch.', source_url: 'https://drummonds.ie/contact-us/', verified_on: '2026-09-01' }),
    sup('10000000-0000-0000-0000-000000000007', { name: 'Fane Valley Feeds', coverage: ['NI'], central_phone: '028 9261 9620', central_phone_label: 'Central', website: 'https://fanevalley.com', local_contact_method: 'Northern Ireland coverage. Use the current advisor or branch directory; central number as fallback.', source_url: 'https://fanevalley.com/', verified_on: '2026-09-01' })
  ];
  db.supplier_branches = [];

  db.farms = [{
    ...DEFAULTS.farms(), id: F, name: 'Glenview Farm', eircode: 'E91 X000', county: 'Tipperary', jurisdiction: 'ROI', enterprise: 'dairy',
    financial_year_start_month: 1, opening_cash_eur: 38000, opening_cash_date: `${year}-01-01`, default_lead_time_days: 3, forage_reserve_percent: 15,
    housing_start: `${year}-11-01`, turnout_date: `${year + 1}-02-28`, created_by: DEMO_USER.id, created_at: stamp(), updated_at: stamp()
  }];
  db.farm_members = [{ farm_id: F, user_id: DEMO_USER.id, role: 'owner', added_at: stamp() }];

  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  db.animal_groups = [
    [G_COWS, 'Dairy cows', 'dairy_cow', 120, 1], [G_HEIF, 'In-calf heifers', 'in_calf_heifer', 40, 2],
    [G_WEAN, 'Weanlings', 'weanling', 30, 3], [G_CALF, 'Calves', 'calf', 18, 4]
  ].map(([gid, name, cls, heads, order]) => ({ ...DEFAULTS.animal_groups(), id: gid, farm_id: F, name, animal_class: cls, head_count: heads, sort_order: order, head_count_updated_at: recent, created_at: stamp() }));
  put('head_count_history', db.animal_groups.map((g) => ({ farm_id: F, animal_group_id: g.id, head_count: g.head_count, effective_on: D(-20), reason: 'opening' })));

  db.farm_supplier_settings = [{ ...DEFAULTS.farm_supplier_settings(), farm_id: F, supplier_id: TIRLAN, lead_time_days: 3, last_used_at: new Date(Date.now() - 4 * 86_400_000).toISOString() }];

  db.feed_products = [
    { ...DEFAULTS.feed_products(), id: P_NUT, farm_id: F, supplier_id: TIRLAN, name: 'Dairy nut 16%', storage_location: 'Bin 1', safety_stock_mode: 'days', safety_stock_value: 3, created_at: stamp() },
    { ...DEFAULTS.feed_products(), id: P_CALF, farm_id: F, supplier_id: TIRLAN, name: 'Calf ration', storage_location: 'Shed store', safety_stock_mode: 'kg', safety_stock_value: 150, created_at: stamp() }
  ];
  put('feed_transactions', [
    { farm_id: F, feed_product_id: P_NUT, txn_type: 'count', quantity_kg: 6200, effective_on: D(-20), evidence: 'measured', notes: 'Bin dipped' },
    { farm_id: F, feed_product_id: P_NUT, txn_type: 'delivery', quantity_kg: 8000, order_date: D(-7), delivery_date: D(-4), effective_on: D(-4), supplier_id: TIRLAN, total_price_eur: 3120, price_per_tonne_eur: 390, evidence: 'confirmed_docket' },
    { farm_id: F, feed_product_id: P_CALF, txn_type: 'order', quantity_kg: 1000, order_date: D(-1), expected_delivery_date: D(2), effective_on: D(2), order_status: 'open', supplier_id: TIRLAN, evidence: 'unconfirmed' },
    { farm_id: F, feed_product_id: P_CALF, txn_type: 'opening', quantity_kg: 500, effective_on: D(-6), evidence: 'farmer_estimate', notes: 'Roughly 20 bags' }
  ]);
  put('feeding_rules', [
    { farm_id: F, feed_product_id: P_NUT, animal_group_id: G_COWS, kg_per_head_per_feed: 1.0, feeds_per_day: 2, start_date: D(-30) },
    { farm_id: F, feed_product_id: P_NUT, animal_group_id: G_HEIF, kg_per_head_per_feed: 1.0, feeds_per_day: 1, start_date: D(-30) },
    { farm_id: F, feed_product_id: P_CALF, animal_group_id: G_CALF, kg_per_head_per_feed: 1.5, feeds_per_day: 1, start_date: D(-30) },
    { farm_id: F, feed_product_id: P_NUT, animal_group_id: G_COWS, kg_per_head_per_feed: 1.5, feeds_per_day: 2, start_date: D(3), end_date: D(12), is_temporary: true, label: 'Higher rate while grass is short' }
  ]);
  put('silage_stores', [
    { farm_id: F, name: 'Main pit', method: 'pit_dimensions', length_m: 40, width_m: 12, avg_height_m: 2.2, density_kg_m3: 700, dm_percent: 28, dmd_percent: 72, measured_on: D(-25) },
    { farm_id: F, name: 'Round bales (haggard)', method: 'bale_count', bale_count: 220, bale_weight_kg: 750, measured_on: D(-25) }
  ]);

  const income: Row[] = [];
  const costs: Row[] = [{ farm_id: F, category: 'feed', occurred_on: D(-4), amount_eur: 3120, supplier_id: TIRLAN, supplier_name: 'Tirlán FarmLife', description: 'Dairy nut 16% 8 t' }];
  for (let m = 1; m <= 8; m++) {
    income.push({ farm_id: F, income_type: 'milk', occurred_on: monthPlus(m, 14), amount_eur: 26000 + ((m * 1300) % 7000), counterparty: 'Tirlán', milk_litres: 56000 + ((m * 3100) % 16000), description: 'Milk cheque' });
    costs.push(
      { farm_id: F, category: 'feed', occurred_on: monthPlus(m, 3), amount_eur: 6800 + ((m * 410) % 2500), supplier_name: 'Tirlán FarmLife', description: 'Meal' },
      { farm_id: F, category: 'utilities', occurred_on: monthPlus(m, 20), amount_eur: 640 + ((m * 37) % 200), supplier_name: 'Electricity supplier', description: 'ESB bill' },
      { farm_id: F, category: 'vet_medicine', occurred_on: monthPlus(m, 9), amount_eur: 900 + ((m * 173) % 1100), supplier_name: 'Local vet', description: 'Vet call-outs' },
      { farm_id: F, category: 'other', occurred_on: monthPlus(m, 1), amount_eur: 5200, supplier_name: 'Bank', description: 'Loan repayment' }
    );
  }
  costs.push(
    { farm_id: F, category: 'fertiliser', occurred_on: D(-150), amount_eur: 14200, supplier_name: 'Tirlán FarmLife', description: 'CAN and 18-6-12' },
    { farm_id: F, category: 'contractor', occurred_on: D(-110), amount_eur: 9800, supplier_name: 'Local contractor', description: 'First cut silage' },
    { farm_id: F, category: 'machinery_fuel', occurred_on: D(-45), amount_eur: 2300, supplier_name: 'Fuel supplier', description: 'Green diesel' }
  );
  income.push({ farm_id: F, income_type: 'livestock', occurred_on: D(-60), amount_eur: 7400, counterparty: 'Mart', animal_group_id: G_WEAN, head_count: 12, description: '12 weanlings sold' });
  put('income', income);
  put('costs', costs);

  const budget: Row[] = [];
  for (let m = 1; m <= 12; m++) {
    budget.push({ farm_id: F, year, month: m, kind: 'income', category: 'milk', amount_eur: 29000 }, { farm_id: F, year, month: m, kind: 'cost', category: 'feed', amount_eur: 7500 });
  }
  put('budget_lines', budget);

  put('farm_records', [
    { farm_id: F, record_type: 'fertiliser', occurred_on: D(-150), title: 'CAN spread, paddocks 1 to 12', details: { product: 'CAN', quantity_kg: 6000, area_ha: 24 } },
    { farm_id: F, record_type: 'medicine', occurred_on: D(-12), title: 'Dosed weanlings', details: { product: 'Wormer', animals: 30, withdrawal_days: 14 } },
    { farm_id: F, record_type: 'movement', occurred_on: D(-60), title: '12 weanlings to mart', details: { direction: 'out', animals: 12 } }
  ]);
  put('jobs', [{ farm_id: F, title: 'Book vet for TB test', due_on: D(5) }, { farm_id: F, title: 'Check silage pit cover', due_on: D(1) }]);
  for (const t of ['documents', 'forecast_snapshots']) db[t] = db[t] ?? [];
  return db;
}
