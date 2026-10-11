# Response to the third-party product review (8 October 2026)

The review ("Agri-It Irish Farm App Review: Gap analysis, recommended MVP and release readiness") was written from the README only. This note maps every gap it raised to what the code did at the time, what was changed on 11 October 2026, and how each is now tested.

Status words: **Fixed** (built and tested), **Already there** (the code did this; the README didn't say so), **Partly** (what is built, and what is left), **Not taken** (a deliberate decision, with the reason).

## P0: release-critical

| Gap | Before | Now | Tested by |
| --- | --- | --- | --- |
| **Order-to-payment lifecycle** | A priced delivery wrote a cost that counted as cash out on the delivery day. A feed invoice entered later through "Paid a bill" was a second cost. Orders had no value. A part delivery closed the whole order. | **Fixed.** Order = commitment (kg and agreed €/t, shown as "On order", never a cost or cash). Delivery = stock plus a cost, **paid now or on account** (owed, with an optional due date). **Invoice** = matched to the deliveries it covers and *replaces* their docket prices, split to the cent; it never adds a cost row. **Payment** = a paid date; cash moves on that day only. Part deliveries keep the order open for the rest ("Is more coming?"). Money shows Cash now, To pay and On order separately; a new **Bills to pay** screen pays one bill or a whole supplier statement. Duplicate warnings on deliveries (same feed and kg within a day, or the same docket number) and bills (same amount and payee within a week, or the same invoice number). | `bills.test.ts` (14), `uat.test.ts` UAT-01 and UAT-05, `db_review.sql`, `review.py` |
| **Animal-group data reliability** | Head count history was stored but never read. Changing a group's count re-wrote every past day of the feed ledger, so stock "moved" when cattle were sold. | **Fixed.** Every change keeps its effective date and the count it replaced. The ledger uses the count in force on each day; a change booked for later only affects the forecast from that day ("Goes to 20 head on 18 Oct"). Head counts can be set from a past or future date. **Move animals** between groups changes both together. Each group shows its count history. Ticked-off actual feeding is never touched. | `heads.test.ts`, UAT-02, `db_review.sql`, `review.py` |
| **Actionable alerts** | Unticked routines dropped off after 7 days. "Do next" showed 3 items. Overdue bills did not exist as a state. | **Fixed.** Today has **Needs your attention**, grouped Overdue, Today, Coming up, Later. Overdue and today items always show in full; only information can be hidden (for a week). Missed routines stay until **ticked, moved to another day, or skipped** (a routine's missed days are gathered into one line, oldest first, with "Skip those"). Jobs can be moved or taken off the list. Overdue bills, orders that didn't arrive and feed to order stay until dealt with. Reminders lead with overdue bills, late orders and feed to order. Settings has bill-due and order-by warning days. | `routines.test.ts`, UAT-08, `ui.py`, `routines.py`, `review.py` |
| **Offline reconciliation** | Writes were idempotent on replay. Edits were last-write-wins. | **Fixed.** Every editable table has `updated_at`. An edit carries the version it was made against: if someone changed the record in the meantime it is **not** saved over theirs; Sync shows "Changed on another phone" with **Keep theirs / Use mine**. A retried edit that had already landed is recognised (not a false conflict), and two offline edits to one record both land. Possible duplicate deliveries from two phones show on Today with "Remove the second / Two loads came". | `outbox.test.ts` UAT-06 and UAT-07 |

## P1: credible initial product

| Gap | Now |
| --- | --- |
| **Farm-type onboarding** | **Already there** (7 Oct: any mix of dairy, suckler, beef, sheep, tillage and more, with relevant animals and crops). **Added:** a last setup step for money in the bank today, the financial year, and days from ordering feed to delivery (only if the farmer knows it: never guessed). |
| **Verified supplier coverage** | **Fixed** for what can be checked. Each number was re-checked on 11 Oct 2026 against the supplier's own page: Tirlán, Dairygold (025 24411 and Inside Sales 022 31644), Aurivo, Drummonds and Fane Valley are verified that day. Drummonds' eight branches are loaded with their counties, so a farm in Westmeath, Kildare or Dublin gets its branch first; counties with two or more branches list them and the farmer picks one ("Use as mine"), never guessed. **Lakeland** could not be re-checked (its site blocks automated checks), so its numbers now show as **not verified**. Arrabawn Tipperary still has no number until its merged directory is confirmed. "My rep" always comes first. |
| **Practical financial insight** | Cash, owed (overdue, due soon) and committed shown separately; 90-day cash forecast includes bills owed on their due dates; **What if?** on income %, costs % and a one-off spend, always labelled a scenario. New cost categories **Loan repayments** and **Machinery, buildings, land**, kept out of running costs. Optional **enterprise tag** on bills (shown only on mixed farms) and a by-enterprise view. |
| **Accountant-friendly exports** | Year-end **accountant pack (zip)**: summary, every transaction (paid or owed, invoice no., VAT, enterprise, attachment name, totals that match the summary), records, and the invoice and docket photos. Invoice number and VAT are now fields, not notes. |
| **Shared access** | **Partly.** Database and screens are built: roles Owner, Family or partner, **Farm worker** (records feed, deliveries, counts, jobs; sees and writes no money, enforced by the database) and Adviser (read only). Invitations by email with a one-time link (14 days), and a **change history** of who added, changed or removed what. These need accounts, so they work once Agri-It runs on Supabase; the phone-only build explains this and keeps its own on-phone history. |
| **Record organisation** | Records is now a searchable vault (supplier, product, invoice no., amount, month) across records, invoices, dockets and photos, each linked to its supplier, group, feed or bill; medicine records can carry the group and batch. Export as a list or with photos. Every record says it is evidence and does not replace an official register or a Department notification. |
| **Forecast trust (3.7)** | Each feed screen has **What this forecast is worked out from**: stock basis and its evidence, head counts used and their date, your feeding plan, changes ahead, delivery time and where it came from, what is on order, confidence with reasons, and the time it was worked out. |

## P2 and phase 2+

Grass and paddocks, ICBF/AgFood/processor integrations, individual-animal records, compliance submissions: **not taken**, as the review recommends.

## Recommendations not taken, and why

- **Navigation (Today, Farm, Record, Plan, Money).** Kept the bar Feargal chose on 7 Oct (Dashboard, Diary, +, Progress, More). Money and Bills are one tap from More and from the Cash card; the review's five jobs are all covered.
- **Starting market (dairy, suckler, beef, basic sheep).** No farm type is restricted, per the 7 Oct decision ("never restrict by farm type"). Farm types only change what shows first.
- **Partial payments** of one bill are not split; a bill is paid in full (a statement can pay several at once).

## UAT checklist (section 8)

| ID | Scenario | Result | Where |
| --- | --- | --- | --- |
| UAT-01 | Receive feed; stock, forecast, supplier history, money | Pass | `src/lib/uat.test.ts`, `scripts/e2e/review.py` |
| UAT-02 | Group numbers with effective dates; history kept | Pass | `uat.test.ts`, `heads.test.ts`, `db_review.sql` |
| UAT-03 | Temporary plan expires, normal use returns | Pass | `uat.test.ts`, `feed.test.ts` |
| UAT-04 | Physical count shows variance, rate unchanged | Pass | `uat.test.ts` |
| UAT-05 | Order, part delivery, invoice, payment; no duplicate costs | Pass | `uat.test.ts`, `bills.test.ts`, `db_review.sql`, `review.py` |
| UAT-06 | Offline, restart, reconnect; exactly-once writes | Pass | `src/lib/offline/outbox.test.ts` |
| UAT-07 | Same record changed on two devices; predictable resolution | Pass | `outbox.test.ts` |
| UAT-08 | Bill overdue a week stays actionable | Pass | `uat.test.ts`, `review.py` |
| UAT-09 | Year-end export reconciles | Pass | `uat.test.ts`, `bills.test.ts` |
| UAT-10 | Fresh farm, first useful action, no demo data | Pass | `uat.test.ts`, `scripts/e2e/phone.py` |

These are automated checks. The review's release gate 3 (watching real Irish farmers use it in the yard) still needs doing.
