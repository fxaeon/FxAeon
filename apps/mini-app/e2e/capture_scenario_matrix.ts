/**
 * Read-only visual catalog; never a transaction runner.
 * From apps/mini-app: node node_modules/tsx/dist/cli.mjs e2e/capture_scenario_matrix.ts
 * Start a configured local static export and a fresh state lab separately.
 * FX_SCENARIO_APP_URL=http://127.0.0.1:4347
 * FX_SCENARIO_LAB_URL=http://127.0.0.1:4348
 * FX_SCENARIO_SECTION=all|app|transactions|positions (default all)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { installBrowserAppFixtures } from './fixtures/test';
import { installRefinementGalleryFixtures, type GalleryBalanceState, type GalleryRead } from './fixtures/refinement-gallery';
import { openHarness } from './harness/action-review-measurement-support';
import { buildPositionBrakeLab } from './harness/position-brake-build';
import { essentialReviewGeometry, expectClosedReviewFits } from './harness/review-essential-geometry';

const appRoot = resolve(__dirname, '..');
const repoRoot = resolve(appRoot, '../..');
function localOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || !url.port || Number(url.port) < 1024 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Capture servers must be credential-free loopback HTTP origins with unprivileged ports');
  }
  return url.origin;
}
const appUrl = localOrigin(process.env.FX_SCENARIO_APP_URL ?? 'http://127.0.0.1:4347');
const labUrl = localOrigin(process.env.FX_SCENARIO_LAB_URL ?? 'http://127.0.0.1:4348');
const section = process.env.FX_SCENARIO_SECTION ?? 'all';
if (!['all', 'app', 'transactions', 'positions'].includes(section)) throw new Error('Unknown FX_SCENARIO_SECTION');
const viewports = [
  { id: 'phone', width: 390, height: 770 },
  { id: 'short-phone', width: 390, height: 500 },
  { id: 'desktop', width: 1280, height: 900 },
] as const;
type Viewport = typeof viewports[number];
type Capture = { id: string; provenance: string; state: string; viewport: Viewport; url: string; note: string;
  images: Array<{ file: string; sha256: string; position: string }>; rpcRequests: GalleryRead[]; geometry?: unknown; errors: string[] };
const captures: Capture[] = [];
const failures: Array<{ id: string; error: string }> = [];
const blockedRequests: Array<{ case: string; url: string; method: string }> = [];
const timestamp = new Date().toISOString();
const output = resolve(process.env.FX_SCENARIO_OUTPUT_DIR ?? resolve(repoRoot, 'artifacts/scenarios', timestamp.replace(/[:.]/g, '-')));
const included = (value: string) => section === 'all' || section === value;
const plannedCases = (included('app') ? 54 : 0) + (included('transactions') ? 51 : 0) + (included('positions') ? 3 : 0);
function gitIdentity() {
  try {
    const options = { cwd: repoRoot, encoding: 'utf8' as const, windowsHide: true };
    return { revision: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], options).trim()) };
  } catch { return { revision: null, dirty: null }; }
}
const sourceAtStart = gitIdentity();
const runtimeIdentity: { node: string; browser: string | null; appVersion: string | null;
  localBuildId: string | null; localBuildIdPath: string | null; localReleaseRevision: string | null; servedHomeSha256: string | null } = {
  node: process.version, browser: null, appVersion: null, localBuildId: null, localBuildIdPath: null, localReleaseRevision: null, servedHomeSha256: null,
};
async function readBuildIdentity() {
  const optionalText = (path: string) => readFile(resolve(appRoot, path), 'utf8').catch(() => null);
  const [pkg, buildId, nextBuildId, release] = await Promise.all([
    optionalText('package.json'), optionalText('dist/BUILD_ID'), optionalText('.next/BUILD_ID'), optionalText('dist/release.json'),
  ]);
  runtimeIdentity.appVersion = pkg ? (JSON.parse(pkg) as { version?: string }).version ?? null : null;
  runtimeIdentity.localBuildId = (buildId ?? nextBuildId)?.trim() ?? null;
  runtimeIdentity.localBuildIdPath = buildId !== null ? 'dist/BUILD_ID' : nextBuildId !== null ? '.next/BUILD_ID' : null;
  const revision = release ? (JSON.parse(release) as { revision?: string }).revision : undefined;
  runtimeIdentity.localReleaseRevision = revision && /^[a-f\d]{40}$/i.test(revision) ? revision : null;
  if (included('app')) {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(5_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Built app identity request returned HTTP ${response.status}`);
    runtimeIdentity.servedHomeSha256 = createHash('sha256').update(await response.text()).digest('hex');
  }
}

async function isolatedPage(browser: Browser, viewport: Viewport, id: string): Promise<{ page: Page; context: BrowserContext; errors: string[] }> {
  const context = await browser.newContext({ viewport, isMobile: viewport.id !== 'desktop', hasTouch: viewport.id !== 'desktop',
    deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Later, explicit fixture routes may fulfill read-only RPC POST requests.
  // Everything else stays local and read-only; unknown requests never reach a server.
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if ([appUrl, labUrl].includes(url.origin) && ['GET', 'HEAD'].includes(request.method())) return route.continue();
    blockedRequests.push({ case: id, url: `${url.origin}${url.pathname}`, method: request.method() });
    return route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  return { page, context, errors };
}

async function label(page: Page, state: string): Promise<void> {
  await page.evaluate(text => {
    document.querySelector('[data-scenario-provenance]')?.remove();
    const badge = document.createElement('div');
    badge.dataset.scenarioProvenance = 'true';
    badge.textContent = `SIMULATION · ${text} · NO TRANSACTION SENT`;
    Object.assign(badge.style, { position: 'fixed', top: '2px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', pointerEvents: 'none', maxWidth: '98vw', padding: '2px 5px', borderRadius: '3px',
      background: '#151515', color: '#a5f3cf', font: '8px/1.4 system-ui,sans-serif', whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' });
    document.body.append(badge);
  }, state);
}

async function snapshot(page: Page, capture: Capture, position = 'initial'): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.load('600 28px Manrope');
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
  });
  const file = `${capture.id}-${position}.png`;
  const bytes = await page.screenshot({ path: resolve(output, file), animations: 'disabled', caret: 'hide' });
  capture.images.push({ file, position, sha256: createHash('sha256').update(bytes).digest('hex') });
}

async function collect(browser: Browser, viewport: Viewport, id: string, body: (page: Page, capture: Capture) => Promise<void>): Promise<void> {
  const { page, context, errors } = await isolatedPage(browser, viewport, id);
  const capture: Capture = { id, viewport, provenance: '', state: '', url: '', note: '', images: [], rpcRequests: [], errors };
  captures.push(capture);
  try {
    await body(page, capture);
    if (errors.length) throw new Error(`Browser runtime errors: ${errors.join('; ')}`);
    console.log(`Captured ${id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ id, error: message });
    console.error(`FAILED ${id}: ${message}`);
    try { await label(page, 'FAILED CAPTURE · see report'); await snapshot(page, capture, 'failed'); } catch { /* The failure remains in the report. */ }
  } finally { await context.close(); }
}

