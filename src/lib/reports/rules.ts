/**
 * The accounting and record-keeping rules the reports follow, each with its source and the day it
 * was checked (21 Oct 2026). `releaseGates.test.ts` fails the build 30 days after `reviewBy`, so a
 * rule cannot go stale unnoticed. See docs/REPORTS.md for the full list and what is not claimed.
 */
import type { AnimalClass, ISODate, Jurisdiction } from '../types';

export interface ReportRule {
  key: string;
  jurisdiction: Jurisdiction | 'both';
  text: string;
  publisher: string;
  title: string;
  url: string;
  checkedOn: ISODate;
  reviewBy: ISODate;
}

const CHECKED = '2026-10-21';
const REVIEW = '2027-04-21';

export const REPORT_RULES: ReportRule[] = [
  { key: 'records_roi', jurisdiction: 'ROI', text: 'Keep records of money spent and received, assets and liabilities, and the linking documents behind the accounts, for six years. Invoices or bank statements alone are not enough.', publisher: 'Revenue', title: 'Operational Manual 38-03-17, Books and Records (s.886 TCA 1997)', url: 'https://www.revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-38/38-03-17.pdf', checkedOn: CHECKED, reviewBy: REVIEW },
  { key: 'records_ni', jurisdiction: 'NI', text: 'Keep business records for at least five years after the 31 January deadline for the tax year.', publisher: 'gov.uk', title: 'Business records if you are self-employed', url: 'https://www.gov.uk/self-employed-records/how-long-to-keep-your-records', checkedOn: CHECKED, reviewBy: REVIEW },
  { key: 'stock_valuation', jurisdiction: 'both', text: 'Stock is valued at the lower of cost and net realisable value, applied consistently. FIFO or weighted average, never LIFO. Deemed cost (60% of market value for cattle, 75% for sheep, pigs and crops) only where actual cost cannot be established.', publisher: 'SCSI and HMRC', title: 'Farm Stocktaking Valuations Information Paper; BIM55410 (Helpsheet 232)', url: 'https://scsi.ie/wp-content/uploads/2020/11/SCSI-Farm-Stocktaking-Valuations-Information-Paper.pdf', checkedOn: CHECKED, reviewBy: REVIEW },
  { key: 'biological_assets', jurisdiction: 'both', text: 'Livestock and crops use the fair value model or the cost model, chosen per class and kept consistent.', publisher: 'CPA Ireland', title: 'Accounting for Agriculture under FRS 102 (Section 34)', url: 'https://www.cpaireland.ie/CPAIreland/media/Professional-Standards/Technical%20Resources/Financial%20Reporting/Accounting-for-Agriculture-under-FRS102.pdf', checkedOn: CHECKED, reviewBy: REVIEW },
  { key: 'stock_relief', jurisdiction: 'ROI', text: 'Stock relief is a deduction for an increase in the value of farm trading stock (livestock, crops, feed, fertiliser, seeds). General rate 25% of the increase. Tax years to 2027. Claimed on Form 11.', publisher: 'Revenue', title: 'Tax and Duty Manual 23-02-02', url: 'https://revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-23/23-02-02.pdf', checkedOn: CHECKED, reviewBy: REVIEW },
  { key: 'capital_allowances', jurisdiction: 'ROI', text: 'Plant and machinery: 12.5% a year over 8 years. Farm buildings and structures: over 7 years (15% for six years, 10% in the last). Qualifying slurry storage and equipment: 50% a year over two years for spend from 1 Jan 2023 to 31 Dec 2029.', publisher: 'Revenue', title: 'Tax and Duty Manual 23-01-37', url: 'https://www.revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-23/23-01-37.pdf', checkedOn: CHECKED, reviewBy: REVIEW },
  { key: 'herd_basis_ni', jurisdiction: 'NI', text: 'Herd basis is a tax election. A farm with a current herd basis election cannot use the cash basis.', publisher: 'gov.uk and HMRC', title: 'Cash basis: who can use it; HS224 Farmers and market gardeners', url: 'https://www.gov.uk/simpler-income-tax-cash-basis/who-can-use-cash-basis', checkedOn: CHECKED, reviewBy: REVIEW },
  { key: 'farm_layout', jurisdiction: 'both', text: 'Layout: gross output, variable costs, gross margin, fixed costs (labour, machinery, depreciation, leases, interest), net profit. Balance sheet: assets less liabilities is net worth.', publisher: 'Teagasc', title: 'eProfit Book 2016; Business Management: the balance sheet', url: 'https://teagasc.ie/wp-content/uploads/media/website/publications/2017/eProfit-Book-2016.pdf', checkedOn: CHECKED, reviewBy: REVIEW }
];

export const RETENTION: Record<Jurisdiction, string> = {
  ROI: 'Revenue: keep these records and the documents behind them for six years (s.886 TCA 1997).',
  NI: 'HMRC: keep business records for at least five years after the 31 January deadline for the tax year.'
};

/** Deemed cost, only where actual cost cannot be established: percent of market value by kind of animal. */
export const DEEMED_COST_PERCENT = { cattle: 60, sheep: 75, pigs: 75 } as const;
const CATTLE: AnimalClass[] = ['dairy_cow', 'suckler_cow', 'in_calf_heifer', 'heifer', 'store_cattle', 'bullock', 'weanling', 'calf', 'bull', 'finishing_cattle'];
export function deemedCostPercent(c: AnimalClass): number | null {
  if (CATTLE.includes(c)) return DEEMED_COST_PERCENT.cattle;
  if (c === 'ewe' || c === 'lamb' || c === 'ram' || c === 'hogget') return DEEMED_COST_PERCENT.sheep;
  if (c === 'pig') return DEEMED_COST_PERCENT.pigs;
  return null;
}

export const NOTE_STOCK_RELIEF = 'Stock relief (Revenue TDM 23-02-02): 25% of an increase in the value of farm trading stock, for tax years to 2027, claimed on Form 11. Your accountant works it out.';
export const NOTE_CAPITAL_ALLOWANCES = 'Capital allowances (Revenue TDM 23-01-37): machinery 12.5% a year over 8 years; farm buildings over 7 years; qualifying slurry storage 50% a year over two years (spend 2023 to 2029). Your accountant works these out. Grants reduce the qualifying spend.';
export const NOTE_HERD_BASIS_NI = 'Herd basis is a tax election, and a farm using it cannot use the cash basis (gov.uk). Agri-It does not apply it: tell your accountant if you use it.';
export const NOTE_NO_DEPRECIATION = 'Depreciation and capital allowances are not included. This is a profit before depreciation, not a final profit.';
