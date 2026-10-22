"""The Dashboard (key numbers, one To do card, module tiles) and the count boxes that let you delete
the zero (21 Oct 2026), in the browser against the demo build at phone size.

Run: python3 scripts/e2e/dashboard.py http://localhost:4331/ out/
"""
import sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(600)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # ---- A. The zero can be deleted when adding animals -------------------------------------
    go(pg, '#/farm/groups')
    pg.get_by_role('button', name='Add', exact=True).click()
    dlg = pg.get_by_role('dialog')
    dlg.get_by_role('button', name='Ewes').click()
    head = dlg.get_by_label('Head', exact=True)
    head.click()
    head.press('Control+a'); head.press('0')
    check('A 0 can be typed', head.input_value() == '0', head.input_value())
    head.press('Backspace')
    check('The 0 can be deleted with the keyboard: the box is empty', head.input_value() == '', head.input_value())
    head.fill('35')
    check('A number can be typed after clearing', head.input_value() == '35', head.input_value())
    head.fill('')
    head.blur()
    pg.wait_for_timeout(200)
    check('Leaving the box empty puts the 0 back', head.input_value() == '0', head.input_value())
    head.fill('7')
    dlg.get_by_label('Increase Head').click()
    check('The + button steps on from what was typed (sheep go up by 10)', head.input_value() == '17', head.input_value())
    dlg.get_by_label('Decrease Head').click()
    check('The - button steps back down', head.input_value() == '7', head.input_value())
    dlg.get_by_label('Decrease Head').click()
    check('The - button never goes below 0', head.input_value() == '0', head.input_value())
    head.fill('6')
    pg.screenshot(path=f'{OUT}/count-zero.png')
    dlg.get_by_role('button', name='Add group').click()
    pg.wait_for_timeout(500)
    heads = pg.locator('main input[type=number]')
    check('The group is saved with the typed count', heads.last.input_value() == '6', heads.last.input_value())

    # ---- B. The Dashboard ---------------------------------------------------------------------
    go(pg, '#/')
    keys = pg.get_by_label('Key numbers')
    kt = keys.inner_text()
    check('Key numbers: silage, cash and bills owed', all(x in kt for x in ['Silage', 'Cash', 'Bills owed']), kt)
    check('Key numbers: the bills owed total is shown in euro', '€' in kt.split('Bills owed')[1], kt)
    todo = pg.get_by_label('To do')
    check('One To do card', todo.count() == 1)
    check('To do holds ready-to-approve and needs-attention', todo.get_by_label('Needs your attention').count() == 1, todo.inner_text()[:300])
    check('No second Needs your attention outside To do', pg.get_by_label('Needs your attention').count() == 1)
    mods = pg.get_by_label('Modules', exact=True)
    check('Modules section with tiles', mods.count() == 1 and mods.locator('[data-module]').count() >= 6, mods.count())
    badges = [t.get_attribute('aria-label') for t in mods.locator('[data-module]').all() if 'waiting' in (t.get_attribute('aria-label') or '')]
    check('At least one module shows what is waiting there', len(badges) >= 1, badges)
    order = pg.evaluate("""() => ['Key numbers','To do','Modules'].map(n => { const e = document.querySelector(`section[aria-label="${n}"]`); return e ? e.getBoundingClientRect().top : -1; })""")
    check('Order down the page: key numbers, To do, modules', 0 <= order[0] < order[1] < order[2], order)
    pg.screenshot(path=f'{OUT}/dashboard.png', full_page=True)

    # ---- C. Tiles open their module; the tab bar says Modules ---------------------------------
    mods.locator('[data-module="animals"]').click()
    pg.wait_for_timeout(500)
    check('Animals tile opens Animals', pg.evaluate('location.hash').endswith('/animals'), pg.evaluate('location.hash'))
    go(pg, '#/')
    pg.get_by_role('navigation', name='Main').get_by_text('Modules').click()
    pg.wait_for_timeout(500)
    check('Modules tab opens the full list', pg.evaluate('location.hash') == '#/more' and pg.locator('h1').first.inner_text() == 'Modules', pg.evaluate('location.hash'))
    over = pg.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
    check('No sideways scroll on the Modules page', not over)

    b.close()

bad = [r for r in results if not r[1]]
for n, ok, d in results:
    print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else f'   <- {d}'))
print(f'\n{len(results) - len(bad)}/{len(results)} checks passed. Console/page errors: {errors}')
sys.exit(1 if bad or errors else 0)
