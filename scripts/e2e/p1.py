"""Reminders, supplier price history and budget alerts against the demo build (phone viewport).
Usage: python3 scripts/e2e/p1.py http://localhost:4331/ out/"""
import sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
NUT = '50000000-0000-0000-0000-000000000001'
TIRLAN = '10000000-0000-0000-0000-000000000001'
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(350)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # A. Reminders: nudge on Today, set a time, preview, calendar file
    go(pg, '#/')
    nudge = pg.get_by_role('link', name='Get a nudge at milking time to tick these off')
    check('Today suggests reminders', nudge.count() == 1)
    nudge.click()
    pg.wait_for_timeout(400)
    check('Nudge opens Settings at Reminders', '/settings' in pg.url and pg.get_by_text('Morning reminder').is_visible())
    pg.get_by_role('button', name='7am').click()
    pg.get_by_role('button', name='6pm').click()
    body = pg.locator('main').inner_text()
    check('Preview says when it goes off', 'it would say' in body and ('at 7am' in body or 'at 6pm' in body), body[:0])
    preview = pg.get_by_label('Preview of the reminder')
    check('Preview shows what is due', preview.count() == 1 and ('feeding tick' in preview.inner_text() or 'job' in preview.inner_text()), preview.inner_text() if preview.count() else '')
    check('Demo explains notifications need the installed app', 'work in the installed app' in body and 'preview only' in body)
    # Downloads are blocked inside the hosted demo page, so the calendar button only shows in the real app
    # (the .ics file itself is covered by src/lib/reminders.test.ts)
    check('Demo hides the calendar download', pg.get_by_role('button', name='Add to phone calendar').count() == 0)
    big = pg.evaluate("[...document.querySelectorAll('#reminders ~ section button, main button')].filter(b => b.offsetParent).every(b => b.getBoundingClientRect().height >= 44)")
    check('Reminder buttons are big enough to press', big)
    pg.screenshot(path=f'{OUT}/settings-reminders.png')
    pg.reload(); pg.locator('main').first.wait_for(); pg.wait_for_timeout(300)
    check('Reminder times kept on this phone', pg.get_by_role('button', name='7am').get_attribute('aria-pressed') == 'true')
    go(pg, '#/')
    check('Nudge gone once reminders are set', pg.get_by_role('link', name='Get a nudge at milking time to tick these off').count() == 0)
    check("Setting reminders recorded nothing", "0 of 3 ticked off" in pg.locator('main').inner_text())

    # B. Price history on the feed screen
    go(pg, f'#/feed/{NUT}')
    body = pg.locator('main').inner_text()
    check('Price paid card', 'Price paid' in body and '€390/t' in body and 'Average, last 12 months' in body, '')
    check('Change since last delivery (+€5/t)', 'about the same (+€5/t)' in body)
    check('Price by supplier (Tirlán and Dairygold)', 'Last price by supplier' in body and 'Dairygold Agri Business' in body and '€376/t' in body)
    check('Says prices are only what was paid', "never guesses a supplier's price" in body)
    bars = pg.get_by_role('img', name='Price per tonne for the last 6 deliveries, from €372/t to €390/t')
    check('Price chart has words for screen readers', bars.count() == 1)
    pg.get_by_text('Price paid').scroll_into_view_if_needed()
    pg.screenshot(path=f'{OUT}/feed-prices.png')

    # C. Supplier screen
    go(pg, f'#/suppliers/{TIRLAN}')
    body = pg.locator('main').inner_text()
    check("Supplier shows prices you've paid", "Prices you've paid" in body and 'Dairy nut 16%' in body and '€390/t' in body)

    # D. Delivery form: price check while typing, then the Saved screen says it
    go(pg, f'#/record/delivery?feed={NUT}')
    body = pg.locator('main').inner_text()
    check('Prefilled price flagged as same as last time', 'Same as your last delivery' in body)
    price = pg.get_by_label('Price per tonne')
    price.fill('410')
    pg.wait_for_timeout(200)
    body = pg.locator('main').inner_text()
    check('Dearer price flagged with € and %', 'up €20/t, 5.1%' in body and 'your last delivery from Tirlán FarmLife' in body, '')
    pg.screenshot(path=f'{OUT}/delivery-price.png')
    pg.get_by_role('button', name='Save delivery').click()
    pg.wait_for_timeout(800)
    body = pg.locator('body').inner_text()
    check('Saved screen notes the price rise', '€20/t more than last time' in body)
    go(pg, f'#/feed/{NUT}')
    body = pg.locator('main').inner_text()
    check('History picks up the new price', '€410/t' in body and 'up €20/t' in body)

    # E. Budget alerts
    go(pg, '#/money')
    body = pg.locator('main').inner_text()
    check('Money shows budget alert', 'Milk is behind budget' in body)
    check('Budget bars use completed months', 'Budget to end of' in body and 'so far:' in body)
    check('Alert and bars agree', body.count('behind') >= 2 and body.split('Milk is behind budget')[1].split('behind')[0].strip().startswith('€'))
    pg.screenshot(path=f'{OUT}/money-alerts.png', full_page=True)
    go(pg, '#/')
    check('Today lists the budget alert', 'Milk is behind budget' in pg.locator('main').inner_text())

    # F. Ask Agri-It about price
    go(pg, '#/ask')
    pg.get_by_role('button', name='What did I pay for meal?').click()
    pg.wait_for_timeout(400)
    body = pg.locator('main').inner_text()
    check('Ask answers price from deliveries', 'You last paid' in body or 'Last prices paid' in body, '')

    # G. No sideways scroll on the new screens
    for h in ['#/settings?section=reminders', f'#/feed/{NUT}', f'#/suppliers/{TIRLAN}', '#/money', f'#/record/delivery?feed={NUT}']:
        go(pg, h)
        check(f'No sideways scroll {h}', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
    b.close()

for name, ok, detail in results:
    print(('PASS' if ok else 'FAIL'), name, ('  <- ' + detail) if (detail and not ok) else '')
print(f"\n{sum(ok for _, ok, _ in results)}/{len(results)} checks passed. Console/page errors: {errors}")
sys.exit(0 if all(ok for _, ok, _ in results) and not errors else 1)
