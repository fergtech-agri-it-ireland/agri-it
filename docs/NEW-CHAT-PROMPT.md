# Starter prompt for a new Agri-It chat

Start the new chat inside the Agri-It Project, then paste this:

---

Continue building Agri-It, my Irish farm management MVP.

1. Read `Agri-It-Handover.md`, `Agri-It-Advisory-Response.md`, `Agri-It-Review-Response.md`, `Agri-It-Setup-And-Planner.md` and `Agri-It-MVP-Spec.md` in this Project first.
2. Attach and clone my GitHub repo `fergtech-agri-it-ireland/agri-it` (public; the Claude GitHub app is installed on the org, so you can push to `main`). Run `npm install`, `npm test` and `npm run build` to confirm everything is green before changing anything.
3. The focus is the phone app at https://fergtech-agri-it-ireland.github.io/agri-it/ . I test it on my own phone and want to keep improving it until I'm happy; it republishes from `main` when CI passes and my phone updates the next time I open it. My records live on the phone: never wipe them (phone `VERSION` 1, migrate stored data instead); never change the manifest id `/agri-it/app`. Agri-It Online (signed-in, Supabase project `agri-it`) is built and tested but parked and not published (`PUBLISH_ONLINE: 'false'` in CI): keep it compiling and its tests passing, add a migration when the data shape changes, but don't ask me to do its setup steps until I say I'm ready.
   After changes, run the browser tests in `scripts/e2e/` (ui, routines, p1, ocr, review, silage_dm, automation, advisory, fertiliser, board, planner against `build:demo`; `phone.py` against `build:pages`) and, if the database shape changed, the database checks (`db_review.sql`, `sharing_live.sql`) on a scratch Postgres, and keep CI green. Then tell me to reopen the app on my phone.
4. Supabase: the connector cancels any change that contains a delete or drop (the confirmation never reaches me). Apply delete-free changes through the connector in pieces under about 6 KB; put anything with a delete or drop into a SQL file for me to paste into the SQL editor. Never put a service key in the repo; the online build uses only the public URL and publishable key.
5. Rules: no em dashes anywhere; large icons and easy-to-press fields for busy farmers; nothing is recorded for the farmer until they tick or save it; never invent supplier reps, prices or lead times; every statutory deadline comes from `lib/deadlines.ts` with its official source and checked date; money is in the farm's currency (euro ROI, pounds NI), never hard-coded; do not touch my gauntlet or gauntlet-test Supabase projects or the gauntlet repo.

Next I want to: [describe the task]

---
