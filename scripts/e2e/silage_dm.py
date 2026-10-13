"""Silage dry matter help in the browser, against the demo build at phone size.

Which cut, a lab figure, Teagasc's squeeze and ball tests, what's typical for the farm's side of
the border (the demo farm is in Tipperary, ROI), Teagasc's pit density offered only when it fits,
and nothing recorded until Save.
Run: python3 scripts/e2e/silage_dm.py http://localhost:4331/ out/
"""
import re, sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []
def check(name, cond, detail=''): results.append((name, bool(cond), detail))
def go(pg, h):
    pg.goto(URL + h); pg.locator('main').first.wait_for(timeout=10000); pg.wait_for_timeout(400)
def main_text(pg): return pg.locator('main').inner_text()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    go(pg, '#/'); pg.wait_for_timeout(1200)
    go(pg, '#/farm/silage'); before = main_text(pg)

    go(pg, '#/farm/silage/new')
    t = main_text(pg)
    check('Dry matter section with which cut', 'Dry matter' in t and 'Which cut is it?' in t and 'First cut' in t, t[:400])
    check('ROI farm sees Teagasc typical figure, not Northern Ireland averages', 'about 25% dry matter' in t and '32.8' not in t, t)
    check('Typical figures say they fill nothing in', 'Nothing here is filled in for you' in t)
    link = pg.locator('a[href*="teagasc.ie"]').first
    check('Typical figure links to its Teagasc source, opened outside the app', link.count() and link.get_attribute('target') == '_blank')
    check('Yard test offered when there is no lab figure', 'No test yet? Check it in the yard' in t and 'Squeeze test' in t)
    check('Teagasc density offered for a pit with no figure yet', 'Use 719 kg/m³' in t, t)

    # Squeeze test: pick what you saw
    tile = pg.get_by_role('button', name=re.compile('Juice comes out, but only with effort'))
    h = tile.bounding_box()['height']
    check('Test result tiles are big enough for a gloved hand (56px+)', h >= 55, str(h))
    tile.click(); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Squeeze test gives a band, labelled as an estimate', 'About 20 to 25% dry matter (squeeze test, your estimate)' in t, t[:800])
    check('Once there is a yard test, the density is worked out, not offered', 'Use 719 kg/m³' not in t and 'Worked out for you: 680 to 770 kg/m³' in t, t[:1200])
    # Ball test: drier silage, lighter
    pg.get_by_role('button', name=re.compile('^Ball test')).click(); pg.wait_for_timeout(200)
    pg.get_by_role('button', name=re.compile('Ball slowly falls apart')).click(); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Ball test band shown', 'About 30 to 40% dry matter (ball test, your estimate)' in t, t[:800])
    check('Drier silage works out lighter', 'Worked out for you: 480 to 600 kg/m³' in t, t[:1200])
    check('Says the winter plan counts the lighter figure', 'counts the lighter figure' in t)
    # Lab figure wins
    pg.get_by_label('Dry matter from a silage test').fill('25.4'); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Lab figure replaces the yard test', '25.4% dry matter (silage test)' in t and 'No test yet?' not in t, t[:800])
    check('Lab figure: one density worked out', 'Worked out for you: 674 kg/m³' in t and 'Use 719 kg/m³' not in t, t[:1200])
    check('Worked-out density links to DAERA', pg.locator('a[href*="daera-ni.gov.uk"]').count() > 0)

    pg.get_by_role('button', name='Second cut').click()
    pg.get_by_label('Name').fill('DM test pit')
    pg.get_by_label('Length').fill('30'); pg.get_by_label('Width').fill('10'); pg.get_by_label('Avg height').fill('2')
    pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Nothing saved before Save', 'DM test pit' not in before)
    check('Tonnes worked out from the dry matter with no density typed', pg.get_by_label('Density').input_value() == '' and 'About 404 t fresh' in t, t[:1400])
    check('Tonnes of dry matter shown', "That's about 103 t of dry matter" in t, t[:1400])
    check('Shows what it does to the whole winter', 'Your winter with this:' in t and 'months of feeding' in t, t[:1600])
    pg.screenshot(path=f'{OUT}/silage-dm-form.png', full_page=True)
    check('No sideways scroll', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
    pg.get_by_role('button', name='Save').click(); pg.wait_for_timeout(1000)

    go(pg, '#/farm/silage')
    t = main_text(pg)
    check('List shows the pit with its dry matter and cut', 'DM test pit' in t and '25.4% DM' in t and 'second cut' in t, t)
    check('List explains where the density came from', 'worked out from 25.4% dry matter' in t, t)

    # Teagasc's 25% figure: only for a pit with no dry matter yet
    go(pg, '#/farm/silage/new')
    pg.get_by_label('Name').fill('Old pit')
    pg.get_by_label('Length').fill('30'); pg.get_by_label('Width').fill('10'); pg.get_by_label('Avg height').fill('2')
    pg.get_by_role('button', name='Use 719 kg/m³').click(); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Using it fills 719 and says whose figure it is', pg.get_by_label('Density').input_value() == '719' and "Teagasc's figure for pit silage of about 25% dry matter" in t, t[:900])
    check('Tonnes worked out from it', 'About 431 t fresh' in t, t[:900])
    pg.get_by_label('Dry matter from a silage test').fill('32'); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Dry silage on the 25% figure is flagged', "Teagasc's density may be well out" in t, t[:1200])
    pg.get_by_role('button', name='Work it out from my dry matter instead').click(); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('One tap swaps to the worked-out density', pg.get_by_label('Density').input_value() == '' and 'Worked out for you: 576 kg/m³' in t and 'About 346 t fresh' in t, t[:1400])
    # Typing a density makes it the farm's own figure
    pg.get_by_label('Density').fill('700'); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Typing your own density replaces the worked-out one', 'Worked out for you' not in t and 'About 420 t fresh' in t, t[:1200])
    pg.get_by_role('button', name='Save').click(); pg.wait_for_timeout(800)
    go(pg, '#/farm/silage')
    t = main_text(pg)
    check('Saved as your own figure', 'Old pit' in t and '700 kg/m³' in t and 'worked out from 32' not in t, t)
    b.close()

for n, ok, d in results:
    print(('PASS' if ok else 'FAIL'), n, '' if ok else d[:600])
print(f"{sum(1 for _, ok, _ in results if ok)}/{len(results)} checks passed. Console/page errors: {errors}")
sys.exit(0 if all(ok for _, ok, _ in results) and not errors else 1)
