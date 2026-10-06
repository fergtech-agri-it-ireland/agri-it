# Agri-It MVP Overview (spec, text copy)

_Extracted from Agri-It_MVP_Overview.docx, September 2026. The original Word file is the source of truth._

**AGRI-IT**

MVP Overview

Irish farm intelligence for day-to-day decisions, feed planning, compliance readiness and financial control

*Product definition • September 2026*

| MVP promise Record something once. Agri-It should use it everywhere it is relevant: today’s priorities, feed inventory, run-out forecasts, costs, cash flow, compliance records and year-end reporting. |
| --- |

# 1. Executive summary

Agri-It is a mobile-first farm management and decision-support product designed around a simple question: “What do I need to know or do next?” It is not intended to replace specialist herd, grassland or accounting systems. Its role is to combine the farmer’s own records with verified Irish agricultural guidance and turn them into practical, explainable actions.

| Research signal Teagasc frames farm financial management as Monitor → Analyse → Plan. Ifac’s 2026 Irish Farm Report says 70% of surveyed farmers do not prepare budgets. The MVP therefore makes planning an output of normal farm recording rather than a separate accounting exercise. [S1, S2] |
| --- |

## MVP outcomes

Give the farmer a useful “Today” view in seconds: urgent jobs, feed risks, cash pressure, missing records and upcoming actions.

Forecast winter forage and purchased-feed run-out dates using transparent calculations and farmer-entered feeding rates.

Capture milk sales, livestock sales, feed purchases and core costs so day-to-day records build toward monthly cash flow and year-end analysis.

Maintain a simple evidence hierarchy: measured farm data first, farm history second, published Irish research third, user scenarios fourth.

Route the farmer quickly to the appropriate feed supplier/branch/contact without maintaining stale representative information.

# 2. Product principles

| **Principle** | **MVP rule** |
| --- | --- |
| Fast in the yard | Common tasks should be completable in roughly 3 taps after the relevant screen is opened. Defaults come from the farm profile, not repeated typing. |
| One entry, many uses | A feed delivery updates stock, expected run-out, feed cost, cash flow, supplier history and records. |
| Evidence before prediction | No forecast is labelled “high confidence” merely because a formula produced a number. Confidence depends on input quality and recency. |
| Farmer controls feeding decisions | Agri-It calculates depletion from the farmer’s feeding plan. It does not prescribe concentrate rates unless a validated nutrition model and required animal/feed inputs are present. |
| Simple first, detail on demand | The first screen shows the answer and action; assumptions, formulas and evidence are one tap deeper. |
| No duplicate system | Where Herdwatch/ICBF/PastureBase/co-op data can eventually be integrated, Agri-It should reuse it rather than ask the farmer to re-key it. |

# 3. MVP navigation

| **Area** | **What the farmer gets** |
| --- | --- |
| Today | Priority warnings, upcoming feed reorder, feed days remaining, cash position, record gaps and quick actions. |
| Forecast | Feed, cash, costs and compliance/readiness forecasts with confidence and assumptions. |
| Money | Income/cost capture, supplier spend, budget vs actual, cash-flow view and year-end management summary. |
| Farm | Stock groups, silage inventory/analysis, simple performance measures and farm jobs. |
| Records | Feed dockets, fertiliser, medicines, movements and documents with completeness status. |
| Ask Agri-It | Questions answered only from available farm data + supported rules, with source/confidence shown. |

# 4. Core MVP journey: purchased feed inventory & reorder prediction

This should be a first-class MVP workflow. Farmers regularly buy compound feed or straights and feed different groups at different rates. The useful product outcome is not merely “I ordered 8 tonnes”; it is “At the current plan, this feed will reach the reorder point on 18 November. Contact supplier by 15 November if your normal lead time is three days.”

## 4.1 Add a feed delivery/order

| **Field** | **MVP behaviour** |
| --- | --- |
| Supplier | Select from verified supplier directory, recent suppliers first. Allow “Other”. |
| Feed/product | Search recent products or type product name. Do not infer nutrition from name alone. |
| Quantity | kg or tonnes; stored internally as kg. |
| Order/delivery date | Separate fields because stock should not be counted as on-farm until delivery is confirmed. |
| Price | Total € or €/tonne; calculate the other value. |
| Storage | Optional bin/silo/store so multiple feeds can be tracked separately. |
| Invoice/docket | Optional photo/upload; extracted values require farmer confirmation before becoming trusted records. |
| Lead time | Farm/supplier-specific setting; never invent a supplier lead time. |
| Safety stock | Farmer-defined kg or days; used to trigger reorder before physical stock reaches zero. |

