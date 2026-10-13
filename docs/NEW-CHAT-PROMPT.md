# Starter prompt for a new Agri-It chat

Start the new chat inside the Agri-It Project, then paste this:

---

Continue building Agri-It, my Irish farm management MVP.

1. Read `Agri-It-Handover.md`, `Agri-It-Review-Response.md` and `Agri-It-MVP-Spec.md` in this Project first.
2. Attach and clone my GitHub repo `fergtech-agri-it-ireland/agri-it` (public; the Claude GitHub app is installed on the org, so you can push to `main`). Run `npm install`, `npm test` and `npm run build` to confirm everything is green before changing anything.
3. Two apps publish from `main` to GitHub Pages when CI passes, and both must keep working:
   - the phone app https://fergtech-agri-it-ireland.github.io/agri-it/ (records kept on the phone; manifest id `/agri-it/app`, never change it);
   - Agri-It Online https://fergtech-agri-it-ireland.github.io/agri-it/online/ (signed in, Supabase project `agri-it`, ref `xgudpylxmrlywegpdvps`, eu-west-1; manifest id `/agri-it/online/app`; storage names start `agri-it-online`).
   After changes, run the browser tests in `scripts/e2e/` (ui, routines, p1, ocr, review, silage_dm against `build:demo`; `phone.py` against `build:pages`; `online.py` with both builds served together) and the database checks (`db_review.sql`, `sharing_live.sql`) on a scratch Postgres, and keep CI green.
4. Supabase: the connector cancels any change that contains a delete or drop (the confirmation never reaches me). Apply delete-free changes through the connector in pieces under about 6 KB; put anything with a delete or drop into a SQL file for me to paste into the SQL editor. Never put a service key in the repo; the online build uses only the public URL and publishable key.
5. Rules: no em dashes anywhere; large icons and easy-to-press fields for busy farmers; nothing is recorded for the farmer until they tick or save it; never invent supplier reps, prices or lead times; do not touch my gauntlet or gauntlet-test Supabase projects or the gauntlet repo.

First check "Start here" in the handover: if I say steps 1 to 3 are done, finish Agri-It Online (sharing check on the live project, advisors, push schedule, `online.py` with a test user) before anything else.

Next I want to: [describe the task]

---
