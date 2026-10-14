/**
 * Republic of Ireland and Northern Ireland defaults (advisory review G05). Everything that
 * changes across the border lives here: currency, the department and its animal systems,
 * the tax authority, the postcode name. Screens read from this, never write "the Department"
 * or "€" on their own. Checked 14 Oct 2026; deadlines themselves live in lib/deadlines.ts.
 */
import type { Jurisdiction } from './types';
import type { Currency } from './format';

export interface JurisdictionInfo {
  name: string;
  currency: Currency;
  currencyName: string;
  /** Short name used in sentences: "the Department (DAFM)" or "DAERA". */
  department: string;
  departmentLong: string;
  /** Where births, tags and movements are notified. */
  animalSystem: string;
  taxAuthority: string;
  postcodeLabel: string;
  /** Example payer for a scheme payment, used as a form hint. */
  schemePayer: string;
}

export const JURISDICTIONS: Record<Jurisdiction, JurisdictionInfo> = {
  ROI: {
    name: 'Republic of Ireland',
    currency: 'EUR',
    currencyName: 'euro',
    department: 'the Department (DAFM)',
    departmentLong: 'Department of Agriculture, Food and the Marine',
    animalSystem: 'AgFood.ie or the Calf-Reg app',
    taxAuthority: 'Revenue',
    postcodeLabel: 'Eircode',
    schemePayer: 'Department of Agriculture'
  },
  NI: {
    name: 'Northern Ireland',
    currency: 'GBP',
    currencyName: 'pounds sterling',
    department: 'DAERA',
    departmentLong: 'Department of Agriculture, Environment and Rural Affairs (DAERA)',
    animalSystem: 'APHIS Online (DAERA)',
    taxAuthority: 'HMRC',
    postcodeLabel: 'Postcode',
    schemePayer: 'DAERA'
  }
};

export function jurisdictionInfo(j: Jurisdiction | null | undefined): JurisdictionInfo {
  return JURISDICTIONS[j === 'NI' ? 'NI' : 'ROI'];
}
