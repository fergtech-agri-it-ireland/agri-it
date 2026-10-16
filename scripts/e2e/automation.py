"""Automation in the browser, against the demo build at phone size (13 Oct 2026).

Ready to approve on the dashboard, the calving plan worked back from the first calf date, drying
off that moves cows and updates the feed forecast, a calf born with its tag and register dates,
not now, and a new season set up from a bull-in date. Nothing is saved before Approve or Save.
The demo farm's season starts 75 days from today, so the dates move with the calendar.
Run: python3 scripts/e2e/automation.py http://localhost:4331/ out/
"""
import re, sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []
def check(name, cond, detail=''): results.append((name, bool(cond), detail))
def go(pg, h):
    pg.goto(URL + h); pg.locator('main').first.wait_for(timeout=10000); pg.wait_for_timeout(500)
def main_text(pg): return pg.locator('main').inner_text()
def no_sideways(pg): return pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    go(pg, '#/'); pg.wait_for_timeout(1200)

    # A. Ready to approve on the dashboard
    t = main_text(pg)
    ready = pg.get_by_role('region', name='Ready for you to approve')
    check('Dashboard has Ready for you to approve', ready.count() == 1 and 'Nothing is saved until you approve' in t, t[:1500])
    check('Body condition step is due, with Teagasc as the source', 'Body condition score the herd' in t and ready.locator('a[href*="teagasc.ie"]').count() > 0)
    check('Dry off thin cows is coming this week', 'Dry off thin cows (12)' in t, t[:1500])
    check('Calving card shows days to the first calf', 'First calf in 75 days' in t, t)
    approve = ready.get_by_role('button', name='Add to my jobs').first
    check('Approve button is big enough for a thumb (48px+)', approve.bounding_box()['height'] >= 47, str(approve.bounding_box()))
    pg.screenshot(path=f'{OUT}/automation-today.png', full_page=True)
    check('No sideways scroll on the dashboard', no_sideways(pg))

    go(pg, '#/farm/jobs')
    check('Nothing on the job list before approving', 'Body condition score the cows' not in main_text(pg))
    go(pg, '#/')
    pg.get_by_role('region', name='Ready for you to approve').get_by_role('button', name='Add to my jobs').first.click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('Approved step leaves the list', 'Body condition score the herd' not in pg.get_by_role('region', name='Ready for you to approve').inner_text(), t[:1200])
    go(pg, '#/farm/jobs')
    check('Approving added the job', 'Body condition score the cows' in main_text(pg), main_text(pg))

    # B. Not now asks why and for how long (G12), then hides the suggestion for that time
    go(pg, '#/')
    card = pg.locator('[data-suggestion="season:5e000000-0000-0000-0000-000000000001:dry_thin"]')
    card.get_by_role('button', name='Not now').click(); pg.wait_for_timeout(300)
    sheet = pg.get_by_role('dialog', name='Not now')
    check('Not now asks why first', sheet.count() == 1 and sheet.get_by_role('button', name='Put it off').is_disabled())
    sheet.get_by_role('button', name='Busy, later').click()
    sheet.get_by_role('button', name='A week').click()
    sheet.get_by_role('button', name='Put it off').click(); pg.wait_for_timeout(600)
    check('Not now hides it', pg.locator('[data-suggestion="season:5e000000-0000-0000-0000-000000000001:dry_thin"]').count() == 0)
    go(pg, '#/calving')
    t = main_text(pg)
    check('The plan shows it put off, not lost', 'Dry off thin cows (12)' in t and 'Put off to' in t, t[:2000])
    check('Plan lists the whole season with sources', all(x in t for x in ['Pre-calver minerals', 'Order calf tags', 'Get ready for calving', 'Calving starts', 'Dry off cows on target']) and 'never says how much to feed' in t, t)
    check('No sideways scroll on the calving plan', no_sideways(pg))
    pg.screenshot(path=f'{OUT}/automation-calving.png', full_page=True)

    # C. Dry off: one move, and the feed forecast follows
    go(pg, '#/calving/dry-off?season=5e000000-0000-0000-0000-000000000001&batch=thin')
    t = main_text(pg)
    check('Dry off opens with the milking and dry groups and 12 thin cows', pg.get_by_role('spinbutton', name='How many cows?').input_value() == '12' and 'Dairy cows 120 → 108' in t, t)
    impact = pg.get_by_test_id('feed-impact')
    check('Shows what it does to the feed', impact.count() >= 1 and 'Dairy nut 16%' in impact.first.inner_text() and '280 kg → 256 kg' in impact.first.inner_text(), t)
    pg.screenshot(path=f'{OUT}/automation-dryoff.png', full_page=True)
    pg.get_by_role('button', name='Dry off 12').click(); pg.wait_for_timeout(1000)
    def heads():
        go(pg, '#/calving/dry-off?season=5e000000-0000-0000-0000-000000000001&batch=main')
        return main_text(pg).split('To (dry)')[0]
    t = heads()
    check('Cows moved: 108 milking, 12 dry', 'Dairy cows\n108 head' in t and 'Dry cows\n12 head' in main_text(pg), t)
    go(pg, '#/feed/50000000-0000-0000-0000-000000000001')
    t = main_text(pg)
    check('Dairy nut use is lower after drying off', '216 kg a day' in t or 'Dairy cows, 216 kg a day' in t, t[:1500])
    go(pg, '#/calving')
    check('Thin cows step is done', re.search(r'Dry off thin cows \(12\)\s*\n?.*Done', main_text(pg)) is not None, main_text(pg)[:1500])

    # D. Calving has started (move the season's first calf to 3 days ago), then a calf born
    go(pg, '#/calving/season/5e000000-0000-0000-0000-000000000001')
    started = pg.evaluate("(() => { const d = new Date(Date.now() - 3 * 86400000); return d.toISOString().slice(0, 10); })()")
    pg.locator('fieldset', has_text='First calf due').locator('input[type=date]').fill(started)
    pg.get_by_role('button', name='Save').click(); pg.wait_for_timeout(800)
    go(pg, '#/record/calf')
    pg.get_by_role('button', name='Twins').click()
    t = main_text(pg)
    check('Cow back to the milking group is offered', 'Cow goes back to Dairy cows (Dry cows 12 → 11)' in t, t)
    check('Tag and register dates shown before saving', re.search(r'Tag by .+\. Register by .+\.', pg.get_by_test_id('calf-deadlines').inner_text()) is not None)
    pg.get_by_role('button', name='Save').click(); pg.wait_for_timeout(1000)
    t = main_text(pg)
    check('Calf shows on the calving page with its deadlines', '2 calves born' in t and 'Tagged by' in t and 'Registered by' in t, t)
    check('Calving count moves', '2 calved of 160 due' in t, t[:800])
    t = heads()
    check('Calves group up by two, cow back in milking', 'Calves\n20 head' in t and 'Dairy cows\n109 head' in t and 'Dry cows\n11 head' in main_text(pg), main_text(pg))
    go(pg, '#/calving')
    pg.get_by_role('button', name=re.compile('^Tagged by')).first.click(); pg.wait_for_timeout(600)
    check('One tap marks them tagged', pg.get_by_role('button', name='Tagged ✓').count() == 1)

    # E. A new season from a bull-in date (not saved: just the worked-out plan)
    go(pg, '#/calving/season/new')
    pg.get_by_role('button', name=re.compile('^Suckler cows')).click()
    pg.get_by_role('button', name=re.compile('^When breeding started')).click(); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Bull-in date gives a first calf date (ICBF gestation)', 'First calf due about' in t and '283 days' in t, t[:1500])
    check('Suckler plan has no drying off', 'Drying off' not in t and 'Check cow condition' in t, t)
    check('No sideways scroll on season setup', no_sideways(pg))
    pg.screenshot(path=f'{OUT}/automation-season.png', full_page=True)
    b.close()

for n, ok, d in results:
    print(('PASS' if ok else 'FAIL'), n, '' if ok else d[:700])
print(f"{sum(1 for _, ok, _ in results if ok)}/{len(results)} checks passed. Console/page errors: {errors}")
sys.exit(0 if all(ok for _, ok, _ in results) and not errors else 1)
