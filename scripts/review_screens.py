"""Capture the screens a third-party reviewer needs, at phone size (390 x 844).

Two tours:
  demo   the demo farm (Glenview Farm, sample data): every module, form and report
  first  the empty phone app, as a new farmer sees it: sign-up and farm setup

Run (after `npm run build:demo` and `npm run build:phone`):
  cd dist-demo && python3 -m http.server 4331 &
  python3 scripts/review_screens.py http://localhost:4331/ dist-phone/index.html docs/review/screens

Writes numbered JPEGs, screens.json (file, title, route, what to judge) and index.html, a gallery
page that opens in any browser. Long screens are full height with the fixed bars set in the flow (so
the bottom tab bar is at the foot of the page, not floating mid-way); the five main tabs also get a
first-screen shot at phone height with the bar where a farmer sees it.
"""
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright

DEMO, PHONE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith(('.png', '.jpg', '.html')) or f == 'screens.json':
        os.remove(os.path.join(OUT, f))

manifest, problems = [], []

# (slug, route, title, what to judge)
DEMO_TOUR = [
    ('dashboard', '#/', 'Dashboard', 'Does the first screen say what needs doing today? Are the key numbers, To do list and module tiles in the right order?'),
    ('diary', '#/diary', 'Diary', 'Is the day easy to scan? Is adding something from a section obvious?'),
    ('add', '#/record', 'Add', 'Can a farmer find the thing they want to record in under 10 seconds?'),
    ('modules', '#/more', 'Modules', 'Are the module names and their live lines clear? Are tiles all the same size and equally easy to hit?'),
    ('progress', '#/progress', 'Progress', 'Do the forecasts read as answers, or as charts to decode?'),
    ('feed', None, 'Feed: days left and the sum', 'Can a farmer say why the order-by date is what it is?'),
    ('delivery', '#/record/delivery', 'Record a feed delivery', 'Time it. Is anything asked that a farmer would not know?'),
    ('count', '#/record/count', 'Stock count', 'Is it clear what Agri-It does and does not change after a count?'),
    ('cost', '#/record/cost', 'Paid a bill', 'Paid, owed and repeating bills: is the difference obvious?'),
    ('bills', '#/money/bills', 'Bills to pay', 'Overdue first. Is paying one bill or a whole statement clear?'),
    ('money', '#/money', 'Money', 'Cash now, to pay and on order are shown apart. Does that read clearly?'),
    ('plan', '#/money/plan', 'Year plan', 'Month by month. Is it clear what is planned and what has happened?'),
    ('loans', '#/money/loans', 'Loans and overdraft', 'Is repayment and interest understandable to a non-accountant?'),
    ('payments', '#/money/payments', 'Scheme payments', 'Published dates and amounts. Is it clear which are expected and which are received?'),
    ('year-end', '#/money/year-end', 'Year-end pack', 'Would an accountant trust what this hands over?'),
    ('reports', '#/reports', 'Reports', 'Three reports only. Are the names and descriptions enough?'),
    ('report-profit', '#/reports/profit', 'Profit and loss', 'Is it readable on a phone? Is incompleteness explained without scaring the farmer?'),
    ('report-balance', '#/reports/balance', 'Balance sheet', 'Are the "not valued" lines clear and is it obvious how to fill them?'),
    ('animals', '#/animals', 'Animals hub', 'Six equal tiles for a herd of thousands. Is the order right?'),
    ('animals-herd', '#/animals/herd', 'Find and manage animals', 'Filtering and finding one animal in a large herd.'),
    ('animals-add', '#/animals/add', 'Add animals', 'Scan the blue card, type a tag, or add several. Which would a farmer choose?'),
    ('animals-update', '#/animals/update', 'Update many animals', 'Is the confirmation clear about what does and does not change?'),
    ('animals-moveup', '#/animals/moveup', 'Move up a stage', 'Automatic life stages: is it clear why an animal is listed?'),
    ('animals-stages', '#/animals/stages', 'Life stages', 'Are the stage names and ages understandable?'),
    ('groups', '#/farm/groups', 'Groups and head counts', 'Head counts drive the feed forecast. Is "since when?" clear?'),
    ('calving', '#/calving', 'Calving season', 'Drying off, tag deadlines, checklist: is the sequence clear?'),
    ('fields', '#/farm/fields', 'Fields', 'Quick to enter three fields?'),
    ('fertiliser', '#/fertiliser', 'Fertiliser', 'Stock, orders and spreading from one place.'),
    ('spread', '#/record/spread', 'Record a spreading', 'One field or several at once. Is the closed-period warning clear?'),
    ('silage', '#/farm/silage', 'Silage and bales', 'Dry matter help: is the "best guess" label honest and understandable?'),
    ('routines', '#/routines', 'Routines', 'Recurring jobs, bills and feeding ticks.'),
    ('records', '#/records', 'Records', 'Searchable vault. Is it clear it is evidence, not an official register?'),
    ('suppliers', '#/suppliers', 'Suppliers', 'Who to ring, and how sure Agri-It is of the number.'),
    ('ask', '#/ask', 'Ask Agri-It', 'It only answers from farm records. Is that clear?'),
    ('settings', '#/settings', 'Settings', 'Is anything here that a farmer needs often but cannot find elsewhere?'),
    ('setup', '#/setup', 'Set up your farm (hub)', 'Staged setup. Does the progress feel manageable?'),
]


TABS = {'dashboard', 'diary', 'add', 'modules', 'progress'}


