# Agri-It MVP: Handover

**Last updated:** 6 October 2026 (UI redesign: dials, dawn mode, Record, Saved, feed sum, diary)
**Owner:** Feargal
**Status:** MVP code complete, builds clean, tests pass. Not yet pushed to GitHub or deployed.

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
| Code | Complete for P0 scope, plus the UI redesign based on WHOOP, MyFitnessPal and Strava patterns (6 Oct 2026) |
| Typecheck | Clean (`tsc -b --noEmit`) |
| Unit tests | 43/43 passing (forecast engines, run-out steps, Today dials) |
| Browser test | 82/82 checks on the demo build at phone size: every new flow, numbers on each screen, no sideways scroll at 360px in day and dawn mode, no console errors (script not in the repo) |
| Production build | Clean, PWA service worker generated |
| Database | All three migrations + seed validated against real Postgres 16 with Supabase auth/storage stubs; RLS isolation tested |
| GitHub | `fergtech-ireland/agri-it` (private), CI green |
| Supabase cloud | Not created yet (local only) |
| Deployed | No. A browser-only demo (sample data, no database) is published as a private Claude artifact; rebuild with `npm run build:demo` |

**Important:** the build sandbox resets between chats. The code lives at `fergtech-ireland/agri-it` on GitHub: attach that repo in a new chat. The Claude GitHub app is installed for that repo, so a chat can push to it.

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
| `farm_records`, `documents`, `jobs` | records with confirmation state, uploads, simple jobs |
| `evidence_sources`, `forage_benchmarks` | published sources (S1 to S6) and Teagasc allowances with dates |
| `forecast_snapshots` | governance: inputs, inputs hash, output, confidence, rule version, timestamp |

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

**Ask Agri-It** (`ask.ts`): keyword rules over farm data only. Refuses ration recommendations. Unknown questions get "I can only answer from your farm records".

---

## 8. Screens and routes

Today `/` (three dials, Do next, Feeding today, quick tiles, feed cards) · Record `/record` (photo a docket, same as last time, something new) · Saved `/record/done` (after delivery, sale, milk cheque) · Forecast `/forecast` (tabs feed, forage, cash) · Feed: new, detail (the sum, who eats it, call, order again), edit, count, rule new/edit · Record forms: delivery, order (`?feed=&kg=`), count, milk, sale, cost (`?repeat=<cost id>`), income · Money `/money`, year-end, budget · Farm diary `/diary` · Farm hub, groups, silage (+form), jobs · Suppliers + detail · Records + new (`?type=`) · Ask · Settings (dawn mode, sunlight, feed target) · Login · Onboarding (3 steps).

New modules: `lib/theme.ts` (dawn/sunlight modes), `lib/dials.ts` (+tests), `runoutSteps()` in `lib/forecast/feed.ts` (+tests), `lib/saved.ts` (Saved screen contract), `lib/pendingPhoto.ts` (photo hand-off), `components/Dial.tsx`. Colours are CSS variables in `src/index.css`; use `text-accent` for green text and `bg-field` for green fills, `bg-card` for surfaces, `text-onhivis` on yellow, `bg-inverse`/`text-oninverse` for toasts.

Navigation: bottom bar Today / Forecast / **Record (hi-vis centre button)** / Money / Farm. Record opens a sheet of 8 intent tiles (spec section 8).

---

## 9. UX decisions (keep these)

- Three dials first (Feed, Silage, Cash); rings fill only against real denominators (feed target, winter need, 90-day outlook).
- Dawn mode (dark, auto before 8am/after 8pm) puts "Before milking" feeding first.
- Record screen: photo a docket first, then "same as last time" repeats, then new entries.
- Saved screen after delivery/sale/milk: before and after, then Done / add photo / another / Undo.
- Feed screen shows the run-out as a sum in kg that matches the forecast exactly.
- Farm diary: milk cheques by month (best month marked) and one timeline.
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

---

## 11. Next steps (suggested order)

1. **Push to GitHub** (README has the commands). Confirm CI goes green.
2. Run locally end to end on a phone; note friction points.
3. Re-verify supplier numbers; decide on Arrabawn Tipperary contact.
4. Create a Supabase cloud project, `supabase link`, `supabase db push`, load reference data only.
5. Deploy `dist/` (Vercel, Netlify or Cloudflare Pages) with env vars; set auth redirect URLs.
6. P1 from spec: docket/invoice OCR with farmer confirmation, recurring costs/income, supplier price history, budget variance alerts, accountant pack export polish, notifications.
7. Farm sharing: invite screen for family members and advisors (database already supports roles).
8. P2: integrations (ICBF, AgFood, Herdwatch, PastureBase, co-op, accounting) where available.

---

## 12. How to start the next chat

Upload `agri-it.zip` (or attach the GitHub repo once pushed) and say, for example:

> "Continue Agri-It from the handover doc in this Project. Here's the repo. Next I want to [task]."

The new chat should read `Agri-It-Handover.md` and `Agri-It-MVP-Spec.md` from the Project first.
