import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }> };
const appRequire = createRequire(resolve(root, 'apps/mini-app/package.json'));
const postcss = appRequire('postcss') as (plugins: unknown[]) => { process: (css: string, options: Record<string, unknown>) => Promise<{ css: string }> };
const tailwind = appRequire('tailwindcss') as (options: { config: string }) => unknown;
const autoprefixer = appRequire('autoprefixer') as () => unknown;
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/positions-review-entry.tsx');

const mocks: Record<string, string> = {
  'next/link': `import React from 'react'; export default ({href, children, ...props}) => <a href={href} {...props}>{children}</a>;`,
  // The settings gear's popover closes with the router; the harness has no mounted app router.
  'next/navigation': `export const useRouter = () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }); export const usePathname = () => '/positions'; export const useSearchParams = () => new URLSearchParams();`,
  '@/components/ui': `import React from 'react'; export const AppShell = ({children}) => <div className="app-shell mx-auto w-full app-shell-tabs"><div className="app-workspace"><header className="app-topbar" style={{minHeight:80}}><a href="#">FxAeon</a></header><main id="main-content" data-shell-content="true" className="app-content app-content-tabs flex-1 outline-none">{children}</main></div><nav aria-label="Primary navigation" data-app-navigation data-fixed-navigation="true" className="mobile-tabbar pointer-events-none fixed inset-x-0 bottom-0 z-40"><div className="tabbar-safe mx-auto w-full max-w-[520px]"><div className="tabbar pointer-events-auto">App navigation</div></div></nav></div>; export const Button = React.forwardRef(({children,onClick,disabled,loading,className='',variant='ghost',...props},ref)=><button ref={ref} type="button" {...props} disabled={disabled||loading} onClick={onClick} className={\`button glass-press astryx-interactive flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3 text-[14px] \${variant==='primary'?'button-primary font-semibold':variant==='danger'?'button-danger text-danger':'button-ghost text-[var(--text)]'} \${className}\`}>{children}</button>); export const Card = ({children,className=''}) => <div className={\`ui-card p-5 \${className}\`}>{children}</div>; export const EmptyState = ({title,body}) => <section><h2>{title}</h2><p>{body}</p></section>;`,
  '@/components/review/useActionReviewLifecycle': `import React from 'react'; import { FX_TOKENS } from '@/lib/fx'; import { positionPoolAddress, positionCollateralTokenAddress, positionDebtTokenAddress } from '@/lib/fx/policy';
    const route = (address) => ({ operation:'reducePosition', chainId:1, walletAddress:address, transactions:[{chainId:1,from:address,to:positionPoolAddress('ETH','long'),data:'0x095ea7b3'+'0'.repeat(24)+'b'.repeat(40)+'0'.repeat(63)+'b',value:0n,kind:'approval',type:'approvePosition'},{chainId:1,from:address,to:positionPoolAddress('ETH','long'),data:'0x12345678',value:0n,kind:'action',type:'reducePosition',operation:'reducePosition'}], details:{routeType:'Close ETH long position',slippagePercent:1,executionPrice:'3250.125',colls:'0',debts:'0',minOut:'99000000'}, policy:{reviewedAction:{kind:'position-reduce',poolAddress:positionPoolAddress('ETH','long'),positionId:11,isClosePosition:true,positionType:'long',outputTokenAddress:FX_TOKENS.USDC.address,collateralTokenAddress:positionCollateralTokenAddress('ETH','long'),debtTokenAddress:positionDebtTokenAddress('ETH','long'),slippagePercent:1}} });
    export function useActionReviewLifecycle(props) { const [stage,setStage] = React.useState('input'); const [accepted,setAccepted] = React.useState(null); const [stepResults,setStepResults] = React.useState([]); const [loading] = React.useState(false); const wallet = globalThis.__positionsReviewHarness.wallet; const previousAddress = React.useRef(wallet.address);
      globalThis.__positionsReviewHarness.setReviewStage = setStage;
      globalThis.__positionsReviewHarness.setReviewStepResults = setStepResults;
      React.useEffect(() => { props.onStageChange?.(stage); }, [stage, props.onStageChange]);
      React.useEffect(() => { if (previousAddress.current !== wallet.address && stage !== 'executing' && stage !== 'result') { setStage('input'); setAccepted(null); } previousAddress.current = wallet.address; }, [wallet.address, stage]);
      const review = async () => { if (!props.planBuilder) return; setStage('planning'); const planned = await props.planBuilder(); setAccepted(Array.isArray(planned)?planned[0]:(planned ?? route(wallet.address))); setStage('review'); };
      const reset = () => { setStage('input'); setAccepted(null); };
      const selected = accepted ?? route(wallet.address);
      const result = stage === 'result' ? {status:'confirmed',operation:'reducePosition',chainId:1,walletAddress:selected.walletAddress,steps:[{index:1,transaction:selected.transactions[1],status:'confirmed',hash:'0x'+'1'.repeat(64)}]} : null;
      const feeTiers={standard:{tier:'standard',gasPriceWei:25000000000n,maxFeePerGas:30000000000n,maxPriorityFeePerGas:5000000000n,source:'rpc'},fast:{tier:'fast',gasPriceWei:30000000000n,maxFeePerGas:50000000000n,maxPriorityFeePerGas:10000000000n,source:'rpc'},rapid:{tier:'rapid',gasPriceWei:40000000000n,maxFeePerGas:60000000000n,maxPriorityFeePerGas:20000000000n,source:'rpc'}};
      return { canSelectReviewedRoute:false,endConnectFlow:()=>{},error:null,execute:async()=>{},feeSelection:wallet.isEmbedded?{snapshot:{chainId:1,tiers:feeTiers},tier:'standard'}:null,gasCost:{checking:false,estimate:{status:'current',gas:240000n,executionGasFeeWei:2400000000000000n,totalNativeCostWei:2400000000000000n,nativeValueWei:0n},estimateIsCurrent:true,status:'ready'},headingRef:{current:null},loading,networkSwitching:false,quoteChanges:[],quoteExpired:false,refreshReviewedQuote:async()=>{},refreshing:false,reset,result,review,reviewTitle:'Close ETH long position',route:stage==='input'?null:selected,routeSummaries:[],routes:[selected],selectedRoute:0,selectReviewedRoute:()=>{},startConnectFlow:()=>{},stage,status:stage==='executing'?'submitted':'reviewing',statusDetail:'',stepResults,triggerRef:{current:null},wallet:{...wallet,ready:true,authenticated:true,isEmbedded:wallet.isEmbedded} };
    }`,
  '@/components/PriceProvider': `export const useUsdPrices=()=>({prices:{},status:'unavailable',updatedAts:{},refreshing:false,refresh:async()=>{}}); export const useUsdPrice=()=>undefined; export const useLiveMarketQuote=()=>({quote:null,status:'unavailable',isFresh:false});`,
  '@/lib/displayPrices': `export const freshDisplayPrices=snapshot=>snapshot.prices;`,
  '@/lib/addressPresentation': `export const compactAddress = value => value ? value.slice(0,6)+'…'+value.slice(-4) : '';`,
  '@/lib/taskState': `export const selectExecutionTask=()=>null;`,
  '@/lib/confirmedPositions': `export const receiptMintedPositionIdentity=()=>null;`,
  '@/components/BridgeTracker': `export const BridgeTracker=()=>null;`,
  '@/components/review/executionResult': `export const resultPresentation=()=>({title:'Confirmed',body:'Fixture result',tone:'success',icon:()=>null}); export const resultBodyDuringRefresh=({body})=>body;`,
  '@/components/review/actionReviewStatusModel': `export const buildStatusPresentation=({status})=>status==='submitted'?({icon:'clock',label:'Transaction submitted',body:'Waiting for confirmation on-chain.'}):({icon:'clock',label:'Ready',body:'Reviewed terms'});`,
  '@/components/WalletConnectCTA': `import React from 'react'; export default ({body}) => <section>{body}</section>;`,
  '@/components/ProtocolPositionCard': `import React from 'react'; export const positionIsStale = () => false;
    const keyOf = position => position.market+':'+position.side+':'+position.info.positionId;
    export const ProtocolPositionCard = ({position,selected,onSelect,href}) => { const body = <strong>{position.market} {position.side} #{position.info.positionId}</strong>; return onSelect ? <button type="button" onClick={onSelect} data-position-key={keyOf(position)} aria-current={selected?'true':undefined}>{body}</button> : href ? <a href={href} data-position-key={keyOf(position)}>{body}</a> : <article data-position-key={keyOf(position)}>{body}</article>; };
    export const ProtocolPositionIdentity = ({position,headingId}) => <h2 id={headingId}>{position.market} {position.side} · #{position.info.positionId}</h2>;
    export const ProtocolPositionDetails = ({position,headingId,className,hideIdentity}) => <section className={className} data-position-details={keyOf(position)}>{!hideIdentity && <ProtocolPositionIdentity position={position} headingId={headingId} />}<dl><dt>Collateral</dt><dd>{String(position.info.rawColls)}</dd></dl></section>;
    export const ProtocolPositionList = ({label,children}) => <div role="list" aria-label={label}>{React.Children.map(children, child => child ? <div role="listitem">{child}</div> : null)}</div>;
    export const ProtocolPositionNotice = () => null; export const ProtocolPositionSkeleton = () => <div />;`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => globalThis.__positionsReviewHarness.shared;`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  '@/components/ProtocolForm': `import React from 'react'; export const AmountField = ({label,value,onChange}) => <label>{label}<input aria-label={label} value={value} onChange={e=>onChange(e.target.value)}/></label>; export const LeverageField = ({label,value,onChange}) => <label>{label}<input aria-label={label} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>; export const RangeField = ({label,value,onChange}) => <label>{label}<input aria-label={label} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>; export const Segmented = ({options,value,onChange,ariaLabel}) => <div role="radiogroup" aria-label={ariaLabel}>{options.map(o => <button type="button" role="radio" aria-checked={value===o.value} key={o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>; export const SlippageField = () => <label>Slippage</label>; export const TokenSelect = ({label,options,value,onChange}) => <label>{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>; export const tokenBalanceFor = () => undefined; export const useWalletTokenBalances = () => ({balances:{},status:'ready',refresh:async()=>{}});`,
  '@/lib/fx': `import {tokens as t} from '@aladdindao/fx-sdk'; export const FX_TOKENS={ETH:{address:t.eth,decimals:18,key:'ETH'},WETH:{address:t.weth,decimals:18,key:'WETH'},wstETH:{address:t.wstETH,decimals:18,key:'wstETH'},stETH:{address:t.stETH,decimals:18,key:'stETH'},WBTC:{address:t.WBTC,decimals:8,key:'WBTC'},USDC:{address:t.usdc,decimals:6,key:'USDC'},USDT:{address:t.usdt,decimals:6,key:'USDT'},fxUSD:{address:t.fxUSD,decimals:18,key:'fxUSD'},fxUSDBasePool:{address:t.fxUSDBasePool,decimals:18,key:'fxUSDBasePool'},fxSAVE:{address:'0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39',decimals:18,key:'fxSAVE'}}; export const MAX_FX_SLIPPAGE_PERCENT=100; export const clampLeverage=v=>v; export const leverageBoundsFor=()=>({min:1,max:10,source:'fixture'}); export const formatRouteGasCost=()=>({gasFee:'0.0024 ETH',totalCost:'0.0024 ETH'}); export const planAdjustPositionLeverage=async()=>null; export const planIncreasePosition=async()=>null; export const planReducePosition=async()=>null; export const prepareLeverageReview=async({leverage})=>({leverage,bounds:{min:1,max:10,source:'fixture'},plan:null,adjusted:false}); export const readLeverageBounds=async()=>({min:1,max:10,source:'fixture'}); export const readSignatureRequiredDraft=()=>null; export const restoreSignatureRequiredDraftFromSearch=()=>null; export const signatureDraftIdFromSearch=()=>null;`,
  '@/lib/fx/policy': `import {FX_TOKENS} from '@/lib/fx'; const pools={long:['0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8','0xAB709e26Fa6B0A30c119D8c55B887DeD24952473'],short:['0x25707b9e6690B52C60aE6744d711cf9C1dFC1876','0xA0cC8162c523998856D59065fAa254F87D20A5b0']}; export const positionPoolAddress=(market,type)=>pools[type][market==='ETH'?0:1]; export const positionCollateralTokenAddress=(market,type)=>type==='short'?FX_TOKENS.fxUSD.address:market==='ETH'?FX_TOKENS.wstETH.address:FX_TOKENS.WBTC.address; export const positionDebtTokenAddress=(market,type)=>type==='long'?FX_TOKENS.fxUSD.address:market==='ETH'?FX_TOKENS.wstETH.address:FX_TOKENS.WBTC.address;`,
  '@/lib/wallet': `export const usePrivyWallet=()=>({...globalThis.__positionsReviewHarness.wallet,sendTransaction:async()=>{globalThis.__positionsReviewHarness.walletRequests+=1;}}); export const isWalletConnectCancellation=()=>false;`,
  '@/lib/settings': `export const DEFAULT_SLIPPAGE_PERCENT=1; export const GAS_TIERS=['standard','fast','rapid']; export const readSlippagePercent=()=>1; export const SETTINGS_KEY='settings'; export const SETTINGS_UPDATED_EVENT='settings-updated'; export const readGasTier=()=>'standard'; export const DEFAULT_GAS_TIER='standard'; export const MIN_SLIPPAGE_BPS=10; export const MAX_SLIPPAGE_BPS=200; export const SLIPPAGE_PRESETS_BPS=[10,50,100,200]; export const isSlippageBps=(v)=>Number.isInteger(v)&&v>=10&&v<=200; export const writeTransactionSettings=()=>true;`,
  '@/lib/fx/gasFeePolicy': `export const formatGasPriceGwei=value=>Number(value)/1000000000+' Gwei'; export const formatGasTierQuote=quote=>quote.tier+' · '+Number(quote.gasPriceWei)/1000000000+' Gwei'; export const fetchGasTierQuotes=async()=>{ throw new Error('Gas quotes are unavailable in the harness'); };`,
  '@/lib/receiptPresentation': `export const buildReceiptPresentation=()=>({movements:[],technicalMovements:[],executionFee:null,feeLabel:'Network fee',feeCaveat:null,nativeValue:null}); export const receiptTransfersFromLogs=()=>[]; export const shouldShowReceiptMovementFallback=receipts=>receipts.length>0&&receipts.some(receipt=>receipt.transactionKind!=='approval'); export const receiptMovementLines=receipts=>{const tokenMovements=receipts.flatMap(receipt=>receipt.movements); if(tokenMovements.length) return {movements:tokenMovements,nativeValueIsMovement:false}; const nativeSends=receipts.flatMap(receipt=>receipt.nativeValue&&receipt.nativeValueLabel==='Native value sent'?['sent '+receipt.nativeValue]:[]); return {movements:nativeSends,nativeValueIsMovement:nativeSends.length>0};};`,
  '@/lib/telegram': `export const haptic=()=>{}; export const openExternalLink=()=>false;`,
  '@/lib/transactionState': `export const resetTransactionAmounts=()=>({amount:'',fraction:25,leverage:2});`,
  '@/app/trade/fxUi': `export const getSdkReductionAmountWei=async()=>1n; export const formatAmount=(value,decimals=18)=>String(Number(value)/10**decimals); export const parseAmount=()=>1n; export const positionKey=position=>position.market+':'+position.side+':'+position.info.positionId; export const positionCollateralDecimals=()=>18; export const positionDebtDecimals=()=>18; export const positionTokenDecimals=()=>18; export const positionInputTokenOptions=()=>['ETH','USDC']; export const positionOutputTokenOptions=()=>['USDC','ETH']; export const positionTargetLeverage=()=>2; export const tokenAddress=()=> '0x0000000000000000000000000000000000000001'; export const tokenDecimals=token=>token==='USDC'?6:18;`,
};

async function buildHarness(): Promise<{ script: string; css: string }> {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, outdir: 'positions-harness-bundle', entryNames: 'index', format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css' }, absWorkingDir: root,
    plugins: [{ name: 'positions-review-harness', setup(build: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void }) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'mock' }));
      build.onResolve({ filter: /^@\// }, (args) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (existsSync(candidate)) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        return { path: candidate };
      });
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
    } }],
  });
  const generatedGlobals = await postcss([tailwind({ config: resolve(root, 'apps/mini-app/tailwind.config.js') }), autoprefixer()])
    .process(readFileSync(resolve(src, 'app/globals.css'), 'utf8'), { from: resolve(src, 'app/globals.css') });
  return {
    script: result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '',
    css: `${generatedGlobals.css}\nbody { font-family: Arial, sans-serif; }\n${result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''}`,
  };
}

async function openAdvanced(page: Page) {
  const advanced = page.getByLabel('Advanced transaction details', { exact: true });
  if (await advanced.getAttribute('open') === null) await advanced.locator(':scope > summary').click();
  const transactions = advanced.getByRole('region', { name: 'Prepared transactions', exact: true });
  await expect(transactions).toBeVisible();
  await expect(transactions.getByRole('group', { name: /^Transaction [12]$/ })).toHaveCount(2);
}

let harness: { script: string; css: string };
test.beforeAll(async () => { harness = await buildHarness(); });

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 740 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  test(`review decisions remain accessible with expanded content at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.route('http://positions.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    await page.setViewportSize(viewport);
    await page.goto('http://positions.test/positions');
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await page.addStyleTag({ content: harness.css });
    await page.addScriptTag({ content: harness.script });
    await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
    await page.locator('[data-position-key="ETH:long:11"]').click();
    await page.getByRole('radio', { name: 'Close', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Review close', exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger.locator('xpath=ancestor::*[contains(@class,"sticky-action")][1]')).toHaveCSS('position', viewport.width <= 600 ? 'sticky' : 'static');
    await trigger.click();
    const decision = page.getByRole('button', { name: 'Approve position', exact: true });
    await expect(decision).toBeVisible();
    if (viewport.width <= 600) await expect(decision).toBeInViewport({ ratio: 1 });
    await openAdvanced(page);
    const information = page.getByRole('region', { name: 'Review information', exact: true });
    await expect(information).toHaveCSS('overflow-y', 'auto');
    if (viewport.width <= 600) {
      await expect(page.locator('[data-inline-review-sheet]')).toHaveCount(1);
      await expect.poll(() => information.evaluate(node => node.clientHeight)).toBeGreaterThan(0);
      await expect(decision).toBeInViewport({ ratio: 1 });
    }
    // Advanced animates its height. Keep requesting the actual end while it
    // expands rather than testing a scroll offset captured mid-animation.
    const finalNote = information.getByText('USD uses current prices, not transaction limits or receipt-time prices.', { exact: true });
    await expect.poll(async () => {
      await information.evaluate(node => { node.scrollTop = node.scrollHeight; });
      const [body, note] = await Promise.all([information.boundingBox(), finalNote.boundingBox()]);
      return Boolean(body && note && note.y >= body.y - 1 && note.y + note.height <= body.y + body.height + 1);
    }).toBe(true);
    const order = await decision.evaluate(button => {
      const information = button.closest('[data-review-viewport]')!.querySelector('[aria-label="Review information"]')!;
      return button.getBoundingClientRect().top >= information.getBoundingClientRect().bottom;
    });
    expect(order).toBe(true);
    await decision.scrollIntoViewIfNeeded();
    await page.locator('[data-position-sheet-body], [data-shell-content]').last().evaluate(node => { node.scrollTop = node.scrollHeight; });
    const action = await decision.boundingBox();
    expect(action).not.toBeNull();
    expect(action!.height).toBeGreaterThanOrEqual(44);
    expect(action!.y).toBeGreaterThanOrEqual(0);
    const navigation = page.locator('[data-app-navigation]');
    const sheetBody = page.locator('[data-position-sheet-body]');
    const visibleBottom = await sheetBody.count() ? await sheetBody.evaluate(node => node.getBoundingClientRect().bottom)
      : await navigation.isVisible() ? (await navigation.boundingBox())!.y : viewport.height;
    expect(action!.y + action!.height).toBeLessThanOrEqual(visibleBottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: resolve(root, `apps/mini-app/e2e/.positions-harness-results/review-flow-${viewport.width}x${viewport.height}.png`), fullPage: false });
  });
}

test('four-position Close review stays in its sheet, preserves approvals and fees, and Edit returns to management', async ({ page }) => {
  await page.route('http://positions.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('http://positions.test/positions');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  if (harness.css) await page.addStyleTag({ content: harness.css });
  await page.addScriptTag({ content: harness.script });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);

  const cards = page.locator('[data-position-key]');
  await expect(cards).toHaveCount(4);
  const openPositions = page.locator('section[aria-labelledby="open-positions-heading"]');
  const actions = page.getByRole('radiogroup', { name: 'Position action', exact: true });
  // The list carries no per-row buttons: a row opens its position, whose
  // actions and form sit directly beneath it.
  await expect(page.getByRole('group', { name: /^Actions for / })).toHaveCount(0);
  await expect(actions).toBeHidden();
  await page.locator('[data-position-key="ETH:long:11"]').click();
  await expect(openPositions).toBeVisible();
  await expect(page.locator('[data-position-details="ETH:long:11"]')).toBeVisible();
  await expect(page).toHaveURL(/\/positions\?position=ETH%3Along%3A11$/);
  await actions.getByRole('radio', { name: 'Close', exact: true }).click();
  const reviewAction = page.getByRole('button', { name: 'Review close', exact: true });
  await expect(reviewAction).toBeVisible();
  await reviewAction.scrollIntoViewIfNeeded();
  await reviewAction.click();
  const confirm = page.getByRole('button', { name: 'Approve position', exact: true });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Manage position', exact: true })).toHaveCount(1);
  await expect(page.locator('[data-mobile-review-sheet]')).toHaveCount(0);
  await expect(page.locator('.reviewInlineContent').last()).toHaveCSS('padding', '0px');
  await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(0);
  await expect(page.getByText('Gas tier', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Network fee', { exact: true })).toBeVisible();
  const minimum = page.locator('[data-review-fact="Minimum received"]');
  await expect(minimum.getByText('You receive · minimum', { exact: true })).toBeVisible();
  await expect(minimum.getByLabel('Show exact amount: 99 USDC', { exact: true })).toBeVisible();
  await page.evaluate(() => { (document.querySelector<HTMLElement>('[data-position-sheet-body]') ?? document.querySelector<HTMLElement>('[data-shell-content]')!).scrollTop = 0; });
  const confirmFitsAboveNavigation = async () => confirm.evaluate((button) => {
    const nav = document.querySelector('[data-app-navigation]')!.getBoundingClientRect();
    const action = button.getBoundingClientRect();
    const bottom = document.querySelector('[data-position-sheet-body]')?.getBoundingClientRect().bottom ?? nav.top;
    return action.top >= 0 && action.bottom <= bottom;
  });
  await expect.poll(confirmFitsAboveNavigation).toBe(true);
  await page.screenshot({ path: resolve(root, 'apps/mini-app/e2e/.positions-harness-results/close-review-393x852.png'), fullPage: false });
  await expect(openPositions).toBeVisible();
  const backgroundNavigation = page.locator('[data-positions-header]');
  await expect(backgroundNavigation).toBeVisible();
  expect(await backgroundNavigation.evaluate(node => Boolean(node.closest('[inert]')))).toBe(true);
  await expect(page.getByRole('heading', { name: 'ETH long · #11', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Position action', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __positionsReviewHarness: { walletRequests: number } }).__positionsReviewHarness.walletRequests)).toBe(0);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // Edit returns to the position the review came from, with its actions.
  await expect(page.locator('[data-position-details="ETH:long:11"]')).toBeVisible();
  await expect(actions).toBeVisible();
  await expect(reviewAction).toBeVisible();
  await expect(openPositions).toBeVisible();
  // Closing management returns to the list and its page actions.
  await page.getByRole('button', { name: 'Close position manager', exact: true }).click();
  await expect(openPositions).toBeVisible();
  await expect(page.locator('[data-positions-header]')).toBeVisible();
  await expect(actions).toBeHidden();
  await expect(page).toHaveURL(/\/positions$/);
  await page.evaluate(() => { (document.querySelector<HTMLElement>('[data-position-sheet-body]') ?? document.querySelector<HTMLElement>('[data-shell-content]')!).scrollTop = 0; });
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __positionsReviewHarness: { walletRequests: number } }).__positionsReviewHarness.walletRequests)).toBe(0);

  await page.evaluate(() => {
    const harness = (globalThis as typeof globalThis & { __positionsReviewHarness: { wallet: { isEmbedded: boolean; connectionVersion: number }; rerender?: () => void } }).__positionsReviewHarness;
    harness.wallet.isEmbedded = true;
    harness.wallet.connectionVersion += 1;
    harness.rerender?.();
  });
  await page.locator('[data-position-key="ETH:long:11"]').click();
  await actions.getByRole('radio', { name: 'Close', exact: true }).click();
  await reviewAction.scrollIntoViewIfNeeded();
  await reviewAction.click();
  const embeddedConfirm = page.getByRole('button', { name: 'Approve position', exact: true });
  await expect(embeddedConfirm).toBeVisible();
  await openAdvanced(page);
  await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(3);
  await expect(page.getByText('Network fee', { exact: true })).toBeVisible();
  const embeddedBox = await embeddedConfirm.boundingBox();
  const embeddedNavBox = await page.locator('[data-app-navigation]').boundingBox();
  expect(embeddedBox).not.toBeNull();
  expect(embeddedNavBox).not.toBeNull();
  const sheetBottom = await page.locator('[data-position-sheet-body]').evaluate(node => node.getBoundingClientRect().bottom);
  expect(embeddedBox!.y + embeddedBox!.height).toBeLessThanOrEqual(sheetBottom);
  await page.evaluate(() => {
    const content = (document.querySelector<HTMLElement>('[data-position-sheet-body]') ?? document.querySelector<HTMLElement>('[data-shell-content]')!);
    content.scrollTop = content.scrollHeight;
  });
  await embeddedConfirm.scrollIntoViewIfNeeded();
  // Expanded details scroll in the terms region while the decision remains
  // after that region and clear of the navigation.
  const reviewInformation = page.getByRole('region', { name: 'Review information', exact: true });
  await expect(reviewInformation).toHaveCSS('overflow-y', 'auto');
  await expect.poll(() => reviewInformation.evaluate(node => { node.scrollTop = node.scrollHeight; return Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop); })).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    const contentScrollTop = await reviewInformation.evaluate(node => node.scrollTop);
    const action = await embeddedConfirm.boundingBox();
    const nav = await page.locator('[data-app-navigation]').boundingBox();
    const bottom = await page.locator('[data-position-sheet-body]').evaluate(node => node.getBoundingClientRect().bottom);
    return contentScrollTop > 0 && Boolean(action && nav && action.y >= 0 && action.y + action.height <= bottom);
  }).toBe(true);
  expect(await embeddedConfirm.evaluate((button) => {
    for (let node: Element | null = button; node && !node.matches('[data-position-sheet-body], [data-shell-content]'); node = node.parentElement) {
      if (['sticky', 'fixed'].includes(getComputedStyle(node).position)) return false;
    }
    return true;
  })).toBe(true);
  const clipping = await page.locator('.reviewInlineContent').last().evaluate((node) => ({
    clientWidth: (node as HTMLElement).clientWidth,
    scrollWidth: (node as HTMLElement).scrollWidth,
  }));
  expect(clipping.scrollWidth).toBeLessThanOrEqual(clipping.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
});

test('Add, Reduce, Close, and Leverage use one desktop review column and an inert phone underlay; context changes reset input and an empty final read keeps the review mounted', async ({ page }) => {
  await page.route('http://positions.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('http://positions.test/positions?position=ETH%3Along%3A11&action=close');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  if (harness.css) await page.addStyleTag({ content: harness.css });
  await page.addScriptTag({ content: harness.script });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  const actions = page.getByRole('radiogroup', { name: 'Position action', exact: true });
  const positionsColumn = page.locator('section[aria-labelledby="open-positions-heading"]');
  const nameByAction: Record<string, string> = {
    Add: 'Review deposit',
    Reduce: 'Review reduction',
    Close: 'Review close',
    Leverage: 'Review leverage',
  };
  for (const action of ['Add', 'Reduce', 'Close', 'Leverage']) {
    await actions.getByRole('radio', { name: action, exact: true }).click();
    if (action === 'Add') await page.getByRole('textbox', { name: 'Amount to add', exact: true }).fill('1');
    const reviewAction = page.getByRole('button', { name: nameByAction[action], exact: true });
    await expect(reviewAction).toBeVisible();
    await reviewAction.click();
    await expect(page.getByRole('button', { name: 'Approve position', exact: true })).toBeVisible();
    await expect(positionsColumn).toBeVisible();
    expect(await positionsColumn.evaluate(node => Boolean(node.closest('[inert]')))).toBe(true);
    const tradeViews = page.locator('[data-positions-header]');
    await expect(tradeViews).toBeVisible();
    expect(await tradeViews.evaluate(node => Boolean(node.closest('[inert]')))).toBe(true);
    await expect(actions).toHaveCount(0);
    // The same accepted review becomes a single inline column on desktop;
    // the phone keeps its list behind the one owned management sheet.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('dialog', { name: 'Manage position', exact: true })).toHaveCount(0);
    await expect(positionsColumn).toBeHidden();
    await expect(positionsColumn.locator('..')).toHaveAttribute('data-review', 'true');
    await expect(positionsColumn.locator('..')).toHaveCSS('display', 'block');
    await expect(tradeViews).toHaveCount(0);
    await expect(page.locator('[data-review-viewport]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Approve position', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.getByRole('dialog', { name: 'Manage position', exact: true })).toBeVisible();
    await expect(positionsColumn).toBeVisible();
    expect(await positionsColumn.evaluate(node => Boolean(node.closest('[inert]')))).toBe(true);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    // The linked position stays open with its actions; the list waits behind it.
    await expect(page.locator('[data-position-details="ETH:long:11"]')).toBeVisible();
    await expect(positionsColumn).toBeVisible();
    expect(await positionsColumn.evaluate(node => Boolean(node.closest('[inert]')))).toBe(true);
    await expect(actions).toBeVisible();
  }

  await page.getByRole('button', { name: 'Review leverage', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve position', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __positionsReviewHarness: { wallet: { address: string; connectionVersion: number }; rerender?: () => void } }).__positionsReviewHarness;
    h.wallet = { ...h.wallet, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', connectionVersion: h.wallet.connectionVersion + 1 };
    h.rerender?.();
  });
  await expect(page.getByRole('button', { name: 'Approve position', exact: true })).toHaveCount(0);
  // Another wallet starts from its list, not from the previous wallet's position.
  await expect(page.locator('section[aria-labelledby="open-positions-heading"]')).toBeVisible();
  await expect(actions).toBeHidden();
  await expect(page).toHaveURL(/\/positions$/);

  const currentPosition = page.locator('[data-position-key="ETH:long:11"]');
  await expect(currentPosition).toBeVisible();
  await currentPosition.click();
  await actions.getByRole('radio', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount to add', exact: true }).fill('1');
  const closeReview = page.getByRole('button', { name: 'Review deposit', exact: true });
  await closeReview.click();
  await expect(page.getByRole('button', { name: 'Approve position', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __positionsReviewHarness: { setReviewStage?: (stage: string) => void; rerender?: () => void } }).__positionsReviewHarness;
    h.setReviewStage?.('executing');
    h.rerender?.();
  });
  await expect(page.locator('[data-position-stage="executing"]')).toHaveCount(1);
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __positionsReviewHarness: { wallet: { address: string; connectionVersion: number }; setReviewStage?: (stage: string) => void; rerender?: () => void } }).__positionsReviewHarness;
    h.setReviewStage?.('result');
    h.wallet = { ...h.wallet, address: '0xcccccccccccccccccccccccccccccccccccccccc', connectionVersion: h.wallet.connectionVersion + 1 };
    h.rerender?.();
  });
  await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
  const preservedManager = page.locator('section[aria-label="Add to ETH long position review"]');
  await expect(preservedManager).toBeVisible();
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __positionsReviewHarness: { shared: Record<string, unknown>; rerender?: () => void } }).__positionsReviewHarness;
    h.shared = { ...h.shared, positions: [], pendingPositions: [], status: 'ready' };
    h.rerender?.();
  });
  await expect(preservedManager).toBeVisible();
  // This lifecycle fixture has a hash but no verified receipt, so it retains
  // Advanced evidence instead of claiming compact verified success. The
  // submitting wallet must survive a later connected-account change.
  await expect(preservedManager.getByRole('region', { name: 'Confirmed transaction receipt', exact: true })).toHaveCount(0);
  const resultDetails = preservedManager.locator('details').filter({ has: page.getByText('Advanced', { exact: true }) });
  await resultDetails.locator(':scope > summary').click();
  await expect(preservedManager.locator('[title="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]')).toBeVisible();
  await expect(preservedManager.getByRole('link', { name: /^Action 2: Submitted\. View transaction/ })).toHaveAttribute('href', 'https://etherscan.io/tx/0x' + '1'.repeat(64));
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __positionsReviewHarness: { walletRequests: number } }).__positionsReviewHarness.walletRequests)).toBe(0);
});