def shot(pg, slug, route, title, judge, tour, n, first_screen=False):
    """Full height by default; first_screen=True is just what fits on the phone, bars where they sit."""
    suffix = '-first-screen' if first_screen else ''
    name = f'{n:02d}-{tour}-{slug}{suffix}.jpg'
    path = os.path.join(OUT, name)
    if first_screen:
        pg.evaluate('window.scrollTo(0, 0)')
        pg.screenshot(path=path, type='jpeg', quality=82)
    else:
        pg.add_style_tag(content='.fixed:not([role=dialog]){position:static !important}')
        pg.screenshot(path=path, type='jpeg', quality=82, full_page=True)
    manifest.append({'file': name, 'tour': tour, 'title': title + (' (first screen)' if first_screen else ''),
                     'route': route, 'judge': judge, 'first_screen': first_screen})


def settle(pg):
    pg.locator('main').first.wait_for(timeout=10000)
    pg.wait_for_timeout(700)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    n = 0
    for slug, route, title, judge in DEMO_TOUR:
        try:
            if route is None:
                pg.goto(DEMO + '#/')
                settle(pg)
                href = pg.locator('a[href*="#/feed/"]').first.get_attribute('href')
                route = href[href.index('#'):]
                pg.goto(DEMO + route)
            else:
                pg.goto(DEMO + route)
            settle(pg)
            n += 1
            if slug in TABS:
                shot(pg, slug, route, title, judge, 'demo', n, first_screen=True)
                n += 1
            shot(pg, slug, route, title, judge, 'demo', n)
        except Exception as e:  # keep going, report at the end
            problems.append(f'{slug}: {e}')
    ctx.close()

    # First run on an empty phone: what a new farmer sees
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    try:
        pg.goto('file://' + os.path.abspath(PHONE))
        pg.wait_for_timeout(900)
        n += 1
        shot(pg, 'signup-1', '(first open)', 'First open: farm name and county', 'Is it obvious what to do? Is two steps the right amount before the app is useful?', 'first', n)
        pg.get_by_label('Farm name').fill('Glenview Farm')
        pg.select_option('#county', 'Tipperary')
        pg.get_by_role('button', name='Next').click()
        pg.wait_for_timeout(700)
        for t in ['Dairy', 'Beef']:
            pg.get_by_role('button', name=re.compile('^' + t)).first.click()
        n += 1
        shot(pg, 'signup-2', '(sign-up step 2)', 'What do you farm?', 'Any mix is allowed and nothing is ruled out. Do the choices cover how farmers describe themselves?', 'first', n)
        pg.get_by_role('button', name='Next: set up your farm').click()
        pg.wait_for_timeout(1500)
        n += 1
        shot(pg, 'setup-hub', '#/setup', 'Set up your farm: stages', 'Are the stages in a sensible order? Which would a busy farmer skip, and is skipping safe?', 'first', n)
        pg.get_by_role('link', name='Start').first.click()
        pg.wait_for_timeout(700)
        n += 1
        shot(pg, 'setup-first-step', '#/setup/farm', 'First setup step', 'Is each question worth asking now? Is the reason for asking visible?', 'first', n)
        pg.goto('file://' + os.path.abspath(PHONE) + '#/')
        pg.wait_for_timeout(900)
        n += 1
        shot(pg, 'empty-dashboard', '#/', 'Dashboard on a brand new farm', 'What does a farmer see before any data exists? Does it make them want to carry on?', 'first', n)
    except Exception as e:
        problems.append(f'first-run: {e}')
    b.close()

with open(os.path.join(OUT, 'screens.json'), 'w') as f:
    json.dump(manifest, f, indent=2)

GALLERY_CSS = (
    'body{font:16px/1.45 system-ui,sans-serif;margin:0;background:#f1f4f2;color:#12211a}'
    'header{padding:24px 20px;max-width:960px;margin:auto}h1{margin:0 0 6px}'
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px;padding:0 20px 40px;max-width:1400px;margin:auto}'
    'figure{margin:0;background:#fff;border-radius:14px;padding:12px;box-shadow:0 1px 3px #0002}'
    'img{width:100%;max-height:520px;object-fit:cover;object-position:top;border-radius:8px;border:1px solid #dde5e0;display:block}'
    'figcaption{padding-top:10px}figcaption span{display:block;color:#5b6b63;font-size:13px}'
    'figcaption p{margin:6px 0 0;font-size:14px}'
)


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


cards = ''.join(
    '<figure><a href="{f}"><img loading="lazy" src="{f}" alt="{t}"></a>'
    '<figcaption><b>{t}</b><span>{r}</span><p>{j}</p></figcaption></figure>'.format(
        f=m['file'], t=esc(m['title']), r=esc(m['route']), j=esc(m['judge']))
    for m in manifest)
with open(os.path.join(OUT, 'index.html'), 'w') as f:
    f.write(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Agri-It screens for review</title><style>' + GALLERY_CSS + '</style></head><body>'
        '<header><h1>Agri-It screens for review</h1>'
        '<p>Phone size (390 px wide). Click a picture for the full-height screen. The first group comes from the demo farm '
        '(Glenview Farm, sample data); the last five are what a brand new farmer sees on an empty phone. '
        'Under each picture is the question to ask of that screen.</p></header>'
        '<div class="grid">' + cards + '</div></body></html>')
print(f'{len(manifest)} screens captured')
for x in problems:
    print('PROBLEM', x)