## 4.2 Allocate feed to animal groups

For each feed, the farmer creates simple feeding rules. A rule is: animal group × number of animals × kg/head/feed × feeds/day. Multiple groups can consume the same feed.

| **Example group** | **Head** | **kg/head/feed** | **Feeds/day** | **Daily feed use** |
| --- | --- | --- | --- | --- |
| Dairy cows | 120 | 1.0 | 2 | 240 kg/day |
| Heifers | 40 | 1.0 | 1 | 40 kg/day |
| TOTAL |  |  |  | 280 kg/day |

| Calculation Daily use = Σ (animals × kg/head/feed × feeds/day). If 8,000 kg is available and daily use is 280 kg, theoretical depletion is 28.6 days. A 3-day safety stock is 840 kg, so the reorder threshold is reached after about 25.6 days. The order-by date is then the threshold date minus the farmer/supplier lead time. These are arithmetic forecasts from the farmer’s actual feeding plan, not nutritional recommendations. |
| --- |

## 4.3 Reorder intelligence

Show “X days remaining” and an estimated run-out date.

Show “Order by” using the configured safety stock and lead time.

Warn earlier when animal numbers or feeding rates increase.

Recalculate immediately when a delivery arrives, stock is manually corrected, an animal group changes, or a feeding rule changes.

Allow “temporary feeding plan” with start/end dates (e.g., cows 2 kg/day for two weeks, then 4 kg/day).

Keep planned orders separate from confirmed delivered stock.

After enough history exists, compare predicted vs actual depletion and show variance; do not silently alter the farmer’s feeding rate.

## 4.4 Prediction confidence

| **Confidence** | **When it applies** |
| --- | --- |
| High | Recent measured/confirmed stock + current animal counts + explicit feeding rules + confirmed deliveries. |
| Medium | Quantity is invoice-derived or animal counts are slightly stale, but feeding rules are current. |
| Low | Opening stock is estimated, delivery unconfirmed, or consumption plan is incomplete. |
| Scenario | Farmer is asking “what if” rather than forecasting current operations. |

# 5. Forage and winter-feed model

Agri-It should distinguish purchased concentrate inventory from forage budgeting. Teagasc’s published winter fodder guides provide planning allowances by livestock class. Recent guidance lists approximately 1.6 t fresh pit silage/month for a dairy cow, 1.4 t for a suckler cow, 1.3 t for in-calf heifers/store cattle, and 0.7 t for weanlings. Teagasc also recommends using farm historical usage and carrying roughly 15–20% extra silage for adverse conditions. [S3, S4]

Acreage/yield is a planning estimate, not measured pit stock.

Once stored, pit dimensions and silage DM/density should supersede acreage estimates where available.

Laboratory silage analysis should refine feed-quality scenarios, but Agri-It should not generate an individual ration prescription from incomplete data.

Winter budget should be rechecked during housing because stock numbers, intakes and weather can change. [S5]

# 6. Money, financial planning & year-end

The finance MVP follows Teagasc’s Monitor → Analyse → Plan structure and keeps cash flow, management profit and tax/accounting concepts distinct. Teagasc recommends annual budgeting, regular cash-flow recording/monitoring, annual Profit Monitor analysis and discussion of accounts with the accountant. [S1, S6]

| **Capability** | **MVP** |
| --- | --- |
| Income | Milk sales, animal sales, other farm income; date, quantity and actual € value. |
| Costs | Feed, fertiliser, contractor, vet/medicine, machinery/fuel, utilities and configurable “other”. |
| Cash flow | Opening cash + dated inflows − dated cash outflows; monthly and 90-day view. |
| Budget vs actual | Simple monthly/annual budget and variance; alerts only when data coverage is adequate. |
| Feed economics | €/tonne, supplier spend, feed cost/day, feed cost/head/day and expected cost until reorder. |
| Year-end pack | Income/cost summary, monthly cash movements, major supplier totals, livestock/milk income and missing-data checklist for accountant/advisor. |
| Tax | Surface tax-relevant records/flags only; do not calculate definitive taxable profit without full accounting inputs and current tax rules. |

# 7. Supplier directory & local contact routing

