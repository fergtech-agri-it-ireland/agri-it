import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFarmData, useSave } from '../lib/data/farm';
import { markOwed, markPaid, moneyStates, owedBySupplier, paidOn, payeeOf, type OwedBill } from '../lib/forecast/bills';
import { COST_LABEL, type Cost } from '../lib/types';
import { addDays, eur, fmtDay, fmtKg, todayISO } from '../lib/format';
import { Button, Card, DateChips, Empty, LinkButton, Screen, SectionTitle, Sheet, ToneIcon } from '../components/ui';

/**
 * Bills to pay (review gap P0): what is owed, to whom, and when it is due. Paying a bill
 * moves the cash on the day it was paid; the cost itself was already counted when it was
 * incurred, so nothing is counted twice. Open orders are shown apart as money committed.
 */
export default function Bills() {
  const b = useFarmData();
  const save = useSave();
  const today = todayISO();
  const groups = owedBySupplier(b, today);
  const states = moneyStates(b, today);
  const [paying, setPaying] = useState<{ title: string; bills: OwedBill[] } | null>(null);
  const [on, setOn] = useState(today);
  const recentPaid = b.costs
    .filter((c) => c.payment_status !== undefined && paidOn(c) !== null && paidOn(c)! >= addDays(today, -30) && paidOn(c)! <= today && (c.due_on || c.invoice_ref || c.feed_transaction_id))
    .sort((a, c) => paidOn(c)!.localeCompare(paidOn(a)!))
    .slice(0, 8);

  async function pay() {
    const list = paying!.bills;
    setPaying(null);
    const ids = new Set(list.map((o) => o.cost.id));
    await save(list.map((o) => ({ kind: 'update' as const, table: 'costs', match: { id: o.cost.id }, patch: markPaid(on) })), {
      label: `Paid ${eur(list.reduce((s, o) => s + Number(o.cost.amount_eur), 0), true)}${list.length > 1 ? ` (${list.length} bills)` : ''}. Cash updated`,
      patch: (x) => ({ ...x, costs: x.costs.map((c) => (ids.has(c.id) ? { ...c, ...markPaid(on) } : c)) }),
      undo: list.map((o) => ({ kind: 'update' as const, table: 'costs', match: { id: o.cost.id }, patch: { ...markOwed(), due_on: o.cost.due_on ?? null } })),
      undoLabel: 'Back to owed'
    });
  }
  const unpay = (c: Cost) => save([{ kind: 'update', table: 'costs', match: { id: c.id }, patch: markOwed() }], {
    label: 'Marked as not paid', patch: (x) => ({ ...x, costs: x.costs.map((y) => (y.id === c.id ? { ...y, ...markOwed() } : y)) })
  });
  const what = (c: Cost) => c.description ?? (c.category === 'other' ? c.other_label ?? 'Other' : COST_LABEL[c.category]);

  return (
    <Screen title="Bills to pay" back="/money">
      <Card>
        <div className="grid grid-cols-3 gap-2">
          <div><p className="text-sm text-muted">Owed</p><p className="numeral text-2xl">{eur(states.owedTotal)}</p></div>
          <div><p className="text-sm text-muted">Overdue</p><p className={`numeral text-2xl ${states.overdueTotal > 0 ? 'text-danger' : ''}`}>{eur(states.overdueTotal)}</p></div>
          <div><p className="text-sm text-muted">On order</p><p className="numeral text-2xl">{eur(states.committedTotal)}</p></div>
        </div>
        <p className="mt-2 text-sm text-muted">Owed bills are already in your costs. Cash moves on the day you mark them paid. Orders are money promised but not billed yet{states.committedUnpriced ? `; ${states.committedUnpriced} order${states.committedUnpriced > 1 ? 's have' : ' has'} no price` : ''}.</p>
      </Card>

      {groups.length === 0 ? (
        <Empty title="Nothing owed" body="Bills saved as still to pay, and feed bought on account, show here until they are paid."
          action={<LinkButton to="/record/cost?owed=1" variant="secondary">Add a bill to pay</LinkButton>} />
      ) : groups.map((g) => (
        <section key={g.payee} aria-label={g.payee} className="overflow-hidden rounded-[1.125rem] bg-card shadow-lift">
          <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5">
            <h2 className="text-[1.0625rem] font-bold">{g.payee}</h2>
            <span className="font-bold">{eur(g.total, true)}</span>
          </div>
          <ul className="mt-1 divide-y divide-line">
            {g.bills.map((o) => (
              <li key={o.cost.id} className="flex min-h-[3.75rem] items-center gap-3 px-4 py-2">
                {o.state === 'overdue' && <ToneIcon tone="warn" className="h-5 w-5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9375rem] font-semibold leading-snug">{what(o.cost)}{o.cost.invoice_ref ? `, inv. ${o.cost.invoice_ref}` : ''}</p>
                  <p className={`text-[0.8125rem] ${o.state === 'overdue' ? 'font-bold text-warn' : 'text-muted'}`}>
                    {o.dueOn ? (o.state === 'overdue' ? `Overdue since ${fmtDay(o.dueOn)}` : `Due ${fmtDay(o.dueOn)}`) : 'No due date'}. {o.cost.feed_transaction_id && !o.cost.invoice_ref ? 'Docket price, invoice not matched. ' : ''}From {fmtDay(o.cost.occurred_on)}
                  </p>
                </div>
                <span className="shrink-0 font-bold">{eur(Number(o.cost.amount_eur), true)}</span>
                <Button variant="secondary" className="shrink-0" onClick={() => { setOn(today); setPaying({ title: `${g.payee}: ${what(o.cost)}`, bills: [o] }); }}>Pay</Button>
              </li>
            ))}
          </ul>
          {g.bills.length > 1 && (
            <button onClick={() => { setOn(today); setPaying({ title: `Everything owed to ${g.payee}`, bills: g.bills }); }}
              className="min-h-[3rem] w-full border-t border-line px-4 text-left text-sm font-bold text-accent">Paid the statement: all {g.bills.length}, {eur(g.total, true)}</button>
          )}
          {g.bills.some((o) => o.cost.feed_transaction_id && !o.cost.invoice_ref) && (
            <Link to={`/record/invoice${g.supplierId ? `?supplier=${g.supplierId}` : ''}`} className="flex min-h-[3rem] items-center border-t border-line px-4 text-sm font-bold text-accent">Match the invoice to these deliveries</Link>
          )}
        </section>
      ))}

      {states.committed.length > 0 && (
        <>
          <SectionTitle>On order (not billed yet)</SectionTitle>
          <Card className="space-y-2">
            {states.committed.map((c) => (
              <div key={c.orderId} className="flex justify-between gap-2 text-[0.9375rem]">
                <span>{c.kind === 'fertiliser' ? b.fertilisers.find((p) => p.id === c.productId)?.name ?? 'Fertiliser' : b.products.find((p) => p.id === c.productId)?.name ?? 'Feed'}, {fmtKg(c.remainingKg)}{c.expected ? `, due ${fmtDay(c.expected)}` : ''}</span>
                <b>{c.value === null ? 'No price' : `${eur(c.value)}${c.priceSource === 'last_paid' ? '*' : ''}`}</b>
              </div>
            ))}
            {states.committed.some((c) => c.priceSource === 'last_paid') && <p className="text-sm text-muted">* At the last price you paid: no price was agreed on the order.</p>}
          </Card>
        </>
      )}

      {recentPaid.length > 0 && (
        <>
          <SectionTitle>Paid in the last 30 days</SectionTitle>
          <Card className="space-y-2">
            {recentPaid.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 text-[0.9375rem]">
                <span className="min-w-0 flex-1">{payeeOf(c, b)}: {what(c)}<span className="block text-sm text-muted">Paid {fmtDay(paidOn(c))}</span></span>
                <b>{eur(Number(c.amount_eur), true)}</b>
                <Button variant="ghost" onClick={() => unpay(c)}>Not paid</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      <Sheet open={!!paying} onClose={() => setPaying(null)} title={paying?.title ?? ''}>
        {paying && (
          <div className="space-y-4 pb-2">
            <p className="text-lg">{eur(paying.bills.reduce((s, o) => s + Number(o.cost.amount_eur), 0), true)}{paying.bills.length > 1 ? ` across ${paying.bills.length} bills` : ''}</p>
            <DateChips label="Paid on" value={on} onChange={setOn} />
            <Button block onClick={pay}>Mark paid</Button>
            <p className="text-sm text-muted">Comes off cash on {fmtDay(on)}. The cost itself is not added again.</p>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
