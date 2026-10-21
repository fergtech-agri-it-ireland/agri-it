# Reports module (21 October 2026, release 0.5.0)

Feargal's brief: a reports module with the key reports for end of year accounting and basic reports for stock, animals, income and expenses, compliant with basic accounting principles, researched first.

## What this is, and what it is not

Agri-It keeps single-entry farm records (money in, money out, stock, animals). It is not a double-entry ledger, so it does **not** produce a trial balance, a nominal ledger or statutory accounts, and no report says it does. What it produces are **management reports** laid out the way Teagasc and Irish farm accountants lay them out, built only from what the farmer recorded, with the basis stated on every page, so an accountant can pick them up and finish the job. Every report says: "Management report from the records in Agri-It. Not statutory accounts and not a tax computation."

## What the research says (checked 21 October 2026, recheck by 21 April 2027)

| Point | Source | What Agri-It does |
| --- | --- | --- |
| Records must show the amounts and sources of all income and all outgoings, assets and liabilities, and the acquisition and disposal of chargeable assets, with the linking documents behind the accounts. Keep six years. Invoices or bank statements alone are not enough. | Revenue Operational Manual 38-03-17 (s.886 TCA 1997); Revenue "Keeping records" | Every report line traces to ledger rows with Agri-It ids; CSV carries the ids and attachment names; footer states the six years (Republic). |
| Northern Ireland: keep records at least five years after the 31 January submission deadline. | gov.uk, Business records if you're self-employed | Footer states it for NI farms. |
| Stock is valued at the lower of cost and net realisable value, applied consistently. Production cost is the primary basis. Deemed cost (60% of market value for cattle, 75% for sheep, pigs and crops) only where actual cost cannot be established. FIFO or weighted average, never LIFO. Fertiliser bought but not yet spread is valued at cost. Home-produced silage and hay need not be valued under the tax guidance. | SCSI Farm Stocktaking Valuations Information Paper; HMRC Business Income Manual BIM55410 (Helpsheet 232) | Feed and fertiliser stock at FIFO cost from priced deliveries, never above cost, unpriced kg shown as unvalued. Livestock and crops in store are valued by the farmer or accountant with the basis named; Agri-It never invents a value. Silage in tonnes only. Deemed cost offered as a basis, with its source. |
| Biological assets (livestock, crops) use the fair value model or the cost model, chosen per class and applied consistently; once fair value is adopted you cannot go back. Disclosures include the basis and a reconciliation of movements. | CPA Ireland, Accounting for Agriculture under FRS 102 (Section 34) | The basis is stored per valuation, a change from last year's basis is flagged, and the animals report reconciles head counts. |
| Stock relief is a deduction for an increase in the value of farm trading stock (livestock, crops, feed, fertiliser, seeds). General rate 25% of the increase; not machinery or diesel. Tax years to 2027. Claimed on Form 11. | Revenue Tax and Duty Manual 23-02-02 | The profit report shows the increase in stock value and a note. The relief itself is the accountant's. |
| Capital allowances: plant and machinery 12.5% a year over 8 years; farm buildings and structures over 7 years (15% for six years, 10% in the last); qualifying slurry storage and equipment 50% a year over two years for spend from 1 Jan 2023 to 31 Dec 2029. Grants reduce the qualifying spend. | Revenue Tax and Duty Manual 23-01-37 | Capital spending is listed and kept out of profit. The rates are shown as information for the accountant. Allowances are not computed. |
| Farm balance sheet: assets (land, buildings, machinery, entitlements, livestock, feed, fertiliser, unsold produce, cash) less liabilities (lenders, input suppliers) equals net worth. A start-of-year and an end-of-year picture, with the movements between them. | Teagasc, Business Management: Underappreciated, the balance sheet | Balance sheet at year end with last year's alongside, net worth, and a net worth movement that shows what is left unexplained rather than forcing it to balance. |
| Profit Monitor layout: gross output, variable costs, gross margin, fixed costs (labour, machinery, depreciation, leases, interest), net profit. | Teagasc eProfit Book 2016 | Profit report follows this layout. Depreciation is shown as "not included" so the result is never mistaken for a final profit. |
| Cash flow grouped as money in, farm costs, loans and leases, machinery buildings and land, household, net, bank carried forward. | Teagasc, Creating a cash flow budget (already used by the Year plan) | Cash flow report uses the same groups, by month. |
| What accountants ask for: bank statements, VAT, livestock numbers and values at both ends of the year, stock relief records, loan statements, capital invoices, wages. | Irish Farmers Journal, Money Mentor, 18 Feb 2026 | Already in the year-end checklist; the reports checks panel uses the same list. |
| A farm with a current herd basis election in the UK cannot use the cash basis. Herd basis is a tax election. | gov.uk, Cash basis: who can use it; HMRC HS224 | NI notes say so. Agri-It does not apply herd basis; tell your accountant if you use it. |

