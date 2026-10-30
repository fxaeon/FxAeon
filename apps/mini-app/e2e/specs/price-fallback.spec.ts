import { test, expect, assertNoBackendRequests } from '../fixtures/test';
import { USD_PRICE_MAX_AGE_MS } from '../../src/lib/prices';

const FXUSD_ADDRESS = '0x085780639cc2cacd35e474e71f4d000e2405d8f6';

test.describe('independent USD price availability', () => {
  test.use({ telegram: false, marketPrices: true });

  test('a disconnected narrow picker never presents a unit quote as owned value', async ({ page, requests }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Input asset', exact: true }).click();
    const list = page.getByRole('listbox', { name: 'Input asset options' });
    const eth = list.getByRole('option', { name: /^ETH\b.*\bselected$/i });
    await expect(eth).toHaveAttribute('aria-selected', 'true');
    await expect(eth).not.toHaveAttribute('aria-describedby');
    await expect(eth.getByText('$2,400.00', { exact: true })).toHaveCount(0);
    await expect(eth.getByText('≈ $0.00', { exact: true })).toHaveCount(0);
    for (const row of await list.getByRole('option').all()) {
      expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Input asset', exact: true })).toBeFocused();
    assertNoBackendRequests(requests);
  });

  for (const available of [true, false]) {
    test(`a missing fxUSD price ${available ? 'does not leak a unit quote into inputs' : 'does not erase ETH and BTC'}`, async ({ page, requests }) => {
      // With f(x)'s price service down too, DefiLlama and then CoinGecko price fxUSD.
      await page.unroute('https://api.aladdin.club/api/coingecko/price');
      await page.route('https://api.aladdin.club/api/coingecko/price', route => route.abort('blockedbyclient'));
      await page.unroute('https://coins.llama.fi/**');
      await page.route('https://coins.llama.fi/**', async route => {
        const ids = decodeURIComponent(new URL(route.request().url()).pathname.split('/prices/current/')[1] ?? '').split(',');
        const now = Math.floor(Date.now() / 1000);
        const coins = Object.fromEntries(ids.map(id => [id, {
          price: id.includes('c02aaa39') ? 2400 : id.includes('2260fac5') ? 104000 : 1,
          timestamp: id.endsWith(FXUSD_ADDRESS) ? now - (USD_PRICE_MAX_AGE_MS / 1_000 + 1) : now,
          confidence: 0.99,
        }]));
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ coins }) });
      });
      let fallbackCalls = 0;
      await page.route('https://api.coingecko.com/api/v3/simple/token_price/**', async route => {
        fallbackCalls += 1;
        const url = new URL(route.request().url());
        expect(url.searchParams.get('contract_addresses')).toBe(FXUSD_ADDRESS);
        expect(url.searchParams.get('include_last_updated_at')).toBe('true');
        const payload = available ? { [FXUSD_ADDRESS]: { usd: 0.998, last_updated_at: Math.floor(Date.now() / 1000) } } : {};
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
      });
      await page.goto('/trade', { waitUntil: 'domcontentloaded' });
      const ethMarket = page.getByRole('region', { name: 'ETH market chart' });
      await expect(ethMarket.getByText('$2,400.00', { exact: true })).toBeVisible();
      await ethMarket.getByRole('radio', { name: 'BTC', exact: true }).click();
      const btcMarket = page.getByRole('region', { name: 'BTC market chart' });
      await expect(btcMarket.getByText('$104,000.00', { exact: true })).toBeVisible();
      await btcMarket.getByRole('radio', { name: 'ETH', exact: true }).click();
      await page.getByRole('button', { name: 'Input asset', exact: true }).click();
      const fxUsd = page.getByRole('listbox', { name: 'Input asset options' }).getByRole('option', { name: /^fxUSD/ });
      // Trade deliberately keeps picker rows focused on balance state; the
      // authoritative display prices remain the ETH/BTC market charts above.
      // A fallback quote must never be presented as an owned balance value.
      await expect(fxUsd).not.toContainText('$0.998');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('region', { name: 'Market prices' })).toHaveCount(0);
      expect(fallbackCalls).toBe(1);
      assertNoBackendRequests(requests);
    });
  }
});
