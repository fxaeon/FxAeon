import { test, expect, assertNoBackendRequests } from '../fixtures/test';
import { FX_SAVE_HISTORY_ENDPOINT, FX_SAVE_HISTORY_SOURCE } from '../../src/lib/fxSaveHistory';

test.use({ telegram: false });

const response = () => ({ status: 'success', data: Array.from({ length: 90 }, (_, index) => ({
  timestamp: new Date(Date.now() - (89 - index) * 86_400_000).toISOString(), apy: 6 + index / 100,
})) });

test('daily APY history supports ranges, keyboard exploration and a truthful source', async ({ page, requests }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(FX_SAVE_HISTORY_ENDPOINT, route => route.fulfill({ json: response() }));
  await page.goto('/earn');
  const history = page.getByRole('region', { name: 'fxSAVE yield history' });
  const chart = history.getByRole('slider', { name: 'Explore daily fxSAVE APY' });
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('aria-valuemax', '29');
  await history.getByRole('button', { name: '90D', exact: true }).click();
  await expect(chart).toHaveAttribute('aria-valuemax', '89');
  await chart.focus();
  await chart.press('Home');
  await expect(chart).toHaveAttribute('aria-valuetext', /6\.00% APY/);
  await chart.press('ArrowRight');
  await expect(chart).toHaveAttribute('aria-valuetext', /6\.01% APY/);
  await chart.press('End');
  await expect(chart).toHaveAttribute('aria-valuetext', /6\.89% APY/);
  await expect(history.getByRole('link', { name: /DefiLlama/ })).toHaveAttribute('href', FX_SAVE_HISTORY_SOURCE);
  await history.getByRole('button', { name: 'About Yield history', exact: true }).click();
  await expect(page.getByText(/not a realized return/)).toBeVisible();
  assertNoBackendRequests(requests);
});

test('failed history stays unavailable and retry recovers without blocking the form', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let failed = true;
  await page.route(FX_SAVE_HISTORY_ENDPOINT, route => failed ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ json: response() }));
  await page.goto('/earn');
  const history = page.getByRole('region', { name: 'fxSAVE yield history' });
  await expect(history.getByText('Yield history unavailable')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true })).toBeVisible();
  failed = false;
  await history.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(history.getByRole('slider')).toBeVisible();
});

test('phone layout keeps the action before history and fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route(FX_SAVE_HISTORY_ENDPOINT, route => route.fulfill({ json: response() }));
  await page.goto('/earn');
  const history = page.getByRole('region', { name: 'fxSAVE yield history' });
  const amount = page.getByRole('textbox', { name: 'Amount in fxUSD', exact: true });
  expect(await history.evaluate((node) => node.getBoundingClientRect().top)).toBeGreaterThan(await amount.evaluate((node) => node.getBoundingClientRect().bottom));
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByRole('slider')).toBeVisible();
  const bounds = await history.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  const chart = history.getByRole('slider');
  const chartBounds = (await chart.boundingBox())!;
  await page.touchscreen.tap(chartBounds.x + 12, chartBounds.y + 60);
  await expect(chart).toHaveAttribute('aria-valuenow', /^[01]$/);
  await expect(history.getByText('Average APY', { exact: true })).toHaveCount(0);
  const dimensions = await chart.evaluate(node => ({ width: node.clientWidth, viewBox: node.getAttribute('viewBox') }));
  expect(dimensions.viewBox).toBe(`0 0 ${dimensions.width} 148`);
});

test('a mounted chart expires when its source reaches the freshness boundary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install();
  const payload = response();
  payload.data = payload.data.map(point => ({ ...point, timestamp: new Date(Date.parse(point.timestamp) - 3 * 86_400_000 + 60_000).toISOString() }));
  await page.route(FX_SAVE_HISTORY_ENDPOINT, route => route.fulfill({ json: payload }));
  await page.goto('/earn');
  const history = page.getByRole('region', { name: 'fxSAVE yield history' });
  await expect(history.getByRole('slider')).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(history.getByText('Yield history unavailable')).toBeVisible();
  await expect(history.getByRole('slider')).toHaveCount(0);
});
