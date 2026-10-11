import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(__dirname, '../..');
const requireApp = createRequire(resolve(app, 'package.json'));
const esbuild = createRequire(requireApp.resolve('tsx/package.json'))('esbuild');
const src = resolve(app, 'src');
const mocks: Record<string, string> = {
  '@tanstack/react-query': `export const useQuery=()=>({});`,
  '@/lib/activityReceipt': `export const loadActivityReceipt=async()=>({});`,
  'next/link': `import React from 'react'; export default function Link(props) { return <a {...props}/>; }`,
  'next/navigation': `export const useRouter=()=>({push(){},replace(){},back(){}});`,
  '@/components/ui': `import React from 'react'; export const SectionTitle=({children,right})=><header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h2>{children}</h2>{right}</header>; export const AppShell=({children,title})=><main><h1>{title}</h1>{children}</main>;`,
  '@/lib/useWalletActivity': `export const useWalletActivity=()=>({...window.H.activity,refetch:async()=>{},loadMore:async()=>{}});`,
  '@/lib/fx/drafts': `export const cancelSignatureRequiredDraft=()=>{}; export const signatureDraftResumePath=()=>'/trade';`,
  '@/components/BridgeTracker': `export const BridgeTracker=()=>null;`,
  '@/lib/wallet': `export const usePrivyWallet=()=>window.H.wallet;`,
  '@/components/WalletDataProvider': `export const useWalletAssets=()=>window.H.assets;`,
  '@/components/WalletDemandProvider': `export const useWalletDemand=()=>{};`,
  '@/lib/walletAssets': `export const canonicalAsset=()=>({key:'ETH',decimals:18});`,
  '@/components/WalletConnectCTA': `import React from 'react'; export default ()=> <button>Connect wallet</button>;`,
  '@/lib/walletSend': `export async function prepareWalletSend(input) { window.H.prepares++; window.H.preparedInputs.push(input); await new Promise(r=>setTimeout(r,30)); return {input,symbol:'ETH',decimals:18,amountRaw:100000000000000000n,to:input.recipient,data:'0x',value:100000000000000000n,gas:25200n,nonce:7,estimatedFee:window.H.fee??252000000000000n,requiredNative:100600000000000000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:1000000000n,validUntil:Date.now()+30000}; }`,
  '@/lib/fx/journal': `export const recordPendingHash=(record)=>{window.H.records.push(record);};`,
  './fx/tokens': `export const FX_TOKENS={ ETH:{key:'ETH',address:'0x0000000000000000000000000000000000000000',decimals:18,native:true}, fxUSD:{key:'fxUSD',address:'0x3333333333333333333333333333333333333333',decimals:18,native:false}};`,
};
mocks['./ui'] = mocks['@/components/ui'];
mocks['./BridgeTracker'] = mocks['@/components/BridgeTracker'];
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import Activity from '@/components/WalletActivity'; import Send from '@/app/send/page';
const address='0x1111111111111111111111111111111111111111', other='0x2222222222222222222222222222222222222222';
const hash='0x'+'a'.repeat(64);
window.H={prepares:0,sends:[],records:[],mode:'history',activity:{isPending:false,isFetching:false,hasMore:false,data:{views:[],protocol:{items:[]},drafts:[],partial:false,transfers:[{id:'incoming',chainId:1,hash,timestamp:1791000000000,from:other,to:address,amountRaw:123000000000000000n,symbol:'ETH',decimals:18,tokenAddress:null}]}},wallet:{address,ready:true,authenticated:true,connectionVersion:1,isEmbedded:true,sendTransaction:async(req)=>{window.H.sends.push(req);await new Promise(r=>setTimeout(r,100));return {hash};}},assets:{status:'ready',refresh:async()=>{},data:{assets:[{id:'eth',chainId:1,tokenAddress:null,symbol:'ETH',decimals:18,balanceWei:1000000000000000000n,balance:'1'}]}}};
function App(){const[,update]=React.useReducer(x=>x+1,0);window.H.render=update;return <div style={{maxWidth:900,margin:'auto',padding:16}}><button onClick={()=>{window.H.mode='send';update();}}>Test send</button>{window.H.mode==='history'?<Activity walletAddress={window.H.wallet.address}/>:<Send/>}</div>}; createRoot(document.getElementById('root')).render(<App/>);`;
let bundle: { js: string; css: string };
test.beforeAll(async () => {
  const result = await esbuild.build({ stdin: { contents: entry, resolveDir: app, loader: 'tsx' }, bundle: true, write: false, outdir: 'harness', format:'iife', jsx:'automatic', platform:'browser', target:'es2020', loader:{'.module.css':'local-css'},
    plugins:[{name:'fixtures',setup(build: { onResolve: (opts: {filter:RegExp}, cb:(args:{path:string})=>unknown)=>void; onLoad:(opts:{filter:RegExp;namespace:string},cb:(args:{path:string})=>unknown)=>void }) {
      build.onResolve({filter:/.*/},({path})=> {
        if(mocks[path])return {path,namespace:'fixture'};
        if(path.startsWith('@/')) { const file=resolve(src,path.slice(2)); for(const ext of ['', '.tsx','.ts'])if(existsSync(file+ext))return {path:file+ext}; }
        return undefined;
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:mocks[path],loader:'tsx',resolveDir:app}));
    }}],
  });
  bundle={js:result.outputFiles.find((f:{path:string})=>f.path.endsWith('.js')).text,css:result.outputFiles.find((f:{path:string})=>f.path.endsWith('.css')).text};
});
async function mount(page: import('@playwright/test').Page) {
  await page.route('**/*', async route => {
    const url=new URL(route.request().url());
    if(/^\/(token|chain)-icons\/[^/]+$/.test(url.pathname)) {const path=resolve(app,'public',url.pathname.slice(1)); if(existsSync(path)){await route.fulfill({body:readFileSync(path),contentType:path.endsWith('.svg')?'image/svg+xml':'image/png'});return;}}
    await route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
  });
    await page.goto('http://localhost:49999');
  await page.addStyleTag({content:`*{box-sizing:border-box}body{margin:0;background:#101016;color:#f4f2fa;font:14px system-ui}button,input,select{font:inherit;color:inherit;border:0;background:none}button,a,summary{cursor:pointer}a{color:inherit;text-decoration:none}h1,h2,p{margin:0}svg{flex-shrink:0}button:disabled{cursor:default} .sr-only{position:absolute;width:1px;height:1px;overflow:hidden} :root{--bg:#101016;--surface:#181721;--surface-2:#23212e;--line:#34313f;--text:#f4f2fa;--mut:#aaa5b9;--mint:#bda3ff;--mint-dim:#bda3ff20;--danger:#ff687e;--motion-enter:100ms;--motion-exit:80ms;--motion-ease:cubic-bezier(.2,.8,.2,1)} ${bundle.css}`});
  await page.addScriptTag({content:bundle.js});
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    h.preparedInputs = [];
    h.refreshes = 0;
    h.assets.isFetching = false;
    h.assets.data!.networks = { 1: { status: 'ready' }, 8453: { status: 'ready' } };
    h.assets.refresh = async () => {
      h.refreshes++;
      h.assets.isFetching = true;
      h.render();
      await new Promise<void>((resolve) => { h.finishRefresh = resolve; });
      h.assets.isFetching = false;
      h.render();
    };
  });
}

