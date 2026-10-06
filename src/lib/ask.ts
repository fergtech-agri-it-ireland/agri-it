/**
 * Ask Agri-It (spec 3 + 10). Answers come only from the farm's own records and
 * the published rules the app already uses. There is no free-text generation, so
 * nothing can be made up: if a question isn't covered, we say so and point to
 * where the answer lives.
 */
import type { Confidence, FarmBundle } from './types';
import { COST_LABEL, type CostCategory } from './types';
import type { useDerived } from './data/derived';
import { eur, fmtDay, fmtKg, fmtNum } from './format';
import { primaryRoute } from './suppliers';
import { buildChecklist } from './routines';

export interface Answer {
  text: string;
  details: string[];
  confidence: Confidence | null;
  basis: string;
  links: { label: string; to: string }[];
  call?: { label: string; phone: string };
}

type Derived = ReturnType<typeof useDerived>;

export const SUGGESTED = [
  'When do I need to order meal?',
  'Am I okay for silage this winter?',
  'What is my cash position?',
  'How much have I spent on feed this year?',
  'What is my milk price this year?',
  'What does my accountant need?',
  'What is left to do today?'
];

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

export function ask(question: string, b: FarmBundle, d: Derived): Answer {
  const q = question.toLowerCase().trim();

  // Guardrail: no ration prescriptions (spec 2 + 11)
  if (has(q, 'how much should i feed', 'what should i feed', 'recommend', 'ration', 'how much meal should')) {
    return {
      text: 'Agri-It does not recommend feeding rates. It works out stock and run-out dates from the plan you set.',
      details: ['For rates, talk to your nutritionist or advisor with your silage analysis.', 'You can record their advice as a feeding plan and Agri-It will forecast from it.'],
      confidence: null, basis: 'Product rule: farmer controls feeding decisions', links: [{ label: 'Open feed', to: '/forecast' }]
    };
  }

  // What's still to tick off today (the checklist)
  if (has(q, 'to do', 'jobs', 'checklist', 'tick', 'left to do', 'routine')) {
    const items = buildChecklist(b, d.today);
    const open = items.filter((i) => i.status === 'pending');
    const todayOpen = open.filter((i) => i.date === d.today);
    const earlier = open.filter((i) => i.date < d.today);
    return {
      text: open.length === 0 ? 'Everything due today is ticked off.' : `${todayOpen.length} still to tick off today${earlier.length ? `, and ${earlier.length} from earlier` : ''}.`,
      details: [...todayOpen, ...earlier].slice(0, 8).map((i) => `${i.date < d.today ? `${fmtDay(i.date)}: ` : ''}${i.title}${i.sub ? ` (${i.sub})` : ''}`),
      confidence: null, basis: 'Your feeding plans and routines', links: [{ label: 'Open Today', to: '/' }, { label: 'Routines', to: '/routines' }]
    };
  }

  // Feed run-out / ordering
  const product = b.products.find((p) => !p.archived && q.includes(p.name.toLowerCase()));
  if (product || has(q, 'order', 'run out', 'runs out', 'meal', 'nut', 'ration', 'feed left', 'days of feed', 'concentrate')) {
    const list = product ? [product] : b.products.filter((p) => !p.archived);
    if (!list.length) return { text: 'You have no purchased feeds set up yet.', details: [], confidence: null, basis: 'Your records', links: [{ label: 'Add a feed', to: '/feed/new' }] };
    const fs = list.map((p) => ({ p, f: d.feed.get(p.id)! })).sort((a, c) => (a.f.orderByDate ?? a.f.reorderDate ?? '9999') .localeCompare(c.f.orderByDate ?? c.f.reorderDate ?? '9999'));
    const first = fs[0];
    const when = first.f.orderByDate ?? first.f.reorderDate;
    const supplier = b.suppliers.find((s) => s.id === first.p.supplier_id);
    const route = primaryRoute(supplier, b);
    return {
      text: first.f.stockKg === null
        ? `There's no stock count for ${first.p.name} yet, so no run-out date.`
        : when
          ? `${first.p.name}: order by ${fmtDay(when)}. It runs out around ${fmtDay(first.f.runOutDate)} at your current plan.`
          : `${first.p.name} has ${fmtKg(first.f.stockKg)} left. Add a feeding plan to get a run-out date.`,
      details: fs.map(({ p, f }) => `${p.name}: ${f.stockKg !== null ? fmtKg(f.stockKg) : 'no count'}, ${fmtKg(f.dailyUseKg)}/day${f.runOutDate ? `, runs out ${fmtDay(f.runOutDate)}` : ''}${f.leadTimeDays === null ? ' (no lead time set)' : ''}`),
      confidence: first.f.confidence,
      basis: 'Your stock records and your feeding plan (arithmetic, not a recommendation)',
      links: [{ label: `Open ${first.p.name}`, to: `/feed/${first.p.id}` }],
      call: route ? { label: `Call ${supplier?.name}`, phone: route.phone } : undefined
    };
  }

  if (has(q, 'silage', 'winter', 'fodder', 'forage', 'bales')) {
    const f = d.forage;
    const text = f.status === 'incomplete'
      ? 'Not enough information to answer yet.'
      : f.status === 'surplus' ? `Yes. You have about ${Math.round(f.balanceT!)} t more than you need, including a ${f.reservePercent}% reserve.`
      : f.status === 'tight' ? `Just about. Silage covers the winter but only ${Math.round(f.availableT - (f.needT ?? 0))} t of the ${f.reservePercent}% reserve.`
      : `No. You're about ${Math.round((f.needT ?? 0) - f.availableT)} t short before any reserve.`;
    return {
      text,
      details: [
        `In store: ${fmtNum(Math.round(f.availableT))} t fresh`,
        `Winter need: ${f.needT !== null ? fmtNum(Math.round(f.needT)) + ' t' : 'unknown'} over ${f.monthsToCover !== null ? fmtNum(f.monthsToCover) + ' months' : 'unknown months'}`,
        ...f.missing.map((m) => `Missing: ${m}`)
      ],
      confidence: f.confidence,
      basis: f.groups.some((g) => g.source === 'benchmark') ? 'Your stores + Teagasc planning allowances (S3)' : 'Your stores + your own usage figures',
      links: [{ label: 'Winter forage', to: '/forecast?tab=forage' }]
    };
  }

  if (has(q, 'cash', 'bank', 'afford', 'overdraft', 'money')) {
    if (!d.cash) return { text: 'Add your bank balance and the date it was at so Agri-It can track cash.', details: [], confidence: null, basis: 'Your records', links: [{ label: 'Settings', to: '/settings' }] };
    return {
      text: `Recorded cash position is about ${eur(d.cash.balance)}.`,
      details: [
        `Opening ${eur(d.cash.opening)} on ${fmtDay(d.cash.openingDate)}, plus ${eur(d.cash.inflow)} in, less ${eur(d.cash.outflow)} out`,
        d.cash90.lowest ? `Lowest point in the next 90 days: ${eur(d.cash90.lowest.closing)}${d.cash90.hasBudget ? ' (includes budget assumptions)' : ' (known items only)'}` : ''
      ].filter(Boolean),
      confidence: d.budget.adequate ? 'medium' : 'low',
      basis: 'Opening balance + recorded income and costs. Not a bank statement.',
      links: [{ label: 'Cash forecast', to: '/forecast?tab=cash' }]
    };
  }

  if (has(q, 'spend', 'spent', 'cost')) {
    const cat = (Object.keys(COST_LABEL) as CostCategory[]).find((c) => q.includes(c.replace('_', ' ')) || q.includes(COST_LABEL[c].toLowerCase().split(' ')[0]));
    const rows = d.yearEnd.costsByCategory.filter((r) => !cat || r.key === cat);
    const total = rows.reduce((s, r) => s + r.total, 0);
    return {
      text: `${cat ? COST_LABEL[cat] : 'Total'} spend this financial year (${d.yearEnd.fy.label}): ${eur(total)}.`,
      details: cat ? d.yearEnd.supplierTotals.slice(0, 3).map((s) => `${s.name}: ${eur(s.total)} (all categories)`) : rows.map((r) => `${r.label}: ${eur(r.total)}`),
      confidence: null, basis: 'Costs you have recorded', links: [{ label: 'Money', to: '/money' }]
    };
  }

  if (has(q, 'milk')) {
    const milk = b.income.filter((i) => i.income_type === 'milk' && i.occurred_on >= d.yearEnd.fy.start);
    const value = milk.reduce((s, i) => s + Number(i.amount_eur), 0);
    const litres = milk.reduce((s, i) => s + Number(i.milk_litres ?? 0), 0);
    return {
      text: litres > 0 ? `Average ${fmtNum((value / litres) * 100)} c/L across ${fmtNum(litres)} litres this year.` : `Milk income this year: ${eur(value)}.`,
      details: [`${milk.length} cheques recorded, total ${eur(value)}`],
      confidence: null, basis: 'Milk sales you have recorded', links: [{ label: 'Add milk cheque', to: '/record/milk' }]
    };
  }

  if (has(q, 'accountant', 'year end', 'year-end', 'tax', 'missing')) {
    return {
      text: d.yearEnd.missing.length ? `${d.yearEnd.missing.length} things to tidy up before sending the year-end pack.` : 'Your year-end pack has no gaps flagged.',
      details: [...d.yearEnd.missing.map((m) => m.text), 'The pack is a management summary, not statutory accounts or a tax calculation.'],
      confidence: null, basis: 'Completeness checks on your records', links: [{ label: 'Year-end pack', to: '/money/year-end' }]
    };
  }

  return {
    text: "I can only answer from your farm records, so I don't have an answer for that.",
    details: ['Try one of the questions below, or ask about feed, silage, cash, spending, milk or year-end.'],
    confidence: null, basis: 'No matching farm data', links: []
  };
}
