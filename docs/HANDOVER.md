# Agri-It MVP: Handover

**Last updated:** 16 October 2026, afternoon (release 0.3.0: sign-up cut to two steps and a staged **Set up your farm** built from the farm's answers; loans, hire purchase and overdraft with repayments, interest and annual statements; scheme payments on published dates; a month-by-month **Year plan** and budget; a bigger accountant pack. See "NEW (16 Oct, afternoon)" and `docs/SETUP-AND-PLANNER.md`. Earlier 16 Oct: release 0.2.0: advisory board items G12 alert load, G11 forecast exceptions, G08 supplier recheck dates, pilot scripts for fields, fertiliser, spreading and CSO prices, fertiliser orders, a fertiliser tile on the dashboard, and a release line "Agri-It v0.2.0 · © 2026 FergTech · Built by FergTech" on every screen; see "NEW (16 Oct)" below. Earlier: 14 October 2026 (advisory board review, weeks 1 to 2 of its plan: full backup with photos, pounds for NI farms, amounts that never wrap, one set of silage sums, recorded cash checked against the bank, orders to place, sourced and dated calf deadlines, release gate tests; see `docs/ADVISORY-RESPONSE.md` and `docs/PILOT.md`. Earlier: 13 October 2026, evening (automation: silage tonnes worked out from dry matter, Ready for you to approve on the dashboard, calving season planner with drying off and calf tag deadlines; see `docs/AUTOMATION.md`. Earlier 13 Oct: focus is the phone app: Feargal is testing it on his phone and improving it; Agri-It Online is built and tested but parked, not published, until he is happy. See "Start here" below. Earlier, 11 Oct, night: silage dry matter help: which cut, Teagasc yard tests, typical figures by jurisdiction, Teagasc's pit density only when it fits. Before that, Agri-It Online: the hosted version built and published at /agri-it/online/ next to the phone app, Move my phone data to my account, server reminders, sharing checked on the real project; the hosted database waits on one paste, see 2. Earlier 11 Oct: third-party review fixes: bills owed vs paid, invoices matched to deliveries, part deliveries, dated head counts and moving animals, alerts that stay until dealt with, offline conflict checks, roles/invites/change history, accountant zip pack, records vault, re-verified suppliers. See `docs/REVIEW-RESPONSE.md`. Earlier: 7 October 2026, night (new fitness-tracker style UI: Dashboard, Diary, Add, Progress, More; sign-up open to any mix of farming, any animal class, breeds; crops for tillage. Earlier 7 Oct: Agri-It live at its own address, fergtech-agri-it-ireland.github.io/agri-it; earlier: phone-only build: your own farm kept on the phone, shareable link; earlier 7 Oct: photo reading for dockets, receipts and invoices; 6 Oct: daily reminders, supplier price history, budget variance alerts, white-page fix, routines and tick-off checklist, UI redesign)
**Owner:** Feargal
**Status:** MVP code complete and on GitHub (moved 7 Oct to `fergtech-agri-it-ireland/agri-it`, public, CI green, latest work on `main`). Phone-only build live as a private Claude artifact (real farm, data kept on the phone, no server). Installable app live on GitHub Pages at https://fergtech-agri-it-ireland.github.io/agri-it/. Browser demo also live. **Agri-It Online** (signed-in, records in Supabase) is built and tested but parked and not published (13 Oct) until Feargal is happy with the phone app; its database `agri-it` is half set up (see "Start here").

Use this document to start a new chat. Paste or reference it, then say what you want to do next. The full product spec is in `docs/MVP-SPEC.md` (also saved in the Claude Project).

---

## Start here (16 October 2026)

**Latest: release 0.3.0 (16 Oct, afternoon).** Staged setup, loans, scheme payments, year plan, budget by month, accountant pack. Full detail, sources and what's not built: `docs/SETUP-AND-PLANNER.md`. Feargal should try a fresh farm on a second browser profile (or Delete everything on a test phone, never on his real one) to walk the new sign-up.

**Latest: release 0.2.0 (16 Oct).** G08, G11 and G12 from the advisory board are fixed, `docs/PILOT.md` has field scripts S11 to S17 and interview questions 7 to 11 for fields, fertiliser, spreading, stock reasons and the CSO comparison, fertiliser has orders like feed, and every screen shows the release line. Details in "NEW (16 Oct)".

**Before that: the advisory board review (14 Oct).** The board recommends a controlled pilot on ROI dairy, suckler and beef farms before any general release. Weeks 1 to 2 of its 90-day plan are built and tested (`docs/ADVISORY-RESPONSE.md` maps every gap). What's left from the review: the pilot itself (`docs/PILOT.md` has the protocol, the ten field scripts and the interview guide), G07 and gate G8 with Agri-It Online, and the P1 items marked Next. Then, from week 7 and only with pilot data: B2 learn from actual feed use, B8 cash low-point warning, A3 PDF and email invoices.


**Focus: the phone app.** Feargal is testing https://fergtech-agri-it-ireland.github.io/agri-it/ on his own phone and wants to keep improving it until he is happy. That is the version to iterate on. Every push to `main` that passes CI republishes it, and his phone picks up the new version the next time the app is opened with signal (close it fully and reopen if a change doesn't show). His records stay on the phone and are never wiped by an update (phone `VERSION` 1: migrate stored data, never reset it).

**How to iterate on it in a chat:**
1. Clone, `npm install`, `npm test`, `npm run build` (all green before changing anything).
2. Make the change; add or update unit tests and the browser checks in `scripts/e2e/` for anything a farmer touches.
3. `npm run build:demo` and run ui, routines, p1, ocr, review, silage_dm, automation, advisory, fertiliser, board and planner against it; `npm run build:pages` and run `phone.py` against it served under `/agri-it/` (section 4). If stored data changes shape, bump `CACHE_VERSION` (and demo `VERSION`), and make older phone records still read correctly (see `normalizeBundle`, `farmTypes()` for the pattern).
4. If the change touches the database shape, also add a migration (so the online version keeps up) and run the scratch Postgres checks (`db_review.sql`, `sharing_live.sql`, `phoneImport.pg.test.ts`).
5. For a release, bump `version` in `package.json` (the release line on every screen reads it; the build adds the commit and the day built). Commit to `main`, watch CI (app, database, pages) go green, and tell Feargal to reopen the app.

**Parked: Agri-It Online.** The signed-in version (sharing with family, a farm worker or an adviser, change history, Move my phone data, server reminders) is built and tested but **not published**: CI's `pages` job has `PUBLISH_ONLINE: 'false'`, so `/agri-it/online/` is not on the site. CI still builds it (`build:online` in the `app` job) and the `database` job still runs every migration, `db_review.sql` and the phone import test, so it stays working while the phone app changes. Don't ask Feargal to do the steps below until he says he's ready to move on.

**When Feargal is ready to go online (his steps, Supabase dashboard, project `agri-it`, never gauntlet):**

| # | Step | Why |
| --- | --- | --- |
| 1 | Regenerate with `python3 scripts/make_remote_setup.py` (it picks up every migration added since), then Feargal pastes `supabase/remote/setup_agri_it.sql` into SQL Editor > New query and runs it. Last line: `Agri-It set up: 89 security rules, ...` (the count changes if migrations add policies) | Finishes the database the online app needs: the rest of the security rules and functions, every later migration, the reference data without the demo login, and the database checks (rolled back). The Supabase connector cancels any change containing a delete or drop because its approval never reaches Feargal, so this part is pasted by hand. |
| 2 | Edge Functions > Secrets: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Make a fresh pair then (`npx web-push generate-vapid-keys`); the 11 Oct pair was shown in chat | Lets the server send reminders when the app is closed (the only way on iPhone). The private key never goes in the repo. |
| 3 | Authentication > URL Configuration: Site URL and a Redirect URL `https://fergtech-agri-it-ireland.github.io/agri-it/online/` | Otherwise the "confirm your email" link in sign-up emails points at localhost. |
| 4 | The chat then: sets `PUBLISH_ONLINE: 'true'` in `.github/workflows/ci.yml`, runs `scripts/e2e/sharing_live.sql` on the live project (rolled back), fixes what the security and performance advisors flag, stores `push_cron_secret` in the vault and runs `supabase/remote/push_schedule.sql`, runs `online.py` with a real test user, then gives Feargal one SQL line to remove that user | Puts the online app back on the site and checks it end to end on the real project. |

Optional before inviting many people: Authentication > SMTP with your own sender (the built-in one sends only a few emails an hour).

**Current state of the hosted project `agri-it` (checked 13 Oct):** migration 1 and parts 1 and 2 of migration 2 applied; edge function `push-reminders` deployed; no VAPID secrets, no reference data, no users. Nothing uses it.

**Claude artifact copies** (not republished since 11 Oct afternoon, so without the dry matter help): the private phone-only link https://claude.ai/artifact/WNRa3dHK8DcwjK4KYB1ePC and the demo https://claude.ai/artifact/PrDSDf2cB5EgRaDSMe7UJw. Feargal tests on the GitHub Pages app, so these only need republishing if he asks (section 4).

---

## 1. What Agri-It is

A mobile-first farm management and decision-support app for Irish farmers. It answers "What do I need to know or do next?" by combining the farmer's own records with verified Irish guidance (Teagasc) and turning them into explainable actions.

Core promise: **record something once, use it everywhere.** A feed delivery updates stock, run-out date, feed cost, cash flow, supplier history and records in one step.

It is not a herd, grassland or accounting system. It does not prescribe rations, calculate tax, or invent supplier reps, prices or lead times.

---

## 2. Current state

| Item | State |
| --- | --- |
| Code | P0 scope complete, plus the redesign, recurring routines with tick-offs, and (6 Oct, night) daily reminders, supplier price history and budget variance alerts |
| Typecheck | Clean (`tsc -b`) |
| Unit tests | 154 passing (+1 database test that runs in CI): 11 Oct night adds `phoneImport.test.ts` (10, a real phone backup), `pushDue.test.ts` (5, server reminder timing) and `phoneImport.pg.test.ts` (runs against Postgres when `AGRI_PG` is set; CI runs it after `supabase db reset`). Earlier: 139/139: forecast engines, run-out steps, Today dials, routines (missed ones stay, moving), reminders, prices, budget alerts, docket reading, farm types; plus (11 Oct) `bills.test.ts` (paid/owed, invoices, commitments, duplicates, year-end ledger), `heads.test.ts` (dated head counts in the ledger), `offline/outbox.test.ts` (UAT-06 exactly-once, UAT-07 conflicts) and `uat.test.ts` (the review's UAT-01 to UAT-10 end to end on the in-browser database) |
| Browser tests | `scripts/e2e/` (Python + Playwright, run against the demo build at phone size): `ui.py` 115 checks (dashboard, diary, add, more, farm types, crops, breeds), `routines.py` 47 checks (tick-offs now in the Diary), `stale_cache.py` 5 checks, `p1.py` 30 checks (reminders, prices, budget alerts), `ocr.py` 53 checks (photo reading), `phone.py` 19 checks (sign-up with dairy, sheep and tillage, breeds, crops, skip farm types, opening bank balance; run against `build:phone` and `build:pages`), `review.py` 43 checks (11 Oct: bills, pay, match invoice, part delivery, forecast inputs, move animals, jobs, missed routines, records search, people, change history, what-if, no sideways scroll). All pass on any day and at any time (dates in `ui.py` are now relative to today). 11 Oct night: `online.py` 13 checks (the live phone app installed first, then the new deploy: `/agri-it/online/` opens the online app, two workers, separate manifest ids and storage, phone records kept, both open offline; optional real sign-in and Move my phone data with `AGRI_ONLINE_EMAIL`/`AGRI_ONLINE_PASSWORD`) |
| Production build | Clean, PWA service worker generated |
| Database | All eight migrations + seed validated against real Postgres 16 with Supabase auth/storage stubs (`scripts/e2e/supabase_stub.sql`); RLS isolation and unique constraints tested; `scripts/e2e/db_review.sql` (31 checks: paid/owed trigger, part deliveries, retries, older clients, dated head counts, move animals, worker/adviser/family roles, invites, audit trail, farm delete) also runs in CI after `supabase db reset` |
| GitHub | `fergtech-agri-it-ireland/agri-it` (public), CI green. The Claude GitHub app is installed on the org, so a chat can push |
| Supabase cloud | `agri-it` (ref `xgudpylxmrlywegpdvps`, eu-west-1). **Half set up (11 Oct night):** migration 1 and parts 1 and 2 of migration 2 (security rules for every table, storage bucket `records`, `create_farm`, `record_feed_delivery`) applied through the connector; edge function `push-reminders` deployed (verify_jwt off, checks its own secret). **Not yet:** the rest, because the Supabase connector cancels any change containing a delete or drop (its confirmation never reached Feargal). All of it is in one paste file, see "To finish" below. Migration history holds two harmless empty entries from testing the connector (`noop_permission_check`, `noop_check_delete_word`); the paste replaces the history with the ten file versions. Feargal's Supabase org also holds `gauntlet` / `gauntlet-test` for another project with devs: do not pause or change those |
| Phone-only app | **Live for real use**: https://claude.ai/artifact/WNRa3dHK8DcwjK4KYB1ePC (version 2, 11 Oct). Starts empty, farmer sets up their own farm, everything stays on that phone. Private until shared from the page's Share menu |
| Deployed | Live app: https://fergtech-agri-it-ireland.github.io/agri-it/ (GitHub Pages, publishes from `main`). Online app: not published (13 Oct, `PUBLISH_ONLINE: 'false'` in CI); it goes to https://fergtech-agri-it-ireland.github.io/agri-it/online/ when switched on. Browser-only demo (sample farm, no database, data kept in the phone's browser) is a private artifact: https://claude.ai/artifact/PrDSDf2cB5EgRaDSMe7UJw (version 8, 11 Oct). UI concept canvas: https://claude.ai/artifact/UkQ1sRPKTTE3QN9rX11QF8 |

**Important:** the build sandbox resets between chats. Attach the GitHub repo `fergtech-agri-it-ireland/agri-it` in a new chat and clone it.

## NEW (16 Oct, afternoon): release 0.3.0, set up your farm and the financial planner

Full detail and the research behind it: `docs/SETUP-AND-PLANNER.md`.
- **Sign-up** (`pages/Onboarding.tsx`): farm and farm types only, then `/setup`. Sets the financial year to January (ROI) or April (NI) at creation (`fyHint`).
- **Set up your farm** (`lib/setup.ts` `setupPlan()`, `pages/Setup.tsx` hub and `SetupStageScreen` at `/setup/:stage`, steps in `components/setup/SetupSteps.tsx`): stages farm, animals, feeding, crops, jobs, income, bills, loans, yearend, only those that fit the farm types. A stage is done when its data is there or the farmer finished or skipped it (`farms.setup` marks). Dashboard `GuideCard` now shows setup progress (replaces Getting started; `farmGuide()` is no longer used by the app but kept with its tests). Prefills with sources: `calvingHint`, `monthChips`, `fyHint`, `JOB_IDEAS`, `BILL_IDEAS`.
- **Loans** (`lib/loans.ts`, `pages/Loans.tsx`, `components/LoanEditor.tsx`): `/money/loans`, `/money/loans/new`, `/money/loans/:id` (`?pay=<date>` opens a repayment). Balance as on a date is the start of that day (`knownBalance().inclusive`); a statement is end of period. Due repayments become `loanSuggestions` in Ready to approve.
- **Scheme payments** (`lib/schemes.ts`, `components/SchemePlanner.tsx`, `pages/Payments.tsx` at `/money/payments`): `SCHEME_RULES` with sources, `checkedOn`, `reviewBy` (16 Apr 2027; release gate fails 30 days later). `schemeSuggestions` ask on the day.
- **Year plan** (`lib/forecast/plan.ts`, `pages/YearPlan.tsx` at `/money/plan`; `d.plan` in derived) and **Budget** rewritten (FY, month by month, fill from last year). `cashForecast90(..., routines, plans)` and `plannedItems()` count loans and schemes.
- **Routines** every 1, 2, 3, 6 or 12 months (`routines.interval_months`, RoutineForm chip).
- **Year-end pack**: `pack.loans`, `totalInterest`, `schemesReceived`, `capital`, `household`, `livestock`, `details`, `checklist` (`accountantChecklist()`); CSV sections; ledger CSV adds an Interest column at the end.
- Cost categories `land_rent`, `labour`, `insurance`, `professional_fees`, `household` (household is NON_OPERATING).
- Migrations `20261016000100_setup_enums.sql`, `20261016000200_setup_planner.sql` (no deletes or drops). `setup_agri_it.sql` regenerated. `CACHE_VERSION` `v8-setup-loans`, demo `VERSION` 10 (HP tractor loan, AIB overdraft, BISS expected, setup all done), phone `VERSION` 1.
- Tests: 307 unit; `planner.py` 35 (new), `phone.py` 56 (rewritten for the new sign-up), `ui.py` 116; `db_review.sql` +16; `sharing_live.sql` and `phoneImport.pg.test.ts` pass.

## NEW (16 Oct): release 0.2.0, advisory board items A to F

- **G12 alert load** (`lib/alerts.ts`, rule `alerts@1.0`; `components/Attention.tsx`). Every Needs your attention item can carry a `group`; two or more of one group show as one line ("3 jobs due", "2 orders to place with the supplier", "3 fields to spread", "Low on 2 fertilisers"), with the most pressing member's timing and tone and a split ("1 overdue, 2 coming up"). Tap to open the list. The phone reminders bundle the same way (`reminderHeadlines`, and `bundledLines` in `reminders.ts` for the lock-screen body: "2 feeding ticks, 2 bills to pay"). The old special case for 3+ fields due is gone (it's a bundle now).
  - **Not now** (`NotNowSheet`) asks why (busy, done elsewhere, not relevant) and for how long (tomorrow, 3 days, a week, 2 weeks); Put it off stays greyed until a reason is picked. Today's choices live on the phone (`agri-it:hidden:<farm>`, older phones' plain dates still read). Suggestions save the reason on `suggestion_decisions.reason` and the chosen `until`.
  - Only information can be put off: `canPutOff` needs `dismissable`, tone info and not overdue or today; `isSnoozed` ignores an old snooze on anything that has since become pressing. A bundle can be put off only if every item in it can.
  - **Counts for the pilot** (`alertStore.ts`, `agri-it:alert-stats:<farm>`): per kind of alert, shown (once a day), acted on (opened, approved, or gone by the next day), put off (with reasons), turned down, ignored (still there next day with nothing done). Settings > Alert counts for the pilot, with Copy counts (CSV-style text) and Start again. Never sent anywhere.
