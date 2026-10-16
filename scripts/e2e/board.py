"""Advisory board items A to F (14 to 16 Oct 2026), in the browser against the demo build at
phone size: alert bundling and Not now with a reason (G12), stock adjustments and reasons on a
stock check (G11), supplier recheck dates (G08), fertiliser orders and the dashboard tile, and
the release line on every screen.

Run: python3 scripts/e2e/board.py http://localhost:4331/ out/
"""
import re, sys
from datetime import date
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []
TODAY = date.today().isoformat()
RELEASE = re.compile(r'Agri-It v\d+\.\d+\.\d+ · © \d{4} FergTech · Built by FergTech')

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(500)

def main_text(pg):
    return pg.locator('main').inner_text()

def no_sideways(pg):
    return pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

def attention(pg):
    return pg.get_by_role('region', name='Needs your attention')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    go(pg, '#/')

    # F. Release line on every screen
    body = pg.locator('body').inner_text()
    check('Release line on Today', RELEASE.search(body), body[-300:])
    for h in ['#/settings', '#/record/spread', '#/diary', '#/record']:
        go(pg, h)
        check(f'Release line on {h}', RELEASE.search(pg.locator('body').inner_text()))
    check('No em dashes on screen', '\u2014' not in pg.locator('body').inner_text())

    # A. Bundling: two jobs due today become one line
    go(pg, '#/farm/jobs')
    for t in ['Fix the crush gate', 'Ring the AI man']:
        pg.get_by_label('New job').fill(t)
        pg.get_by_role('button', name='Add job').click(); pg.wait_for_timeout(400)
    go(pg, '#/')
    bundle = pg.locator('[data-alert="bundle-job"]')
    bt = bundle.inner_text() if bundle.count() else ''
    check('Jobs due show as one line, with when each is due', bundle.count() == 1 and re.search(r'\d jobs due', bt) and '2 today' in bt, attention(pg).inner_text()[:900])
    check('A bundle due today has no Not now', bundle.get_by_role('button', name=re.compile('^Not now')).count() == 0)
    bundle.get_by_role('button', name=re.compile(r'\d jobs due')).click(); pg.wait_for_timeout(200)
    t = bundle.inner_text()
    check('Tapping the bundle shows each job', 'Fix the crush gate' in t and 'Ring the AI man' in t, t)
    check('Overdue bill has no Not now', pg.get_by_role('button', name=re.compile('^Not now: Pay Local vet')).count() == 0)

    # A. Not now on information asks why and for how long
    more = attention(pg).get_by_role('button', name=re.compile(r'^Show \d+ more'))
    if more.count(): more.first.click(); pg.wait_for_timeout(200)
    nn = attention(pg).get_by_role('button', name=re.compile('^Not now: '))
    check('Information on Today has Not now', nn.count() >= 1, attention(pg).inner_text()[:1500])
    if nn.count():
        label = nn.first.get_attribute('aria-label').replace('Not now: ', '')
        nn.first.click(); pg.wait_for_timeout(300)
        sheet = pg.get_by_role('dialog', name='Not now')
        check('Not now asks why before putting it off', sheet.get_by_role('button', name='Put it off').is_disabled())
        sheet.get_by_role('button', name='Done it elsewhere').click()
        sheet.get_by_role('button', name='3 days').click()
        sheet.get_by_role('button', name='Put it off').click(); pg.wait_for_timeout(400)
        check('Put off for 3 days: gone from Today', label not in attention(pg).inner_text(), label)
        pg.reload(); pg.locator('main').first.wait_for(); pg.wait_for_timeout(600)
        more = attention(pg).get_by_role('button', name=re.compile(r'^Show \d+ more'))
        if more.count(): more.first.click(); pg.wait_for_timeout(200)
        check('Still put off after reopening', label not in attention(pg).inner_text(), label)
    # Opening a line counts as acted on
    pg.locator('[data-alert="forage"] a').first.click(); pg.wait_for_timeout(500)

    # A. Counts for the pilot in Settings
    go(pg, '#/settings')
    t = main_text(pg)
    table = pg.get_by_role('table', name='Alert counts')
    check('Settings shows alert counts for the pilot', 'Alert counts for the pilot' in t and table.count() == 1, t[:600])
    if table.count():
        tt = table.inner_text()
        check('Counts list the kinds shown, with put off reasons', 'Bills' in tt and 'Winter silage' in tt and 'done elsewhere 1' in tt, tt)
        silage = pg.locator('tr[data-kind="silage"] td')
        check('Opening an alert counts as acted on', silage.count() == 5 and silage.nth(2).inner_text().strip() == '1', tt)
    check('No sideways scroll in Settings', no_sideways(pg))
    pg.screenshot(path=f'{OUT}/board-settings.png', full_page=True)

    # B. Feed adjustment with a reason, then a stock check that's off asks why
    go(pg, '#/record/adjust')
    pg.get_by_text('Dairy nut 16%').first.click(); pg.wait_for_timeout(400)
    feed_url = pg.url.replace('/adjust', '')
    pg.get_by_role('button', name='Wasted or spoiled').click()
    pg.get_by_role('button', name='kg', exact=True).click()
    pg.get_by_label('How much to take off').fill('200')
    t = main_text(pg)
    check('Adjustment says the feeding plan stays as it is', 'Your feeding plan stays as it is' in t, t[-600:])
    pg.get_by_role('button', name='Save adjustment').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('History shows 200 kg taken off as wasted', 'Taken off: 200 kg' in t and 'Wasted or spoiled' in t, t[-1500:])
    rate = lambda txt: (re.search(r'([\d,.]+) kg a day', txt) or [None, ''])[1]
    plan_before = rate(t)
    pg.goto(feed_url + '/count'); pg.locator('main').first.wait_for(); pg.wait_for_timeout(400)
    pg.get_by_label('How much is there?').fill('0.3')
    why = pg.locator('[data-why-different]')
    check('A count well off the forecast asks why', why.count() == 1 and 'less than Agri-It expected' in why.inner_text(), main_text(pg)[:900])
    if why.count():
        why.get_by_role('button', name='Unplanned use: fed to another group').click()
    pg.get_by_role('button', name='Save count').click(); pg.wait_for_timeout(900)
    t = main_text(pg)
    check('Predicted vs counted shows the reason', 'Why: Unplanned use: fed to another group' in t, t[-2500:])
    check('and the adjustment taken into account', 'Taken into account:' in t and '200 kg wasted' in t, t[-2500:])
    check('Reasons given are tallied', 'Reasons given:' in t, t[-2500:])
    plan_after = rate(t)
    check('Feeding rate not changed by the count or the adjustment', plan_before and plan_before == plan_after, f'{plan_before} / {plan_after}')
    pg.screenshot(path=f'{OUT}/board-feed.png', full_page=True)

    # B. Fertiliser stock check that's off asks why; shows on Recorded vs checked
    go(pg, '#/fertiliser')
    pg.get_by_text('CAN (27% N)').first.click(); pg.wait_for_timeout(500)
    can_url = pg.url
    pg.get_by_role('button', name='Stock check').click()
    dlg = pg.get_by_role('dialog')
    dlg.get_by_label('In the shed now').fill('1')
    why = dlg.locator('[data-why-different]')
    check('Fertiliser check 400 kg short asks why', why.count() == 1 and '400 kg less' in why.inner_text(), dlg.inner_text()[:600])
    if why.count(): why.get_by_role('button', name='Counting error').click()
    dlg.get_by_role('button', name='Save stock check').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('Recorded vs checked shows expected, checked and why', 'Recorded vs checked' in t and 'expected 1.4 t, checked 1 t' in t and 'Why: Counting error' in t, t[:2500])

    # E. Fertiliser order, part delivery, still on order
    go(pg, '#/record/fertiliser-order')
    pg.get_by_role('button', name=re.compile(r'^CAN \(27% N\)')).click()
    pg.get_by_label('Quantity ordered').fill('4')
    pg.get_by_text("The supplier said when it's coming").click()
    pg.get_by_label('Expected').fill(TODAY)
    pg.get_by_label('Agreed price per tonne (optional)').fill('400')
    t = main_text(pg)
    check('Order says it is not a bill until delivered', '1,600' in t and "Not a bill until it's delivered" in t, t[-800:])
    pg.get_by_role('button', name='Save order').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('On order on the fertiliser screen, stock unchanged', 'ON ORDER' in t.upper() and '4 t still to come' in t and '1 t' in t, t[:1500])
    go(pg, '#/money/bills')
    t = main_text(pg)
    check('Bills lists the fertiliser on order, not as owed', 'On order (not billed yet)' in t and 'CAN (27% N), 4 t' in t, t[-1200:])
    go(pg, '#/')
    t = attention(pg).inner_text()
    check('Today asks if the CAN arrived (due today)', 'Did the CAN (27% N) arrive?' in t, t[:1200])
    pg.goto(can_url); pg.locator('main').first.wait_for(); pg.wait_for_timeout(400)
    pg.get_by_role('link', name='It arrived').first.click(); pg.wait_for_timeout(600)
    check('Delivery starts from the order: 4 t still to come', pg.get_by_label('Quantity').input_value() == '4000', pg.get_by_label('Quantity').input_value())
    pg.get_by_label('Quantity').fill('2000')
    check('Part delivery asks if more is coming', 'Is more coming? 2 t left on the order' in main_text(pg), main_text(pg)[:1500])
    pg.get_by_role('button', name='On account').click()
    check('Agreed price carried to the delivery', '€800.00 for this load' in main_text(pg), main_text(pg)[-1500:])
    pg.get_by_role('button', name='Save delivery').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('After half: 3 t in the shed, 2 t of 4 t still to come', '3 t' in t and '2 t still to come of 4 t' in t, t[:1500])
    go(pg, '#/record/invoice')
    t = main_text(pg)
    check('Invoice screen offers the fertiliser delivery', 'Fertiliser, delivered' in t and 'CAN (27% N), 2 t' in t, t[:2500])

    # E. Dashboard tile, only for a farm with fields or fertiliser
    go(pg, '#/')
    tile = pg.get_by_role('region', name='Fertiliser')
    check('Fertiliser tile shows stock and fields due', tile.count() == 1 and 'CAN (27% N)' in tile.inner_text() and ('fields due' in tile.inner_text().lower() or 'No fields due' in tile.inner_text()), tile.inner_text() if tile.count() else '')
    check('No sideways scroll on Today', no_sideways(pg))
    pg.screenshot(path=f'{OUT}/board-today.png', full_page=True)

    # C. Supplier recheck dates
    go(pg, '#/suppliers')
    pg.get_by_text('Tirlán', exact=False).first.click(); pg.wait_for_timeout(500)
    t = main_text(pg)
    check('Supplier screen shows verified and recheck by', re.search(r'Verified \d+ \w+ \d{4}\. Recheck by \d+ \w+ \d{4}', t) is not None, t[:900])
    go(pg, '#/suppliers')
    pg.get_by_text('Lakeland', exact=False).first.click(); pg.wait_for_timeout(500)
    t = main_text(pg)
    check('Lakeland stays not verified', 'Not verified' in t and 'blocks automated checks' in t, t[:1200])
    b.close()

for n, ok, d in results:
    print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else f'   <- {d[:500]}'))
passed = sum(1 for _, ok, _ in results if ok)
print(f'{passed}/{len(results)} checks passed. Console/page errors: {errors[:5]}')
sys.exit(0 if passed == len(results) and not errors else 1)
