"""Agri-It and Gauntlet on one web address (as on fergtech-ireland.github.io).
Checks neither app breaks the other: offline copies, records, and Agri-It's delete-all.

Serve a folder holding `agri-it/` (dist-pages) and `gauntlet/` (a Gauntlet checkout), then:
python3 scripts/e2e/with_gauntlet.py http://localhost:8791
"""
import sys
from playwright.sync_api import sync_playwright

O = sys.argv[1].rstrip('/')
A, G = O + '/agri-it/', O + '/gauntlet/'
res = []


def check(n, c, d=''):
    res.append((n, bool(c)))
    print('PASS' if c else 'FAIL', n, d)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    pg = ctx.new_page()
    caches = lambda: pg.evaluate('caches.keys()')

    # 1. Agri-It installed first, with a farm
    pg.goto(A); pg.wait_for_timeout(1200)
    pg.get_by_label('Farm name').fill('Both Farm'); pg.select_option('#county', 'Tipperary')
    pg.get_by_role('button', name='Next').click(); pg.get_by_role('button', name='Next').click()
    pg.get_by_role('button', name='Start using Agri-It').click(); pg.wait_for_timeout(1500)
    pg.evaluate('navigator.serviceWorker.ready'); pg.wait_for_timeout(1500)
    print('offline stores after Agri-It:', caches())

    # 2. Gauntlet installs and runs its own clean-up
    pg.goto(G); pg.wait_for_timeout(4000)
    pg.evaluate("localStorage.setItem('gauntlet.v3', JSON.stringify({test:'gauntlet data'}))")
    print('offline stores after Gauntlet:', caches())
    print('Gauntlet cleared Agri-It offline copy:', not any('agri-it' in c for c in caches()))

    # 3. Agri-It opens with signal and repairs itself
    pg.goto(A); pg.wait_for_timeout(9000)
    print('offline stores after reopening Agri-It:', caches())
    check('Agri-It offline copy restored', any('precache' in c and 'agri-it' in c for c in caches()))
    check('Gauntlet offline copy untouched', 'gauntlet-shell-v2' in caches())

    # 4. No signal: both open, both keep their data
    ctx.set_offline(True)
    pg.goto(A); pg.wait_for_timeout(2500)
    check('Agri-It opens offline with its farm', 'Both Farm' in pg.locator('body').inner_text())
    pg.goto(G); pg.wait_for_timeout(2500)
    t = pg.locator('body').inner_text()
    check('Gauntlet opens offline', len(t) > 50, t[:60].replace('\n', ' '))
    check('Gauntlet data kept', 'gauntlet data' in (pg.evaluate("localStorage.getItem('gauntlet.v3')") or ''))
    ctx.set_offline(False)

    # 5. Agri-It "Delete everything" leaves Gauntlet alone
    pg.goto(A + '#/settings'); pg.wait_for_timeout(1500)
    pg.get_by_role('button', name='Delete everything and start again').click()
    pg.get_by_role('button', name='Delete all').click(); pg.wait_for_timeout(2000)
    check('Agri-It cleared only itself', 'Your farm' in pg.locator('body').inner_text())
    check('Gauntlet data survives Agri-It delete-all', 'gauntlet data' in (pg.evaluate("localStorage.getItem('gauntlet.v3')") or ''))
    check('Gauntlet offline copy survives Agri-It delete-all', 'gauntlet-shell-v2' in caches())
    print('storage keys now:', pg.evaluate('Object.keys(localStorage)'))
    b.close()

print(f"{sum(r[1] for r in res)}/{len(res)} checks passed")
sys.exit(0 if all(r[1] for r in res) else 1)