- **G11 forecast exceptions** (`lib/stockReasons.ts`). New screen Wasted, used elsewhere or sold (`pages/StockAdjust.tsx`, `/feed/:id/adjust`, `/fertiliser/:id/adjust`, and Add > Wasted, used elsewhere or sold): reason first, then how much; counting error asks more or less. Feed adjustments are `feed_transactions` of type adjustment (signed kg) with `reason`; fertiliser ones are `fertiliser_stock` kind `adjustment`, which `stockFor` now counts. A stock check 25 kg and 3% or more off asks why (`WhyDifferent`, optional, only for a count dated today). `countVariances` and the new `fertiliserVariances` return the reason and the adjustments since the last check; the feed screen's Predicted vs counted and the fertiliser screen's Recorded vs checked show them plus "Reasons given". Rates are never touched.
- **G08 supplier recheck** (`lib/suppliers.ts`: `recheckBy`, `dueRecheck`). Six calendar months after `verified_on` (clamped to month end), shown on the supplier screen and its branches; amber "Due a recheck" once past, also on the supplier list. Release gate G08 in `releaseGates.test.ts` fails the build 30 days after any directory supplier's or branch's recheck date: to fix, recheck on the supplier's own contact page and update `verified_on` in a migration, `seed.sql` and `buildReference()`. Current dates: 11 Oct checks are due 11 Apr 2027 (gate fails from 11 May 2027), 14 Oct checks 14 Apr 2027. Lakeland (14 Oct): site still blocks automated reads, stays not verified, note says so. Star Fuels: site shows "account suspended", still no number.
- **Pilot readiness:** `docs/PILOT.md` field scripts S11 to S17 (fields, fertiliser in the shed, spreading, spreading reminders and Not now, the CSO comparison read as an average not a quote, stock that went missing, a fertiliser order with a part delivery), three new targets, and interview questions 7 to 11 (would the spreading reminders and the price comparison be used, stock reasons, alert load). Weekly capture now includes Settings > Alert counts.
- **Fertiliser orders** (`pages/FertiliserOrder.tsx`, `/record/fertiliser-order`, Add > Fertiliser order): kind `order` in `fertiliser_stock` with `order_status`, `expected_on` (only if the supplier said) and an optional agreed `price_per_tonne_eur`. On order on the fertiliser screen (It arrived, Cancel order) and in Bills > On order; never stock, a cost or cash. Fertiliser arrived offers "Is this against an order?", starts from what's still to come and the agreed price, and asks "Is more coming?" on a part delivery; the order closes when it's all here or the farmer says that's all. "Did the CAN arrive?" / "Rest of the CAN order?" on Today once the expected day comes. The invoice screen (now "Invoice", for feed or fertiliser) matches fertiliser deliveries too, and one invoice can cover both from the same supplier: `planInvoice` lines carry a `kind`; a fertiliser line without a bill gets a new cost (category fertiliser) and the stock row's `cost_id`.
- **Dashboard tile:** Fertiliser (stock per product, low in amber, fields due or "closed until") between the season cards and Your animals, only once the farm has a field or a fertiliser.
- **Release line** (`lib/release.ts`, `components/ReleaseLine.tsx`): "Agri-It v0.2.0 · © 2026 FergTech · Built by FergTech", and "build <commit>, built <date>" under it, at the foot of every screen (in `Screen`, plus Today, Diary, Add, Saved, Login, Onboarding). Version from `package.json` (0.2.0), commit from `GITHUB_SHA` in CI, date at build time, all via Vite `define`. Phone backups now record `app_version`.
- **Fixed on the way:** the bottom nav covered Save on the new adjust screens (now hidden there like other forms).
- **Database:** migrations `20261014000500_alert_load.sql` (decision reason), `20261014000600_stock_reasons.sql` (reasons; fertiliser adjustment and order kinds; it drops two old check constraints, so on the hosted project it goes in the paste file, never the connector), `20261014000700_supplier_recheck.sql` (Lakeland note), `20261014000800_fertiliser_orders.sql`. `supabase/remote/setup_agri_it.sql` regenerated. Phone data needs no migration: every new field is optional, older records read as before (phone `VERSION` stays 1, manifest id `/agri-it/app` unchanged). Phone import puts fertiliser orders before deliveries.
- **Tests:** 274 unit (+ the Postgres one): new `alerts.test.ts` (11), `stockReasons.test.ts` (7), `fertOrders.test.ts` (6), `release.test.ts` (2), `directory.test.ts` +1, `releaseGates.test.ts` +1 (G08). Browser: new `scripts/e2e/board.py` (40, demo build); `automation.py` 28 (Not now now asks why); `phone.py` 40 (no fertiliser tile on a new farm, release line). `db_review.sql` +13 checks. All other browser scripts unchanged and passing.
- **Local Postgres note:** `supabase_stub.sql` creates cluster-wide roles, so on a second scratch database drop the roles first; `sharing_live.sql` needs the same table grants `db_review.sql` starts with (Supabase gives them by default).

