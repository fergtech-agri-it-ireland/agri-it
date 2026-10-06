"""Photo reading (docket OCR) against the demo build at phone size.
Usage: python3 scripts/e2e/ocr.py http://localhost:4331/ out/

The demo loads the reader from the public CDN. Here those requests are answered from
node_modules, so the real reader runs in the browser with no network. Part E blocks the
CDN instead, as the hosted demo page may, to check the fallback and the read-later queue."""
import os, re, sys, time
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
NM = os.path.join(HERE, '..', '..', 'node_modules')
NUT = '50000000-0000-0000-0000-000000000001'
results, errors = [], []
cdn = {'mode': 'local'}

def quiet(text):
    # Blocked CDN requests (part E) and the reader's own progress notes are expected
    if cdn['mode'] == 'blocked' and ('importScripts' in text or 'jsdelivr' in text):
        return True
    return 'net::ERR_FAILED' in text or re.match(r'(Estimating resolution|Detected \d+ diacritics|Warning: Invalid resolution|Failed to load resource)', text)

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def serve_cdn(route):
    u = route.request.url
    if cdn['mode'] == 'blocked':
        return route.abort()
    name = u.rsplit('/', 1)[1]
    if 'tesseract.js@' in u: f = os.path.join(NM, 'tesseract.js', 'dist', name)
    elif 'tesseract.js-core@' in u: f = os.path.join(NM, 'tesseract.js-core', name)
    elif '@tesseract.js-data/eng@' in u: f = os.path.join(NM, '@tesseract.js-data', 'eng', '4.0.0_best_int', name)
    else: return route.abort()
    if not os.path.exists(f):
        return route.fulfill(status=404)
    route.fulfill(path=f, headers={'access-control-allow-origin': '*', 'content-type': 'application/javascript' if f.endswith('.js') else 'application/octet-stream'})

def go(pg, h):
    pg.goto(URL + h)
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(350)

def body(pg):
    return pg.locator('main').inner_text()

def read_sample(pg, name, timeout=60000):
    go(pg, '#/record')
    t = time.time()
    pg.locator(f'[data-sample="{name}"]').click()
    pg.locator('[data-testid=read-result], [data-testid=read-unavailable]').first.wait_for(timeout=timeout)
    return time.time() - t

def tag_state(pg, field):
    t = pg.locator(f'[data-read-tag="{field}"]')
    return t.first.get_attribute('data-read-state') if t.count() else None

