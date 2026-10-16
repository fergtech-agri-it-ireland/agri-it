# Response to the advisory board review (14 October 2026)

The review ("Agri-It Independent Product Review & Advisory Board Assessment", 14 Oct 2026) recommends a controlled farmer pilot, not a general release, and lists P0 gaps, P1 gaps, release gates and a 90-day plan. This note maps each item to what was built on 14 Oct and how it is tested, following the plan's weeks 1 to 2: fix the full-backup story, currency and number wrapping, design cash completeness labels, and set up independent sample ledgers and field UAT scripts.

Status words: **Fixed** (built and tested), **Partly** (what is built, what is left), **Pilot** (can only be answered on real farms), **Parked** (waits for Agri-It Online), **Next** (agreed, not built yet).

## P0: before an uncontrolled release

| ID | Gap | Status | What changed | Tested by |
| --- | --- | --- | --- | --- |
| G01 | Single-phone data; backup excludes photos | **Fixed** | **Back up** now saves one zip with every record and every photo, invoice and docket the records point at (`lib/phoneBackup.ts`). Restore on another phone brings both back; older records-only backups still restore; a damaged file is refused before anything is changed. Settings shows the last full backup date; the dashboard asks for one once a farm has records and none in 30 days. Export and backup now have the same completeness: the accountant pack already carried the attachments. Move my phone data (online) reads the zip and its photos. Limit: inside a shared Claude link a backup is records only (the frame blocks files), and the card says so. | `phoneBackup.test.ts` (6), `phone.py` (zip holds the photo; photo restored byte-for-byte on a second phone) |
| G02 | Cash may look like a bank balance | **Fixed** | Called **Recorded cash** everywhere, never "cash now": your bank balance on a date plus what you've recorded since. Shows when it was last checked against the bank, warns after 30 days (dashboard card and Needs your attention). **Check against the bank** takes what the bank shows now and says how far out the recorded figure was, and which way. The 90-day forecast now counts **repeats** set up in Routines (a complete forecast needs recurring items) and lists **what the forecast can't see**: no budget, money that came regularly with nothing expected, bills with no due date. Each line is shown separately: Known, Repeats, Budget. | `cashCompleteness.test.ts` (4), `advisory.py` |
| G03 | Drafted order vs real supplier action | **Fixed** | An order Agri-It drafts is an **order to place**: not on order, not committed money, no "did it arrive?", until the farmer taps **I've placed it** (or Don't order). Today keeps asking. The order form asks "Have you placed it with the supplier?". Delivery, part delivery, invoice and payment were already separate states (8 Oct review). Also fixed: the order form and repeat orders no longer **guess a delivery date** when no delivery time is known. Migration `20261014000100_order_to_place.sql` (`placed`, `placed_on`; older orders count as placed). | `releaseGates.test.ts`, `db_review.sql`, `advisory.py` |
| G04 | Unverified real-world use | **Partly / Pilot** | Calculations proven against independent, hand-worked ledgers (gates G1, G2, G7 below). Field scripts for the pilot are in `docs/PILOT.md`. Watching unsupervised use, low signal and device loss needs the pilot. | `releaseGates.test.ts`, `uat.test.ts`, `PILOT.md` |
| G05 | Republic and NI defaults | **Fixed** for money and authorities | Money is shown, typed and exported in the farm's currency: **euro** for the Republic, **pounds sterling** for NI (never converted; amounts are stored as entered). Sign-up says so. Exports carry the currency. One place, `lib/jurisdiction.ts`, names the department, animal system, tax authority and postcode for each side. Legislation and timing: see G06. NI is still not in the first pilot (the review's advice). | `currency.test.ts`, `phone.py` (NI farm shows £, never €) |
| G06 | Compliance date governance | **Fixed** for every statutory date Agri-It shows (calf tagging and registration) | `lib/deadlines.ts`: one rule per jurisdiction and herd, each with its **official source** (Irish Statute Book, gov.ie, DAERA), the day it was **checked**, the day it is **in force from** (a changed rule gets a new version; older births keep the rule of their day) and a **recheck** date. The build **fails 30 days after a recheck date**, so a rule can't go stale unnoticed. Every screen with a deadline quotes the rule and its source and says Agri-It's dates are reminders, the official system (AgFood.ie or Calf-Reg; DAERA Online Services) is the record. Sources re-checked 14 Oct 2026: ROI tagging is "no later than 20 days after birth" (S.I. 591/2022 reg. 5), so the date is now day 20 (was 19); registration 27 days (gov.ie); NI dairy 36 hours, others 20 days, notify within 27 days or before movement (DAERA, updated 21 Aug 2026). | `releaseGates.test.ts`, `season.test.ts`, `advisory.py` |
| G07 | Shared accounts not hardened on a deployed backend | **Parked** | Roles, invites, worker-without-money and audit are built and pass on Postgres 16 (`db_review.sql`, `sharing_live.sql`), but Agri-It Online stays unpublished until Feargal is ready. Gate G8 runs on the hosted project as step 4 of the online setup (handover, "Start here"). Account recovery and farm deletion need checking then. | `db_review.sql`, `sharing_live.sql` |

