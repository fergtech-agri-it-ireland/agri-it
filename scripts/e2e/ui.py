"""End-to-end run of the Agri-It UI (dashboard, diary, add, progress, more) against the demo build (phone viewport)."""
import re, sys, struct, zlib
import datetime
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1]
OUT = sys.argv[2]
NUT = '50000000-0000-0000-0000-000000000001'
CALF = '50000000-0000-0000-0000-000000000002'
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def png(path):
    # tiny valid PNG for the photo flow
    raw = b'\x00\xff\xc6\x1a'
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

def day(n):
    # The demo's dates are relative to today, so the expected dates are too (as the app writes them)
    d = datetime.date.today() + datetime.timedelta(days=n)
    return f"{d.strftime('%a')}, {d.day} {'Sept' if d.month == 9 else d.strftime('%b')}"

def go(pg, h, wait='main'):
    pg.goto(URL + h)
    pg.locator(wait).first.wait_for(timeout=10000)
    pg.wait_for_timeout(350)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    # The photo reader's own CDN is not reachable from the test browser; ocr.py covers that path.
    # Any other failed request is a real error.
    pg.on('requestfailed', lambda r: 'tesseract' not in r.url and errors.append('request failed: ' + r.url[:120]))

    # A. Dashboard, day mode
    go(pg, '#/')
    feed = pg.get_by_label('Feed', exact=True)
    t = feed.inner_text()
    check('Feed ring shows the feed that runs out first (Calf ration, 12 days)', 'Calf ration' in t and '12' in t and 'days left' in t, t.replace('\n', ' | '))
    check('Feed ring shows target, bin and daily use', 'Your target' in t and '30 days' in t and '335 kg' in t and '27 kg a day' in t, t.replace('\n', ' | '))
    check('Feed ring says the order is in', '1 t on order' in t, t.replace('\n', ' | '))
    check('Other feeds listed under the ring', 'Dairy nut 16%' in t and '26 days' in t, t.replace('\n', ' | '))
    body = pg.locator('main').inner_text()
    check('Silage card 87% and 133 t short', '87%' in body and '133 t short' in body)
    check('Cash card with balance, OK 90 days', '€126,940' in body and 'OK 90 days' in body)
    check("Today's diary summary", "Today's diary" in body and '0 of 3 ticked off' in body)
    check('Do next lists priorities', 'Do next' in body and 'Silage short for the winter' in body)
    check('Dairy farm sees the milk card', 'Last cheque' in body and 'Per litre' in body)
    check('Animals card shows breeds', 'Holstein Friesian' in body and 'Aberdeen Angus' in body and '208 cattle' in body)
    check('Dairy-only farm does not see crops', 'Crops' not in body)
    check('Getting started hidden once set up', 'Getting started' not in body)
    nav = pg.get_by_role('navigation', name='Main').inner_text()
    check('Bottom bar: Dashboard, Diary, Progress, More', all(x in nav for x in ['Dashboard', 'Diary', 'Progress', 'More']), nav)
    pg.screenshot(path=f'{OUT}/today.png')

    # B. Dawn mode toggle
    pg.get_by_role('button', name='Switch to dawn mode').click()
    pg.wait_for_timeout(300)
    check('Dawn class applied', pg.evaluate("document.documentElement.classList.contains('dawn')"))
    check('Dawn: theme-color meta updated', pg.evaluate("document.querySelector('meta[name=theme-color]').content") == '#0B110E')
    pg.screenshot(path=f'{OUT}/today-dawn.png')
    go(pg, f'#/feed/{NUT}')
    pg.screenshot(path=f'{OUT}/feed-dawn.png')
    go(pg, '#/diary')
    pg.screenshot(path=f'{OUT}/diary-dawn.png')
    go(pg, '#/')
    pg.get_by_role('button', name='Switch to day screen').click()
    pg.wait_for_timeout(200)
    check('Day mode restored', not pg.evaluate("document.documentElement.classList.contains('dawn')"))

    # C. Diary: the day, like a food diary
    go(pg, '#/diary')
    bin_ = pg.get_by_label('In the bin').inner_text().replace('\n', ' | ')
    check('Bin sum for the feed that runs out first', 'Calf ration in the bin' in bin_ and 'Start' in bin_ and 'kg now' in bin_ and '335' in bin_, bin_)
    d = pg.locator('main').inner_text()
    check('Diary sections: Feeding, Jobs, Deliveries, Money, Records', all(x in d for x in ['Feeding', 'Jobs and routines', 'Deliveries and orders', 'Money', 'Records']), d[:400])
    check('Dairy farm: Money section offers the milk cheque', 'ADD MILK CHEQUE OR BILL' in d.upper(), d[-300:])
    pg.get_by_label('Which feed').select_option(label='Dairy nut 16%')
    bin_ = pg.get_by_label('In the bin').inner_text().replace('\n', ' | ')
    check('Bin sum switches feed', 'Dairy nut 16% in the bin' in bin_ and '8,600' in bin_, bin_)
    pg.get_by_role('button', name='Day before').click()
    pg.wait_for_timeout(300)
    d = pg.locator('main').inner_text()
    check('Yesterday shows what was fed', 'Yesterday' in pg.locator('header').first.inner_text() and 'Feeding' in d and 'kg left' in d, d[:400])
    check('Next day goes back to today', pg.get_by_role('button', name='Next day').is_enabled())
    pg.screenshot(path=f'{OUT}/diary.png')

    go(pg, f'#/feed/{NUT}')
    s = pg.get_by_label('How the run-out date is worked out').inner_text().replace('\n', ' | ')
    for frag in ['8,600 kg', f'Today to {day(2)}', '−840 kg', 'Higher rate while grass is short: 400 kg a day for 10 days', '−4,000 kg', '3,760 kg at 280 kg a day', '13 days', f'Runs out {day(26)}', '26', f'Order by {day(20)}']:
        check(f'Feed sum shows "{frag}"', frag in s, s)
    w = pg.locator('main').inner_text()
    check('Who eats it rows with Change', 'Dairy cows, 240 kg a day' in w and 'Change' in w)
    check('Order again uses last delivery', 'Order 8 t again' in w and 'Last price €390/t' in w)
    pg.screenshot(path=f'{OUT}/feed-detail.png', full_page=False)

    # D. Add screen from the bottom bar
    go(pg, '#/')
    pg.get_by_role('link', name='Add to diary').click()
    pg.get_by_role('heading', name='Add to diary').wait_for()
    r = pg.locator('body').inner_text()
    check('Add: recent delivery row', 'Dairy nut 16%, 8 t' in r and 'Tirlán FarmLife, €390/t' in r, '')
    check('Add: recent milk row', 'Milk cheque, Tirlán' in r)
    check('Add: recent bill row is the ESB bill', 'ESB bill' in r)
    check('Add: docket photo and a quick tile', 'Pick a docket photo' in r and 'Feed delivery' in r)
    pg.get_by_role('tab', name='Everything').click()
    r = pg.locator('main').inner_text().upper()
    check('Everything: dairy kinds first, crop kinds lower down', r.index('MILK CHEQUE') < r.index('OTHER THINGS YOU CAN ADD') < r.index('GRAIN OR STRAW SALE'), r[-700:])
    pg.get_by_label('Search').fill('vet')
    r = pg.locator('main').inner_text()
    check('Search finds bills', 'Bill paid' in r and 'Milk cheque' not in r, r[-300:])
    pg.get_by_label('Search').fill('')
    pg.get_by_role('tab', name='Recent').click()
    pg.screenshot(path=f'{OUT}/record.png')

    # E. Repeat delivery -> prefilled -> Saved summary
    pg.get_by_role('link', name=re.compile('Add again: Dairy nut 16%, 8 t')).click()
    pg.get_by_text('How much came?').wait_for()
    check('Delivery prefilled 8 t', pg.locator('#qty').input_value() == '8', pg.locator('#qty').input_value())
    pg.get_by_role('button', name='Save delivery').click()
    pg.get_by_role('heading', name='Delivery saved').wait_for(timeout=8000)
    sv = pg.locator('body').inner_text().replace('\n', ' | ')
    for frag in ['Dairy nut 16%, 8 t from Tirlán', 'Days of Dairy nut 16% left', '26', '55', day(55), day(49), '€67,280', '€70,400', 'of €75,000 budget so far', 'Add the docket photo', 'Another delivery']:
        check(f'Saved delivery shows "{frag}"', frag in sv, sv)
    pg.screenshot(path=f'{OUT}/saved.png')

    # F. Undo returns to Today with the old numbers
    pg.get_by_role('button', name='Undo').click()
    pg.get_by_label('Feed', exact=True).wait_for()
    pg.wait_for_timeout(500)
    nut = pg.get_by_label('Feed', exact=True).inner_text()
    check('Undo restored Dairy nut to 26 days', 'Dairy nut 16%' in nut and '26 days' in nut, nut.replace('\n', ' | '))

    # G. Animal sale -> Saved summary
    go(pg, '#/record/sale')
    pg.get_by_role('button', name=re.compile('^Weanlings')).click()
    for _ in range(4): pg.get_by_role('button', name='Increase How many?').click()
    pg.get_by_label('Total received').fill('3000')
    pg.get_by_role('button', name='Save sale').click()
    pg.get_by_role('heading', name='Sale saved').wait_for(timeout=8000)
    sv = pg.locator('body').inner_text().replace('\n', ' | ')
    for frag in ['5 from Weanlings for €3,000', 'Weanlings head count', '30', '25', 'Livestock sales this year', '€7,400', '€10,400', '€600']:
        check(f'Saved sale shows "{frag}"', frag in sv, sv)
    pg.screenshot(path=f'{OUT}/saved-sale.png')
    pg.get_by_role('link', name='Done').click()
    pg.wait_for_timeout(400)
    check('Done returns to Today', pg.url.endswith('#/'), pg.url)

    # H. Milk cheque -> Saved summary
    go(pg, '#/record/milk')
    pg.get_by_label('Amount received').fill('27000')
    pg.get_by_label('Litres (optional)').fill('58000')
    pg.get_by_role('button', name='Save milk cheque').click()
    pg.get_by_role('heading', name='Milk cheque saved').wait_for(timeout=8000)
    sv = pg.locator('body').inner_text().replace('\n', ' | ')
    for frag in ['€27,000 from Tirlán, 58,000 L', 'Milk income this year', 'Cash recorded', 'This cheque', '46.6 c/L', 'Year average']:
        check(f'Saved milk shows "{frag}"', frag in sv, sv)

    # I. Bill repeat prefill
    go(pg, '#/record')
    pg.get_by_role('link', name=re.compile('Add again: ESB bill')).click()
    pg.wait_for_timeout(500)
    vals = pg.locator('input').evaluate_all('els => els.map(e => e.value)')
    check('Bill repeat prefills amount and payee', any(v in ('677', '677.00') for v in vals) and 'Electricity supplier' in vals, str(vals))

    # J. Photo first, then say what it is
    png(f'{OUT}/docket.png')
    go(pg, '#/record')
    pg.locator('input[type=file]').first.set_input_files(f'{OUT}/docket.png')
    # The photo is read first (scripts/e2e/ocr.py tests that); whatever it finds, the kinds are offered
    dialog = pg.get_by_role('dialog')
    dialog.get_by_role('button', name=re.compile('Feed docket')).wait_for(timeout=60000)
    pg.screenshot(path=f'{OUT}/record-photo.png')
    dialog.get_by_role('button', name=re.compile('Feed docket')).click()
    pg.get_by_text('How much came?').wait_for()
    check('Photo carried into delivery form', pg.get_by_text('Attached: docket.png').count() > 0)

    # K. Diary history (everything recorded)
    go(pg, '#/diary?tab=history')
    d = pg.locator('main').inner_text()
    check('History progress chart', 'Milk cheques this year' in d and 'Best: May' in d, d[:300])
    check('History has the sale and cheque just recorded', '5 sold from Weanlings' in d and 'Milk cheque' in d, d[:600])
    check('History groups by day then month', 'TODAY' in d.upper() and re.search(r'(AUGUST|SEPTEMBER) 2026', d.upper()) is not None)
    go(pg, '#/diary')
    d = pg.locator('main').inner_text()
    check("Today's diary lists today's sale and cheque under Money", '5 sold from Weanlings' in d and 'Milk cheque, Tirlán' in d, d[-800:])
    pg.screenshot(path=f'{OUT}/diary-history.png')

    # K2. More, farm types, breeds and crops
    go(pg, '#/more')
    m = pg.locator('main').inner_text()
    check('More groups: Your farm, Money, Records, Help', all(x in m.upper() for x in ['YOUR FARM', 'MONEY', 'RECORDS', 'HELP AND SETTINGS']), m[:300])
    check('More shows what you farm', 'What you farm' in m and 'Dairy' in m)
    pg.get_by_role('link', name=re.compile('^What you farm')).click()
    for t in ['Sheep', 'Tillage']: pg.get_by_role('button', name=re.compile('^' + t)).click()
    pg.screenshot(path=f'{OUT}/farm-types.png')
    pg.get_by_role('button', name='Save').click()
    pg.wait_for_timeout(500)
    go(pg, '#/')
    body = pg.locator('main').inner_text()
    check('Adding tillage brings the crops card', 'Crops' in body and 'Add your crops and acres' in body, body[-900:])
    check('Getting started steers to crops, inputs and grain', 'Getting started' in body and 'Add your crops and acres' in body, body[:600])
    go(pg, '#/record')
    pg.get_by_role('tab', name='Everything').click()
    r = pg.locator('main').inner_text().upper()
    check('Dairy, sheep and tillage: every kind is relevant, grain sales included', 'GRAIN OR STRAW SALE' in r and 'SOLD ANIMALS' in r and 'OTHER THINGS YOU CAN ADD' not in r, r[-600:])
    go(pg, '#/farm/crops')
    pg.get_by_role('button', name='Add', exact=True).click()
    dlg = pg.get_by_role('dialog')
    dlg.get_by_role('button', name='Winter wheat').click()
    dlg.get_by_label('Acres').fill('40')
    dlg.get_by_role('button', name='Add crop').click()
    pg.wait_for_timeout(400)
    c = pg.locator('main').inner_text()
    check('Crop saved with acres', 'Winter wheat' in c and '40 acres' in c, c)
    go(pg, '#/record/income?type=crop')
    pg.get_by_label('Amount').fill('9000')
    pg.get_by_role('button', name='Save income').click()
    pg.wait_for_timeout(500)
    go(pg, '#/')
    body = pg.locator('main').inner_text()
    check('Crops card shows acres and grain sold', '40 acres' in body and '€9,000' in body, body[-900:])
    go(pg, '#/farm/groups')
    pg.get_by_role('button', name='Add', exact=True).click()
    dlg = pg.get_by_role('dialog')
    groups_text = dlg.inner_text()
    check('Any animal can be added: bullocks, heifers, rams, hoggets, goats', all(x in groups_text for x in ['Bullocks', 'Heifers', 'Rams', 'Hoggets', 'Goats', 'Pigs', 'Horses']), groups_text)
    dlg.get_by_role('button', name='Ewes').click()
    dlg.get_by_role('button', name='Texel').click()
    dlg.get_by_role('button', name='Add group').click()
    pg.wait_for_timeout(400)
    g = pg.locator('main').inner_text()
    check('Ewes added with breed', 'Ewes' in g and 'Texel' in g, g[-400:])
    pg.screenshot(path=f'{OUT}/groups.png')

    # L. Settings
    go(pg, '#/settings')
    st = pg.locator('main').inner_text()
    check('Settings: dawn mode options', 'Dawn mode (dark screen)' in st and 'Before 8am, after 8pm' in st)
    check('Settings: feed target', 'Feed you like to have in hand' in st)

    # M. No sideways scroll at a small phone width, both themes
    small = b.new_context(viewport={'width': 360, 'height': 740})
    sp = small.new_page()
    sp.on('pageerror', lambda e: errors.append('360px: ' + str(e)))
    routes = ['#/', '#/record', '#/record/delivery', f'#/feed/{NUT}', '#/diary', '#/diary?tab=history', '#/money', '#/progress', '#/settings', '#/more', '#/farm/groups', '#/farm/crops', '#/farm/types', '#/onboarding', '#/money/year-end']
    for mode in ['off', 'on']:
        sp.goto(URL + '#/'); sp.evaluate(f"localStorage.setItem('agri-it:dawn', '{mode}')")
        for r_ in routes:
            sp.goto(URL + r_); sp.locator('main, h1').first.wait_for(timeout=10000); sp.wait_for_timeout(250)
            over = sp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
            check(f'No sideways scroll {r_} (dawn {mode})', not over)
    b.close()

failed = [r for r in results if not r[1]]
for n, ok, det in results:
    print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else f'   <- {det[:400]}'))
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed. Console/page errors: {errors}')
