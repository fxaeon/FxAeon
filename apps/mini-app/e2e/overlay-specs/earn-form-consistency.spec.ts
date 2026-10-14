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
  '@/components/TokenIcon': `export default () => <span />; export const ChainIcon = () => <span aria-hidden="true" />;`,
  '@/components/MissingValue': `export const MissingValue = () => <span>Unavailable</span>; export const ValueOrSkeleton = ({value}) => <span>{value}</span>;`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({status:'ready',prices:{fxUSDBasePool:1,fxUSD:1},refresh:async () => {}});`,
  '@/lib/displayPrices': `export const freshDisplayPrices = snapshot => snapshot.prices;`,
  '@/lib/fxSaveApy': `export const fetchFxSaveApy = async () => ({apy:6.25});`,
  '@/lib/telegram': `export const haptic = () => {}; export const openExternalLink = () => false;`,
  '@/lib/fx/gasFeePolicy': `export const fetchGasTierQuotes = async () => ({tiers:{standard:{gasPriceWei:1n},fast:{gasPriceWei:2n},rapid:{gasPriceWei:3n}}});`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({address:'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',chainId:1,isEmbedded:true});`,
  '@/components/WalletDataProvider': `const refresh = async () => {}; export const useFxSaveClaimable = () => ({status:'ready',data:{hasPendingRedeem:false},refresh});`,
  '@/components/ProtocolForm': `export const AmountField = ({label,value,onChange,tokenSelector,balanceState}) => <>{tokenSelector}<label>{label}<input aria-label={label} data-available={balanceState?.amount} value={value} onChange={event => onChange(event.target.value)} /></label></>; export const TokenSelect = ({value,onChange,options}) => <select aria-label="Earn asset" value={value} onChange={event => onChange(event.target.value)}>{options.map(token => <option key={token} value={token}>{token}</option>)}</select>; export const Segmented = ({options,onChange}) => <div>{options.map(option => <button key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; const refresh = async () => {}; const balancesFor = () => {const zero = new URLSearchParams(location.search).has('fixtureNoExternal'); const amount = zero ? '0' : '1000'; return {fxUSD:{status:'ready',amount},usdc:{status:'ready',amount},fxUSDBasePool:{status:'ready',amount}};}; export const useWalletTokenBalances = () => ({status:'ready',balances:balancesFor(),refresh});`,
  '@/components/ActionReview': `import React from 'react'; export const ActionReview = ({editor,planBuilder,resumeReview,onStageChange,label,blocker}) => {
    const [review,setReview] = React.useState(false); const resumed = React.useRef(false);
    const open = async () => {if (!planBuilder || blocker) return; await planBuilder();setReview(true);onStageChange('review');};
    React.useEffect(() => {if(resumeReview && planBuilder && !resumed.current){resumed.current=true;void open();}},[resumeReview,planBuilder]);
    return review ? <section aria-label="Earn review"><p>Review slippage: {globalThis.__earnHarness.plans.at(-1)?.slippage}%</p><button onClick={() => {setReview(false);onStageChange('input');}}>Edit</button></section> : <>{editor}<button disabled={!planBuilder || Boolean(blocker)} onClick={open}>{label}</button></>;
  };`,
  '@/lib/fx': `export const assertWalletAddress = () => {}; export const assertPublicClientChain = async () => {}; export const getEthereumClient = () => ({}); export const MAX_FX_SLIPPAGE_PERCENT = 2; export const assertConfiguredPublicClientChain = async () => {}; export const withReadDeadline = promise => promise;
    export const getFxReadFacade = () => ({getFxSaveConfig:async () => ({cooldownPeriodSeconds:3600n,instantRedeemFeeRatio:1000000000000000n,expenseRatio:0n,harvesterRatio:100000n,threshold:100n*10n**18n,totalAssetsWei:1000n*10n**18n,totalSupplyWei:1000n*10n**18n}),getFxSaveBalance:async () => ({balanceWei:BigInt(new URLSearchParams(location.search).get('fixtureShares') ?? 600n*10n**18n),assetsWei:62045n*10n**16n}),getFxSaveRedeemStatus:async () => ({hasPendingRedeem:false})});
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
      globalThis.__earnHarness = {plans:[],showUncontrolled:() => render(<TransactionSettings slippage />),hydrateSettings:() => {const container=document.createElement('div');container.dataset.testid='settings-hydration-root';container.dataset.hydrationErrors='0';const saved=localStorage.getItem('fxaeon.settings.v1');localStorage.removeItem('fxaeon.settings.v1');container.innerHTML=renderToString(settingsTree);container.dataset.serverSummary=container.querySelector('button')?.getAttribute('aria-label') ?? '';if(saved!==null)localStorage.setItem('fxaeon.settings.v1',saved);document.body.append(container);const errors=[];hydrateRoot(container,settingsTree,{onRecoverableError:error=>{errors.push(String(error));container.dataset.hydrationErrors=String(errors.length);}});return {container,errors};},navigate:() => render(<button onClick={() => {history.pushState({},'', '/earn');render(<EarnPage />);}}>Return to Earn</button>)};
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

async function mount(page:Page,resume=true,slippage='2',mode:'withdraw'|'deposit'='withdraw',fixture:{token?:string;instant?:boolean;shares?:string;noExternal?:boolean}={}) {
  await page.route('http://earn.test/**',route => route.fulfill({body:'<!doctype html><html><head></head><body><div id="root"></div></body></html>',contentType:'text/html'}));
  const shares = fixture.shares !== undefined ? `fixtureShares=${fixture.shares}` : '';
  const external = fixture.noExternal ? 'fixtureNoExternal=1' : '';
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
  await openSettings(page, '0.5');
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

test('navigation does not save a restored draft; explicit custom edits persist',async ({page}) => {
  await mount(page);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  let dialog=await openSettings(page,'2');
  await dialog.getByRole('link',{name:'All settings'}).click();
  await expect(page).toHaveURL('http://earn.test/settings');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await storedSlippage(page)).toBe(50);
  await page.getByRole('button',{name:'Return to Earn'}).click();
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();
  dialog=await openSettings(page,'0.5');
  const input=dialog.getByRole('textbox',{name:'Slippage tolerance percentage'});
  await input.fill('0.75'); await input.press('Enter');
  await expect(input).toHaveValue('0.75');
  expect(await storedSlippage(page)).toBe(75);
  await dialog.getByRole('button',{name:'Close transaction settings'}).click();
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
  const vault=page.getByRole('region',{name:'Vault details'});
  // fxSAVE's harvester ratio has 1e9 precision: 100000 is 0.01%, not 0%.
  await expect(vault).toContainText('Harvester ratio0.01%');
  await expect(vault).toContainText('Batch deposit threshold100 fxSP');
  await expect(vault).not.toContainText(/raw units|Instant-redemption fee|Cooldown/);
  const holdings = page.getByText('Vault holdings', { exact: true });
  await expect(holdings).toHaveCount(1);
  await expect(holdings.locator('..')).toContainText('$1K');
  await expect(vault.getByText('Vault holdings', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Total fxSAVE vault value', { exact: true })).toHaveCount(0);
});

test('the settings popover fits a 320px phone without clipping a row',async ({page}) => {
  await page.setViewportSize({width:320,height:640});
  await mount(page,false);
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();
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
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue('0.75');
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
  await expect(input).toHaveValue('0.291');
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
    await page.getByLabel('Earn asset', { exact: true }).selectOption(token);
    await page.getByRole('radio', { name: /After cooldown/ }).locator('..').click();
    await expect(page.getByText(/A queued withdrawal is claimed later/)).toBeVisible();
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
  await page.getByLabel('Earn asset', { exact: true }).selectOption('fxUSDBasePool');
  await expect(page.getByRole('group', { name: 'Withdrawal method' })).toHaveCount(0);
  await expect(page.getByText(/with no queued claim/)).toBeVisible();
  await expect(page.getByText(/A queued withdrawal is claimed later/)).toHaveCount(0);
  await gasOnlySettings(page);
  await page.getByLabel('Amount', { exact: true }).fill('10.000000000000000001');
  await expect(page.getByRole('region', { name: 'Earn review' })).toBeVisible();
  expect(await latestPlan(page)).toMatchObject({ tokenOut: 'fxUSDBasePool', amount: '10000000000000000001', instant: false });
  expect((await latestPlan(page))?.slippage).toBeUndefined();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Earn asset', { exact: true }).selectOption('fxUSD');
  const dialog = await openSettings(page, '0.291');
  await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  expect(await storedSlippage(page)).toBe(50);
});

test('hiding unused controls does not enable missing or invalid withdrawal amounts', async ({ page }) => {
  await mount(page, false);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  for (const token of ['fxUSD', 'usdc', 'fxUSDBasePool']) {
    await page.getByLabel('Earn asset', { exact: true }).selectOption(token);
    if (token !== 'fxUSDBasePool') await page.getByRole('radio', { name: /After cooldown/ }).locator('..').click();
    const review = page.getByRole('button', { name: 'Review withdrawal', exact: true });
    await expect(review).toBeDisabled();
    await gasOnlySettings(page);
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
  await page.getByLabel('Earn asset', { exact: true }).selectOption('fxUSDBasePool');
  await page.getByLabel('Amount', { exact: true }).fill('10');
  await expect(page.getByText('Estimated fxSAVE received', { exact: true })).toBeVisible();
  await expect(page.getByText('≈ 10 fxSAVE', { exact: true })).toBeVisible();
  await expect(page.getByText(/Based on current vault assets and share supply/)).toBeVisible();
  await expect(page.getByText('Estimated fxSAVE received', { exact: true })).toHaveCount(1);
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
  await page.getByLabel('Earn asset', { exact: true }).selectOption('fxUSDBasePool');
  await page.getByLabel('Amount', { exact: true }).fill('10');
  await expect(page.getByText('Estimated fxSP received', { exact: true })).toBeVisible();
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
    await expect(page.getByRole('group', { name: 'Withdrawal method' })).toHaveCount(0);
    await gasOnlySettings(page);
    await page.getByLabel('Earn asset', { exact: true }).selectOption('usdc');
    const dialog = await openSettings(page, '0.101');
    await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  });
}
