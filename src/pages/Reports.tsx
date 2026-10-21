import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Download, Printer, Scale } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { buildReport, REPORT_LIST, type Basis } from '../lib/reports';
import { docCsv } from '../lib/reports/doc';
import { reportPeriod } from '../lib/reports/common';
import { runChecks } from '../lib/reports/checks';
import { download } from '../lib/exportPack';
import { fmtDate, todayISO } from '../lib/format';
import { Button, Card, Chips, Empty, List, Row, Screen, SectionTitle, ToneIcon } from '../components/ui';
import { ReportView } from '../components/ReportView';
import { IN_FRAME, IS_DEMO } from '../lib/env';

type Year = '0' | '-1';
const YEARS = [{ value: '0' as Year, label: 'This year' }, { value: '-1' as Year, label: 'Last year' }];

function useWorkerBlock() {
  const b = useFarmData();
  return b.role === 'worker';
}

export default function Reports() {
  const b = useFarmData();
  const worker = useWorkerBlock();
  const [sp] = useSearchParams();
  const [year, setYear] = useState<Year>(sp.get('year') === '-1' ? '-1' : '0');
  const today = todayISO();
  const p = reportPeriod(b.farm, today, Number(year));
  const checks = useMemo(() => runChecks(b, today, Number(year)), [b, today, year]);
  const fix = checks.filter((c) => !c.ok && c.blocking).length;
  const look = checks.filter((c) => !c.ok && !c.blocking).length;
  if (worker) return <Screen title="Reports" back="/more"><Empty title="Reports are for the owner and family" body="Money records are not shown to farm workers." /></Screen>;
  const group = (g: 'year' | 'basic') => REPORT_LIST.filter((r) => r.group === g).map((r) => (
    <Row key={r.id} to={`/reports/${r.id}?year=${year}`} title={r.title} sub={r.sub} right={<ChevronRight className="h-5 w-5 text-muted" />} />
  ));
  return (
    <Screen title="Reports" back="/more" sub={`${b.farm.name}, ${fmtDate(p.fy.start)} to ${fmtDate(p.fy.end)}`}>
      <Chips columns={2} value={year} onChange={setYear} options={YEARS} />
      <Card className={fix ? 'bg-warn-bg' : ''}>
        <p className="flex items-center gap-2 font-bold"><ToneIcon tone={fix ? 'warn' : 'ok'} className="h-6 w-6" />{fix ? `${fix} thing${fix > 1 ? 's' : ''} to fix before the year-end figures can be relied on` : 'Nothing blocking the year-end figures'}</p>
        <p className="text-[0.9375rem] text-muted">{look ? `${look} more worth a look. ` : ''}These are management reports from your records, not statutory accounts or a tax computation. Each one says what it is built from and what is missing.</p>
      </Card>
      <SectionTitle>Year-end accounts</SectionTitle>
      <List>{group('year')}</List>
      <SectionTitle>Day to day</SectionTitle>
      <List>{group('basic')}</List>
      <SectionTitle>What you put in</SectionTitle>
      <List>
        <Row to={`/reports/values?year=${year}`} icon={<Scale className="h-6 w-6 text-accent" />} title="Year-end values" sub="Livestock, crops, money owed, machinery, buildings, land" right={<ChevronRight className="h-5 w-5 text-muted" />} />
        <Row to="/money/year-end" title="Accountant pack (zip with transactions and invoices)" sub="The management summary and the documents behind it" right={<ChevronRight className="h-5 w-5 text-muted" />} />
      </List>
      <p className="px-1 text-sm text-muted">Agri-It never puts a value on your animals or crops. You or your accountant enter it, with the basis used.</p>
    </Screen>
  );
}

/** Keyed by report, so the year and basis you picked on one report do not follow you to the next. */
export function ReportPage() {
  const { id } = useParams();
  return <ReportScreen key={id} id={id} />;
}

function ReportScreen({ id }: { id: string | undefined }) {
  const b = useFarmData();
  const nav = useNavigate();
  const worker = useWorkerBlock();
  const [sp] = useSearchParams();
  const [year, setYear] = useState<Year>(sp.get('year') === '-1' ? '-1' : '0');
  const [basis, setBasis] = useState<Basis>('accruals');
  const known = REPORT_LIST.find((r) => r.id === id);
  const doc = useMemo(() => (known ? buildReport(known.id, b, todayISO(), { offset: Number(year), basis }) : null), [known, b, year, basis]);
  const [copied, setCopied] = useState<string | null>(null);
  if (worker) return <Screen title="Reports" back="/more"><Empty title="Reports are for the owner and family" /></Screen>;
  if (!known || !doc) return <Screen title="Reports" back="/reports"><Empty title="No such report" action={<Button onClick={() => nav('/reports')}>Back to reports</Button>} /></Screen>;
  const file = `agri-it-${known.id}-${doc.meta.yearLabel.replace('/', '-')}.csv`;
  async function copyCsv() {
    try { await navigator.clipboard.writeText(docCsv(doc!)); setCopied('Copied. Paste it into an email or a spreadsheet for your accountant.'); }
    catch { setCopied('This page could not copy. Open Agri-It in your phone browser to export.'); }
  }
  return (
    <Screen title={known.title} back="/reports" sub={`${doc.meta.farm}, ${doc.meta.yearLabel}`}>
      <div className="no-print space-y-2">
        <Chips columns={2} value={year} onChange={setYear} options={YEARS} />
        {known.id === 'profit' && <Chips columns={2} value={basis} onChange={setBasis} options={[{ value: 'accruals', label: 'Accruals', sub: 'Owed and stock counted' }, { value: 'cash', label: 'Cash', sub: 'Money in and out only' }]} />}
      </div>
      <ReportView doc={doc} />
      {IS_DEMO ? (
        <p className="no-print rounded-xl bg-field-light px-4 py-3 font-bold text-accent">CSV export and Print / PDF work in the installed app. This demo can only show the report on screen.</p>
      ) : IN_FRAME ? (
        <div className="no-print space-y-2">
          <Button variant="primary" block onClick={copyCsv}><Download className="h-5 w-5" />Copy as CSV</Button>
          {copied && <p className="px-1 font-bold">{copied}</p>}
        </div>
      ) : (
        <div className="no-print grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => download(new Blob([`﻿${docCsv(doc)}`], { type: 'text/csv' }), file)}><Download className="h-5 w-5" />CSV</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />Print / PDF</Button>
        </div>
      )}
      <p className="no-print px-1 text-sm text-muted"><Link className="underline" to="/reports">All reports</Link>. Discuss accounts and tax with your accountant.</p>
    </Screen>
  );
}
