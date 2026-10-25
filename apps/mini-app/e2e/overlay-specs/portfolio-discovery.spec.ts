import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildPortfolioStatesLab, type PortfolioStatesLab } from '../harness/portfolio-states-build';

const publicRoot = resolve(__dirname, '../../public');
let lab: PortfolioStatesLab;
test.beforeAll(async () => { lab = await buildPortfolioStatesLab(); });

async function open(page: Page, { unavailable = false } = {}) {
  const html = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lab.css"></head><body><div id="root"></div><script>window.__portfolioStates=${JSON.stringify({ stage: 'disconnected', route: '/portfolio', theme: 'dark', publicData: unavailable ? 'unavailable' : 'ready' })};</script><script src="/lab.js"></script></body></html>`;
  await page.route('http://lab.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (pathname === '/lab.js') return route.fulfill({ contentType: 'text/javascript', body: lab.script });
    if (pathname === '/lab.css') return route.fulfill({ contentType: 'text/css', body: lab.css });
    const file = resolve(publicRoot, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(publicRoot) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: extname(file) === '.svg' ? 'image/svg+xml' : extname(file) === '.woff2' ? 'font/woff2' : 'image/png', body: readFileSync(file) });
  });
  await page.goto('http://lab.test/');
  await expect(page.getByRole('heading', { name: 'DeFi that moves with you.' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

for (const width of [320, 390, 1280]) {
  test(`disconnected discovery is useful and fits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await open(page);
    const products = page.getByRole('region', { name: 'Explore FxAeon' });
    const destinations = [['Trade', '/trade'], ['Earn', '/earn'], ['Borrow', '/borrow'], ['Move', '/move']] as const;
    for (const [name, href] of destinations) {
      const link = products.getByRole('link', { name: new RegExp(name) });
      await expect(link).toHaveAttribute('href', href);
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      for (const image of await link.locator('img').all()) {
        const imageBox = await image.boundingBox();
        expect(imageBox!.x).toBeGreaterThanOrEqual(box!.x + 8);
        expect(imageBox!.x + imageBox!.width).toBeLessThanOrEqual(box!.x + box!.width - 8);
      }
    }
    await expect(page.locator('[data-portfolio-value]')).toHaveCount(0);
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(1);
    await expect(main.getByRole('button', { name: 'Connect wallet', exact: true })).toBeInViewport();
    await expect(main.getByRole('link', { name: 'Explore Trade' })).toHaveAttribute('href', '/trade');
    expect(await page.locator('.app-content').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('opening.png'), animations: 'disabled' });
    const markets = page.getByRole('region', { name: 'Markets' });
    await expect(markets.getByRole('link', { name: 'Trade ETH', exact: true })).toHaveAttribute('href', '/trade?market=ETH');
    await expect(markets.getByRole('link', { name: 'Trade BTC', exact: true })).toHaveAttribute('href', '/trade?market=BTC');
    await expect(markets.getByText('$2,400.00')).toBeVisible();
    await expect(markets.getByText('$104,000.00')).toBeVisible();
    for (const market of await markets.getByRole('link').all()) {
      await expect(market).toHaveAccessibleDescription(/over 24 hours/);
      const bounds = await market.boundingBox();
      const contents = await market.locator('p').evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        return { left: box.left, right: box.right };
      });
      expect(contents.left).toBeGreaterThanOrEqual(bounds!.x + 8);
      expect(contents.right).toBeLessThanOrEqual(bounds!.x + bounds!.width - 8);
    }
    await markets.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('markets.png'), animations: 'disabled' });
  });
}

test('unavailable public data keeps all discovery routes usable without invented figures', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await open(page, { unavailable: true });
  const products = page.getByRole('region', { name: 'Explore FxAeon' });
  await expect(products.getByRole('link')).toHaveCount(4);
  const markets = page.getByRole('region', { name: 'Markets' });
  await expect(markets.getByRole('status', { name: 'Market price unavailable' })).toHaveCount(2);
  await expect(markets.getByText('Chart unavailable')).toHaveCount(2);
  await expect(markets.getByRole('link')).toHaveCount(2);
  await expect(page.locator('[data-portfolio-value]')).toHaveCount(0);
  expect(await page.locator('.app-content').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
});

test('disconnected discovery omits APY and network footers without requesting APY data', async ({ page }) => {
  const apyRequests: string[] = [];
  await page.route('https://api.aladdin.club/api1/concentrator_aToken_tvl_apy', route => {
    apyRequests.push(route.request().url());
    return route.fulfill({ status: 503, body: '' });
  });
  await open(page);
  const products = page.getByRole('region', { name: 'Explore FxAeon' });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(products.getByRole('link')).toHaveCount(4);
  await expect(products.getByText('Ethereum', { exact: true })).toHaveCount(0);
  await expect(products.getByText('Ethereum ↔ Base', { exact: true })).toHaveCount(0);
  await expect(page.getByText('f(x) Protocol, one interface', { exact: true })).toHaveCount(0);
  await expect(products.getByText('Four tools · one workspace', { exact: true })).toHaveCount(0);
  await expect(products).not.toContainText(/\bAPY\b|\d+\.\d+%/);
  expect(apyRequests).toEqual([]);
});

test('discovery remains readable with enlarged text and keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await open(page);
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('.app-content h2, .app-content h3, .app-content p, .app-content a, .app-content button, .app-content span'));
    const sizes = elements.map(node => parseFloat(getComputedStyle(node).fontSize));
    elements.forEach((node, index) => { node.style.fontSize = `${sizes[index] * 2}px`; });
  });
  const main = page.getByRole('main');
  const connect = main.getByRole('button', { name: 'Connect wallet', exact: true });
  await connect.focus();
  await page.keyboard.press('Tab');
  await expect(main.getByRole('link', { name: 'Explore Trade' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Explore FxAeon' }).getByRole('link', { name: /Trade/ })).toBeFocused();
  expect(await page.locator('.app-content').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('region', { name: 'Explore FxAeon' }).getByRole('link')).toHaveCount(4);
  for (const product of await page.getByRole('region', { name: 'Explore FxAeon' }).getByRole('link').all()) {
    const box = await product.boundingBox();
    const arrow = await product.locator('svg').first().boundingBox();
    expect(arrow!.x + arrow!.width).toBeLessThanOrEqual(box!.x + box!.width - 8);
  }
});