Not confirmed this session, so not claimed as a source: the exact wording of FRS 102 Section 2 (going concern, consistency, offsetting), FRS 105 for micro-entities, and Revenue's valuation basis for stock relief (TDM 23-02-02 does not state it). Where Agri-It follows those ideas it says "Agri-It's rule", not "the standard says".

## The reports

All sit under **Reports** (module tile on the dashboard, a row in Money, a link from the Year-end pack). This year or last year; the screen, the print and the CSV come from one document (`ReportDoc`, `lib/reports/doc.ts`), so they cannot disagree. Print and CSV work in the installed app; the demo and the preview frame show the report on screen (CSV can be copied in the frame).

**Built in 0.5.0**

| Report | What it shows | Basis |
| --- | --- | --- |
| **Profit report** (Teagasc layout) | Output (sales by type, plus the change in livestock, crops in store, money owed to you when valued, and feed and fertiliser in store at cost), direct costs (feed, fertiliser, seed and sprays, vet, contractor, livestock bought), gross margin, overheads, loan interest, profit before depreciation and capital allowances. Beneath, kept out of profit: loan capital repaid, machinery buildings and land bought, household drawings. Stock relief (ROI) or herd basis (NI) note. | Accruals (default) or cash |
| **Cash flow** | Money in by type, money out by type, loan interest and capital split, machinery buildings and land, household, cash at the start and end, with the difference to the recorded bank balance (must be 0.00). | Cash (paid and received dates) |
| **Balance sheet** | Assets (cash, money owed to you, livestock, crops, feed and fertiliser at cost, machinery, buildings, land, other) and liabilities (loans, bills owed) at the start and end, net worth, and how net worth moved (profit, drawings, and "other changes" shown, never forced). Values listed with the basis used. | At a date |
| **Stock** | Feed and fertiliser at the start and end in kg, closing value at cost, kg with no price recorded (not valued), increase in value. | Quantity and FIFO cost |
| **Animals** | Per group: start, born, added, moved in, sold, moved out, reduced by hand, end; each group must add up; livestock sales; value at the year end if entered. | Numbers, then value |
| **Income** | By type, milk litres and average price, animals sold and average per head, every receipt. | Received date |
| **Expenses** | By type with VAT, paid and still owed, biggest suppliers, every cost. | Date incurred |
| **Do the reports agree?** | Income and expenses agree with the profit report, cash flow agrees with the bank balance, animal counts add up, sales match head counts, livestock valued, loan interest known, overdue and undated bills, documents attached, VAT recorded, stock priced, net worth movement explained. "Fix" blocks relying on the year-end figures; "Check" is worth a look. | Checks |

The existing **Year-end pack** stays and links to these. Its accountant zip now has a `reports/` folder with each report as CSV.

**Not built yet (candidates for 0.5.x)**

- By-month tables on cash flow, income and expenses.
- Money owed to suppliers aged at the year end (not yet due, 1 to 30, 31 to 60, 61 to 90, over 90 days).
- Stock report columns for delivered, adjusted (with reasons) and used; silage and bales in tonnes with a value.
- The cut-off list (items dated within 14 days of the year end) and evidence coverage in the checks.
- Record ids and attachment names in the CSV, and opening a figure to the records behind it (rows link to the screen that holds them, not to the single record).
- Price per head and per litre by group.

## Rules of the book

1. **State the basis on every report** and on every figure that depends on it. Accruals: costs by date incurred (owed bills included), income when received plus the change in money owed to the farm if entered, stock movements if valued. Cash: paid and received dates only.
2. **A year in progress is provisional**; the closing stock is not valued yet, and the report says so.
3. **No invented values.** Livestock, crops in store, machinery, buildings, land and money owed to the farm are the farmer's (or the accountant's) figures with a named basis. If a boundary value is missing, the report says "not valued" and the profit is labelled incomplete with the reason. Agri-It never carries last year's value forward silently.
4. **Cost, not above cost.** Feed and fertiliser at FIFO cost, never above what was paid; stock lost or wasted was taken off by adjustments. Agri-It holds no net realisable value data, so it does not write stock down below cost; the farmer enters a net realisable value for anything he knows is worth less.
5. **Consistency.** FIFO every year. A valuation basis that differs from last year's for the same class is flagged.
6. **VAT.** VAT-registered farms: costs are shown net of the VAT recorded on them; costs with no VAT recorded are counted gross and flagged. Flat-rate farmers: costs gross. Agri-It does not record VAT on sales, so a registered farm's income is flagged as possibly including VAT.
7. **Capital is not a running cost.** Loan capital repaid, capital purchases and household drawings are excluded from profit and listed beneath. The interest part of a loan repayment is a cost (statement figure, else recorded, else estimate, labelled).
8. **No depreciation or capital allowances computed.** Shown as "not included"; capital listed with the Revenue rates as information.
9. **Gross presentation.** Grants are income, never netted against costs.
10. **Cut-off.** Costs count on the date incurred and income on the date received, as recorded. A cut-off list is planned, not built.
11. **Traceability.** Rows link to the screen that holds the records behind them. Every cost and receipt is listed in the Expenses and Income reports.
12. **Reconciliation.** The checks panel proves the reports agree with each other, and the net worth movement shows its unexplained part instead of forcing a balance.
13. **Rounding.** Amounts are kept to the cent; each total is the sum of the rounded lines shown.
14. **Stamp.** Farm, financial year, as at date, basis, currency (euro in the Republic, pounds in NI), generated time, rule version `reports@1.0`, retention note.

