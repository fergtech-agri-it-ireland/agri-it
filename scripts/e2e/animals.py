"""Animal tags: scan the identity card, save an animal, list it, change it, delete it. Demo build, phone size.
Usage: python3 scripts/e2e/animals.py http://localhost:4331/ out/

The cards are made-up photos (scripts/samples/make_animal_cards.py), crooked and dim. The demo loads
the photo reader from the public CDN; here those requests are answered from node_modules, so the real
reader runs in the browser with no network. They are not the real card layout: the reader finds the
tag by its shape, wherever it sits."""
import os, re, sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
NM = os.path.join(HERE, '..', '..', 'node_modules')
FIX = os.path.join(HERE, 'fixtures')
os.makedirs(OUT, exist_ok=True)
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def quiet(text):
    return 'net::ERR_FAILED' in text or re.match(r'(Estimating resolution|Detected \d+ diacritics|Warning: Invalid resolution|Failed to load resource)', text)

def serve_cdn(route):
    u = route.request.url
    name = u.rsplit('/', 1)[1]
    if 'tesseract.js@' in u: f = os.path.join(NM, 'tesseract.js', 'dist', name)
    elif 'tesseract.js-core@' in u: f = os.path.join(NM, 'tesseract.js-core', name)
    elif '@tesseract.js-data/eng@' in u: f = os.path.join(NM, '@tesseract.js-data', 'eng', '4.0.0_best_int', name)
    else: return route.abort()
    if not os.path.exists(f): return route.fulfill(status=404)
    route.fulfill(path=f, headers={'access-control-allow-origin': '*', 'content-type': 'application/javascript' if f.endswith('.js') else 'application/octet-stream'})

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main, div.pad-bottom').first.wait_for(timeout=10000)
    pg.wait_for_timeout(400)

def body(pg):
    return pg.locator('body').inner_text()

def scan(pg, name):
    pg.locator('[data-testid=card-input]').first.set_input_files(os.path.join(FIX, name))
    pg.locator('[data-testid=card-read], [data-testid=read-unavailable], [data-testid=read-unreadable]').first.wait_for(timeout=90000)

