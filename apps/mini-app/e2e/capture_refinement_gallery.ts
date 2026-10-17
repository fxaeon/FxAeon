import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { installBrowserAppFixtures } from './fixtures/test';
import { installRefinementGalleryFixtures } from './fixtures/refinement-gallery';
import { browserWalletInitScript, type BrowserWalletShimOptions } from './fixtures/wallet';

type Theme = 'dark';
type Viewport = { width: number; height: number; kind: 'mobile' | 'desktop' };
type CaptureSection = { file: string; scrollTop: number; scrollHeight: number; clientHeight: number; sha256: string };
type CapturedView = {
  id: string;
  route: string;
  theme: Theme;
  viewport: Viewport;
  provenance: 'e2e-app-fixture' | 'generic-state-lab-fixture';
  walletState: 'connected-fixture' | 'disconnected-fixture' | 'not-applicable';
  note: string;
  scrollTarget: string;
  sections: CaptureSection[];
};

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');
const appUrl = validateLocalOrigin(process.env.FX_REFINEMENT_APP_URL ?? 'http://127.0.0.1:4321');
const labPort = Number(process.env.FX_REFINEMENT_STATE_LAB_PORT ?? 4322);
const labUrl = `http://127.0.0.1:${labPort}`;
const outputParent = resolve(process.env.FX_REFINEMENT_OUTPUT_DIR ?? join(repoRoot, 'artifacts', 'refinement', 'generated'));
const capturedAt = new Date().toISOString();
const runName = `run-${capturedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
const output = join(outputParent, runName);
const wallet: BrowserWalletShimOptions = { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true, chainId: '0x1' };
const mobile: Viewport = { width: 393, height: 852, kind: 'mobile' };
const desktop: Viewport = { width: 1440, height: 1000, kind: 'desktop' };
const views: CapturedView[] = [];
const pageErrors: Array<{ view: string; message: string; stack?: string }> = [];
const consoleErrors: Array<{ view: string; message: string }> = [];
const externalRequestFailures: Array<{ view: string; url: string; error: string }> = [];

function validateLocalOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.port || Number(url.port) < 1024) {
    throw new Error('FX_REFINEMENT_APP_URL must be a credential-free localhost HTTP origin with an unprivileged port');
  }
  return url.origin;
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function encodeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

async function pageReady(page: Page, route: string, walletConnected: boolean): Promise<void> {
  // Next dev may compile each route on its first visit. This capture harness
  // measures layout, not cold compilation performance.
  const response = await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (!response?.ok()) throw new Error(`${route} returned HTTP ${response?.status() ?? 'no response'}`);
  await page.locator('main').last().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.loading-line'), null, { timeout: 30_000 });
  if (walletConnected) {
    await page.getByRole('button', { name: 'Open wallet profile', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: /Change network, current (Ethereum|Base)/ }).waitFor({ state: 'visible', timeout: 30_000 });
  } else if (new URL(route, appUrl).pathname === '/login') {
    await page.getByRole('heading', { name: 'Connect your wallet', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'Connect browser wallet', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  } else {
    await page.locator('header').getByRole('button', { name: /^(Connect wallet|Sign in)$/ }).waitFor({ state: 'visible', timeout: 30_000 });
  }
  await page.evaluate(() => document.fonts.ready);
}

function watchPage(page: Page, viewId: string): void {
  page.on('pageerror', (error) => pageErrors.push({ view: viewId, message: error.message, stack: error.stack }));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    // The browser's own favicon probe is not part of any captured view.
    if (/\/favicon\.ico(?:$|\?)/.test(url)) return;
    consoleErrors.push({ view: viewId, message: url ? `${message.text()} (${url})` : message.text() });
  });
  page.on('requestfailed', (request) => {
    externalRequestFailures.push({ view: viewId, url: request.url(), error: request.failure()?.errorText ?? 'unknown' });
  });
}

async function createAppPage(context: BrowserContext, theme: Theme, viewId: string, walletOptions: BrowserWalletShimOptions): Promise<Page> {
  await context.addInitScript(({ origin, themeId }) => {
    if (window.location.origin !== origin) return;
    window.localStorage.setItem('fxaeon_theme_id_v2', themeId);
    window.localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ theme: themeId }));
  }, { origin: appUrl, themeId: theme });
  const page = await context.newPage();
  watchPage(page, viewId);
  await installBrowserAppFixtures(page, { telegram: false, marketPrices: true });
  await installRefinementGalleryFixtures(page);
  // Pass wallet options through Playwright's structured argument channel. The
  // serialized fixture owns its esbuild helper, so init-script ordering is safe.
  await page.addInitScript(browserWalletInitScript(walletOptions), walletOptions);
  return page;
}

async function addFixtureLabel(page: Page, walletConnected: boolean): Promise<void> {
  await page.evaluate((connected) => {
    if (document.querySelector('[data-refinement-provenance]')) return;
    const badge = document.createElement('div');
    badge.textContent = connected ? 'LOCAL E2E FIXTURE · TEST WALLET · ILLUSTRATIVE MARKET DATA' : 'LOCAL E2E FIXTURE · DISCONNECTED WALLET';
    badge.setAttribute('data-refinement-provenance', 'true');
    Object.assign(badge.style, {
      position: 'fixed', top: '3px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
      maxWidth: '96vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none',
      padding: '2px 6px', borderRadius: '4px', background: '#111018', color: '#d8c7ff',
      font: '8px/1.35 system-ui,sans-serif', letterSpacing: '.04em',
    });
    document.body.appendChild(badge);
  }, walletConnected);
}

async function readScrollMetrics(page: Page, selector: string): Promise<{ height: number; client: number; top: number }> {
  const locator = page.locator(selector).first();
  if (await locator.count()) {
    return locator.evaluate((element) => ({
      height: Math.max(element.scrollHeight, element.clientHeight), client: element.clientHeight, top: element.scrollTop,
    }));
  }
  return page.evaluate(() => {
    const element = document.scrollingElement;
    if (!element) throw new Error('document scrolling element is missing');
    return { height: Math.max(element.scrollHeight, element.clientHeight), client: element.clientHeight, top: element.scrollTop };
  });
}

async function setScrollTop(page: Page, selector: string, top: number): Promise<void> {
  const locator = page.locator(selector).first();
  if (await locator.count()) {
    await locator.evaluate((element, value) => element.scrollTo({ top: value, behavior: 'instant' }), top);
  } else {
    await page.evaluate((value) => document.scrollingElement?.scrollTo({ top: value, behavior: 'instant' }), top);
  }
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
}

async function captureScrollView(page: Page, { id, route, theme, viewport, provenance = 'e2e-app-fixture', walletConnected = true, note, scrollTarget = '.app-content', requireScrollTarget = false }: {
  id: string; route: string; theme: Theme; viewport: Viewport; provenance?: CapturedView['provenance']; walletConnected?: boolean; note: string; scrollTarget?: string; requireScrollTarget?: boolean;
}): Promise<void> {
  if (provenance === 'e2e-app-fixture') await addFixtureLabel(page, walletConnected);
  if (requireScrollTarget && !(await page.locator(scrollTarget).count())) throw new Error(`required scroll target is missing for ${id}: ${scrollTarget}`);
  const before = await readScrollMetrics(page, scrollTarget);
  const maxTop = Math.max(0, before.height - before.client);
  const step = Math.max(1, Math.floor(before.client * 0.78));
  const positions: number[] = [0];
  for (let top = step; top < maxTop; top += step) positions.push(top);
  if (maxTop > 0 && positions.at(-1) !== maxTop) positions.push(maxTop);
  const sections: CaptureSection[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    const top = positions[index];
    await setScrollTop(page, scrollTarget, top);
    const metrics = await readScrollMetrics(page, scrollTarget);
    const file = `${safeFilePart(id)}-${String(index + 1).padStart(2, '0')}.png`;
    const buffer = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    writeFileSync(join(output, file), buffer, { flag: 'wx' });
    sections.push({ file, scrollTop: metrics.top, scrollHeight: metrics.height, clientHeight: metrics.client, sha256: createHash('sha256').update(buffer).digest('hex') });
  }
  await setScrollTop(page, scrollTarget, 0);
  const view = { id, route, theme, viewport, provenance, walletState: provenance === 'generic-state-lab-fixture' ? 'not-applicable' as const : walletConnected ? 'connected-fixture' as const : 'disconnected-fixture' as const, note, scrollTarget, sections };
  views.push(view);
  const pageErrorsForView = pageErrors.filter((item) => item.view === id);
  const consoleErrorsForView = consoleErrors.filter((item) => item.view === id);
  if (pageErrorsForView.length || consoleErrorsForView.length) {
    throw new Error(`capture ${id} rejected: ${JSON.stringify({ pageErrors: pageErrorsForView, consoleErrors: consoleErrorsForView })}`);
  }
}

async function captureAppView(browser: Awaited<ReturnType<typeof chromium.launch>>, options: {
  id: string; route: string; theme?: Theme; viewport?: Viewport; walletOptions?: BrowserWalletShimOptions; prepare?: (page: Page) => Promise<void>; scrollTarget?: string; requireScrollTarget?: boolean; note: string;
}): Promise<void> {
  const theme = options.theme ?? 'dark';
  const viewport = options.viewport ?? mobile;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
    colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  try {
    const walletOptions = options.walletOptions ?? wallet;
    const walletConnected = walletOptions.initiallyConnected ?? false;
    const page = await createAppPage(context, theme, options.id, walletOptions);
    await pageReady(page, options.route, walletConnected);
    if (new URL(options.route, appUrl).pathname === '/portfolio') {
      await page.getByRole('button', { name: /View .* on Ethereum/ }).first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('section[aria-label="Positions"] details summary').filter({ hasText: /\d+ open/ }).waitFor({ state: 'visible', timeout: 30_000 });
      const positions = page.locator('section[aria-label="Positions"] details');
      await positions.locator('summary').waitFor({ state: 'visible', timeout: 20_000 });
      if (await positions.evaluate((element) => (element as HTMLDetailsElement).open)) {
        throw new Error(`portfolio positions should be compact by default in ${options.id}`);
      }
      const earn = page.locator('section[aria-labelledby="portfolio-earn-heading"] details').first();
      if (await earn.count()) {
        await earn.locator(':scope > summary').waitFor({ state: 'visible', timeout: 20_000 });
        if (await earn.evaluate((element) => (element as HTMLDetailsElement).open)) {
          throw new Error(`portfolio fxSAVE should be compact by default in ${options.id}`);
        }
      }
    }
    await options.prepare?.(page);
    await captureScrollView(page, { ...options, theme, viewport, walletConnected, note: options.note, scrollTarget: options.scrollTarget ?? '.app-content' });
  } finally {
    await context.close();
  }
}

async function setRadio(page: Page, label: string | RegExp): Promise<void> {
  const control = page.getByRole('radio', { name: label, exact: typeof label === 'string' });
  if (!await control.count()) throw new Error(`required radio option is missing: ${label}`);
  // Choice radios are visually hidden inside their labels, which take the click.
  await control.check({ force: true });
}

async function setToken(page: Page, token: string, label = 'Input asset'): Promise<void> {
  const input = page.getByLabel(label);
  if (!await input.count()) throw new Error(`required ${label} selector is missing`);
  await input.click();
  const option = page.getByRole('option', { name: new RegExp(`^${token}\\b`, 'i') });
  await option.waitFor({ state: 'visible', timeout: 8_000 });
  await option.click();
}

async function captureStateLab(browser: Awaited<ReturnType<typeof chromium.launch>>, labUrlValue: string): Promise<void> {
  const stages = ['Editing', 'Preparing', 'Review', 'Wallet request', 'Submitted', 'Partial completion', 'Confirmed', 'Uncertain'];
  for (const theme of ['dark'] as const) {
    const context = await browser.newContext({ viewport: { width: mobile.width, height: mobile.height }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const id = `state-lab-${theme}`;
      watchPage(page, id);
      const response = await page.goto(labUrlValue, { waitUntil: 'domcontentloaded' });
      if (!response?.ok()) throw new Error(`state lab returned HTTP ${response?.status() ?? 'no response'}`);
      await page.locator('[data-harness-ready="true"]').waitFor({ state: 'attached' });
      for (const stage of stages) {
        await page.getByLabel('Transaction stage', { exact: true }).selectOption({ label: stage });
        const presentation = page.locator('.presentation');
        if (stage !== 'Editing') await presentation.waitFor({ state: 'visible' });
        const clip = stage === 'Editing' ? page.locator('.lab-panel[aria-labelledby="transaction-heading"]') : presentation;
        const file = `state-lab-${theme}-${safeFilePart(stage)}.png`;
        const buffer = await clip.screenshot({ animations: 'disabled', caret: 'hide' });
        writeFileSync(join(output, file), buffer, { flag: 'wx' });
        views.push({
          id: `state-lab-${theme}-${safeFilePart(stage)}`, route: '/', theme, viewport: mobile,
          provenance: 'generic-state-lab-fixture', walletState: 'not-applicable', note: 'Generic ActionReview presentation fixture. It does not represent a flow-specific app quote, signed transaction, or receipt.',
          scrollTarget: stage === 'Editing' ? '.lab-panel[aria-labelledby="transaction-heading"]' : '.presentation',
          sections: [{ file, scrollTop: 0, scrollHeight: 0, clientHeight: 0, sha256: createHash('sha256').update(buffer).digest('hex') }],
        });
      }
      const consequences = page.locator('.consequence-example');
      const consequenceBuffer = await consequences.screenshot({ animations: 'disabled', caret: 'hide' });
      const consequenceFile = `state-lab-${theme}-review-consequences.png`;
      writeFileSync(join(output, consequenceFile), consequenceBuffer, { flag: 'wx' });
      views.push({
        id: `state-lab-${theme}-review-consequences`, route: '/', theme, viewport: mobile,
        provenance: 'generic-state-lab-fixture', walletState: 'not-applicable', note: 'Generic ActionReview consequence-summary fixture; illustrative amounts, not a live route quote.',
        scrollTarget: '.consequence-example',
        sections: [{ file: consequenceFile, scrollTop: 0, scrollHeight: 0, clientHeight: 0, sha256: createHash('sha256').update(consequenceBuffer).digest('hex') }],
      });
      const pageErrorsForView = pageErrors.filter((item) => item.view === id);
      const consoleErrorsForView = consoleErrors.filter((item) => item.view === id);
      if (pageErrorsForView.length || consoleErrorsForView.length) throw new Error(`state-lab capture rejected: ${JSON.stringify({ pageErrors: pageErrorsForView, consoleErrors: consoleErrorsForView })}`);
    } finally {
      await context.close();
    }
  }
}

async function ensureStateLab(): Promise<{ url: string; child?: ChildProcess }> {
  try {
    const response = await fetch(`${labUrl}/`);
    if (response.ok) return { url: labUrl };
  } catch { /* Start a local state-lab server below. */ }
  const child = spawn(process.execPath, ['e2e/ui-state-lab-server.mjs'], {
    cwd: appRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, UI_STATE_LAB_PORT: String(labPort) },
  });
  let startupOutput = '';
  child.stdout.on('data', (chunk: Buffer) => { startupOutput += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { startupOutput += chunk.toString(); });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`state lab exited before becoming ready: ${startupOutput}`);
    try {
      const response = await fetch(`${labUrl}/`);
      if (response.ok) return { url: labUrl, child };
    } catch { /* Keep waiting while the local server starts. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  child.kill();
  throw new Error(`state lab did not become ready at ${labUrl}: ${startupOutput}`);
}

function writeGallery(): void {
  const sections = views.map((view) => `<section><h2>${encodeHtml(view.id)}</h2><p>${encodeHtml(view.note)} · ${view.viewport.width}×${view.viewport.height} · ${encodeHtml(view.theme)}</p><div class="frames">${view.sections.map((section) => `<figure><a href="${encodeHtml(section.file)}"><img loading="lazy" src="${encodeHtml(section.file)}" alt="${encodeHtml(view.id)} scroll section at ${section.scrollTop}px"></a><figcaption>${section.scrollTop}px · ${section.scrollHeight}px total</figcaption></figure>`).join('')}</div></section>`).join('\n');
  const unsupportedStates = [
    { flow: 'Trade ETH/BTC long/short route review', reason: 'The gallery RPC fixture is read-only and returns no route-planning contract state; captures show editable forms and generic ActionReview lab stages.' },
    { flow: 'Earn deposit/withdraw route review', reason: 'The gallery RPC fixture provides illustrative wallet and vault balances only; it does not synthesize vault quotes or transaction routes.' },
    { flow: 'Borrow ETH/WBTC route review', reason: 'No deterministic quote/balance fixture exists in this harness; do not synthesize protocol terms.' },
    { flow: 'Move both direction route review', reason: 'Bridge quote and contract reads require RPC-backed route planning; do not synthesize a bridge quote.' },
  ];
  const report = {
    schemaVersion: 1, capturedAt, source: 'Local Next app plus source-built UI state lab; see release validation for build mode', appUrl,
    dataProvenance: 'Connected test-wallet EIP-1193 shim; gallery-local read-only RPC values and ready-empty position index; deterministic market data from e2e/fixtures/test.ts; no app backend; visible provenance label on app screenshots.',
    transactionInteraction: 'No confirmation, sendTransaction, signature, or chain mutation invoked.',
    viewportCoverage: { mobile: '393×852 requested, device scale 1', desktop: '1440×1000 spot captures' },
    viewCount: views.length, views, unsupportedStates, pageErrors, consoleErrors, externalRequestFailures,
    reviewNotesPath: 'artifacts/refinement/review-notes.md',
    scope: 'Rendered UI evidence. Generic state-lab fixtures do not prove flow-specific quotes, balances, transactions, or receipts.',
  };
  writeFileSync(join(output, 'capture-manifest-v2.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FxAeon refinement capture</title><style>body{margin:0;padding:20px;background:#101018;color:#f7f5fc;font:14px/1.5 system-ui,sans-serif}main{max-width:1500px;margin:auto}p{color:#b1a9bf}.frames{display:flex;gap:12px;overflow:auto;align-items:flex-start}figure{margin:0;flex:0 0 min(390px,calc(100vw - 48px))}img{display:block;width:100%;height:auto;border:1px solid #302c3f;border-radius:12px;background:#181721}figcaption{color:#b1a9bf;font-size:12px;padding:5px 2px}section{border-top:1px solid #302c3f;padding:18px 0;margin:10px 0}h1{font-size:28px;margin:0 0 8px}h2{font-size:19px;margin:0 0 6px}</style><main><h1>FxAeon refinement captures</h1><p>Generated ${encodeHtml(capturedAt)}. App screens include a visible deterministic-fixture label. Review-state frames are generic UI fixtures.</p><p><a href="capture-manifest-v2.json">Capture manifest</a> · Record visual before/after findings in <code>artifacts/refinement/review-notes.md</code>.</p>${sections}</main>\n`, { flag: 'wx' });
}

