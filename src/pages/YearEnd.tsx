import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Download } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { yearEndCsv, yearEndPack } from '../lib/forecast/money';
import { eur, fmtDate, fmtMonth, fmtNum, todayISO } from '../lib/format';
import { Button, Card, Chips, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';

export default function YearEnd() {
  const b = useFarmData();
  const [offset, setOffset] = useState<'0' | '-1'>('0');
  const pack = yearEndPack(b, todayISO(), Number(offset));

  function exportCsv() {
    const blob = new Blob([yearEndCsv(pack, b.farm.name)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agri-it-year-end-${pack.fy.label.replace('/', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Screen title="Year-end pack" back="/money" sub={`${b.farm.name}, ${fmtDate(pack.fy.start)} to ${fmtDate(pack.fy.end)}`}>
      <div className="no-print"><Chips columns={2} value={offset} onChange={setOffset} options={[{ value: '0', label: 'This year' }, { value: '-1', label: 'Last year' }]} /></div>
      <Card className="border-2 border-ink">
        <p className="font-bold">Management summary only</p>
        <p className="text-muted">Built from the records in Agri-It. It is not a set of statutory accounts and does not calculate taxable profit. Your accountant uses it as a starting point.</p>
      </Card>

      <SectionTitle>Before you send it</SectionTitle>
      {pack.missing.length === 0 ? (
        <Card className="flex items-center gap-2"><ToneIcon tone="ok" /><p className="font-bold">No gaps flagged.</p></Card>
      ) : (
        <List>
          {pack.missing.map((m) => (
            <Row key={m.id} to={m.to} icon={<ToneIcon tone="warn" />} title={m.text} right={<span className="no-print font-bold text-field">{m.fix}</span>} />
          ))}
        </List>
      )}

      <SectionTitle>Summary</SectionTitle>
      <Card className="space-y-1">
        {pack.incomeByType.map((r) => <p key={r.key} className="flex justify-between"><span>{r.label}</span><b>{eur(r.total)}</b></p>)}
        <p className="flex justify-between border-t border-line pt-1 text-lg"><span className="font-bold">Total income</span><b>{eur(pack.totalIncome)}</b></p>
        <div className="h-3" />
        {pack.costsByCategory.map((r) => <p key={r.key} className="flex justify-between"><span>{r.label}</span><b>{eur(r.total)}</b></p>)}
        <p className="flex justify-between border-t border-line pt-1 text-lg"><span className="font-bold">Total costs</span><b>{eur(pack.totalCosts)}</b></p>
        <p className="flex justify-between border-t-2 border-ink pt-2 text-xl"><span className="font-bold">Net cash movement</span><b>{eur(pack.net)}</b></p>
        {(pack.milkLitres > 0 || pack.livestockHead > 0) && (
          <p className="pt-2 text-muted">{pack.milkLitres > 0 && `${fmtNum(pack.milkLitres)} litres of milk sold. `}{pack.livestockHead > 0 && `${pack.livestockHead} animals sold.`}</p>
        )}
      </Card>

      <SectionTitle>By month</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full text-right">
          <thead><tr className="text-muted"><th className="text-left">Month</th><th>In</th><th>Out</th><th>Net</th></tr></thead>
          <tbody>{pack.flows.map((f) => <tr key={f.month} className="border-t border-line"><td className="py-1.5 text-left font-bold">{fmtMonth(f.month)}</td><td>{eur(f.inflow)}</td><td>{eur(f.outflow)}</td><td className={f.net < 0 ? 'text-danger' : ''}>{eur(f.net)}</td></tr>)}</tbody>
        </table>
      </Card>

      <SectionTitle>Main suppliers</SectionTitle>
      <List>{pack.supplierTotals.slice(0, 8).map((s) => <Row key={s.name} title={s.name} right={<b>{eur(s.total)}</b>} />)}</List>

      <div className="no-print grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={exportCsv}><Download className="h-5 w-5" />Export CSV</Button>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />Print / PDF</Button>
      </div>
      <p className="no-print px-1 text-sm text-muted">Tax-relevant records stay in <Link className="underline" to="/records">Records</Link>. Discuss accounts and tax with your accountant.</p>
    </Screen>
  );
}
