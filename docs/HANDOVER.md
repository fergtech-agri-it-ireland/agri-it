# Agri-It MVP: Handover

**Last updated:** 7 October 2026, evening (Agri-It live at its own address, fergtech-agri-it-ireland.github.io/agri-it; earlier: phone-only build: your own farm kept on the phone, shareable link; earlier 7 Oct: photo reading for dockets, receipts and invoices; 6 Oct: daily reminders, supplier price history, budget variance alerts, white-page fix, routines and tick-off checklist, UI redesign)
**Owner:** Feargal
**Status:** MVP code complete and on GitHub (moved 7 Oct to `fergtech-agri-it-ireland/agri-it`, public, CI green, latest work on `main`). Phone-only build live as a private Claude artifact (real farm, data kept on the phone, no server). Installable app live on GitHub Pages at https://fergtech-agri-it-ireland.github.io/agri-it/. Browser demo also live. Supabase cloud project `agri-it` created with tables only (see 2).

Use this document to start a new chat. Paste or reference it, then say what you want to do next. The full product spec is in `docs/MVP-SPEC.md` (also saved in the Claude Project).

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
| Unit tests | 92/92 passing (forecast engines, run-out steps, Today dials, routine schedules, checklist, actual-vs-planned feeding, reminders, price history, budget alerts, docket reading and matching) |
| Browser tests | `scripts/e2e/` (Python + Playwright, run against the demo build at phone size): `ui.py` 82 checks, `routines.py` 41 checks, `stale_cache.py` 5 checks, `p1.py` 30 checks (reminders, prices, budget alerts), `ocr.py` 53 checks (photo reading). All pass on any day and at any time (dates in `ui.py` are now relative to today) |
| Production build | Clean, PWA service worker generated |
| Database | All four migrations + seed validated against real Postgres 16 with Supabase auth/storage stubs (`scripts/e2e/supabase_stub.sql`); RLS isolation and unique constraints tested |
| GitHub | `fergtech-agri-it-ireland/agri-it` (public), CI green. The Claude GitHub app is installed on the org, so a chat can push |
| Supabase cloud | `agri-it` (ref `xgudpylxmrlywegpdvps`, eu-west-1) created 7 Oct. Only migration 1 (tables) applied. RLS is switched on for every table with **no policies yet**, so the API returns nothing until migration 2 (policies, storage bucket, RPCs) runs; migrations 3 and 4 and the reference data are not applied. Not used by the app yet. Feargal's Supabase org also holds `gauntlet` / `gauntlet-test` for another project with devs: do not pause or change those |
| Phone-only app | **Live for real use**: https://claude.ai/artifact/WNRa3dHK8DcwjK4KYB1ePC (version 1). Starts empty, farmer sets up their own farm, everything stays on that phone. Private until shared from the page's Share menu |
| Deployed | Live app: https://fergtech-agri-it-ireland.github.io/agri-it/ (GitHub Pages, publishes from `main`). Browser-only demo (sample farm, no database, data kept in the phone's browser) is a private artifact: https://claude.ai/artifact/PrDSDf2cB5EgRaDSMe7UJw (version 7). UI concept canvas: https://claude.ai/artifact/UkQ1sRPKTTE3QN9rX11QF8 |

**Important:** the build sandbox resets between chats. Attach the GitHub repo `fergtech-agri-it-ireland/agri-it` in a new chat and clone it.

### MOVED (7 Oct, 19:00): repo is now `fergtech-agri-it-ireland/agri-it`
Agri-It now has its own GitHub organisation so it gets its own web address, separate from Gauntlet. Reason: on `fergtech-ireland.github.io` the two apps shared one address, Gauntlet's update clean-up cleared Agri-It's offline copy, and Feargal's Android Chrome got stuck showing "This app is already installed" for Agri-It (no Agri-It in chrome://webapks; "Click to open" fails). Feargal has created the org, transferred the repo and installed the Claude GitHub app on it.

**Done (7 Oct, 19:05):** the repo is public, Pages source is GitHub Actions, and CI run 37663526124 passed all three jobs (app, database, pages). The live app at **https://fergtech-agri-it-ireland.github.io/agri-it/** serves the bundle built from `main`, `sw.js` with navigateFallback `/agri-it/index.html`, and a manifest with id `/agri-it/app`, scope and start_url `/agri-it/`, display `standalone`. Old references in this file, the starter prompt and code comments are updated. The old address `fergtech-ireland.github.io/agri-it/` is no longer published; nobody has data there except Feargal's test. **Confirmed 7 Oct, 19:09:** Feargal installed it on Android from Chrome and it works like Gauntlet, as its own app.

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