def run(p):
    global pg
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.route('https://cdn.jsdelivr.net/**', serve_cdn)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and not quiet(m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: not quiet(str(e)) and errors.append(str(e)))

    # A. Record screen in the demo: file picker (no camera), sample photos
    go(pg, '#/record')
    inp = pg.locator('[data-testid=photo-input]')
    check('Demo uses a file picker, not the camera', inp.count() == 1 and inp.get_attribute('capture') is None)
    check('Three sample photos to try', pg.locator('[data-sample]').count() == 3)
    check('Sample buttons are big enough to press', pg.evaluate("[...document.querySelectorAll('[data-sample]')].every(b => b.getBoundingClientRect().height >= 56)"))

    # B. Feed docket, read live on the phone: crooked, dim
    secs = read_sample(pg, 'feed-docket.jpg')
    res = pg.locator('[data-testid=read-result]').inner_text()
    check('Docket read in under 30 s', secs < 30, f'{secs:.1f}s')
    check('Works out it is a feed delivery docket', 'Feed delivery docket' in res, res)
    check('Headline uses the matched names', 'Tirlán FarmLife' in res and 'Dairy nut 16%' in res and '3 t' in res, res)
    pg.screenshot(path=f'{OUT}/ocr-read-result.png')
    pg.get_by_role('button', name='Check and save').click()
    pg.wait_for_timeout(500)
    check('Opens Feed arrived', pg.get_by_role('heading', name='Feed arrived').count() == 1)
    summary = pg.locator('[data-testid=read-summary]').inner_text()
    check('Says it was read on this phone', 'Read on this phone' in summary, summary)
    check('Docket sums checked', pg.locator('[data-testid=read-check-ok]').count() >= 1)
    check('Feed matched and selected', pg.get_by_role('button', name='Dairy nut 16%').first.get_attribute('aria-pressed') == 'true')
    check('Quantity 3 tonnes filled in', pg.locator('#qty').input_value() == '3')
    check('Quantity tagged: unit worked out, fairly sure', tag_state(pg, 'quantity') == 'medium' and 'Unit worked out' in pg.locator('[data-read-tag=quantity]').inner_text())
    check('Price per tonne 392 filled in', pg.get_by_label('Price per tonne').input_value() == '392')
    check('Supplier matched to Tirlán', pg.get_by_role('button', name='Tirlán FarmLife').first.get_attribute('aria-pressed') == 'true' and tag_state(pg, 'supplier') == 'high')
    check('Date read from the docket', '5 Oct 2026' in body(pg) and tag_state(pg, 'date') in ('high', 'medium'))
    check('Docket sets evidence to Docket', pg.get_by_role('button', name='Docket', exact=True).get_attribute('aria-pressed') == 'true')
    check('Every read value is tagged read from photo', all(tag_state(pg, f) for f in ('feed', 'quantity', 'date', 'supplier', 'price')))
    check('Says nothing is recorded until Save', 'Nothing is recorded until you tap Save' in summary)
    pg.screenshot(path=f'{OUT}/ocr-delivery-form.png', full_page=True)
    # Changing a value shows it was changed by the farmer
    pg.get_by_label('Price per tonne').fill('395')
    pg.wait_for_timeout(150)
    check('Editing a value marks it changed by you', tag_state(pg, 'price') == 'changed')
    pg.get_by_label('Price per tonne').fill('392')
    # Nothing saved yet: leaving the form records nothing
    go(pg, f'#/feed/{NUT}')
    check('Leaving without saving records nothing', '€392/t' not in body(pg))
    # Read again and save
    read_sample(pg, 'feed-docket.jpg')
    pg.get_by_role('button', name='Check and save').click()
    pg.wait_for_timeout(400)
    pg.get_by_role('button', name='Save delivery').click()
    pg.wait_for_timeout(900)
    check('Saved screen after Save', 'Delivery saved' in body(pg), body(pg)[:200])
    go(pg, f'#/feed/{NUT}')
    check('Delivery recorded at the read price', '€392/t' in body(pg))
    go(pg, '#/records')
    b_ = body(pg)
    check('Docket photo kept as evidence, already confirmed', '0 documents waiting to be confirmed' in b_, b_[:300])

    # C. Vet receipt: a bill, read live, creased
    read_sample(pg, 'vet-receipt.jpg')
    res = pg.locator('[data-testid=read-result]').inner_text()
    check('Works out it is a bill or receipt', 'Bill or receipt' in res and '€202.60' in res, res)
    pg.get_by_role('button', name='Check and save').click()
    pg.wait_for_timeout(500)
    check('Opens Paid a bill', pg.get_by_role('heading', name='Paid a bill').count() == 1)
    check('Category: Vet & medicine', pg.get_by_role('button', name='Vet & medicine').get_attribute('aria-pressed') == 'true')
    check('Amount 202.60 filled in', pg.get_by_label('Amount').input_value() in ('202.6', '202.60'))
    check('Payee read from the header', pg.get_by_label('Paid to').input_value() == 'Suir Valley Veterinary Clinic', pg.get_by_label('Paid to').input_value())
    check('Receipt number and VAT in the note', 'Receipt 20871' in pg.get_by_label('Note (optional)').input_value() and 'VAT €24.10 (13.5%)' in pg.get_by_label('Note (optional)').input_value(), pg.get_by_label('Note (optional)').input_value())
    check('VAT sum checked', 'Net €178.50 + VAT €24.10 = total €202.60' in pg.locator('[data-testid=read-summary]').inner_text())
    pg.screenshot(path=f'{OUT}/ocr-bill-form.png', full_page=True)
    pg.get_by_role('button', name='Save cost').click()
    pg.wait_for_timeout(800)
    check('Bill saved, back on Money', '/money' in pg.url)

    # D. The very dim, crooked, creased test photo through the real file picker
    go(pg, '#/record')
    t = time.time()
    pg.locator('[data-testid=photo-input]').set_input_files(os.path.join(HERE, 'fixtures', 'very-dim-docket.jpg'))
    pg.locator('[data-testid=read-result], [data-testid=read-unavailable]').first.wait_for(timeout=60000)
    res = pg.locator('[data-testid=read-result]').inner_text() if pg.locator('[data-testid=read-result]').count() else ''
    check('Very dim, 8 degrees crooked: still a feed docket from Tirlán', 'Feed delivery docket' in res and 'Tirlán FarmLife' in res, res)
    check('Very dim photo: quantity or a clear "fill in" (never a guess)', '3 t' in res or 'quantity' in res, res)
    pg.screenshot(path=f'{OUT}/ocr-very-dim.png')

    # E. Reader blocked (as the hosted demo page may be)
    cdn['mode'] = 'blocked'
    ctx.clear_cookies()
    pg.close()
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and not quiet(m.text) and errors.append(m.text))
    pg.on('pageerror', lambda e: not quiet(str(e)) and errors.append(str(e)))
    t = time.time()
    read_sample(pg, 'supplier-invoice.jpg', timeout=90000)
    check('Blocked reader gives up within the idle limit', time.time() - t < 45, f'{time.time() - t:.0f}s')
    res = pg.locator('[data-testid=read-result]').inner_text() if pg.locator('[data-testid=read-result]').count() else ''
    check('Blocked reader: sample still read from its saved reading', 'Feed invoice' in res, res)
    pg.get_by_role('button', name='Check and save').click()
    pg.wait_for_timeout(400)
    summary = pg.locator('[data-testid=read-summary]').inner_text()
    check('Says the saved reading was used', 'Saved reading of this sample' in summary, summary)
    check('Invoice sets evidence to Invoice', pg.get_by_role('button', name='Invoice', exact=True).get_attribute('aria-pressed') == 'true')
    check('Invoice quantity 2.5 t and €388/t', pg.locator('#qty').input_value() == '2.5' and pg.get_by_label('Price per tonne').input_value() == '388')
    check('Invoice supplier matched to Dairygold', pg.get_by_role('button', name='Dairygold Agri Business').first.get_attribute('aria-pressed') == 'true')
    pg.get_by_role('button', name='Save delivery').click()
    pg.wait_for_timeout(900)
    go(pg, f'#/feed/{NUT}')
    check('Invoice quantity lowers confidence until confirmed', 'from an invoice' in pg.locator('main').text_content(), '')
    go(pg, '#/records')
    b_ = body(pg)
    check('Invoice waits in Confirm these', 'Confirm these' in b_ and 'Dairygold Agri Business' in b_ and 'Confirm once what arrived matches' in b_, b_[:500])
    pg.screenshot(path=f'{OUT}/ocr-records-confirm.png')
    pg.get_by_role('button', name='Confirm', exact=True).first.click()
    pg.wait_for_timeout(600)
    check('Confirming clears it', '0 documents waiting to be confirmed' in body(pg))
    go(pg, f'#/feed/{NUT}')
    check('Confirmed: invoice no longer lowers confidence', 'from an invoice' not in pg.locator('main').text_content())

    # F. A photo of your own with the reader blocked: keep it to read later
    go(pg, '#/record')
    pg.locator('[data-testid=photo-input]').set_input_files(os.path.join(HERE, 'fixtures', 'very-dim-docket.jpg'))
    pg.locator('[data-testid=read-unavailable]').wait_for(timeout=90000)
    check('Explains it cannot read right now', 'blocks the photo reader' in pg.locator('[data-testid=read-unavailable]').inner_text())
    pg.get_by_role('button', name='Read it when I have signal').click()
    pg.wait_for_timeout(500)
    q = pg.locator('[data-testid=photo-queue]')
    check('Kept photo waits in Photos to check', q.count() == 1 and 'Waiting to be read' in q.inner_text())
    go(pg, '#/')
    check('Today has no nudge while it is unread', pg.locator('[data-testid=photo-nudge]').count() == 0)
    # Reader available again (signal back): opening Record reads it
    cdn['mode'] = 'local'
    t = time.time()
    while time.time() - t < 120:
        go(pg, '#/record')  # opening Record (or coming back online) reads waiting photos
        try:
            pg.locator('[data-testid=photo-queue] >> text=Feed delivery docket').wait_for(timeout=15000)
            break
        except Exception:
            pass
    check('Read once the reader is available', 'Feed delivery docket' in pg.locator('[data-testid=photo-queue]').inner_text())
    go(pg, '#/')
    nudge = pg.locator('[data-testid=photo-nudge]')
    check('Today says a photo is ready to check', nudge.count() == 1 and '1 photo read' in nudge.inner_text())
    go(pg, '#/record')
    pg.get_by_role('button', name='Check', exact=True).click()
    pg.wait_for_timeout(500)
    check('Check opens the form prefilled from the kept photo', pg.get_by_role('heading', name='Feed arrived').count() == 1 and pg.locator('[data-testid=read-summary]').count() == 1)
    go(pg, '#/record')
    check('Not saved, so the photo is still waiting to be checked', pg.locator('[data-testid=photo-queue]').count() == 1)
    pg.get_by_role('button', name='Remove this photo').click()
    pg.wait_for_timeout(300)
    check('Removing a kept photo', pg.locator('[data-testid=photo-queue]').count() == 0)

    # G. PDFs are not read, but still attach
    go(pg, '#/record')
    pdf = os.path.join(OUT, 'test.pdf')
    open(pdf, 'wb').write(b'%PDF-1.4\n%%EOF\n')
    pg.locator('[data-testid=photo-input]').set_input_files(pdf)
    pg.locator('[data-testid=read-unreadable]').wait_for(timeout=10000)
    check('PDF: says it cannot be read yet and offers the forms', "can't read PDFs yet" in pg.locator('[data-testid=read-unreadable]').inner_text() and pg.get_by_role('button', name='Bill or invoice').count() == 1)

    check('No page errors', not errors, '; '.join(errors[:3]))
    b.close()


with sync_playwright() as p:
    try:
        run(p)
    except Exception as e:  # report what passed, then the failure
        check('Script ran to the end', False, str(e).splitlines()[0])
        try:
            pg.screenshot(path=f'{OUT}/ocr-failure.png')
            print(pg.locator('main').inner_text()[:800])
        except Exception:
            pass

ok = sum(1 for r in results if r[1])
for name, passed, detail in results:
    print(('PASS ' if passed else 'FAIL ') + name + ('' if passed or not detail else f'  [{detail[:300]}]'))
print(f'{ok}/{len(results)} checks passed')
sys.exit(0 if ok == len(results) else 1)
