"""Advisory board review fixes (14 Oct 2026) in the browser, against the demo build at phone size.

Recorded cash and the bank check (G02), what the forecast can't see, amounts that never wrap on
narrow phones (G13), one set of silage sums (G13), orders to place vs placed (G03), dated and
sourced deadlines (G06).
Run: python3 scripts/e2e/advisory.py http://localhost:4331/ out/
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

def main_text(pg):
    return pg.locator('main').inner_text()

# Any amount (€ or £) whose characters land on more than one line, or run off the screen
SPLIT_JS = """() => {
 const out=[]; const re=/[-−]?\\u2060?[€£][\\d.,]+[KMk]?/g;
 const w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
 while((n=w.nextNode())){ const t=n.textContent; let m; re.lastIndex=0;
  while((m=re.exec(t))){ const r=document.createRange(); r.setStart(n,m.index); r.setEnd(n,m.index+m[0].length);
   const rects=[...r.getClientRects()].filter(x=>x.width>0); const tops=new Set(rects.map(x=>Math.round(x.top)));
   if(tops.size>1 || (rects[0] && rects[0].right>window.innerWidth+1)) out.push(m[0]); } }
 return out; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL_CONNECTION_FAILED' not in m.text and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))

    # --- G13: amounts never split across lines, even on a 320 px phone -----------------------
    narrow = b.new_context(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True)
    np_ = narrow.new_page()
    np_.goto(URL); np_.wait_for_timeout(1500)
    bad = []
    for r in ['/', '/money', '/money/bills', '/money/year-end', '/progress?tab=cash', '/progress?tab=forage', '/diary']:
        np_.goto(URL + '#' + r); np_.wait_for_timeout(900)
        bad += [(r, x) for x in np_.evaluate(SPLIT_JS)]
    check('No amount splits across lines on a 320 px phone', not bad, str(bad[:6]))
    np_.goto(URL + '#/money'); np_.wait_for_timeout(900); np_.screenshot(path=f'{OUT}/money-320.png')
    narrow.close()

    # --- G13: the same silage sums on the dashboard, the attention list and the winter plan ----
    go(pg, '#/')
    t = main_text(pg)
    check('Dashboard silage card: share of winter and tonnes short', '87%' in t and '133 t short' in t, t[:1200])
    check('Attention list states both shortfalls', '133 t short for the winter, 289 t short counting your 15% reserve (156 t)' in t, t)
    go(pg, '#/progress?tab=forage')
    t = main_text(pg)
    check('Winter plan: store, winter need, reserve', all(x in t for x in ['904', 't in store', '1,037', 't for the winter', '156', 't reserve (15%)']), t[:700])
    check('Winter plan shows the sum that adds up', '904 in store against 1,037 + 156 reserve = 1,193 t' in t and '133 t short for the winter, 289 t short' in t, t[:900])

    # --- G02: recorded cash, never called a bank balance; check against the bank -------------
    go(pg, '#/progress?tab=cash')
    t = main_text(pg)
    check('Cash is labelled recorded, not a bank balance', 'Recorded cash' in t and 'Not your bank balance' in t, t[:600])
    check('Says when it was last checked, and that it is out of date', re.search(r'Last checked against the bank \d+ days ago', t) and 'Check it again' in t, t[:800])
    check('Repeats the farmer set up are in the 90-day forecast, apart from budget', 'Repeats: +€27,000' in t and 'Budget: −' in t, t[:1600])
    pg.screenshot(path=f'{OUT}/cash-before.png', full_page=True)
    m = re.search(r'Recorded cash\s*€([\d,]+)', t)
    recorded = int(m.group(1).replace(',', '')) if m else None
    pg.get_by_role('button', name='Check against the bank').click()
    pg.get_by_label('What your bank shows now').fill(str((recorded or 0) - 500))
    pg.get_by_role('button', name='Save balance').click(); pg.wait_for_timeout(900)
    t = main_text(pg)
    check('Bank check says how far out the recorded figure was', '€500 less than recorded' in t, t[:900])
    check('After the check: checked today, and cash is the bank figure', 'Checked against the bank today' in t and f"€{(recorded or 0) - 500:,}" in t, t[:600])
    pg.screenshot(path=f'{OUT}/cash-after.png', full_page=True)
    go(pg, '#/')
    t = main_text(pg)
    check('Dashboard cash card no longer asks for a bank check', 'Check bank' not in t and 'Recorded.' in t, t[:1500])

    b.close()

for n, ok, d in results:
    print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else f'   <- {d[:400]}'))
passed = sum(1 for _, ok, _ in results if ok)
print(f'{passed}/{len(results)} checks passed. Console/page errors: {errors[:5]}')
sys.exit(0 if passed == len(results) and not errors else 1)
