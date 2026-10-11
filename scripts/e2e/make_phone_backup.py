"""Makes a real phone backup for the import tests (src/lib/testing/fixtures/phone-backup.json).
Drives the phone-only build like a farmer: set-up, a feed with a plan, a delivery on account,
a paid vet bill, a contractor bill overdue, a milk cheque, a head count change, today's feeding
ticked, then Settings > Back up.
Usage: npm run build:phone && python3 scripts/e2e/make_phone_backup.py file://$PWD/dist-phone/index.html src/lib/testing/fixtures/phone-backup.json"""
import sys,re,os,datetime
from playwright.sync_api import sync_playwright
URL=sys.argv[1]
OUTFILE=sys.argv[2]
def dump(pg,tag):
    print('=====',tag, pg.url)
    print(pg.evaluate("""()=>{const o=[];document.querySelectorAll('main button, main input, main select, main textarea, main label').forEach(e=>{const t=(e.getAttribute('aria-label')||e.innerText||e.getAttribute('name')||'').replace(/\\s+/g,' ').slice(0,50); o.push(e.tagName[0]+':'+t+(e.id&&!e.id.startsWith(':')?'#'+e.id:''))}); return o.join(' | ')}"""))
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    ctx=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
    pg=ctx.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
    def go(h): pg.goto(URL+'#'+h); pg.wait_for_timeout(900)
    pg.goto(URL); pg.wait_for_timeout(800)
    pg.get_by_label('Farm name').fill('Phone Farm'); pg.select_option('#county','Tipperary')
    pg.get_by_role('button',name='Next').click()
    pg.get_by_role('button',name=re.compile('^Dairy')).click()
    pg.get_by_role('button',name='Next').click(); pg.wait_for_timeout(300)
    for _ in range(3): pg.get_by_role('button',name='Increase How many dairy cows').click()
    pg.get_by_role('button',name='Next').click(); pg.wait_for_timeout(300)
    pg.get_by_label('Money in the bank today (optional)').fill('20000')
    pg.get_by_role('button',name='Start using Agri-It').click(); pg.wait_for_timeout(1200)
    go('/feed/new')
    pg.get_by_label('Feed name').fill('Dairy nut 16%')
    pg.get_by_role('button',name='Dairygold Agri Business').click()
    pg.locator('#qty').fill('2')
    pg.get_by_role('button',name='Next: who eats it').click(); pg.wait_for_timeout(1000)
    pg.get_by_role('button',name=re.compile('^Dairy cows')).click()
    for _ in range(4): pg.get_by_role('button',name='Increase kg per head per feed').click()
    pg.get_by_role('button',name='Twice').click()
    pg.get_by_role('button',name='Save plan').click(); pg.wait_for_timeout(1000)
    feed_url=pg.url
    go('/record/delivery'); 
    pg.get_by_role('button',name='Dairy nut 16%').click()
    pg.locator('#qty').fill('6')
    pg.get_by_role('button',name='Yesterday').click()
    pg.get_by_role('button',name='Dairygold Agri Business').click()
    pg.get_by_label('Price per tonne').fill('395')
    pg.wait_for_timeout(300)
    pg.get_by_role('button',name=re.compile('^On account')).click()
    pg.locator('#due').fill((datetime.date.today()+datetime.timedelta(days=20)).isoformat())
    pg.get_by_role('button',name='Docket').click()
    pg.get_by_role('button',name='Save delivery').click(); pg.wait_for_timeout(1200)
    # A vet bill paid today
    go('/record/cost')
    pg.get_by_role('button',name='Vet & medicine').click(); pg.get_by_label('Amount').fill('245.50')
    pg.get_by_role('button',name='Paid',exact=True).click(); pg.get_by_label('Paid to').fill('Clonmel Vets')
    pg.get_by_label('Invoice no. (optional)').fill('INV-1001')
    pg.get_by_role('button',name='Save cost').click(); pg.wait_for_timeout(1000)
    # A contractor bill still to pay
    go('/record/cost')
    pg.get_by_role('button',name='Contractor').click(); pg.get_by_label('Amount').fill('1800')
    pg.get_by_role('button',name='Still to pay').click(); pg.get_by_label('Paid to').fill('Ryan Contracting')
    pg.wait_for_timeout(300)
    pg.locator('#due').fill((datetime.date.today()-datetime.timedelta(days=3)).isoformat())
    pg.get_by_role('button',name='Save cost').click(); pg.wait_for_timeout(1000)
    # Milk cheque
    go('/record/milk')
    pg.get_by_label('Amount received').fill('9100'); pg.get_by_label('Litres (optional)').fill('21000'); pg.get_by_label('Processor').fill('Tirlan')
    pg.get_by_role('button',name='Save milk cheque').click(); pg.wait_for_timeout(1000)
    # Head count: one more cow from today
    go('/farm/groups')
    pg.get_by_role('button',name='Increase Head').first.click(); pg.wait_for_timeout(300)
    pg.get_by_role('button',name='Save 16 head').click(); pg.wait_for_timeout(800)
    # Tick today's feeding in the diary
    go('/diary'); 
    pg.get_by_role('button',name=re.compile('^Fed 96 kg')).click(); pg.wait_for_timeout(800)
    go('/settings')
    with pg.expect_download() as d: pg.get_by_role('button',name='Back up').click()
    d.value.save_as(OUTFILE); print('saved', OUTFILE)
    b.close()
print('errors',errs[:3])
