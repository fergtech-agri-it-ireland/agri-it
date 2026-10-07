import re
"""Phone-only build at phone size: set-up, records, reopen, backup, restore on a second phone, delete all.
Usage: python3 scripts/e2e/phone.py file:///abs/path/dist-phone/index.html OUTDIR"""
import sys, struct, zlib, os
from playwright.sync_api import sync_playwright
URL=sys.argv[1]
OUT=sys.argv[2]; os.makedirs(OUT, exist_ok=True); res=[]; errs=[]
def check(n,c,d=''): res.append((n,bool(c),d))
def png(path):
    raw=b'\x00\xff\xc6\x1a'
    ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b''))
png(OUT+'/tiny.png')
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,accept_downloads=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(800)
    pg.get_by_label('Farm name').fill('Test Farm'); pg.select_option('#county','Tipperary')
    pg.get_by_role('button',name='Next').click(); pg.get_by_role('button',name='Next').click()
    pg.get_by_role('button',name='Start using Agri-It').click(); pg.wait_for_timeout(1000)
    # cost
    pg.goto(URL+'#/record/cost'); pg.wait_for_timeout(800)
    pg.get_by_role('button',name=re.compile('Vet')).click()
    pg.get_by_label('Amount').fill('245.50')
    pg.get_by_label('Paid to').fill('Clonmel Vets')
    pg.screenshot(path=f'{OUT}/5-cost-filled.png')
    pg.get_by_role('button',name='Save cost').click(); pg.wait_for_timeout(1000)
    # feed
    pg.goto(URL+'#/feed/new'); pg.wait_for_timeout(800)
    pg.get_by_label('Feed name').fill('Calf nuts')
    pg.get_by_role('button',name='Next: who eats it').click(); pg.wait_for_timeout(1000)
    # offline: still saves?
    ctx.set_offline(True)
    pg.goto(URL+'#/record/cost'); pg.wait_for_timeout(800)
    pg.get_by_role('button',name=re.compile('^Fert')).click(); pg.get_by_label('Amount').fill('1200')
    pg.get_by_role('button',name='Save cost').click(); pg.wait_for_timeout(1000)
    check('No "waiting to sync" banner offline', 'waiting to sync' not in pg.locator('body').inner_text() and 'Offline' not in pg.locator('body').inner_text())
    ctx.set_offline(False)
    # reopen: new page same context (same storage)
    pg.close(); pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(URL+'#/money'); pg.wait_for_timeout(1500)
    t=pg.locator('main').inner_text()
    check('Records survive closing the app', 'Clonmel Vets' in t or '245' in t, t[:300].replace('\n',' | '))
    check('Offline record kept', '1,200' in t, '')
    pg.screenshot(path=f'{OUT}/6-money.png', full_page=True)
    pg.goto(URL+'#/farm'); pg.wait_for_timeout(800)
    check('Feed kept', '1 feeds tracked' in pg.locator('body').inner_text())
    # settings card + backup
    pg.goto(URL+'#/settings'); pg.wait_for_timeout(1000)
    pg.get_by_role('heading',name='Kept on this phone').scroll_into_view_if_needed()
    pg.screenshot(path=f'{OUT}/7-settings.png')
    st=pg.locator('main').inner_text()
    check('Settings says kept on this phone, no sign out', 'Kept on this phone' in st and 'Sign out' not in st, '')
    with pg.expect_download() as d: pg.get_by_role('button',name='Back up').click()
    bk=d.value; bk.save_as(OUT+'/backup.json'); check('Backup downloads', os.path.getsize(OUT+'/backup.json')>1000, bk.suggested_filename)
    # second phone
    ctx2=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    p2=ctx2.new_page(); p2.on('pageerror',lambda e: errs.append(str(e)))
    p2.goto(URL); p2.wait_for_timeout(800)
    check('Second phone starts empty (own data)', 'Your farm' in p2.locator('body').inner_text())
    p2.get_by_label('Farm name').fill('Other'); p2.select_option('#county','Cork')
    p2.get_by_role('button',name='Next').click(); p2.get_by_role('button',name='Next').click()
    p2.get_by_role('button',name='Start using Agri-It').click(); p2.wait_for_timeout(1000)
    p2.goto(URL+'#/settings'); p2.wait_for_timeout(800)
    p2.locator('input[type=file][accept*=json]').set_input_files(OUT+'/backup.json'); p2.wait_for_timeout(2000)
    p2.goto(URL+'#/money'); p2.wait_for_timeout(1500)
    check('Restore on another phone brings records over', 'Clonmel Vets' in p2.locator('main').inner_text() or '245' in p2.locator('main').inner_text())
    p2.goto(URL+'#/'); p2.wait_for_timeout(800); check('Restored farm name', 'Test Farm' in p2.locator('body').inner_text())
    # wipe
    p2.goto(URL+'#/settings'); p2.wait_for_timeout(800)
    p2.get_by_role('button',name='Delete everything and start again').click()
    p2.get_by_role('button',name='Delete all').click(); p2.wait_for_timeout(1500)
    check('Delete all returns to set-up', 'Your farm' in p2.locator('body').inner_text())
    b.close()
for r in res: print('PASS' if r[1] else 'FAIL', r[0], r[2][:200])
print('errors', errs[:5])
