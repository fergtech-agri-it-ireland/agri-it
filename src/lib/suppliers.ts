/**
 * Supplier contact routing (spec 7). Order of precedence:
 *   My rep (farmer override) → branch covering the farm's county (verified) →
 *   supplier central number → nothing (never a guessed rep).
 */
import type { Farm, FarmSupplierSetting, Supplier, SupplierBranch } from './types';

export interface ContactRoute {
  kind: 'my_rep' | 'branch' | 'central' | 'secondary';
  title: string;
  subtitle: string | null;
  phone: string;
  verifiedOn: string | null;
  sourceUrl: string | null;
}

export function telHref(phone: string) {
  return 'tel:' + phone.replace(/[^\d+]/g, '');
}

export function resolveContacts(
  supplier: Supplier, branches: SupplierBranch[], setting: FarmSupplierSetting | undefined, farm: Farm
): { routes: ContactRoute[]; note: string | null; ambiguous: boolean } {
  const routes: ContactRoute[] = [];
  if (setting?.rep_phone) {
    routes.push({ kind: 'my_rep', title: setting.rep_name ? `${setting.rep_name} (your rep)` : 'Your rep', subtitle: 'Set by you', phone: setting.rep_phone, verifiedOn: null, sourceUrl: null });
  }
  const local = branches.filter((b) => b.supplier_id === supplier.id && b.phone && b.counties.some((c) => c.toLowerCase() === farm.county.toLowerCase()));
  if (local.length === 1) {
    const b = local[0];
    routes.push({
      kind: 'branch',
      title: b.contact_name ? `${b.contact_name}, ${b.name}` : b.name,
      subtitle: [b.contact_role, b.town].filter(Boolean).join(', ') || null,
      phone: b.phone!, verifiedOn: b.verified_on, sourceUrl: b.source_url
    });
  }
  if (supplier.central_phone) {
    routes.push({ kind: 'central', title: supplier.central_phone_label ?? 'Central number', subtitle: supplier.name, phone: supplier.central_phone, verifiedOn: supplier.verified_on, sourceUrl: supplier.source_url });
  }
  if (supplier.secondary_phone) {
    routes.push({ kind: 'secondary', title: supplier.secondary_phone_label ?? 'Other number', subtitle: supplier.name, phone: supplier.secondary_phone, verifiedOn: supplier.verified_on, sourceUrl: supplier.source_url });
  }
  // NI farms should see NI numbers first where a supplier has both
  if (farm.jurisdiction === 'NI') routes.sort((a, b) => Number(b.phone.startsWith('+44') || b.phone.startsWith('028')) - Number(a.phone.startsWith('+44') || a.phone.startsWith('028')));
  const ambiguous = local.length > 1 || (local.length === 0 && !setting?.rep_phone);
  let note: string | null = supplier.local_contact_method;
  if (supplier.needs_live_directory && routes.length === 0) {
    note = `${supplier.local_contact_method ?? ''} Agri-It has no verified number yet. Add your rep's number so it's one tap next time.`.trim();
  }
  return { routes, note, ambiguous };
}

export function primaryRoute(supplier: Supplier | undefined, bundle: { branches: SupplierBranch[]; supplierSettings: FarmSupplierSetting[]; farm: Farm }) {
  if (!supplier) return null;
  const setting = bundle.supplierSettings.find((s) => s.supplier_id === supplier.id);
  return resolveContacts(supplier, bundle.branches, setting, bundle.farm).routes[0] ?? null;
}
