import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Landmark, Plus } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import type { Cost, Loan, LoanStatement } from '../lib/types';
import { addDays, cur, eur, fmtDate, fmtDay, todayISO, uuid } from '../lib/format';
import { balanceOn, FREQ_LABEL, KIND_LABEL, loanYear, overdraftLimit, PURPOSE_LABEL, recordedRepayments, upcomingRepayments } from '../lib/loans';
import { fyRange } from '../lib/forecast/money';
import { loanNotes } from '../lib/forecast/plan';
import { Button, Card, Empty, Explain, Field, List, NumberInput, Row, SaveBar, Screen, SectionTitle, ToneIcon } from '../components/ui';
import { LoanEditor, type LoanDraft } from '../components/LoanEditor';

/** Every loan, hire purchase, lease and overdraft: what's owed, what's next, and notes worth acting on. */
export default function Loans() {
  const b = useFarmData();
  const today = todayISO();
  const loans = (b.loans ?? []).filter((l) => !l.archived);
  const owing = loans.filter((l) => l.kind !== 'overdraft');
  const total = owing.reduce((s, l) => s + balanceOn(l, b.costs, b.loanStatements ?? [], today), 0);
  const nextAll = owing.flatMap((l) => upcomingRepayments(l, b.costs, b.loanStatements ?? [], today, today, addDays(today, 60)).slice(0, 1).map((r) => ({ l, r })))
    .sort((a, c) => a.r.on.localeCompare(c.r.on));
  const notes = loanNotes(b, today);
  const limit = overdraftLimit(loans);
  const archived = (b.loans ?? []).filter((l) => l.archived);

  return (
    <Screen title="Loans and overdraft" back="/money" right={<Link to="/money/loans/new" aria-label="Add a loan" className="flex min-h-tap min-w-tap items-center justify-center rounded-full bg-field text-white"><Plus className="h-6 w-6" /></Link>}>
      {loans.length === 0 ? (
        <Empty title="No loans added" body="Add loans, hire purchase, leases and an overdraft. Repayments go into your year plan, and the interest is split out for your accountant."
          action={<Link to="/money/loans/new" className="inline-flex min-h-tap items-center rounded-full bg-field px-5 font-bold text-white">Add a loan</Link>} />
      ) : (
        <>
          <Card>
            <div className="grid grid-cols-2 gap-2">
              <div className="amount-cell"><p className="text-sm text-muted">Owed, all loans</p><p className="numeral amount">{eur(total)}</p></div>
              <div className="amount-cell"><p className="text-sm text-muted">Overdraft limit</p><p className="numeral amount">{limit ? eur(limit) : 'None'}</p></div>
            </div>
            {nextAll[0] && <p className="mt-2 text-[0.9375rem]">Next: <b>{eur(nextAll[0].r.amount)}</b> to {nextAll[0].l.lender} on {fmtDay(nextAll[0].r.on)}.</p>}
            <p className="mt-1 text-sm text-muted">Worked out from your statement figures and the repayments you've ticked off. The bank's statement is the true figure.</p>
          </Card>
          {notes.map((n) => (
            <Card key={n.loanId + n.text} className="flex gap-3 bg-warn-bg"><ToneIcon tone="warn" className="mt-0.5 h-6 w-6 shrink-0" /><p>{n.text}</p></Card>
          ))}
          <List>
            {loans.map((l) => {
              const up = upcomingRepayments(l, b.costs, b.loanStatements ?? [], today, today, addDays(today, 400))[0];
              return (
                <Row key={l.id} to={`/money/loans/${l.id}`} icon={<Landmark className="h-6 w-6 text-accent" />}
                  title={`${l.lender} · ${KIND_LABEL[l.kind]}`}
                  sub={l.kind === 'overdraft' ? `Limit ${eur(Number(l.credit_limit_eur ?? 0))}${l.rate_percent != null ? `, ${l.rate_percent}%` : ''}`
                    : `${eur(balanceOn(l, b.costs, b.loanStatements ?? [], today))} owed${up ? `. Next ${eur(up.amount)} on ${fmtDay(up.on)}` : l.repayment_eur ? '' : '. No repayment given'}`}
                  right={<ChevronRight className="h-5 w-5 text-muted" />} />
              );
            })}
          </List>
        </>
      )}
      {archived.length > 0 && (
        <>
          <SectionTitle>Paid off</SectionTitle>
          <List>{archived.map((l) => <Row key={l.id} to={`/money/loans/${l.id}`} title={l.lender} sub={KIND_LABEL[l.kind]} right={<ChevronRight className="h-5 w-5 text-muted" />} />)}</List>
        </>
      )}
    </Screen>
  );
}