async function settledAppState(page: Page, route: string, state: GalleryBalanceState): Promise<void> {
  if (state === 'unavailable') {
    if (route === '/portfolio') await expect(page.getByLabel('Portfolio value unavailable', { exact: true })).toBeVisible({ timeout: 25_000 });
    else if (route === '/wallet') await expect(page.getByLabel('Wallet value unavailable', { exact: true })).toBeVisible({ timeout: 25_000 });
    else await expect(page.locator('main [data-amount-field] [id$="-balance"]').first().locator('.missing-value-unavailable')).toBeVisible({ timeout: 25_000 });
    return;
  }
  const value = route === '/portfolio' ? page.locator('[data-portfolio-value]')
    : route === '/wallet' ? page.locator('[aria-labelledby="wallet-value-heading"] > strong')
      : page.locator('main [data-amount-field] [id$="-balance"]').first();
  await expect.poll(async () => {
    const text = await value.innerText();
    const match = text.match(/[\d,]+(?:\.\d+)?/);
    const number = match ? Number(match[0].replaceAll(',', '')) : NaN;
    return Number.isFinite(number) && (state === 'zero' ? number === 0 : number > 0);
  }, { timeout: 25_000, message: `${route} must display a settled ${state === 'zero' ? 'verified zero' : 'positive'} balance or total` }).toBe(true);
  await expect(value.locator('.missing-value-bar')).toHaveCount(0);
}

