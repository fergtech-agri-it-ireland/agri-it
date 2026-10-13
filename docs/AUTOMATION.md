# Automation and approvals (13 October 2026)

Goal: Agri-It does the legwork and puts the result in front of the farmer to approve in one tap.
Nothing is recorded until they approve or save. Every suggestion is built from the farm's own
records or a published Irish source, and says why.

## Built

### 1. Silage tonnes worked out from dry matter (rule `silage-dm@1.1`, `forage-budget@1.1`)
- A measured pit with no density now gets one from its dry matter: lab DM, or the Teagasc squeeze or
  ball test band. Conversion table: DAERA (S20, 20 to 45% DM) and the Irish Farmers Journal
  (S21, 2 Sept 2026, adds 18% and confirms 20% and 25%). Straight line between rows.
- A yard-test band gives a range of tonnes; the winter plan counts the drier, lighter end so it
  never counts silage that may not be there.
- The silage form shows, as the farmer types: the worked-out density and its source, tonnes fresh,
  tonnes of dry matter, and what it does to the whole winter ("1,309 t of 1,193 t needed, adds 1.5
  months of feeding").
- The farmer's own density always wins. Teagasc's 25% figure (719 kg/m³) is now offered only when
  nothing is known about the dry matter; if it was used and the DM turns out different, one tap
  swaps to the worked-out figure.
- Confidence: Medium when the density comes from the table, with the reason.
- Note: the table (680 kg/m³ at 25%) is lower than Teagasc's 719. The lower, more careful figure is
  used so the winter plan errs short, not long.

### 1b. Best guess when nothing is known (rule `silage-dm@1.2`, 13 Oct evening)
Most Irish farmers never send silage for testing, so a blank is no use.
- **Pit, no lab figure and no yard test:** tonnes from typical silage. ROI: Teagasc's typical pit
  silage, about 25% DM (680 kg/m³ from the table); range shown 20% to 30% DM. NI: the 2025 average
  for the cut (S18), 5 points either side.
- **Bales not weighed:** a typical 600 kg bale, 700 kg if well packed (Agriland, Aurivo advice, S22).
- Labelled "Best guess" everywhere, the winter plan works and drops to **Low** confidence with the
  reason, and Ready to approve suggests the one-minute squeeze test (or weighing one bale) to firm it up.
- Teagasc's 719 kg/m³ button is gone: the best guess replaces it.
- **Acres cut** still needs the farmer's expected yield: no published typical yield per acre was
  found that would hold up (yields vary up to 50% between fields).

### 2. Ready for you to approve (`src/lib/suggestions.ts`, rule `suggestions@1.0`)
A card near the top of the dashboard. Approve does it; Not now hides it for a week; No hides it
for good (`suggestion_decisions`). Calf tagging and registration can't be turned down.

| Suggestion | Built from | Approve does |
| --- | --- | --- |
| Order feed | Feed at order-soon or order-now, no open order | Records an open order: same kg as the last order or delivery, the feed's supplier, expected date only if a lead time is known, no price |
| Season steps | The calving season dates | Adds the jobs, or opens Dry off |
| Housing / turnout | The farm's own housing and turnout dates | Marks the groups housed or out (winter silage plan follows) |
| Head counts | Groups not checked in 30 days | Confirms the counts (feed forecasts back to High) |
| Monthly bill | 3+ bills to one payee, 25 to 35 days apart, none feed, no routine yet (two at a time) | Makes a monthly routine with the last amount |
| Silage dry matter | Measured pit with no DM or density | Opens the silage form |
| Calves to tag / register | Calves born | Marks them all done today |

The plain "Order X now" and "Check your head counts" lines on Needs your attention give way to the
drafted suggestion. Reminders also lead with overdue and today suggestions.

### 3. Calving season planner (`src/lib/season.ts`, rule `season-plan@1.0`)
Farmer gives the first (and optionally last) calf due date, or the bull-in / first AI date
(ICBF gestation: 279 days Holstein Friesian, 283 all cattle). Agri-It lays out:

| Step | Dairy | Suckler | Source |
| --- | --- | --- | --- |
| Body condition score / check condition | 2 weeks before the first drying off | 90 days before calving | Teagasc BCS guide; Teagasc "Getting the cow ready" (timing Agri-It's) |
| Dry off thin cows | 10 weeks before calving | | Teagasc BCS guide |
| Dry off cows on target | 8 weeks before, first to last cow | | Teagasc BCS guide; 60 to 70 day dry period |
| Pre-calver minerals | from 6 weeks before; order by then less the farm's lead time | same | Teagasc calving checklist; 4 to 6 weeks |
| Order calf tags | 4 weeks before | same | Teagasc checklist (timing Agri-It's) |
| Calving checklist (5 jobs) | 3 weeks before | same | Teagasc checklist (timing Agri-It's) |
| Calving | first to last calf | same | |

- **Dry off** screen: one move from the milking group to the dry group, with the feed impact shown
  before saving (e.g. Dairy nut 280 → 256 kg a day, runs out 11 Nov instead of 8 Nov). The feed
  forecasts follow because use is worked out from the groups each feed is fed to.
- **Calf born** (Add > Calf born): one entry adds the calves to the calf group, moves the cow back
  into the milking group (dairy), and starts the countdowns: ROI tag before 20 days of age and
  register within 27 days; NI dairy tag within 36 hours, others 20 days, notify within 27 days.
- Agri-It never says how much to feed a dry cow (ration rule from the spec).

Data: `calving_seasons`, `calf_births`, `suggestion_decisions` (migration
`20261013000100_automation.sql`, RLS like other farm tables: owner, family and worker write,
adviser reads; audit trail on seasons and births; Move my phone data carries them across).

Tests: `season.test.ts` (8), `suggestions.test.ts` (8), `silageDm.test.ts` (+5),
`scripts/e2e/automation.py` (27 browser checks), `silage_dm.py` (28), `db_review.sql` (+6).

## Not built yet: ideas to make it more habit-forming (research needed first)

Ranked by how often a farmer would meet them and how much typing they remove.

1. **Read a silage analysis report from a photo**: fill DM, DMD, CP, pH into the store; the tonnes
   and winter cover then update by themselves. The photo reader already handles dockets.
2. **Read the co-op milk statement from a photo**: litres, solids, price, deductions, into the milk
   cheque. Monthly, so it builds a habit.
3. **Breeding season** after calving: planned start of mating, heat detection window, scanning
   date, then next year's calving season set up from the bull-in date automatically.
4. **Weekly "your farm in 30 seconds"** push: feed days left, silage cover, cash low point, what's
   coming up. One notification a week people look forward to.
5. **Weather-aware jobs** (Met Éireann): rain-free windows for spreading or cutting. Needs a weather
   source and current nitrates rules (closed periods change; verify before building).
6. **Feed planning through drying off**: offer to book the planned drying-off moves as future dated
   head changes so the run-out date reflects the whole winter in advance (the ledger already
   supports future-dated counts).
7. **Herdwatch / ICBF calving list import** (P2): calving dates per cow instead of a herd window.
