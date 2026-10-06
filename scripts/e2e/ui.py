"""End-to-end run of the redesigned Agri-It UI against the demo build (phone viewport)."""
import re, sys, struct, zlib
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

def go(pg, h, wait='main'):
    pg.goto(URL + h)
    pg.locator(wait).first.wait_for(timeout=10000)
    pg.wait_for_timeout(350)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # A. Today, day mode
    go(pg, '#/')
    glance = pg.get_by_label('Farm at a glance')
    t = glance.inner_text()
    check('Feed dial shows lowest feed (12 days)', '12' in t and 'Order soon' in t, t.replace('\n', ' | '))
    check('Silage dial 87% and 133 t short', '87%' in t and '133 t short' in t, t.replace('\n', ' | '))
    check('Cash dial compact euro, OK 90 days', '127K' in t and 'OK 90 days' in t, t.replace('\n', ' | '))
    body = pg.locator('main').inner_text()
    check('Do next lists priorities', 'Do next' in body and 'Silage short for the winter' in body)
    check('Feeding today from the plan', 'Dairy cows: 240 kg Dairy nut 16%' in body and 'Calves: 27 kg Calf ration' in body, '')
    check('Upcoming plan change shown', 'Higher rate while grass is short starts' in body, '')
    check("Day mode order: Today's jobs before Do next", body.index("Today's jobs") < body.index('Do next'))
    pg.screenshot(path=f'{OUT}/today.png')

    # B. Dawn mode toggle
    pg.get_by_role('button', name='Switch to dawn mode').click()
    pg.wait_for_timeout(300)
    check('Dawn class applied', pg.evaluate("document.documentElement.classList.contains('dawn')"))
    body = pg.locator('main').inner_text()
    # The app says "Before milking" in the morning and "Evening jobs" after noon (phone's local time)
    dawn_title = pg.evaluate("new Date().getHours() < 12") and 'Before milking' or 'Evening jobs'
    check(f'Dawn: {dawn_title} comes first', dawn_title in body and body.index(dawn_title) < body.index('Then'))
    check('Dawn: theme-color meta updated', pg.evaluate("document.querySelector('meta[name=theme-color]').content") == '#0E1712')
    pg.screenshot(path=f'{OUT}/today-dawn.png')
    go(pg, f'#/feed/{NUT}')
    pg.screenshot(path=f'{OUT}/feed-dawn.png')
    go(pg, '#/diary')
    pg.screenshot(path=f'{OUT}/diary-dawn.png')
    go(pg, '#/')
    pg.get_by_role('button', name='Switch to day screen').click()
    pg.wait_for_timeout(200)
    check('Day mode restored', not pg.evaluate("document.documentElement.classList.contains('dawn')"))

    # C. Feed dial links to the lowest feed; Dairy nut sum
    glance.get_by_role('link').first.click()
    pg.wait_for_timeout(400)
    check('Feed dial opens Calf ration', CALF in pg.url, pg.url)
    go(pg, f'#/feed/{NUT}')
    s = pg.get_by_label('How the run-out date is worked out').inner_text().replace('\n', ' | ')
    for frag in ['8,600 kg', 'Today to Thu, 8 Oct', '−840 kg', 'Higher rate while grass is short: 400 kg a day for 10 days', '−4,000 kg', '3,760 kg at 280 kg a day', '13 days', 'Runs out Sun, 1 Nov', '26', 'Order by Mon, 26 Oct']:
        check(f'Feed sum shows "{frag}"', frag in s, s)
    w = pg.locator('main').inner_text()
    check('Who eats it rows with Change', 'Dairy cows, 240 kg a day' in w and 'Change' in w)
    check('Order again uses last delivery', 'Order 8 t again' in w and 'Last price €390/t' in w)
    pg.screenshot(path=f'{OUT}/feed-detail.png', full_page=False)

    # D. Record screen from the bottom bar
    go(pg, '#/')
    pg.get_by_role('link', name='Record something').click()
    pg.get_by_text('Same as last time').wait_for()
    r = pg.locator('body').inner_text()
    check('Record: repeat delivery row', 'Dairy nut 16%, 8 t' in r and 'Tirlán FarmLife, €390/t' in r, '')
    check('Record: repeat milk row', 'Milk cheque, Tirlán' in r)
    check('Record: repeat bill row is the ESB bill', 'ESB bill' in r)
    pg.screenshot(path=f'{OUT}/record.png')

    # E. Repeat delivery -> prefilled -> Saved summary
    pg.get_by_role('link', name=re.compile('Dairy nut 16%, 8 t')).click()
    pg.get_by_text('How much came?').wait_for()
    check('Delivery prefilled 8 t', pg.locator('#qty').input_value() == '8', pg.locator('#qty').input_value())
    pg.get_by_role('button', name='Save delivery').click()
    pg.get_by_role('heading', name='Delivery saved').wait_for(timeout=8000)
    sv = pg.locator('body').inner_text().replace('\n', ' | ')
    for frag in ['Dairy nut 16%, 8 t from Tirlán', 'Days of Dairy nut 16% left', '26', '55', 'Mon, 30 Nov', 'Tue, 24 Nov', '€67,280', '€70,400', 'of €75,000 budget so far', 'Add the docket photo', 'Another delivery']:
        check(f'Saved delivery shows "{frag}"', frag in sv, sv)
    pg.screenshot(path=f'{OUT}/saved.png')

    # F. Undo returns to Today with the old numbers
    pg.get_by_role('button', name='Undo').click()
    pg.get_by_label('Farm at a glance').wait_for()
    pg.wait_for_timeout(500)
    nut = pg.locator('article', has_text='Dairy nut').first.inner_text()
    check('Undo restored Dairy nut to 26 days', '26' in nut and 'days left' in nut, nut.replace('\n', ' | '))

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
    pg.get_by_role('link', name=re.compile('ESB bill')).click()
    pg.wait_for_timeout(500)
    vals = pg.locator('input').evaluate_all('els => els.map(e => e.value)')
    check('Bill repeat prefills amount and payee', any(v in ('677', '677.00') for v in vals) and 'Electricity supplier' in vals, str(vals))

    # J. Photo first, then say what it is
    png(f'{OUT}/docket.png')
    go(pg, '#/record')
    pg.locator('input[type=file]').first.set_input_files(f'{OUT}/docket.png')
    pg.get_by_role('dialog', name='What is this?').wait_for()
    pg.screenshot(path=f'{OUT}/record-photo.png')
    pg.get_by_role('button', name=re.compile('Feed docket')).click()
    pg.get_by_text('How much came?').wait_for()
    check('Photo carried into delivery form', pg.get_by_text('Attached: docket.png').count() > 0)

    # K. Diary
    go(pg, '#/diary')
    d = pg.locator('main').inner_text()
    check('Diary progress chart', 'Milk cheques this year' in d and 'Best: May' in d, d[:300])
    check('Diary timeline has sale and cheque just recorded', '5 sold from Weanlings' in d and 'Milk cheque' in d, d[:600])
    check('Diary groups by day then month', 'Today' in d and re.search(r'(August|September) 2026', d) is not None)
    pg.screenshot(path=f'{OUT}/diary.png')

    # L. Settings
    go(pg, '#/settings')
    st = pg.locator('main').inner_text()
    check('Settings: dawn mode options', 'Dawn mode (dark screen)' in st and 'Before 8am, after 8pm' in st)
    check('Settings: feed target', 'Feed you like to have in hand' in st)

    # M. No sideways scroll at a small phone width, both themes
    small = b.new_context(viewport={'width': 360, 'height': 740})
    sp = small.new_page()
    sp.on('pageerror', lambda e: errors.append('360px: ' + str(e)))
    routes = ['#/', '#/record', '#/record/delivery', f'#/feed/{NUT}', '#/diary', '#/money', '#/forecast', '#/settings', '#/farm', '#/money/year-end']
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