async function assertVisibleAction(page: Page): Promise<unknown> {
  const action = page.locator('.reviewTrigger .button-primary').first();
  await action.scrollIntoViewIfNeeded();
  const geometry = await action.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const main = document.querySelector('main.app-content')!.getBoundingClientRect();
    const nav = document.querySelector('nav.mobile-tabbar');
    const navTop = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
    return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width, mainTop: main.top,
      visibleBottom: Math.min(main.bottom, navTop), hit: [rect.top + 4, rect.top + rect.height / 2, rect.bottom - 4].every(y => {
        const hit = document.elementFromPoint(rect.left + rect.width / 2, y);
        return hit === element || Boolean(hit && element.contains(hit));
      }) };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.mainTop - 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom + 1);
  expect(geometry.height).toBeGreaterThanOrEqual(48);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.hit, 'The whole primary action must receive pointer input above navigation').toBe(true);
  return geometry;
}

async function lifecycleGeometry(page: Page, capture: Capture, requireAction: boolean): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(capture.viewport.width);
  // Failed results intentionally use a quiet recovery button, rather than
  // a primary-colored financial action. Both share the real footer wrapper.
  const action = page.locator('[data-review-actions] button').last();
  if (requireAction) await expect(action).toBeVisible();
  const readAction = async () => {
    if (!await action.count()) return null;
    const geometry = await action.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, hit: [rect.top + 4, rect.top + rect.height / 2, rect.bottom - 4].every(y => {
        const hit = document.elementFromPoint(rect.left + rect.width / 2, y);
        return hit === element || Boolean(hit && element.contains(hit));
      }) };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(capture.viewport.height + 1);
    expect(geometry.height).toBeGreaterThanOrEqual(48);
    expect(geometry.hit, 'Lifecycle footer action must be wholly reachable without scrolling the footer').toBe(true);
    return geometry;
  };
  const initialAction = await readAction();
  const review = page.locator('[data-review-viewport][data-review-phase="review"]');
  const essential = await review.count() ? await essentialReviewGeometry(review) : null;
  capture.geometry = { initialAction, essential };
  // Unexpanded essentials must fit even on the short phone. Opening exact
  // values/details or enlarging text may introduce separately measured scroll.
  if (essential) {
    expectClosedReviewFits(essential);
    const details = review.locator('details[data-review-secondary] > summary');
    if (await details.count()) await expect(details).toBeInViewport({ ratio: 1 });
  }
  let networkFee: { displayed: string; exact: string } | null = null;
  if (essential) {
    // These review fixtures supply fresh ETH display prices. An ETH fallback
    // must not silently pass as proof of the intended USD-first presentation.
    const fee = review.locator('[data-review-essential] [data-review-fact="Gas fee"]');
    const disclosure = fee.locator('details');
    const summary = disclosure.locator('summary');
    const estimate = summary.locator('[data-usd-state="estimate"]');
    await expect(estimate).toBeVisible();
    await expect(estimate).toHaveText(/\$\d/);
    await expect(summary).toHaveAttribute('aria-label', /Show exact network cost:.*\d.*ETH/);
    const exact = await summary.getAttribute('aria-label');
    networkFee = { displayed: await estimate.innerText(), exact: exact! };
    const body = review.locator('[data-review-scroll]');
    const initialScroll = await body.evaluate(element => element.scrollTop);
    await summary.click();
    await expect(disclosure.locator('p')).toBeVisible();
    await expect(disclosure.locator('p')).toContainText(/\d.*ETH/);
    await expect(disclosure.locator('p')).toContainText('The native amount governs the transaction.');
    await summary.click();
    await body.evaluate((element, top) => element.scrollTo({ top, behavior: 'instant' }), initialScroll);
  }
  capture.geometry = { initialAction, essential, networkFee };
  const scroll = page.locator('[data-review-scroll]:visible').first();
  if (await scroll.count()) {
    const metrics = await scroll.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight }));
    if (metrics.scrollHeight > metrics.height + 1) {
      await scroll.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
      await snapshot(page, capture, 'details-scrolled');
      capture.geometry = { initialAction, essential, networkFee, scrolledAction: await readAction(), body: metrics };
      return;
    }
  }
  capture.geometry = { initialAction, essential, networkFee };
}