The MVP should ship with a verified directory of major feed/agri suppliers serving the Republic of Ireland and Northern Ireland, while allowing local/independent suppliers to be added. The directory must be maintained data, not static UI copy. The table below records currently verified public contact routes; it is not claimed to be an exhaustive list of every feed merchant in Ireland.

| **Supplier / network** | **Verified public contact** | **How Agri-It resolves local contact** |
| --- | --- | --- |
| Tirlán FarmLife / GAIN Feeds | 0818 321 321 | Use farm Eircode/town with Tirlán store finder; Tirlán states customer services can connect farmers to their local Business Manager. [S7, S8] |
| Dairygold Agri Business | 025 24411; Inside Sales 022 31644 | Use published regional dairy/beef/tillage advisory territories where current; otherwise central/inside-sales fallback. [S9, S10] |
| Lakeland Dairies Agribusiness | ROI 0818 474720; NI +44 (0)28 3026 2311 | Resolve from Lakeland’s current agribusiness/member-relations contact data; do not invent a named rep if none is publicly mapped. [S11] |
| Aurivo Agribusiness / Nutrias | 071 9186500 | Use current Aurivo agribusiness contact/branch data; central fallback. [S12] |
| Arrabawn Tipperary Co-op / Dan O’Connor Feeds | Current co-op directory required | Arrabawn and Tipperary formally merged in Feb 2025; MVP should treat the merged co-op as the current entity and resolve contacts from its live directory, not legacy Arrabawn data. [S13] |
| Drummonds | 01 825 5011 | Drummonds publishes branch managers/agronomists and branch phones; map farm location to nearest applicable branch/contact and retain verification date. [S14] |
| Fane Valley Feeds (NI) | 028 9261 9620 | Northern Ireland coverage; use current advisor/branch directory with central fallback. [S15] |

| Representative rule Named representatives must be treated as dynamic supplier data. Agri-It should display: supplier → nearest/assigned branch → current rep/advisor (only if verified) → phone → “verified on” date → central fallback. A farmer can override this with “My rep” because commercial territories do not always follow nearest-distance logic. |
| --- |

## 7.1 Location matching

Farm setup stores Eircode and county; precise GPS is optional and not required for core use.

For suppliers with store locators, use Eircode/town to find the nearest appropriate agri/feed branch.

For suppliers publishing territory assignments, match the farm’s area to the current territory table.

If the match is ambiguous, show the supplier’s central feed/agri number and a “Set my rep” action rather than guessing.

Cache the selected supplier/rep for speed, but periodically revalidate the directory and show the last verification date.

# 8. Daily UX: quick, easy, efficient

| **Farmer intent** | **Fast path** |
| --- | --- |
| “Feed arrived” | + → Feed delivery → recent supplier/product → quantity → Save. Feeding plan already attached, so run-out updates instantly. |
| “I changed feeding rate” | Feed card → Change rate → choose group → kg/head/feed + feeds/day → Save. |
| “When do I order?” | Today card shows days remaining + Order by date + Call supplier. |
| “I sold cattle” | + → Animal sale → group/count/value → Save; stock, income and feed demand update. |
| “Milk cheque arrived” | + → Milk sale → litres/value (+ optional solids) → Save; income and cash flow update. |
| “Am I okay for winter?” | Today/Forecast shows forage coverage, reserve buffer and evidence/confidence. |
| “What do I give accountant?” | Money → Year-end pack → missing data check → export summary. |

# 9. Minimum data model

| **Entity** | **Key MVP fields** |
| --- | --- |
| Farm | Farm ID, Eircode/county, enterprise type, preferred suppliers, financial year. |
| Animal group | Name/class, head count, effective date, optional weights/production context. |
| Feed product | Supplier, product name, unit, storage location, optional analysis. |
| Feed transaction | Order/delivery/use/adjustment, quantity kg, date, price, source/evidence. |
| Feeding rule | Feed product, animal group, head count link, kg/head/feed, feeds/day, start/end date. |
| Supplier | Name, coverage, branch/contact directory, central phone, verification date. |
| Income | Type, date, quantity, € value, counterparty, evidence. |
| Cost | Category, date, € value, supplier, evidence. |
| Record/document | Type, date, file/image, extracted fields, confirmation state. |
| Forecast snapshot | Forecast type, generated date, inputs, output, confidence, source/rule version. |

# 10. Prediction governance: no hallucinated farm advice

