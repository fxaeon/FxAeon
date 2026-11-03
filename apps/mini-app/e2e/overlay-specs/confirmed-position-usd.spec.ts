import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { fixture } from '../harness/confirmed-position-result-entry';

const app = resolve(__dirname, '../..');
const appRequire = createRequire(resolve(app, 'package.json'));
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild');
let script = '', css = '';
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const mocks: Record<string, string> = {
    '@/components/PriceProvider': `export const useUsdPrices=()=>window.confirmedFixture.prices;`,
    '@/components/WalletProfile': `export default ()=>null;`,
    '@/components/NetworkSelector': `export default ()=>null;`,
    '@/components/DesktopSidebar': `export const DesktopSidebar=()=>null;`,
    '@/components/MobileMoreMenu': `export default ()=>null;`,
    '@/lib/wallet': `export const usePrivyWallet=()=>({ready:true,authenticated:false});export const useWalletReadyTimeout=()=>false;`,
    '@/lib/telegram': `export const haptic=()=>{};export const openExternalLink=()=>false;`,
    'next/navigation': `export const usePathname=()=>'/trade';export const useRouter=()=>({push:()=>{}});`,
    'next/link': `export default ({children,...props})=><a {...props}>{children}</a>;`,
  };
  const bundle = await esbuild.build({ entryPoints: [resolve(app, 'e2e/harness/confirmed-position-result-entry.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', absWorkingDir: app,
    outdir: resolve(app, 'test-results/confirmed-position'), loader: { '.module.css': 'local-css' },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'result-fixture', setup(build: any) {
      build.onResolve({ filter: /^(?:@\/|next\/)/ }, ({ path }: { path: string }) => mocks[path] ? { path, namespace: 'fixture' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }: { path: string }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
    } }],
  });
  script = bundle.outputFiles.find((file: { path: string }) => file.path.endsWith('.js')).text;
  const source = (await Promise.all(['globals.css', 'product-shell.css'].map(file => readFile(resolve(app, 'src/app', file), 'utf8')))).join('\n');
  const config = appRequire(resolve(app, 'tailwind.config.js'));
  config.content = [resolve(app, 'src/**/*.{ts,tsx}')];
  const globalCss = await appRequire('postcss')([appRequire('tailwindcss')(config), appRequire('autoprefixer')]).process(source, { from: resolve(app, 'src/app/globals.css') });
  css = `${globalCss.css}\n${bundle.outputFiles.find((file: { path: string }) => file.path.endsWith('.css')).text}`;
});

async function mount(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html', body: '<html data-theme="dark" data-product-ui="v2"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto(`http://result.test/?${query}`);
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await expect(page.getByRole('button', { name: 'View position', exact: true })).toBeVisible();
  return errors;
}
const readback = (page: Page) => page.getByRole('region', { name: 'Latest position read' });
const row = (page: Page, label: string) => readback(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
const fixtureValue = (page: Page) => page.evaluate(() => JSON.stringify((window as unknown as { confirmedFixture: typeof fixture }).confirmedFixture.readback));

for (const product of ['trade', 'borrow']) test(`${product} readback uses fresh asset quotes and the shared unit toggle without changing evidence`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  const errors = await mount(page, `product=${product}&unit=usd`);
  const before = await fixtureValue(page);
  const heroAmount = page.locator('[data-amount-provenance="receipt"] [data-review-amount]');
  await expect(heroAmount).toContainText('≈ $101.00');
  await expect(row(page, 'Collateral').locator('[data-amount-unit="usd"]')).toHaveText('≈ $716.96');
  await expect(row(page, 'Debt').locator('[data-amount-unit="usd"]')).toHaveText('≈ $699.26');
  await expect(row(page, 'Leverage')).toHaveText('2×');
  await expect(row(page, 'Leverage').locator('button')).toHaveCount(0);
  await row(page, 'Debt').getByRole('button').click();
  await expect(row(page, 'Collateral').locator('[data-amount-unit="token"]')).toContainText('0.3585 stETH');
  await expect(row(page, 'Debt').locator('[data-amount-unit="token"]')).toContainText('720.89 fxUSD');
  await expect(heroAmount).toContainText('100 USDC');
  await row(page, 'Collateral').getByRole('button').click();
  await expect(row(page, 'Debt').locator('[data-amount-unit="usd"]')).toHaveText('≈ $699.26');
  await expect(heroAmount).toContainText('≈ $101.00');
  expect(await fixtureValue(page)).toBe(before);
  expect(errors).toEqual([]);
});

for (const prices of ['stale', 'missing', 'partial']) test(`${prices} readback quotes fall back per asset without assuming fxUSD is a dollar`, async ({ page }) => {
  await mount(page, `unit=usd&prices=${prices}`);
  await expect(row(page, 'Debt')).toContainText('720.89 fxUSD');
  await expect(row(page, 'Debt').locator('button,[data-amount-unit="usd"]')).toHaveCount(0);
  if (prices === 'partial') await expect(row(page, 'Collateral').locator('[data-amount-unit="usd"]')).toHaveText('≈ $716.96');
  else await expect(row(page, 'Collateral').locator('button,[data-amount-unit="usd"]')).toHaveCount(0);
});

test('quiet provider expiry drops USD, while unavailable facts and mismatched readbacks remain unconverted', async ({ page }) => {
  await page.clock.install();
  await mount(page, 'unit=usd');
  const before = await fixtureValue(page);
  const maxAge = await page.evaluate(() => (window as unknown as { confirmedFixture: typeof fixture }).confirmedFixture.maxAge);
  await page.clock.fastForward(maxAge + 1);
  await expect(row(page, 'Debt').locator('button,[data-amount-unit="usd"]')).toHaveCount(0);
  expect(await fixtureValue(page)).toBe(before);
  await mount(page, 'unit=usd&unavailable=1');
  await expect(row(page, 'Collateral').getByLabel('Collateral unavailable')).toBeVisible();
  await expect(row(page, 'Collateral').locator('button')).toHaveCount(0);
  await mount(page, 'unit=usd&mismatch=1');
  await expect(readback(page)).toHaveCount(0);
  await expect(page.getByText('Position values unavailable')).toBeVisible();
});

for (const width of [320, 390]) for (const amounts of ['normal', 'long', 'tiny']) test(`${width}×568 ${amounts} readback keeps fee and action visible in either unit`, async ({ page }) => {
  await page.setViewportSize({ width, height: 568 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await mount(page, `unit=usd&simulated=1&${amounts}=1`);
  for (let toggle = 0; toggle < 2; toggle++) {
    const action = page.getByRole('button', { name: 'View position', exact: true });
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(page.getByText('Network fee', { exact: true })).toBeInViewport({ ratio: 1 });
    const overflow = await readback(page).evaluate(element => [...element.querySelectorAll('dd,button')].map(node => {
      const box = node.getBoundingClientRect();
      return { text: node.textContent, overflow: node.scrollWidth > node.clientWidth + 1 || box.left < 0 || box.right > innerWidth + 1 };
    }).filter(item => item.overflow));
    expect(overflow).toEqual([]);
    await expect(readback(page)).toContainText('Simulated position #42');
    await row(page, 'Debt').getByRole('button').click();
  }
  expect(errors).toEqual([]);
});
