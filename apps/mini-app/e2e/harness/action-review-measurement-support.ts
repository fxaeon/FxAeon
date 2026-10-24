import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { performance } from 'node:perf_hooks';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }> };
const appRequire = createRequire(resolve(root, 'apps/mini-app/package.json'));
const postcss = appRequire('postcss') as (plugins: unknown[]) => { process: (css: string, options: Record<string, unknown>) => Promise<{ css: string }> };
const tailwind = appRequire('tailwindcss') as (options: { config: string }) => unknown;
const autoprefixer = appRequire('autoprefixer') as () => unknown;
const entry = resolve(root, 'apps/mini-app/e2e/harness/action-review-entry.tsx');
const src = resolve(root, 'apps/mini-app/src');

const mocks: Record<string, string> = {
  '@/components/PriceProvider': `export const useUsdPrices = () => { const prices = globalThis.__actionReviewHarness?.displayPrices; return { prices: prices ?? {}, status: prices ? 'ready' : 'unavailable', updatedAt: prices ? Date.now() : null }; };`,
  '@/lib/fx': `
    const H = () => globalThis.__actionReviewHarness;
    // Keep production validation and token identity helpers behind the real
    // result/readback presentation. This fixture never performs live reads.
    export { assertAddress, assertWalletAddress } from './src/lib/fx/validation';
    export { assertPublicClientChain } from './src/lib/fx/clients';
    export { resolveBridgeApprovalTokenAddress, resolveBridgeTokenAddress } from './src/lib/fx/bridge';
    const unexpectedRead = () => { throw new Error('Live protocol reads are outside the action review fixture'); };
    export const getPublicClient = unexpectedRead;
    export const getEthereumClient = unexpectedRead;
    export const getFxReadFacade = unexpectedRead;
    export const FX_TOKENS = { ETH: { key: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, native: true }, USDC: { key: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }, fxUSD: { key: 'fxUSD', address: '0x00000000000000000000000000000000000000c1', decimals: 18 }, fxSAVE: { key: 'fxSAVE', address: '0x00000000000000000000000000000000000000c2', decimals: 18 } };
    // The real fee copy, so the review's max and its shortfall notice are checked together.
    export { formatRouteGasCost } from '@/lib/fx/gasCost';
    export const useRouteGasCost = () => H().gasCost;
    export const routeGasCostCache = { refresh: async (route) => {
      const h = H(); h.gasPreflightCount = (h.gasPreflightCount ?? 0) + 1;
      while (h.gasCost.checking) await new Promise(resolve => setTimeout(resolve, 10));
      if (h.failNextGasPreflight) { h.failNextGasPreflight = false; throw new Error('Network fee check failed. Try again.'); }
      const now = Date.now();
      return { ...h.gasCost.estimate, routeKey: 'fixture', walletAddress: route.walletAddress, chainId: route.chainId,
        operation: route.operation, status: h.gasCost.estimate?.status ?? 'unavailable', steps: [], fetchedAt: now, validUntil: now + 15000, nativeValueWei: h.gasCost.estimate?.nativeValueWei ?? 0n };
    } };
    export async function prepareRoutesForReview(planned, walletAddress) {
      const h = H(); h.prepareCount += 1;
      if (h.previewDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, h.previewDelayMs));
      if (h.failNextPrepare) { h.failNextPrepare = false; throw new Error('mock preview failure'); }
      const route = Array.isArray(planned) ? planned[0] : planned;
      if (h.mode === 'deferred') return new Promise((resolve) => {
        const request = {
          id: h.nextPreviewRequestId++,
          routeVersion: route.harnessRouteVersion,
          routeType: route.details?.routeType ?? '',
          routeWalletAddress: route.walletAddress?.toLowerCase() ?? '',
          previewWalletAddress: walletAddress?.toLowerCase() ?? '',
          connectionVersion: route.harnessConnectionVersion,
          settled: false,
          resolve: () => {
            if (request.settled) return;
            request.settled = true;
            resolve({ viable: [route], failures: [] });
          },
        };
        h.previewRequests.push(request);
      });
      return { viable: [route], failures: [] };
    }
    export async function runTransactionRoute({ route, feeSelection, callbacks }) {
      const h = H(); h.runnerCount += 1;
      h.lastFeeSelection = feeSelection ?? null;
      h.lastExecutedRouteVersion = route.harnessRouteVersion;
      if (h.deferRunner) { h.deferRunner = false; await new Promise((resolve) => h.executionResolvers.push(resolve)); }
      if (h.failRunner) { h.failRunner = false; throw new Error('mock execution failure'); }
      const steps = [];
      for (let index = 0; index < route.transactions.length; index += 1) {
        const transaction = route.transactions[index];
        callbacks.onStatus?.('submitted', 'mock submitted');
        try {
          await callbacks.beforeTransaction?.(index, transaction);
          await callbacks.ensureChain?.(route.chainId);
          const tier = feeSelection?.snapshot?.tiers?.[feeSelection.tier];
          const request = {
            chainId: route.chainId, from: transaction.from ?? route.walletAddress,
            to: transaction.to, data: transaction.data, value: transaction.value,
            nonce: transaction.nonce,
            ...(tier ? { maxFeePerGas: tier.maxFeePerGas, maxPriorityFeePerGas: tier.maxPriorityFeePerGas } : {}),
          };
          const hash = await callbacks.requestSignature(request, { ...transaction });
          if (h.deferReceipt) {
            h.deferReceipt = false;
            callbacks.onStep?.({ index, transaction, status: 'submitted', hash });
            callbacks.onStatus?.('submitted', 'Waiting for the fixture receipt');
            await new Promise(resolve => h.receiptResolvers.push(resolve));
          }
          const step = { index, transaction, status: 'confirmed', hash, receipt: { status: 'success', gasUsed: 21000n, effectiveGasPrice: 1000000000n, logs: transaction.kind === 'action' ? h.receiptLogs ?? [] : [] } };
          steps.push(step);
          callbacks.onStep?.(step);
          if (h.uncertainApproval && transaction.kind === 'approval') {
            const pendingStep = { index, transaction, status: 'submitted', hash };
            steps[steps.length - 1] = pendingStep;
            callbacks.onStep?.(pendingStep);
            callbacks.onStatus?.('submitted', 'approval receipt unavailable');
            return { status: 'failed', operation: route.operation, chainId: route.chainId, walletAddress: route.walletAddress, steps, error: 'Approval confirmation could not be verified.' };
          }
          callbacks.onStatus?.('confirmed', 'mock confirmed');
        } catch (cause) {
          const result = { status: steps.length ? 'partial' : 'failed', operation: route.operation, chainId: route.chainId, walletAddress: route.walletAddress, steps, error: cause instanceof Error ? cause.message : String(cause) };
          callbacks.onStatus?.('failed', result.error);
          await callbacks.postConfirmRead?.(route, result);
          return result;
        }
      }
      const result = { status: h.partialResult ? 'partial' : 'confirmed', operation: route.operation, chainId: route.chainId, walletAddress: route.walletAddress, steps };
      await callbacks.postConfirmRead?.(route, result);
      return result;
    }
    export const saveSignatureRequiredDraft = () => { const h = H(); h.draftSaveCount += 1; return { id: 'mock-draft' }; };
    export const removeSignatureRequiredDraft = () => { H().draftRemoveCount += 1; };
    export const cancelSignatureRequiredDraft = () => { H().draftCancelCount += 1; };
    export const shouldRemoveSignatureDraft = ({ actionSubmitted, routeCompleted }) => actionSubmitted || routeCompleted;
  `,
  '@/lib/fx/gasFeePolicy': `
    const H = () => globalThis.__actionReviewHarness;
    const baseFeePerGasWei = 20000000000n;
    const feeTiers = {
      standard: { tier: 'standard', gasPriceWei: 25000000000n, maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 5000000000n, source: 'rpc' },
      fast: { tier: 'fast', gasPriceWei: 30000000000n, maxFeePerGas: 50000000000n, maxPriorityFeePerGas: 10000000000n, source: 'rpc' },
      rapid: { tier: 'rapid', gasPriceWei: 40000000000n, maxFeePerGas: 60000000000n, maxPriorityFeePerGas: 20000000000n, source: 'rpc' },
    };
    export async function fetchGasTierQuotes(chainId) {
      const now = Date.now();
      H().feeQuoteCount += 1;
      return { chainId, fetchedAt: now, validUntil: now + 300000, source: 'rpc', baseFeePerGasWei, tiers: feeTiers };
    }
    export function selectedGasTierQuote(snapshot, tier) { return { ...snapshot.tiers[tier], validUntil: snapshot.validUntil }; }
    export function formatGasTierQuote(quote) {
      const label = quote.tier.charAt(0).toUpperCase() + quote.tier.slice(1);
      const rate = Number(quote.gasPriceWei) / 1000000000;
      return label + ' · ' + rate + ' Gwei';
    }
    export function formatGasPriceGwei(value) { return String(Number(value) / 1000000000); }
  `,
  '@/lib/wallet': `
    export function usePrivyWallet() {
      const h = globalThis.__actionReviewHarness;
      return { ...h.wallet, wallets: [], selectedWallet: undefined,
        connect: async () => { h.wallet = { ...h.wallet, ready: true, authenticated: true, connectionVersion: h.wallet.connectionVersion + 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 }; h.rerender?.(); },
        disconnect: async () => {}, selectWallet: () => {}, switchChain: async (chainId) => { h.wallet = { ...h.wallet, chainId }; h.rerender?.(); },
        sendTransaction: async (transaction) => { h.sendCount += 1; h.sentTransactions.push({ maxFeePerGas: transaction.maxFeePerGas?.toString(), maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString() }); if (h.rejectActionSignature && transaction.to?.toLowerCase() === '0x00000000000000000000000000000000000000bb') throw new Error('User rejected the action signature'); if (h.deferWalletResponse) { h.deferWalletResponse = false; await new Promise((resolve, reject) => h.walletResolvers.push((shouldReject) => shouldReject ? reject(new Error('User rejected the wallet request')) : resolve())); } return { hash: '0x1111111111111111111111111111111111111111111111111111111111111111' }; },
      };
    }
  `,
  '@/components/WalletDataProvider': `
export const useInvalidateWalletData = () => async () => {
      const h = globalThis.__actionReviewHarness;
      h.refreshStarted = true;
      h.rerender?.();
      if (h.deferRefresh) await new Promise((resolve) => h.refreshResolvers.push(resolve));
      if (h.refreshDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, h.refreshDelayMs));
      h.accountRefreshCount += 1;
      h.rerender?.();
    };
  `,
  '@/lib/walletDataRefresh': `export const createRouteWalletRefresh = (invalidate) => async (route) => invalidate(route.walletAddress, route.chainId);`,
  '@/lib/telegram': `export const haptic = () => {}; export const openExternalLink = () => false;`,
  '@/components/ui': `
    import React, { forwardRef } from 'react';
    export const Card = ({ children, className = '', ...props }) => <div {...props} className={'ui-card astryx-card p-5 ' + className}>{children}</div>;
    export const Button = forwardRef(({ children, onClick, disabled, loading, className = '', variant = 'primary', ...props }, ref) => <button ref={ref} type="button" {...props} disabled={disabled || loading} onClick={onClick} className={'button glass-press astryx-interactive flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3 text-[14px] ' + (variant === 'primary' ? 'button-primary font-semibold' : 'button-ghost text-[var(--text)]') + ' ' + className}>{children}</button>);
    export function AppShell({ children }) {
      return <div data-product-ui="v2" data-shell-tabs="true" className="app-shell app-shell-tabs mx-auto w-full">
        <div className="app-workspace" data-route="/positions">
          <header className="app-topbar">
            <a href="#" aria-label="FxAeon portfolio" className="flex items-center gap-2.5"><span className="h-7 w-7 rounded-lg bg-[var(--mint)] text-center font-bold leading-7 text-[var(--on-accent)]">fx</span><span className="brand-wordmark">FxAeon</span></a>
            <nav className="desktop-navigation" aria-label="Primary navigation"><a href="#">Portfolio</a><a href="#" aria-current="page">Trade</a><a href="#">Earn</a><a href="#">Move</a><a href="#">More</a></nav>
            <span className="app-topbar-actions"><button type="button" className="button min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-2 text-[11px]">Ethereum</button><button type="button" aria-label="Open wallet profile" className="button min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-2 text-[11px]">0x…00aa</button><button type="button" aria-label="Toggle theme" className="button min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-2">◐</button></span>
          </header>
          <main id="main-content" data-shell-content="true" className="app-content app-content-tabs flex-1 outline-none">
            <div className="page-header"><div><p className="text-[11px] font-semibold uppercase tracking-[.12em] text-mut">Layout fixture · no transaction sent</p><h1 className="text-display mt-1 text-[24px] font-semibold">Confirm position changes</h1></div></div>
            {children}
          </main>
        </div>
        <nav data-fixed-navigation="true" className="mobile-tabbar pointer-events-none fixed inset-x-0 bottom-0 z-40" aria-label="Primary navigation"><div className="tabbar-safe mx-auto w-full max-w-[520px]"><div className="tabbar pointer-events-auto">
          {['Home', 'Trade', 'Earn', 'Move', 'More'].map((label, index) => <a key={label} href="#" aria-current={index === 1 ? 'page' : undefined} className={'nav-item nav-item-mobile ' + (index === 1 ? 'nav-item-active text-mint' : 'text-mut')}><span className="nav-icon"><span className="h-[18px] w-[18px] rounded border border-current" /></span><span>{label}</span></a>)}
        </div></div></nav>
      </div>;
    }
  `,
  '@/components/ConnectWalletButton': `
    import React from 'react';
    import { usePrivyWallet } from '@/lib/wallet';
    export default function ConnectWalletButton({ children, onConnectStart, onConnected, onConnectError, ...props }) {
      const wallet = usePrivyWallet();
      return <button type="button" {...props} onClick={async () => { onConnectStart?.(); try { await wallet.connect(); await onConnected?.(); } catch { onConnectError?.(); } }}>{children}</button>;
    }
  `,
  '@/lib/errors': `export const userSafeError = (cause, fallback) => cause instanceof Error ? cause.message : fallback;`,
  '@/lib/transactionProgress': `
    export { transactionStepProgress, transactionExplorerUrl } from './src/lib/transactionProgress';
    export const hasTransactionHash = (step) => Boolean(step?.hash);
    export const transactionStepKind = () => 'Action';
    export const confirmedUpdateCopy = () => ({ label: 'Confirmed', body: 'Mock confirmed.' });
  `,
  '@/components/BridgeTracker': `export const BridgeTracker = () => null;`,
  '@/components/review/ReviewProgress': `
    import React from 'react';
    export { CalldataDisclosure, stepProgress, TransactionHashLink } from './src/components/review/ReviewProgress';
    export const chainName = (id) => id === 8453 ? 'Base' : 'Ethereum';
    export const StatusNotice = ({ label, body }) => <div role="status"><strong>{label}</strong><span>{body}</span></div>;
    export const InlineError = ({ message }) => <div role="alert">{message}</div>;
  `,
  '@/lib/fx/reviewFormatting': `
    export { positionOutcomeFacts } from './src/lib/fx/reviewFormatting';
    export const rawQuoteReviewFacts = () => [];
    import { routeFinancialReviewFacts as acceptedFacts } from './src/lib/fx/reviewFormatting';
    export const routeFinancialReviewFacts = (route) => globalThis.__actionReviewHarness?.financialFacts || route.policy?.reviewedAction?.kind?.startsWith('fxsave-') ? acceptedFacts(route) : [];
    // This isolated harness measures orchestration; exact token formatting is
    // covered by review-formatting.test.ts and the fork browser review.
    export const tokenAmountReviewFact = (label, value) => ({ label, value: String(value), title: String(value) });
  `,
  '@/lib/fx/policy': `import { positionPoolAddress as actualPool } from './src/lib/fx/policy'; export const positionPoolAddress = (...args) => globalThis.__actionReviewHarness?.financialFacts ? actualPool(...args) : '0x00000000000000000000000000000000000000bb';`,
  // The funds notice links to Receive; the isolated harness has no Next router.
  'next/link': `import React from 'react'; export default ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>;`,
  // ActionReview uses router.push for its completion links. This harness
  // mounts into an existing document rather than Next's App Router tree.
  'next/navigation': `export const useRouter = () => ({ push: () => {}, replace: () => {}, prefetch: () => {} });`,
  '@/lib/fx/tokens': `export const FX_TOKENS = { WETH: { key: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 }, fxUSD: { key: 'fxUSD', address: '0x00000000000000000000000000000000000000c1', decimals: 18 }, fxSAVE: { key: 'fxSAVE', address: '0x00000000000000000000000000000000000000c2', decimals: 18 } };`,
};

