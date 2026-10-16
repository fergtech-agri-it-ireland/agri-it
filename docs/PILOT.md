# Farmer pilot: protocol and field scripts

From the advisory board review (14 Oct 2026), sections 6 to 8. A controlled, invite-only pilot on Republic of Ireland dairy, suckler and beef farms, before any general release.

## Who and how long

- 12 to 20 farms, 4 to 6 weeks.
- Mostly ROI dairy, suckler and beef. A few mixed and non-cattle farms, on purpose, to find the gaps.
- Record for each farm before starting: enterprise, herd size, county, phone (make, model, Android or iPhone), signal in the yard, and what they use now (Herdwatch, AgriNet, spreadsheets, paper, nothing).
- Watch the first setup in person. After that, no coaching: let routine use happen on its own.
- Install from https://fergtech-agri-it-ireland.github.io/agri-it/ and add to the home screen (the farm lives on that phone).

## Targets (hypotheses, not results)

| Measure | Target |
| --- | --- |
| First meaningful feed setup (farm, groups, one feed with a plan) | 80% in under 8 minutes |
| A feed delivery recorded after setup | 80% in under 1 minute |
| Farmer explains a sample order-by date correctly | 85% |
| High-severity data loss, or money counted twice | None unresolved |
| Weekly use | Sustained, and for a real task (not empty opens) |
| Three fields and the fertiliser in the shed added (S11, S12) | 80% in under 6 minutes |
| CSO comparison read as a supplier quote (S15) | Nobody |
| Alerts ignored (Settings > Alert counts) | Under half of those shown, for each kind |

Review negative feedback and forecast error by enterprise type.

## Field scripts (observer reads the task, does not help)

Time each one. Note every hesitation, wrong tap, going back, or "I'd do that on paper".

**S1. Set up the farm.** "Set up your farm, your animal groups and the meal you're feeding now."
Pass: done unaided; the feed card shows days left.

**S2. Feed arrived.** Hand over a real or sample docket for 8 t. "Record this delivery."
Pass: under a minute; the run-out date moves; the farmer can say what changed.

**S3. Change a feeding rate.** "The cows are going up to 2 kg twice a day from tomorrow."
Pass: done from the feed card; the new run-out date shown before saving.

**S4. When do I order?** "When do you need to order this meal, and who do you ring?"
Pass: reads the order-by date and the supplier from the dashboard; can say why that date (stock, daily use, spare kept, delivery time).

**S5. Stock count.** "Go and look in the bin. Put in what's there."
Pass: the forecast corrects and says why (predicted vs counted). Agri-It does not change the feeding rate.

**S6. Order to place.** Approve the drafted order on the dashboard. "Has this order gone to the supplier?"
Pass: the farmer knows it hasn't until they ring, then taps I've placed it.

**S7. Bills.** "Which bills are due this month? Pay the vet." Then: "Is the cash figure your bank balance?"
Pass: finds Bills to pay; answers "no, recorded cash, last checked on ..."; can do Check against the bank.

**S8. Accountant pack.** "Get the year-end pack for your accountant." Ask: "Is this your accounts?"
Pass: exports it; says it's a management summary, not statutory accounts or tax.

**S9. Lose the phone.** "Back up your farm." On a second phone (supplied): "Restore it."
Pass: every record and photo on the second phone. Note where the backup file was kept.

**S10. Outdoors.** Repeat S2 and S4 in the yard: one hand, gloves if worn, low signal, in daylight.
Pass: no misses on the big buttons; readable in sun (try sunlight mode).

### Fields, fertiliser and prices (added 14 Oct 2026)

The pilot runs in October and November, when chemical fertiliser can't be spread: in the Republic it's closed from 15 September until late January or mid February depending on the zone, and in Northern Ireland from 16 September (midnight on the 15th) to 31 January, per `lib/spreading.ts`. So S13 records a spreading from earlier in the season, and S14 checks what the farmer sees while spreading is closed. Same rules: time each one, the observer reads the task and does not help, note every hesitation.

**S11. Add fields.** "Add three of your fields: one you graze, one you cut for silage, and one more. Say how often you spread the grazing one, and when you hope to cut the silage one next year."
Pass: under 4 minutes for three fields, unaided; the farmer chose their own round and cutting date (Agri-It never suggests one). Note whether they know their acres without looking.

