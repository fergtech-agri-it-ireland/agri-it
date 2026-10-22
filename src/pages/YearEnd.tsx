import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Download } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { ledgerCsv, packReadme, yearEndCsv, yearEndPack } from '../lib/forecast/money';
import { buildZip, download } from '../lib/exportPack';
import { vaultCsv, vaultItems } from '../lib/vault';
import { FARM_TYPE_LABEL } from '../lib/farmTypes';
import type { FarmType } from '../lib/types';
import { eur, fmtDate, fmtMonth, fmtNum, todayISO } from '../lib/format';
import { Button, Card, Chips, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';
import { IN_FRAME, IS_DEMO } from '../lib/env';
import { buildReport, REPORT_LIST } from '../lib/reports';
import { tableXlsx } from '../lib/reports/xlsx';

export default function YearEnd() {
  const b = useFarmData();
  const [offset, setOffset] = useState<'0' | '-1'>('0');
  const pack = yearEndPack(b, todayISO(), Number(offset));

  const [copied, setCopied] = useState<string | null>(null);
  async function copyCsv() {
    const text = yearEndCsv(pack, b.farm.name);
    try { await navigator.clipboard.writeText(text); setCopied('Copied. Paste it into an email or a spreadsheet for your accountant.'); }
    catch { setCopied('This page could not copy. Open Agri-It in your phone browser to export.'); }
  }
  const [packing, setPacking] = useState<string | null>(null);
  const label = pack.fy.label.replace('/', '-');
  function exportCsv() {
    download(new Blob([`\ufeff${yearEndCsv(pack, b.farm.name)}`], { type: 'text/csv' }), `agri-it-year-end-${label}.csv`);
  }
  /** Summary, every transaction, records, and the invoices and dockets behind them, in one zip. */
  async function exportPack() {
    setPacking('Packing…');
    const inYear = (d: string) => d >= pack.fy.start && d <= pack.fy.end;
    const records = vaultItems(b).filter((i) => inYear(i.date));
    const ids = new Set([...pack.ledger.map((r) => r.documentId), ...records.map((r) => r.documentId)].filter(Boolean) as string[]);
    const docs = b.documents.filter((d) => ids.has(d.id));
    const docs0 = REPORT_LIST.map((r) => buildReport(r.id, b, todayISO(), { offset: Number(offset) }));
    const { blob, attached, missing } = await buildZip([
      { name: 'summary.csv', text: yearEndCsv(pack, b.farm.name) },
      { name: 'transactions.csv', text: ledgerCsv(pack) },
      { name: 'records.csv', text: vaultCsv(records) },
      ...docs0.map((d) => ({ name: `reports/${d.id}.xlsx`, data: tableXlsx(d.table, d.title) })),
      { name: 'README.txt', text: packReadme(pack, b.farm.name, docs0.map((d) => ({ title: d.title, basisNote: d.basisNote, complete: d.completeness.complete, reasons: d.completeness.reasons, notes: d.completeness.notes, footnotes: d.footnotes, provisional: d.meta.provisional, rule: d.meta.rule }))) }
    ], docs);
    download(blob, `agri-it-accountant-pack-${label}.zip`);
    setPacking(`${pack.ledger.length} transactions and ${attached} attachment${attached === 1 ? '' : 's'}${missing.length ? `. ${missing.length} attachment${missing.length === 1 ? '' : 's'} not on this phone (listed in the zip)` : ''}.`);
  }

  return (
    <Screen title="Year-end pack" back="/money" sub={`${b.farm.name}, ${fmtDate(pack.fy.start)} to ${fmtDate(pack.fy.end)}`}>
      <div className="no-print"><Chips columns={2} value={offset} onChange={setOffset} options={[{ value: '0', label: 'This year' }, { value: '-1', label: 'Last year' }]} /></div>
      <Card className="border border-line">
        <p className="font-bold">Management summary only</p>
        <p className="text-muted">Built from the records in Agri-It. It is not a set of statutory accounts and does not calculate taxable profit. Your accountant uses it as a starting point.</p>
      </Card>

      <Link to={`/reports?year=${offset}`} className="no-print block rounded-[1.125rem] bg-card p-4 font-bold text-accent shadow-lift">Open the reports: profit and loss, balance sheet and animals</Link>

      <SectionTitle>Before you send it</SectionTitle>
      {pack.missing.length === 0 ? (
        <Card className="flex items-center gap-2"><ToneIcon tone="ok" /><p className="font-bold">No gaps flagged.</p></Card>
      ) : (
        <List>
          {pack.missing.map((m) => (
            <Row key={m.id} to={m.to} icon={<ToneIcon tone="warn" />} title={m.text} right={<span className="no-print font-bold text-accent">{m.fix}</span>} />
          ))}
        </List>
      )}

      <SectionTitle>Summary</SectionTitle>
      <Card className="space-y-1">
        {pack.incomeByType.map((r) => <p key={r.key} className="flex justify-between"><span>{r.label}</span><b>{eur(r.total)}</b></p>)}
        <p className="flex justify-between border-t border-line pt-1 text-lg"><span className="font-bold">Total income</span><b>{eur(pack.totalIncome)}</b></p>
        <div className="h-3" />
        {pack.costsByCategory.map((r) => <p key={r.key} className="flex justify-between"><span>{r.label}</span><b>{eur(r.total)}</b></p>)}
        <p className="flex justify-between border-t border-line pt-1 text-lg"><span className="font-bold">Total running costs</span><b>{eur(pack.totalCosts)}</b></p>
        <p className="flex justify-between border-t-2 border-ink pt-2 text-xl"><span className="font-bold">Income less running costs</span><b>{eur(pack.net)}</b></p>
        {pack.nonOperatingByCategory.length > 0 && (
          <div className="pt-2">
            <p className="text-sm font-bold text-muted">Loans, capital and household (not running costs)</p>
            {pack.nonOperatingByCategory.map((r) => <p key={r.key} className="flex justify-between"><span>{r.label}</span><b>{eur(r.total)}</b></p>)}
          </div>
        )}
        <div className="space-y-1 border-t border-line pt-2 text-[0.9375rem]">
          <p className="flex justify-between"><span>Paid out in the year (cash)</span><b>{eur(pack.paidOut)}</b></p>
          <p className="flex justify-between"><span>Still owed {pack.fy.end < todayISO() ? 'at the year end' : 'today'}{pack.owedAtEndCount ? ` (${pack.owedAtEndCount})` : ''}</span><b>{eur(pack.owedAtEndTotal)}</b></p>
          {pack.totalVat > 0 && <p className="flex justify-between"><span>VAT on recorded invoices</span><b>{eur(pack.totalVat, true)}</b></p>}
        </div>
        {(pack.milkLitres > 0 || pack.livestockHead > 0) && (
          <p className="pt-2 text-muted">{pack.milkLitres > 0 && `${fmtNum(pack.milkLitres)} litres of milk sold. `}{pack.livestockHead > 0 && `${pack.livestockHead} animals sold.`}</p>
        )}
      </Card>

      {pack.loans.length > 0 && (
        <>
          <SectionTitle>Loans</SectionTitle>
          <Card className="space-y-3">
            {pack.loans.map((y) => (
              <div key={y.loan.id} className="text-[0.9375rem]">
                <p className="flex justify-between gap-2"><Link to={`/money/loans/${y.loan.id}`} className="font-bold underline">{y.loan.lender}</Link><b>{eur(y.balanceEnd)} owed</b></p>
                <p className="text-muted">
                  {y.balanceEndBasis === 'statement' ? 'From the bank statement. ' : 'Worked out from your figures. '}
                  Repaid {eur(y.repaid)} in the year; interest {y.interest === null ? 'not known' : `${eur(y.interest, true)} (${y.interestBasis === 'statement' ? 'bank statement' : y.interestBasis === 'recorded' ? 'from your repayments' : 'estimate'})`}.
                  {y.balanceStart !== null ? ` Owed at the start: ${eur(y.balanceStart)}.` : ''}
                </p>
              </div>
            ))}
            <p className="border-t border-line pt-2"><span className="font-bold">Interest in the year: {eur(pack.totalInterest, true)}</span>{pack.interestEstimated && <span className="block text-sm text-muted">Part of this is Agri-It's estimate. Add each bank's annual statement for the real figure.</span>}</p>
            <p className="text-sm text-muted">Loan repayments are not running costs: only the interest is a farm cost. Your accountant uses the bank's figure.</p>
          </Card>
        </>
      )}

      {pack.schemesReceived.length > 0 && (
        <>
          <SectionTitle>Scheme payments received</SectionTitle>
          <Card className="space-y-1">{pack.schemesReceived.map((r) => <p key={r.label} className="flex justify-between gap-2"><span>{r.label}</span><b>{eur(r.total)}</b></p>)}</Card>
        </>
      )}

      {pack.capital.length > 0 && (
        <>
          <SectionTitle>Machinery, buildings and land bought</SectionTitle>
          <Card className="space-y-1">{pack.capital.map((r, i) => <p key={i} className="flex justify-between gap-2"><span>{fmtDate(r.date)}, {r.description || r.payee}</span><b>{eur(r.amount)}</b></p>)}
            <p className="text-sm text-muted">Your accountant claims these over several years (capital allowances).</p></Card>
        </>
      )}

      {pack.livestock.length > 0 && (
        <>
          <SectionTitle>Livestock numbers</SectionTitle>
          <Card>
            <table className="w-full text-right text-[0.9375rem]">
              <thead><tr className="text-muted"><th className="text-left font-semibold">Group</th><th className="font-semibold">{fmtDate(pack.fy.start)}</th><th className="font-semibold">{pack.fy.end < todayISO() ? fmtDate(pack.fy.end) : 'Today'}</th></tr></thead>
              <tbody>{pack.livestock.map((r) => <tr key={r.name} className="border-t border-line"><td className="py-1.5 text-left font-semibold">{r.name}</td><td>{r.start ?? 'added later'}</td><td>{r.end}</td></tr>)}</tbody>
            </table>
            <p className="mt-2 text-sm text-muted">Numbers only. Your accountant values them; opening and closing stock feed the profit figure and stock relief.</p>
          </Card>
        </>
      )}

      {pack.household > 0 && <Card><p className="flex justify-between"><span>Household drawings (not a farm cost)</span><b>{eur(pack.household)}</b></p></Card>}

      <SectionTitle>For your accountant: what to gather</SectionTitle>
      <Card className="space-y-2">
        {pack.checklist.map((i) => (
          <div key={i.id} className="flex gap-2">
            <ToneIcon tone={i.done === true ? 'ok' : i.done === false ? 'warn' : 'info'} className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-[0.9375rem]"><b>{i.text}</b><span className="block text-sm text-muted">{i.done === true ? 'In Agri-It. ' : i.done === false ? 'Missing. ' : ''}{i.why}</span></p>
          </div>
        ))}
        <p className="border-t border-line pt-2 text-sm text-muted">
          {[pack.details.herdNumber ? `Herd number ${pack.details.herdNumber}` : 'No herd number given',
            pack.details.vatStatus === 'registered' ? 'VAT registered' : pack.details.vatStatus === 'flat_rate' ? 'flat-rate farmer' : 'VAT not said',
            pack.details.acresOwned != null || pack.details.acresRented != null ? `${pack.details.acresOwned ?? 0} ac owned, ${pack.details.acresRented ?? 0} ac rented in` : null,
            pack.details.accountant ? `Accountant: ${pack.details.accountant}` : null].filter(Boolean).join(' · ')}.
          {' '}From the Irish Farmers Journal's list of what accountants ask for (Money Mentor, 18 Feb 2026).
        </p>
      </Card>

      {pack.enterprises.length > 0 && (
        <>
          <SectionTitle>By enterprise</SectionTitle>
          <Card className="space-y-1">
            {pack.enterprises.map((e) => <p key={e.key} className="flex justify-between gap-2"><span>{e.key === 'whole_farm' ? 'Whole farm (shared)' : FARM_TYPE_LABEL[e.key as FarmType] ?? e.key}</span><b>{eur(e.income)} in, {eur(e.costs)} out</b></p>)}
          </Card>
        </>
      )}

      <SectionTitle>Cash by month</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full text-right">
          <thead><tr className="text-muted"><th className="text-left">Month</th><th>In</th><th>Paid out</th><th>Net</th></tr></thead>
          <tbody>{pack.flows.map((f) => <tr key={f.month} className="border-t border-line"><td className="py-1.5 text-left font-bold">{fmtMonth(f.month)}</td><td>{eur(f.inflow)}</td><td>{eur(f.outflow)}</td><td className={f.net < 0 ? 'text-danger' : ''}>{eur(f.net)}</td></tr>)}</tbody>
        </table>
      </Card>

      <SectionTitle>Main suppliers</SectionTitle>
      <List>{pack.supplierTotals.slice(0, 8).map((s) => <Row key={s.name} title={s.name} right={<b>{eur(s.total)}</b>} />)}</List>

      {IS_DEMO ? (
        <p className="rounded-xl bg-field-light px-4 py-3 font-bold text-accent">CSV export and Print / PDF work in the installed app. This demo can only show the pack on screen.</p>
      ) : IN_FRAME ? (
        <div className="no-print space-y-2">
          <Button variant="primary" block onClick={copyCsv}><Download className="h-5 w-5" />Copy as CSV</Button>
          {copied && <p className="px-1 font-bold">{copied}</p>}
        </div>
      ) : (
        <div className="no-print space-y-2">
          <Button variant="primary" block disabled={packing === 'Packing…'} onClick={exportPack}><Download className="h-5 w-5" />Accountant pack: transactions and invoices (zip)</Button>
          {packing && <p className="px-1 font-bold">{packing}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={exportCsv}><Download className="h-5 w-5" />Summary CSV</Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />Print / PDF</Button>
          </div>
        </div>
      )}
      <p className="no-print px-1 text-sm text-muted">Tax-relevant records stay in <Link className="underline" to="/records">Records</Link>. Discuss accounts and tax with your accountant.</p>
    </Screen>
  );
}
