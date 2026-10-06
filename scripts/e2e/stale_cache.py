"""White-page regression: older cached data in the browser must never blank the app."""
import sys, json
from playwright.sync_api import sync_playwright
URL=sys.argv[1]; res=[]
def check(n,c,d=''): res.append((n,bool(c),d))
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell')
    def run(label, mutate, buster=None, dbv=None):
        c=b.new_context(viewport={'width':390,'height':844}); pg=c.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL); pg.locator('main').first.wait_for(timeout=10000); pg.wait_for_timeout(1500)
        d=json.loads(pg.evaluate("localStorage.getItem('agri-it:cache')"))
        for q in d['clientState']['queries']:
            if q['queryKey'][0]=='bundle': mutate(q['state']['data'])
        if buster: d['buster']=buster
        pg.evaluate("c=>localStorage.setItem('agri-it:cache',c)", json.dumps(d))
        if dbv: pg.evaluate("v=>{const x=JSON.parse(localStorage.getItem('agri-it:demo-db'));x.v=v;localStorage.setItem('agri-it:demo-db',JSON.stringify(x))}", dbv)
        errs.clear(); pg.reload(); pg.wait_for_timeout(2500)
        return pg, errs
    def strip(dd):
        for k in ['feedLogs','routines','completions']: dd.pop(k,None)
    pg,e=run('old version', strip, buster='v1', dbv=2)
    check('Old v1 cache + v2 demo data: Today renders', pg.get_by_label('Farm at a glance').count()==1 and "Today's jobs" in pg.locator('main').inner_text(), str(e))
    check('Old v1 cache: no page errors', not e, str(e))
    pg,e=run('missing lists, current buster', strip)
    check('Cache missing new lists still renders', pg.get_by_label('Farm at a glance').count()==1, str(e))
    pg,e=run('broken', lambda dd: dd.update(farm=None))
    t=pg.locator('body').inner_text()
    check('Crash shows recovery screen, not white', 'Something went wrong' in t and 'Reset demo and reload' in t, t[:300])
    pg.screenshot(path='boundary.png')
    pg.get_by_role('button', name='Reset demo and reload').click(); pg.wait_for_timeout(3000)
    check('Reset recovers to Today', pg.get_by_label('Farm at a glance').count()==1, pg.locator('body').inner_text()[:200])
    b.close()
for n,ok,d in res: print(('PASS ' if ok else 'FAIL ')+n+('' if ok else '  <- '+d[:300]))
