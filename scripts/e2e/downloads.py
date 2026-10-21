"""Report downloads (21 Oct 2026), in the phone build at phone size: click the real CSV and zip
buttons and read what lands. Every CSV must be a plain table (a header row, rows as wide as the
header, no title, notes or blank lines, totals present); the zip holds the same tables plus a
README that carries the basis and the gaps.

Run: python3 scripts/e2e/downloads.py file:///abs/path/dist-phone/index.html OUTDIR
"""
import csv, io, os, re, sys, zipfile
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
res, errs = [], []
def check(n, c, d=''): res.append((n, bool(c), d))

def rows_of(path):
    raw = open(path, 'rb').read()
    text = raw.decode('utf-8')
    return raw, text, list(csv.reader(io.StringIO(text.lstrip('﻿'))))

def plain(name, text, rows):
    check(f'{name}: no blank line', not any(l.strip() == '' for l in text.lstrip('﻿').split('\n')))
    check(f'{name}: every row as wide as the header', all(len(r) == len(rows[0]) for r in rows), str([len(r) for r in rows]))
    check(f'{name}: no title, stamp or notes', not re.search(r'statutory|Rule version|Generated|reports@|Management report|Basis', text), text[:300])
    check(f'{name}: no em dash', chr(0x2014) not in text)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(800)
    pg.get_by_label('Farm name').fill('Download Farm'); pg.select_option('#county', 'Tipperary')
    pg.get_by_role('button', name='Next').click()
    pg.get_by_role('button', name='Skip for now').click(); pg.wait_for_timeout(1500)
    # Two costs, one with a comma in the name, one that starts with a formula character
    for amount, to, kind in [('245.50', 'Clonmel Vets, Main St', 'Vet'), ('1200', '=SUM(A1)', 'Fert')]:
        pg.goto(URL + '#/record/cost'); pg.wait_for_timeout(800)
        pg.get_by_role('button', name=re.compile(kind)).first.click()
        pg.get_by_label('Amount').fill(amount)
        pg.get_by_label('Paid to').fill(to)
        pg.get_by_role('button', name='Save cost').click(); pg.wait_for_timeout(900)

    # --- Expenses report CSV
    pg.goto(URL + '#/reports/expenses'); pg.wait_for_timeout(1000)
    with pg.expect_download() as d: pg.get_by_role('button', name='CSV').click()
    dl = d.value; path = f'{OUT}/expenses.csv'; dl.save_as(path)
    check('Expenses file is named for the report and year', re.fullmatch(r'agri-it-expenses-\d{4}(-\d{2})?-accruals-to-date\.csv|agri-it-expenses-\d{4}(-\d{2})?-accruals\.csv', dl.suggested_filename), dl.suggested_filename)
    raw, text, rows = rows_of(path)
    check('Expenses file starts with a byte-order mark so Excel reads it as UTF-8', raw.startswith(b'\xef\xbb\xbf'))
    check('Expenses header row first', rows[0][:3] == ['Date', 'Type', 'Paid to'] and 'Amount (EUR)' in rows[0], str(rows[0]))
    plain('Expenses', text, rows)
    body = rows[1:]
    amt = rows[0].index('Amount (EUR)')
    lines = [r for r in body if r[1] != 'Total']
    check('Expenses: one line per cost and a total row', len(lines) == 2 and len(body) == 3, str(body))
    check('Expenses: the total row is the sum of the lines', abs(float(body[-1][amt]) - sum(float(r[amt]) for r in lines)) < 0.005 and abs(float(body[-1][amt]) - 1445.50) < 0.005, str(body[-1]))
    check('Expenses: a name with a comma stays in one cell', any(r[2] == 'Clonmel Vets, Main St' for r in lines), str(lines))
    check('Expenses: a formula in a name is made safe', any(r[2] == "'=SUM(A1)" for r in lines), str(lines))

    # --- Profit report CSV (basis in the file name)
    pg.goto(URL + '#/reports/profit'); pg.wait_for_timeout(1000)
    with pg.expect_download() as d: pg.get_by_role('button', name='CSV').click()
    dl = d.value; path = f'{OUT}/profit.csv'; dl.save_as(path)
    check('Profit file name carries the basis', '-accruals' in dl.suggested_filename, dl.suggested_filename)
    raw, text, rows = rows_of(path)
    check('Profit header row', rows[0] == ['Section', 'Line', 'Row', 'Amount (EUR)', 'Records'], str(rows[0]))
    plain('Profit', text, rows)
    check('Profit has its total rows', {'Total output', 'Gross margin (output less direct costs)', 'Profit before depreciation and capital allowances'} <= {r[1] for r in rows}, str([r[1] for r in rows]))
    pg.goto(URL + '#/reports/profit'); pg.wait_for_timeout(600)
    pg.get_by_role('button', name=re.compile('^Cash')).click(); pg.wait_for_timeout(500)
    with pg.expect_download() as d: pg.get_by_role('button', name='CSV').click()
    check('Cash-basis profit file says cash in its name', '-cash' in d.value.suggested_filename, d.value.suggested_filename)

    # --- The screen still carries the basis and rule (it is not in the file)
    t = pg.locator('body').inner_text()
    check('Screen still states basis, rule version and not-statutory', 'Rule reports@1.0' in t and 'tatutory accounts' in t, t[-500:])

    # --- Accountant pack zip
    pg.goto(URL + '#/money/year-end'); pg.wait_for_timeout(1000)
    with pg.expect_download(timeout=60000) as d: pg.get_by_role('button', name=re.compile('^Accountant pack')).click()
    zpath = f'{OUT}/pack.zip'; d.value.save_as(zpath)
    z = zipfile.ZipFile(zpath); names = z.namelist()
    check('Zip holds summary, transactions, records, README and eight report tables', {'summary.csv', 'transactions.csv', 'records.csv', 'README.txt'} <= set(names) and len([n for n in names if n.startswith('reports/') and n.endswith('.csv')]) == 8, str(names))
    for n in [n for n in names if n.endswith('.csv')]:
        text = z.read(n).decode('utf-8')
        rr = list(csv.reader(io.StringIO(text.lstrip('﻿'))))
        plain(n, text, rr)
    tx = list(csv.reader(io.StringIO(z.read('transactions.csv').decode('utf-8').lstrip('﻿'))))
    check('Transactions: the total rows are as wide as the header', all(len(r) == len(tx[0]) for r in tx))
    readme = z.read('README.txt').decode('utf-8')
    check('README carries the basis, the gaps and the not-statutory wording', 'THE REPORTS: BASIS AND GAPS' in readme and 'Basis:' in readme and 'statutory accounts' in readme and 'MISSING DATA' in readme, readme[:800])
    check('README has no em dash', chr(0x2014) not in readme)
    b.close()

fails = [r for r in res if not r[1]]
for n, ok, dd in res: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else '  :: ' + str(dd)[:300]))
print(f'\n{len(res) - len(fails)}/{len(res)} passed; page errors: {errs}')
sys.exit(1 if fails or errs else 0)
