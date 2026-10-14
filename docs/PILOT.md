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

## Interview guide (the board's questions)

1. Of feed run-out, winter silage, bills and cash, and daily jobs: which would you come back to every week, and which would you ignore?
2. Would you keep your real farm records in an app that stores them only on this phone? What backup or sharing would you need first?
3. What are the smallest three things to put in on day one that would show it's useful? When would the typing be too much?
4. When would you not trust a forecast? What would you check by eye or by weighing to change your mind?
5. Would you pay for this next to your herd app, or only if it pulled your records in automatically? What price would you try?
6. Who else should be in the pilot (enterprise, county, size), and who could watch them use it?

## What to capture each week

Task success and time per script; forecast vs counted feed (the feed screen's Predicted vs counted); each alert shown and whether it was acted on, put off or ignored; any restore; any figure the farmer disagreed with, and why; where they stopped using it.

## Reference ledgers

The automated gates use small hand-worked ledgers (`src/lib/releaseGates.test.ts`): the 280 kg/day feed example, an order taken through part delivery, invoice and payment, and a year of income and costs that must reconcile with cash, monthly flows and the export. For the pilot, take one farm's month of real paperwork, total it by hand, enter it, and compare with Money and the year-end pack.