type SendHarness = {
  prepares: number;
  preparedInputs: Array<{ chainId: number; tokenAddress: string | null; amount: string; recipient: string }>;
  refreshes: number;
  finishRefresh?: () => void;
  render: () => void;
  wallet: { address: string; connectionVersion: number };
  assets: {
    status: string;
    isFetching: boolean;
    refresh: () => Promise<void>;
    data: {
      assets: Array<{ id: string; chainId: number; tokenAddress: string | null; symbol: string; decimals: number; balanceWei: bigint; balance: string }>;
      networks: Record<number, { status: string }>;
    } | null;
  };
};

test('send keeps its chosen token and network when live holdings reorder, then requires explicit reselection after depletion', async ({ page }) => {
  await mount(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: 'Test send' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('0.1');
  await page.getByLabel('Recipient address').fill('0x2222222222222222222222222222222222222222');
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    const ethereum = h.assets.data!.assets[0];
    h.assets.data!.assets = [{ ...ethereum, id: 'base-eth', chainId: 8453, balance: '2', balanceWei: 2n * 10n ** 18n }, ethereum];
    h.render();
  });
  await expect(page.getByRole('button', { name: 'Asset to send: ETH on Ethereum', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review send' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { H: SendHarness }).H.preparedInputs[0])).toMatchObject({ chainId: 1, tokenAddress: null, amount: '0.1' });
  await page.getByRole('button', { name: 'Edit transfer' }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    // An authoritative zero removes the row entirely, just as the real merger does.
    h.assets.data!.assets = h.assets.data!.assets.filter((asset) => asset.chainId === 8453);
    h.render();
  });
  await expect(page.getByRole('button', { name: 'Asset to send: ETH on Ethereum', exact: true })).toBeVisible();
  await expect(page.getByText('Available: 0 ETH')).toBeVisible();
  await expect(page.getByRole('button', { name: 'No ETH to send', exact: true })).toBeDisabled();
  await page.getByLabel('Amount', { exact: true }).press('Enter');
  expect(await page.evaluate(() => (window as unknown as { H: SendHarness }).H.prepares)).toBe(1);
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('0.1');
  await page.getByRole('button', { name: 'Asset to send: ETH on Ethereum', exact: true }).click();
  await page.getByRole('option', { name: 'ETH on Base', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Asset to send: ETH on Base', exact: true })).toBeVisible();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Recipient address')).toHaveValue('0x2222222222222222222222222222222222222222');
});

test('send distinguishes loading, failed and verified empty holdings; retry preserves inputs and runs once', async ({ page }, info) => {
  await mount(page);
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    h.assets.data = null;
    h.assets.status = 'loading';
  });
  await page.getByRole('button', { name: 'Test send' }).click();
  await expect(page.getByRole('button', { name: 'Loading assets', exact: true })).toBeDisabled();
  await page.getByLabel('Amount', { exact: true }).fill('0.25');
  await page.getByLabel('Recipient address').fill('0x2222222222222222222222222222222222222222');
  for (const status of ['unavailable', 'partial']) {
    await page.evaluate((status) => { const h = (window as unknown as { H: SendHarness }).H; h.assets.status = status; h.render(); }, status);
    await expect(page.getByText('Couldn’t load balances', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check balances', exact: true })).toBeDisabled();
    await expect(page.getByText('No assets', { exact: true })).toHaveCount(0);
  }
  for (const width of [320, 393, 412, 480]) {
    await page.setViewportSize({ width, height: 818 });
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`send-unavailable-${width}.png`) });
  }
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { H: SendHarness }).H.refreshes)).toBe(1);
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    h.assets.status = 'ready';
    h.assets.data = { assets: [], networks: { 1: { status: 'ready' }, 8453: { status: 'ready' } } };
    h.finishRefresh?.();
  });
  await expect(page.getByRole('button', { name: 'No assets to send', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('Recipient address')).toHaveValue('0x2222222222222222222222222222222222222222');
});

