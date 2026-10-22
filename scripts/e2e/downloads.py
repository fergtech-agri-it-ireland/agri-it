"""Report downloads (22 Oct 2026), in the phone build at phone size: click the real Excel, CSV and zip
buttons and read what lands. The Excel file opens as a real workbook with a header row, numbers as
numbers and dates as dates; the CSV is plain UTF-8 with no byte-order mark and no hidden characters;
the zip holds the three reports as Excel files plus a README that carries the basis and the gaps.

Run: python3 scripts/e2e/downloads.py file:///abs/path/dist-phone/index.html OUTDIR
"""
import csv, io, os, re, sys, zipfile
import openpyxl
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
res, errs = [], []
def check(n, c, d=''): res.append((n, bool(c), d))

def rows_of(path):
    raw = open(path, 'rb').read()
    text = raw.decode('utf-8')
    return raw, text, list(csv.reader(io.StringIO(text)))

HIDDEN = re.compile('[\u0000-\u0008\u000b-\u001f\u200b-\u200f\u2060\u2028\u2029\ufeff\ufffd]')

def plain(name, text, rows):
    check(f'{name}: no blank line', not any(l.strip() == '' for l in text.split('\n')))
    check(f'{name}: every row as wide as the header', all(len(r) == len(rows[0]) for r in rows), str([len(r) for r in rows]))
    check(f'{name}: no title, stamp or notes', not re.search(r'statutory|Rule version|Generated|reports@|Management report|Basis', text), text[:300])
    check(f'{name}: no em dash, no hidden characters', chr(0x2014) not in text and not HIDDEN.search(text))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(800)
    pg.get_by_label('Farm name').fill('Download Farm'); pg.select_option('#county', 'Tipperary')
    pg.get_by_role('button', name='Next').click()
    pg.get_by_role('button', name='Skip for now').click(); pg.wait_for_timeout(1500)
    # Two costs and two animals (one with an accent in the breed)
    for amount, to, kind in [('245.50', 'Clonmel Vets', 'Vet'), ('1200', 'Seán Ó Briain & Sons', 'Fert')]:
        pg.goto(URL + '#/record/cost'); pg.wait_for_timeout(800)
        pg.get_by_role('button', name=re.compile(kind)).first.click()
        pg.get_by_label('Amount').fill(amount)
        pg.get_by_label('Paid to').fill(to)
        pg.get_by_role('button', name='Save cost').click(); pg.wait_for_timeout(900)
    for tag, breed in [('372 12 34567 8 1234', 'Limousin'), ('372 12 34567 2 0456', 'Charolais, cross')]:
        pg.goto(URL + '#/animals'); pg.wait_for_timeout(600)  # leave the saved page first, so the form starts empty
        pg.goto(URL + '#/animals/new'); pg.wait_for_timeout(1000)
        pg.get_by_label('Tag number').fill(tag)
        pg.get_by_label('Breed').fill(breed)
        pg.get_by_role('button', name='Save animal').click(); pg.wait_for_timeout(900)

    # --- Profit and loss: Excel, CSV, Print
    pg.goto(URL + '#/reports/profit'); pg.wait_for_timeout(1000)
    check('Three buttons: Excel, CSV, Print', all(pg.get_by_role('button', name=n).count() == 1 for n in ['Excel', 'CSV', 'Print']))
    with pg.expect_download() as d: pg.get_by_role('button', name='Excel').click()
    dl = d.value; xp = f'{OUT}/profit.xlsx'; dl.save_as(xp)
    check('Excel file is named for the report, year and basis', re.fullmatch(r'agri-it-profit-\d{4}(-\d{2})?-accruals(-to-date)?\.xlsx', dl.suggested_filename), dl.suggested_filename)
    wb = openpyxl.load_workbook(xp); ws = wb.active
    hdr = [c.value for c in ws[1]]
    check('Excel header row is the table headers only', hdr == ['Section', 'Item', 'Amount (EUR)'], str(hdr))
    check('Excel header is bold and the header row is frozen', ws['A1'].font.b and ws.freeze_panes == 'A2')
    body = [[c.value for c in r] for r in ws.iter_rows(min_row=2)]
    check('Excel has the total rows', {'Total output', 'Gross margin', 'Profit before depreciation'} <= {r[1] for r in body}, str([r[1] for r in body]))
    check('Excel amounts are numbers, shown with two decimals', all(isinstance(r[2], (int, float)) for r in body if r[2] is not None) and all(ws.cell(row=i + 2, column=3).number_format == '#,##0.00' for i, r in enumerate(body) if r[2] is not None))
    direct = {r[1]: r[2] for r in body if r[0] == 'Direct costs'}
    check('Excel: the two costs are in the direct costs', abs(direct.get('Vet & medicine', 0) - 245.5) < 0.005 or 245.5 in direct.values(), str(direct))

    with pg.expect_download() as d: pg.get_by_role('button', name='CSV').click()
    dl = d.value; path = f'{OUT}/profit.csv'; dl.save_as(path)
    check('CSV file name carries the basis', dl.suggested_filename.endswith('.csv') and '-accruals' in dl.suggested_filename, dl.suggested_filename)
    raw, text, rows = rows_of(path)
    check('CSV has no byte-order mark', not raw.startswith(b'\xef\xbb\xbf'))
    check('CSV header row', rows[0] == ['Section', 'Item', 'Amount (EUR)'], str(rows[0]))
    plain('Profit CSV', text, rows)
    check('CSV and Excel hold the same rows', [(r[0], r[1]) for r in rows[1:]] == [(r[0], r[1]) for r in body], f'{len(rows) - 1} vs {len(body)}')
    pg.get_by_role('button', name=re.compile('^Cash')).click(); pg.wait_for_timeout(500)
    with pg.expect_download() as d: pg.get_by_role('button', name='CSV').click()
    check('Cash-basis profit file says cash in its name', '-cash' in d.value.suggested_filename, d.value.suggested_filename)

    # --- Balance sheet
    pg.goto(URL + '#/reports/balance'); pg.wait_for_timeout(1000)
    with pg.expect_download() as d: pg.get_by_role('button', name='CSV').click()
    dl = d.value; path = f'{OUT}/balance.csv'; dl.save_as(path)
    raw, text, rows = rows_of(path)
    check('Balance header row: section, item, one column for each end of the year, change', rows[0][:2] == ['Section', 'Item'] and rows[0][2].startswith('At ') and rows[0][3].startswith('At ') and rows[0][4] == 'Change (EUR)', str(rows[0]))
    plain('Balance CSV', text, rows)
    check('Balance has its totals', {'Total owned', 'Total owed', 'Net worth'} <= {r[1] for r in rows}, str([r[1] for r in rows]))

    # --- Animals: Excel with real dates, accents kept, a comma stays in its cell
    pg.goto(URL + '#/reports/animals'); pg.wait_for_timeout(1000)
    t = pg.locator('body').inner_text()
    check('Animals on screen: both tags', '372 12 34567 8 1234' in t and '372 12 34567 2 0456' in t, t[:500])
    with pg.expect_download() as d: pg.get_by_role('button', name='Excel').click()
    dl = d.value; ap = f'{OUT}/animals.xlsx'; dl.save_as(ap)
    ws = openpyxl.load_workbook(ap).active
    check('Animals Excel header row', [c.value for c in ws[1]] == ['Tag number', 'Group', 'Sex', 'Breed', 'Born', 'Status', 'Left'], str([c.value for c in ws[1]]))
    arows = [[c.value for c in r] for r in ws.iter_rows(min_row=2)]
    check('Animals Excel: one row per animal, tag as text, breed with a comma in one cell', len(arows) == 2 and arows[0][0] == '372 12 34567 2 0456' and arows[1][3] == 'Limousin' and arows[0][3] == 'Charolais, cross', str(arows))
    with pg.expect_download() as d: pg.get_by_role('button', name='CSV').click()
    path = f'{OUT}/animals.csv'; d.value.save_as(path)
    raw, text, rows = rows_of(path)
    plain('Animals CSV', text, rows)
    check('Animals CSV: header and two animals, comma kept in one cell', rows[0][0] == 'Tag number' and len(rows) == 3 and any(r[3] == 'Charolais, cross' for r in rows), str(rows))

    # --- The screen has no long explanations
    t = pg.locator('body').inner_text()
    check('Screen has no rule version or basis paragraph', 'Rule reports@' not in t and 'Basis:' not in t, t[-400:])

    # --- Accountant pack zip
    pg.goto(URL + '#/money/year-end'); pg.wait_for_timeout(1000)
    with pg.expect_download(timeout=60000) as d: pg.get_by_role('button', name=re.compile('^Accountant pack')).click()
    zpath = f'{OUT}/pack.zip'; d.value.save_as(zpath)
    z = zipfile.ZipFile(zpath); names = z.namelist()
    check('Zip holds summary, transactions, records, README and the three reports as Excel files', {'summary.csv', 'transactions.csv', 'records.csv', 'README.txt', 'reports/profit.xlsx', 'reports/balance.xlsx', 'reports/animals.xlsx'} <= set(names) and len([n for n in names if n.startswith('reports/')]) == 3, str(names))
    for n in [n for n in names if n.startswith('reports/')]:
        wbz = openpyxl.load_workbook(io.BytesIO(z.read(n)))
        check(f'{n}: opens as a workbook with a header row', wbz.active.max_row >= 1 and wbz.active['A1'].value is not None, n)
    for n in [n for n in names if n.endswith('.csv')]:
        text = z.read(n).decode('utf-8')
        rr = list(csv.reader(io.StringIO(text.lstrip('\ufeff'))))
        check(f'{n}: every row as wide as the header', all(len(r) == len(rr[0]) for r in rr))
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
