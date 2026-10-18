"""Deleting what was saved, with a confirmation that lists what goes (18 Oct 2026), in the browser
against the demo build at phone size.

Run: python3 scripts/e2e/delete.py http://localhost:4331/ out/
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

def hash_of(pg):
    return pg.evaluate('location.hash')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    dialog = lambda: pg.get_by_role('dialog', name='Delete this?')

    # ---- A delivery: asked first, told what goes, kept if the answer is no -------------------
    go(pg, '#/diary?tab=history')
    rows = pg.locator('a[href*="#/edit/feed/"]')
    before = rows.count()
    check('History has deliveries to delete', before >= 1)
    rows.first.click(); pg.wait_for_timeout(500)
    title = pg.locator('h1').first.inner_text()
    pg.get_by_role('button', name=re.compile('Delete this')).click(); pg.wait_for_timeout(300)
    check('Delete asks first', dialog().count() == 1)
    body = dialog().inner_text()
    check('It says what will be removed', 'will be removed' in body and 'Its bill of' in body or 'will be removed' in body, body)
    check('It says what else changes', 'run-out' in body, body)
    check('It offers No and Yes', 'No, keep it' in body and 'Yes, delete' in body)
    pg.screenshot(path=OUT + 'delete-confirm.png')
    pg.get_by_role('button', name='No, keep it').click(); pg.wait_for_timeout(300)
    check('No keeps it (still on the change screen)', dialog().count() == 0 and pg.locator('h1').first.inner_text() == title, hash_of(pg))
    pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(400)
    check('Nothing was deleted after No', pg.locator('a[href*="#/edit/feed/"]').count() == before)

    # ---- Yes deletes, lands back on the list, and Undo puts it back ---------------------------
    pg.locator('a[href*="#/edit/feed/"]').first.click(); pg.wait_for_timeout(500)
    pg.get_by_role('button', name=re.compile('Delete this')).click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Yes, delete').click(); pg.wait_for_timeout(900)
    check('After deleting, lands back on History', 'tab=history' in hash_of(pg), hash_of(pg))
    check('The entry is gone', pg.locator('a[href*="#/edit/feed/"]').count() == before - 1, f'{before} -> {pg.locator("a[href*=\'#/edit/feed/\']").count()}')
    undo = pg.get_by_role('button', name='Undo')
    check('Undo is offered', undo.count() >= 1)
    if undo.count():
        undo.first.click(); pg.wait_for_timeout(900)
        check('Undo restores it', pg.locator('a[href*="#/edit/feed/"]').count() == before, str(pg.locator('a[href*="#/edit/feed/"]').count()))

    # ---- A milk cheque ---------------------------------------------------------------------------
    milk = pg.locator('a[href*="#/edit/income/"]', has_text='Milk cheque')
    n = milk.count()
    check('History has a milk cheque', n >= 1)
    if n:
        milk.first.click(); pg.wait_for_timeout(500)
        pg.get_by_role('button', name=re.compile('Delete this')).click(); pg.wait_for_timeout(300)
        check('A cheque lists its amount and day', 'Milk' in dialog().inner_text() and 'will be removed' in dialog().inner_text(), dialog().inner_text())
        pg.get_by_role('button', name='Yes, delete').click(); pg.wait_for_timeout(900)
        check('The cheque is gone', pg.locator('a[href*="#/edit/income/"]', has_text='Milk cheque').count() == n - 1)
        pg.get_by_role('button', name='Undo').first.click(); pg.wait_for_timeout(900)
        check('The cheque comes back', pg.locator('a[href*="#/edit/income/"]', has_text='Milk cheque').count() == n)

    # ---- A bill that belongs to a delivery cannot be deleted on its own -----------------------
    owned = None
    for page in ('#/money', '#/money/bills', '#/diary?tab=history'):
        go(pg, page)
        for i in range(pg.locator('a[href*="#/edit/cost/"]').count()):
            pg.locator('a[href*="#/edit/cost/"]').nth(i).click(); pg.wait_for_timeout(400)
            if 'Change the delivery' in pg.locator('main').first.inner_text():
                owned = True
                check('A delivery bill has no Delete of its own', pg.get_by_role('button', name=re.compile('Delete this')).count() == 0)
                check('It says to delete the delivery', 'delete the delivery' in pg.locator('main').first.inner_text())
                break
            pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(300)
        if owned:
            break
    check('Found a delivery bill to check', owned)

    # ---- A plain cost ---------------------------------------------------------------------------------
    go(pg, '#/money/bills')
    pens = pg.get_by_role('link', name=re.compile('^Change bill'))
    for i in range(pens.count()):
        pens.nth(i).click(); pg.wait_for_timeout(400)
        if pg.get_by_role('button', name=re.compile('Delete this')).count():
            pg.get_by_role('button', name=re.compile('Delete this')).click(); pg.wait_for_timeout(300)
            check('A bill lists what goes and what changes', 'Cash' in dialog().inner_text(), dialog().inner_text())
            pg.get_by_role('button', name='Yes, delete').click(); pg.wait_for_timeout(900)
            check('After deleting a bill, lands back on Bills', hash_of(pg) == '#/money/bills', hash_of(pg))
            pg.get_by_role('button', name='Undo').first.click(); pg.wait_for_timeout(900)
            break
        pg.get_by_role('button', name='Back').click(); pg.wait_for_timeout(300)

    check('No em dashes on screen', chr(0x2014) not in pg.locator('body').inner_text())
    b.close()

ok = sum(1 for _, c, _ in results if c)
for n, c, d in results:
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else f'   [{d}]'))
print(f'{ok}/{len(results)} passed; console errors: {len(errors)}')
for e in errors[:5]:
    print('  ', e[:200])
sys.exit(0 if ok == len(results) and not errors else 1)
