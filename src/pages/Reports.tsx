import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Download, FileSpreadsheet, Printer, Scale } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { buildReport, REPORT_LIST, type Basis } from '../lib/reports';
import { docCsv } from '../lib/reports/doc';
import { tableXlsx, XLSX_TYPE } from '../lib/reports/xlsx';
import { reportPeriod } from '../lib/reports/common';
import { download } from '../lib/exportPack';
import { fmtDate, todayISO } from '../lib/format';
import { Button, Chips, Empty, List, Row, Screen, SectionTitle } from '../components/ui';
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
  if (worker) return <Screen title="Reports" back="/more"><Empty title="Reports are for the owner and family" body="Money records are not shown to farm workers." /></Screen>;
  return (
    <Screen title="Reports" back="/more" sub={`${b.farm.name}, ${fmtDate(p.fy.start)} to ${fmtDate(p.fy.end)}`}>
      <Chips columns={2} value={year} onChange={setYear} options={YEARS} />
      <List>
        {REPORT_LIST.map((r) => (
          <Row key={r.id} to={`/reports/${r.id}?year=${year}`} title={r.title} sub={r.sub} right={<ChevronRight className="h-5 w-5 text-muted" />} />
        ))}
      </List>
      <SectionTitle>What you put in</SectionTitle>
      <List>
        <Row to={`/reports/values?year=${year}`} icon={<Scale className="h-6 w-6 text-accent" />} title="Year-end values" sub="Livestock, crops, money owed, machinery, buildings, land" right={<ChevronRight className="h-5 w-5 text-muted" />} />
        <Row to="/money/year-end" title="Accountant pack" sub="Zip with transactions and invoices" right={<ChevronRight className="h-5 w-5 text-muted" />} />
      </List>
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
  // The basis and "year to date" are in the file name, because the file itself holds only the table
  const base = `agri-it-${[known.id, doc.meta.yearLabel.replace('/', '-'), doc.meta.basis, doc.meta.provisional ? 'to-date' : null].filter(Boolean).join('-')}`;
  async function copyCsv() {
    try { await navigator.clipboard.writeText(docCsv(doc!)); setCopied('Copied. Paste it into a spreadsheet or an email.'); }
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
        <p className="no-print rounded-xl bg-field-light px-4 py-3 font-bold text-accent">Excel, CSV and Print work in the installed app. This demo can only show the report on screen.</p>
      ) : IN_FRAME ? (
        <div className="no-print space-y-2">
          <Button variant="primary" block onClick={copyCsv}><Download className="h-5 w-5" />Copy as CSV</Button>
          {copied && <p className="px-1 font-bold">{copied}</p>}
        </div>
      ) : (
        <div className="no-print grid grid-cols-3 gap-2">
          <Button variant="primary" onClick={() => download(new Blob([tableXlsx(doc.table, doc.title) as BlobPart], { type: XLSX_TYPE }), `${base}.xlsx`)}><FileSpreadsheet className="h-5 w-5" />Excel</Button>
          <Button variant="secondary" onClick={() => download(new Blob([docCsv(doc)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)}><Download className="h-5 w-5" />CSV</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />Print</Button>
        </div>
      )}
      <p className="no-print px-1 text-sm text-muted"><Link className="underline" to="/reports">All reports</Link></p>
    </Screen>
  );
}
