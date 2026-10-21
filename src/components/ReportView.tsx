import { Link } from 'react-router-dom';
import { Dash } from './reportBits';
import type { ReportColumn, ReportDoc, ReportRow, ReportSection } from '../lib/reports/doc';
import { eur, fmtKg, fmtNum } from '../lib/format';
import { Card, SectionTitle, ToneIcon } from './ui';

function cell(v: string | number | null | undefined, col: ReportColumn | undefined) {
  if (v === null || v === undefined) return <Dash />;
  if (typeof v === 'string') return v;
  if (col?.type === 'money') return eur(v, true);
  if (col?.type === 'kg') return fmtKg(v);
  return fmtNum(v);
}

function RowLabel({ r }: { r: ReportRow }) {
  const inner = <>{r.label}{r.records ? <span className="font-normal text-muted"> ({r.records})</span> : null}</>;
  return r.to ? <Link to={r.to} className="underline decoration-line underline-offset-2">{inner}</Link> : <>{inner}</>;
}

function AmountSection({ s }: { s: ReportSection }) {
  return (
    <Card className="space-y-1.5">
      {s.rows.map((r, i) => {
        const strong = r.kind === 'total';
        const sub = r.kind === 'subtotal';
        const info = r.kind === 'info' || r.kind === 'warn';
        return (
          <div key={i} className={`${strong ? 'border-t-2 border-ink pt-2 text-lg' : sub ? 'border-t border-line pt-1' : ''}`}>
            <p className={`flex items-baseline justify-between gap-3 ${info ? 'text-muted' : ''}`}>
              <span className={strong || sub ? 'font-bold' : ''}><RowLabel r={r} /></span>
              <b className="shrink-0 tabular-nums">{r.missing || r.amount === null || r.amount === undefined ? <Dash /> : eur(r.amount, true)}</b>
            </p>
            {r.note && <p className="text-sm text-muted">{r.note}</p>}
          </div>
        );
      })}
      {s.note && <p className="pt-1 text-sm text-muted">{s.note}</p>}
    </Card>
  );
}

function TableSection({ s }: { s: ReportSection }) {
  const cols = s.columns!;
  const wide = cols.length > 3;
  return (
    <Card className="overflow-x-auto">
      <table className={`w-full text-right text-[0.9375rem] ${wide ? 'min-w-[34rem]' : ''}`}>
        <thead><tr className="text-muted"><th className="text-left font-semibold" /> {cols.map((c) => <th key={c.label} className="px-1 font-semibold">{c.label}</th>)}</tr></thead>
        <tbody>
          {s.rows.map((r, i) => (
            <tr key={i} className={`border-t ${r.kind === 'total' ? 'border-ink font-bold' : r.kind === 'subtotal' ? 'border-line font-bold' : 'border-line'} ${r.kind === 'warn' ? 'text-warn' : ''}`}>
              <td className="py-1.5 pr-2 text-left align-top font-semibold"><RowLabel r={r} />{r.note && <span className="block text-sm font-normal text-muted">{r.note}</span>}</td>
              {cols.map((c, j) => <td key={j} className="px-1 py-1.5 align-top tabular-nums">{r.missing ? <Dash /> : cell(r.cells?.[j], c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {s.note && <p className="pt-2 text-sm text-muted">{s.note}</p>}
    </Card>
  );
}

/** One report, from its document: the same document the CSV and the print are made from. */
export function ReportView({ doc }: { doc: ReportDoc }) {
  const c = doc.completeness;
  return (
    <div className="space-y-3">
      <Card className={c.complete ? '' : 'bg-warn-bg'}>
        <p className="flex items-center gap-2 font-bold"><ToneIcon tone={c.complete ? 'ok' : 'warn'} className="h-6 w-6" />{c.complete ? (doc.meta.provisional ? 'Year to date, nothing blocking' : 'Complete from your records') : 'Incomplete: read the gaps first'}</p>
        {c.reasons.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-6 text-[0.9375rem]">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        {c.notes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-muted">{c.notes.map((r) => <li key={r}>{r}</li>)}</ul>}
        <p className="mt-2 text-sm text-muted">{doc.basisNote}</p>
      </Card>
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <SectionTitle>{s.heading}</SectionTitle>
          {s.columns ? <TableSection s={s} /> : <AmountSection s={s} />}
        </section>
      ))}
      <Card className="space-y-1 text-sm text-muted">
        {doc.footnotes.map((f) => <p key={f}>{f}</p>)}
        <p>{doc.meta.farm}. {doc.meta.currency}. Rule {doc.meta.rule}. Made {doc.meta.generatedAt.slice(0, 10)}.</p>
      </Card>
    </div>
  );
}
