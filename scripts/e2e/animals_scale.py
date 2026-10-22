"""Animals module at scale: hub, add several, find, update many with undo, move up a stage, and that every page opens at the top.
Demo build, phone size. About 2,000 animals are added through the screens, as a farmer would.
Usage: python3 scripts/e2e/animals_scale.py http://localhost:4331/ out/"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main, div.pad-bottom').first.wait_for(timeout=10000)
    pg.wait_for_timeout(400)

def body(pg): return pg.locator('body').inner_text()
def noside(pg): return pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth')

def run(p):
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # A. Every page opens at the top
    go(pg, '#/')
    pg.evaluate('window.scrollTo(0, document.body.scrollHeight)'); pg.wait_for_timeout(200)
    low = pg.evaluate('window.scrollY')
    pg.evaluate("location.hash = '#/animals'"); pg.wait_for_timeout(600)
    check('Scrolled down first (so the test means something)', low > 100, str(low))
    check('A new page opens at the top', pg.evaluate('window.scrollY') == 0, str(pg.evaluate('window.scrollY')))
    go(pg, '#/animals')
    check('Hub: six tiles the same size', len(set(tuple(x) for x in pg.evaluate("[...document.querySelectorAll('[data-animal-tile]')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })"))) == 1 and pg.locator('[data-animal-tile]').count() == 6)
    check('Hub keeps the bottom nav', pg.get_by_role('navigation').count() >= 1)
    pg.screenshot(path=f'{OUT}/hub-empty.png')

    # B. Add several: 1,200 cattle, 800 sheep, 40 calves into the Calves group
    def add(species, tags, born, breed, group=None):
        go(pg, '#/animals/many')
        if species != 'Cattle': pg.get_by_role('button', name=species, exact=True).click()
        pg.locator('#tags').fill('\n'.join(tags))
        if group: pg.get_by_role('button', name=re.compile('^' + group)).click()
        pg.get_by_label('Breed').fill(breed)
        pg.locator('#born').fill(born)
        s = pg.locator('[data-testid=many-summary]').inner_text()
        pg.get_by_role('button', name=re.compile(r'^Add [\d,]+ animals?$')).click()
        pg.wait_for_url(re.compile('animals/herd'), timeout=30000)
        pg.wait_for_timeout(500)
        return s
    t0 = time.time()
    s = add('Cattle', [f'372 12 {10000 + i:05d} 8 1234' for i in range(1200)], '2026-03-01', 'Angus')
    check('1,200 cattle: summary counts them', s.startswith('1,200 animals will be added'), s[:80])
    s = add('Sheep', [f'SH{i:04d}' for i in range(800)], '2025-01-01', 'Suffolk')
    check('800 sheep added', s.startswith('800 animals will be added'), s[:80])
    s = add('Cattle', [f'372 12 {90000 + i:05d} 8 1234' for i in range(40)], '2026-03-01', 'Angus', 'Calves')
    check('40 calves into the Calves group', s.startswith('40 animals'), s[:80])
    check('All adding took under a minute', time.time() - t0 < 60, f'{time.time() - t0:.1f}s')

    # B2. A messy list: a repeat, a bad one, one already here
    go(pg, '#/animals/many')
    pg.locator('#tags').fill('372 12 10000 8 1234\n372 12 55555 8 1234\n372 12 55555 8 1234\nhello world\n372 12 123')
    s = pg.locator('[data-testid=many-summary]').inner_text()
    check('Messy list: counts one new, one already here, one repeat, two unreadable', '1 animal will be added' in s and '1 already on the farm' in s and '1 given twice' in s and '2 could not be read' in s, s)
    check('Add several: no sideways scroll', noside(pg))
    pg.screenshot(path=f'{OUT}/many.png')

    # C. Find
    t0 = time.time()
    go(pg, '#/animals/herd')
    mc = pg.locator('[data-testid=match-count]').inner_text()
    check('Find: 2,040 on the farm', mc.startswith('2,040 animals'), mc)
    check('Find: shows 50 at a time', pg.locator('[data-animal]').count() == 50, str(pg.locator('[data-animal]').count()))
    pg.get_by_role('button', name=re.compile('^Show 50 more')).click()
    check('Find: show more adds 50', pg.locator('[data-animal]').count() == 100)
    pg.get_by_label('Search tags').fill('10042')
    pg.wait_for_timeout(300)
    check('Find: search by part of a tag', pg.locator('[data-animal]').count() == 1 and pg.locator('[data-animal]').first.inner_text() == '372 12 10042 8 1234', pg.locator('[data-testid=match-count]').inner_text())
    pg.get_by_label('Search tags').fill('SH0007')
    pg.wait_for_timeout(300)
    check('Find: search a sheep number', pg.locator('[data-animal]').count() == 1)
    pg.get_by_label('Search tags').fill('')
    pg.get_by_role('button', name=re.compile('^Sheep \\(800\\)')).click()
    mc = pg.locator('[data-testid=match-count]').inner_text()
    check('Find: Sheep chip gives 800', mc.startswith('800 animals'), mc)
    check('Find: sheep are hoggets (21 months)', 'hoggets' in mc.lower() or 'Hoggets' in body(pg), mc)
    pg.screenshot(path=f'{OUT}/herd-sheep.png')
    check('Find: sheep list shows the stage and age', 'Hogget' in pg.locator('main').inner_text())
    pg.get_by_role('button', name=re.compile('^All kinds')).click()
    pg.get_by_role('button', name=re.compile('^Cattle \\(')).click()
    check('Find: Cattle chip gives 1,240', pg.locator('[data-testid=match-count]').inner_text().startswith('1,240 animals'))
    check('Find: ran quickly', time.time() - t0 < 25, f'{time.time() - t0:.1f}s')
    check('Find: no sideways scroll', noside(pg))

    # D. Update 800 sheep: sold, then undo
    go(pg, '#/animals/update?species=sheep')
    check('Update: 800 will be changed', '800 animals will be changed' in pg.locator('[data-testid=update-count]').inner_text())
    pg.get_by_role('button', name='Sold', exact=True).click()
    pg.get_by_role('button', name='Review the change').click()
    ct = pg.locator('[data-testid=confirm-text]').inner_text()
    check('Update: confirmation says how many and what', '800 animals' in ct and 'sold' in ct, ct)
    check('Update: confirmation says head counts and money are not changed', 'not changed' in body(pg))
    pg.screenshot(path=f'{OUT}/update-confirm.png')
    pg.get_by_role('button', name='Yes, change them').click()
    pg.wait_for_url(re.compile('animals/herd'), timeout=30000); pg.wait_for_timeout(600)
    check('Update: 1,240 left on the farm', pg.locator('[data-testid=match-count]').inner_text().startswith('1,240 animals'), pg.locator('[data-testid=match-count]').inner_text())
    pg.get_by_role('button', name=re.compile(r'^Left \(')).click()
    check('Update: the 800 are under Left', pg.locator('[data-testid=match-count]').inner_text().startswith('800 animals'))
    pg.get_by_role('button', name='Undo').click(); pg.wait_for_timeout(900)
    pg.get_by_role('button', name=re.compile(r'^On the farm \(')).click()
    check('Undo: all 2,040 back on the farm', pg.locator('[data-testid=match-count]').inner_text().startswith('2,040 animals'), pg.locator('[data-testid=match-count]').inner_text())

    # D2. Update a picked few
    go(pg, '#/animals/update?text=10042')
    pg.get_by_role('button', name='Pick which ones').click()
    check('Pick: none ticked means nothing changes', '0 animals will be changed' in pg.locator('[data-testid=update-count]').inner_text() and pg.get_by_role('button', name='Review the change').is_disabled())
    pg.locator('input[type=checkbox]').first.check()
    check('Pick: one ticked', '1 animal will be changed' in pg.locator('[data-testid=update-count]').inner_text())
    check('Update: no sideways scroll', noside(pg))

    # E. Move up a stage
    go(pg, '#/animals')
    tile = pg.locator('[data-animal-tile=moveup]').inner_text()
    check('Hub tile says 40 have outgrown their group', '40' in tile, tile)
    go(pg, '#/animals/moveup')
    dc = pg.locator('[data-testid=due-card]').first.inner_text()
    check('Move up: 40 weanlings in Calves', dc.startswith('40 weanlings in Calves'), dc)
    pg.screenshot(path=f'{OUT}/moveup.png')
    pg.get_by_role('button', name='Move 40 weanlings').click(); pg.wait_for_timeout(900)
    check('Move up: nobody left to move', 'Nobody is due to move' in body(pg))
    go(pg, '#/animals/herd?group=' + pg.evaluate("document.location.hash") if False else '#/animals/herd')
    check('Move up: no sideways scroll', noside(pg))

    # F. Life stages
    go(pg, '#/animals/stages')
    t = body(pg)
    check('Stages: lists calf, weanling, hogget, ewe', all(x in t for x in ['Calf', 'Weanling', 'Hogget', 'Ewe']))
    check('Stages: says the ages are defaults', 'defaults' in t and 'not official' in t)
    pg.screenshot(path=f'{OUT}/stages.png')

    # G. The report with this many animals, and it all survives a reload
    t0 = time.time()
    go(pg, '#/reports/animals')
    check('Report: opens with 2,000+ animals in under 10 seconds', time.time() - t0 < 10, f'{time.time() - t0:.1f}s')
    check('Report: has the Type and Stage columns', 'Stage' in body(pg) and 'Type' in body(pg))
    go(pg, '#/animals/herd'); pg.reload(); pg.wait_for_timeout(1200)
    check('After a reload the animals are still there', pg.locator('[data-testid=match-count]').inner_text().startswith('2,040 animals'), pg.locator('[data-testid=match-count]').inner_text())
    go(pg, '#/')
    tile = pg.locator('[data-module=animals]').inner_text()
    check('Dashboard tile counts them', '2,040 tagged' in tile, tile)
    b.close()

with sync_playwright() as p:
    run(p)

bad = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else f'  [{detail[:200]}]'))
for e in errors[:8]:
    print('CONSOLE ERROR:', e[:200])
print(f'\n{len(results) - len(bad)} of {len(results)} checks passed' + ('' if not errors else f', {len(errors)} console errors'))
sys.exit(1 if bad or errors else 0)
