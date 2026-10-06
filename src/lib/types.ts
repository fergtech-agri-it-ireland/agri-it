// Row types mirroring supabase/migrations. Hand-written to keep the repo
// dependency-free; regenerate with `supabase gen types typescript --local` if preferred.

export type ISODate = string; // 'YYYY-MM-DD'

export type Jurisdiction = 'ROI' | 'NI';
export type Enterprise = 'dairy' | 'suckler' | 'beef' | 'mixed' | 'sheep' | 'tillage' | 'other';
export type AnimalClass =
  | 'dairy_cow' | 'suckler_cow' | 'in_calf_heifer' | 'store_cattle' | 'weanling'
  | 'calf' | 'bull' | 'finishing_cattle' | 'ewe' | 'lamb' | 'other';
export type FeedTxnType = 'opening' | 'order' | 'delivery' | 'count' | 'adjustment';
export type OrderStatus = 'open' | 'delivered' | 'cancelled';
export type Evidence = 'measured' | 'confirmed_docket' | 'invoice_derived' | 'farmer_estimate' | 'unconfirmed';
export type IncomeType = 'milk' | 'livestock' | 'grant' | 'other';
export type CostCategory =
  | 'feed' | 'fertiliser' | 'contractor' | 'vet_medicine' | 'machinery_fuel' | 'utilities' | 'other';
export type RecordType = 'feed_docket' | 'invoice' | 'fertiliser' | 'medicine' | 'movement' | 'other';
export type SilageMethod = 'acreage' | 'pit_dimensions' | 'bale_count' | 'measured_tonnes';
export type Confidence = 'high' | 'medium' | 'low' | 'scenario';

export interface Farm {
  id: string;
  name: string;
  eircode: string | null;
  county: string;
  jurisdiction: Jurisdiction;
  enterprise: Enterprise;
  financial_year_start_month: number;
  opening_cash_eur: number | null;
  opening_cash_date: ISODate | null;
  default_lead_time_days: number | null;
  forage_reserve_percent: number;
  housing_start: ISODate | null;
  turnout_date: ISODate | null;
}

export interface AnimalGroup {
  id: string;
  farm_id: string;
  name: string;
  animal_class: AnimalClass;
  head_count: number;
  head_count_updated_at: string;
  forage_t_per_head_month: number | null;
  housed: boolean;
  archived: boolean;
  sort_order: number;
}

export interface Supplier {
  id: string;
  farm_id: string | null;
  name: string;
  network: string | null;
  coverage: Jurisdiction[];
  central_phone: string | null;
  central_phone_label: string | null;
  secondary_phone: string | null;
  secondary_phone_label: string | null;
  website: string | null;
  local_contact_method: string | null;
  source_url: string | null;
  verified_on: ISODate | null;
  needs_live_directory: boolean;
}

export interface SupplierBranch {
  id: string;
  supplier_id: string;
  name: string;
  town: string | null;
  counties: string[];
  phone: string | null;
  contact_name: string | null;
  contact_role: string | null;
  source_url: string;
  verified_on: ISODate;
}

export interface FarmSupplierSetting {
  farm_id: string;
  supplier_id: string;
  rep_name: string | null;
  rep_phone: string | null;
  lead_time_days: number | null;
  account_number: string | null;
  last_used_at: string | null;
}

export interface FeedProduct {
  id: string;
  farm_id: string;
  supplier_id: string | null;
  name: string;
  storage_location: string | null;
  safety_stock_mode: 'days' | 'kg';
  safety_stock_value: number;
  lead_time_days: number | null;
  archived: boolean;
}

