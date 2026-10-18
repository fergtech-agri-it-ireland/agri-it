"""Editing what was saved, and Back landing on the previous screen (18 Oct 2026), in the browser
against the demo build at phone size.

Run: python3 scripts/e2e/edit.py http://localhost:4331/ out/
"""
import re, sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(500)

def text(pg):
    return pg.locator('main').first.inner_text()

def hash_of(pg):
    return pg.evaluate('location.hash')

def num_field(pg, label):
    return pg.get_by_label(label, exact=False).first

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # ---- Back lands on the screen you came from -------------------------------------------
    go(pg, '#/more')
    pg.get_by_role('link', name=re.compile('Silage')).first.click(); pg.wait_for_timeout(400)
    check('Silage opens from More', 'Silage and bales' in pg.locator('h1').first.inner_text(), hash_of(pg))
    pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(400)
    check('Back from Silage returns to More', hash_of(pg) == '#/more', hash_of(pg))

    go(pg, '#/')
    pg.get_by_role('link', name=re.compile('Cash')).first.click(); pg.wait_for_timeout(500)
    from_today = hash_of(pg)
    pg.get_by_role('link', name=re.compile('bills owed')).first.click(); pg.wait_for_timeout(500)
    check('Bills opens from Progress', 'Bills to pay' in pg.locator('h1').first.inner_text(), hash_of(pg))
    pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(400)
    check('Back from Bills returns to where it was opened', hash_of(pg) == from_today, f'{hash_of(pg)} vs {from_today}')

    # Opened directly (no history): falls back to its parent, not a dead end
    go(pg, '#/money/bills')
    pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(400)
    check('Back on a screen opened directly goes to its parent', hash_of(pg) == '#/money', hash_of(pg))

    # ---- Edit a delivery: the quantity and price, and its bill moves with it --------------
    go(pg, '#/diary?tab=history')
    row = pg.locator('a[href*="#/edit/feed/"]').first
    check('History has a delivery to change', row.count() == 1)
    row.click(); pg.wait_for_timeout(500)
    check('Delivery opens the change screen', pg.locator('h1').first.inner_text() == 'Change a delivery', pg.locator('h1').first.inner_text())
    before_url = hash_of(pg)
    price = pg.get_by_label('Price per tonne')
    check('Price is shown for the delivery', price.count() == 1)
    old_price = float(price.input_value() or 0)
    price.fill(str(old_price + 10))
    pg.get_by_role('button', name='Save changes').click(); pg.wait_for_timeout(800)
    check('After saving, lands back on History', hash_of(pg).startswith('#/diary') and 'tab=history' in hash_of(pg), hash_of(pg))
    row.click(); pg.wait_for_timeout(500)
    check('The new price was kept', abs(float(pg.get_by_label('Price per tonne').input_value()) - (old_price + 10)) < 0.01, pg.get_by_label('Price per tonne').input_value())
    # kg too
    check('No sideways scroll on the change screen', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
    qty = pg.get_by_label('How much came', exact=False)
    check('Quantity can be changed', qty.count() >= 1)
    old_kg = float(qty.input_value())
    pg.get_by_role('button', name='kg', exact=True).click()
    pg.get_by_label('How much came', exact=False).fill(str(int(old_kg * 1000) - 500))
    pg.get_by_role('button', name='Save changes').click(); pg.wait_for_timeout(800)
    row.click(); pg.wait_for_timeout(500)
    now_t = float(pg.get_by_label('How much came', exact=False).input_value())
    check('The new quantity was kept', abs(now_t - (old_kg - 0.5)) < 0.001, f'{old_kg} -> {now_t}')
    pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(400)
    check('Back from the change screen returns to History', 'tab=history' in hash_of(pg), hash_of(pg))

    # ---- Edit a bill from Bills to pay -----------------------------------------------------
    go(pg, '#/money/bills')
    pen = pg.get_by_role('link', name=re.compile('^Change bill')).first
    check('Each bill has a Change pencil', pen.count() == 1)
    if pen.count():
        pen.click(); pg.wait_for_timeout(500)
        t = pg.locator('h1').first.inner_text()
        check('Bill opens the change screen', 'Change a' in t, t)
        amt = pg.get_by_label('Amount', exact=True)
        if amt.count():
            old = float(amt.input_value())
            amt.fill(str(old + 25))
            pg.get_by_role('button', name='Save changes').click(); pg.wait_for_timeout(800)
            check('After saving a bill, lands back on Bills', hash_of(pg) == '#/money/bills', hash_of(pg))
            check('The new amount shows on the bill', f'{int(old + 25):,}' in text(pg).replace(' ', ''), text(pg)[:500])
        else:
            check('Bill amount is a field (delivery bills edit through the delivery)', 'Change the delivery' in pg.locator('main').first.inner_text())

    # ---- Edit a cost and income from the diary ---------------------------------------------
    go(pg, '#/diary?tab=history')
    out = pg.locator('a[href*="#/edit/cost/"]').first
    if out.count():
        out.click(); pg.wait_for_timeout(500)
        check('A cost opens the change screen', 'Change a' in pg.locator('h1').first.inner_text(), pg.locator('h1').first.inner_text())
        check('Cost can be marked paid or owed', pg.get_by_text('Paid yet?').count() == 1)
        pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(300)
    milk = pg.locator('a[href*="#/edit/income/"]', has_text='Milk cheque').first
    check('History has a milk cheque to change', milk.count() == 1)
    if milk.count():
        milk.click(); pg.wait_for_timeout(500)
        check('Milk cheque opens the change screen', pg.locator('h1').first.inner_text() == 'Change a milk cheque', pg.locator('h1').first.inner_text())
        a = pg.get_by_label('Amount received')
        old = float(a.input_value()); a.fill(str(old + 100))
        lit = pg.get_by_label('Litres (optional)')
        check('Litres can be changed', lit.count() == 1)
        pg.get_by_role('button', name='Save changes').click(); pg.wait_for_timeout(800)
        check('After saving a cheque, lands back on History', 'tab=history' in hash_of(pg), hash_of(pg))

    # ---- Undo puts the old value back ---------------------------------------------------------
    milk = pg.locator('a[href*="#/edit/income/"]', has_text='Milk cheque').first
    if milk.count():
        milk.click(); pg.wait_for_timeout(500)
        a = pg.get_by_label('Amount received'); keep = a.input_value()
        a.fill(str(float(keep) + 7))
        pg.get_by_role('button', name='Save changes').click(); pg.wait_for_timeout(500)
        undo = pg.get_by_role('button', name='Undo')
        check('Undo is offered after a change', undo.count() >= 1)
        if undo.count():
            undo.first.click(); pg.wait_for_timeout(800)
            milk.click(); pg.wait_for_timeout(500)
            check('Undo restores the old amount', pg.get_by_label('Amount received').input_value() == keep, pg.get_by_label('Amount received').input_value() + ' vs ' + keep)
            pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(300)

    # ---- Feed page history rows carry a pencil, fertiliser and jobs too ---------------------
    go(pg, '#/')
    pg.get_by_role('link', name=re.compile('Dairy nut|Calf ration')).first.click(); pg.wait_for_timeout(600)
    check('Feed history rows have a Change pencil', pg.get_by_role('link', name=re.compile('^Change ')).count() >= 1)
    go(pg, '#/farm/jobs')
    check('Jobs have a Change pencil', pg.get_by_role('link', name=re.compile('^Change job')).count() >= 1 or 'Nothing to do' in text(pg))
    go(pg, '#/edit/feed/does-not-exist')
    check('A missing record shows a calm message', "isn't here" in text(pg), text(pg))
    check('No em dashes on screen', '—' not in pg.locator('body').inner_text())
    pg.screenshot(path=OUT + 'edit.png')
    b.close()

ok = sum(1 for _, c, _ in results if c)
for n, c, d in results:
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else f'   [{d}]'))
print(f'{ok}/{len(results)} passed; console errors: {len(errors)}')
for e in errors[:5]:
    print('  ', e[:200])
sys.exit(0 if ok == len(results) and not errors else 1)