async function appCaptures(browser: Browser): Promise<void> {
  for (const viewport of viewports) for (const state of ['funded', 'zero', 'unavailable'] as const) {
    for (const route of ['/trade', '/earn', '/borrow', '/move', '/portfolio', '/wallet']) {
      const id = `${route.slice(1)}-${state}-${viewport.id}`;
      await collect(browser, viewport, id, async (page, capture) => {
        capture.provenance = 'Built app · injected test wallet and intercepted read-only RPC';
        capture.state = state;
        capture.note = 'Real built route. Financial values are fixtures; unsupported protocol planning reads remain unavailable. No Review/Confirm or signing action is clicked.';
        await installBrowserAppFixtures(page, { telegram: false, browserWallet: { initiallyConnected: true }, marketPrices: state !== 'unavailable' });
        const fixture = await installRefinementGalleryFixtures(page, state);
        capture.rpcRequests = fixture.reads;
        capture.url = `${appUrl}${route === '/wallet' ? '/portfolio' : route}`;
        const response = await page.goto(capture.url, { waitUntil: 'domcontentloaded' });
        if (!response?.ok()) throw new Error(`App returned HTTP ${response?.status()}`);
        await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => fixture.reads.some(read => read.method === 'eth_getBalance' || read.method === 'eth_call'),
          { timeout: 15_000, message: 'No financial reads intercepted: rebuild with the documented deterministic Ethereum/Base RPC URLs' }).toBe(true);
        if (route === '/wallet') {
          await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Close wallet profile', exact: true })).toBeVisible();
        } else if (!['/portfolio', '/wallet'].includes(route)) {
          const amount = page.locator('main input[inputmode="decimal"]').first();
          await amount.fill(route === '/trade' ? '0.1' : route === '/borrow' ? '1' : '100');
          await amount.blur();
          await page.locator('main.app-content').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
        }
        await settledAppState(page, route, state);
        await label(page, `${state.toUpperCase()} READ-ONLY APP FIXTURE`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        capture.geometry = await page.evaluate(() => {
          const main = document.querySelector('main.app-content') as HTMLElement | null;
          const action = document.querySelector('.reviewTrigger .button-primary');
          const nav = document.querySelector('nav.mobile-tabbar');
          const rect = action?.getBoundingClientRect();
          return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
            mainBottom: main?.getBoundingClientRect().bottom, scrollHeight: main?.scrollHeight, clientHeight: main?.clientHeight,
            action: rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null,
            navTop: nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : null };
        });
        await snapshot(page, capture);
        const action = page.locator('.reviewTrigger .button-primary').first();
        if (route !== '/wallet' && await action.count()) {
          const box = await action.boundingBox();
          const main = await page.locator('main.app-content').boundingBox();
          const scrolled = Boolean(box && main && (box.y + box.height > main.y + main.height || box.y < main.y));
          const geometry = await assertVisibleAction(page);
          capture.geometry = { initial: capture.geometry, actionAfterScroll: geometry };
          if (scrolled) {
            await snapshot(page, capture, 'action-scrolled');
          }
        }
      });
    }
  }
}

