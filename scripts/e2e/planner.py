"""Financial planner and setup (16 Oct 2026), in the browser against the demo build at phone size:
loans (owed, coming up with interest, a repayment, the bank's statement), scheme payments
(expected, "did it come in?"), the year plan (lines, sources, lowest point against the
overdraft), the budget month by month, bills every few months, the year-end pack for the
accountant, and the setup screens.

Run: python3 scripts/e2e/planner.py http://localhost:4331/ out/
"""
import re, sys
from datetime import date
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []
TODAY = date.today().isoformat()

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main, h1').first.wait_for(timeout=10000)
    pg.wait_for_timeout(500)

def main_text(pg):
    return pg.locator('body').inner_text()

def no_sideways(pg):
    return pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    go(pg, '#/')
    t = main_text(pg)
    check('Demo farm is set up: no setup card on the dashboard', 'Set up your farm' not in t, t[:600])

    # Money hub
    go(pg, '#/money')
    t = main_text(pg)
    check('Money lists the year plan, loans and scheme payments', all(x in t for x in ['Year plan', 'Loans and overdraft', 'Scheme payments']), t[:1500])
    check('Loans row: owed and the next repayment', '€38,000 owed' in t and 'Next €3,150' in t, t[:1500])

    # Loans
    go(pg, '#/money/loans')
    t = main_text(pg)
    check('Loans: hire purchase and the overdraft with its limit', 'Finance company · Hire purchase' in t and 'AIB · Overdraft' in t and '€25,000' in t, t[:1200])
    pg.get_by_text('Finance company · Hire purchase').click(); pg.wait_for_timeout(600)
    t = main_text(pg)
    check('Loan screen: owed, rate, and coming up with interest estimated', '€38,000' in t and '6.9%' in t and 'Coming up' in t and 'interest' in t, t[:1500])
    check('Loan screen has no bottom bar over its buttons', pg.get_by_role('navigation', name='Main').count() == 0)
    pg.get_by_role('button', name='Record one').click()
    pg.get_by_label('Of which interest (optional)').fill('620')
    pg.get_by_role('button', name='Save repayment').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('A recorded repayment with its interest, and the owed figure drops by the capital', '€620.00 interest' in t and '€35,470' in t, t[:1500])
    pg.get_by_role('button', name='Add', exact=True).click()
    pg.get_by_label('Owed on that day').fill('35400')
    pg.get_by_label('Interest charged in the period').fill('1310')
    pg.get_by_role('button', name='Save statement').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('Annual statement saved with balance and interest', '€35,400 owed' in t and '€1,310.00 interest' in t, t[-900:])
    check('No sideways scroll on the loan screen', no_sideways(pg))

    # Add a loan from Money
    go(pg, '#/money/loans/new')
    pg.get_by_role('button', name='Bank of Ireland').click()
    pg.get_by_label('How much is owed now?').fill('120000')
    pg.get_by_label('Interest rate (optional)').fill('4.5')
    pg.get_by_label('Repayment (optional)').fill('2600')
    pg.get_by_role('button', name='Every 3 months').click()
    pg.get_by_label('Next repayment').fill(TODAY)
    pg.get_by_role('button', name='Save this one').click(); pg.wait_for_timeout(900)
    t = main_text(pg)
    check('New loan opens on its own screen', 'Bank of Ireland' in t and '€120,000' in t, t[:800])

    # Ready to approve: the repayment due today is asked about, never recorded on its own
    go(pg, '#/')
    ready = pg.get_by_role('region', name='Ready for you to approve')
    t = ready.inner_text() if ready.count() else ''
    if 'Show' in t and 'more' in t:
        ready.get_by_role('button', name=re.compile('^Show \\d+ more')).click(); pg.wait_for_timeout(200); t = ready.inner_text()
    check('Dashboard asks if the Bank of Ireland repayment came out', 'Did the Bank of Ireland repayment come out?' in t and 'interest (estimate)' in t, t[:1500])
    ready.locator('li', has_text='Bank of Ireland').get_by_role('button', name='Yes, it came out').click(); pg.wait_for_timeout(800)
    t = pg.get_by_role('region', name='Ready for you to approve').inner_text() if pg.get_by_role('region', name='Ready for you to approve').count() else ''
    check('Approved repayment leaves the list', 'Bank of Ireland repayment' not in t, t[:800])

    # Scheme payments
    go(pg, '#/money/payments')
    t = main_text(pg)
    check('Scheme payments: two BISS payments expected', 'BISS and CRISS' in t and '€27,750' in t and '€9,250' in t, t[:1200])
    pg.get_by_role('button', name='€27,750').click(); pg.wait_for_timeout(400)
    pg.get_by_label('Amount that came in').fill('27600')
    pg.get_by_role('button', name='Yes, record it').click(); pg.wait_for_timeout(800)
    t = main_text(pg)
    check('It came in: moved to Came in, with the amount that actually arrived', 'Came in' in t and '€27,600' in t, t[-800:])
    pg.get_by_role('button', name='Add a scheme').click(); pg.wait_for_timeout(300)
    t = main_text(pg)
    check('Adding a scheme shows the Republic schemes with sources', 'ACRES' in t and 'ANC' in t, t[:1500])
    pg.get_by_role('button', name=re.compile('^ACRES')).click()
    pg.get_by_label(re.compile('What do you expect for')).fill('6000'); pg.wait_for_timeout(200)
    t = main_text(pg)
    check('ACRES: 85% advance in November, balance the next April, with its note', '€5,100.00' in t and '€900.00' in t and 'next April' in t and '2025 scheme year' in t, t[:2000])
    pg.get_by_role('button', name=re.compile('^Plan \\d payment')).click(); pg.wait_for_timeout(800)
    check('ACRES planned', 'ACRES' in main_text(pg))

    # Year plan
    go(pg, '#/money/plan')
    t = main_text(pg)
    check('Year plan: planned in and out, lowest point', 'Planned in' in t and 'Lowest point' in t, t[:1200])
    pg.get_by_role('button', name='By line').click(); pg.wait_for_timeout(300)
    t = main_text(pg)
    check('Year plan lines by Teagasc group: money in, farm costs, loans', 'Money in' in t and 'Farm costs' in t and 'Loans and leases' in t and 'Finance company' in t, t[:2000])
    pg.get_by_role('button', name='By month').click(); pg.wait_for_timeout(300)
    t = main_text(pg)
    check('This month open, with sources for each planned line', 'This month' in t and ('loan schedule' in t or 'repeat' in t or 'budget' in t), t[:2000])
    check('No sideways scroll on the year plan', no_sideways(pg))
    pg.screenshot(path=f'{OUT}/planner-year-plan.png', full_page=True)

    # Budget month by month
    go(pg, '#/money/budget')
    pg.get_by_role('button', name=re.compile('^Milk')).first.click(); pg.wait_for_timeout(300)
    t = main_text(pg)
    check('Budget: a line opens to 12 months', 'Same every month' in t and len(pg.get_by_label(re.compile('^Milk ')).all()) >= 12, t[:1200])
    pg.get_by_label(re.compile('^Milk ')).nth(5).fill('41000')
    pg.get_by_role('button', name='Save budget').click(); pg.wait_for_timeout(800)
    pg.get_by_role('button', name='Next year').click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name="Fill from last year's records").click(); pg.wait_for_timeout(300)
    if pg.get_by_label(re.compile('^Milk ')).count() == 0:
        pg.get_by_role('button', name=re.compile('^Milk')).first.click(); pg.wait_for_timeout(300)
    vals = [pg.get_by_label(re.compile('^Milk ')).nth(i).input_value() for i in range(12)]
    check('Next year\'s budget fills from this year\'s milk, month by month', sum(1 for v in vals if v) >= 6 and len(set(v for v in vals if v)) > 1, str(vals))
    check('No sideways scroll on the budget', no_sideways(pg))

    # Bills every few months
    go(pg, '#/routines/new')
    t = main_text(pg)
    has_months = 'How many months apart?' in t
    check('Routine form offers every 2, 3, 6 or 12 months', has_months, t[:1500])

    # Year-end pack
    go(pg, '#/money/year-end')
    t = main_text(pg)
    check('Year-end: loans with interest and where it came from', 'Loans' in t and 'Interest in the year' in t and 'Finance company' in t, t[:3000])
    check('Year-end: scheme payments received', 'Scheme payments received' in t and 'BISS and CRISS' in t, t[:3000])
    check('Year-end: livestock numbers start and end', 'Livestock numbers' in t and 'Dairy cows' in t, t[:3000])
    check('Year-end: what to gather for the accountant, with the herd number', 'what to gather' in t and 'P1234567' in t and 'VAT 58' in t, t[-2000:])
    check('Year-end: a loan without a statement is flagged', 'Bank of Ireland' in t and 'annual statement' in t.lower(), t[:2000])

    # Setup screens
    go(pg, '#/setup')
    t = main_text(pg)
    check('Setup: every stage listed, all done for the demo', 'Set up your farm' in t and 'All set up' in t and 'Loans and overdraft' in t, t[:1500])
    go(pg, '#/setup/bills')
    t = main_text(pg)
    check('A stage reopens to change things, with bill ideas', 'Bills that come regularly' in t and 'Farm insurance' in t and 'Household' in t, t[:1500])
    pg.get_by_role('button', name=re.compile('^Farm insurance')).click()
    pg.get_by_label('About how much each time?').fill('1800')
    t = main_text(pg)
    check('Insurance defaults to once a year', pg.get_by_role('button', name='Once a year').get_attribute('aria-pressed') == 'true', t[:800])
    pg.get_by_role('button', name='Add 1 bill').click(); pg.wait_for_timeout(1000)
    go(pg, '#/routines')
    t = main_text(pg)
    check('Insurance is a routine once a year', 'Farm insurance' in t and 'Once a year' in t, t[:1500])
    go(pg, '#/more')
    t = main_text(pg)
    check('More has Set up your farm, Year plan and Loans', all(x in t for x in ['Set up your farm', 'Year plan', 'Loans and overdraft']), t[:1500])
    b.close()

for n, ok, d in results:
    print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else f'   <- {d[:500]}'))
passed = sum(1 for _, ok, _ in results if ok)
print(f'{passed}/{len(results)} checks passed. Console/page errors: {errors[:5]}')
sys.exit(0 if passed == len(results) and not errors else 1)
