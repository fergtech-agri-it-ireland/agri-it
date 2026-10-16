# Set up your farm, loans and the year plan (16 October 2026, release 0.3.0)

Feargal's brief: onboarding in stages and steps, built from what the farmer has already said, gathering daily tasks, key details and key metrics in the most farmer-friendly way, filling in what can be filled in (start dates and the like); a more complete financial planner and tracker for the accountant at year end; loans with their payment dates and interest.

## What changed

### Sign-up is two steps
Farm (name, Republic or NI, county, Eircode) and what you farm. The farm is created there, with the financial year most farms on that side of the border use (January ROI, April NI; confirmed later). Everything else moved into **Set up your farm**.

### Set up your farm (`/setup`, `lib/setup.ts`, rule `setup@1.0`)
Stages of a few short steps. Each step saves as it goes, every step can be skipped, and a stage can be reopened any time to change things. The dashboard card shows the next stages until all are done or skipped (replaces Getting started; More also links to it).

| Stage | Steps | Only when |
| --- | --- | --- |
| Your farm | Land (acres owned, rented in; rent for the year and the month paid becomes a yearly bill), herd number and VAT (flat-rate or registered) | always |
| Your animals | Groups and breeds; in for the winter or out (tap-a-month chips for housing and turnout, each group in or out); calving | animals, or farm types not picked. Calving: dairy or suckler |
| Feeding | Meal or nuts bought (supplier, feed, what's in the bin, which groups get how much, delivery days) in one screen; silage pit (paced-out size) or bales | animals. Silage: grazing farm types |
| Crops and fields | Crops this harvest; link to Fields | tillage |
| Daily and weekly jobs | Pick list for the farm types, how often, own words | always |
| Money coming in | Milk buyer and the day the cheque comes (a monthly reminder, no amount assumed); scheme payments on their published dates | milk: dairy |
| Regular bills | Rent, electricity (every 2 months), phone, insurance (yearly), accountant, adviser, wages, contractor, vet, diesel, household | always |
| Loans and overdraft | No (marks done) or each loan: lender, kind, purpose, owed now and as on, rate (optional, never guessed), repayment, how often, next date, months with no repayment, interest-only until, end date; overdraft limit | always |
| Bank and year end | Account in credit or overdrawn; financial year; accountant | always |

Filled in for the farmer, each with where it comes from:
- **First calf due**: Teagasc's spring dairy target (mean calving 5 to 15 Feb, calving starting 15 to 20 days before: about 23 Jan); suckler, the Teagasc Suckler Breeding Targets example (7 Feb). Labelled; the button says "Use this date" until changed.
- **Housing and turnout**: no published typical date exists (Teagasc: base it on how long they were in last winter, plus a month), so month chips, not a filled date.
- **Feeds a day**: twice for dairy cows (at milking), once for others. The kg is always the farmer's: Agri-It never prescribes a ration.
- **Financial year**: January (ROI, income tax is for the calendar year); April (NI, profits taxed on the tax year since 2024/25, accounts to 31 March or 5 April count as the tax year, gov.uk Basis period reform).
- **Bill frequencies**: electricity every 2 months, insurance and rent yearly, the rest monthly; the farmer changes any.
- **Scheme dates and splits** (`lib/schemes.ts`, rule `schemes@1.0`): below.

### Scheme payments (`/money/payments`)
The farmer ticks the schemes and gives the year's total (from AgFood or DAERA); Agri-It places it on the published dates. Never income until the farmer says it came in (Ready to approve asks on the day: "Yes, that amount" or "Different amount").

| Scheme | Split and timing | Source (checked 16 Oct 2026, recheck by 16 Apr 2027) |
| --- | --- | --- |
| BISS and CRISS | 75% from 16 Oct, rest early Dec | Agriland 21 Aug 2026; Irish Farmers Journal 9 Sep 2026 |
| Eco-scheme | 75% from 16 Oct, rest early Dec | Agriland 16 Oct 2026 (payments began that day); Agriland 21 Aug 2026 |
| ANC | 85% from 16 Sep, rest early Dec | Irish Farmers Journal 9 Sep 2026 |
| ACRES | 85% advance in November, balance the next April | gov.ie 20 Apr 2026 (2025 year: advance from 10 Nov 2025, balance from 15 Apr 2026) |
| Sheep Improvement Scheme | 85% from late Nov, rest the next April | Agriland 24 Nov 2025 |
| SCEP, Young farmer (CIS-YF) | early December | Farmers' Charter timeline (Agriland 4 Jul 2024) |
| NI Farm Sustainability Payment | from early September | Irish Farmers Journal 2 Sep 2026 |

Anything else (TAMS, forestry) is added with the farmer's own date. A release gate fails the build 30 days after the recheck date.

### Loans (`/money/loans`, `lib/loans.ts`, rule `loans@1.0`)
- Repayment dates step from the next due date by the frequency, keep the day (clamped to short months) and leave out months with no repayment (milk-linked loans).
- Interest per repayment = owed × rate × days since the last one ÷ 365; labelled an estimate. With no rate, interest is not worked out. After an interest-only period, the repayment is worked out from the end date and rate (annuity) and labelled worked out.
- Owed now = the latest known balance (the farmer's, as at the start of its day, or a later bank statement) less the capital part of each repayment recorded since.
- Each due repayment: "Did the AIB repayment come out?" in Ready to approve (Yes records it; Different amount opens the loan). Nothing is recorded until the farmer says so.
- Annual statement per loan (balance and interest for the period): the accountant's figure, and it beats the estimate.
- Interest typed on a repayment is kept on the cost (`costs.interest_eur`) and goes in the transaction export.

### Year plan (`/money/plan`, `lib/forecast/plan.ts`, rule `year-plan@1.0`)
Teagasc's cash flow budget layout (Creating a cash flow budget): money in; farm costs; loans and leases; machinery, buildings and land; household; net; bank carried forward to spot the months the overdraft may be breached. For each line and month, planned against actual. Planned comes from repeats, loan schedules, scheme dates, bills still owed, and the farmer's budget where none of those already covers that month (never counted twice). The bank figure is recorded for closed months and projected from today's recorded cash for the rest; next year carries on from this year's plan. The lowest point is shown against the overdraft limit.

The 90-day cash forecast now counts loan repayments and scheme payments too ("Repeats, loans and schemes").

### Budget (`/money/budget`)
Financial year, line by line, month by month (or the same every month), with **Fill from last year's records** (what was actually received and paid in each month of the year before). Lines a loan, repeat or scheme already plans say so.

### Year-end pack for the accountant
Added to the screen, summary CSV and the zip: loans (owed at start and end and where each figure came from, repaid, interest and its basis), interest in the year, scheme payments received, capital spending listed, household drawings (kept out of farm costs), livestock numbers at the start and end of the year, herd number, VAT status, acres, accountant; and **what to gather**, from the Irish Farmers Journal's list of what accountants ask for (Money Mentor, 18 Feb 2026): bank statements, sales dockets, invoices, the AgFood or DAERA payment statement, each loan's annual statement (flagged until added), capital invoices, livestock numbers and values at the year end (stock relief), VAT returns or VAT 58 refund claims (flat-rate), wages with PAYE and PRSI.

New cost categories: Land rent, Wages, Insurance, Accountant & advice, Household (drawings, not a farm cost).

## Data
Migrations `20261016000100_setup_enums.sql` (cost categories) and `20261016000200_setup_planner.sql`: farm details and `setup` marks; `routines.interval_months`; `loans`, `loan_statements`, `expected_income` (money tables: owner and family write, adviser reads, worker sees nothing; touch and audit triggers); `costs.loan_id`, `costs.interest_eur`; phone import updated. No deletes or drops. `supabase/remote/setup_agri_it.sql` regenerated. Phone data needs no migration (phone `VERSION` stays 1; every new field is optional). `CACHE_VERSION` `v8-setup-loans`, demo `VERSION` 10.

## Tests
- Unit: `setupPlanner.test.ts` (32: loan dates, interest by hand, recorded repayments, statements, schemes, every-N-months routines, setup stages, year plan by hand, year-end pack), scheme timing release gate. 307 in all.
- Browser: `planner.py` (35, demo build), `phone.py` rewritten for the new sign-up and stages (56), `ui.py` setup card checks.
- Database: `db_review.sql` +16 checks (loans RLS for worker, adviser and outsiders, constraints, cascades, audit, every-12-months routine).

## Not built yet
- Reading an annual loan statement or AgFood statement from a photo.
- Lambing season (sheep) in the calving step.
- Stock values at the year end (numbers only; the accountant values them).
- Making Tax Digital (NI, over £50,000 from April 2026, £30,000 from April 2027): Agri-It is not MTD software; the pack is for the accountant.
- A loan suggestion when the plan dips past the overdraft (the board's B8 waits for pilot data).

## Sources
- Teagasc, Creating a cash flow budget: https://teagasc.ie/wp-content/uploads/2025/05/Creating_a_cash_flow_budget_KC2010.pdf
- Irish Farmers Journal, Money Mentor (what accountants need), 18 Feb 2026: https://www.farmersjournal.ie/finance/money-mentor/money-mentor-why-does-my-accountant-need-so-much-paperwork-901739
- Teagasc, Calving date impacts on feed and forage costs: https://teagasc.ie/news--events/daily/calving-date-impacts-on-feed-and-forage-costs/
- Teagasc, Suckler Breeding Targets: https://teagasc.ie/wp-content/uploads/uploads/media/website/publications/2020/Suckler-Breeding-Targets.pdf
- Teagasc, Calculate fodder demand for winter: https://teagasc.ie/news--events/daily/calculate-fodder-demand-for-winter/
- gov.uk, Basis period reform: https://www.gov.uk/government/publications/basis-period-reform/basis-period-reform
- gov.uk, Making Tax Digital first quarterly update (30 Sep 2026): https://www.gov.uk/government/news/deadline-approaches-for-first-making-tax-digital-quarterly-update
- Revenue, stock relief (TDM 23-02-02): https://revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-23/23-02-02.pdf
- Agriland, flat-rate addition 4.5% from 1 Jan 2026 and VAT 58: https://www.agriland.ie/farming-news/flat-rate-farmers-got-e66m-back-in-vat-refund-claims-in-2025/
- AIB farm development loans (repayment options, terms): https://aib.ie/business/loans-and-finance/farm-development-loans
- Scheme sources: see the table above and `lib/schemes.ts`.