async function main(): Promise<void> {
  mkdirSync(outputParent, { recursive: true });
  mkdirSync(output);
  const lab = await ensureStateLab();
  // Same browser resolution as the e2e suites: installed Chrome when Playwright's bundle is absent.
  const { configuredBrowserChannel } = createRequire(import.meta.url)(join(repoRoot, 'scripts', 'e2e_browser_channel.cjs')) as { configuredBrowserChannel: () => string | undefined };
  const browser = await chromium.launch({ channel: configuredBrowserChannel(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await captureAppView(browser, { id: 'portfolio-dark-mobile', route: '/portfolio', theme: 'dark', note: 'Read-only connected test wallet with deterministic token balances; positions are verified ready-empty. All values are illustrative gallery fixtures.' });
    await captureAppView(browser, { id: 'portfolio-dark-desktop', route: '/portfolio', theme: 'dark', viewport: desktop, note: 'Desktop spot with deterministic read-only token balances and a verified ready-empty position state; illustrative gallery fixtures.' });
    for (const theme of ['dark'] as const) {
      await captureAppView(browser, {
        id: `wallet-profile-${theme}-mobile`, route: '/portfolio', theme, note: 'Wallet profile with deterministic read-only token balances; all values are illustrative gallery fixtures.',
        prepare: async (page) => {
          const opener = page.getByRole('button', { name: 'Open wallet profile', exact: true });
          await opener.waitFor({ state: 'visible', timeout: 20_000 });
          await opener.click();
          await page.getByRole('dialog').waitFor({ state: 'visible' });
        },
        scrollTarget: '.wallet-profile-backdrop [class*="WalletProfile_body"]', requireScrollTarget: true,
      });
    }
    await captureAppView(browser, {
      id: 'wallet-asset-eth', route: '/portfolio', theme: 'dark',
      note: 'ETH asset detail with an illustrative read-only balance and test wallet address.',
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
        await page.getByRole('button', { name: 'View ETH details on Ethereum', exact: true }).click();
        await page.getByRole('dialog', { name: 'ETH on Ethereum', exact: true }).waitFor({ state: 'visible' });
      },
      scrollTarget: '[class*="WalletAssetDetails_modalBody"]', requireScrollTarget: true,
    });
    await captureAppView(browser, {
      id: 'wallet-profile-dark-desktop', route: '/portfolio', theme: 'dark', viewport: desktop,
      note: 'Wallet profile desktop spot with deterministic read-only token balances; illustrative gallery fixtures.',
      prepare: async (page) => { await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'visible' }); },
      scrollTarget: '.wallet-profile-backdrop [class*="WalletProfile_body"]', requireScrollTarget: true,
    });
    for (const market of ['ETH', 'BTC'] as const) {
      for (const side of ['Long', 'Short'] as const) {
        await captureAppView(browser, {
          id: `trade-${market.toLowerCase()}-${side.toLowerCase()}`, route: '/trade', theme: 'dark',
          note: `${market} ${side.toLowerCase()} editable trade form; no quote or protocol balance is asserted.`,
          prepare: async (page) => {
            await setRadio(page, market);
            await setRadio(page, side);
            await page.locator('[data-trade-ticket]').waitFor({ state: 'visible' });
          },
        });
      }
    }
    await captureAppView(browser, { id: 'trade-dark-desktop', route: '/trade', theme: 'dark', viewport: desktop, note: 'Trade desktop spot, editable form; no route quote is asserted.' });
    await captureAppView(browser, { id: 'earn-deposit', route: '/earn', theme: 'dark', note: 'Earn deposit editor with illustrative wallet and vault balances; no transaction quote.' });
    await captureAppView(browser, {
      id: 'earn-withdraw-instant', route: '/earn', theme: 'dark', note: 'Earn instant withdrawal editor; fixture selection only, no withdrawal quote.',
      prepare: async (page) => {
        await setRadio(page, 'Withdraw');
        await setRadio(page, /Instant/);
      },
    });
    await captureAppView(browser, {
      id: 'earn-withdraw-queued', route: '/earn', theme: 'dark', note: 'Earn after-cooldown withdrawal editor; fixture selection only, no withdrawal quote.',
      prepare: async (page) => {
        await setRadio(page, 'Withdraw');
        await setRadio(page, /After cooldown/);
      },
    });
    await captureAppView(browser, { id: 'borrow-eth-collateral', route: '/borrow', theme: 'dark', note: 'Borrow editor with ETH collateral; no protocol balance or quote is asserted.' });
    await captureAppView(browser, {
      id: 'borrow-wbtc-collateral', route: '/borrow', theme: 'dark', note: 'Borrow editor with WBTC collateral selected; no protocol balance or quote is asserted.',
      prepare: async (page) => setToken(page, 'WBTC', 'Collateral asset'),
    });
    await captureAppView(browser, { id: 'move-ethereum-to-base', route: '/move', theme: 'dark', note: 'Move editor, Ethereum to Base; no bridge quote is asserted.' });
    await captureAppView(browser, {
      id: 'move-base-to-ethereum', route: '/move', theme: 'dark', note: 'Move editor, Base to Ethereum; no bridge quote is asserted.',
      prepare: async (page) => {
        const reverse = page.getByRole('button', { name: /Reverse route to Ethereum/ });
        await reverse.waitFor({ state: 'visible' });
        await reverse.click();
      },
    });
    for (const theme of ['dark'] as const) {
      await captureAppView(browser, {
        id: `trade-eth-long-${theme}-mobile`, route: '/trade', theme,
        note: `ETH Long form in the ${theme} theme; deterministic fixture only, no quote or protocol balance asserted.`,
        prepare: async (page) => {
          await setRadio(page, 'ETH');
          await setRadio(page, 'Long');
          await page.locator('[data-trade-ticket]').waitFor({ state: 'visible' });
        },
      });
      await captureAppView(browser, {
        id: `earn-withdraw-instant-${theme}-mobile`, route: '/earn', theme,
        note: `Instant withdrawal editor in the ${theme} theme; fixture selection only, no withdrawal quote.`,
        prepare: async (page) => {
          await setRadio(page, 'Withdraw');
          await setRadio(page, /Instant/);
        },
      });
      await captureAppView(browser, {
        id: `borrow-default-${theme}-mobile`, route: '/borrow', theme,
        note: `Default Borrow editor in the ${theme} theme; no protocol balance or quote asserted.`,
      });
      await captureAppView(browser, {
        id: `move-default-${theme}-mobile`, route: '/move', theme,
        note: `Default Move editor in the ${theme} theme; no bridge quote asserted.`,
      });
    }
    for (const [id, route] of [
      ['settings', '/settings'], ['history', '/history'], ['receive', '/qr'], ['docs', '/docs'], ['privacy-docs-section', '/docs#privacy'], ['more', '/more'], ['positions', '/positions'], ['login', '/login'],
    ] as const) {
      await captureAppView(browser, {
        id, route, theme: 'dark', note: id === 'login'
          ? 'Disconnected wallet fixture; route rendering only, no credentials or login completion implied.'
          : `${id} route rendered with connected test wallet; illustrative data only.`,
        ...(id === 'login' ? { walletOptions: { ...wallet, initiallyConnected: false } } : {}),
      });
    }
    await captureStateLab(browser, lab.url);
    writeGallery();
  } finally {
    await browser.close();
    if (lab.child && lab.child.exitCode === null) {
      lab.child.kill();
      await new Promise<void>((resolveExit, rejectExit) => {
        lab.child!.once('exit', () => resolveExit());
        lab.child!.once('error', rejectExit);
      });
    }
  }
  process.stdout.write(`Captured ${views.length} refinement UI views into ${output}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