export interface FeedTransaction {
  id: string;
  farm_id: string;
  feed_product_id: string;
  txn_type: FeedTxnType;
  quantity_kg: number;
  order_date: ISODate | null;
  delivery_date: ISODate | null;
  expected_delivery_date: ISODate | null;
  effective_on: ISODate;
  order_status: OrderStatus | null;
  linked_order_id: string | null;
  supplier_id: string | null;
  total_price_eur: number | null;
  price_per_tonne_eur: number | null;
  evidence: Evidence;
  document_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface FeedingRule {
  id: string;
  farm_id: string;
  feed_product_id: string;
  animal_group_id: string;
  head_count_override: number | null;
  kg_per_head_per_feed: number;
  feeds_per_day: number;
  start_date: ISODate;
  end_date: ISODate | null;
  is_temporary: boolean;
  label: string | null;
}

export interface SilageStore {
  id: string;
  farm_id: string;
  name: string;
  method: SilageMethod;
  acreage: number | null;
  yield_t_per_acre: number | null;
  length_m: number | null;
  width_m: number | null;
  avg_height_m: number | null;
  density_kg_m3: number | null;
  bale_count: number | null;
  bale_weight_kg: number | null;
  measured_tonnes: number | null;
  dm_percent: number | null;
  dmd_percent: number | null;
  crude_protein_percent: number | null;
  ph: number | null;
  measured_on: ISODate;
  fed_out_tonnes: number;
  notes: string | null;
}

export interface ForageBenchmark {
  id: string;
  animal_class: AnimalClass;
  fresh_tonnes_per_month: number;
  source_code: string;
  valid_from: ISODate;
}

export interface EvidenceSource {
  code: string;
  title: string;
  publisher: string;
  url: string;
  accessed_on: ISODate;
}

export interface Income {
  id: string;
  farm_id: string;
  income_type: IncomeType;
  occurred_on: ISODate;
  amount_eur: number;
  counterparty: string | null;
  milk_litres: number | null;
  fat_kg: number | null;
  protein_kg: number | null;
  animal_group_id: string | null;
  head_count: number | null;
  description: string | null;
  document_id: string | null;
}

export interface Cost {
  id: string;
  farm_id: string;
  category: CostCategory;
  other_label: string | null;
  occurred_on: ISODate;
  amount_eur: number;
  supplier_id: string | null;
  supplier_name: string | null;
  feed_transaction_id: string | null;
  description: string | null;
  document_id: string | null;
}

export interface BudgetLine {
  id: string;
  farm_id: string;
  year: number;
  month: number | null;
  kind: 'income' | 'cost';
  category: string;
  amount_eur: number;
}

export interface FarmRecord {
  id: string;
  farm_id: string;
  record_type: RecordType;
  occurred_on: ISODate;
  title: string;
  details: Record<string, unknown>;
  document_id: string | null;
  state: 'unconfirmed' | 'confirmed';
}

export interface DocumentRow {
  id: string;
  farm_id: string;
  record_type: RecordType;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  state: 'unconfirmed' | 'confirmed';
  created_at: string;
}

export interface Job {
  id: string;
  farm_id: string;
  title: string;
  due_on: ISODate | null;
  done_at: string | null;
}

/** Everything the app needs for one farm, fetched in one go and cached offline. */
export interface FarmBundle {
  farm: Farm;
  groups: AnimalGroup[];
  suppliers: Supplier[];
  branches: SupplierBranch[];
  supplierSettings: FarmSupplierSetting[];
  products: FeedProduct[];
  txns: FeedTransaction[];
  rules: FeedingRule[];
  silage: SilageStore[];
  benchmarks: ForageBenchmark[];
  evidence: EvidenceSource[];
  income: Income[];
  costs: Cost[];
  budget: BudgetLine[];
  records: FarmRecord[];
  documents: DocumentRow[];
  jobs: Job[];
}

export const ANIMAL_CLASS_LABEL: Record<AnimalClass, string> = {
  dairy_cow: 'Dairy cows',
  suckler_cow: 'Suckler cows',
  in_calf_heifer: 'In-calf heifers',
  store_cattle: 'Store cattle',
  weanling: 'Weanlings',
  calf: 'Calves',
  bull: 'Bulls',
  finishing_cattle: 'Finishing cattle',
  ewe: 'Ewes',
  lamb: 'Lambs',
  other: 'Other'
};

export const COST_LABEL: Record<CostCategory, string> = {
  feed: 'Feed',
  fertiliser: 'Fertiliser',
  contractor: 'Contractor',
  vet_medicine: 'Vet & medicine',
  machinery_fuel: 'Machinery & fuel',
  utilities: 'Utilities',
  other: 'Other'
};

export const INCOME_LABEL: Record<IncomeType, string> = {
  milk: 'Milk',
  livestock: 'Livestock sales',
  grant: 'Grants & schemes',
  other: 'Other income'
};

export const RECORD_LABEL: Record<RecordType, string> = {
  feed_docket: 'Feed docket',
  invoice: 'Invoice',
  fertiliser: 'Fertiliser',
  medicine: 'Medicine',
  movement: 'Movement',
  other: 'Other'
};

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  measured: 'Measured on farm',
  confirmed_docket: 'Confirmed docket',
  invoice_derived: 'From invoice',
  farmer_estimate: 'Your estimate',
  unconfirmed: 'Not confirmed'
};

export const COUNTIES_ROI = [
  'Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin', 'Galway', 'Kerry', 'Kildare', 'Kilkenny',
  'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan', 'Offaly',
  'Roscommon', 'Sligo', 'Tipperary', 'Waterford', 'Westmeath', 'Wexford', 'Wicklow'
];
export const COUNTIES_NI = ['Antrim', 'Armagh', 'Down', 'Fermanagh', 'Londonderry', 'Tyrone'];
