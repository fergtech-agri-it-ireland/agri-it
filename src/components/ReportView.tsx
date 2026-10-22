import { Link } from 'react-router-dom';
import { Dash } from './reportBits';
import type { ReportColumn, ReportDoc, ReportRow, ReportSection } from '../lib/reports/doc';
import { fmtDate, fmtNum } from '../lib/format';
import { Card, SectionTitle, ToneIcon } from './ui';

/** 1,234.50 and -1,234.50: plain digits, no currency sign (the column says which currency), no hidden characters */
const money = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
const plainMoney = (n: number) => money.format(n).replace(/[^\d.,-]/g, (c) => (c === '−' ? '-' : ''));

function cell(v: string | number | null | undefined, col: ReportColumn | undefined) {
  if (v === null || v === undefined || v === '') return <Dash />;
  if (typeof v === 'string') return col?.type === 'date' ? fmtDate(v) : v;
  if (col?.type === 'money') return plainMoney(v);
  return fmtNum(v);
}

function RowLabel({ r }: { r: ReportRow }) {
  return r.to ? <Link to={r.to} className="underline decoration-line underline-offset-2">{r.label}</Link> : <>{r.label}</>;
}

function AmountSection({ s, currency }: { s: ReportSection; currency: string }) {
  return (
    <Card className="space-y-1.5">
      <p className="flex justify-between gap-3 text-sm font-semibold text-muted"><span>Item</span><span>{currency}</span></p>
      {s.rows.map((r, i) => {
        const strong = r.kind === 'total';
        const sub = r.kind === 'subtotal';
        const info = r.kind === 'info';
        return (
          <p key={i} className={`flex items-baseline justify-between gap-3 ${strong ? 'border-t-2 border-ink pt-2 text-lg' : sub ? 'border-t border-line pt-1' : ''} ${info ? 'text-muted' : ''}`}>
            <span className={strong || sub ? 'font-bold' : ''}><RowLabel r={r} /></span>
            <b className="shrink-0 tabular-nums">{r.missing || r.amount === null || r.amount === undefined ? <Dash /> : plainMoney(r.amount)}</b>
          </p>
        );
      })}
    </Card>
  );
}

function TableSection({ s, first }: { s: ReportSection; first: string }) {
  const cols = s.columns!;
  const wide = cols.length > 3;
  return (
    <Card className="overflow-x-auto">
      <table className={`w-full text-right text-[0.9375rem] ${wide ? 'min-w-[34rem]' : ''}`}>
        <thead><tr className="text-muted"><th className="py-1 pr-2 text-left font-semibold">{first}</th>{cols.map((c) => <th key={c.label} className="px-1 font-semibold">{c.label}</th>)}</tr></thead>
        <tbody>
          {s.rows.map((r, i) => (
            <tr key={i} className={`border-t ${r.kind === 'total' ? 'border-ink font-bold' : r.kind === 'subtotal' ? 'border-line font-bold' : 'border-line'}`}>
              <td className="whitespace-nowrap py-1.5 pr-2 text-left align-top font-semibold"><RowLabel r={r} /></td>
              {cols.map((c, j) => <td key={j} className="whitespace-nowrap px-1 py-1.5 align-top tabular-nums">{r.missing ? <Dash /> : cell(r.cells?.[j], c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** One report, from its document: the same document the download and the print are made from. Tables and figures only. */
export function ReportView({ doc }: { doc: ReportDoc }) {
  const c = doc.completeness;
  const first = doc.id === 'animals' ? 'Tag number' : 'Item';
  return (
    <div className="space-y-3">
      {!c.complete && (
        <Card className="bg-warn-bg">
          <p className="flex items-center gap-2 font-bold"><ToneIcon tone="warn" className="h-6 w-6" />Not complete</p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-[0.9375rem]">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Card>
      )}
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <SectionTitle>{s.heading}</SectionTitle>
          {s.columns ? <TableSection s={s} first={s.heading === 'This year' ? '' : first} /> : <AmountSection s={s} currency={doc.meta.currency} />}
        </section>
      ))}
      {doc.id === 'animals' && doc.sections[1].rows.length === 0 && <Card><p className="font-bold">No animals with a tag number yet</p></Card>}
      <p className="px-1 text-sm text-muted">{doc.meta.farm}. {doc.meta.currency}. Management report, not statutory accounts.</p>
    </div>
  );
}