## NEW (14 Oct, evening): fields, fertiliser stock and spreading, pick lists, CSO prices

- **Fields** (`/farm/fields`, table `fields`): name, acres, use (grazing, silage, tillage, other), the farmer's own round (`spread_every_days`, 7 to 120) and, for silage, a cutting date (`cut_on`).
- **Fertiliser stock** (`/fertiliser`, `/fertiliser/:id`, `/fertiliser/new`; tables `fertiliser_products`, `fertiliser_stock`): opening stock, stock checks and deliveries (`/record/fertiliser`). A delivery's price is a normal `costs` row (category fertiliser, paid or on account) linked by `cost_id`, so Bills, cash and the year-end pack work, and workers see no money. Low warning at the farmer's own level. Smaller bulk items (bedding, silage plastic) are bills only, picked on "Paid a bill".
- **Spreading** (`/record/spread`; `fertiliser_spreads`, `fertiliser_spread_fields`): one field or several at once, per acre (50 kg bags or kg) or a total split by acres; comes off the stock; warns if past stock or at the low level, and if the date is in the closed period.
- **Rules** `lib/spreading.ts`: closed periods by zone (ROI Zone A 15 Sep to 26 Jan, B to 29 Jan, C to 14 Feb; NI midnight 15 Sep to 31 Jan), county to zone, lime and straight potash exempt. Source: gov.ie Nitrates Explanatory Handbook (2022 Regulations, p7), confirmed for 2026 by Teagasc; DAERA for NI. **S.I. 588 of 2025 replaced the 2022 Regulations on 1 Jan 2026; its closed-period schedule couldn't be read in full on 14 Oct, so ROI `reviewBy` is 14 Jan 2027.** Guidance (labelled guidance): Teagasc first N (soil above 6°C and rising, typically end of February), Teagasc silage N 50 days before cutting, DAERA grazing little and often.
- **Reminders** (`lib/forecast/fertiliser.ts`, rule `fertiliser@1.0`, in `derive()` as `d.fertiliser` and in Needs your attention, which feeds phone reminders): spreading opens (two weeks ahead; warn on the day), last day before the closed period (two weeks ahead), first round guidance, each field due on its own round, silage fields to spread by cut minus 50 days (flagged two weeks ahead), "did you cut?" after the cutting date, low stock, not enough stock for the fields due at the last rates used. Nothing is ever due while spreading is closed; a field with no round of its own is never flagged.
- **Pick lists** `lib/catalogue.ts`, `components/ProductPick.tsx`: plain names for common feeds, fertilisers, lime and bulk items; supplier names only on items a supplier lists (so far only Howard Farms, checked 14 Oct). Used on Add a feed (`feed_products.catalogue_key`) and Add a fertiliser.
- **CSO comparison** `lib/cso/compare.ts`, `components/CsoCompare.tsx`: price paid vs CSO national average (tables AJM08 feed, AJM09 fertiliser, euro per tonne excluding VAT) for the same kind of product and month (or the latest month, said so). Republic only. Figures in `src/lib/cso/cso-prices.json`, fetched by `.github/workflows/cso.yml` on the 18th of each month (`scripts/cso/fetch_cso.py`), which commits and starts CI. A unit test fails if the figures are over 100 days old. Feed screens let the farmer say what kind of feed it is.
- Migration `20261014000400_fields_fertiliser.sql` (RLS, audit, touch; `import_phone_backup` and `import_id_taken` updated; no deletes or drops). Phone import order updated. Demo: four fields and CAN (no bill, so the demo's money is unchanged).
- Tests: `fertiliser.test.ts` (22), `db_review.sql` +6, `scripts/e2e/fertiliser.py` (27, new), `phone.py` 38.

## NEW (14 Oct, afternoon): several breeds per group, more suppliers, phone directory refresh

- **Breeds as a list:** `animal_groups.breeds text[]` (migration `20261014000200_breeds_list.sql`, at most 8, each 1 to 60 characters via `breeds_ok()`). The old `breed` column stays and a trigger keeps the two in step (older client writes `breed`: list of one; list written: `breed` = list joined, cut to 60). Helpers in `lib/farmTypes.ts`: `groupBreeds()` (an older group's one breed becomes a list of one, exactly as written), `breedLabel()` ("Holstein Friesian and Jersey cross"), `cleanBreeds()`, `breedPatch()` (both fields for a save). `normalizeBundle` fills `breeds` for older phone records; Move my phone data does the same. `BreedField` is now a multi-pick: big chips, tap any number, type your own and Add. Sign-up, Animals and breeds (add and edit) and the dashboard all use it. Demo dairy cows are Holstein Friesian and Jersey cross. `CACHE_VERSION` `v7-breeds`, demo `VERSION` 9, phone `VERSION` still 1.
- **Directory additions** (migration `20261014000300_supplier_directory_more.sql`, `seed.sql`, `buildReference()`), each checked on its own website 14 Oct 2026: Brett Brothers (Callan, four branches: Callan, Windgap, Ardfinnan, Portlaw), Roche's Feeds (J. H. Roche & Sons, Dock Road, Limerick, one number), Howard Farms (Kilcanway, Mallow, head office plus four named area contacts from its own contact page). **Star Fuels & Farm Supplies** (Clonmel and Mitchelstown) is a separate business from Roche's; its website showed "account suspended" on 14 Oct, so it has no number and shows as not verified until Feargal confirms. New column `suppliers.area_served` (the supplier's own words; null = not stated, shown as such).
- **Phone directory refresh:** the phone app kept the directory from the day it was first opened, so the 11 Oct corrections never reached installed phones. `refreshReference(db)` in `demo/seed.ts` now runs on every open (`load()` in `demo/client.ts`): directory suppliers and branches by id, sources by code, allowances by class. Farm records and suppliers the farmer added are never touched; ids the phone already had are kept. `phone.py` simulates an older phone (single breed, old directory) and checks nothing is lost.
- Supplier picker: a picked supplier always shows as a chip, even if it isn't one of the four most used.
- Tests: `breeds.test.ts` (6), `directory.test.ts` (7), `phoneImport.test.ts` +1, `db_review.sql` +7 breed checks, `ui.py` 116, `phone.py` 37.
- Star Fuels stays with no number until one can be checked (Feargal: never use a number we're not confident in).

## NEW (14 Oct): advisory board review fixes

Full detail: `docs/ADVISORY-RESPONSE.md`. Pilot plan: `docs/PILOT.md`.
- **Full backup with photos (G01):** `lib/phoneBackup.ts`. Back up saves a zip: `agri-it-backup.json` (records, as before, plus a `files` index) and `files/0001.jpg`... (every photo a `documents` row points at, from IndexedDB `agri-it-files`). `fullBackup()` / `restoreFile()` in `demo/client.ts`: photos go in before the records; nothing is cleared, so a failed restore leaves the phone as it was. Older JSON backups still restore. Last backup date in `agri-it:last-backup`; Today shows `BackupNudge` (phone build) once there are 10+ records and no backup in 30 days. Move my phone data accepts the zip and uploads its photos. In a shared Claude link a backup is still records only (clipboard).
- **Currency (G05):** `eur()` / `eurCompact()` now format in the farm's currency (name kept): `setCurrency(currencyFor(jurisdiction))` runs in `normalizeBundle`. `cur()` gives the sign for form units and exports. NI = GBP (en-GB), ROI = EUR; amounts are stored as entered, never converted (columns keep their `_eur` names). Exports add a Currency row. `lib/jurisdiction.ts` names department, animal system, tax authority, postcode per side.
- **No wrapping (G13):** `.amount-cell` / `.amount` in `index.css` (container query: the amount shrinks to its tile, never breaks); `eur()` glues a minus sign to its amount with a word joiner (U+2060), so text checks for negative amounts must allow for it.
- **Silage sums (G13):** `silageSummary(forage)` in `forecast/forage.ts` is the only place silage tonnes are rounded and worded; the dial, Needs your attention and the winter plan all use it.
- **Recorded cash (G02):** `cashCompleteness()` and `reconcileCash()` in `forecast/money.ts` (`d.cashGaps`). Check against the bank stores the balance with `opening_cash_date` = tomorrow (the end of today), so today's records are taken as in it. `cashForecast90(..., routines)` adds Repeats (income and expense routines with an amount) and drops a budget line for the same category that month. Stale after 30 days: dashboard "Recorded. Check bank", Needs your attention (later).
- **Orders to place (G03):** migration `20261014000100_order_to_place.sql`, `feed_transactions.placed` (default true) and `placed_on`. `isPlaced()` in `forecast/feed.ts`; `forecastFeed` returns `ordersToPlace` apart from `openOrders`; `commitments()` and "did it arrive?" count placed orders only. The Ready to approve feed order now adds an order to place; the feed screen has I've placed it / Don't order; Today shows "Place the ... order" until then. Order form asks "Have you placed it with the supplier?" and no longer defaults a delivery date to 3 days when no delivery time is known; repeat orders no longer default to 0 days.
- **Deadlines (G06):** `lib/deadlines.ts` (`STATUTORY_RULES`, `ruleFor`, `needsRecheck`), `components/StatutoryNote.tsx`. Calf tag and register dates come from the rules (ROI tag now day 20, per S.I. 591/2022). All rules checked 14 Oct 2026, recheck by 14 Apr 2027; `releaseGates.test.ts` fails the build after 14 May 2027 unless they are rechecked (update `checkedOn` and `reviewBy`, or add a new version with `effectiveFrom`).
- **Tests:** 210 unit (+ the Postgres one): new `phoneBackup.test.ts`, `currency.test.ts`, `silageSummary.test.ts`, `cashCompleteness.test.ts`, `releaseGates.test.ts` (gates G1, G3, G5, G7 and deadline governance, all against hand-worked figures). Browser: new `scripts/e2e/advisory.py` (20 checks, demo build); `phone.py` now 32 (full backup with a photo restored on a second phone; an NI farm in pounds); `ui.py` and `review.py` wording updated. `db_review.sql` +2 checks. `supabase/remote/setup_agri_it.sql` regenerated.
- No change to `CACHE_VERSION`, demo `VERSION` or phone `VERSION`: older stored orders have no `placed` and count as placed.

## NEW (13 Oct, evening): automation and approvals

Full detail and the research behind it: `docs/AUTOMATION.md`.
- **Silage tonnes from dry matter** (`silage-dm@1.1`, `forage-budget@1.1`): a measured pit with no density gets one from its lab DM or yard-test band (DAERA table S20, IFJ 2026 S21); a band gives a range and the winter plan counts the lighter end. The silage form shows tonnes, tonnes of DM and the whole winter's cover as you type. Own density always wins; Teagasc's 719 only when no DM is known.
- **Silage best guess** (`silage-dm@1.2`, migration `20261013000200_silage_best_guess.sql`): a pit with no DM gets typical silage (ROI Teagasc 25%, NI 2025 cut average), unweighed bales 600 kg (700 well packed); labelled Best guess, winter plan Low confidence, squeeze-test suggestion. `estimateStore(s, jurisdiction)` now takes the farm's jurisdiction. Teagasc's 719 button removed.
- **Key dates at sign-up, In now / Out at grass** (`forage-budget@1.2`, migration `20261013000300_at_grass.sql`): sign-up step for housing, turnout, each group in or out (date to come in) and first calf due; winter plan counts each group from its own day in; `phone.py` now 31 checks.
- **Ready for you to approve** (`lib/suggestions.ts`, `components/ReadyToApprove.tsx`): drafted feed orders, season steps, housing/turnout, head count confirms, monthly bills to routines, silage DM, calves to tag/register. Approve / Not now (a week) / No (`suggestion_decisions`). Computed in `derive()` as `d.suggestions`; replaces the matching plain priority.
- **Calving season** (`lib/season.ts`, pages `Calving`, `SeasonForm`, `DryOff`, `CalfForm`; `/calving`, `/record/calf`): plan from first calf date or bull-in date; drying off (Teagasc 10 weeks thin, 8 on target), BCS, pre-calver minerals, tags, calving checklist; Dry off moves cows between groups and shows the feed impact; Calf born updates calves, the cow back to milking and tag/register deadlines (ROI 20/27 days, NI 36 h dairy).
- Migration `20261013000100_automation.sql` (three tables, RLS, audit, phone import updated). `CACHE_VERSION` `v6-seasons`; demo `VERSION` 8 (Spring calving season 75 days out, Dry cows group). Phone `VERSION` still 1: older phones simply have no seasons yet.
- Tests: 180 unit; `scripts/e2e/automation.py` 27 checks (new); `silage_dm.py` 28; `ui.py` bill-repeat check made date-proof (it failed on main on days 11 to 20 of a month); `db_review.sql` +6 checks.
- `supabase/remote/setup_agri_it.sql` regenerated (more security rules now, so its last-line count is higher than 89).

### Earlier: NEW (11 Oct, late): silage dry matter help

Add silage now has a **Dry matter** section (`pages/SilageForm.tsx`, rules in `lib/forecast/silageDm.ts`, rule `silage-dm@1.0`, tests `silageDm.test.ts`, browser `scripts/e2e/silage_dm.py` 21 checks):
- **Which cut is it?** First, second, third or later (optional; `silage_stores.cut`).
- **Dry matter from a silage test** (the lab figure, `dm_percent`) always comes first.
- **No test yet? Check it in the yard:** Teagasc's squeeze test (wetter silage) and ball test (drier, chopped) as big tiles; the farmer taps what they saw and gets a band (for example "about 20 to 25%, your estimate"), saved as `silage_stores.dm_test`, never as an exact figure (S17).
- **What's typical**, for guidance only, never filled in: ROI farms get Teagasc's "pit silage about 25% DM, wilt to about 30% for a pit" (S16). NI farms get 2025 averages by cut from feed trade samples (first 32.8%, second 30.8%, third 34.8%, S18) and, for first cut, 2022's 24% (S19) to show how much a year moves it. Each line links to its source.
- **Location and time of year:** researched 11 Oct; no published Irish figures by county or by month of cutting were found, so none are shown. The split is by jurisdiction (the farm's ROI/NI setting) and by cut. Add a figure here only with a source and date.
- **Pit density:** Teagasc's one published figure (pit silage of about 25% DM is one tonne per 1.39 m³, so 719 kg/m³, S16) is offered as "Use 719 kg/m³" only for a pit with no density and with no DM figure, a lab DM that rounds to 25, or a yard-test band that includes 25. Using it sets `density_basis = 'teagasc_25dm'`: the store's explanation names it and the winter budget drops to Medium confidence with the reason. Typing a density makes it the farm's own figure. If the DM later shows the silage is not about 25%, a warning asks for the pit's real density.
- Migration `20261011000500_silage_dm.sql` (columns plus evidence sources S16 to S19; no deletes, so the connector can apply it). Demo `VERSION` 7. Phone `VERSION` still 1: older phone silage has no new fields and reads as "not given".

### NEW (11 Oct, night): Agri-It Online, alongside the phone app

**To finish (parked on 13 Oct: see "Start here" for the current version of these steps):**
1. SQL Editor > New query: paste all of `supabase/remote/setup_agri_it.sql` and Run. It finishes migration 2, applies migrations 3 to 10 each in its own transaction, loads the reference data only (evidence sources, Teagasc allowances, supplier directory and Drummonds branches; never the demo login or farm), sets the migration history to the ten file versions, and runs `db_review.sql` against the demo farm inside a transaction that is rolled back. The last line should read `Agri-It set up: 89 security rules, 7 directory suppliers, 8 branches, demo farm left out: true`. It refuses to run twice. Tested on a copy of the project's state on Postgres 16.
2. Edge Functions > Secrets: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (the pair was sent in the 11 Oct chat; the private key is not in the repo. To make a new pair: `npx web-push generate-vapid-keys`; then everyone turns server reminders on again).
3. Authentication > URL Configuration: Site URL `https://fergtech-agri-it-ireland.github.io/agri-it/online/` and the same under Redirect URLs. Without it, sign-up confirmation emails point at localhost. Email confirmation is on by default in hosted projects (keep it). The built-in email sender allows only a few emails an hour: add your own SMTP before inviting many people.
4. Then, in a chat: run `scripts/e2e/sharing_live.sql` through the connector (rolled back, leaves nothing), the security and performance advisors, the push schedule (store a `push_cron_secret` in the vault, then `supabase/remote/push_schedule.sql`; needs the pg_cron and pg_net extensions, both free), and `online.py` with a real test user.

**What was built:**
- **Online build** `npm run build:online` (`.env.online`: `VITE_ONLINE=1`, the project URL and the publishable key only; never a service key). Hash routing (Pages can't answer deep links), base `/agri-it/online/`, manifest name **Agri-It Online**, id `/agri-it/online/app`, scope `/agri-it/online/`, its own service worker. CI's `pages` job builds it and copies `dist-online` into `dist-pages/online` before publishing. The phone app's manifest id stays `/agri-it/app`.
- **Two apps on one address:** every browser storage name in the online build starts `agri-it-online` (`key()`, `NS` in `lib/env.ts`: cache, outbox, farm, reminders, photos, theme...), so neither app reads or clears the other's data. The phone app's worker covers `/agri-it/`, which includes `online/`: its navigation fallback now skips `online/` (`navigateFallbackDenylist`), and when this newer phone worker takes over it reloads any window still showing the phone app at `online/` (`activate` in `public/reminder-sw.js`). Found by `online.py`: without that, a farmer with the live phone app installed got the phone app at the online address. The OCR cache rule is now a RegExp (a function was copied into the worker as text without `base`).
- **Move my phone data to my account** (`pages/MovePhoneData.tsx`, `/move-phone-data`, linked from Settings > People and history and from the first sign-up step, online build only). Source: the phone app's records in this same browser (found automatically, same address), a backup file, or pasted text. Shows what will move, into a new farm (named and placed like the phone farm) or a farm the person owns. `lib/phoneImport.ts` (pure, tested with a real backup from `build:phone`, `src/lib/testing/fixtures/phone-backup.json`, made by `scripts/e2e/make_phone_backup.py`) plans it: this farm's rows only, ids kept, `farm_id` changed, photo paths moved to the new farm's folder, shared reference data, people, on-phone history and forecast snapshots left out, orders before the deliveries that point at them, older costs without payment fields = paid. Server: `import_phone_backup(p_farm_id, p_farm, p_rows)` (security invoker, so RLS applies to every row; owner only), `insert ... on conflict do nothing` table by table in parent-to-child order, returns added / already / blocked (an id that belongs to another farm is never touched) / failed. Running it twice adds nothing. Photos still in this browser are uploaded to Storage. The phone app keeps its own copy.
- **Server reminders** (online build): `push_subscriptions` (RLS: own rows only; writes through `save_push_subscription`, `save_push_digest`, `remove_push_subscription`). Settings > Reminders shows **Send reminders when Agri-It is closed** (`lib/serverPush.ts`): asks permission, subscribes with the public VAPID key from the function (`GET ?key=1`), saves the subscription, and from then on the reminder clock saves the same 7-day digest it builds for the phone to the server whenever it changes. The edge function `supabase/functions/push-reminders` (deployed, `verify_jwt = false`) runs every 15 minutes from pg_cron with `x-cron-secret` checked against the vault (`push_cron_secret_ok`), sends that day's message at the farmer's time in their time zone, once per slot (`due.ts`, tested), marks it sent first, and forgets subscriptions the push service says are gone. Same tag as the phone's own notification, so a phone never shows both. iPhone: works only from the Home Screen app; the card says so.
- **Sharing on the real project:** `scripts/e2e/sharing_live.sql` (owner, family, farm worker, adviser created in SQL; invitations by email, a wrong email refused, a used link refused, worker sees no bills, income, budget or history and a worker's priced delivery records no cost, adviser reads everything and changes nothing, change history names who added, changed and paid what). One transaction, rolled back, then checks nothing is left. Passes on Postgres 16 with all migrations; runs on the hosted project once the paste is in.
- Login says **Agri-It Online** and what the online version is for. Invitation and sign-up links use `appLink()` (hash routes); PKCE sign-in; a pending invitation survives the email confirmation in another tab.
- CI's `database` job also runs `phoneImport.pg.test.ts` against the reset database.

### Earlier: NEW (11 Oct): fixes from the third-party review
A product review (8 Oct, written from the README only) listed P0 and P1 gaps. All are answered in `docs/REVIEW-RESPONSE.md` (gap by gap, with the test that covers each, and the UAT table). In short:

- **Bills** (`lib/forecast/bills.ts`, rule `bills@1.0`): `costs.payment_status` ('paid'/'owed', default paid so every older insert path is unchanged), `paid_on` (a trigger keeps it in step: paid without a date = the day it happened, owed = null), `due_on`, `invoice_ref`, `vat_eur`, `enterprise`. Cash (`cash-flow@1.1`) counts a cost on its paid date; owed bills come off the 90-day forecast on their due date (overdue or undated: this month). Budgets and the year-end summary still use the date incurred.
- **Deliveries**: `record_feed_delivery` takes `p_payment` ('paid' default = old behaviour for queued calls, 'account' = owed), `p_due_on`, `p_close_order` (false = more to come; the order stays open for the rest; `undo_feed_delivery` reopens it). Orders can carry an agreed €/t: shown as **On order** (committed), never a cost. The delivery form prefills what is still to come and the agreed price, defaults Paid/On account from that supplier's last delivery, and warns on likely duplicates.
- **Invoices**: `/record/invoice` (`InvoiceForm`, `planInvoice()`): pick the deliveries an invoice covers; the invoice replaces their docket costs (split by docket cost, or by kg if any had no price, to the cent), so nothing is counted twice. A feed invoice photo opens it when a matching uninvoiced delivery exists (`formFor()`); "Paid a bill" with category Feed offers it too.
- **Bills to pay** `/money/bills`: owed by supplier, overdue first, Pay one or the whole statement, recently paid with "Not paid". Money shows Cash now / To pay / On order, loans and capital (new categories `loan_repayment`, `capital`) kept out of running costs, by-enterprise view when tagged. Cash tab has **What if?** (income %, costs %, one-off spend), always labelled a scenario.
- **Dated head counts** (`lib/heads.ts`, `feed-runout@1.1`): `head_count_history.previous_count`; the bundle now loads `headHistory`; each ledger day uses the count in force that day; future-dated changes only affect the forecast from then; the group's current count is today's (`normalizeBundle` applies `groupsAsOf`). SQL `heads_on()`, `set_head_count(..., p_id)` (idempotent), `move_animals()`. Groups screen: "Since when?", count history, **Move animals**.
- **Alerts that stay**: missed routines no longer drop off after 7 days; each routine's missed days are one line (oldest first) with "Skip those"; **Move** to tomorrow or a date (`routine_completions.status 'moved'`, `moved_to`). Jobs: Move, or "No longer needed" (`jobs.dismissed_at`). Today's **Needs your attention** groups Overdue / Today / Coming up / Later; overdue and today never fold; only info can be hidden for a week. Settings > Alerts: `farms.bill_warning_days`, `order_warning_days`. Reminders lead with overdue bills, late orders and feed to order (`reminderHeadlines`).
- **Offline conflicts**: `updated_at` + touch trigger on every editable table. `useSave` adds the version an edit was made against (`withVersions`, hosted build only); the outbox refuses to overwrite a newer change (`ConflictError`), shows **Keep theirs / Use mine** in Sync, recognises its own already-landed retry, and chains two offline edits to one record. Duplicate deliveries (two phones) show on Today; the feed screen offers "Remove the second / Two loads came".
- **Roles, invites, history** (hosted build): role `worker` (records feed, deliveries, counts, jobs; RLS hides costs, income and budget; a worker's priced delivery records no cost), `can_see_money`/`can_write_money`, `farm_members.email`, `farm_invites` + `create_farm_invite`/`accept_farm_invite`, `/join/:token`, Settings > People. `audit_log` with an `audit_row()` trigger on money, feed, animals, records, jobs; Settings > Change history (`lib/audit.ts` puts it in words). The phone build keeps its own on-phone history (last 2,000 changes).
- **Exports and records**: Year-end **accountant pack (zip)** with summary, every transaction (`ledgerCsv`, totals match), records and attachments (`fflate`, `lib/exportPack.ts`). Records is a searchable vault (`lib/vault.ts`) across records, invoices, dockets and photos, linked to supplier, group or feed, with an "evidence, not an official register" note.
- **Forecast trust**: feed screen "What this forecast is worked out from" (stock basis and evidence, head counts and their date, plan, changes ahead, delivery time and source, on order, confidence, time worked out).
- **Setup**: last onboarding step asks money in the bank today, financial year and (optional) delivery days.
- **Suppliers**: re-checked 11 Oct (migration `20261011000300_supplier_directory.sql` and `seed.sql`): Tirlán, Dairygold (+ team page), Aurivo, Drummonds, Fane Valley verified; Drummonds' 8 branches loaded; Lakeland now shows **not verified** (site blocks automated checks).
- Migrations: `20261011000100_review_enums.sql`, `20261011000200_review_fixes.sql`, `20261011000300_supplier_directory.sql`. `CACHE_VERSION` `v5-review`; demo `VERSION` 6 (owed bills, part-delivered calf order, ticked routine history). Phone `VERSION` still 1: older phone records need no migration (no payment fields = paid on the day; no `previous_count` = today's count).
- `useDerived` is now a thin wrapper over pure `derive(b, today)` (tested directly).

### Earlier: NEW (7 Oct, night): fitness-tracker UI and open farm types
Feargal disliked the old UI ("for 2 year olds or 92 year olds") and the restricted sign-up. Rebuilt in the style of MyFitnessPal (the Design canvas "Agri-It Simple Prototypes" holds the agreed prototype and walkthrough: https://claude.ai/artifact/2jeDd6ezur6KXuPrxyHwZL).

- **Look:** Figtree type (replaces Atkinson Hyperlegible and Barlow Condensed), white cards on a soft grey-green ground, one green accent (#0B7A55), amber only for "do something", pill buttons, 48px tap targets (was 56). Tokens are still CSS variables in `src/index.css` (new `--money`, `--silage`); dawn and sunlight modes still work. Theme colour #F1F4F2 (dawn #0B110E). Manifest `id` unchanged.
- **Bottom bar:** Dashboard `/` · Diary `/diary` · **+** `/record` · Progress `/progress` (the old Forecast, `/forecast` still works) · More `/more` (`/farm` shows the same hub). The bar hides on screens with a save bar.
- **Dashboard** (`pages/Today.tsx`): feed ring for the feed that runs out first (days left against your target, bin, daily use, order-by chip with Call), other feeds under it, Silage and Cash cards, Today's diary progress, Do next, then cards per farm type (Milk for dairy, Crops for tillage, Your animals with breeds), and the month against budget. A **Getting started** card (`farmGuide()`) steers each farmer to what matters for their mix of farming until done or hidden.
- **Diary** (`pages/Diary.tsx`): Day view with day-by-day arrows, the bin sum (start − fed + delivered = in the bin, any feed), then sections like meals: Feeding and Jobs and routines (the tick-off list, `Checklist` with `kinds`), Deliveries and orders, Money, Records, each with ADD. History tab (`components/DiaryHistory.tsx`) is the old full timeline and milk chart.
- **Add** (`pages/Record.tsx`): search, Scan a docket, a quick tile for the farmer's most likely entry, Recent (same as last time, + to add again) and Everything (`addOptions()`: the farmer's kinds first, everything else under "Other things you can add"; nothing hidden).
- **Farm types** (migration `20261007000100_farm_types.sql`): `farms.enterprises text[]` (dairy, suckler, beef, calf_rearing, sheep, tillage, pigs, poultry, horses, goats, other; any mix; empty = not said yet). The old `enterprise` column is kept in step (`mixed` when more than one). `create_farm` now takes `p_enterprises`. Older stored farms without the list are read through `farmTypes()` (`normalizeBundle` fills it), so Feargal's phone data needs no migration.
- **Animals:** new classes heifers, bullocks, rams, hoggets, goats, pigs, poultry, horses. `animal_groups.breed` (free text, max 60) with common Irish breeds per species one tap away (beef breeds first for bullocks, sucklers, stores). Silage budget: heifers and bullocks use the published store cattle figure and say so; pigs, poultry and horses are left out of it; other classes without a figure still ask.
- **Tillage:** `crops` table (name, variety, acres, harvest year; RLS like other farm tables), Crops screen `/farm/crops`, income type `crop` (grain and straw, `/record/income?type=crop`), cost category `seed_sprays`. Dashboard Crops card shows acres, inputs this year and per acre, and sales.
- **Sign-up** (`pages/Onboarding.tsx`): farm, then "What do you farm?" (any mix, Skip allowed), then Your animals (the usual groups for what was picked, compact counts, breed once a count is set, "Add another kind of animal" from every species), then Your crops for tillage. `/farm/types` changes farm types any time.
- `CACHE_VERSION` is `v4-farm-types`; demo `VERSION` 5 (demo groups now have breeds). Phone `VERSION` still 1: nothing to migrate.
- Checked: typecheck, 103 unit tests, all five migrations and the seed on Postgres 16 with RLS (a second user cannot see or add crops; bad farm types rejected), every browser script above, phone build and the Pages build under `/agri-it/`.

### Earlier: MOVED (7 Oct, 19:00): repo is now `fergtech-agri-it-ireland/agri-it`
Agri-It now has its own GitHub organisation so it gets its own web address, separate from Gauntlet. Reason: on `fergtech-ireland.github.io` the two apps shared one address, Gauntlet's update clean-up cleared Agri-It's offline copy, and Feargal's Android Chrome got stuck showing "This app is already installed" for Agri-It (no Agri-It in chrome://webapks; "Click to open" fails). Feargal has created the org, transferred the repo and installed the Claude GitHub app on it.

**Done (7 Oct, 19:05):** the repo is public, Pages source is GitHub Actions, and CI run 37663526124 passed all three jobs (latest: run 38150180839 on 11 Oct, all three jobs green including the review DB checks) (app, database, pages). The live app at **https://fergtech-agri-it-ireland.github.io/agri-it/** serves the bundle built from `main`, `sw.js` with navigateFallback `/agri-it/index.html`, and a manifest with id `/agri-it/app`, scope and start_url `/agri-it/`, display `standalone`. Old references in this file, the starter prompt and code comments are updated. The old address `fergtech-ireland.github.io/agri-it/` is no longer published; nobody has data there except Feargal's test. **Confirmed 7 Oct, 19:09:** Feargal installed it on Android from Chrome and it works like Gauntlet, as its own app.

### Earlier: GitHub Pages app (7 Oct, evening)
- `npm run build:pages` (`.env.pages`, mode `pages`): the phone-only app as a real installable web app, now at **https://fergtech-agri-it-ireland.github.io/agri-it/** (was fergtech-ireland.github.io until the move) (base `/agri-it/`, hash routing, service worker, offline, add to home screen, photo reader served from the app's own `ocr/` folder, file backups and print work). Output `dist-pages/`.
- CI job `pages` in `.github/workflows/ci.yml` publishes it after the app checks pass on `main`, the same pattern as Gauntlet. It only runs once the repo is **public** and **Settings > Pages > Source = GitHub Actions**. Can also be run by hand (Actions > CI > Run workflow).
- The Pages build takes its path from CI (`PAGES_BASE` from `actions/configure-pages` `base_path`), so it works at a project path (`/agri-it/`) or at the root of its own address with no code change.
- Manifest has a fixed `id` (`/agri-it/app`): Feargal's first Android install left a broken "already installed" entry; never change this id again or every phone sees a second app.
- **Shared origin with Gauntlet (until the 7 Oct move; the repair stays as a safety net):** both lived on `fergtech-ireland.github.io`, so they share localStorage, IndexedDB and Cache Storage. Keys do not clash (`agri-it:` prefixes). Gauntlet's `sw.js` activate step deletes every cache not in its KEEP list, which wipes Agri-It's offline copy when Gauntlet updates. Agri-It repairs itself (`src/lib/offlineHeal.ts`): each time it opens with signal it checks its precache and, if missing, installs its worker afresh (`sw.js?repair=...`, because re-registering the same URL is ignored). Gauntlet is not changed. Agri-It only ever deletes its own keys and databases (`agri-it:*`, `agri-it-files`, `agri-it-photos`). `scripts/e2e/with_gauntlet.py` serves both apps on one address and checks all of this (8/8). Never clear site data for the origin: it would delete both apps' records.
- Checked when served under `/agri-it/`: `scripts/e2e/phone.py` all pass; service worker active and in control; manifest `standalone`; reopens offline with the farm; camera capture on; sample docket read in about 3 s; no requests to any outside site.

### Earlier: phone-only build (7 Oct, afternoon)
Feargal wants to use Agri-It on his phone and share it before any server exists. Decision: **records stay on the user's phone for now**; Supabase and hosting come later.

- **New build mode** `npm run build:phone` (`.env.phone`, `VITE_LOCAL=1`) writes one self-contained file, `dist-phone/index.html`. It reuses the in-browser Supabase stand-in (`src/lib/demo/client.ts`) but starts from **reference data only** (`buildReference()` in `seed.ts`: Teagasc sources and allowances, supplier directory) with no farm, so first open goes to farm set-up. `IS_LOCAL` and `IN_BROWSER` flags in `src/lib/env.ts`.
- **Storage:** records in localStorage key `agri-it:phone-db` (separate from the demo's key), photos in IndexedDB `agri-it-files`. Asks the browser for persistent storage. Stored phone data is **never discarded on a version change**: `VERSION` for the phone build is 1 and must be migrated, not bumped-and-wiped like the demo.
- **No sync UI** in the phone build: no "offline / waiting to sync" pill, photos attach without signal, no sign-out (no accounts).
- **Settings > Kept on this phone:** record count, a plain warning that clearing browser data deletes records, **Back up / Restore** (JSON of all records, not photos) and **Delete everything and start again**. `backupJson()`, `restoreBackup()`, `localSummary()` in `client.ts`; UI in `src/components/PhoneStorage.tsx`.
- **Inside a shared page (`IN_FRAME`):** the Claude artifact frame blocks downloads, print and the photo reader's files. So Back up copies the backup to the clipboard (or shows it to select), Restore takes pasted text or a file, the year-end pack offers **Copy as CSV** and hides Print, and the photo screen says reading does not work in the shared link and to fill it in by hand (photo still kept).
- **Bug fixed (all builds):** finishing farm set-up bounced new users back to step 1, because the screen left before the new farm reached the farm list. Onboarding now waits for the farm to appear, then goes to Today.
- **Checked:** typecheck, 92/92 unit tests, demo `ui.py` 82/82, plus phone-only runs at phone size: set-up, cost, feed, offline save, close and reopen, photo kept in IndexedDB across reopen, backup file, restore on a second phone, delete all; and framed runs: copy backup, paste restore on a second phone, CSV copy.

### Earlier: photo reading for dockets, receipts and invoices (7 Oct)
**Where the reading happens (decided 7 Oct):** one pipeline with a swappable reader. Today the reader is open-source OCR (Tesseract.js 7, English `best_int` model) running **on the phone**: free, the photo never leaves the phone, works offline once its files (about 7 MB) are cached. Once Agri-It is hosted, add a better **server reader** (an AI vision model behind a Supabase edge function) for messy and handwritten dockets. Both readers return text lines only; the same tested rules turn lines into values, so a value can never appear that is not on the page.

- **Rules** (`src/lib/docket/extract.ts`, rule `docket-read@1.0`, pure, tests in `extract.test.ts`): works out the kind (delivery docket, supplier invoice, bill or receipt) and whether it is feed; reads supplier, date (day first, skips due dates), product, quantity and unit (t, kg, "40 x 25kg"), €/t (labelled or the rate on the product line), total, net, VAT and rate, docket or invoice number, and the bill category. Matches suppliers by distinctive name words (accents ignored, one smudged letter allowed; counties and generic words like "Valley" or "Co-op" never match), past payees in the farmer's own spelling, and feeds by name with protein % that must agree (16% never matches 14%).
- **Confidence per value:** high / medium / low from the reader's line confidence, raised or lowered by the document's own sums (quantity x €/t = total, net + VAT = total). A smudged unit is settled only by those sums. **Low values are never filled in**: they show as "tap to use" suggestions. Dates in the future or over four months old are suggestions only. Anything not read is left blank and labelled "Couldn't read".
- **Cleanup on the phone** (`prepare.ts`): orientation, scale to about 2,000 px, evens out uneven light and crease shadows (divides by a background map), contrast stretch; the reader straightens crooked pages (`rotateAuto`). In testing, a very dim, 8 degree crooked, creased docket read nothing raw and read fully after cleanup. Do not set Tesseract's DPI or page mode: forcing them lost whole pages.
- **Reader** (`reader.ts`): the app serves its own copies from `/ocr/` (`scripts/copy-ocr-assets.mjs`, runs before dev and build; `public/ocr/` is git-ignored); the service worker caches them on first use (`agri-it-ocr`, not precached); the Record screen warms the reader up while there is signal. A quick reachability check and a 30-second no-progress limit mean a blocked or offline reader fails fast instead of hanging. `currentReader()` is where the server reader slots in (contract in the file header).
- **Flow:** Record > photo > "Reading the photo" steps > "Looks like: Feed delivery docket" with a one-line summary > **Check and save** opens Feed arrived (feed) or Paid a bill (not feed), or "Not right? It's a..." to pick the form. Forms open with a "Read from photo" card (thumbnail, the document's sums, suggestions, what couldn't be read, "Nothing is recorded until you tap Save") and a tag under each field: read, how sure, the line it came from, or "You changed this". Read mode never fills values from last time. Nothing is saved until Save.
- **Evidence:** the photo is shrunk to about 2,000 px JPEG and kept as the document, with what was read, how sure, and what the farmer changed in `documents.extracted` (column already existed). Docket: evidence `confirmed_docket`, document confirmed on Save. Invoice or receipt for feed: evidence `invoice_derived` (forecast confidence drops to Medium) and the invoice document waits in Records > Confirm these; confirming there also upgrades the delivery to `confirmed_docket`. Bills: matched directory supplier sets `costs.supplier_id`; the receipt or invoice number and VAT go in the note.
- **Offline:** reading itself works offline once the reader is cached. If the reader can't start, the farmer can keep the photo ("Read it when I have signal"); it waits in **Photos to check** on Record (IndexedDB `agri-it-photos`) and is read on reconnect or when Record opens; Today shows "1 photo read, ready to check". Evidence photos for records saved offline are queued and uploaded and linked (`document_id`) after the record syncs (`flushPhotoUploads`, after the outbox).
- **PDFs** are not read yet: the farmer picks the form and the file is attached as before.
- **Demo:** file picker instead of the camera, three sample photos marked SAMPLE (`src/lib/demo/samples/`, made by `scripts/samples/make_dockets.py`: crooked dim docket, creased vet receipt, dark feed invoice). The hosted artifact blocks the reader's downloads, so samples use the reader's own saved output (`sampleText.ts`, made from the same images) and say so; your own photos show that the demo page blocks the reader. In the real app every photo is read live.
- `ocr.py` serves the reader's CDN files from `node_modules`, so the real reader runs in the test browser with no network, then blocks them to test the fallback and the read-later queue. `scripts/e2e/fixtures/very-dim-docket.jpg` is the hard case.

### Earlier: reminders, price history, budget alerts (6 Oct, night)
- **Daily reminders** (`lib/reminders.ts` pure + tests, `lib/reminderClock.ts` browser, `public/reminder-sw.js` service worker add-on via workbox `importScripts`, `components/Reminders.tsx`). Settings > Reminders: morning (6 to 9am) and evening check (5 to 8pm), per phone like dawn mode. Shows a preview of the exact notification. Delivery, best first: (1) app alive in the background, a minute clock notifies; (2) app closed, installed on Android Chrome, periodic background sync wakes the service worker, which reads a 7-day digest the app saves to IndexedDB (`agri-it-reminders`); (3) any phone, "Add to phone calendar" downloads an .ics with daily alarms (hidden in the demo, because the artifact viewer blocks downloads). No buzz while the app is on screen. A reminder only opens Today; it never records anything. Reminders fire within 3 hours of their time, once a day. The service worker also handles `push` (title/body/url JSON) and notification taps, ready for server push. Today shows a one-time "Get a nudge at milking time" link until reminders are set.
- **Supplier price history** (`lib/forecast/prices.ts`, rule `price-history@1.0`, `components/Prices.tsx`). Built only from priced deliveries (orders are not prices paid). Feed screen: "Price paid" card with last 8 deliveries, change since the one before, 12-month tonnage-weighted average, lowest/highest, last price by supplier. Supplier screen: "Prices you've paid". Delivery form: compares the price as typed with the last price from the same supplier (else anyone); 3% or more is "up/down", otherwise "about the same (+€5/t)". Saved screen mentions the rise. Ask Agri-It answers "What did I pay for meal?".
- **Budget variance alerts** (`budgetAlerts()` in `money.ts`, tests in `budget-alerts.test.ts`). Only when data coverage is adequate. One alert per category: year so far on completed months only (costs 10% and €250 over, income 10% and €500 behind), this month's budget already used up (10% and €250), or an info note that last month ran 25% over. Warnings go to Today's Do next; all show on Money. Money's budget bars now use completed months too (matching the alerts) with "October so far" underneath. `budgetVsActual()` rows gained `closed` and `thisMonth`; `budget`/`actual` are unchanged for the delivery and milk Saved screens.
- Demo seed: five months of priced Dairy nut deliveries (Tirlán and one from Dairygold), a measured count 170 days back, nut rules starting then. Demo `VERSION` is 4. `CACHE_VERSION` unchanged (bundle shape unchanged).

### Earlier fix: demo showed a white page (6 Oct, commit after b0a30f0)
Cause: the phone had cached farm data from the previous demo version, which lacked the new routines lists, so Today crashed and there was no error screen. Fixed by:
- `CACHE_VERSION` in `src/main.tsx` (persisted query cache buster, now `v3-routines`). **Bump it whenever the shape of `FarmBundle` changes.**
- `normalizeBundle()` in `src/lib/data/farm.tsx` (used as the query `select`): missing lists become empty arrays. Add any new bundle list to `LIST_KEYS`.
- Demo DB `VERSION` in `src/lib/demo/client.ts` (now 3). Bump when the seed shape changes; a mismatch also clears the cache and outbox.
- `src/components/ErrorBoundary.tsx` wraps the app: shows "Reload" (real app, keeps unsynced saves) or "Reset demo and reload" (demo).

---

## 3. Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18, TypeScript 5.6, Vite 5, Tailwind 3, React Router 6 |
| Data fetching | TanStack Query 5 with localStorage persistence (offline reads) |
| Backend | Supabase: Postgres 15, Auth (email/password), Storage (bucket `records`), RLS |
| Offline | vite-plugin-pwa service worker + write outbox with idempotent replay |
| Tests | Vitest (pure forecast functions) |
| CI | GitHub Actions: typecheck, test, build; plus `supabase db reset` and `db lint` |
| Fonts | Atkinson Hyperlegible (body), Barlow Condensed (display) |
| Icons | lucide-react |

Node 20+ (22 in `.nvmrc`). Supabase CLI is a dev dependency, so no global install. Docker Desktop is required for local Supabase.

---

## 4. Run it locally

```bash
npm install
npm run supabase:start          # needs Docker running; prints API URL + anon key
cp .env.example .env.local      # paste anon key into VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173
```

Demo login (seeded): `demo@agri-it.local` / `agri-it-demo`, or tap **Open the demo farm** (dev builds only).

Demo farm: Glenview Farm, Co. Tipperary, dairy. Four groups, two feeds (one with an open order and an estimated opening stock, one with a temporary feeding plan), a silage pit and bales, eight months of milk/cost history, budget, records and jobs. All dates are relative to the day of seeding.

**Browser demo** (no Docker, no database): `npm run build:demo` writes one self-contained file, `dist-demo/index.html` (`VITE_DEMO=1`, hash routing, in-browser fake Supabase in `src/lib/demo/`). To republish the artifact, strip `<!doctype>/<html>/<head>/<body>` and keep the title (`Agri-It Demo`), theme-color meta, styles, `<div id="root">` and the script, then publish to the same artifact URL.

**Phone-only build** (real farm, data on the phone): `npm run build:phone` writes `dist-phone/index.html`. To republish the artifact, strip `<!doctype>/<html>/<head>/<body>`, the charset and viewport metas and the icon links, keep `<title>Agri-It</title>`, the theme-color meta, styles, `<div id="root">` and the script, then publish to https://claude.ai/artifact/WNRa3dHK8DcwjK4KYB1ePC.

**Online build:** `npm run build:online` writes `dist-online/` (base `/agri-it/online/`). To serve both apps like Pages: copy `dist-pages` to `site/agri-it` and `dist-online` to `site/agri-it/online`, then `python3 -m http.server --directory site`. `python3 scripts/e2e/online.py OLD_ROOT NEW_ROOT out/online` checks the switch from the previous phone build (OLD_ROOT holds `agri-it/` built from the previous main).

**Browser tests:** serve `dist-demo` (`cd dist-demo && python3 -m http.server 4331`) then `python3 scripts/e2e/ui.py http://localhost:4331/ out/`, same for `routines.py`, `p1.py`, `ocr.py`, `review.py` and `silage_dm.py`, and `stale_cache.py` (one argument). Needs `pip install playwright` and a Chromium.

**Database checks:** on a scratch Postgres 16: the stub, every migration, `seed.sql`, then `psql -v ON_ERROR_STOP=1 -f scripts/e2e/db_review.sql` (CI runs it against `supabase db reset`), `psql -v ON_ERROR_STOP=1 -f scripts/e2e/sharing_live.sql`, and `AGRI_PG=<url> npx vitest run src/lib/phoneImport.pg.test.ts`. Hosted project: `python3 scripts/make_remote_setup.py` rebuilds the paste file from the migrations.

Other commands: `npm run supabase:reset` (rebuild + reseed), `supabase:status`, `supabase:stop`, `npm test`, `npm run typecheck`, `npm run build`. Studio at http://127.0.0.1:54323.

Phone testing: `npm run dev -- --host`, set `VITE_SUPABASE_URL` to the laptop's LAN IP. Voice dictation and "install to home screen" need HTTPS.

---

## 5. Repo layout

```
.github/workflows/ci.yml          CI: app checks + database reset/lint
supabase/
  config.toml                     local stack config (email confirmations OFF locally)
  migrations/
    20260929000100_schema.sql     tables, enums, indexes
    20260929000200_security_and_functions.sql   RLS, storage policies, RPCs
    20261006000100_feed_target.sql              farms.feed_target_days (fills the Feed dial)
    20261006000200_routines.sql                 routines, routine_completions, feed_use_logs, feeding_rules.confirm_daily
    20261007000100_farm_types.sql               farms.enterprises (any mix), new animal classes, animal_groups.breed, crops, crop income, seed_sprays cost
    20261011000100_review_enums.sql             loan_repayment and capital costs, worker role, moved routine status
    20261011000200_review_fixes.sql             bills (paid/owed/due/invoice/VAT), part deliveries, dated head counts, move_animals, updated_at, roles, invites, audit_log
    20261011000300_supplier_directory.sql       supplier numbers re-verified 11 Oct, Drummonds branches
    20261011000400_online.sql                   phone backup import, push subscriptions
    20261011000500_silage_dm.sql                silage cut, yard-test dry matter, density basis, sources S16 to S19
  seed.sql                        evidence sources, Teagasc allowances, suppliers, DEMO user + farm
src/
  main.tsx, App.tsx               providers, routes
  index.css                       Tailwind layers, sunlight mode, print styles
  lib/
    types.ts                      row types + label maps + county lists
    format.ts                     dates (UTC day maths), €/kg/t formatting, uuid, hash
    supabase.ts                   client
    suppliers.ts                  contact routing
    ask.ts                        Ask Agri-It rule engine
    upload.ts                     document upload to storage
    forecast/feed.ts (+test)      run-out, reorder, order-by, confidence, variance
    forecast/forage.ts            winter silage budget
    forecast/money.ts             cash, 90-day forecast, budget vs actual, year-end pack, CSV
    forecast/forage-money.test.ts
    data/farm.tsx                 session, farm selection, bundle query, useSave (optimistic + undo)
    data/derived.ts               all forecasts + Today priorities + forecast snapshot writer
    offline/outbox.ts             queued writes, flush on reconnect
  components/
    ui.tsx                        Screen, Card, Button, Stepper, Chips, DateChips, VoiceButton,
                                  ConfidenceBadge, Explain, Sheet, Row/List, SaveBar
    Layout.tsx                    app shell, bottom nav, Record sheet, sync pill, RequireFarm
    FeedGauge.tsx                 silo-level feed card (signature component)
    Toast.tsx                     toast with Undo
    pickers.tsx                   feed/supplier/group pickers
  pages/                          28 screens (see section 8)
scripts/e2e/                      browser test scripts (ui, routines, stale cache, p1, ocr, review, phone, online) + Postgres stub + db_review.sql + sharing_live.sql + fixtures/
supabase/functions/push-reminders  server reminders (edge function; due.ts is unit tested)
supabase/remote/                  hosted project only: setup_agri_it.sql (one-time paste), push_schedule.sql (pg_cron)
src/lib/phoneImport.ts            Move my phone data (plan); src/pages/MovePhoneData.tsx (screen)
src/lib/serverPush.ts             server reminder opt-in (online build)
scripts/samples/make_dockets.py   makes the demo's sample docket photos and the hard test photo
scripts/copy-ocr-assets.mjs       copies the photo reader into public/ocr/ (before dev and build)
src/lib/docket/                   photo reading: extract (rules, tested), prepare (cleanup), reader, flow, photoStore
src/components/PhotoRead.tsx      Read from photo card and per-field tags; PhotoQueue.tsx: Photos to check
public/reminder-sw.js             service worker add-on: reminders (periodic sync), push, notification taps
docs/screenshots/                 today, delivery, feed-detail, silage, record-sheet
```

---

## 6. Data model (Supabase)

Feed is always stored in **kg**. Money is `numeric(12,2)` euro.

| Table | Purpose |
| --- | --- |
| `farms` | Eircode, county, ROI/NI, enterprises (list, any mix; old single enterprise kept in step), FY start month, opening cash + date, default lead time, forage reserve %, housing/turnout dates, feed target days (farmer's own comfort level, default 30) |
| `farm_members` | user to farm, role `owner` / `member` / `advisor` (advisor = read-only) |
| `crops` | tillage crop: name, variety, acres, harvest year, archived |
| `animal_groups` | class, breed (free text), head count, `head_count_updated_at`, optional farm-history forage t/head/month, housed flag |
| `head_count_history` | every head count change with its effective date and `previous_count`; the feed ledger reads it (count in force each day) |
| `farm_invites` | email + role + one-time token (14 days); accepted through `accept_farm_invite` |
| `audit_log` | who (`changed_by`, `changed_by_label`) added, changed or removed which row, when, with old and new values; owner and adviser read it |
| `suppliers` | `farm_id` null = shared verified directory (read-only); non-null = farm-added. Central/secondary phones, `verified_on`, `source_url`, `needs_live_directory` |
| `supplier_branches` | branch/territory contacts with counties served. **Empty**: only load verified data |
| `farm_supplier_settings` | "My rep" override, supplier lead time, account no, last used |
| `feed_products` | name, storage, safety stock (days or kg), optional lead time |
| `feed_transactions` | `opening` / `order` / `delivery` / `count` / `adjustment`; order vs delivery dates; evidence level; price total and €/t |
| `feeding_rules` | product × group × kg/head/feed × feeds/day, date window, `is_temporary` |
| `silage_stores` | method `acreage` / `pit_dimensions` / `bale_count` / `measured_tonnes`, analysis fields, fed-out tonnes |
| `income`, `costs` | typed income and cost categories; feed delivery cost links via `feed_transaction_id` (cascades on undo) |
| `budget_lines` | monthly or annual budget per income/cost category |
| `farm_records`, `documents`, `jobs` | records with confirmation state, uploads (`documents.extracted` holds what was read from a photo, never trusted until confirmed), simple jobs |
| `evidence_sources`, `forage_benchmarks` | published sources (S1 to S6) and Teagasc allowances with dates |
| `forecast_snapshots` | governance: inputs, inputs hash, output, confidence, rule version, timestamp |
| `routines` | recurring work: kind `expense`/`income`/`job`/`count`/`order`/`silage`, frequency `daily`/`weekly`/`monthly`/`every_n_days` (weekday, day of month, interval), start/end, usual amount, category, counterparty, feed/silage/supplier links, active |
| `routine_completions` | one row per routine per due date: `done`/`skipped`, actual amount, link to the record it created (`costs`/`income`/`feed_transactions`); unique (routine, due date) |
| `feed_use_logs` | ticked-off feeding: rule, product, group, day, planned kg, actual kg, `fed`/`changed`/`skipped`; unique (rule, day) |
| `feeding_rules.confirm_daily` | show this rule on Today's checklist (default on) |

**RPCs** (all take a client-generated id and are idempotent on retry): `create_farm`, `record_feed_delivery`, `undo_feed_delivery`, `set_head_count`, `record_animal_sale`, `undo_animal_sale`.

**RLS:** helper functions `is_farm_member`, `can_write_farm`, `is_farm_owner` (security definer). Every farm-scoped table: members read, owner/member write. Storage paths are `<farm_id>/<file>`.

---

## 7. Forecast logic (the rules that matter)

**Feed run-out** (`feed.ts`, rule version `feed-runout@1.0`)
- Daily use = Σ (heads × kg/head/feed × feeds/day) over rules active that day.
- A temporary rule **replaces** that group's normal rule for its window, then reverts.
- Stock today = latest count/opening + deliveries/adjustments since − planned use since.
- Open orders are **never** stock. Shown separately with a "run-out if it arrives" date.
- Reorder point = safety stock (days × daily use, or fixed kg). Order-by = reorder date − lead time.
- Lead time resolution: feed → supplier setting → farm default → **none** (no order-by date, never guessed).
- Confidence starts High and drops: invoice-derived stock or stale head counts (>30 days) or old count (>45 days) → Medium; estimated opening stock, unconfirmed delivery, no plan → Low.
- `countVariances()` shows predicted vs counted at each count. It never changes the farmer's rate.
- Spec worked example verified: 8,000 kg, 280 kg/day → 28.6 days; 3-day safety 840 kg → reorder day 25; 3-day lead → order by day 22.

**Forage** (`forage.ts`, `forage-budget@1.0`)
- Measured stores beat acreage × yield (acreage is labelled a planning estimate).
- Pit with no density, or a class with no Teagasc allowance: asks for the figure, never assumes one.
- Group farm-history figure beats Teagasc allowance (dairy 1.6, suckler 1.4, in-calf heifer/store 1.3, weanling 0.7 t/head/month, source S3).
- Need = demand × months from housing (or today) to turnout; reserve default 15%. Status: surplus / tight / deficit / incomplete.

**Money** (`money.ts`, `cash-flow@1.0`)
- Cash = opening balance + income − costs since opening date.
- 90-day forecast keeps **known** (future-dated entries) and **assumed** (budget, pro-rated) separate.
- Budget vs actual only raises alerts when ≥75% of elapsed months have data.
- Year-end pack: income/costs by type, monthly flows, supplier totals, milk litres, livestock head, missing-data checklist. Labelled "management summary, not statutory accounts or a tax calculation". CSV export + print.

**Routines** (`routines.ts`, `routineActions.ts`, rule versions unchanged)
- Reminder model: nothing is recorded until ticked. Monthly on the 31st falls on the last day of short months.
- Checklist = everything due today (pending and done) + unticked items from earlier: 7 days for routines, 3 days for feeding. Nothing before a rule/routine was created.
- Feeding: one tick per active rule per day (temporary rules replace the normal one). A log's actual kg replaces the plan in `stockAt`; skip = 0; unticked days use the plan. "In the bin now" = start-of-day stock less what was ticked today (a count taken today only loses ticks made after it). Once a farm uses ticking, 3+ unticked days in the last week drops confidence to Medium with a reason.
- Ticks write the real record in the same save: bill → cost, income → income, order → open order (expected = due + lead time), count → opens the count form and completes on save, silage → amount comes off the store via `silageWithFedOut()`. Unticking deletes the completion and its record.

**Ask Agri-It** (`ask.ts`): keyword rules over farm data only. Also answers "what is left to do today?" from the checklist. Refuses ration recommendations. Unknown questions get "I can only answer from your farm records".

---

## 8. Screens and routes

**Since 7 Oct, night:** Dashboard `/` · Diary `/diary` (`?d=` day, `?tab=history`) · Add `/record` · Progress `/progress` · More `/more` (also `/farm`) · What you farm `/farm/types` · Crops `/farm/crops` · Animals and breeds `/farm/groups`. The list below is the older detail; forms and feed screens are unchanged apart from the look.

Today `/` (three dials, Do next, Feeding today, quick tiles, feed cards) · Record `/record` (photo a docket, same as last time, something new) · Saved `/record/done` (after delivery, sale, milk cheque) · Forecast `/forecast` (tabs feed, forage, cash) · Feed: new, detail (the sum, who eats it, call, order again), edit, count, rule new/edit · Record forms: delivery, order (`?feed=&kg=`), count, milk, sale, cost (`?repeat=<cost id>`), income · Money `/money`, year-end, budget · Farm diary `/diary` · Farm hub, groups, silage (+form), jobs · Suppliers + detail · Records + new (`?type=`) · Ask · Settings (dawn mode, sunlight, reminders, feed target) · Login · Onboarding (3 steps).

Today `/` now opens on the dials then **Today's jobs** checklist (dawn mode: "Before milking" / "Evening jobs"). Routines `/routines` (feeding plans with tick-off switches, money, stock and feed, jobs) and `/routines/new`, `/routines/:id`. Bill, milk and other-income forms have "Does this repeat?". Count form accepts `?routine=&due=`.

New modules: `lib/routines.ts` (+tests), `lib/routineActions.ts`, `components/Checklist.tsx`, `components/RepeatChips.tsx`, `lib/theme.ts` (dawn/sunlight modes), `lib/dials.ts` (+tests), `runoutSteps()` in `lib/forecast/feed.ts` (+tests), `lib/saved.ts` (Saved screen contract), `lib/pendingPhoto.ts` (photo hand-off), `components/Dial.tsx`. Colours are CSS variables in `src/index.css`; use `text-accent` for green text and `bg-field` for green fills, `bg-card` for surfaces, `text-onhivis` on yellow, `bg-inverse`/`text-oninverse` for toasts.

Navigation: bottom bar Today / Forecast / **Record (hi-vis centre button)** / Money / Farm. Record opens a sheet of 8 intent tiles (spec section 8).

---

## 9. UX decisions (keep these)

- Fitness-tracker pattern (7 Oct, night): a dashboard of rings and cards, a day diary with a sum at the top and sections with ADD, a centre + that opens search, scan and recent. Normal-sized type; no oversized tiles.
- Never restrict by farm type: farm types only change what is shown first and what the guide suggests. Every animal class, every kind of entry is always reachable.

- Three dials first (Feed, Silage, Cash); rings fill only against real denominators (feed target, winter need, 90-day outlook).
- Dawn mode (dark, auto before 8am/after 8pm) puts "Before milking" feeding first.
- Record screen: photo a docket first, then "same as last time" repeats, then new entries.
- Saved screen after delivery/sale/milk: before and after, then Done / add photo / another / Undo.
- Feed screen shows the run-out as a sum in kg that matches the forecast exactly.
- Farm diary: milk cheques by month (best month marked) and one timeline, including ticked-off feeding per day, jobs done and skips.
- Routines: anything recurring is ticked off on Today; ticks record what actually happened and update stock, costs and cash. Nothing is auto-posted. Missed ones stay until ticked, moved or skipped (11 Oct).
- Money: paid, owed and committed are always shown apart; an invoice replaces docket prices on the deliveries it covers and never adds a second cost; cash moves only on the paid date (11 Oct).
- Reminders point at the checklist and never record anything; no buzz while the app is open; calendar alarms as the fallback that works on every phone.
- Prices are only what the farmer paid; Agri-It never quotes or predicts a supplier price.
- Photo reading fills in only what it read with reasonable confidence; everything else is blank or a "tap to use" suggestion, every value says it came from the photo, and nothing is recorded until Save.
- Answer first; formulas behind "How this is worked out".
- Touch targets ≥ 56px; save button pinned to the bottom (thumb reach).
- Steppers, Today/Yesterday chips, numeric keypads, tap-to-choose chips, voice dictation; forms prefill from the last entry.
- Sunlight mode in Settings; status always icon + words, never colour alone.
- Undo (Saved screen or toast) instead of confirmation dialogs.
- Offline-first: cached reads, queued writes, calm sync pill.
- Live preview: delivery form shows the new run-out date before saving.
- Every forecast shows confidence and its basis; published figures show source.

**Writing style for all copy and docs: no em dashes.**

---

## 10. Known gaps and risks

1. **Supplier phone numbers** were re-checked on 11 and 14 Oct 2026 against each `source_url`; each is due a recheck six months on (shown in the app; release gate G08). **Lakeland** could not be on either day (its site blocks automated checks) and shows as not verified: check it by hand. Arrabawn Tipperary has no number on purpose (post-merger directory not confirmed).
2. **`supplier_branches`** holds Drummonds' 8 branches only. Other suppliers fall back to central numbers and "My rep".
3. **`seed.sql` creates a demo login.** Do not run it in production; load only the reference data from its top half (`setup_agri_it.sql` does exactly that).
4. Email confirmation is **off** locally and on in the hosted project. The hosted project's built-in email sender is rate limited (a few an hour): set up SMTP before many sign-ups or invites. The Site URL must be the online address (see "To finish").
5. Whole-farm bundle loads ~2 years in one query. Fine at family-farm scale; page it later if needed.
6. Supabase types are hand-written in `types.ts`; could switch to `supabase gen types`.
7. `supabase/.temp/` slipped into the zip; it's git-ignored, so it won't be committed.
8. **Phone-only data lives in one browser on one phone.** Clearing site data, uninstalling the browser, or (iPhone Safari) not opening the page for about 7 days when it is not added to the home screen can delete it. Users must take backups. Since 14 Oct a backup is a zip with every record and photo (inside a shared Claude link: records only). Each person who opens the link gets their own separate, empty farm; nothing is shared between phones.
9. **The shared artifact link** cannot be added to the home screen as a proper app, cannot download files, print, or run the photo reader. A static host (no server needed) removes all of these limits; see next steps.
10. Photo reading on the phone is weaker on handwritten dockets and very poor photos, and does not read PDFs. The first read on a phone downloads about 7 MB (once). The hosted demo blocks the reader, so the demo's samples use saved readings.
11. **Supabase connector and deletes (11 Oct):** changes containing `delete` or `drop` (even inside functions) are cancelled because the confirmation never reaches Feargal; small delete-free changes go through. Use the SQL editor paste for those, or the Supabase CLI with a database password.
12. **Online and phone data are separate.** Records moved from the phone are a copy; later phone entries do not sync. Run Move again any time: only new records move.

---

## 11. Next steps (suggested order)

**From 14 Oct, the advisory board's plan comes first:** run the pilot (`docs/PILOT.md`, 12 to 20 ROI cattle farms, 4 to 6 weeks, now with scripts S11 to S17 and the Settings alert counts); G08, G11 and G12 are done (16 Oct). Still Next in `docs/ADVISORY-RESPONSE.md`: G14 imports and exports with partners, and G07 and gate G8 with Agri-It Online. Then B2, B8 and A3 once pilot data supports them. Supplier rechecks fall due from 11 Apr 2027 (the build fails from 11 May 2027 until they're done). The older list below still holds where it doesn't conflict.


1. Use the phone-only link for real on the farm; share it from the page's Share menu; note friction points.
2. Share https://fergtech-agri-it-ireland.github.io/agri-it/ with testers (installed and working on Feargal's Android). The Claude artifact link is a fallback.
3. Re-verify supplier numbers; decide on Arrabawn Tipperary contact.
4. **Finish Agri-It Online, when Feargal is ready** (see "Start here"): run `setup_agri_it.sql`, add the two VAPID secrets and the Site URL; then in a chat run `sharing_live.sql` on the project, the advisors, the push schedule, and `online.py` with a real test user (then remove that user).
5. Move Feargal's own phone farm in (Settings > Move my phone data) and try the online version on the farm with a second person (family or worker).
6. Server reminders: once the schedule runs, turn them on from the installed online app on an iPhone and an Android and check the 7am message arrives with the app closed.
7. Review release gate 3: watch dairy, suckler and beef farmers use it in the yard (setup under 10 minutes, a repeat entry under 20 seconds) and note where they hesitate or go back to paper. Partial payment of a single bill is not built (statements pay in full).
8. Photo reading next: try it on real dockets from the yard; add the server reader once hosted (better on handwriting and poor photos); read PDFs (e-invoices usually carry text, so pdf.js text first); consider `costs.vat_eur` and `reference` columns so VAT reaches the year-end pack as a figure, not a note.
9. Farm sharing is built (roles, invites, change history) and checked against Postgres; it goes live with step 4.
10. P2: integrations (ICBF, AgFood, Herdwatch, PastureBase, co-op, accounting) where available.

---

## 12. How to start the next chat

Start a new chat inside the **Agri-It** Project, attach the GitHub repo `fergtech-agri-it-ireland/agri-it`, and paste the starter prompt (also kept in this Project as `Agri-It-New-Chat-Prompt.md`).

Working rules for any chat on this project:
- No em dashes anywhere (copy, docs, commit messages).
- Commit to `main` only when asked or when finishing agreed work; keep CI green.
- After changing the demo, rebuild, rerun the three browser scripts, and republish to the same artifact URL.
- Bump `CACHE_VERSION` (and demo `VERSION`) whenever stored data changes shape. Never wipe phone-only data (`agri-it:phone-db`): migrate it.
- After changing the phone-only build, rebuild with `npm run build:phone` and republish to its artifact URL.
- Never change either manifest id (`/agri-it/app`, `/agri-it/online/app`). Online build storage names start `agri-it-online`; never clear the other app's keys.
- Do not touch the `gauntlet` / `gauntlet-test` Supabase projects or the gauntlet repo.