**S12. Fertiliser in the shed.** "Add the fertiliser you have in the shed now, with roughly how much. Then record this delivery." (Hand over a real or sample docket, for example 2 t of CAN in 500 kg bags.)
Pass: product found in the pick list or typed; stock shows the opening amount plus the delivery; the bill shows in Bills to pay if bought on account. Under 1 minute for the delivery.

**S13. Spread fertiliser.** "In September you spread CAN on the two grazing fields at two bags an acre. Put that in."
Pass: both fields in one entry; the amount comes off the stock and the farmer can say by how much. If they pick a date in the closed period, the warning shows and they understand it.

**S14. Spreading reminders.** "Without looking at your notes: is spreading open on your farm now, and when does it open again? Which fields will be due first?"
Pass: reads it from Fertiliser or the dashboard; can say where the dates come from (gov.ie or DAERA, with the day they were checked). Ask: "If this showed up on your phone, what would you do with it?" Then: "Put one of the reminders off." Pass: finds Not now on an information item, gives a reason, picks a time.

**S15. Price against the CSO.** Open a feed or fertiliser the farmer has paid for. "What does this comparison tell you?" Then: "Is that a price you can get?"
Pass: the farmer says it's a national average from the CSO for that kind of product and month, not a quote from a supplier, and that their own price is what they paid. Note anyone who reads it as a quote.

**S16. Stock that went missing.** "Two bags of meal got wet and were thrown out. Put that in." Then: "Count the bin now" (with a figure a fair way off what Agri-It expects).
Pass: finds Wasted, used elsewhere or sold; the stock drops and the feeding plan is unchanged. At the count, Agri-It asks why; the farmer picks a reason or Don't know; the feed screen's Predicted vs counted shows it.

**S17. Fertiliser order, part delivery.** "You've ordered 4 t of CAN, on account. Half came today." Then: "The rest came, and here's the invoice."
Pass: the order shows as on order until delivered; after the first half, 2 t still to come; after the invoice, one bill for the right amount (not two), still owed until paid.

## Interview guide (the board's questions)

1. Of feed run-out, winter silage, bills and cash, and daily jobs: which would you come back to every week, and which would you ignore?
2. Would you keep your real farm records in an app that stores them only on this phone? What backup or sharing would you need first?
3. What are the smallest three things to put in on day one that would show it's useful? When would the typing be too much?
4. When would you not trust a forecast? What would you check by eye or by weighing to change your mind?
5. Would you pay for this next to your herd app, or only if it pulled your records in automatically? What price would you try?
6. Who else should be in the pilot (enterprise, county, size), and who could watch them use it?

### Fields, fertiliser and prices (added 14 Oct 2026)

7. Would you use the spreading reminders (spreading opens, last day before it closes, fields due on your own round, spread silage ground 50 days before cutting)? Which would you turn off, and which would you want on your phone?
8. Is keeping fertiliser stock in Agri-It worth the typing? Would you record every spreading, or only deliveries and a check now and again?
9. Would you look at the CSO price comparison when buying feed or fertiliser? Would it change who you ring, or when you buy? Is anything about it misleading?
10. When stock doesn't match, would you say why (wasted, fed elsewhere, sold, miscounted)? Or would you just put in the count?
11. Were any alerts too many or too often? Which ones did you put off, and why?

## What to capture each week

Task success and time per script; forecast vs counted feed and fertiliser (Predicted vs counted, with the reasons the farmer gave); the alert counts from Settings > Alert counts for the pilot (Copy counts: per kind of alert, how often it was acted on, put off with why, turned down or ignored; kept on the phone only); any restore; any figure the farmer disagreed with, and why; where they stopped using it.

## Reference ledgers

The automated gates use small hand-worked ledgers (`src/lib/releaseGates.test.ts`): the 280 kg/day feed example, an order taken through part delivery, invoice and payment, and a year of income and costs that must reconcile with cash, monthly flows and the export. For the pilot, take one farm's month of real paperwork, total it by hand, enter it, and compare with Money and the year-end pack.