**Browser tests:** serve `dist-demo` (`cd dist-demo && python3 -m http.server 4331`) then `python3 scripts/e2e/ui.py http://localhost:4331/ out/`, same for `routines.py`, `p1.py` and `ocr.py`, and `stale_cache.py` (one argument). Needs `pip install playwright` and a Chromium.

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
scripts/e2e/                      browser test scripts (ui, routines, stale cache, p1, ocr) + Postgres stub + fixtures/
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
| `farms` | Eircode, county, ROI/NI, enterprise, FY start month, opening cash + date, default lead time, forage reserve %, housing/turnout dates, feed target days (farmer's own comfort level, default 30) |
| `farm_members` | user to farm, role `owner` / `member` / `advisor` (advisor = read-only) |
| `animal_groups` | class, head count, `head_count_updated_at`, optional farm-history forage t/head/month, housed flag |
| `head_count_history` | audit of every head count change |
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

Today `/` (three dials, Do next, Feeding today, quick tiles, feed cards) · Record `/record` (photo a docket, same as last time, something new) · Saved `/record/done` (after delivery, sale, milk cheque) · Forecast `/forecast` (tabs feed, forage, cash) · Feed: new, detail (the sum, who eats it, call, order again), edit, count, rule new/edit · Record forms: delivery, order (`?feed=&kg=`), count, milk, sale, cost (`?repeat=<cost id>`), income · Money `/money`, year-end, budget · Farm diary `/diary` · Farm hub, groups, silage (+form), jobs · Suppliers + detail · Records + new (`?type=`) · Ask · Settings (dawn mode, sunlight, reminders, feed target) · Login · Onboarding (3 steps).

Today `/` now opens on the dials then **Today's jobs** checklist (dawn mode: "Before milking" / "Evening jobs"). Routines `/routines` (feeding plans with tick-off switches, money, stock and feed, jobs) and `/routines/new`, `/routines/:id`. Bill, milk and other-income forms have "Does this repeat?". Count form accepts `?routine=&due=`.

New modules: `lib/routines.ts` (+tests), `lib/routineActions.ts`, `components/Checklist.tsx`, `components/RepeatChips.tsx`, `lib/theme.ts` (dawn/sunlight modes), `lib/dials.ts` (+tests), `runoutSteps()` in `lib/forecast/feed.ts` (+tests), `lib/saved.ts` (Saved screen contract), `lib/pendingPhoto.ts` (photo hand-off), `components/Dial.tsx`. Colours are CSS variables in `src/index.css`; use `text-accent` for green text and `bg-field` for green fills, `bg-card` for surfaces, `text-onhivis` on yellow, `bg-inverse`/`text-oninverse` for toasts.

Navigation: bottom bar Today / Forecast / **Record (hi-vis centre button)** / Money / Farm. Record opens a sheet of 8 intent tiles (spec section 8).

---

## 9. UX decisions (keep these)

- Three dials first (Feed, Silage, Cash); rings fill only against real denominators (feed target, winter need, 90-day outlook).
- Dawn mode (dark, auto before 8am/after 8pm) puts "Before milking" feeding first.
- Record screen: photo a docket first, then "same as last time" repeats, then new entries.
- Saved screen after delivery/sale/milk: before and after, then Done / add photo / another / Undo.
- Feed screen shows the run-out as a sum in kg that matches the forecast exactly.
- Farm diary: milk cheques by month (best month marked) and one timeline, including ticked-off feeding per day, jobs done and skips.
- Routines: anything recurring is ticked off on Today; ticks record what actually happened and update stock, costs and cash. Nothing is auto-posted.
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

1. **Supplier phone numbers** come from the MVP doc and are stamped `verified_on 2026-09-01`. Re-verify each against its `source_url` before real users. Arrabawn Tipperary has no number on purpose (post-merger directory not confirmed).
2. **`supplier_branches` is empty**, so branch routing falls back to central numbers.
3. **`seed.sql` creates a demo login.** Do not run it in production; load only the reference data from its top half.
4. Email confirmation is **off** locally; turn on for production.
5. Whole-farm bundle loads ~2 years in one query. Fine at family-farm scale; page it later if needed.
6. Supabase types are hand-written in `types.ts`; could switch to `supabase gen types`.
7. `supabase/.temp/` slipped into the zip; it's git-ignored, so it won't be committed.
8. **Phone-only data lives in one browser on one phone.** Clearing site data, uninstalling the browser, or (iPhone Safari) not opening the page for about 7 days when it is not added to the home screen can delete it. Users must take backups. Backups hold records, not photos. Each person who opens the link gets their own separate, empty farm; nothing is shared between phones.
9. **The shared artifact link** cannot be added to the home screen as a proper app, cannot download files, print, or run the photo reader. A static host (no server needed) removes all of these limits; see next steps.
10. Photo reading on the phone is weaker on handwritten dockets and very poor photos, and does not read PDFs. The first read on a phone downloads about 7 MB (once). The hosted demo blocks the reader, so the demo's samples use saved readings.

---

## 11. Next steps (suggested order)

1. Use the phone-only link for real on the farm; share it from the page's Share menu; note friction points.
2. Share https://fergtech-agri-it-ireland.github.io/agri-it/ with testers (installed and working on Feargal's Android). The Claude artifact link is a fallback.
3. Re-verify supplier numbers; decide on Arrabawn Tipperary contact.
4. Finish the Supabase project `agri-it`: apply migrations 2 to 4 (`supabase link --project-ref xgudpylxmrlywegpdvps`, `supabase db push`), load reference data only (top half of `seed.sql`, not the demo user), then add "move my phone data to my account" using the backup JSON.
5. Deploy `dist/` (Vercel, Netlify or Cloudflare Pages) with env vars; set auth redirect URLs; turn on email confirmation.
6. Server push for reminders once hosted (needed for iPhone with the app closed): VAPID keys, a `push_subscriptions` table, and a scheduled Supabase edge function that sends the same message the digest builds. The service worker already shows pushes.
7. P1 from spec still open: accountant pack export polish. (Photo reading, price history and budget alerts done.)
8. Photo reading next: try it on real dockets from the yard; add the server reader once hosted (better on handwriting and poor photos); read PDFs (e-invoices usually carry text, so pdf.js text first); consider `costs.vat_eur` and `reference` columns so VAT reaches the year-end pack as a figure, not a note.
9. Farm sharing: invite screen for family members and advisors (database already supports roles).
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