## P1: pilot learning

| ID | Gap | Status |
| --- | --- | --- |
| G08 | Supplier directory | Fixed (16 Oct): every directory supplier and branch has a recheck-by date six months after it was checked, worked out from its verified date and shown on the supplier screen ("Verified 11 Oct 2026. Recheck by 11 Apr 2027", in amber once it's past). Release gate in `releaseGates.test.ts` fails the build 30 days after any recheck date. Lakeland tried again by hand on 14 Oct: its site still blocks automated checks, so its numbers stay not verified. Star Fuels' site still shows "account suspended": still no number. |
| G09 | Depth by enterprise | Pilot: no farm type is restricted (7 Oct decision). The pilot concentrates on ROI dairy, suckler and beef. |
| G10 | Photo reading | Already there: confidence per field, editable, duplicate warnings, clear failures, photo kept. Now also in the full backup. |
| G11 | Forecast exceptions | Fixed (16 Oct): Wasted, used elsewhere or sold (feed and fertiliser) records a stock adjustment with a reason: wasted or spoiled, unplanned use (fed to another group, used elsewhere), sold or returned, counting error. A stock check 25 kg and 3% or more off the forecast asks why (optional). Predicted vs counted on the feed screen, and Recorded vs checked on each fertiliser, show the reason, the adjustments taken into account and a tally. The feeding plan and spreading rates are never changed. |
| G12 | Alert load | Fixed (16 Oct): related items on Needs your attention and in the phone reminders come as one line each ("3 jobs due: 2 today, 1 coming up", "2 orders to place", fields to spread); tap a bundle to see each one. Not now asks why (busy, done elsewhere, not relevant) and for how long (tomorrow, 3 days, a week, 2 weeks), on Today and on Ready for you to approve. Only information can be put off: anything owed, overdue or due today has no Not now, and an old snooze can't hide it. Settings > Alert counts for the pilot: per kind of alert, how often it was shown, acted on, put off (with why), turned down or ignored, kept on the phone, with Copy counts. |
| G13 | Narrow screens and silage sums | **Fixed**: amounts shrink to fit their tile instead of breaking across lines, and a minus sign never wraps away from its amount (checked on 320 px screens). Dashboard, Needs your attention and the winter plan now use one silage summary (`silageSummary()`): store, winter need and reserve that add up, with both shortfalls ("133 t short for the winter, 289 t short counting your 15% reserve (156 t)"). Tests: `silageSummary.test.ts`, `advisory.py`. |
| G14 | Double entry | Next, with partners: imports and exports before parallel systems. |

## Release gates (section 6)

| Gate | Result | Where |
| --- | --- | --- |
| G1 Feed correctness | Pass: the board's own example (120 cows x 1 kg x 2 + 40 heifers x 1 kg x 1 = 280 kg/day; 8,000 kg; run-out day 28, reorder day 25, order by day 22) checked against hand arithmetic | `releaseGates.test.ts` |
| G2 Ledger integrity | Pass (since 11 Oct) | `uat.test.ts` UAT-05, `db_review.sql` |
| G3 Effective dates | Pass (since 11 Oct) | `uat.test.ts` UAT-02 and UAT-03, `heads.test.ts` |
| G4 Data recovery | Pass for records and photos on a second phone, damaged files, older backups. Browser-data-clear recovery is the backup itself. | `phoneBackup.test.ts`, `phone.py` |
| G5 No false authority | Pass: no guessed delivery dates (order form, repeat orders); every statutory reminder is jurisdictional, dated and sourced | `releaseGates.test.ts` |
| G6 Outdoor usability | Pilot (needs farmers, gloves and signal) | `PILOT.md` |
| G7 Finance explainability | Pass: a hand-worked reference ledger reconciles with cash, monthly flows, the summary and the transaction export; cash is labelled by basis and omissions are listed | `releaseGates.test.ts`, `cashCompleteness.test.ts` |
| G8 Security | Parked with Agri-It Online (passes on Postgres 16) | `sharing_live.sql` |

## Automation ranking (section 5)

Agreed order for weeks 7 to 10, only once pilot data is adequate: B2 learn from actual feed use (show plan vs count and ask; never change a rate silently), B8 cash low-point warning (the cash completeness work above is its foundation), A3 PDF and email invoice import. Not started in this round.

## Decisions for the board (section 8)

These are questions for farmers in the pilot, not code. `docs/PILOT.md` turns them into the interview guide.
