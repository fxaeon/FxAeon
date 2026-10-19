"""Offline design regression checks; not live-wallet or production protocol tests."""
from __future__ import annotations
import json, os, shutil, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'FxAeon-journeys.html').read_text()
RESULTS=ROOT/'tests'/'browser-results.json'
PREVIEWS=ROOT/'previews';PREVIEWS.mkdir(exist_ok=True)
checks=[];errors=[];requests=[]
def check(condition: bool, name: str, detail=None):
    checks.append({'name':name,'passed':bool(condition),**({'detail':detail} if detail is not None else {})})
    if not condition: raise AssertionError(name+(f': {detail}' if detail else ''))

def state(page): return page.evaluate('Preview.state()')
def current(page): return state(page)['operations'][0]
def event(page, name): page.evaluate('(e)=>Preview.event(e)',name)
def begin(page, kind, values=None): page.evaluate('([k,v])=>Preview.begin(k,v)',[kind,values or {}])
def finish(page):
    event(page,'PROCEED')
    approval=current(page)['signature']=='approval'
    event(page,'SIGN')
    if approval:
        event(page,'APPROVED');event(page,'PROCEED');event(page,'SIGN')
    event(page,'SETTLED')

def reset(page):page.evaluate('Preview.reset()')
def load(browser, width=390,height=844, storage=None):
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append(r.url) if not r.url.startswith('data:') else None)
    content=HTML
    if storage is not None:
        # Explicit test double: set_content has an opaque origin and cannot prove real persistence.
        payload=json.dumps(storage).replace('<','\\u003c')
        shim=f"<script>const values={payload};Object.defineProperty(window,'localStorage',{{value:{{getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=v,removeItem:k=>delete values[k]}}}});</script>"
        content=content.replace('<script>',shim+'<script>',1)
    page.set_content(content,wait_until='load')
    page.wait_for_function('()=>Boolean(window.Preview)')
    return page

def fit(page, name, modal=False):
    metrics=page.evaluate('''(modal)=>{const vw=innerWidth,vh=innerHeight;
      const primary=modal?document.querySelector('#transaction .sheet-footer .primary'):null;
      const rect=primary?.getBoundingClientRect();
      const bodies=modal?[document.querySelector('#transaction .sheet-body')]:[document.querySelector('#content')];
      return {width:vw,height:vh,doc:document.documentElement.scrollWidth,
      cta:rect?{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}:null,
      overflow:bodies.filter(Boolean).some(el=>el.scrollWidth>el.clientWidth+2)};}''',modal)
    check(metrics['doc']<=metrics['width']+2 and not metrics['overflow'], name+' · horizontal fit',metrics)
    if modal:
        r=metrics['cta']
        check(bool(r) and r['x']>=0 and r['right']<=metrics['width']+1 and r['y']>=0 and r['bottom']<=metrics['height']+1 and r['height']>=44,name+' · visible primary action',metrics)