async function transactionCaptures(browser: Browser): Promise<void> {
  for (const viewport of viewports) for (const product of ['borrow', 'earn']) {
    for (const stage of ['review', 'signature-required', 'wallet-request', 'submitted', 'confirmed', 'failed', 'partial-completion', 'uncertain']) {
      await collect(browser, viewport, `${product}-${stage}-${viewport.id}`, async (page, capture) => {
        capture.provenance = 'State lab · actual production review/pending/result presentation with simulated route and receipts';
        capture.state = stage;
        capture.note = 'Independent rendered lifecycle fixture, not the result of the built app form or a wallet transaction. All fixture callbacks remain local.';
        capture.url = `${labUrl}/?view=transaction&product=${product}&stage=${stage}`;
        const response = await page.goto(capture.url, { waitUntil: 'domcontentloaded' });
        if (!response?.ok()) throw new Error(`State lab returned HTTP ${response?.status()}`);
        await expect(page.locator('[data-harness-ready="true"]')).toHaveCount(1);
        await expect(page.locator('.transaction-preview')).toBeVisible();
        await expect(page.getByLabel('Transaction stage', { exact: true })).toHaveValue(stage.replaceAll('-', ' ').replace(/\b\w/, letter => letter.toUpperCase()));
        await label(page, `${product.toUpperCase()} ${stage.toUpperCase()} · RENDERED LIFECYCLE`);
        await snapshot(page, capture);
        await lifecycleGeometry(page, capture, ['review', 'confirmed', 'failed', 'partial-completion', 'uncertain'].includes(stage));
      });
    }
  }
  process.env.FXAEON_REVIEW_INTER_FONT ??= resolve(appRoot, 'e2e/harness/assets/inter-latin.woff2');
  for (const viewport of viewports) await collect(browser, viewport, `trade-approval-${viewport.id}`, async (page, capture) => {
    capture.provenance = 'Actual ActionReview orchestration · mocked planner, executor and wallet';
    capture.state = 'approval required then wallet signature';
    capture.note = 'Simulates an approval-required route locally. The harness wallet has no live provider or broadcast implementation.';
    capture.url = 'in-memory ActionReview harness';
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.evaluate(() => {
      const harness = (globalThis as typeof globalThis & { __actionReviewHarness: { approvalRequired: boolean; deferWalletResponse: boolean; displayPrices?: Record<string, number>; rerender: () => void } }).__actionReviewHarness;
      harness.approvalRequired = true; harness.deferWalletResponse = true;
      harness.displayPrices = { ETH: 2400, USDC: 1, fxUSD: 1 };
      harness.rerender();
    });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: /^Approve/ }).last();
    await expect(confirm).toBeEnabled();
    await label(page, 'APPROVAL REQUIRED · MOCKED ACTIONREVIEW');
    await snapshot(page, capture, 'review');
    await lifecycleGeometry(page, capture, true);
    await confirm.click();
    await expect(page.getByRole('region', { name: 'Transaction progress', exact: true })).toBeVisible();
    await label(page, 'APPROVAL SIGNATURE · MOCK WALLET WAITING');
    await snapshot(page, capture, 'signature');
  });
}

async function positionCaptures(browser: Browser): Promise<void> {
  const bundle = await buildPositionBrakeLab();
  for (const viewport of viewports) await collect(browser, viewport, `position-card-${viewport.id}`, async (page, capture) => {
    capture.provenance = 'Position brake harness · real position card/details, deterministic position and oracle';
    capture.state = 'funded simulated ETH long';
    capture.url = 'in-memory position card harness';
    capture.note = 'A component fixture, not the full Positions route or live discovery. List navigation/management flows remain covered by positions-screens.spec.ts.';
    await page.route('http://fxaeon-position.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!/^\/(token-icons|chain-icons|fonts)\/[\w.-]+$/.test(path)) return route.abort();
      await route.fulfill({ path: resolve(appRoot, 'public', `.${path}`), contentType: extname(path) === '.svg' ? 'image/svg+xml' : extname(path) === '.woff2' ? 'font/woff2' : 'image/png' });
    });
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><base href="http://fxaeon-position.test/"><div id="root"></div>');
    await page.evaluate(() => { (globalThis as typeof globalThis & { __brakeConfig: unknown }).__brakeConfig = { scenarios: ['long'], details: 'long', quotes: { ETH: 2400 } }; });
    await page.addStyleTag({ content: bundle.css });
    await page.addScriptTag({ content: bundle.script });
    await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
    await label(page, 'SIMULATED POSITION CARD · COMPONENT FIXTURE');
    await snapshot(page, capture);
  });
}