test('submitted transaction status and explorer link remain reachable inside the owned review sheet', async ({ page }) => {
  await page.route('http://positions.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  const hash = `0x${'a'.repeat(64)}`;
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('http://positions.test/positions');
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    if (harness.css) await page.addStyleTag({ content: harness.css });
    await page.addScriptTag({ content: harness.script });
    await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);

    await page.locator('[data-position-key="ETH:long:11"]').click();
    await page.getByRole('radiogroup', { name: 'Position action', exact: true }).getByRole('radio', { name: 'Close', exact: true }).click();
    const reviewAction = page.getByRole('button', { name: 'Review close', exact: true });
    await reviewAction.scrollIntoViewIfNeeded();
    await reviewAction.click();

    const reviewInformation = page.getByRole('region', { name: 'Review information', exact: true });
    await openAdvanced(page);
    await expect(reviewInformation).toHaveCSS('overflow-y', 'auto');
    await expect.poll(() => reviewInformation.evaluate(node => node.clientHeight)).toBeGreaterThan(0);

    await page.evaluate((submittedHash) => {
      const h = (globalThis as typeof globalThis & {
        __positionsReviewHarness: {
          setReviewStage?: (stage: string) => void;
          setReviewStepResults?: (steps: unknown[]) => void;
        };
      }).__positionsReviewHarness;
      h.setReviewStepResults?.([{
        index: 1,
        transaction: { kind: 'action', type: 'reducePosition', chainId: 1, to: '0x1111111111111111111111111111111111111111', data: '0x12345678', value: 0n },
        status: 'submitted', hash: submittedHash,
      }]);
      h.setReviewStage?.('executing');
    }, hash);

    // Entering execution intentionally closes secondary details and resets the
    // review scroll position. Open Advanced in the rendered execution phase,
    // rather than measuring descendants of the now-closed review disclosure.
    await expect(page.locator('[data-position-stage="executing"]')).toHaveCount(1);
    const advanced = page.getByLabel('Advanced transaction details', { exact: true });
    await expect(advanced).toHaveJSProperty('open', false);
    await openAdvanced(page);
    await expect(advanced).toHaveJSProperty('open', true);

    const progress = page.getByRole('region', { name: 'Submitted transactions', exact: true });
    await expect(progress).toBeVisible();
    await expect(progress.getByText('Transaction submitted', { exact: true })).toBeVisible();
    const receipt = progress.locator(`a[href="https://etherscan.io/tx/${hash}"]`);
    await expect(receipt).toBeVisible();
    await expect(receipt).toHaveAttribute('href', `https://etherscan.io/tx/${hash}`);
    await expect(receipt).toContainText(hash.slice(0, 8));
    await progress.scrollIntoViewIfNeeded();
    // The management sheet overlays the background tabbar. Its own terms
    // region is the clipping boundary; a z40 tabbar under the z60 sheet isn't.
    const fitsReview = async () => {
      const [submittedBox, receiptBox, termsBox, sheetBox] = await Promise.all([
        progress.boundingBox(), receipt.boundingBox(), reviewInformation.boundingBox(),
        page.locator('[data-position-sheet-body]').boundingBox(),
      ]);
      if (!submittedBox || !receiptBox || !termsBox || !sheetBox) return false;
      const top = Math.max(0, termsBox.y, sheetBox.y);
      const bottom = Math.min(viewport.height, termsBox.y + termsBox.height, sheetBox.y + sheetBox.height);
      const fullyInside = submittedBox.y >= top - 1 && submittedBox.y + submittedBox.height <= bottom + 1
        && submittedBox.x >= 0 && submittedBox.x + submittedBox.width <= viewport.width
        && receiptBox.y >= submittedBox.y - 1 && receiptBox.y + receiptBox.height <= submittedBox.y + submittedBox.height + 1;
      return fullyInside && await receipt.evaluate(node => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      });
    };
    await expect.poll(async () => { await progress.scrollIntoViewIfNeeded(); return fitsReview(); }).toBe(true);
    const beforeScroll = await progress.boundingBox();
    await reviewInformation.evaluate(node => { node.scrollTop += 80; });
    await expect.poll(async () => (await progress.boundingBox())!.y < beforeScroll!.y - 40).toBe(true);
    await progress.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(root, `apps/mini-app/e2e/.positions-harness-results/submitted-progress-${viewport.width}x${viewport.height}.png`), fullPage: false });
  }
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __positionsReviewHarness: { walletRequests: number } }).__positionsReviewHarness.walletRequests)).toBe(0);
});
