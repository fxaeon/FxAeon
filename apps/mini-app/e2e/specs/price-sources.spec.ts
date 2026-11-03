import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, expect } from '../fixtures/test';
import { FX_TOKENS } from '../../src/lib/fx/tokens';

test.use({ telegram: false, marketPrices: true });
const root = resolve(__dirname, '../..');
const appRequire = createRequire(resolve(root, 'package.json'));
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild') as { build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }> };
let script: string;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const built = await esbuild.build({
    stdin: { contents: `import { createUsdPriceFetcher } from './src/lib/prices';
      globalThis.runPriceTest = async () => {
        const fetchPrices = createUsdPriceFetcher({readProtocolPrices: async () => {throw Error('Archive/RPC unavailable');}});
        try { return (await fetchPrices()).prices; } catch { return null; }
      };`, loader: 'ts', resolveDir: root },
    absWorkingDir: root, tsconfig: resolve(root, 'tsconfig.json'), bundle: true, write: false,
    format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  });
  script = built.outputFiles[0].text;
});

for (const available of [true, false]) {
  test(`browser price sources ${available ? 'fill RPC gaps' : 'fail honestly'} without any DefiLlama request`, async ({ page, requests }) => {
    if (!available) {
      await page.route('https://api.aladdin.club/api/coingecko/price', route => route.abort('failed'));
      await page.route('https://api.coingecko.com/api/v3/simple/token_price/**', route => route.abort('failed'));
    }
    await page.route('http://prices.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Price source contract</title>' }));
    await page.goto('http://prices.test');
    await page.addScriptTag({ content: script });
    const prices = await page.evaluate(() => (window as unknown as { runPriceTest: () => Promise<Record<string, number> | null> }).runPriceTest());
    if (available) {
      expect(Object.keys(prices!).sort()).toEqual(Object.keys(FX_TOKENS).sort());
      expect(prices).toMatchObject({ ETH: 2400, WETH: 2400, WBTC: 104000, FXN: 26, fxUSD: 1 });
    } else expect(prices).toBeNull();
    const external = requests.all.filter(url => new URL(url).origin !== 'http://prices.test');
    expect(external.length).toBeGreaterThan(1);
    expect(external.every(url => ['api.aladdin.club', 'api.coingecko.com'].includes(new URL(url).hostname))).toBe(true);
    expect(requests.all.filter(url => /llama\.fi|defillama\.com/.test(url))).toEqual([]);
  });
}
