"""The phone app and the online app on one web address, as on GitHub Pages.

Usage: python3 scripts/e2e/online.py ROOT_OLD ROOT_NEW OUTDIR [backup.json]
  ROOT_OLD: a folder holding agri-it/ built from the previous main (the phone app as it is live)
  ROOT_NEW: a folder holding agri-it/ (build:pages) with agri-it/online/ (build:online) inside
Optional, against the real Supabase project: set AGRI_ONLINE_EMAIL and AGRI_ONLINE_PASSWORD
for a confirmed test user with no farm, and pass a phone backup to move it in (twice).

Checks: a farmer who already has the live phone app installed gets the new phone app, keeps
their records, and /agri-it/online/ opens the online app as a separate app (own worker scope,
own manifest id, own storage names) instead of the phone app.
"""
import json, os, re, shutil, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

OLD, NEW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
BACKUP = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(OUT, exist_ok=True)
res, errs = [], []
def check(n, c, d=''): res.append((n, bool(c), d))

# One server whose files are swapped from the old build to the new, like a Pages deploy
live = tempfile.mkdtemp(prefix='agri-live-')
os.symlink(os.path.join(os.path.abspath(OLD), 'agri-it'), os.path.join(live, 'agri-it'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '4351', '--directory', live], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://localhost:4351/agri-it/'
ONLINE = BASE + 'online/'

def swap_to_new():
    os.unlink(os.path.join(live, 'agri-it'))
    os.symlink(os.path.join(os.path.abspath(NEW), 'agri-it'), os.path.join(live, 'agri-it'))

def text(pg):
    return pg.locator('body').inner_text()

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))

        # 1. The phone app as it is live today, with a farm set up
        pg.goto(BASE); pg.wait_for_timeout(1500)
        pg.get_by_label('Farm name').fill('Old Phone Farm'); pg.select_option('#county', 'Tipperary')
        pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(300)
        pg.get_by_role('button', name=re.compile('^Dairy')).click()
        for _ in range(6):
            if pg.get_by_role('button', name='Start using Agri-It').count():
                pg.get_by_role('button', name='Start using Agri-It').click(); break
            pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(300)
        pg.wait_for_timeout(1500)
        check('Live phone app set up a farm', 'Old Phone Farm' in text(pg) or 'Getting started' in text(pg), text(pg)[:300])
        pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        check('Live phone app worker installed', pg.evaluate("navigator.serviceWorker.controller !== null"))

        phone_keys = set(pg.evaluate("Object.keys(localStorage)"))
        # 2. A new deploy: phone app at /agri-it/, online app at /agri-it/online/
        swap_to_new()
        pg.goto(ONLINE); pg.wait_for_timeout(1000)
        try:
            pg.wait_for_selector('text=Agri-It Online', timeout=20000)
        except Exception:
            pass
        t = text(pg)
        check('Online address opens the online app, not the phone app (even with the old phone worker)', 'Agri-It Online' in t and 'Sign in' in t, t[:300])
        pg.screenshot(path=f'{OUT}/1-online-login.png', full_page=True)
        pg.wait_for_timeout(2500)
        scopes = pg.evaluate("navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.scope).sort())")
        check('Two separate workers: /agri-it/ and /agri-it/online/', scopes == [BASE, ONLINE], str(scopes))
        man = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
        check('Online manifest has its own id and scope', man.get('id') == '/agri-it/online/app' and man.get('scope') == '/agri-it/online/' and man.get('name') == 'Agri-It Online', json.dumps(man)[:200])
        keys = pg.evaluate("Object.keys(localStorage)")
        added = [k for k in keys if k not in phone_keys and not k.startswith('sb-')]
        check('Online app only adds agri-it-online storage names, phone records untouched',
              all(k.startswith('agri-it-online:') for k in added) and 'agri-it:phone-db' in keys, f'added {added} all {keys}')
        # Big, easy fields for busy hands
        h = pg.locator('#email').bounding_box()['height']
        check('Sign-in fields are easy to press (48px or more)', h >= 48, str(h))
        check('No sideways scroll on the sign-in screen', pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))

        # 3. The phone app still opens with its farm, now from the new build
        pg.goto(BASE); pg.wait_for_timeout(2500)
        pg.reload(); pg.wait_for_timeout(2500)
        t = text(pg)
        check('Phone app still opens with its records after the deploy', 'Old Phone Farm' in t or 'Getting started' in t, t[:300])
        man2 = pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
        check('Phone app keeps its manifest id /agri-it/app', man2.get('id') == '/agri-it/app' and man2.get('scope') == '/agri-it/', json.dumps(man2)[:200])
        ctrl = pg.evaluate("navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL")
        check('Phone app is controlled by its own worker', ctrl and ctrl.startswith(BASE + 'sw.js'), str(ctrl))

        # 4. Offline: each app reopens as itself
        ctx.set_offline(True)
        pg.goto(BASE); pg.wait_for_timeout(1500)
        check('Phone app opens offline', 'Old Phone Farm' in text(pg) or 'Getting started' in text(pg), text(pg)[:200])
        pg.goto(ONLINE); pg.wait_for_timeout(1500)
        check('Online app opens offline as itself', 'Agri-It Online' in text(pg), text(pg)[:200])
        ctx.set_offline(False)

        # 5. Optional: real sign-in and Move my phone data, against the real project
        email, pw = os.environ.get('AGRI_ONLINE_EMAIL'), os.environ.get('AGRI_ONLINE_PASSWORD')
        if email and pw and BACKUP:
            pg.goto(ONLINE); pg.wait_for_timeout(1500)
            pg.fill('#email', email); pg.fill('#pw', pw)
            pg.get_by_role('button', name='Sign in').click(); pg.wait_for_timeout(4000)
            pg.goto(ONLINE + '#/move-phone-data'); pg.wait_for_timeout(2500)
            t = text(pg)
            check('Move screen finds the phone app records in this browser', 'On this phone' in t and 'What will be moved' in t, t[:400])
            # Use the real backup file instead (has bills paid and owed)
            pg.get_by_role('button', name=re.compile('Backup file')).click()
            pg.set_input_files('input[type=file]', BACKUP); pg.wait_for_timeout(800)
            t = text(pg)
            check('Backup file read and summarised', 'What will be moved' in t and 'bills and costs' in t, t[:600])
            pg.screenshot(path=f'{OUT}/2-move.png', full_page=True)
            pg.get_by_role('button', name=re.compile(r'^Move \d+ record')).click(); pg.wait_for_timeout(6000)
            t = text(pg)
            check('First move copies every record', 'records moved' in t and 'already here' not in t, t[:400])
            pg.screenshot(path=f'{OUT}/3-moved.png', full_page=True)
            pg.goto(ONLINE + '#/move-phone-data'); pg.wait_for_timeout(2500)
            pg.get_by_role('button', name=re.compile('Backup file')).click()
            pg.set_input_files('input[type=file]', BACKUP); pg.wait_for_timeout(800)
            pg.get_by_role('button', name=re.compile(r'^Move \d+ record')).click(); pg.wait_for_timeout(6000)
            t = text(pg)
            check('Second move adds nothing', 'already here' in t and 'records moved' not in t, t[:400])
            pg.goto(ONLINE + '#/money/bills'); pg.wait_for_timeout(3000)
            t = text(pg)
            check('Owed bills from the phone show as owed online', 'To pay' in t or 'owed' in t.lower(), t[:500])
            pg.screenshot(path=f'{OUT}/4-bills.png', full_page=True)
        b.close()
finally:
    srv.terminate()
    shutil.rmtree(live, ignore_errors=True)

for n, ok, d in res:
    print(('PASS' if ok else 'FAIL'), n, '' if ok else d)
print(f"{sum(1 for _, ok, _ in res if ok)}/{len(res)} checks passed. Console/page errors: {errs}")
sys.exit(0 if all(ok for _, ok, _ in res) and not errs else 1)
