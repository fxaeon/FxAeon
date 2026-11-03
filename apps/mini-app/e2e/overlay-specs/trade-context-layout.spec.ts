import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const app = resolve(__dirname, '../..');
const req = createRequire(resolve(app, 'package.json'));
const esbuild = createRequire(req.resolve('tsx/package.json'))('esbuild');
const postcss = req('postcss');
const tailwind = req('tailwindcss');
const autoprefixer = req('autoprefixer');
const mocks: Record<string, string> = {
  'next/link': `export default ({href,children,...props})=><a href={href} {...props}>{children}</a>;`,
  '@/components/PriceProvider': `export const useLiveMarketQuote=()=>({isFresh:true,status:'ready',quote:{price:2400}}); export const useUsdPrices=()=>({status:'ready',prices:{ETH:2400,fxUSD:1},updatedAt:Date.now()});`,
  '@/lib/fx/useTradeFundingRate': `export const useTradeFundingRate=()=>({rate:null,status:'unavailable'});`,
  '@/lib/fx/usePoolCapacity': `export const usePoolCapacity=()=>({value:null,status:'unavailable'});`,
  '@/lib/fx/useOracleObservation': `export const useOracleObservation=()=>({value:null,status:'unavailable'});`,
  '@/lib/fx/useOracleMarketDifference': `export const useOracleMarketDifference=()=>null;`,
  '@/components/TokenIcon': `export const ChainIcon=()=>null;`,
};
let bundle: { script: string; css: string };
test.beforeAll(async () => {
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TradeContext}from './src/components/TradeContext';createRoot(document.getElementById('root')).render(<TradeContext market="ETH" side="long" leverage={2} openPositions={0} positionsStatus={globalThis.__tradeDisconnected?'disconnected':'ready'}/>);`, loader: 'tsx', resolveDir: app },
    bundle: true, write: false, outdir: 'trade-context-fixture', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', loader: { '.module.css': 'local-css' },
    plugins: [{ name: 'trade-context-fixtures', setup(build: any) {
      build.onResolve({ filter: /^\.\/(PriceProvider|TokenIcon)$/ }, ({ path }: { path: string }) => ({ path: `@/components/${path.slice(2)}`, namespace: 'fixture' }));
      build.onResolve({ filter: /^(@\/|next\/)/ }, ({ path }: { path: string }) => {
        if (mocks[path]) return { path, namespace: 'fixture' };
        const base = resolve(app, 'src', path.slice(2));
        return { path: [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(file => existsSync(file) && statSync(file).isFile()) ?? base };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }: { path: string }) => ({ contents: mocks[path], loader: 'tsx', resolveDir: app }));
    } }],
  });
  const globals = await postcss([tailwind({ config: resolve(app, 'tailwind.config.js') }), autoprefixer()]).process(readFileSync(resolve(app, 'src/app/globals.css'), 'utf8'), { from: resolve(app, 'src/app/globals.css') });
  const font = readFileSync(resolve(app, 'e2e/harness/assets/inter-latin.woff2')).toString('base64');
  bundle = { script: result.outputFiles.find((file: { path: string }) => file.path.endsWith('.js')).text,
    css: `${globals.css}\n${result.outputFiles.find((file: { path: string }) => file.path.endsWith('.css')).text}\n@font-face{font-family:FixtureInter;src:url(data:font/woff2;base64,${font});font-weight:100 900}:root{--font-sans:FixtureInter}body{padding:16px;background:var(--bg);color:var(--text);font-family:FixtureInter,sans-serif}#root{max-width:1000px;margin:auto}` };
});

for (const width of [320, 390, 1280]) test(`Trade supporting facts and scenario remain usable at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent('<html data-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  const scenario = page.getByRole('region', { name: 'What if ETH moves?' });
  const conditions = page.getByRole('region', { name: 'Protocol conditions' });
  const exposure = page.getByRole('region', { name: 'Your existing exposure' });
  await expect(scenario).toContainText('Sensitivity is not projected PnL');
  await expect(conditions).toBeVisible();
  await expect(exposure).toContainText('0 open ETH positions');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const geometry = await exposure.evaluate(element => { const box=element.getBoundingClientRect(); const parent=element.parentElement!.getBoundingClientRect(); return { width:box.width, parent:parent.width, background:getComputedStyle(element).backgroundColor }; });
  expect(geometry.background).toBe('rgba(0, 0, 0, 0)');
  if (width >= 960) expect(Math.abs(geometry.width - geometry.parent)).toBeLessThanOrEqual(1);
  const slider = scenario.getByRole('slider', { name: 'Market change' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('-9');
  await page.screenshot({ path: info.outputPath(`trade-context-${width}.png`), fullPage: true, animations: 'disabled' });
});

test('supporting facts do not depend on the exposure section being present', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.setContent('<html data-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: bundle.css });
  await page.evaluate(() => { (globalThis as typeof globalThis & { __tradeDisconnected: boolean }).__tradeDisconnected = true; });
  await page.addScriptTag({ content: bundle.script });
  const facts = page.getByRole('region', { name: 'Protocol conditions' });
  await expect(facts).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your existing exposure' })).toHaveCount(0);
  await expect(facts).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
