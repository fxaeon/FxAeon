import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/*
 * The real Positions page with its real rows, details, form and review shell,
 * against mocked wallet, chain, prices and brake reads. It checks the list ->
 * position flow (row tap, back control, browser and Telegram Back, wide
 * selection in place) at phone and desktop widths. Set POSITIONS_SCREENS_DIR
 * to keep screenshots of each view in every theme.
 */
const appRoot = resolve(__dirname, '../..');
const root = resolve(appRoot, '../..');
const src = resolve(appRoot, 'src');
const publicRoot = resolve(appRoot, 'public');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const tsxPackage = appRequire.resolve('tsx/package.json');
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }> };
const screenshotDir = process.env.POSITIONS_SCREENS_DIR;
const entry = resolve(appRoot, 'e2e/harness/positions-screens-entry.tsx');

const mocks: Record<string, string> = {
  'next/link': `import React from 'react'; export default React.forwardRef(function Link({ href, children, prefetch, scroll, replace, ...props }, ref) { return <a ref={ref} href={typeof href === 'string' ? href : '#'} {...props} onClick={(event) => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>; });`,
  'next/navigation': `export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }); export const usePathname = () => '/positions'; export const useSearchParams = () => new URLSearchParams(window.location.search);`,
  '@/components/ThemeToggle': `import React from 'react'; export default function ThemeToggle() { return <button type="button" aria-label="Appearance" className="theme-toggle glass-press" style={{ width: 44, height: 44 }} />; }`,
  '@/components/WalletProfile': `import React from 'react'; export default function WalletProfile() { return <button type="button" aria-label="Open wallet profile" className="glass-press" style={{ minHeight: 44, padding: '0 12px', fontSize: 13, fontWeight: 600 }}>0x930f…98b9</button>; }`,
  '@/components/NetworkSelector': `import React from 'react'; export default function NetworkSelector() { return <button type="button" aria-label="Network: Ethereum" className="glass-press" style={{ width: 44, height: 44 }} />; }`,
  '@/components/WalletConnectCTA': `import React from 'react'; export default ({body}) => <section>{body}</section>;`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => globalThis.__positionsScreens.shared;`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  '@/components/PositionBrakeContext': `export function usePositionBrake(position) {
  if (position.info.rawDebts <= 0n) return { status: 'none' };
  const reading = globalThis.__positionsScreens.brakes[position.market + ':' + position.side + ':' + position.info.positionId];
  return reading ? { status: 'ready', reading, readAt: Date.now() } : { status: 'unavailable' };
}`,
  '@/components/PriceProvider': `import { useSyncExternalStore } from 'react';
import { liveMarketStore } from '@/lib/liveMarketStore';
import { isLiveQuoteFresh } from '@/lib/liveMarket';
const now = Date.now();
const EMPTY = { quote: null, status: 'paused', now: 0 };
export function useUsdPrices() {
  const prices = globalThis.__positionsScreens.prices;
  return { prices, status: 'ready', updatedAt: now, updatedAts: Object.fromEntries(Object.keys(prices).map((key) => [key, now])), refreshing: false, refresh: async () => {} };
}
export const useUsdPrice = (key) => useUsdPrices().prices[key];
export function useLiveMarketQuote(market) {
  const live = useSyncExternalStore(liveMarketStore.subscribe, () => liveMarketStore.getSnapshot(market), () => EMPTY);
  return { quote: live.quote, status: live.status, isFresh: live.status === 'live' && isLiveQuoteFresh(live.quote, live.now) };
}`,
  '@/components/WalletDataProvider': `const data = { balances: [
  { key: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, amountWei: 1250000000000000000n },
  { key: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, amountWei: 4500000000n },
  { key: 'fxUSD', address: '0x085780639CC2cACd35E474e71f4d000e2405d8f6', decimals: 18, amountWei: 1200000000000000000000n },
], failedTokens: [] };
const ready = { data, status: 'ready', isFetching: false, updatedAt: Date.now(), error: '', refresh: async () => data };
export function useWalletBalances({ address, enabled = true }) { return enabled && address ? ready : { data: null, status: 'idle', isFetching: false, updatedAt: null, error: '', refresh: async () => undefined }; }
const chain = (chainId) => ({ chainId, status: 'idle', transport: null, latestBlockNumber: null, lastEventAt: null, lastTransferAt: null, reconnectAttempt: 0, revision: 0 });
export function useRealtimeChainState(chainId) { return chainId ? chain(chainId) : { 1: chain(1), 8453: chain(8453) }; }
export const useInvalidateWalletData = () => async () => {};
export const useWalletAssets = () => ({ data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined });
export const useFxSaveClaimable = () => ({ data: null, status: 'idle', isFetching: false, updatedAt: null, refresh: async () => undefined });`,
  '@/components/review/useActionReviewLifecycle': `import React from 'react'; import { FX_TOKENS } from '@/lib/fx'; import { positionPoolAddress, positionCollateralTokenAddress, positionDebtTokenAddress } from '@/lib/fx/policy';
    const route = (address) => ({ operation:'reducePosition', chainId:1, walletAddress:address, transactions:[{chainId:1,from:address,to:positionPoolAddress('ETH','long'),data:'0x12345678',value:0n,kind:'action',type:'reducePosition',operation:'reducePosition'}], details:{routeType:'Close ETH long position',slippagePercent:1,executionPrice:'2444.58',colls:'0',debts:'0',minOut:'9700000000'}, policy:{reviewedAction:{kind:'position-reduce',poolAddress:positionPoolAddress('ETH','long'),positionId:2033,isClosePosition:true,positionType:'long',outputTokenAddress:FX_TOKENS.USDC.address,collateralTokenAddress:positionCollateralTokenAddress('ETH','long'),debtTokenAddress:positionDebtTokenAddress('ETH','long'),slippagePercent:1}} });
    export function useActionReviewLifecycle(props) { const [stage,setStage] = React.useState('input'); const [accepted,setAccepted] = React.useState(null); const wallet = globalThis.__positionsScreens.wallet;
      React.useEffect(() => { props.onStageChange?.(stage); }, [stage, props.onStageChange]);
      const review = async () => { if (!props.planBuilder) return; setStage('planning'); const planned = await props.planBuilder(); setAccepted(Array.isArray(planned)?planned[0]:(planned ?? route(wallet.address))); setStage('review'); };
      const reset = () => { setStage('input'); setAccepted(null); };
      const selected = accepted ?? route(wallet.address);
      const feeTiers={standard:{tier:'standard',gasPriceWei:25000000000n,maxFeePerGas:30000000000n,maxPriorityFeePerGas:5000000000n,source:'rpc'},fast:{tier:'fast',gasPriceWei:30000000000n,maxFeePerGas:50000000000n,maxPriorityFeePerGas:10000000000n,source:'rpc'},rapid:{tier:'rapid',gasPriceWei:40000000000n,maxFeePerGas:60000000000n,maxPriorityFeePerGas:20000000000n,source:'rpc'}};
      return { canSelectReviewedRoute:false,endConnectFlow:()=>{},error:null,execute:async()=>{},feeSelection:{snapshot:{chainId:1,tiers:feeTiers},tier:'standard'},gasCost:{checking:false,estimate:{status:'current',gas:240000n,executionGasFeeWei:2400000000000000n,totalNativeCostWei:2400000000000000n,nativeValueWei:0n},estimateIsCurrent:true,status:'ready'},headingRef:{current:null},loading:false,networkSwitching:false,quoteChanges:[],quoteExpired:false,refreshReviewedQuote:async()=>{},refreshing:false,reset,result:null,review,reviewTitle:'Close ETH long position',route:stage==='input'?null:selected,routeSummaries:[],routes:[selected],selectedRoute:0,selectReviewedRoute:()=>{},startConnectFlow:()=>{},stage,status:'reviewing',statusDetail:'',stepResults:[],triggerRef:{current:null},wallet:{...wallet} };
    }`,
  '@/lib/addressPresentation': `export const compactAddress = value => value ? value.slice(0,6)+'…'+value.slice(-4) : '';`,
  '@/lib/transactionProgress': `export const hasTransactionHash = step => Boolean(step?.hash); export const transactionStepProgress=()=>({label:'Ready',className:'',icon:null});`,
  '@/lib/taskState': `export const selectExecutionTask=()=>null;`,
  '@/lib/confirmedPositions': `export const receiptMintedPositionIdentity=()=>null;`,
  '@/components/BridgeTracker': `export const BridgeTracker=()=>null;`,
  '@/components/review/ReviewProgress': `import React from 'react'; export const chainName=id=>id===8453?'Base':'Ethereum'; export const stepProgress=()=>({label:'Ready',className:'',icon:null}); export const CalldataDisclosure=({data})=><pre>{data}</pre>; export const StatusNotice=({label,body})=><div role="status"><strong>{label}</strong>{body}</div>; export const InlineError=({message})=><div role="alert">{message}</div>; export const TransactionHashLink=({step})=><a href={"https://etherscan.io/tx/"+step.hash}>Receipt</a>;`,
  '@/components/review/executionResult': `export const resultPresentation=()=>({title:'Confirmed',body:'Fixture result',tone:'success',icon:()=>null}); export const resultBodyDuringRefresh=({body})=>body;`,
  '@/components/review/actionReviewStatusModel': `export const buildStatusPresentation=()=>({icon:'clock',label:'Ready',body:'Reviewed terms'});`,
  // CommonJS behind a Proxy: the planners the page calls are live; every
  // other name the graph imports resolves to an inert stub.
  '@/lib/fx': `const { tokens: t } = require('@aladdindao/fx-sdk');
const FX_TOKENS = {ETH:{address:t.eth,decimals:18,key:'ETH'},WETH:{address:t.weth,decimals:18,key:'WETH'},wstETH:{address:t.wstETH,decimals:18,key:'wstETH'},stETH:{address:t.stETH,decimals:18,key:'stETH'},WBTC:{address:t.WBTC,decimals:8,key:'WBTC'},USDC:{address:t.usdc,decimals:6,key:'USDC'},USDT:{address:t.usdt,decimals:6,key:'USDT'},fxUSD:{address:t.fxUSD,decimals:18,key:'fxUSD'},fxUSDBasePool:{address:t.fxUSDBasePool,decimals:18,key:'fxUSDBasePool'},fxSAVE:{address:'0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39',decimals:18,key:'fxSAVE'}};
const bounds = { min: 1.1, max: 7, source: 'fixture' };
const known = { FX_TOKENS, MAX_FX_SLIPPAGE_PERCENT: 2, clampLeverage: (v) => Math.min(bounds.max, Math.max(bounds.min, v)), leverageBoundsFor: () => bounds,
  formatRouteGasCost: () => ({ gasFee: '0.0024 ETH', totalCost: '0.0024 ETH' }), planAdjustPositionLeverage: async () => null, planIncreasePosition: async () => null, planReducePosition: async () => null,
  prepareLeverageReview: async ({ leverage }) => ({ leverage, bounds, plan: null, adjusted: false }), readLeverageBounds: async () => bounds,
  readSignatureRequiredDraft: () => null, restoreSignatureRequiredDraftFromSearch: () => null, signatureDraftIdFromSearch: () => null };
module.exports = new Proxy(known, { get: (target, key) => key in target ? target[key] : key === '__esModule' ? false : () => undefined });`,
  '@/lib/fx/policy': `import {FX_TOKENS} from '@/lib/fx'; const pools={long:['0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8','0xAB709e26Fa6B0A30c119D8c55B887DeD24952473'],short:['0x25707b9e6690B52C60aE6744d711cf9C1dFC1876','0xA0cC8162c523998856D59065fAa254F87D20A5b0']}; export const positionPoolAddress=(market,type)=>pools[type][market==='ETH'?0:1]; export const positionCollateralTokenAddress=(market,type)=>type==='short'?FX_TOKENS.fxUSD.address:market==='ETH'?FX_TOKENS.wstETH.address:FX_TOKENS.WBTC.address; export const positionDebtTokenAddress=(market,type)=>type==='long'?FX_TOKENS.fxUSD.address:market==='ETH'?FX_TOKENS.wstETH.address:FX_TOKENS.WBTC.address;`,
  '@/lib/wallet': `export const usePrivyWallet=()=>({...globalThis.__positionsScreens.wallet,sendTransaction:async()=>{globalThis.__positionsScreens.walletRequests+=1;}}); export const isWalletConnectCancellation=()=>false; export const useWalletReadyTimeout=()=>false;`,
  '@/lib/settings': `export const DEFAULT_SLIPPAGE_PERCENT=1; export const GAS_TIERS=['standard','fast','rapid']; export const readSlippagePercent=()=>1; export const SETTINGS_KEY='settings'; export const SETTINGS_UPDATED_EVENT='settings-updated'; export const readGasTier=()=>'standard'; export const DEFAULT_GAS_TIER='standard'; export const MIN_SLIPPAGE_BPS=10; export const MAX_SLIPPAGE_BPS=200; export const SLIPPAGE_PRESETS_BPS=[10,50,100,200]; export const isSlippageBps=(v)=>Number.isInteger(v)&&v>=10&&v<=200; export const writeTransactionSettings=()=>true;`,
  '@/lib/fx/gasFeePolicy': `export const formatGasPriceGwei=value=>Number(value)/1000000000+' Gwei'; export const formatGasTierQuote=quote=>quote.tier+' · '+Number(quote.gasPriceWei)/1000000000+' Gwei'; export const fetchGasTierQuotes=async()=>{ throw new Error('Gas quotes are unavailable in the harness'); };`,
  '@/lib/receiptPresentation': `export const buildReceiptPresentation=()=>({movements:[],technicalMovements:[],executionFee:null,feeLabel:'Network fee',feeCaveat:null,nativeValue:null}); export const receiptTransfersFromLogs=()=>[]; export const shouldShowReceiptMovementFallback=receipts=>receipts.length>0&&receipts.some(receipt=>receipt.transactionKind!=='approval'); export const receiptMovementLines=receipts=>{const tokenMovements=receipts.flatMap(receipt=>receipt.movements); if(tokenMovements.length) return {movements:tokenMovements,nativeValueIsMovement:false}; const nativeSends=receipts.flatMap(receipt=>receipt.nativeValue&&receipt.nativeValueLabel==='Native value sent'?['sent '+receipt.nativeValue]:[]); return {movements:nativeSends,nativeValueIsMovement:nativeSends.length>0};};`,
  '@/lib/transactionState': `export const resetTransactionAmounts=()=>({amount:'',fraction:25,leverage:2});`,
  '@/app/trade/fxUi': `import { formatUnits } from 'viem';
export function formatAmount(value, decimals = 18, digits = 5) { if (value === undefined) return '—'; const [integer, fraction = ''] = formatUnits(value, decimals).split('.'); const trimmed = fraction.slice(0, digits).replace(/0+$/, ''); return trimmed ? integer + '.' + trimmed : integer; }
export const positionDisplayLeverage = (position) => ({ value: position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage, label: 'leverage' });
export const positionKey = (position) => position.market + ':' + position.side + ':' + position.info.positionId;
export const positionTokenDecimals = (position, field) => field === 'collateral' ? position.info.rawCollsDecimals : position.info.rawDebtsDecimals;
export const positionIsStale = (position, failedGroups) => failedGroups.some((group) => group.market === position.market && group.side === position.side);
export const getSdkReductionAmountWei = async () => 1n; export const parseAmount = () => 1n;
export const positionCollateralDecimals = () => 18; export const positionDebtDecimals = () => 18;
export const positionInputTokenOptions = (market) => market === 'BTC' ? ['WBTC', 'USDC', 'USDT', 'fxUSD'] : ['ETH', 'WETH', 'stETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
export const positionOutputTokenOptions = (market) => market === 'BTC' ? ['WBTC', 'USDC', 'USDT', 'fxUSD'] : ['ETH', 'WETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
export const positionTargetLeverage = (position) => Number(Math.max(0.1, position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage).toFixed(2));
export const tokenAddress = () => '0x0000000000000000000000000000000000000001';
export const tokenDecimals = (token) => token === 'USDC' || token === 'USDT' ? 6 : token === 'WBTC' ? 8 : 18;`,
};

function resolveSource(path: string): string {
  const candidate = resolve(src, path.slice(2));
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return `${candidate}${extension}`;
  for (const extension of ['.tsx', '.ts']) if (existsSync(resolve(candidate, `index${extension}`))) return resolve(candidate, `index${extension}`);
  return candidate;
}
let lab: { script: string; css: string };

test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, outdir: 'positions-screens-bundle', entryNames: 'index', format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css', '.css': 'empty' }, absWorkingDir: root, logLevel: 'error',
    banner: { js: "var process = { env: { NODE_ENV: 'production' } };" },
    plugins: [{ name: 'positions-screens', setup(build: { onResolve: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void }) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      build.onResolve({ filter: /^@\// }, (args) => mocks[args.path] ? { path: args.path, namespace: 'mock' } : { path: resolveSource(args.path) });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  const script = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const modules = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  if (!script) throw new Error('The Positions screens bundle was not emitted.');
  const { buildLabGlobalCss } = await import('../harness/portfolio-states-build');
  lab = { script, css: `${await buildLabGlobalCss()}\n${modules}` };
});

async function open(page: Page, { theme = 'official', positions, path = '/positions' }: { theme?: 'official' | 'dark' | 'light'; positions?: string[]; path?: string } = {}) {
  const html = `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lab.css"></head>`
    + `<body><div id="root"></div><script>window.__positionsScreensConfig = ${JSON.stringify({ theme, positions })};</script><script src="/lab.js"></script></body></html>`;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('http://lab.test/**', async (request) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/positions') return request.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/lab.css') return request.fulfill({ contentType: 'text/css', body: lab.css });
    if (url.pathname === '/lab.js') return request.fulfill({ contentType: 'text/javascript', body: lab.script });
    const file = resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`);
    if (!existsSync(file)) return request.fulfill({ status: 404, body: '' });
    return request.fulfill({ contentType: extname(file) === '.svg' ? 'image/svg+xml' : 'image/png', body: readFileSync(file) });
  });
  await page.goto(`http://lab.test${path}`);
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

const list = (page: Page) => page.locator('section[aria-labelledby="open-positions-heading"]');
const actions = (page: Page) => page.getByRole('radiogroup', { name: 'Position action', exact: true });
const scrollTop = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>('[data-shell-content]')!.scrollTop);

test('a phone opens one position from its row and returns to the list where it was left', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await open(page, { positions: ['long', 'short', 'rebalance', 'ethShort', 'btcLong'] });
  await expect(page.locator('[data-position-key]')).toHaveCount(5);
  await expect(actions(page)).toBeHidden();
  // No per-row buttons; the position at its rebalance point stands out in words.
  await expect(page.getByRole('group', { name: /^Actions for / })).toHaveCount(0);
  await expect(page.locator('[data-position-key="ETH:long:2034"] [data-position-brake="rebalance"]')).toContainText('At the rebalance point');

  await page.evaluate(() => { document.querySelector<HTMLElement>('[data-shell-content]')!.scrollTop = 220; });
  const listScrollTop = await scrollTop(page);
  expect(listScrollTop).toBeGreaterThan(0);
  await page.locator('[data-position-key="ETH:short:174"]').click();
  await expect(page).toHaveURL(/\/positions\?position=ETH%3Ashort%3A174$/);
  await expect(list(page)).toBeHidden();
  const details = page.locator('[data-position-details="ETH:short:174"]');
  await expect(details).toBeVisible();
  // Every figure the row leaves out is in the position's details.
  for (const label of ['Collateral', 'Debt', 'Market price', 'Debt / collateral']) await expect(details.getByText(label, { exact: true })).toBeVisible();
  await expect(details.locator('[data-position-brake="clear"]')).toContainText('Rebalances if ETH rises ≈ 47%');
  // The actions and the form follow the position directly, starting at the top.
  await expect(actions(page)).toBeVisible();
  await expect(actions(page).getByRole('radio')).toHaveText(['Add', 'Reduce', 'Leverage', 'Close']);
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toBeVisible();
  expect(await scrollTop(page)).toBe(0);
  const detailsBox = (await details.boundingBox())!;
  const actionsBox = (await actions(page).boundingBox())!;
  expect(actionsBox.y).toBeGreaterThan(detailsBox.y + detailsBox.height - 1);
  expect(actionsBox.y - (detailsBox.y + detailsBox.height)).toBeLessThan(80);
  // A short has no "Borrow against".
  await expect(page.getByRole('link', { name: 'Borrow against this position' })).toHaveCount(0);

  await page.getByRole('button', { name: 'All positions', exact: true }).click();
  await expect(list(page)).toBeVisible();
  await expect(page).toHaveURL(/\/positions$/);
  await expect.poll(() => scrollTop(page)).toBe(listScrollTop);

  // Browser Back and Forward move between the same two views.
  await page.locator('[data-position-key="ETH:long:2033"]').click();
  await expect(page.locator('[data-position-details="ETH:long:2033"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Borrow against this position' })).toHaveAttribute('href', '/borrow?market=ETH&position=2033');
  await page.goBack();
  await expect(list(page)).toBeVisible();
  await page.goForward();
  await expect(page.locator('[data-position-details="ETH:long:2033"]')).toBeVisible();

  // Telegram's Back returns to the list first.
  const consumed = await page.evaluate(() => {
    let wasConsumed = false;
    window.dispatchEvent(new CustomEvent('fxaeon:telegram-back', { detail: { consume: () => { wasConsumed = true; }, isConsumed: () => wasConsumed } }));
    return wasConsumed;
  });
  expect(consumed).toBe(true);
  await expect(list(page)).toBeVisible();
  // On the list it is not consumed, so it leaves the page as before.
  const leaves = await page.evaluate(() => {
    let wasConsumed = false;
    window.dispatchEvent(new CustomEvent('fxaeon:telegram-back', { detail: { consume: () => { wasConsumed = true; }, isConsumed: () => wasConsumed } }));
    return !wasConsumed;
  });
  expect(leaves).toBe(true);
});

