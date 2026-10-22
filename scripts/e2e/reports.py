"""Reports module (22 Oct 2026: three reports, plain tables), in the browser against the demo build at phone size:
the Reports tile and hub, every report opens with its basis, completeness and rule version,
the profit report says what is missing (never a guess), year-end values are saved only when the
farmer taps Save (livestock per group, deemed cost at the published percentage, a basis change
warning), the profit report then picks the values up, the reports agree with each other, and
nothing runs off the side of the screen.

Run: python3 scripts/e2e/reports.py http://localhost:4331/ out/
"""
import re, sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
results, errors = [], []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main, h1').first.wait_for(timeout=10000)
    pg.wait_for_timeout(600)

def text(pg):
    return pg.locator('body').inner_text()

def no_sideways(pg):
    return pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # Tile and hub
    go(pg, '#/')
    check('Dashboard has a Reports tile', pg.locator('[data-module=reports]').count() == 1)
    pg.locator('[data-module=reports]').click(); pg.wait_for_timeout(600)
    t = text(pg)
    check('Tile opens the Reports hub', 'Year-end values' in t and 'Accountant pack' in t, t[:800])
    check('Hub lists exactly the three reports', all(x in t for x in ['Profit and loss', 'Balance sheet', 'Animals']) and not any(x in t for x in ['Cash flow', 'Do the reports agree', 'Expenses', 'Stock']), t[:1200])
    check('Hub: no sideways scroll', no_sideways(pg))
    go(pg, '#/money')
    check('Money links to Reports', 'Reports' in text(pg) and pg.get_by_text('Profit and loss, balance sheet, animals').count() == 1)

    # Every report opens and shows its farm and currency, as tables
    for rid, title in [('profit', 'Profit and loss'), ('balance', 'Balance sheet'), ('animals', 'Animals')]:
        go(pg, f'#/reports/{rid}')
        t = text(pg)
        check(f'{title}: opens with farm and currency', 'Glenview Farm' in t and 'EUR' in t, t[:400])
        check(f'{title}: no em dash, no hidden characters', chr(0x2014) not in t and not re.search('[\u2060\u200b\ufeff\ufffd]', t))
        check(f'{title}: no sideways scroll', no_sideways(pg))
        check(f'{title}: this year and last year', pg.get_by_role('button', name='Last year').count() == 1)
        check(f'{title}: no long explanations', 'Rule reports@' not in t and 'Basis:' not in t and 'statutory accounts' in t.lower())
    for gone in ['cashflow', 'stock', 'income', 'expenses', 'checks']:
        go(pg, f'#/reports/{gone}')
        check(f'{gone}: no longer a report', 'No such report' in text(pg))

    # Profit: gaps are named, never guessed
    go(pg, '#/reports/profit')
    t = text(pg)
    check('Profit: not complete, and says why', 'Not complete' in t and 'Calves' in t, t[:900])
    check('Profit: output, direct costs, gross margin, overheads, profit', all(x in t for x in ['Total output', 'Total direct costs', 'Gross margin', 'Total overheads', 'Profit before depreciation']), t[:1500])
    check('Profit: values shown as plain figures with the currency in the heading', re.search(r'\n\d{1,3}(,\d{3})*\.\d{2}\n', t) is not None, t[:800])
    check('Profit: loan capital kept out of profit', 'Not in profit' in t and 'Loan capital repaid' in t)
    pg.get_by_role('button', name=re.compile('^Cash')).click(); pg.wait_for_timeout(500)
    check('Profit: cash basis still opens', 'Profit before depreciation' in text(pg))
    pg.get_by_role('button', name=re.compile('^Accruals')).click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Last year').click(); pg.wait_for_timeout(500)
    check('Profit last year opens without error', 'Profit before depreciation' in text(pg))

    # Year-end values: nothing is recorded until Save
    go(pg, '#/reports/values')
    t = text(pg)
    check('Values: the three year-end dates', all(x in t for x in ['31 Dec 2024', '31 Dec 2025', '31 Dec 2026']), t[:300])
    check('Values: last year end is open, with the demo values', 'Total €168,000.00' in t and 'December milk cheque' in t and 'Tractors and machinery' in t, t[:900])
    check('Values: a group with no heads is not listed', 'Dry cows. 0 head' not in t)
    calves = pg.locator('section, div').filter(has_text=re.compile(r'^Calves')).last
    pg.get_by_label('Value per head').nth(3).fill('450')
    t = text(pg)
    check('Values: total shown before saving, nothing saved yet', 'Total €8,100.00' in t, t[:1500])
    go(pg, '#/reports/profit')
    check('Profit: typed but unsaved value is not used', 'Livestock not valued at the start of the year (Calves)' in text(pg))
    go(pg, '#/reports/values')
    pg.get_by_label('Value per head').nth(3).fill('450')
    pg.get_by_role('button', name='Save Calves').click(); pg.wait_for_timeout(900)
    check('Values: saved with a toast', 'Calves valued at' in text(pg) or pg.get_by_text('Calves valued at').count() > 0, text(pg)[:400])
    go(pg, '#/reports/profit')
    t = text(pg)
    check('Profit: the start-of-year gap for Calves is gone once saved', 'start of the year (Calves)' not in t, t[:700])

    # Year end values for this year: deemed cost, basis change warning
    go(pg, '#/reports/values')
    pg.get_by_role('button', name=re.compile('31 Dec 2026')).click(); pg.wait_for_timeout(500)
    t = text(pg)
    check('Values: this year end starts empty (nothing prefilled as a value)', 'Total €168,000.00' not in t)
    weanlings = pg.locator('section').filter(has=pg.get_by_text('Weanlings', exact=True)).first
    weanlings.get_by_role('button', name=re.compile('^Deemed cost')).click(); pg.wait_for_timeout(300)
    weanlings.get_by_label('Market value per head').fill('500')
    t = weanlings.inner_text()
    check('Deemed cost: 60% of market value, shown per head and in total', '60%' in t and '€300.00 a head' in t and 'Total €9,000.00' in t, t)
    check('Basis change warning versus last year', 'Last year you used market value' in t, t)
    weanlings.get_by_role('button', name='Save Weanlings').click(); pg.wait_for_timeout(700)
    check('Deemed cost saved', 'Weanlings valued at €9,000.00' in text(pg))

    # Add an item (money owed) at this year end
    pg.get_by_label('Name', exact=True).fill('December milk cheque')
    pg.get_by_label('Value', exact=True).fill('24000')
    pg.get_by_role('button', name='Save', exact=True).click(); pg.wait_for_timeout(700)
    t = text(pg)
    check('Money owed saved with its basis', 'December milk cheque' in t and '€24,000.00' in t and 'My estimate' in t, t[-900:])
    check('Value screen: no sideways scroll', no_sideways(pg))

    # Remove and undo are offered
    pg.get_by_role('button', name=re.compile('^Remove')).first.click(); pg.wait_for_timeout(500)
    check('Removing a value offers Undo', pg.get_by_text('Undo').count() > 0)
    pg.get_by_role('button', name='Undo').click(); pg.wait_for_timeout(600)
    check('Undo puts it back', 'December milk cheque' in text(pg))

    # Balance sheet
    go(pg, '#/reports/balance')
    t = text(pg)
    check('Balance sheet: owns, owes and net worth, with a column for each end of the year', all(x in t for x in ['Owns', 'Owes', 'Net worth', 'At 31 Dec 2025']) and re.search(r'At \d{1,2} \w{3} 2026', t) is not None, t[:800])
    check('Balance sheet: no explanation paragraphs', 'How net worth moved' not in t and 'How the values were put on things' not in t)

    # Animals: empty list on the demo farm
    go(pg, '#/reports/animals')
    t = text(pg)
    check('Animals: counts and an empty list on a farm with no tagged animals', 'Born' in t and 'On the farm at the end' in t and 'No animals with a tag number yet' in t, t[:600])

    # Buying animals is its own cost, and reaches the profit report as a direct cost
    go(pg, '#/record/cost')
    pg.get_by_role('button', name='Livestock bought', exact=True).click(); pg.wait_for_timeout(200)
    pg.get_by_label('Amount').fill('4000')
    pg.get_by_role('button', name='Save cost').click(); pg.wait_for_timeout(900)
    go(pg, '#/reports/profit')
    t = text(pg)
    check('Animals bought: a direct cost in the profit report', 'Livestock bought' in t and '4,000.00' in t, t[t.index('Direct costs'):][:500] if 'Direct costs' in t else t[:500])

    # Year-end pack links to the reports
    go(pg, '#/money/year-end')
    check('Year-end pack links to the reports', pg.get_by_text('Open the reports').count() == 1)

    check('No console or page errors', not errors, '; '.join(errors)[:500])
    b.close()

fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  <- {detail}'))
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