Every forecast stores the exact inputs, formula/rule version and timestamp used.

Published benchmarks must identify source and date; old guidance is not silently treated as current.

Farmer-entered feeding rates are labelled “your feeding plan”, not “recommended rate”.

If required data is missing, Agri-It asks for it or lowers confidence; it does not fill the gap with an invented value.

Financial predictions separate known transactions from assumptions and scenarios.

Supplier lead times, prices and representatives are never guessed. Use farmer history, supplier data or explicit user input.

Where the app learns from farm history, it should show the observed history and prediction error so the farmer can understand why the forecast changed.

# 11. MVP scope and sequencing

| **Priority** | **Build** |
| --- | --- |
| P0 – must work | Farm profile; animal groups; silage/bale budget; purchased feed inventory; feeding rules; run-out/reorder; milk & animal income; core costs; Today dashboard; records; supplier directory/contact routing; cash-flow and year-end summary. |
| P1 – immediately after | OCR invoice/docket confirmation; recurring costs/income; supplier price history; budget variance alerts; export accountant pack; local persistence/cloud sync; notification engine. |
| P2 – integrations | ICBF/AgFood/Herdwatch/PastureBase/co-op/accounting integrations where commercially and technically available. |
| Not MVP | Full herd breeding/medicine platform, full grassland measurement platform, autonomous ration formulation, tax-return preparation, or unverified AI recommendations. |

# 12. MVP acceptance criteria

A farmer can add a feed delivery and see a run-out/reorder forecast in under one minute.

The same feed can be allocated to multiple animal groups with different kg/head/feed and feeding frequencies.

Changing stock numbers or a feeding rule recalculates depletion without re-entering the delivery.

The app distinguishes ordered, delivered and remaining stock.

Every prediction has a visible confidence state and an explanation of the inputs used.

No supplier rep, price or lead time is fabricated when data is unavailable.

Milk/animal sales and farm costs flow into cash and year-end summaries.

Core mobile actions remain usable one-handed with large touch targets and minimal typing.

Year-end outputs explicitly distinguish management summaries from statutory accounts/tax calculations.

# 13. Research sources used for this MVP definition

**S1  Teagasc – Financial Analysis**
https://teagasc.ie/rural-economy/farm-management/financial-analysis/

**S2  Ifac – Irish Farm Report 2026**
https://www.ifac.ie/irish-farm-report-2026

**S3  Teagasc – Act Now to Assess Winter Feed Demand and Plan for the Winter Ahead**
https://teagasc.ie/news--events/daily/act-now-to-assess-winter-feed-demand-and-plan-for-the-winter-ahead/

**S4  Teagasc – Making quality silage on beef farms**
https://teagasc.ie/insights/making-quality-silage-on-beef-farms/

**S5  Teagasc – 4 key winter housing considerations**
https://teagasc.ie/news--events/daily/4-key-winter-housing-considerations/

**S6  Teagasc – Financial Analysis Tools**
https://teagasc.ie/rural-economy/farm-management/financial-analysis/get-farm-financially-fit/tools/

**S7  Tirlán FarmLife – Contact details**
https://www.tirlanfarmlife.com/about-us/contact-us/contact

**S8  Tirlán FarmLife – Business Managers / bulk feed ordering**
https://www.tirlanfarmlife.com/about-us/contact-us/our-team/business-managers

**S9  Dairygold – Contact us / Agri Business**
https://www.dairygoldagri.ie/contact-us/

**S10  Dairygold – Our Team**
https://www.dairygoldagri.ie/contact-us/our-team/

**S11  Lakeland Dairies – Contact Us / Agribusiness**
https://lakelanddairies.com/contact-us

**S12  Aurivo – Agribusiness contact**
https://www.aurivo.ie/overview/

**S13  RTE – Arrabawn Tipperary Co-op formally established, 28 Feb 2025**
https://www.rte.ie/news/business/2025/0228/1499516-arrabawn-tipperary-co-operative-society/

**S14  Drummonds – Contact Us / branch and staff contacts**
https://drummonds.ie/contact-us/

**S15  Fane Valley – company/contact information**
https://fanevalley.com/

Research note: supplier directories, representatives, telephone numbers, regulations and agricultural guidance can change. Production Agri-It should maintain source URLs, last-verified dates and update processes rather than relying permanently on values embedded in this document.

Agri-It • MVP Overview • September 2026