def run():
    with sync_playwright() as p:
        executable=os.environ.get('CHROMIUM') or shutil.which('chromium')
        kwargs={'headless':True,'args':['--no-sandbox']}
        if executable: kwargs['executable_path']=executable
        browser=p.chromium.launch(**kwargs)
        try:
            actions=[('trade',{'amount':'1200','leverage':3}),('trade',{'amount':'1200','leverage':3,'asset':'BTC'}),('deposit',{'amount':'1000'}),('withdraw',{'amount':'500'}),('borrow',{'amount':'600'}),('repay',{'amount':'300'}),('collateral',{'amount':'0.25'}),('remove',{'amount':'0.1'}),('leverage',{'amount':'2','leverage':2}),('increase',{'amount':'300'}),('reduce',{'amount':'50'}),('close',{})]
            for width,height in [(320,568),(360,740),(390,844),(412,915),(730,900),(768,1024),(1440,900)]:
                page=load(browser,width,height)
                for view in ['trade','earn','borrow','positions','history']:
                    page.evaluate('(v)=>Preview.go(v)',view);page.wait_for_timeout(30)
                    fit(page,f'{view} {width}×{height}')
                for index,(kind,values) in enumerate(actions):
                    reset(page);begin(page,kind,values)
                    fit(page,f'{kind}:{index} review {width}×{height}',True)
                    finish(page)
                    fit(page,f'{kind}:{index} receipt {width}×{height}',True)
                reset(page);begin(page,'withdraw',{'amount':'500'});finish(page);page.evaluate('Preview.close();Preview.claimReady()');begin(page,'claim');
                fit(page,f'claim review {width}×{height}',True);finish(page);fit(page,f'claim receipt {width}×{height}',True)
                page.close()
            page=load(browser)
            # Product inputs and consequence hierarchy.
            page.locator('#amount').fill('');check(page.locator('#review-button').is_disabled(),'Empty input cannot start review')
            page.locator('#amount').fill('1234.567891');check(not page.locator('#review-button').is_disabled(),'Six-decimal amount is accepted')
            page.locator('#review-button').click();check('1,234.567891 fxUSD' in page.locator('#transaction').inner_text(),'Review preserves entered amount precision')
            page.locator('#edit-details').click();check(not page.locator('#transaction').is_visible(),'Edit details closes unsent review')
            check(current(page)['stage']=='cancelled','Editing has not sent the action')
            reset(page);page.evaluate("Preview.go('trade')");page.locator('#amount').fill('1200');page.locator('#review-button').click()
            page.locator('#proceed').click();check(current(page)['signature']=='approval','Review starts approval, not action')
            page.locator('#sign').click();page.wait_for_function("()=>Preview.state().operations[0].stage==='review'")
            check(current(page)['approved'] and state(page)['wallet']['fxUSD']==8000,'Approval retains fxUSD in wallet')
            page.locator('#proceed').click();page.locator('#decline').click();check(current(page)['approved'],'Declined action preserves approval')
            page.locator('#retry-review').click();page.locator('#proceed').click();check(current(page)['signature']=='action','Retry does not request duplicate approval')
            page.locator('#sign').click();page.wait_for_function("()=>Preview.state().operations[0].stage==='complete'")
            check(len(state(page)['positions'])==2 and state(page)['wallet']['fxUSD']==6800,'Trade receipt and position share sample result')
            check(abs(state(page)['wallet']['ETH']-2.49974)<1e-7,'Approval plus action network fees charged once')
            page.locator('#view-history').click();page.wait_for_timeout(50);check('ETH long opened' in page.locator('#history-rows').inner_text(),'Receipt appears in History')
            # Fee changes need explicit acceptance and another review action.
            reset(page);begin(page,'borrow',{'amount':'600'});page.evaluate("Preview.scenario('quote')");page.locator('#proceed').click();check(current(page)['stage']=='quote','Changed fee blocks wallet request')
            check('0.00042 ETH' in page.locator('.quote-compare').inner_text() and '0.00048 ETH' in page.locator('.quote-compare').inner_text(),'Fee change shows before and after')
            page.locator('#proceed').click();check(current(page)['stage']=='review' and current(page)['signature'] is None,'Accept fee returns to review without wallet')
            # Keep pending transaction identity when closed and reopened.
            reset(page);begin(page,'borrow',{'amount':'600'});event(page,'PROCEED');event(page,'SIGN');original=current(page)['id'];page.evaluate("Preview.close();Preview.go('history')")
            check('+' not in page.locator(f'[data-record="{original}"] .history-value').inner_text(),'Pending amount is not presented as received');page.locator(f'[data-record="{original}"]').click();check(current(page)['id']==original and current(page)['stage']=='pending','Reopen pending keeps operation identity')
            event(page,'UNKNOWN');check(page.locator('#check-status').inner_text()=='Check transaction status','Unknown status offers checking, not resend')
            page.locator('#check-status').click();page.wait_for_function("()=>Preview.state().operations[0].stage==='complete'")
            check(len(state(page)['operations'])==1 and state(page)['loan']['debt']==1800,'Checking settles existing operation exactly once')
            # Finish in background while a different sample receipt is open.
            reset(page);begin(page,'borrow',{'amount':'600'});page.locator('#proceed').click();page.locator('#sign').click();page.evaluate("Preview.close();Preview.go('history')")
            page.locator('[data-record="seed-1"]').click();title=page.locator('#dialog-title').inner_text();page.wait_for_timeout(1000)
            check(page.locator('#dialog-title').inner_text()==title,'Background settlement does not replace another receipt')
            check(state(page)['loan']['debt']==1800,'Background settlement still updates account')
            # Confirmed, but destination observation is not yet available.
            reset(page);begin(page,'leverage',{'amount':'2','leverage':2});event(page,'PROCEED');event(page,'SIGN');event(page,'CONFIRMED_UNREAD')
            check(current(page)['stage']=='confirmed-unread' and state(page)['positions'][0]['debt']==2400,'Missing observation does not promote quote to position fact')
            check(page.locator('#check-status').inner_text()=='Refresh position','Confirmed-unread exposes refresh action')
            page.locator('#check-status').click();page.wait_for_function("()=>Preview.state().operations[0].stage==='complete'")
            check(state(page)['positions'][0]['debt']==1200,'Position refresh applies observed sample')
            # Savings round-trip and split claim.
            reset(page);begin(page,'deposit',{'amount':'1000'});finish(page);page.evaluate('Preview.close()');begin(page,'withdraw',{'amount':'500'});finish(page)
            check(state(page)['wallet']['fxUSD']==7000 and state(page)['queue'] is not None,'Withdrawal request does not create a payout')
            check(page.locator('#dialog-title').inner_text()=='Withdrawal requested','Queued request has truthful receipt')
            page.evaluate("Preview.close();Preview.claimReady();Preview.go('earn')");page.wait_for_timeout(30)
            page.locator('[data-begin-claim]:visible').click();check('USDC' in page.locator('#transaction').inner_text(),'Claim retains distinct payout assets')
            finish(page);check(state(page)['wallet']['fxUSD']==7450 and state(page)['wallet']['USDC']==112.5 and state(page)['queue'] is None,'Claim updates both assets and clears queue')
            # Revert fee is not a successful token flow.
            reset(page);begin(page,'borrow',{'amount':'600'});event(page,'PROCEED');event(page,'SIGN');event(page,'REVERTED')
            check(state(page)['wallet']['fxUSD']==8000 and state(page)['loan']['debt']==1200,'Revert does not change debt or payout')
            check(abs(state(page)['wallet']['ETH']-2.49974)<1e-7,'Reverted sample still pays observed gas')
            page.evaluate("Preview.close();Preview.go('history')");check(page.locator('[data-record]').first.locator('.history-value').inner_text()=='No token transfer','Reverted record does not invent a token movement')
            reset(page);begin(page,'close');finish(page);check(page.locator('#transaction .funding-bar').count()==0,'Closed position has no misleading debt composition bar')
            # Basic dialog keyboard behavior, not a full accessibility audit.
            reset(page);page.evaluate("Preview.go('trade')");page.locator('#review-button').click()
            for _ in range(20):page.keyboard.press('Tab')
            check(page.evaluate("document.querySelector('#transaction').contains(document.activeElement)"),'Tab remains inside native modal')
            page.keyboard.press('Escape');check(not page.locator('#transaction').is_visible(),'Escape closes dialog')
            check(page.evaluate("document.activeElement.id==='review-button'"),'Focus returns to review action after Escape')
            page.emulate_media(reduced_motion='reduce');check(page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),'Reduced-motion preference is available')
            # Search, filtering, and no invented records.
            reset(page);page.evaluate("Preview.go('history')");page.locator('#history-search').fill('zzzznothing');check(page.locator('.empty').is_visible(),'History has empty-search feedback')
            page.locator('#history-search').fill('');page.locator('#history-status').select_option('pending');check(page.locator('.empty').is_visible(),'No in-progress sample records is not fabricated')
            page.close()
            # Explicit storage-double restoration checks, not real localStorage coverage.
            fixture=load(browser);begin(fixture,'trade',{'amount':'1200'});event(fixture,'PROCEED');event(fixture,'SIGN');saved=state(fixture);fixture.close()
            restored=load(browser,storage={'fxaeon-design-v4':json.dumps(saved)})
            check(current(restored)['stage']=='unknown' and not current(restored)['approved'],'Reloading unknown approval does not infer an action submission')
            restored.evaluate("Preview.go('history')");restored.locator('[data-record]').first.click();restored.locator('#check-status').click();restored.wait_for_function("()=>Preview.state().operations[0].stage==='review'")
            check(current(restored)['approved'] and state(restored)['wallet']['fxUSD']==8000,'Recovered approval returns to action review')
            restored.close()
            # Selected actual renders, not generated marketing mock-ups.
            for width,height,suffix in [(390,844,'mobile'),(1440,1000,'desktop')]:
                pg=load(browser,width,height)
                for view in ['trade','earn','borrow','positions','history']:
                    reset(pg);pg.evaluate('(v)=>Preview.go(v)',view);pg.wait_for_timeout(80)
                    pg.screenshot(path=str(PREVIEWS/f'{view}-{suffix}.png'),full_page=True)
                for kind,values in [('trade',{'amount':'1200'}),('deposit',{'amount':'1000'}),('borrow',{'amount':'600'}),('leverage',{'amount':'2','leverage':2})]:
                    reset(pg);begin(pg,kind,values);pg.wait_for_timeout(80)
                    pg.screenshot(path=str(PREVIEWS/f'{kind}-review-{suffix}.png'))
                    finish(pg);pg.wait_for_timeout(80);pg.screenshot(path=str(PREVIEWS/f'{kind}-receipt-{suffix}.png'))
                pg.close()
            check(not errors,'No page runtime errors',errors)
            check(not requests,'No external requests from standalone preview',requests)
        finally:browser.close()

try:
    run();passed=True
except Exception as exc:
    errors.append(f'{type(exc).__name__}: {exc}');passed=False
finally:
    report={'passed':passed,'checks':len(checks),'passed_checks':sum(x['passed'] for x in checks),'results':checks,'errors':errors,'external_requests':requests,
    'boundaries':['Chromium renderer only; not physical devices or Telegram WebView.','Opaque-origin set_content; explicit storage double tested separately, not real browser persistence.','Sample execution model only; no wallet, RPC, production build, calldata or real financial correctness tested.','Selected screenshots visually inspected separately; layout checks do not prove aesthetic superiority.']}
    RESULTS.write_text(json.dumps(report,indent=2));print(json.dumps({k:report[k] for k in ['passed','checks','passed_checks','errors']},indent=2))
    if not passed:sys.exit(1)