test('send rechecks retained holdings but never turns an unavailable selected balance into zero', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Test send' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('0.1');
  await page.getByLabel('Recipient address').fill('0x2222222222222222222222222222222222222222');
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    h.assets.status = 'unavailable';
    h.assets.data!.networks[1].status = 'unavailable';
    h.render();
  });
  await expect(page.getByText('Last checked: 1 ETH')).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review send' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { H: SendHarness }).H.prepares)).toBe(1);
  await page.getByRole('button', { name: 'Edit transfer' }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    h.assets.data!.assets = [];
    h.render();
  });
  await expect(page.getByText('Balance unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Available: 0 ETH')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check ETH balance', exact: true })).toBeDisabled();
  await page.getByLabel('Amount', { exact: true }).press('Enter');
  expect(await page.evaluate(() => (window as unknown as { H: SendHarness }).H.prepares)).toBe(1);
  await page.evaluate(() => {
    const h = (window as unknown as { H: SendHarness }).H;
    h.assets.status = 'loading';
    h.assets.data!.networks[1].status = 'pending';
    h.render();
  });
  await expect(page.getByText('Checking balances…', { exact: true })).toBeVisible();
  await expect(page.getByText('Couldn’t refresh balances', { exact: true })).toHaveCount(0);
});
test('history detail fits short/mobile/desktop, closes with focus restored, and filters without extra sections',async({page},info)=>{
  await mount(page);
  for(const size of [{width:320,height:568},{width:393,height:852},{width:1280,height:800}]) {
    await page.setViewportSize(size);
    const row=page.getByRole('button').filter({hasText:'Received'});
    await row.click();
    const dialog=page.getByRole('dialog',{name:'Transaction details'});
    await expect(dialog.getByText('0.123 ETH')).toBeVisible();
    await expect(dialog.getByText('Confirmed',{exact:true})).toHaveCount(0);
    await expect.poll(async()=>{const bounds=await dialog.boundingBox();return bounds ? bounds.y+bounds.height : Infinity;}).toBeLessThanOrEqual(size.height+1);
    const bounds=await dialog.boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0);
    await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
    await page.screenshot({path:info.outputPath('history-detail-'+size.width+'.png')});
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(row).toBeFocused();
  }
  await page.getByRole('textbox',{name:'Search activity'}).fill('unknown'); await expect(page.getByText('No matching activity')).toBeVisible();
  await expect(page.getByText('Saved transactions')).toHaveCount(0);
});
test('send reviews recipient first, submits once, and applies gas tiers only to embedded wallets',async({page})=>{
  await mount(page); await page.setViewportSize({width:393,height:852});
  await page.getByRole('button',{name:'Test send'}).click();
  await page.getByLabel('Amount',{exact:true}).fill('0.1'); await page.getByLabel('Recipient address').fill('0x2222222222222222222222222222222222222222');
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review send'})).toBeVisible();
  expect(await page.evaluate(()=> (window as unknown as {H:{sends:unknown[]}}).H.sends.length)).toBe(0);
  await page.getByRole('button',{name:'Confirm',exact:true}).dblclick(); await expect(page.getByRole('heading',{name:'Submitted'})).toBeVisible();
  const sent=await page.evaluate(()=> (window as unknown as {H:{sends:Array<{nonce:number;maxFeePerGas:bigint}>;records:Array<{operation:string}>}}).H);
  expect(sent.sends).toHaveLength(1); expect(sent.sends[0].nonce).toBe(7); expect(sent.sends[0].maxFeePerGas).toBe(20000000000n); expect(sent.records[0].operation).toBe('sendAsset');
  await mount(page);
  await page.evaluate(()=>{const h=(window as unknown as {H:{wallet:{isEmbedded:boolean};render:()=>void}}).H;h.wallet.isEmbedded=false;h.render();});
  await page.getByRole('button',{name:'Test send'}).click(); await expect(page.getByRole('group',{name:'Network speed'})).toHaveCount(0);
  await page.getByLabel('Amount',{exact:true}).fill('0.1'); await page.getByLabel('Recipient address').fill('0x2222222222222222222222222222222222222222'); await page.getByRole('button',{name:'Review',exact:true}).click(); await page.getByRole('button',{name:'Confirm',exact:true}).click(); await expect(page.getByRole('heading',{name:'Submitted'})).toBeVisible();
  expect(await page.evaluate(()=>Object.keys((window as unknown as {H:{sends:object[]}}).H.sends[0]))).not.toContain('maxFeePerGas');
});
test('send reviews the exact amount it signs, rounds its cost up, and opens on Enter',async({page})=>{
  await mount(page); await page.setViewportSize({width:320,height:640});
  await page.evaluate(()=>{(window as unknown as {H:{fee:bigint}}).H.fee=252000000000001n;});
  await page.getByRole('button',{name:'Test send'}).click();
  await expect(page.getByText('Available: 1 ETH')).toBeVisible();
  const amount=page.getByLabel('Amount',{exact:true});
  await amount.fill('0.123456789012345678');
  // The recipient is still missing: Enter does nothing and the action names what is needed.
  await amount.press('Enter');
  await expect(page.getByRole('button',{name:'Enter a recipient',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>(window as unknown as {H:{prepares:number}}).H.prepares)).toBe(0);
  const recipient=page.getByLabel('Recipient address');
  await recipient.fill('0x2222222222222222222222222222222222222222');
  await recipient.press('Shift+Enter');
  await expect(recipient).toHaveValue('0x2222222222222222222222222222222222222222');
  expect(await page.evaluate(()=>(window as unknown as {H:{prepares:number}}).H.prepares)).toBe(0);
  await recipient.press('Enter');
  await expect(page.getByRole('heading',{name:'Review send'})).toBeVisible();
  // Every digit that will be signed, stepped down to fit the narrowest card instead of overflowing it.
  const signed=page.getByText('0.123456789012345678 ETH',{exact:true});
  await expect(signed).toBeVisible();
  const fit=await signed.evaluate((element)=>{const card=element.closest('section')!.getBoundingClientRect();const box=element.getBoundingClientRect();return {inside:box.left>=card.left-1&&box.right<=card.right+1,overflow:element.scrollWidth-element.clientWidth};});
  expect(fit).toEqual({inside:true,overflow:0});
  // 0.000252000000000001 ETH is an estimate: rounded up to three significant digits, never down.
  await expect(page.getByText('≈ 0.000253 ETH',{exact:true})).toBeVisible();
});
