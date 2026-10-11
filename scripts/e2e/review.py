"""Review fixes (Oct 2026) in the browser, against the demo build at phone size.

Bills (owed, overdue, pay, match an invoice), part deliveries, dated head counts and moving
animals, alerts that stay, jobs that move, the records vault, forecast inputs, settings.
Run: python3 scripts/e2e/review.py http://localhost:4331/ out/
"""
import re, sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
NUT = '50000000-0000-0000-0000-000000000001'
CALF = '50000000-0000-0000-0000-000000000002'
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(400)

def main_text(pg):
    return pg.locator('main').inner_text()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    try:
        # Fresh demo
        go(pg, '#/settings')
        pg.evaluate("localStorage.clear()"); go(pg, '#/')

        # 1. Today: overdue items first and never folded away
        t = main_text(pg)
        check('Today: Needs your attention with Overdue first', 'Needs your attention' in t and t.upper().index('OVERDUE') < t.upper().index('COMING UP'), t[:900])
        check('Overdue vet bill on Today', 'Pay Local vet: €685' in t, t[:900])
        check('Missed routines stay on Today', 'from earlier not ticked off' in t, t[:900])
        check('Overdue items have no hide button', pg.get_by_role('button', name=re.compile('Hide for a week: Pay Local vet')).count() == 0)

        # 2. Money: cash, owed, on order kept apart
        go(pg, '#/money')
        t = main_text(pg)
        check('Money shows Cash now, To pay, On order', all(x in t for x in ['Cash now', 'To pay', 'On order']), t[:500])
        check('To pay is the nut delivery plus the vet bill (€3,805)', '€3,805' in t, t[:500])
        check('On order is the 1 t of calf ration at the agreed €520/t', '€520' in t, t[:500])
        check('Loans kept out of running costs', 'on loans and capital' in t, t[:900])
        cash_before = re.search(r'Cash now\s*€([\d,]+)', t)

        # 3. Bills: pay the overdue vet bill, cash moves once
        go(pg, '#/money/bills')
        t = main_text(pg)
        check('Bills grouped by supplier, overdue flagged', 'Local vet' in t and 'Overdue since' in t and 'Tirlán FarmLife' in t, t[:800])
        check('Feed bought on account says the invoice is not matched yet', 'invoice not matched' in t, t[:800])
        pg.locator('li', has_text='Scanning and call-out').get_by_role('button', name='Pay').click()
        pg.get_by_role('dialog').get_by_role('button', name='Mark paid').click()
        pg.wait_for_timeout(600)
        check('Paid bill leaves the owed list', 'Scanning and call-out' not in pg.locator('section[aria-label="Local vet"]').all_inner_texts().__str__(), main_text(pg)[:600])
        check('Paid bill shows under paid in the last 30 days', 'Paid in the last 30 days' in main_text(pg))
        go(pg, '#/money')
        t = main_text(pg)
        cash_after = re.search(r'Cash now\s*€([\d,]+)', t)
        if cash_before and cash_after:
            before = int(cash_before.group(1).replace(',', '')); after = int(cash_after.group(1).replace(',', ''))
            check('Cash down by exactly the bill (€685)', before - after == 685, f'{before} -> {after}')
        else:
            check('Cash down by exactly the bill (€685)', False, t[:300])
        go(pg, '#/')
        check('Overdue bill gone from Today once paid', 'Pay Local vet' not in main_text(pg))

        # 4. Match the invoice to the delivery on account: no second cost
        go(pg, '#/record/invoice?supplier=10000000-0000-0000-0000-000000000001')
        t = main_text(pg)
        check('Invoice form lists deliveries without an invoice', 'Dairy nut 16%, 8 t' in t, t[:900])
        pg.get_by_label('Invoice no.').fill('T-5501')
        pg.get_by_label('Total, VAT in').fill('3100')
        pg.wait_for_timeout(300)
        t = main_text(pg)
        check('Invoice preview replaces the docket price, nothing added twice', 'becomes €3,100.00' in t and 'Nothing is added twice' in t, t[-700:])
        # Only the 8 t on account this time
        for row in pg.locator('label', has_text=re.compile(r'Dairy nut 16%, 8 t')).all():
            box = row.locator('input[type=checkbox]')
            if 'Docket €3,120.00' not in row.inner_text() and box.is_checked(): box.uncheck()
        pg.get_by_role('button', name='Match invoice').click()
        pg.wait_for_timeout(700)
        t = main_text(pg)
        check('Matched invoice: owed shows the invoice amount and number', 'inv. T-5501' in t and '€3,100.00' in t, t[:800])
        go(pg, '#/money/year-end')
        t = main_text(pg)
        check('Year-end shows paid out and still owed separately', 'Paid out in the year (cash)' in t and 'Still owed' in t, t[:1200])

        # 5. A part delivery leaves the order open
        go(pg, f'#/record/delivery?feed={CALF}')
        t = main_text(pg)
        check('Delivery form knows the order is part delivered', 'still to come' in t, t[:600])
        pg.locator('#qty').fill('0.4')
        pg.wait_for_timeout(300)
        t = main_text(pg)
        check('Asks whether more is coming', 'Is more coming?' in t, t[:900])
        check('Paid or on account offered when priced', 'On account' in t or 'Price' in t)
        pg.get_by_role('button', name='Save delivery').click()
        pg.wait_for_timeout(800)
        t = pg.locator('body').inner_text()
        check('Saved screen says what is still to come', '600 kg still to come on the order' in t, t[:900])
        go(pg, f'#/feed/{CALF}')
        t = main_text(pg)
        check('Feed page: 600 kg still to come on an order', '600 kg still to come on an order' in t, t[:900])
        pg.get_by_text('What this forecast is worked out from').click()
        t = main_text(pg)
        check('Forecast inputs: stock basis, animals, plan, delivery time, worked out time',
              all(x in t for x in ['Stock', 'Animals', 'Your feeding plan', 'Delivery time', 'Worked out', 'not counted until it arrives']), t[-1200:])

        # 6. Dated head counts and moving animals
        go(pg, '#/farm/groups')
        pg.get_by_role('button', name='Move animals between groups').click()
        dlg = pg.get_by_role('dialog')
        dlg.get_by_role('button', name=re.compile('^Dairy cows')).first.click()
        dlg.get_by_role('button', name=re.compile('^In-calf heifers')).last.click()
        dlg.get_by_role('button', name=re.compile('^Move')).last.click()
        pg.wait_for_timeout(700)
        t = main_text(pg)
        check('Move: cows 120 to 119, heifers 40 to 41', 'Dairy cows' in t and '119' in t and '41' in t, t[:900])
        check('Count history kept per group', 'Count history' in t)

        # 7. Jobs: move one, take one off
        go(pg, '#/farm/jobs')
        pg.get_by_role('button', name='Move or take off: Check silage pit cover').click()
        pg.get_by_role('dialog').get_by_role('button', name='No longer needed: take it off').click()
        pg.wait_for_timeout(500)
        check('A job can be taken off the list', 'Check silage pit cover' not in main_text(pg))

        # 8. Diary: a missed routine can be moved
        go(pg, '#/diary')
        t = main_text(pg)
        check('Diary keeps missed routines until dealt with', 'stays here until ticked, moved or skipped' in t, t[:1200])
        pg.locator('li', has_text='Loan repayment').get_by_role('button', name='Change').click()
        pg.get_by_role('dialog').get_by_role('button', name='Tomorrow').click()
        pg.wait_for_timeout(500)
        check('Moved routine leaves today\'s list', 'Loan repayment' not in pg.locator('main').inner_text().split('From earlier')[-1] if 'From earlier' in main_text(pg) else 'Loan repayment' not in main_text(pg))

        # 9. Records vault: search and the evidence note
        go(pg, '#/records')
        pg.get_by_label('Search records').fill('T-5501')
        pg.wait_for_timeout(300)
        t = main_text(pg)
        check('Records search finds the invoice by number', 'invoice T-5501' in t, t[-900:])
        check('Records say they are evidence, not an official register', 'not an official register' in t)

        # 10. Settings: alert days, people and history
        go(pg, '#/settings')
        t = main_text(pg)
        check('Settings: alert days', 'Warn before a bill is due' in t and 'Warn before the order-by date' in t)
        go(pg, '#/settings/people')
        t = main_text(pg)
        check('People explains roles (worker sees no money)', 'Farm worker' in t and 'Does not see money' in t, t[:600])
        go(pg, '#/settings/changes')
        t = main_text(pg)
        check('Change history shows who changed what', 'Changed:' in t and 'paid or owed' in t, t[:900])

        # 11. Cash what-if is labelled a scenario
        go(pg, '#/progress?tab=cash')
        pg.get_by_role('button', name=re.compile('Decrease Income')).first.click()
        pg.wait_for_timeout(300)
        t = main_text(pg)
        check('What-if is shown as a scenario', 'scenario' in t.lower() and 'Back to the forecast' in t, t[:900])
        pg.screenshot(path=f'{OUT}/review-cash-whatif.png', full_page=True)

        # 12. No sideways scroll on the new screens
        for h in ['#/money', '#/money/bills', '#/record/invoice', '#/settings/people', '#/settings/changes', '#/records', '#/farm/groups', '#/record/cost']:
            go(pg, h)
            w = pg.evaluate('document.documentElement.scrollWidth')
            check(f'No sideways scroll {h}', w <= 391, str(w))
    except Exception as e:  # report how far it got
        check('Script ran to the end', False, str(e).splitlines()[0])
    b.close()

for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'   <- {detail}'))
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} checks passed. Console/page errors: {errors}")
sys.exit(0 if all(r[1] for r in results) and not errors else 1)