test('a link to a position opens it, and its back control stays on this page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { path: '/positions?position=BTC%3Ashort%3A109&action=close' });
  await expect(page.locator('[data-position-details="BTC:short:109"]')).toBeVisible();
  await expect(actions(page).getByRole('radio', { name: 'Close', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Close the full position', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All positions', exact: true }).click();
  await expect(list(page)).toBeVisible();
  await expect(page).toHaveURL(/\/positions$/);
});

test('a position that is gone gives way to the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.locator('[data-position-key="ETH:long:2034"]').click();
  await expect(page.locator('[data-position-details="ETH:long:2034"]')).toBeVisible();
  await page.evaluate(() => {
    const harness = globalThis.__positionsScreens;
    harness.shared = { ...harness.shared, positions: (harness.shared.positions as Array<{ info: { positionId: number } }>).filter((item) => item.info.positionId !== 2034) };
    harness.rerender?.();
  });
  await expect(list(page)).toBeVisible();
  await expect(page.locator('[data-position-key]')).toHaveCount(3);
  await expect(page).toHaveURL(/\/positions$/);
});

test('wide screens keep the list beside the selected position and select in place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await expect(list(page)).toBeVisible();
  await expect(page.locator('[data-position-details="ETH:long:2033"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All positions', exact: true })).toBeHidden();
  await expect(page.locator('[data-position-key="ETH:long:2033"]')).toHaveAttribute('aria-current', 'true');
  const historyLength = await page.evaluate(() => window.history.length);
  await page.locator('[data-position-key="BTC:short:109"]').click();
  await expect(page.locator('[data-position-details="BTC:short:109"]')).toBeVisible();
  await expect(list(page)).toBeVisible();
  await expect(page.locator('[data-position-key="BTC:short:109"]')).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(/\/positions\?position=BTC%3Ashort%3A109$/);
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
});

