"""Fields, fertiliser stock and spreading, pick lists and the CSO comparison (14 Oct 2026),
in the browser against the demo build at phone size.

Demo farm: Co. Tipperary (Zone A), fields Paddock 1 to 3 (grazing, 21-day round) and Bottom
field (silage), CAN in stock 1.4 t (checked, delivered, spread twice), low level 1 t.
Run: python3 scripts/e2e/fertiliser.py http://localhost:4331/ out/
"""
import re, sys
from datetime import date
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(500)

def main_text(pg):
    return pg.locator('main').inner_text()

# Zone A is closed from 15 Sept to 26 Jan
md = date.today().strftime('%m-%d')
closed_today = md >= '09-15' or md <= '01-26'

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    go(pg, '#/')

    # More lists both screens
    go(pg, '#/more')
    t = main_text(pg)
    check('More has Fertiliser and spreading, and Fields', 'Fertiliser and spreading' in t and 'Fields' in t, t[:800])

    # Fertiliser overview: season from the statutory closed period, with its source folded away
    go(pg, '#/fertiliser')
    t = main_text(pg)
    check('Season card names the zone and says open or closed', 'ZONE A' in t.upper() and (('Closed until' in t) if closed_today else ('Open until' in t)), t[:600])
    check('Lime and straight potash are allowed all year', 'Lime and straight potash can be spread all year' in t)
    pg.get_by_text('Where these dates come from').click(); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Source and checked date are one tap away', 'Nitrates Explanatory Handbook' in t and 'Checked 14 Oct 2026' in t and 'S.I. No. 588 of 2025' in t, t[:1500])
    check('CAN shows 1.4 t in the shed', 'CAN (27% N)' in t and '1.4 t' in t)

    # Fields: add one with your own round
    go(pg, '#/farm/fields')
    pg.get_by_role('button', name='Add').first.click()
    dlg = pg.get_by_role('dialog')
    dlg.get_by_label('Field name').fill('Top field')
    dlg.get_by_label('Acres (optional)').fill('12')
    dlg.get_by_label('Spread again every (optional)').fill('28')
    dlg.get_by_role('button', name='Add field').click(); pg.wait_for_timeout(400)
    t = main_text(pg)
    check('A field is added with its acres and own round', 'Top field' in t and '12 ac' in t and 'every 28 days' in t, t[:900])
    check('Field total acres add up', '5 fields, 56.5 acres' in t, t[:300])

    # Spread on two fields at once: 1 bag (50 kg) an acre on 17.5 acres = 875 kg
    go(pg, '#/record/spread')
    t = main_text(pg)
    check('Spread form says when today is in the closed period' if closed_today else 'No closed-period warning while spreading is open',
          ('in the closed period for Zone A' in t) == closed_today, t[:700])
    pg.get_by_role('button', name=re.compile('^Paddock 1')).click()
    pg.get_by_role('button', name=re.compile('^Paddock 2')).click()
    pg.get_by_label('Bags per acre').fill('1')
    pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Total worked out from acres: 875 kg, 50 kg an acre', '875 kg of CAN (27% N), 50 kg an acre' in t, t[-900:])
    check('Shows the stock after spreading', 'In stock 1.4 t, 525 kg left after this' in t, t[-700:])
    check('Says it takes the stock to the low level', 'takes CAN (27% N) to your low level' in t, t[-700:])
    pg.get_by_role('button', name='Save spreading').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('Spreading saved and taken off the stock', '525 kg' in t and 'Paddock 1, Paddock 2' in t, t[:1400])
    go(pg, '#/')
    more = pg.get_by_role('button', name=re.compile(r'^Show \d+ more'))
    if more.count(): more.first.click(); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('Dashboard flags the low stock', 'Low on CAN (27% N): 525 kg left' in t, t[:1500])

    # Delivery on account: stock up, bill owed
    go(pg, '#/record/fertiliser')
    pg.get_by_role('button', name=re.compile(r'^CAN \(27% N\)')).click()
    pg.get_by_label('Quantity').fill('2')
    pg.get_by_label('Price per tonne').fill('540')
    pg.get_by_role('button', name='On account').click()
    t = main_text(pg)
    check('Delivery shows the load total and stock after', '€1,080.00 for this load' in t and '2.5 t after this' in t, t[:1500])
    pg.get_by_role('button', name='Save delivery').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('Stock after delivery is 2.5 t', '2.5 t' in t, t[:600])
    check('Last price paid shows from the bill', 'Last paid €540' in t, t[:1200])
    check('CSO comparison labelled national average, excl. VAT, not a quote', 'CSO average' in t and 'excluding VAT' in t and 'Not a quote' in t, t[:2000])
    go(pg, '#/money/bills')
    check('The fertiliser bill is in Bills to pay', '€1,080' in main_text(pg), main_text(pg)[:900])

    # Pick lists: a supplier's own products only for that supplier
    go(pg, '#/fertiliser/new')
    t = main_text(pg)
    check('Plain fertiliser names to pick from', all(x in t for x in ['CAN (27% N)', '18-6-12', '10-10-20', 'Ground limestone (lime)']), t[:1500])
    check('No supplier product names before a supplier is picked', 'Green Sward' not in t)
    pg.get_by_role('button', name='Brett Brothers').click(); pg.wait_for_timeout(200)
    check('Brett Brothers lists no product names, so none are shown for it', 'LISTED BY' not in main_text(pg).upper())
    pg.get_by_label('Other suppliers').select_option(label='Howard Farms'); pg.wait_for_timeout(300)
    t = main_text(pg)
    check("Howard Farms' own listed products come first for Howard Farms", t.upper().index('LISTED BY HOWARD FARMS') < t.upper().index('NITROGEN') and 'Green Sward 27-2.5-5' in t, t[:1500])
    pg.get_by_role('button', name='Green Sward 27-2.5-5').click(); pg.wait_for_timeout(200)
    check('Picking fills the name and says where it is listed', pg.get_by_label('What is it?').input_value() == 'Green Sward 27-2.5-5' and 'Listed by Howard Farms on its website, checked 14 Oct 2026' in main_text(pg))
    pg.get_by_label('In the shed').fill('1')
    pg.get_by_role('button', name='Add fertiliser').click(); pg.wait_for_timeout(800)
    t = pg.locator('body').inner_text()
    check('New fertiliser added with its stock', 'Green Sward 27-2.5-5' in t and '1 t' in t, t[:600])

    # Feed: say what kind it is, for the CSO comparison
    go(pg, '#/progress?tab=feed')
    pg.get_by_text('Dairy nut 16%').first.click(); pg.wait_for_timeout(800)
    pg.get_by_label('What kind of feed is it?').select_option(label='Dairy nuts 16 to 18% protein'); pg.wait_for_timeout(600)
    t = main_text(pg)
    check('Feed compared with the CSO dairy nut average', 'Your price against the CSO average' in t and 'CSO average,' in t and 'national average' in t, t[-2500:])

    # Bill: bedding and silage plastic to pick, no stock kept
    go(pg, '#/record/cost')
    pg.get_by_role('button', name='Other', exact=True).click(); pg.wait_for_timeout(200)
    pg.get_by_role('button', name='Bale wrap').click()
    check('Bulk items like bale wrap are a tap on the bill form', pg.get_by_label('Describe it').input_value() == 'Bale wrap')

    # Add screen offers spreading and fertiliser deliveries
    go(pg, '#/record')
    pg.get_by_role('tab', name='Everything').or_(pg.get_by_role('button', name='Everything')).first.click(); pg.wait_for_timeout(300)
    t = main_text(pg)
    check('Add offers Spread fertiliser and Fertiliser delivery', 'Spread fertiliser' in t and 'Fertiliser delivery' in t, t[:1500])
    pg.screenshot(path=f'{OUT}/fertiliser-add.png', full_page=True)
    b.close()

for n, ok, d in results:
    print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else f'   <- {d[:500]}'))
passed = sum(1 for _, ok, _ in results if ok)
print(f'{passed}/{len(results)} checks passed. Console/page errors: {errors[:5]}')
sys.exit(0 if passed == len(results) and not errors else 1)
