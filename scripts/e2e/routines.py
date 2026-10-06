"""Browser run of routines: tick-offs update stock, money and records (demo build, phone size)."""
import re, sys
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], sys.argv[2]
CALF = '50000000-0000-0000-0000-000000000002'
results, errors = [], []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    def go(h):
        pg.goto(URL + h); pg.locator('main').first.wait_for(timeout=10000); pg.wait_for_timeout(350)
    checklist = lambda: pg.locator('section[aria-labelledby=checklist-title]')
    toast = lambda: ' '.join(pg.locator('[role=status]').all_inner_texts())
    card = lambda name: pg.locator('article', has_text=name).first.inner_text().replace('\n', ' | ')

    # 1. What's due
    go('#/')
    t = checklist().inner_text()
    check('Checklist: 0 of 3 done', '0 of 3 done' in t, t[:200])
    check('All fed as planned button with total', 'All fed as planned (307 kg)' in t)
    check('From earlier: overdue loan and bin count', 'From earlier' in t and 'Loan repayment' in t and 'Dip the nut bin' in t)
    check('No stale feeding from before ticking began', t.count('Calves: 27 kg Calf ration') == 1, t)
    check('Water troughs ticked 2 days ago is not shown', 'Check water troughs' not in t)
    check('Calf ration starts at 335 kg (actual 30 kg yesterday, not 27)', '335 kg in store' in card('Calf ration'), card('Calf ration'))
    pg.screenshot(path=f'{OUT}/checklist.png')

    # 2. The heifer example: tick one group, what's left updates
    pg.get_by_role('button', name='Fed 27 kg: Calves: 27 kg Calf ration').click()
    pg.wait_for_timeout(500)
    check('Toast says what is left', 'Fed 27 kg' in toast() and 'about 308 kg left' in toast(), toast())
    check('Progress 1 of 3', '1 of 3 done' in checklist().inner_text())
    check('Calf ration card now 308 kg', '308 kg in store' in card('Calf ration'), card('Calf ration'))

    # 3. All fed as planned
    pg.get_by_role('button', name=re.compile('All fed as planned')).click()
    pg.wait_for_timeout(500)
    check('All feeding done: 3 of 3', '3 of 3 done' in checklist().inner_text())
    check('Dairy nut drops by 280 kg to 8.3 t', '8.3 t in store' in card('Dairy nut'), card('Dairy nut'))

    # 4. Untick from the list
    pg.get_by_role('button', name=re.compile(r'Show done \(3\)')).click()
    pg.get_by_role('button', name='Untick: Calves: 27 kg Calf ration').click()
    pg.wait_for_timeout(500)
    check('Untick puts it back: 2 of 3', '2 of 3 done' in checklist().inner_text())
    check('Calf ration back to 335 kg', '335 kg in store' in card('Calf ration'), card('Calf ration'))

    # 5. Change the amount
    pg.locator('li', has_text='Calves: 27 kg Calf ration').get_by_role('button', name='Change').click()
    dlg = pg.get_by_role('dialog')
    dlg.locator('input').fill('20')
    dlg.get_by_role('button', name='Fed 20 kg').click()
    pg.wait_for_timeout(500)
    if pg.get_by_role('button', name=re.compile(r'Show done')).count(): pg.get_by_role('button', name=re.compile(r'Show done')).click()
    t = checklist().inner_text()
    check('Changed amount recorded against plan', 'Fed 20 kg (plan 27 kg)' in t, t[:600])
    check('Calf ration uses actual 20 kg: 315 kg', '315 kg in store' in card('Calf ration'), card('Calf ration'))

    # 6. A bill with a different amount creates the cost
    pg.locator('li', has_text='Loan repayment').get_by_role('button', name='Change').click()
    dlg = pg.get_by_role('dialog')
    check('Bill amount prefilled from routine', dlg.locator('input').input_value() == '5200', dlg.locator('input').input_value())
    dlg.locator('input').fill('5000')
    dlg.get_by_role('button', name='Paid €5,000').click()
    pg.wait_for_timeout(500)
    check('Loan gone from the list', 'Loan repayment' not in checklist().inner_text())
    go('#/money')
    m = pg.locator('main').inner_text()
    check('Cost recorded in Money', 'Loan repayment' in m and '−€5,000' in m, m[-900:])

    # 7. Stock count routine opens the count and ticks itself off
    go('#/')
    pg.get_by_role('link', name='Count now: Dip the nut bin').click()
    pg.get_by_text('How much is there?').wait_for()
    pg.locator('#qty').fill('8')
    pg.get_by_role('button', name='Save count').click()
    pg.get_by_label('Farm at a glance').wait_for(); pg.wait_for_timeout(500)
    check('Count routine ticked off', 'Dip the nut bin' not in checklist().inner_text())
    check('Dairy nut stock now the count, 8 t', '8 t in store' in card('Dairy nut'), card('Dairy nut'))

    # 8. Routines page and adding a routine
    go('#/routines')
    r = pg.locator('main').inner_text()
    check('Routines lists feeding with tick-off switches', 'Feeding' in r and pg.get_by_role('checkbox').count() == 4)  # 3 everyday plans + the upcoming higher rate
    check('Routines lists money and stock routines', all(x in r for x in ['Loan repayment', 'ESB bill', 'Milk cheque', 'Dip the nut bin', 'Feed out silage']))
    check('Silage feed-out starts at housing', 'Every day' in r and 'Next Sun, 1 Nov' in r, r)
    pg.screenshot(path=f'{OUT}/routines.png')
    pg.get_by_role('link', name='Add a routine').click()
    pg.get_by_role('button', name=re.compile('^Job')).click()
    pg.get_by_label('What needs doing?').fill('Wash bulk tank filter')
    pg.get_by_role('button', name='Every day').click()
    check('Form previews when it first shows', 'Shows on Today, today.' in pg.locator('main').inner_text())
    pg.screenshot(path=f'{OUT}/routine-form.png')
    pg.get_by_role('button', name='Add routine').click()
    pg.wait_for_timeout(500)
    go('#/')
    check('New job is on Today', 'Wash bulk tank filter' in checklist().inner_text())
    pg.get_by_role('button', name='Done: Wash bulk tank filter').click()
    pg.wait_for_timeout(400)
    check('Job ticked off', 'Done: Wash bulk tank filter' in toast(), toast())

    # 9. Switch off ticking for one feeding rule
    go('#/routines')
    pg.locator('li', has_text='In-calf heifers').get_by_role('checkbox').uncheck()
    pg.wait_for_timeout(400)
    go('#/')
    if pg.get_by_role('button', name=re.compile(r'Show done')).count(): pg.get_by_role('button', name=re.compile(r'Show done')).click()
    check('Rule with ticking off leaves the checklist', 'In-calf heifers' not in checklist().inner_text())

    # 10. A bill that repeats becomes a routine
    go('#/record/cost')
    pg.get_by_role('button', name='Utilities').click()
    pg.get_by_label('Amount').first.fill('120')
    pg.get_by_role('button', name=re.compile('^Monthly')).click()
    pg.get_by_role('button', name='Save cost').click()
    pg.wait_for_timeout(600)
    go('#/routines')
    check('Repeating bill appears as a monthly routine', re.search(r'Utilities.*Monthly on the', pg.locator('main').inner_text(), re.S) is not None)

    # 11. Diary and Ask
    go('#/diary')
    d = pg.locator('main').inner_text()
    check('Diary shows ticked-off feeding', 'Feeding ticked off' in d, d[:500])
    check('Diary shows the job done', 'Done: Wash bulk tank filter' in d)
    go('#/ask')
    pg.get_by_role('button', name='What is left to do today?').click()
    pg.wait_for_timeout(400)
    a = pg.locator('main').inner_text()
    check('Ask answers from the checklist', 'to tick off today' in a or 'Everything due today is ticked off' in a, a[:400])

    # 12. Dawn mode screenshot and small-screen overflow
    pg.evaluate("localStorage.setItem('agri-it:dawn','on')")
    go('#/'); pg.evaluate("window.scrollTo(0, document.getElementById('checklist-title').getBoundingClientRect().top + scrollY - 70)"); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{OUT}/checklist-dawn.png')
    small = b.new_context(viewport={'width': 360, 'height': 740}); sp = small.new_page()
    sp.on('pageerror', lambda e: errors.append('360px: ' + str(e)))
    for mode in ['off', 'on']:
        sp.goto(URL + '#/'); sp.evaluate(f"localStorage.setItem('agri-it:dawn', '{mode}')")
        for r_ in ['#/', '#/routines', '#/routines/new', '#/record/cost', '#/diary']:
            sp.goto(URL + r_); sp.locator('main').first.wait_for(timeout=10000); sp.wait_for_timeout(250)
            check(f'No sideways scroll {r_} (dawn {mode})', not sp.evaluate('document.documentElement.scrollWidth > innerWidth + 1'))
    b.close()

failed = [r for r in results if not r[1]]
for n, ok, det in results:
    print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else f'   <- {det[:500]}'))
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed. Console/page errors: {errors}')