test('four or more positions read calmly at every phone width', async ({ page }) => {
  for (const width of [320, 360, 390, 430, 480]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, { positions: ['long', 'short', 'rebalance', 'ethShort', 'btcLong'] });
    const rows = await page.locator('[data-position-key]').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { height: box.height, overflow: element.scrollWidth - element.clientWidth, left: box.left, right: box.right };
    }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const row of rows) {
      expect(row.overflow, `row overflow at ${width}px`).toBeLessThanOrEqual(0);
      expect(row.left).toBeGreaterThanOrEqual(0);
      expect(row.right).toBeLessThanOrEqual(width);
      expect(row.height, `row height at ${width}px`).toBeGreaterThanOrEqual(44);
    }
    // A clear row is about a third of the old card's 294px.
    expect(rows[0].height, `compact row at ${width}px`).toBeLessThan(130);
  }
});

test('screenshots: the list, a position for Add and for Close, and the wide view in every theme', async ({ page }) => {
  test.skip(!screenshotDir, 'set POSITIONS_SCREENS_DIR to keep the screenshots');
  mkdirSync(screenshotDir!, { recursive: true });
  for (const theme of ['official', 'dark', 'light'] as const) {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await open(page, { theme, positions: ['long', 'short', 'rebalance', 'ethShort'] });
      await page.waitForTimeout(1_100);
      await page.screenshot({ path: resolve(screenshotDir!, `positions-${theme}-${width}-list.png`), animations: 'disabled' });
      await page.locator('[data-position-key="ETH:long:2033"]').click();
      await expect(actions(page)).toBeVisible();
      await page.waitForTimeout(1_100);
      await page.screenshot({ path: resolve(screenshotDir!, `positions-${theme}-${width}-add.png`), animations: 'disabled' });
      await actions(page).getByRole('radio', { name: 'Close', exact: true }).click();
      await expect(page.getByText('Close the full position', { exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(screenshotDir!, `positions-${theme}-${width}-close.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, { theme, positions: ['long', 'short', 'rebalance', 'ethShort'] });
    await page.waitForTimeout(1_100);
    await page.screenshot({ path: resolve(screenshotDir!, `positions-${theme}-1280-wide.png`), animations: 'disabled' });
  }
});
