import { ChevronRight } from 'lucide-react';
export { ChevronRight };
/** An amount that is not known: a dash a screen reader reads as "not known". */
export function Dash() { return <span aria-label="not known" className="text-muted">-</span>; }
export const ReportRowDash = Dash;