export async function buildHarness(): Promise<{ script: string; css: string }> {
  type EsbuildPluginBuild = {
    onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void;
    onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void;
  };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, outdir: 'action-review-bundle', entryNames: 'index', format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts', '.module.css': 'local-css' }, absWorkingDir: root,
    plugins: [{
      name: 'action-review-harness-mocks',
      setup(build: EsbuildPluginBuild) {
        build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
          if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
          const candidate = resolve(src, args.path.slice(2));
          for (const file of [candidate, `${candidate}.tsx`, `${candidate}.ts`, resolve(candidate, 'index.ts'), resolve(candidate, 'index.tsx')]) {
            if (existsSync(file) && statSync(file).isFile()) return { path: file };
          }
          return { path: candidate };
        });
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next/link', namespace: 'mock' }));
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next/navigation', namespace: 'mock' }));
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      },
    }],
  });
  const generatedGlobals = await postcss([tailwind({ config: resolve(root, 'apps/mini-app/tailwind.config.js') }), autoprefixer()])
    .process(readFileSync(resolve(src, 'app/globals.css'), 'utf8'), { from: resolve(src, 'app/globals.css') });
  const productShell = readFileSync(resolve(src, 'app/product-shell.css'), 'utf8');
  // A local production build can supply Next's compiled Inter font for exact
  // visual comparison. Portable orchestration tests use its system fallback.
  const interFont = process.env.FXAEON_REVIEW_INTER_FONT;
  const bodyFont = interFont && existsSync(interFont)
    ? `@font-face { font-family: ReviewInter; src: url('/fonts/review-inter.woff2') format('woff2'); font-weight: 100 900; font-display: swap; } :root { --font-sans: ReviewInter, ui-sans-serif, system-ui; }`
    : ':root { --font-sans: ui-sans-serif, system-ui; }';
  return {
    script: result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '',
    css: `${generatedGlobals.css}\n${bodyFont} body { font-family: var(--font-sans), sans-serif; }\n${productShell}\n${result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''}`,
  };
}