## Data added

- `year_end_values` (new table, money rules: owner and family write, adviser reads, worker none, touch and audit triggers): kind (`livestock`, `crops_in_store`, `debtors`, `machinery`, `buildings`, `land`, `other_asset`), as-at date, label, animal group, head, value per head, total value, basis (`market_value`, `cost`, `net_realisable_value`, `deemed_cost`, `accountant`, `farmer_estimate`), market value per head (for deemed cost), note.
- Cost category `livestock_purchase` ("Livestock bought"): without it, buying cattle would be booked to Other and a profit that includes the stock movement would be wrong.
- Phone data: every new list is optional, older records read as before (phone `VERSION` stays 1). `CACHE_VERSION` `v9-reports`, demo `VERSION` 11.

## Not built, on purpose

- Trial balance, nominal ledger, double entry, statutory accounts, FRS 102 or FRS 105 disclosures.
- Depreciation, capital allowances, stock relief amounts, herd basis, tax computation, VAT returns, Making Tax Digital.
- Valuing livestock from market prices Agri-It looked up. No source for a reliable farm-level price was found; the farmer enters it.
- A balance sheet that "balances" by plugging a figure.

## Recheck

`src/lib/reports/rules.ts` holds the rules with their sources, `checkedOn` (21 Oct 2026) and `reviewBy` (21 Apr 2027); `releaseGates.test.ts` fails the build 30 days after `reviewBy`.

## Sources

- Revenue Operational Manual 38-03-17, Books and Records: https://www.revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-38/38-03-17.pdf
- Revenue, Keeping records: https://www.revenue.ie/en/starting-a-business/starting-a-business/keeping-records.aspx
- gov.uk, Business records if you're self-employed: https://www.gov.uk/self-employed-records/how-long-to-keep-your-records
- SCSI, Farm Stocktaking Valuations Information Paper: https://scsi.ie/wp-content/uploads/2020/11/SCSI-Farm-Stocktaking-Valuations-Information-Paper.pdf
- HMRC, BIM55410 Farming: stock valuation, general principles: https://www.gov.uk/hmrc-internal-manuals/business-income-manual/bim55410
- HMRC, HS224 Farmers and market gardeners (2026): https://www.gov.uk/government/publications/farmers-and-market-gardeners-hs224-self-assessment-helpsheet/hs224-farmers-and-market-gardeners-2026
- gov.uk, Cash basis: who can use it: https://www.gov.uk/simpler-income-tax-cash-basis/who-can-use-cash-basis
- CPA Ireland, Accounting for Agriculture under FRS 102: https://www.cpaireland.ie/CPAIreland/media/Professional-Standards/Technical%20Resources/Financial%20Reporting/Accounting-for-Agriculture-under-FRS102.pdf
- Revenue TDM 23-02-02, Stock relief: https://revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-23/23-02-02.pdf
- Revenue TDM 23-01-37, Capital allowances for farmers: https://www.revenue.ie/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-23/23-01-37.pdf
- Teagasc, Business Management: Underappreciated, the balance sheet: https://teagasc.ie/wp-content/uploads/media/website/publications/2021/Business-Management---Underappreciated---The-balance-sheet.pdf
- Teagasc, eProfit Book 2016: https://teagasc.ie/wp-content/uploads/media/website/publications/2017/eProfit-Book-2016.pdf
- Teagasc, Creating a cash flow budget: https://teagasc.ie/wp-content/uploads/2025/05/Creating_a_cash_flow_budget_KC2010.pdf
- Irish Farmers Journal, Money Mentor, what accountants need, 18 Feb 2026: https://www.farmersjournal.ie/finance/money-mentor/money-mentor-why-does-my-accountant-need-so-much-paperwork-901739