const html = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
async function report(): Promise<void> {
  const gaps = ['No real funds, wallet credentials, signing, authentication, RPC broadcast or live receipts.',
    'Built-app RPC fixtures model known balances/vault terms only; unsupported quote and protocol reads stay unavailable.',
    'Borrow/Earn lifecycle captures are independent rendered fixtures, not a completed built-app transaction journey.',
    'Trade approval uses the production ActionReview component with a mocked local executor; no network mutation.',
    'Positions captures show the actual card/details fixture; full management and discovery use existing separate browser suites.',
    'Chromium viewport resizing is not a real mobile OS keyboard or Safari/Firefox verification.',
    'Every app case requires a settled positive, verified zero, or unavailable balance/total. A timeout is reported as a failed capture.'];
  const identity = { sourceAtStart, sourceAtEnd: gitIdentity(), ...runtimeIdentity };
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ timestamp, section, plannedCases, identity, appUrl, labUrl, gaps, captures, failures, blockedRequests }, null, 2));
  const cards = captures.map(capture => `<article><h2>${html(capture.id)}</h2><p>${html(capture.provenance)} · ${capture.viewport.width}×${capture.viewport.height}</p><p>${html(capture.note)}</p>${capture.images.map(image => `<a href="${html(image.file)}"><img loading="lazy" src="${html(image.file)}" alt="${html(`${capture.id}, ${image.position}, simulation`)}"></a><p>${html(image.position)}</p>`).join('')}${capture.errors.map(error => `<p class="error">${html(error)}</p>`).join('')}</article>`).join('');
  await writeFile(resolve(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FxAeon simulated scenario review</title><style>body{margin:24px;background:#080808;color:#eee;font:14px/1.5 system-ui}a{color:#a5f3cf}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:24px}article{min-width:0;padding:16px;background:#151515;border-radius:16px}h2{font-size:16px}img{display:block;width:100%;height:auto}.error{color:#ffa8a8}</style><h1>Simulated scenario review · no transactions sent</h1><p>${html(timestamp)} · ${captures.length} cases · ${failures.length} failures · <a href="report.json">JSON report and geometry</a></p><ul>${gaps.map(gap => `<li>${html(gap)}</li>`).join('')}</ul>${failures.length ? `<h2>Capture failures</h2><ul>${failures.map(failure => `<li class="error">${html(failure.id)}: ${html(failure.error)}</li>`).join('')}</ul>` : ''}<main>${cards}</main></html>`);
}

async function main(): Promise<void> {
  await mkdir(output, { recursive: true });
  const require = createRequire(resolve(repoRoot, 'package.json'));
  const { configuredBrowserChannel } = require(resolve(repoRoot, 'scripts/e2e_browser_channel.cjs')) as { configuredBrowserChannel: () => string | undefined };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: configuredBrowserChannel(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    runtimeIdentity.browser = browser.version();
    await readBuildIdentity();
    if (included('app')) await appCaptures(browser);
    if (included('transactions')) await transactionCaptures(browser);
    if (included('positions')) await positionCaptures(browser);
  } catch (error) {
    failures.push({ id: 'capture-run', error: error instanceof Error ? error.message : String(error) });
  } finally {
    await browser?.close();
    if (captures.length !== plannedCases) failures.push({ id: 'matrix-coverage', error: `Expected ${plannedCases} cases; attempted ${captures.length}` });
    await report();
  }
  console.log(`Scenario catalog: ${resolve(output, 'index.html')} (${captures.length} cases, ${failures.length} failures)`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
