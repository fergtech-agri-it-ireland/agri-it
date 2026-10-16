import { useState } from 'react';
import { statsRows, statsText } from '../lib/alerts';
import { loadStats, resetStats } from '../lib/alertStore';
import { fmtDay, todayISO } from '../lib/format';
import { Button, Card } from './ui';

/**
 * For the pilot (G12): how often each kind of alert was acted on, put off, turned down or
 * ignored. Kept on this phone only; the observer copies it. Never sent anywhere by Agri-It.
 */
export function AlertStatsCard({ farmId }: { farmId: string }) {
  const today = todayISO();
  const [stats, setStats] = useState(() => loadStats(farmId, today));
  const [copied, setCopied] = useState(false);
  const rows = statsRows(stats);
  async function copy() {
    try { await navigator.clipboard.writeText(statsText(stats, today)); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <Card className="space-y-3">
      <p className="text-sm text-muted">Since {fmtDay(stats.since)}. Counted once a day per alert: <b>acted on</b> (opened, approved, or gone the next day because it was dealt with), <b>put off</b> (Not now, with why), <b>ignored</b> (still there the next day with nothing done). Kept on this phone only.</p>
      {rows.length === 0 ? <p className="text-[0.9375rem] font-semibold">Nothing counted yet. Counts start when the dashboard shows an alert.</p> : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-[0.8125rem]" aria-label="Alert counts">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-1 py-1 font-semibold">Kind</th>
                <th className="px-1 py-1 text-right font-semibold">Shown</th>
                <th className="px-1 py-1 text-right font-semibold">Acted</th>
                <th className="px-1 py-1 text-right font-semibold">Put off</th>
                <th className="px-1 py-1 text-right font-semibold">Ignored</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ kind, label, c }) => (
                <tr key={kind} data-kind={kind}>
                  <td className="px-1 py-1.5 font-semibold">{label}{c.turnedDown > 0 && <span className="block font-normal text-muted">{c.turnedDown} turned down</span>}
                    {c.putOff > 0 && <span className="block font-normal text-muted">Busy {c.reasons.busy}, done elsewhere {c.reasons.elsewhere}, not relevant {c.reasons.not_relevant}</span>}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{c.shown}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{c.acted}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{c.putOff}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{c.ignored}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy counts'}</Button>
        <Button variant="secondary" onClick={() => { resetStats(farmId, today); setStats(loadStats(farmId, today)); setCopied(false); }}>Start again</Button>
      </div>
    </Card>
  );
}
