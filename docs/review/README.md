# Agri-It: third-party UX review pack

Version reviewed: **Agri-It v0.7.0** (build `bd2ace1`, 22 October 2026).

Thank you for reviewing Agri-It. We want your help finding where a farmer would hesitate, get lost or give up, and what to change so they would use it every day. This note tells you what the app is, how to open it, what to do, what we have already decided, and how to send findings back.

## 1. What Agri-It is

A phone app for Irish farmers. A farmer records something once (a feed delivery, a bill, a head count) and Agri-It uses it everywhere: feed run-out and order-by dates, winter silage cover, cash and bills, farm records, and a year-end pack for the accountant. It also drafts the next job for the farmer to approve (an order to place, drying off cows, tag deadlines) so they do less typing.

**Who uses it.** Dairy, suckler, beef, sheep and tillage farmers in the Republic of Ireland and Northern Ireland, mostly on an Android phone or iPhone, often outdoors, one-handed, with patchy signal. Some are comfortable with apps; many are not. A farm worker and the farmer's accountant also touch it.

**The design brief in one line.** "The MyFitnessPal of farming": a dashboard of what matters today, a diary, one big + to add something, and modules for detail. Normal sized type and plain words. Farmers told us oversized, simplified screens feel patronising, so please do not recommend "bigger and simpler" without evidence that something is actually hard to use.

**What it is not.** It is not a herd register, a grassland tool or an accounting package. It never prescribes rations, quotes supplier prices or calculates tax. Reports are management reports, not statutory accounts.

## 2. How to open it

Pick any of these. Doing the first one properly matters most.

| Way | What you see | Best for |
| --- | --- | --- |
| **The live app on a real phone**: https://fergtech-agri-it-ireland.github.io/agri-it/ . Open it in Chrome (Android) or Safari (iPhone) and add it to the home screen. | An **empty** app, exactly what a new farmer gets: sign-up, farm setup, then a dashboard with nothing in it yet. Your records stay on your phone. | First-run experience, setup length, installing, using it one-handed and outdoors. |
| **The demo file** `agri-it-demo.html` in this pack. Open it in Chrome on a computer, press F12, turn on the device toolbar and choose 390 x 844. | **Glenview Farm**, a sample dairy farm in Co. Tipperary with feed, silage, animals, bills, loans, reports and a spring calving plan already in it. A **Reset** button at the top puts it back as it was. | Everything after setup: the dashboard, recording, modules, reports. |
| **The screen gallery** `screens/index.html` in this pack. | 46 screenshots at phone size, each with the question to ask of that screen. | A quick first pass, and pointing to a screen in your findings. |

Please use only made-up data. Nothing you enter leaves your device.

**What the demo cannot do:** download Excel or CSV, print, read a real photo of a docket (it has three samples), or send reminders. The live app does all of these.

## 3. What to do

Time yourself. Say what you were trying to do and what you expected, even when it went fine.

**A. First run (live app, empty phone).** Sign up, set up a farm you make up, and get to a dashboard you would trust. Note how long that took, every place you paused, and anything you were asked that a farmer might not know. The setup has stages (animals, feeding, crops, money, loans and so on); decide which a busy farmer would skip and whether skipping is safe.

**B. Everyday tasks (demo farm).**

1. Read the dashboard. What needs doing today? When does the feed run out and what should the farmer do about it?
2. Record a feed delivery: **+**, then feed arrived. Does the screen show what changes before you save?
3. Pay the overdue vet bill (shown under Needs your attention, also under Money, then Bills to pay).
4. Approve a drafted job on the dashboard (for example "Dry off cows"), then use **Not now** on another. Is it clear what each button does and whether anything has been saved?
5. Do a stock count of the feed bin. After saving, can you say what Agri-It did and did not change?
6. Animals: add several animals at once by typing tags, then find one. Then open Move up a stage: nobody is due on the demo farm, so judge whether the empty screen explains how an animal would get listed. Remember a real herd can have thousands.
7. Record a fertiliser spreading across two fields. The demo will warn that spreading is closed at this time of year; judge whether that warning is clear and whether it helps or blocks.
8. Open Reports, then Profit and loss. Why does it say "Not complete", and what would a farmer do about it?
9. Change a saved entry and then delete it (Diary, then the pencil). Is it clear what will be removed?
10. Find a docket or record in Records.
11. Switch on dawn or sunlight mode (Settings) and use the app as you would in a yard at 6 am.

