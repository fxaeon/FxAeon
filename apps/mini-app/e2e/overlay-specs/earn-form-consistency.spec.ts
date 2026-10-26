import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const root = resolve(__dirname, '../..');
const esbuild = createRequire(createRequire(resolve(root, 'package.json')).resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
// Real Earn form, settings gear and summary CSS; local fixtures supply the
// protocol reads/planners and review shell. No wallet or transaction execution.
const mocks: Record<string, string> = {
  'next/link': `export default ({href,children,...props}) => <a href={href} {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({push:(href) => {history.pushState({},'',href);globalThis.__earnHarness.navigate();}});`,
  '@/components/ui': `export const AppShell = ({children}) => <main style={{padding:16}}>{children}</main>;`,
  '@/components/ProductUI': `export const PageHeading = ({title}) => <h1>{title}</h1>; export const ProductNav = () => <nav>Products</nav>; export const ProductSurface = ({children,...props}) => <section {...props}>{children}</section>; export const Disclosure = ({title,children}) => <section aria-label={title}>{children}</section>; export const MetricRows = ({rows}) => <dl>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>; export const StatusNotice = ({title}) => <p>{title}</p>; export { ChoiceCards } from 'real:components/ProductUI';`,
  '@/components/ProductSections': `export const EarnSections = () => null;`,
  // History has its own built-route data/keyboard tests; this fixture owns settings.
  '@/components/FxSaveHistory': `export const FxSaveHistory = () => null;`,
  '@/components/TokenIcon': `export default () => <span />; export const ChainIcon = () => <span aria-hidden="true" />;`,
  '@/components/MissingValue': `export const MissingValue = () => <span>Unavailable</span>; export const ValueOrSkeleton = ({value}) => <span>{value}</span>;`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({status:'ready',prices:{fxUSDBasePool:1,fxUSD:1},refresh:async () => {}});`,
  '@/lib/displayPrices': `export const freshDisplayPrices = snapshot => snapshot.prices;`,
  '@/lib/fxSaveApy': `export const fetchFxSaveApy = async () => ({apy:6.25,observedAt:Date.now()});`,
  '@/lib/telegram': `export const haptic = () => {}; export const openExternalLink = () => false;`,
  '@/lib/fx/gasFeePolicy': `export const fetchGasTierQuotes = async (chainId) => { globalThis.__settingsGasReads = (globalThis.__settingsGasReads ?? 0) + 1; if (globalThis.__settingsGasFailure) throw new Error('Fixture gas rates unavailable'); const price = globalThis.__settingsGasPriceWei ?? 1n; return {chainId,fetchedAt:Date.now(),validUntil:Date.now()+30000,tiers:{standard:{gasPriceWei:price},fast:{gasPriceWei:price*2n},rapid:{gasPriceWei:price*3n}}}; };`,
  '@/lib/wallet': `import React from 'react'; export const usePrivyWallet = () => { const [connected,setConnected] = React.useState(globalThis.__earnWalletConnected !== false); React.useEffect(() => { const update = () => setConnected(globalThis.__earnWalletConnected !== false); window.addEventListener('earn-wallet-change',update); return () => window.removeEventListener('earn-wallet-change',update); },[]); return {address:connected ? '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : undefined,chainId:connected ? 1 : undefined,isEmbedded:true}; };`,
  '@/lib/earnPublicEstimate': `export const createEarnEstimateGuard = () => {let generation=0;return {next:() => ++generation,current:(request) => request === generation,invalidate:() => {generation++;}};};export const quotePublicFxSaveDeposit = async (_token, amount) => {globalThis.__earnQuoteCalls=(globalThis.__earnQuoteCalls ?? 0)+1;if(globalThis.__earnQuoteFailOnce && globalThis.__earnQuoteCalls===1)throw new Error('Fixture public read unavailable');return amount * 2n;};`,
  '@/components/WalletDataProvider': `const refresh = async () => {}; export const useFxSaveClaimable = () => ({status:'ready',data:{hasPendingRedeem:false},refresh});`,
  '@/components/ProtocolForm': `export const AmountField = ({label,value,onChange,tokenSelector,balanceState}) => <>{tokenSelector}<label>{label}<input aria-label={label} data-available={balanceState?.amount} value={value} onChange={event => onChange(event.target.value)} /></label></>; export const TokenSelect = ({value,onChange,options}) => <select aria-label="Earn asset" value={value} onChange={event => onChange(event.target.value)}>{options.map(token => <option key={token} value={token}>{token}</option>)}</select>; export const Segmented = ({options,onChange}) => <div>{options.map(option => <button key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; const refresh = async () => {}; const balancesFor = () => {const zero = new URLSearchParams(location.search).has('fixtureNoExternal'); const amount = zero ? '0' : '1000'; return {fxUSD:{status:'ready',amount},usdc:{status:'ready',amount},fxUSDBasePool:{status:'ready',amount}};}; export const useWalletTokenBalances = () => ({status:'ready',balances:balancesFor(),refresh});`,
  '@/components/ActionReview': `import React from 'react';import {usePrivyWallet} from '@/lib/wallet'; export const ActionReview = ({editor,planBuilder,resumeReview,onStageChange,label,blocker}) => {
    const wallet=usePrivyWallet();
    const [review,setReview] = React.useState(false); const resumed = React.useRef(false);
    const open = async () => {if (!planBuilder || blocker) return; await planBuilder();setReview(true);onStageChange('review');};
    React.useEffect(() => {if(resumeReview && planBuilder && !resumed.current){resumed.current=true;void open();}},[resumeReview,planBuilder]);
    return review ? <section aria-label="Earn review"><p>Review slippage: {globalThis.__earnHarness.plans.at(-1)?.slippage}%</p><button onClick={() => {setReview(false);onStageChange('input');}}>Edit</button></section> : <>{editor}<button disabled={Boolean(wallet.address) && (!planBuilder || Boolean(blocker))} onClick={wallet.address ? open : () => globalThis.__earnHarness.connect()}>{wallet.address ? label : 'Connect wallet'}</button></>;
  };`,
  '@/lib/fx': `
    // Wallet asset formatting needs real address/token identities, not live balances.
    export { assertAddress } from 'real:lib/fx/validation';
    export { resolveBridgeApprovalTokenAddress, resolveBridgeTokenAddress } from 'real:lib/fx/bridge';
    export const getPublicClient = () => { throw new Error('Live balance reads are outside the Earn form fixture'); };
    export const assertWalletAddress = () => {}; export const assertPublicClientChain = async () => {}; export const getEthereumClient = () => ({}); export const MAX_FX_SLIPPAGE_PERCENT = 2; export const assertConfiguredPublicClientChain = async () => {}; export const withReadDeadline = promise => promise;
    let configReads = 0;
    export const getFxReadFacade = () => ({getFxSaveConfig:async () => {
      if (new URLSearchParams(location.search).has('fixtureConfigFailure') && ++configReads === 1) throw new Error('Fixture vault read unavailable');
      return {cooldownPeriodSeconds:3600n,instantRedeemFeeRatio:1000000000000000n,expenseRatio:0n,harvesterRatio:100000n,threshold:100n*10n**18n,totalAssetsWei:1000n*10n**18n,totalSupplyWei:1000n*10n**18n};
    },getFxSaveBalance:async () => ({balanceWei:BigInt(new URLSearchParams(location.search).get('fixtureShares') ?? 600n*10n**18n),assetsWei:62045n*10n**16n}),getFxSaveRedeemStatus:async () => ({hasPendingRedeem:false})});
    export const signatureDraftIdFromSearch = search => new URLSearchParams(search).get('fxDraft');
    export const restoreSignatureRequiredDraftFromSearch = (search,scope) => new URLSearchParams(search).has('fxDraft') && scope.actionKey === (new URLSearchParams(search).get('fixtureMode') === 'deposit' ? 'earn:deposit' : 'earn:withdraw') ? ({draft:{resumePath:'/earn'},formState:{mode:new URLSearchParams(search).get('fixtureMode') === 'deposit' ? 'deposit' : 'withdraw',token:new URLSearchParams(search).get('fixtureToken') ?? 'fxUSD',amount:'10',shares:'10',instant:new URLSearchParams(search).get('fixtureInstant') !== 'false',slippage:new URLSearchParams(search).get('fixtureSlippage') ?? '2'}}) : undefined;
    export const planDepositFxSave = async input => {globalThis.__earnHarness.plans.push(input);return {};}; export const planWithdrawFxSave = planDepositFxSave; export const planRedeem = planDepositFxSave;`,
};
let script = '';
let css = '';

test.beforeAll(async () => {
  const result = await esbuild.build({
    stdin: {contents:`import React from 'react';import {createRoot,hydrateRoot} from 'react-dom/client';import {renderToString} from 'react-dom/server';import EarnPage from './src/app/earn/page';import {TransactionSettings} from './src/components/TransactionSettings';import {WalletProviderModeContext} from './src/lib/wallet/providerMode';
      const root = createRoot(document.getElementById('root'));
      // This fixture models an embedded wallet, including its app-managed gas settings.
      const render = content => root.render(<WalletProviderModeContext.Provider value="privy">{content}</WalletProviderModeContext.Provider>);
      const settingsTree = <WalletProviderModeContext.Provider value="privy"><TransactionSettings slippage /></WalletProviderModeContext.Provider>;
      globalThis.__earnHarness = {plans:[],connect:() => {globalThis.__earnWalletConnected=true;window.dispatchEvent(new Event('earn-wallet-change'));},disconnect:() => {globalThis.__earnWalletConnected=false;window.dispatchEvent(new Event('earn-wallet-change'));},showUncontrolled:() => render(<TransactionSettings slippage />),hydrateSettings:() => {const container=document.createElement('div');container.dataset.testid='settings-hydration-root';container.dataset.hydrationErrors='0';const saved=localStorage.getItem('fxaeon.settings.v1');localStorage.removeItem('fxaeon.settings.v1');container.innerHTML=renderToString(settingsTree);container.dataset.serverSummary=container.querySelector('button')?.getAttribute('aria-label') ?? '';if(saved!==null)localStorage.setItem('fxaeon.settings.v1',saved);document.body.append(container);const errors=[];hydrateRoot(container,settingsTree,{onRecoverableError:error=>{errors.push(String(error));container.dataset.hydrationErrors=String(errors.length);}});return {container,errors};},navigate:() => render(<button onClick={() => {history.pushState({},'', '/earn');render(<EarnPage />);}}>Return to Earn</button>)};
      render(<EarnPage />);`,loader:'tsx',resolveDir:root},
    bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',
    outdir:resolve(root,'test-results','earn-form-harness'),absWorkingDir:root,loader:{'.module.css':'local-css'},
    plugins:[{name:'earn-fixtures',setup(build:{
      onResolve:(options:{filter:RegExp},callback:(args:{path:string}) => unknown) => void;
      onLoad:(options:{filter:RegExp;namespace:string},callback:(args:{path:string}) => unknown) => void;
    }) {
      build.onResolve({filter:/^(@\/|next\/)/},({path}) => {
        if(mocks[path]) return {path,namespace:'fixture'};
        const base=resolve(root,'src',path.slice(2));
        return {path:[base,`${base}.ts`,`${base}.tsx`].find(existsSync) ?? base};
      });
      // A fixture re-exports a real module by a fixed alias, never by a path spliced into its source.
      build.onResolve({filter:/^real:/},({path}) => {
        const base=resolve(root,'src',path.slice('real:'.length));
        return {path:[`${base}.tsx`,`${base}.ts`].find(existsSync) ?? base};
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},({path}) => ({contents:mocks[path],loader:'tsx',resolveDir:root}));
    }}],
  });
  script=result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css=result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

async function mount(page:Page,resume=true,slippage='2',mode:'withdraw'|'deposit'='withdraw',fixture:{token?:string;instant?:boolean;shares?:string;noExternal?:boolean;configFailure?:boolean}={}) {
  await page.route('http://earn.test/**',route => route.fulfill({body:'<!doctype html><html><head></head><body><div id="root"></div></body></html>',contentType:'text/html'}));
  const shares = fixture.shares !== undefined ? `fixtureShares=${fixture.shares}` : '';
  const external = [fixture.noExternal ? 'fixtureNoExternal=1' : '', fixture.configFailure ? 'fixtureConfigFailure=1' : ''].filter(Boolean).join('&');
  await page.goto(`http://earn.test/earn${resume ? `?fxDraft=fixture${mode === 'deposit' ? '&fixtureMode=deposit' : ''}${slippage === '2' ? '' : `&fixtureSlippage=${slippage}`}${fixture.token ? `&fixtureToken=${fixture.token}` : ''}${fixture.instant === false ? '&fixtureInstant=false' : ''}${shares ? `&${shares}` : ''}${external ? `&${external}` : ''}` : shares || external ? `?${[shares, external].filter(Boolean).join('&')}` : ''}`);
  await page.evaluate(() => localStorage.setItem('fxaeon.settings.v1',JSON.stringify({slippageBps:50,gasTier:'standard'})));
  await page.addStyleTag({content:`*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;--fs-small:14px;--fs-caption:12px;--text:#111;--mut:#555;--surface:#fff;--surface-2:#eee;--line:#ccc;--success:#16803b;--radius-sm:8px;--dur-fast:0ms}button{font:inherit;border:0;padding:0;cursor:pointer;background:none}${css}`});
  await page.addScriptTag({content:script});
  if(resume) await expect(page.getByRole('region',{name:'Earn review'})).toContainText(`Review slippage: ${mode === 'deposit' || fixture.token === 'fxUSDBasePool' || fixture.instant === false ? '' : slippage}%`);
  else if (fixture.shares === '0') await expect(page.getByText('0 fxSAVE', { exact: true })).toBeVisible();
  else await expect(page.getByText(fixture.shares !== undefined ? /^[\d,.]+ fxSAVE$/ : '600 fxSAVE',{exact:true}).first()).toBeVisible();
}
async function openSettings(page:Page,percent:string) {
  await page.getByRole('button',{name:`Transaction settings, ${percent}% slippage`,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Transaction settings',exact:true});
  await expect(dialog.getByRole('textbox',{name:'Slippage tolerance percentage'})).toHaveValue(percent);
  // The dialog places its initial focus a frame after it paints; let that land
  // before typing, as a person would, so every run starts from the same state.
  await expect(dialog.getByRole('button',{name:'Close transaction settings',exact:true})).toBeFocused();
  return dialog;
}
async function storedSlippage(page:Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('fxaeon.settings.v1')!).slippageBps);
}

test('disconnected Earn keeps share-denominated vault assets in details, not the USD overview', async ({ page }) => {
  await mount(page, false);
  await page.evaluate(() => (globalThis as any).__earnHarness.disconnect());
  const overview = page.getByRole('region', { name: 'Your fxSAVE earnings', exact: true });
  await expect(overview.getByText('Vault holdings', { exact: true })).toBeVisible();
  await expect(overview.locator('small').filter({ hasText: 'fxSP' })).toHaveCount(0);
  const details = page.getByRole('region', { name: 'Vault details & transparency', exact: true });
  const assets = details.locator('dl > div').filter({ hasText: 'Underlying vault assets' });
  await expect(assets).toContainText('1,000 fxSP');
  await expect(assets.locator('dd span')).toHaveAttribute('title', '1000 fxSP');
});

test('missing withdrawal terms have one retry and recover without losing the amount', async ({ page }) => {
  await mount(page, false, '2', 'withdraw', { configFailure: true });
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('12.3456789');
  await expect(page.getByText('Cooldown and fee unavailable.', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Cooldown unavailable', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Fee unavailable', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review withdrawal', exact: true })).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Retry vault terms', exact: true });
  await expect(retry).toHaveCount(1);
  await retry.click();
  await expect(page.getByRole('radio', { name: /After cooldown.*1h/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^Instant/ })).toBeVisible();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.3456789');
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review withdrawal', exact: true })).toBeEnabled();
});

test('deposits never offer or forward an unused slippage setting', async ({ page }) => {
  await mount(page, false);
  for (const token of ['fxUSD', 'usdc', 'fxUSDBasePool']) {
    await page.getByLabel('Earn asset', { exact: true }).selectOption(token);
    // The SDK's deposit floor is stated in the review; the form adds no helper copy for it.
    await expect(page.getByText(/slippage|share minimum/i)).toHaveCount(0);
    await page.getByRole('button', { name: 'Transaction settings, Standard speed', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Transaction settings', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
    await page.getByLabel('Amount', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Review deposit', exact: true }).click();
    const plan = await page.evaluate(() => {
      const harness = globalThis as typeof globalThis & { __earnHarness: { plans: Array<{ slippage?: number; tokenIn: string }> } };
      return harness.__earnHarness.plans.at(-1);
    });
    expect(plan?.tokenIn).toBe(token);
    expect(plan).not.toHaveProperty('slippage');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
  }
  expect(await storedSlippage(page)).toBe(50);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(page.getByRole('radio', { name: /After cooldown/ })).toBeChecked();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  await openSettings(page, '0.5');
});

test('disconnected Earn shows the deposit amount and keeps it through wallet connection', async ({ page }) => {
  await mount(page, false);
  await page.evaluate(() => (globalThis as typeof globalThis & { __earnHarness: { disconnect: () => void } }).__earnHarness.disconnect());
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('12');
  const outcome = page.getByRole('region', { name: 'Deposit outcome' });
  await expect(outcome).toContainText('Receive');
  await expect(outcome).toContainText('24 fxSAVE');
  await expect(page.getByText(/No fxUSD available|No fxSAVE yet/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12');
  await expect(outcome).toContainText('24 fxSAVE');
  await expect(page.getByRole('button', { name: 'Review deposit', exact: true })).toBeEnabled();
});

test('disconnected Earn retries one failed public quote for the same amount without planning', async ({ page }) => {
  await page.clock.install();
  await mount(page, false);
  await page.evaluate(() => {
    const app = globalThis as typeof globalThis & { __earnHarness: { disconnect: () => void }; __earnQuoteFailOnce: boolean; __earnQuoteCalls: number };
    app.__earnHarness.disconnect();
    app.__earnQuoteFailOnce = true;
    app.__earnQuoteCalls = 0;
  });
  await page.getByLabel('Amount', { exact: true }).fill('12');
  await page.clock.runFor(250);
  await expect(page.getByRole('region', { name: 'Deposit outcome' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  await page.clock.runFor(15_100);
  await expect(page.getByRole('region', { name: 'Deposit outcome' })).toContainText('24 fxSAVE');
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12');
  const state = await page.evaluate(() => {
    const app = globalThis as typeof globalThis & { __earnHarness: { plans: unknown[] }; __earnQuoteCalls: number };
    return { quoteCalls: app.__earnQuoteCalls, plans: app.__earnHarness.plans.length };
  });
  expect(state).toEqual({ quoteCalls: 2, plans: 0 });
});

test('resumed stable deposits ignore only the unsupported tolerance without rewriting the saved preference', async ({ page }) => {
  await mount(page, true, '2', 'deposit');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transaction settings, Standard speed', exact: true })).toBeVisible();
  await expect(page.getByText(/slippage|share minimum/i)).toHaveCount(0);
  expect(await storedSlippage(page)).toBe(50);
});

test('resumed slippage is displayed, preserved by gas edits and used by review',async ({page}) => {
  await mount(page);
  await expect(page).toHaveURL('http://earn.test/earn');
  expect(await storedSlippage(page)).toBe(50);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  let dialog=await openSettings(page,'2');
  await expect(dialog.getByRole('radio',{name:'2%',exact:true})).toHaveAttribute('aria-checked','true');
  await dialog.getByRole('textbox',{name:'Slippage tolerance percentage'}).focus();
  await dialog.getByRole('radio',{name:/Fast/}).click();
  expect(await storedSlippage(page)).toBe(50);
  await expect(dialog.getByRole('textbox',{name:'Slippage tolerance percentage'})).toHaveValue('2');
  await dialog.getByRole('button',{name:'Close transaction settings'}).click();
  await page.getByRole('button',{name:'Review withdrawal',exact:true}).click();
  await expect(page.getByRole('region',{name:'Earn review'})).toContainText('Review slippage: 2%');
  expect(await storedSlippage(page)).toBe(50);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  dialog=await openSettings(page,'2');
  // An explicit choice must apply even when it matches the saved preference.
  await dialog.getByRole('radio',{name:'0.5%',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'Slippage tolerance percentage'})).toHaveValue('0.5');
  await dialog.getByRole('button',{name:'Close transaction settings'}).click();
  await page.getByRole('button',{name:'Review withdrawal',exact:true}).click();
  await expect(page.getByRole('region',{name:'Earn review'})).toContainText('Review slippage: 0.5%');
});

test('transaction settings stay beside the form; explicit custom edits persist',async ({page}) => {
  await mount(page);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const dialog=await openSettings(page,'2');
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Close transaction settings'}).click();
  // Viewing and closing settings does not save the resumed draft's 2% value.
  expect(await storedSlippage(page)).toBe(50);
  const editDialog=await openSettings(page,'2');
  const input=editDialog.getByRole('textbox',{name:'Slippage tolerance percentage'});
  await input.fill('0.75'); await input.press('Enter');
  await expect(input).toHaveValue('0.75');
  expect(await storedSlippage(page)).toBe(75);
  await editDialog.getByRole('button',{name:'Close transaction settings'}).click();
  await page.getByLabel('Amount',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Review withdrawal',exact:true}).click();
  await expect(page.getByRole('region',{name:'Earn review'})).toContainText('Review slippage: 0.75%');
});

test('withdrawals compare the exact fxSAVE balance, and vault details read in their own units',async ({page}) => {
  await mount(page,false,'2','withdraw',{shares:'600123456789000000000'});
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();
  // The field gets the exact share balance: it rounds its own figure down, and
  // its over-balance check must agree with the review's exact limit.
  const amount=page.getByLabel('Amount',{exact:true});
  await expect(amount).toHaveAttribute('data-available','600.123456789');
  await amount.fill('600.123456789');
  await expect(page.getByRole('button',{name:'Review withdrawal',exact:true})).toBeEnabled();
  await amount.fill('600.12345679');
  await expect(page.getByRole('button',{name:'Review withdrawal',exact:true})).toBeDisabled();
  const vault=page.getByRole('region',{name:'Vault details & transparency'});
  // fxSAVE's harvester ratio has 1e9 precision: 100000 is 0.01%, not 0%.
  await expect(vault).toContainText('Harvester ratio0.01%');
  await expect(vault).toContainText('Batch deposit threshold100 fxSP');
  await expect(vault).not.toContainText(/raw units|Instant-redemption fee|Cooldown/);
  const holdings = page.getByText('Vault holdings', { exact: true });
  await expect(holdings).toHaveCount(1);
  const holdingsValue = page.locator('dl > div').filter({ has: holdings }).locator('dd');
  await expect(holdingsValue).toHaveText('$1K');
  await expect(holdingsValue).toBeVisible();
  await expect(vault.getByText('Vault holdings', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Total fxSAVE vault value', { exact: true })).toHaveCount(0);
});

test('the settings popover fits a 320px phone without clipping a row',async ({page}) => {
  await page.setViewportSize({width:320,height:640});
  await mount(page,false);
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  const dialog=await openSettings(page,'0.5');
  await expect(dialog.getByRole('radiogroup',{name:'Network speed'})).toBeVisible();
  const clipped=await dialog.evaluate((panel) => {
    const edge=panel.getBoundingClientRect().right;
    return [...panel.querySelectorAll('h3,p,button,input,label')].filter((element) => element.getBoundingClientRect().right > edge + 1).map((element) => element.textContent || element.tagName);
  });
  expect(clipped).toEqual([]);
});

test('transaction setting radio groups support arrow, Home and End keys with one tab stop', async ({ page }) => {
  await mount(page, false);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  const dialog = await openSettings(page, '0.5');
  const slippage = dialog.getByRole('radiogroup', { name: 'Max slippage' });
  const slippageValues = ['0.1%', '0.5%', '1%', '2%'];
  const selectedSlippage = (value: string) => slippage.getByRole('radio', { name: value, exact: true });

  await expect(selectedSlippage('0.5%')).toHaveAttribute('tabindex', '0');
  for (const value of ['0.1%', '1%', '2%']) await expect(selectedSlippage(value)).toHaveAttribute('tabindex', '-1');
  await selectedSlippage('0.5%').focus();
  await page.keyboard.press('ArrowRight');
  await expect(selectedSlippage('1%')).toBeFocused();
  await expect(selectedSlippage('1%')).toHaveAttribute('aria-checked', 'true');
  await expect(selectedSlippage('1%')).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('End');
  await expect(selectedSlippage('2%')).toBeFocused();
  await expect(selectedSlippage('2%')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(selectedSlippage('0.1%')).toBeFocused();
  await expect(selectedSlippage('0.1%')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(selectedSlippage('2%')).toBeFocused();
  await expect(selectedSlippage('2%')).toHaveAttribute('aria-checked', 'true');

  const speed = dialog.getByRole('radiogroup', { name: 'Network speed' });
  const selectedSpeed = (value: string) => speed.getByRole('radio', { name: new RegExp(`^${value}\\b`) });
  await expect(selectedSpeed('Standard')).toHaveAttribute('tabindex', '0');
  await selectedSpeed('Standard').focus();
  await page.keyboard.press('ArrowRight');
  await expect(selectedSpeed('Fast')).toBeFocused();
  await expect(selectedSpeed('Fast')).toHaveAttribute('aria-checked', 'true');
  await expect(selectedSpeed('Fast')).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('End');
  await expect(selectedSpeed('Rapid')).toBeFocused();
  await expect(selectedSpeed('Rapid')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(selectedSpeed('Standard')).toBeFocused();
  await expect(selectedSpeed('Standard')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(selectedSpeed('Rapid')).toBeFocused();
  await expect(selectedSpeed('Rapid')).toHaveAttribute('aria-checked', 'true');

  expect(slippageValues).toHaveLength(await slippage.getByRole('radio').count());
  expect(await speed.getByRole('radio').evaluateAll((radios) => radios.filter((radio) => radio.tabIndex === 0).length)).toBe(1);
  expect(await slippage.getByRole('radio').evaluateAll((radios) => radios.filter((radio) => radio.tabIndex === 0).length)).toBe(1);
});

test('fxSAVE units wrap as a row at narrow widths and enlarged text',async ({page}) => {
  await mount(page,false);
  for(const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    const units=page.getByText('600 fxSAVE',{exact:true});
    const check=async () => {
      const geometry=await units.evaluate(element => {
        const range=document.createRange();range.selectNodeContents(element);
        const rects=[...range.getClientRects()];const parent=element.parentElement!.getBoundingClientRect();
        return {lines:new Set(rects.map(rect => rect.top)).size,contained:rects.every(rect => rect.left>=parent.left && rect.right<=parent.right+1),overflow:document.documentElement.scrollWidth>innerWidth};
      });
      expect(geometry).toEqual({lines:1,contained:true,overflow:false});
    };
    await check();
    await units.evaluate((element:HTMLElement) => {element.style.fontSize='24px';});
    await check();
    await units.evaluate((element:HTMLElement) => {element.style.fontSize='';});
  }
});

test('Earn summary keeps two normal columns and separates enlarged APY and balance figures', async ({ page }, info) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 770 });
    await mount(page, false);
    const summary = page.locator('[class*="balanceTop"]');
    const geometry = () => summary.evaluate(element => {
      const columns = [...element.children].map(child => child.getBoundingClientRect());
      const figures = [...element.querySelectorAll('strong,h2')].map(figure => {
        const range = document.createRange(); range.selectNodeContents(figure);
        return [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
      });
      return { sameRow: Math.abs(columns[0].top - columns[1].top) < 1,
        stacked: columns[0].bottom <= columns[1].top,
        overlap: figures[0].some(a => figures[1].some(b => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)),
        overflow: element.scrollWidth > element.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth };
    });
    expect(await geometry()).toEqual({ sameRow: true, stacked: false, overlap: false, overflow: false });
    await summary.screenshot({ path: info.outputPath(`earn-summary-${width}.png`) });
    await summary.locator('*').evaluateAll(nodes => {
      const text = nodes.filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
        .map(element => ({ element: element as HTMLElement, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
      for (const { element, size } of text) element.style.setProperty('font-size', `${size * 2}px`, 'important');
    });
    expect(await geometry()).toEqual({ sameRow: false, stacked: true, overlap: false, overflow: false });
    await summary.screenshot({ path: info.outputPath(`earn-summary-${width}-text200.png`) });
  }
});

test('changed stored slippage reaches a restored form while unrelated storage changes do not', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 50, gasTier: 'rapid' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'fxaeon.settings.v1' }));
  });
  await expect(page.getByRole('button', { name: 'Transaction settings, 2% slippage', exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 75 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-setting' }));
  });
  await expect(page.getByRole('button', { name: 'Transaction settings, 2% slippage', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'fxaeon.settings.v1' })));
  const dialog = await openSettings(page, '0.75');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await input.fill('3');
  await input.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Enter 0.1% to 2% in steps of 0.01%.');
  await expect(input).toHaveValue('3');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(await storedSlippage(page)).toBe(75);
  await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  await page.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Earn review' })).toContainText('Review slippage: 0.75%');
});

for (const percent of ['0.29', '0.14', '0.57', '1.1', '0.291', '0.101']) {
  test(`restored ${percent}% remains unchanged by focus, blur and gas selection`, async ({ page }) => {
    await mount(page, true, percent);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = await openSettings(page, percent);
    const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
    await input.focus();
    await input.blur();
    await expect(input).toHaveValue(percent);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await storedSlippage(page)).toBe(50);
    await input.focus();
    await dialog.getByRole('radio', { name: /Fast/ }).click();
    await expect(input).toHaveValue(percent);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await storedSlippage(page)).toBe(50);
    await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
    await page.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Earn review' })).toContainText(`Review slippage: ${percent}%`);
  });
}


test('uncontrolled settings still announce an explicit saved-value commit', async ({ page }) => {
  await mount(page, false);
  await page.evaluate(() => {
    const harness = globalThis as typeof globalThis & { __earnHarness: { showUncontrolled: () => void } };
    harness.__earnHarness.showUncontrolled();
    document.documentElement.dataset.settingsUpdates = '0';
    window.addEventListener('fxaeon:settings-updated', () => {
      const root = document.documentElement;
      root.dataset.settingsUpdates = String(Number(root.dataset.settingsUpdates) + 1);
    });
  });
  const dialog = await openSettings(page, '0.5');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await input.focus();
  await input.blur();
  await expect(page.locator('html')).toHaveAttribute('data-settings-updates', '1');
  expect(await storedSlippage(page)).toBe(50);
});

test('shared settings reset visible preferences and report blocked storage without changing active values', async ({ page }) => {
  await mount(page, true, '0.291');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = await openSettings(page, '0.291');
  await dialog.getByRole('radio', { name: /Fast/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveValue('0.291');
  await dialog.getByRole('button', { name: 'Reset defaults' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveValue('0.5');
  await expect(dialog.getByRole('radio', { name: /Standard/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio', { name: /Standard/ })).toContainText('<0.001 gwei');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage blocked by fixture'); }; });
  await dialog.getByRole('radio', { name: '1%', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not save');
  await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveValue('0.5');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transaction settings, 0.5% slippage', exact: true })).toBeFocused();
});

test('Done preserves an invalid custom draft and its accessible error until corrected', async ({ page }) => {
  await mount(page, false);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  const dialog = await openSettings(page, '0.5');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await input.fill('2.01');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue('2.01');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const error = dialog.getByRole('alert');
  await expect(error).toContainText('Enter 0.1% to 2% in steps of 0.01%.');
  await expect(input).toHaveAttribute('aria-errormessage', (await error.getAttribute('id'))!);
  await expect(input).toHaveAccessibleDescription(/Enter 0.1% to 2%/);
  expect(await storedSlippage(page)).toBe(50);
  await input.fill('0.75');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await storedSlippage(page)).toBe(75);
  await expect(page.getByRole('button', { name: 'Transaction settings, 0.75% slippage', exact: true })).toBeFocused();
});

test('failed custom preference storage keeps the draft and Done open until saving recovers', async ({ page }) => {
  await mount(page, false);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  const dialog = await openSettings(page, '0.5');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.assign(window, { __restoreSettingsStorage: () => { Storage.prototype.setItem = original; } });
    Storage.prototype.setItem = () => { throw new Error('Storage blocked by fixture'); };
  });
  await input.fill('0.75');
  await input.blur();
  await expect(dialog.getByRole('alert')).toContainText('could not save');
  await expect(input).toHaveValue('0.75');
  expect(await storedSlippage(page)).toBe(50);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue('0.75');
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('alert')).toContainText('previous value is still active');
  expect(await storedSlippage(page)).toBe(50);
  await page.evaluate(() => (window as typeof window & { __restoreSettingsStorage: () => void }).__restoreSettingsStorage());
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await storedSlippage(page)).toBe(75);
  await expect(page.getByRole('button', { name: 'Transaction settings, 0.75% slippage', exact: true })).toBeFocused();
});

test('settings help stays compact and Escape closes only the nested explanation first', async ({ page }) => {
  await mount(page, false);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  const dialog = await openSettings(page, '0.5');
  const trigger = dialog.getByRole('button', { name: 'About Max slippage', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const help = page.getByRole('dialog', { name: 'Max slippage', exact: true });
  await expect(help).toBeVisible();
  await expect(help).toBeFocused();
  await expect(help.getByRole('button')).toHaveCount(0);
  await expect(help).toHaveAccessibleDescription(/Raising it permits a larger difference/);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Transaction settings, 0.5% slippage', exact: true })).toBeFocused();
});

test('expired gas estimates disappear while hidden and recover on foreground and online events', async ({ page }) => {
  await page.clock.install();
  await mount(page, false);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  const dialog = await openSettings(page, '0.5');
  const standard = dialog.getByRole('radiogroup', { name: 'Network speed' }).getByRole('radio', { name: /Standard/ });
  await expect(standard).toContainText('<0.001 gwei');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(30_001);
  await expect(standard).not.toContainText('gwei');
  await expect(dialog.getByRole('status')).toContainText('Live gas rates are unavailable');
  await page.evaluate(() => {
    Object.assign(window, { __settingsGasFailure: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(dialog.getByRole('status')).toContainText('Live gas rates are unavailable');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    Object.assign(window, { __settingsGasFailure: false, __settingsGasPriceWei: 1000000000n });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(standard).toContainText('1.00 gwei');
  await expect(standard).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByText('Live gas rates are unavailable', { exact: false })).toHaveCount(0);
});

test('saved non-default settings hydrate without mismatch and restore the settings summary', async ({ page }) => {
  await mount(page, false);
  const result = await page.evaluate(() => {
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 75, gasTier: 'rapid' }));
    const harness = globalThis as typeof globalThis & { __earnHarness: { hydrateSettings: () => { container: HTMLElement; errors: string[] } } };
    harness.__earnHarness.hydrateSettings();
    return true;
  });
  expect(result).toBe(true);
  const hydrated = page.locator('[data-testid="settings-hydration-root"]');
  await expect(hydrated).toHaveAttribute('data-server-summary', 'Transaction settings, 0.5% slippage');
  const summary = hydrated.getByRole('button', { name: /Transaction settings,/ });
  await expect(summary).toContainText('0.75% slippage');
  await expect(summary).toContainText('Rapid');
  await expect(hydrated).toHaveAttribute('data-hydration-errors', '0');
});


test('editing a finer restored percentage still requires whole-basis-point preferences', async ({ page }) => {
  await mount(page, true, '0.291');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = await openSettings(page, '0.291');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await input.fill('0.292');
  await input.blur();
  await expect(input).toHaveValue('0.292');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('alert')).toContainText('steps of 0.01%');
  expect(await storedSlippage(page)).toBe(50);
  await input.fill('0.29');
  await input.blur();
  await expect(input).toHaveValue('0.29');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await storedSlippage(page)).toBe(29);
  await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  await page.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Earn review' })).toContainText('Review slippage: 0.29%');
});

async function latestPlan(page: Page) {
  return page.evaluate(() => {
    const harness = globalThis as typeof globalThis & { __earnHarness: { plans: Array<{ tokenOut: string; amount: bigint; instant: boolean; slippage?: number }> } };
    const plan = harness.__earnHarness.plans.at(-1);
    return plan && { ...plan, amount: String(plan.amount) };
  });
}

async function gasOnlySettings(page: Page) {
  await page.getByRole('button', { name: /^Transaction settings,/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Transaction settings', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Max slippage' })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' })).toHaveCount(0);
  await expect(dialog.getByRole('radiogroup', { name: 'Network speed' })).toBeVisible();
  await dialog.getByRole('radio', { name: /Fast/ }).click();
  expect(await storedSlippage(page)).toBe(50);
  await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
}

test('queued stable and direct base-pool withdrawals hide unused settings and preserve active tolerance', async ({ page }) => {
  await mount(page, true, '0.291');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const token of ['fxUSD', 'usdc']) {
    await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
    await page.getByLabel('Earn asset', { exact: true }).selectOption(token);
    await page.getByRole('radio', { name: /After cooldown/ }).locator('..').click();
    const outcome = page.getByRole('region', { name: 'Withdrawal outcome', exact: true });
    await expect(outcome.getByText('Claim assets', { exact: true })).toBeVisible();
    await expect(outcome.getByText('fxUSD / USDC', { exact: true })).toBeVisible();
    await gasOnlySettings(page);
    await page.getByLabel('Amount', { exact: true }).fill('10.000000000000000001');
    // Open the review unless the restored draft already resumed it. Whether a draft
    // should resume again after an asset change is not this test's claim.
    const review = page.getByRole('region', { name: 'Earn review' });
    await expect(async () => {
      if (await review.isVisible()) return;
      await page.getByRole('button', { name: 'Review withdrawal', exact: true }).click({ timeout: 1_000 });
      await expect(review).toBeVisible({ timeout: 1_000 });
    }).toPass();
    expect(await latestPlan(page)).toMatchObject({ tokenOut: token, amount: '10000000000000000001', instant: false });
    expect((await latestPlan(page))?.slippage).toBeUndefined();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
    const dialog = await openSettings(page, '0.291');
    await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
    await page.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
    expect(await latestPlan(page)).toMatchObject({ tokenOut: token, amount: '10000000000000000001', instant: true, slippage: 0.291 });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
  }
  await page.getByRole('radio', { name: /^fxSP/ }).locator('..').click();
  await expect(page.getByRole('radio', { name: /^fxSP/ })).toBeChecked();
    await expect(page.getByLabel('Earn asset', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Direct redemption to fxSP has no cooldown or queued claim.', { exact: true })).toBeVisible();
  await expect(page.getByText(/A queued withdrawal is claimed later/)).toHaveCount(0);
  await gasOnlySettings(page);
  await page.getByLabel('Amount', { exact: true }).fill('10.000000000000000001');
  await page.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Earn review' })).toBeVisible();
  expect(await latestPlan(page)).toMatchObject({ tokenOut: 'fxUSDBasePool', amount: '10000000000000000001', instant: false });
  expect((await latestPlan(page))?.slippage).toBeUndefined();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
  const dialog = await openSettings(page, '0.291');
  await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  expect(await storedSlippage(page)).toBe(50);
});

test('hiding unused controls does not enable missing or invalid withdrawal amounts', async ({ page }) => {
  await mount(page, false);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  for (const method of [/After cooldown/, /^Instant/, /^fxSP/]) {
    await page.getByRole('radio', { name: method }).locator('..').click();
    await page.getByLabel('Amount', { exact: true }).fill('');
    const review = page.getByRole('button', { name: 'Review withdrawal', exact: true });
    await expect(review).toBeDisabled();
    if (method.source !== '^Instant') await gasOnlySettings(page);
    for (const amount of ['0', '-1', 'bad', '601', '1.0000000000000000001']) {
      await page.getByLabel('Amount', { exact: true }).fill(amount);
      await expect(review).toBeDisabled();
    }
    await page.getByLabel('Amount', { exact: true }).fill('600');
    await expect(review).toBeEnabled();
  }
  expect(await latestPlan(page)).toBeUndefined();
});

test('direct base-pool routes show config-based share estimates and verified empty balances get in-card guidance', async ({ page }) => {
  await mount(page, false, '2', 'deposit');
  await expect(page.getByRole('region', { name: 'Deposit outcome', exact: true })).toHaveCount(0);
  await page.getByLabel('Earn asset', { exact: true }).selectOption('fxUSDBasePool');
  await expect(page.getByRole('region', { name: 'Deposit outcome', exact: true })).toHaveCount(0);
  await page.getByLabel('Amount', { exact: true }).fill('10');
  await expect(page.getByText('Receive', { exact: true })).toBeVisible();
  await expect(page.getByText('≈ 10 fxSAVE', { exact: true })).toBeVisible();
  const estimateHelp = page.getByRole('button', { name: 'About Receive', exact: true });
  await estimateHelp.focus();
  await estimateHelp.press('Enter');
  const estimateExplanation = page.getByRole('dialog', { name: 'Receive', exact: true });
  await expect(estimateExplanation).toBeVisible();
  await expect(estimateExplanation).toBeFocused();
  await expect(estimateExplanation).toHaveAccessibleDescription('Based on current vault assets and share supply.');
  await page.keyboard.press('Escape');
  await expect(estimateExplanation).toHaveCount(0);
  await expect(estimateHelp).toBeFocused();
  // Explaining a display-only estimate must not build or confirm a transaction.
  expect(await latestPlan(page)).toBeUndefined();
  await expect(page.getByRole('region', { name: 'Earn review' })).toHaveCount(0);
  await expect(page.getByText('Receive', { exact: true })).toHaveCount(1);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.evaluate(() => {
      const estimate = document.querySelector('[class*="estimateRow"]');
      const panel = document.querySelector('[data-result-container]');
      const row = estimate?.getBoundingClientRect();
      const card = panel?.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, contained: Boolean(row && card && row.left >= card.left && row.right <= card.right + 1) };
    });
    expect(geometry).toEqual({ overflow: false, contained: true });
  }

  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('radio', { name: /^fxSP/ }).locator('..').click();
  await page.getByLabel('Amount', { exact: true }).fill('10');
  await expect(page.getByText('Receive', { exact: true })).toBeVisible();
  await expect(page.getByText('≈ 10 fxSP', { exact: true })).toBeVisible();

  await mount(page, false, '2', 'deposit', { noExternal: true });
  await expect(page.getByText('No fxUSD available.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receive assets on Ethereum', exact: true })).toHaveAttribute('href', '/qr');
  await expect(page.getByRole('button', { name: 'Deposit assets', exact: true })).toHaveCount(0);

  await mount(page, false, '2', 'withdraw', { shares: '0' });
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(page.getByText('No fxSAVE yet.', { exact: false })).toBeVisible();
  const deposit = page.getByRole('button', { name: 'Switch to Deposit', exact: true });
  await expect(deposit).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
  }
  await deposit.click();
  await expect(page.getByLabel('Amount', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review deposit', exact: true })).toBeVisible();
});

for (const instant of [false, true]) {
  test(`restored base-pool withdrawal with instant=${instant} remains a direct gas-only route`, async ({ page }) => {
    await mount(page, true, '0.101', 'withdraw', { token: 'fxUSDBasePool', instant });
    expect(await latestPlan(page)).toMatchObject({ tokenOut: 'fxUSDBasePool', instant: false });
    expect((await latestPlan(page))?.slippage).toBeUndefined();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('radio', { name: /^fxSP/ })).toBeChecked();
    await expect(page.getByLabel('Earn asset', { exact: true })).toHaveCount(0);
    await gasOnlySettings(page);
    await page.getByRole('radio', { name: /^Instant/ }).locator('..').click();
    await page.getByLabel('Earn asset', { exact: true }).selectOption('usdc');
    const methods = page.getByRole('group', { name: 'Withdrawal method' });
    await expect(methods.getByRole('radio', { name: /^Instant/ })).toBeChecked();
    const dialog = await openSettings(page, '0.101');
    await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  });
}

for (const width of [320, 390]) {
  test(`withdrawal methods fit a single accessible row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mount(page, false, '2', 'withdraw');
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    const methods = page.getByRole('group', { name: 'Withdrawal method' });
    const radios = methods.getByRole('radio');
    await expect(radios).toHaveCount(3);
    const bounds = await radios.evaluateAll(nodes => nodes.map(node => {
      const label = node.closest('label')!;
      const rect = label.getBoundingClientRect();
      return { top: rect.top, width: rect.width, height: rect.height, overflow: label.scrollWidth > label.clientWidth };
    }));
    expect(new Set(bounds.map(rect => rect.top)).size).toBe(1);
    for (const rect of bounds) {
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.overflow).toBe(false);
    }
    await expect(page.getByLabel('Earn asset', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Claim assets', { exact: true })).toBeVisible();
    await radios.nth(1).focus();
    await page.keyboard.press('Space');
    await expect(radios.nth(1)).toBeChecked();
    await expect(page.getByLabel('Earn asset', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Earn asset', { exact: true }).locator('option')).toHaveText(['fxUSD', 'usdc']);
    await expect(page.getByRole('region', { name: 'Withdrawal outcome', exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: /^fxSP/ }).locator('..').click();
    await expect(page.getByLabel('Earn asset', { exact: true })).toHaveCount(0);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
  });
}

test('Instant receive-asset edits preserve exact shares and require a new review, including resumed drafts', async ({ page }) => {
  await mount(page, true, '0.291', 'withdraw', {token: 'fxUSD', instant: true});
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const amount = page.getByLabel('Amount', { exact: true });
  await amount.fill('10.000000000000000001');
  await page.getByLabel('Earn asset', { exact: true }).selectOption('usdc');
  await expect(amount).toHaveValue('10.000000000000000001');
  await expect(page.getByRole('region', { name: 'Earn review' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
  expect(await latestPlan(page)).toMatchObject({tokenOut: 'usdc', instant: true, amount: '10000000000000000001', slippage: 0.291});
});
