import { countReasons, REASON_TEXT, type StockReason } from '../lib/stockReasons';
import { fmtKg } from '../lib/format';
import { Chips } from './ui';

/**
 * A stock check a fair way off the forecast asks why (G11). Optional: the count saves either
 * way. The answer shows on Predicted vs counted; it never changes a feeding or spreading rate.
 */
export function WhyDifferent({ what, countedKg, expectedKg, value, onChange }: {
  what: 'feed' | 'fertiliser'; countedKg: number; expectedKg: number; value: StockReason | null; onChange: (r: StockReason) => void;
}) {
  const gap = countedKg - expectedKg;
  return (
    <div className="space-y-2 rounded-xl bg-warn-bg p-3" data-why-different>
      <p className="text-[0.9375rem] font-semibold">That's {fmtKg(Math.abs(gap))} {gap < 0 ? 'less' : 'more'} than Agri-It expected ({fmtKg(expectedKg)}). Why might that be?</p>
      <Chips value={value} onChange={onChange} options={countReasons(countedKg, expectedKg).map((r) => ({ value: r, label: REASON_TEXT[what][r] }))} />
      <p className="text-[0.8125rem] text-muted">Optional. Your count is saved either way, and {what === 'feed' ? 'your feeding plan' : 'your spreading rates'} stay{what === 'feed' ? 's' : ''} as {what === 'feed' ? 'it is' : 'they are'}.</p>
    </div>
  );
}