let cachedBundle: { script: string; css: string } | undefined;

export async function openHarness(page: Page, options: { initialPreviewMode?: 'auto' | 'deferred'; previewDelayMs?: number; refreshDelayMs?: number; presentationMode?: boolean } = {}): Promise<number> {
  const errors: string[] = [];
  const collectError = (error: Error) => errors.push(error.message);
  page.on('pageerror', collectError);
  if (!cachedBundle) cachedBundle = await buildHarness();
  const startedAt = performance.now();
  const initialOptions = { mode: options.initialPreviewMode, previewDelayMs: options.previewDelayMs ?? 0, refreshDelayMs: options.refreshDelayMs ?? 0, presentationMode: options.presentationMode ?? false };
  if (options.presentationMode) {
    // Screenshots use the actual vendored marks and font, never empty image
    // slots or mocked icons. Financial reads remain the deterministic fixture.
    await page.route(/\/(?:token-icons|chain-icons|fonts)\/[\w.-]+$/, async request => {
      const asset = new URL(request.request().url()).pathname;
      const path = asset === '/fonts/review-inter.woff2' && process.env.FXAEON_REVIEW_INTER_FONT ? process.env.FXAEON_REVIEW_INTER_FONT : resolve(root, 'apps/mini-app/public', `.${asset}`);
      if (!existsSync(path)) return request.abort();
      await request.fulfill({ path });
    });
    if (page.url() === 'about:blank') await page.evaluate(() => {
      const base = document.createElement('base');
      base.href = 'http://fxaeon-review.test/';
      document.head.append(base);
    });
  }
  // Mount into the existing same-origin document instead of navigating it.
  // This keeps the settings storage used by the cross-tab invalidation test,
  // and avoids inheriting the production HTML response's CSP into an inline
  // harness document. The explicit marker below is the readiness signal.
  await page.evaluate(({ bundle, options }) => {
    document.body.replaceChildren();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    (globalThis as typeof globalThis & { __actionReviewHarnessInitialOptions?: typeof options }).__actionReviewHarnessInitialOptions = options;
    const script = document.createElement('script');
    script.textContent = bundle;
    document.body.append(script);
  }, { bundle: cachedBundle.script, options: initialOptions });
  if (cachedBundle.css) await page.addStyleTag({ content: cachedBundle.css });
  try {
    await expect.poll(async () => errors.length ? errors.join('\n') : await page.locator('[data-harness-ready="true"]').count(), { message: 'Review harness should mount without runtime errors' }).toBe(1);
  } finally { page.off('pageerror', collectError); }
  return startedAt;
}

export async function metric(page: Page, key: 'prepare' | 'plan' | 'runner' | 'send' | 'draftSave'): Promise<number> {
  return page.evaluate((metricKey) => {
    const harness = (window as typeof window & { __actionReviewHarness?: Record<string, number> }).__actionReviewHarness;
    return harness?.[`${metricKey}Count`] ?? 0;
  }, key);
}