**C. Overall.** Look at the five tabs (Dashboard, Diary, +, Progress, Modules) and the ten module tiles. Is anything in the wrong place, named wrongly, or missing from where a farmer would look first?

The field scripts we use with farmers are in `docs/PILOT.md` in the code repository, if you want more tasks.

## 4. What we most want opinions on

1. **The dashboard.** Is the order right (feed, key numbers, To do, diary, modules)? Does a farmer know what to do next within five seconds? Are the colours and badges honest about urgency?
2. **Automation and approval.** The app drafts jobs and the farmer approves, ignores or puts them off. Is that the right model? Could more be automated without losing trust? Where do alerts become noise?
3. **Explaining numbers.** Forecasts carry a confidence label and "how this is worked out". Does that build trust or add clutter? Are "Best guess", "Not complete" and "Recorded. Check bank" understood?
4. **Recording flows.** Taps and fields to log a delivery, a bill, a count, a spreading. What can be removed, defaulted or done from the photo of a docket?
5. **Animals at scale.** Six tiles, bulk add and update, automatic life stages. Does it hold up for a large mixed herd?
6. **Reports and downloads.** Three reports and plain-table downloads for an accountant. Would an accountant be happy?
7. **Words.** Are the labels how Irish farmers talk? Mark any jargon or anything that sounds like software.
8. **Habit.** What would make a farmer open this every day rather than once a week?
9. **Accessibility.** Contrast, tap size, text size, glare, one-handed use, colour used alone to carry meaning.

## 5. Decisions already made

Please challenge these only with evidence from using the app.

- The fitness-tracker pattern and normal sized type (see section 1).
- No farm type is ruled out. Farm type only changes what is shown first.
- The five-tab bar: Dashboard, Diary, +, Progress, Modules.
- Nothing is saved until the farmer approves or taps Save, and saves can be undone from the message that follows.
- Records stay on the farmer's phone for now, with backup and restore. An online version with accounts and sharing is built but not released, so please leave sign-in, sharing and the server out of scope.
- Agri-It never invents a supplier number or price, and never gives advice on rations or tax.

## 6. Known rough edges (no need to report these)

- The dashboard heading says "Today" while the tab says "Dashboard".
- The To do card holds two labelled sections, not one fully mixed list.
- Scanning the blue animal identity card has only been tried on made-up cards.
- Photo reading is weaker on handwriting and poor photos, and PDFs are not read.
- A bill is paid in full only; part payments are not built.
- The ages at which an animal moves up a stage are fixed defaults (a single animal can be overridden).
- One supplier's number could not be verified and shows as "not verified"; another has none on purpose.
- Several rules are labelled with the date they were checked and a recheck date (nitrates closed periods, scheme dates, tag deadlines).

## 7. How to send findings

Use `FEEDBACK-TEMPLATE.csv` (opens in Excel or Google Sheets), one row per finding. For each:

- **Where**: the screen name, or the gallery file name.
- **Type**: confusion, friction, missing, wording, accessibility, bug or idea.
- **Severity**: 1 blocker (a farmer would give up or lose data), 2 major, 3 minor, 4 polish.
- **Evidence**: what you saw, a timing, or a quote from your own testing.
- **Suggested change**: a sentence or a sketch.
- **Effort**: your guess, S, M or L.

Please also send:

1. **Your ten most valuable changes, ranked**, each in two lines.
2. **Your first-run time** and the three places you hesitated longest.
3. **What you would remove** to make the app simpler without losing the point of it.
4. **Anything you were unsure of**, so we can ask the farmers.

Screen recordings of a task are very welcome.