/** One loan: owed now, what's coming, repayments ticked off, and the bank's annual statements. */
export function LoanDetail() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const today = todayISO();
  const loan = (b.loans ?? []).find((l) => l.id === id) ?? null;
  const [editing, setEditing] = useState(!loan);
  const [busy, setBusy] = useState(false);
  const pay = params.get('pay');
  const [paying, setPaying] = useState(!!pay);
  const [payOn, setPayOn] = useState(pay ?? today);
  const [payAmount, setPayAmount] = useState(loan?.repayment_eur != null ? String(loan.repayment_eur) : '');
  const [payInterest, setPayInterest] = useState('');
  const lastFy = fyRange(b.farm, today, -1);
  const [stmt, setStmt] = useState(false);
  const [stOn, setStOn] = useState(lastFy.end);
  const [stBalance, setStBalance] = useState('');
  const [stInterest, setStInterest] = useState('');

  async function saveLoan(row: LoanDraft) {
    setBusy(true);
    const ok = await save(loan
      ? [{ kind: 'update', table: 'loans', match: { id: row.id }, patch: row as unknown as Record<string, unknown> }]
      : [{ kind: 'insert', table: 'loans', row: row as unknown as Record<string, unknown> }],
    { label: loan ? 'Loan updated' : `${row.lender} added`, patch: (x) => ({ ...x, loans: loan ? (x.loans ?? []).map((l) => (l.id === row.id ? { ...l, ...row } : l)) : [...(x.loans ?? []), row as Loan] }) });
    setBusy(false);
    if (ok) { setEditing(false); if (!loan) nav(`/money/loans/${row.id}`, { replace: true }); }
  }
  if (!loan || editing) {
    return (
      <Screen title={loan ? `Change ${loan.lender}` : 'Add a loan'} back={loan ? true : '/money/loans'}>
        <Card><LoanEditor farmId={farmId!} jurisdiction={b.farm.jurisdiction} existing={loan} onSave={saveLoan} busy={busy} onCancel={loan ? () => setEditing(false) : undefined} /></Card>
      </Screen>
    );
  }

  const statements = (b.loanStatements ?? []).filter((s) => s.loan_id === loan.id).sort((a, c) => c.period_end.localeCompare(a.period_end));
  const owed = balanceOn(loan, b.costs, b.loanStatements ?? [], today);
  const coming = upcomingRepayments(loan, b.costs, b.loanStatements ?? [], today, today, addDays(today, 400)).slice(0, 4);
  const paid = recordedRepayments(loan, b.costs).sort((a, c) => (c.paid_on ?? c.occurred_on).localeCompare(a.paid_on ?? a.occurred_on));
  const thisYear = loanYear(loan, b.costs, b.loanStatements ?? [], fyRange(b.farm, today), today);

  async function recordPayment() {
    setBusy(true);
    const row: Cost = {
      id: uuid(), farm_id: farmId!, category: 'loan_repayment', other_label: null, occurred_on: payOn, amount_eur: Number(payAmount), supplier_id: null, supplier_name: loan!.lender,
      feed_transaction_id: null, description: `${loan!.lender} repayment`, document_id: null, payment_status: 'paid', paid_on: payOn, due_on: null, invoice_ref: null,
      vat_eur: null, enterprise: null, loan_id: loan!.id, interest_eur: payInterest === '' ? null : Math.min(Number(payInterest), Number(payAmount))
    };
    const ok = await save([{ kind: 'insert', table: 'costs', row: row as unknown as Record<string, unknown> }], { label: 'Repayment recorded', patch: (x) => ({ ...x, costs: [row, ...x.costs] }),
      undo: [{ kind: 'delete', table: 'costs', match: { id: row.id } }] });
    setBusy(false);
    if (ok) { setPaying(false); setPayInterest(''); }
  }
  async function saveStatement() {
    setBusy(true);
    const existing = statements.find((s) => s.period_end === stOn);
    const row: LoanStatement = { id: existing?.id ?? uuid(), farm_id: farmId!, loan_id: loan!.id, period_end: stOn, balance_eur: stBalance === '' ? null : Number(stBalance), interest_eur: stInterest === '' ? null : Number(stInterest), document_id: existing?.document_id ?? null };
    const ok = await save(existing
      ? [{ kind: 'update', table: 'loan_statements', match: { id: row.id }, patch: { balance_eur: row.balance_eur, interest_eur: row.interest_eur } }]
      : [{ kind: 'insert', table: 'loan_statements', row: row as unknown as Record<string, unknown> }],
    { label: 'Statement saved', patch: (x) => ({ ...x, loanStatements: [...(x.loanStatements ?? []).filter((s) => s.id !== row.id), row] }) });
    setBusy(false);
    if (ok) { setStmt(false); setStBalance(''); setStInterest(''); }
  }
  async function archive(on: boolean) {
    await save([{ kind: 'update', table: 'loans', match: { id: loan!.id }, patch: { archived: on } }], { label: on ? 'Moved to paid off' : 'Back on the list', patch: (x) => ({ ...x, loans: (x.loans ?? []).map((l) => (l.id === loan!.id ? { ...l, archived: on } : l)) }) });
  }
  const od = loan.kind === 'overdraft';

  return (
    <Screen title={loan.lender} back="/money/loans" sub={`${KIND_LABEL[loan.kind]}${loan.purpose ? `, ${PURPOSE_LABEL[loan.purpose].toLowerCase()}` : ''}`}>
      <Card>
        {od ? (
          <p className="text-lg"><b>Limit {eur(Number(loan.credit_limit_eur ?? 0))}</b>{loan.rate_percent != null ? `, ${loan.rate_percent}%` : ''}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="amount-cell"><p className="text-sm text-muted">Owed now (worked out)</p><p className="numeral amount">{eur(owed)}</p></div>
              <div className="amount-cell"><p className="text-sm text-muted">Rate</p><p className="numeral amount">{loan.rate_percent != null ? `${loan.rate_percent}%` : 'Not given'}</p></div>
            </div>
            <p className="mt-1 text-sm text-muted">{eur(Number(loan.balance_eur))} on {fmtDate(loan.balance_on)}{statements[0]?.balance_eur != null && statements[0].period_end > loan.balance_on ? `; ${eur(Number(statements[0].balance_eur))} on the statement to ${fmtDate(statements[0].period_end)}` : ''}, less what you've repaid since.</p>
            {loan.repayment_eur && loan.frequency && <p className="mt-1">{eur(Number(loan.repayment_eur))} {FREQ_LABEL[loan.frequency].toLowerCase()}{loan.skip_months.length ? `, none in ${loan.skip_months.map((m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]).join(', ')}` : ''}{loan.ends_on ? `, ends ${fmtDate(loan.ends_on)}` : ''}.</p>}
          </>
        )}
      </Card>

      {!od && coming.length > 0 && (
        <>
          <SectionTitle>Coming up</SectionTitle>
          <Card className="space-y-1.5">
            {coming.map((r) => (
              <p key={r.on} className="flex justify-between gap-2"><span>{fmtDay(r.on)}{r.amountEstimated ? ' (worked out)' : ''}</span>
                <span className="text-right"><b>{eur(r.amount, true)}</b>{r.interest !== null && <span className="block text-sm text-muted">about {eur(r.interest, true)} interest</span>}</span></p>
            ))}
            <Explain>
              Interest each time = what's owed × {loan.rate_percent ?? '?'}% × days since the last repayment ÷ 365. It's an estimate, close for most farm loans; the bank's annual statement gives the real figure. Rule loans@1.0.
            </Explain>
          </Card>
        </>
      )}

      {!od && (
        <>
          <SectionTitle action={!paying ? <button className="min-h-tap px-2 font-bold text-accent" onClick={() => setPaying(true)}>Record one</button> : undefined}>Repayments ticked off</SectionTitle>
          {paying && (
            <Card className="space-y-4">
              <Field label="Came out on" htmlFor="pay-on"><input id="pay-on" type="date" className="input" max={today} value={payOn} onChange={(e) => setPayOn(e.target.value)} /></Field>
              <NumberInput label="Amount" unit={cur()} value={payAmount} onChange={setPayAmount} />
              <NumberInput label="Of which interest (optional)" unit={cur()} value={payInterest} onChange={setPayInterest} hint="Only if the bank shows it. Blank = Agri-It estimates it, and says so." />
              <div className="flex gap-2"><Button variant="secondary" onClick={() => setPaying(false)}>Cancel</Button><Button block disabled={!(Number(payAmount) > 0) || busy} onClick={recordPayment}>Save repayment</Button></div>
            </Card>
          )}
          {paid.length ? (
            <List>{paid.slice(0, 12).map((c) => <Row key={c.id} title={eur(Number(c.amount_eur), true)} sub={`${fmtDay(c.paid_on ?? c.occurred_on)}${c.interest_eur != null ? `, ${eur(Number(c.interest_eur), true)} interest` : ''}`} />)}</List>
          ) : !paying && <Card><p className="text-muted">None yet. When one falls due, Agri-It asks on the dashboard if it came out.</p></Card>}
          <Card className="text-[0.9375rem]">
            <p className="font-bold">This year so far</p>
            <p>Repaid {eur(thisYear.repaid)} in {thisYear.repayments} repayment{thisYear.repayments === 1 ? '' : 's'}. Interest {thisYear.interest === null ? 'not known (no rate given)' : `${eur(thisYear.interest, true)} (${thisYear.interestBasis === 'statement' ? 'bank statement' : thisYear.interestBasis === 'recorded' ? 'from your repayments' : 'estimate'})`}.</p>
          </Card>
        </>
      )}

      <SectionTitle action={!stmt ? <button className="min-h-tap px-2 font-bold text-accent" onClick={() => setStmt(true)}>Add</button> : undefined}>Annual statements</SectionTitle>
      {stmt && (
        <Card className="space-y-4">
          <Field label="Statement up to" htmlFor="st-on" hint="Banks send one each year. Your accountant needs the interest on it.">
            <input id="st-on" type="date" className="input" max={today} value={stOn} onChange={(e) => setStOn(e.target.value)} />
          </Field>
          {!od && <NumberInput label="Owed on that day" unit={cur()} value={stBalance} onChange={setStBalance} />}
          <NumberInput label="Interest charged in the period" unit={cur()} value={stInterest} onChange={setStInterest} />
          <div className="flex gap-2"><Button variant="secondary" onClick={() => setStmt(false)}>Cancel</Button><Button block disabled={(stBalance === '' && stInterest === '') || busy} onClick={saveStatement}>Save statement</Button></div>
        </Card>
      )}
      {statements.length ? (
        <List>{statements.map((s) => <Row key={s.id} title={`To ${fmtDate(s.period_end)}`} sub={[s.balance_eur != null ? `${eur(Number(s.balance_eur))} owed` : null, s.interest_eur != null ? `${eur(Number(s.interest_eur), true)} interest` : null].filter(Boolean).join(', ')} />)}</List>
      ) : !stmt && <Card><p className="text-muted">None added. The year-end pack flags it until you do.</p></Card>}

      <SaveBar>
        <Button variant="secondary" onClick={() => archive(!loan.archived)}>{loan.archived ? 'Not paid off' : 'Paid off'}</Button>
        <Button block onClick={() => setEditing(true)}>Change details</Button>
      </SaveBar>
    </Screen>
  );
}