def run(p):
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route('https://cdn.jsdelivr.net/**', serve_cdn)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and not quiet(m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: not quiet(str(e)) and errors.append(str(e)))

    # A. Where it is
    go(pg, '#/more')
    check('Modules lists Animal tags', 'Animal tags' in body(pg))
    go(pg, '#/record')
    pg.get_by_text('Everything').click()
    check('Add lists Scan an animal card', 'Scan an animal card' in body(pg))
    go(pg, '#/farm/groups')
    check('Animals and breeds links to Animal tags', pg.get_by_role('link', name=re.compile('Animal tags')).count() == 1)
    go(pg, '#/animals')
    check('Empty list explains itself', 'No animals recorded yet' in body(pg))
    check('Demo uses a file picker, not the camera', pg.locator('[data-testid=card-input]').first.get_attribute('capture') is None)

    # B. Scan a clean card
    go(pg, '#/animals/new')
    save = pg.get_by_role('button', name='Save animal')
    check('Save is off until there is a tag', save.is_disabled())
    scan(pg, 'animal-card-clean.jpg')
    res = pg.locator('[data-testid=card-read]').inner_text()
    pg.screenshot(path=f'{OUT}/animal-scan.png')
    if 'blocks the photo reader' in body(pg):
        check('Reader started', False, 'the reader could not start in this browser'); return
    check('Says it read one number and how sure', '372 12 34567 8 1234' in res and re.search(r'sure', res), res)
    check('Tag number filled in', pg.get_by_label('Tag number').input_value() == '372 12 34567 8 1234', pg.get_by_label('Tag number').input_value())
    check('Tells the farmer to check it against the card', 'Check it against the card' in res)
    check('Date of birth is only offered, not filled', pg.locator('[data-testid=born-suggestion]').count() == 1 and pg.locator('#born').input_value() == '')
    check('Save is on', save.is_enabled())
    pg.locator('[data-testid=born-suggestion]').get_by_role('button', name='Use it').click()
    check('Using the date fills it in', pg.locator('#born').input_value() == '2024-02-05', pg.locator('#born').input_value())
    pg.get_by_role('button', name=re.compile('Dairy cows')).first.click()
    pg.get_by_role('button', name='Female', exact=True).click()
    pg.get_by_role('button', name='Save animal').click()
    pg.locator('[data-testid=animal-saved]').wait_for(timeout=8000)
    check('Saved: shows the tag and offers the next card', '372 12 34567 8 1234' in body(pg) and pg.get_by_text('Scan the next card').count() == 1)
    pg.screenshot(path=f'{OUT}/animal-saved.png')

    # C. The same card again is refused
    scan(pg, 'animal-card-clean.jpg')
    check('The group stays picked for the next card', pg.get_by_role('button', name=re.compile('Dairy cows')).first.get_attribute('aria-pressed') == 'true')
    check('Same tag twice: told it is already on the farm', pg.locator('[data-testid=tag-dupe]').count() == 1)
    check('Same tag twice: cannot save', pg.get_by_role('button', name='Save animal').is_disabled())

    # D. A card with two numbers: the farmer picks
    scan(pg, 'animal-card-two.jpg')
    check('Two numbers: asks which', pg.locator('[data-testid=many-tags]').count() == 1 and pg.locator('[data-testid=many-tags] button').count() == 2)
    check('Two numbers: none chosen for the farmer', pg.get_by_label('Tag number').input_value() == '')
    pg.locator('[data-tag="372123456720456"]').click()
    check('Picking one fills it in', pg.get_by_label('Tag number').input_value() == '372 12 34567 2 0456')
    pg.get_by_role('button', name='Male', exact=True).click()
    pg.get_by_role('button', name='Save animal').click()
    pg.locator('[data-testid=animal-saved]').wait_for(timeout=8000)

    # E. An older IE tag
    scan(pg, 'animal-card-old.jpg')
    v = pg.get_by_label('Tag number').input_value()
    check('Older IE tag read', v == 'IE 04 12345 6 7890', v)
    pg.get_by_role('button', name='Save animal').click()
    pg.locator('[data-testid=animal-saved]').wait_for(timeout=8000)

    # F. Nothing to find, and typing
    scan(pg, 'animal-card-none.jpg')
    check('No tag on the photo: says so', pg.locator('[data-testid=no-tag]').count() == 1)
    check('A herd number and a phone number are not taken for a tag', pg.get_by_label('Tag number').input_value() == '')
    tag = pg.get_by_label('Tag number')
    tag.fill('3721234')
    check('Short tag: says how many digits', 'That is 7 digits' in body(pg), body(pg)[:200])
    check('Short tag: cannot save', pg.get_by_role('button', name='Save animal').is_disabled())
    tag.fill('372 98 76543 2 1098')
    check('A typed tag works', pg.get_by_role('button', name='Save animal').is_enabled() and pg.locator('[data-testid=tag-shown]').inner_text().startswith('372 98 76543 2 1098'))
    pg.get_by_role('button', name=re.compile('Not a cattle tag')).click()
    tag = pg.get_by_label('Tag or number')
    tag.fill('SHEEP 7')
    check('Any number can be typed for other animals', pg.get_by_role('button', name='Save animal').is_enabled())
    pg.get_by_role('button', name='Save animal').click()
    pg.locator('[data-testid=animal-saved]').wait_for(timeout=8000)

    # G. The list
    go(pg, '#/animals')
    txt = body(pg)
    check('List shows the animals', all(x in txt for x in ['372 12 34567 8 1234', '372 12 34567 2 0456', 'IE 04 12345 6 7890', 'SHEEP7']), txt[:300])
    check('List counts the tagged against the group', re.search(r'Dairy cows\s+4 of 120 head', txt) is not None, txt[txt.lower().find('tagged'):txt.lower().find('tagged') + 260])
    check('Says it is not the herd register', 'not the official herd register' in txt)
    pg.get_by_label('Search tags').fill('0456')
    check('Search by the last digits', pg.locator('[data-animal]').count() == 1)
    pg.get_by_label('Search tags').fill('')
    check('No sideways scroll on the list', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))

    # H. Change one: sold
    pg.locator('[data-animal="372123456781234"]').click()
    pg.wait_for_timeout(400)
    check('Change screen holds the saved details', pg.locator('#born').input_value() == '2024-02-05' and pg.get_by_label('Tag number').input_value() == '372 12 34567 8 1234')
    pg.get_by_role('button', name='Sold', exact=True).click()
    check('Sold asks when', 'Sold on' in body(pg))
    pg.get_by_role('button', name='Save changes').click()
    pg.wait_for_timeout(700)
    check('Back on the list after saving', pg.locator('[data-animal]').count() >= 1 and 'Animal tags' in body(pg))
    check('Sold one is off the farm list', pg.locator('[data-animal="372123456781234"]').count() == 0)
    pg.get_by_role('button', name=re.compile('Left the farm')).click()
    check('Sold one is under Left the farm, with its date', pg.locator('[data-animal="372123456781234"]').count() == 1 and 'sold' in pg.locator('[data-animal="372123456781234"]').inner_text())

    # I. Delete asks first
    pg.locator('[data-animal="372123456781234"]').click()
    pg.get_by_role('button', name='Delete this animal').click()
    check('Delete asks first and says nothing else changes', 'Only this animal' in body(pg) and 'not changed' in body(pg))
    pg.get_by_role('button', name='No, keep it').click()
    pg.get_by_role('button', name='Delete this animal').click()
    pg.get_by_role('button', name='Yes, delete').click()
    pg.wait_for_timeout(700)
    pg.get_by_role('button', name=re.compile('Left the farm')).click()
    check('Deleted', pg.locator('[data-animal="372123456781234"]').count() == 0)

    # J. Dashboard: tagged count on the Animals tile, and every module tile the same size
    go(pg, '#/')
    tile = pg.locator('[data-module=animals]').inner_text()
    check('Animals tile shows how many are tagged', re.search(r'\d+ tagged', tile) is not None, tile)
    sizes = pg.evaluate("[...document.querySelectorAll('[data-module]')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })")
    check('Every module tile is the same size', len(sizes) >= 8 and len(set(map(tuple, sizes))) == 1, str(sizes))
    pg.locator('[data-module=animals]').scroll_into_view_if_needed()
    pg.screenshot(path=f'{OUT}/animal-modules.png')

    b.close()

with sync_playwright() as p:
    run(p)

bad = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else f'  [{detail[:160]}]'))
for e in errors[:8]:
    print('CONSOLE ERROR:', e[:200])
print(f'\n{len(results) - len(bad)} of {len(results)} checks passed' + ('' if not errors else f', {len(errors)} console errors'))
sys.exit(1 if bad or errors else 0)
