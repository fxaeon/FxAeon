import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { PlannedRoute } from '../src/lib/fx/types';

// Match the isolated JSX/CSS loader used by the other component render tests.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
const stylesPaths = new Set(['TradeOutcomePreview.module.css', 'review/ReviewFactValue.module.css', 'InfoHelp.module.css'].map(path => fileURLToPath(new URL(`../src/components/${path}`, import.meta.url)).toLowerCase()));
testRequire.extensions['.css'] = (loadedModule, filename) => {
  if (!stylesPaths.has(filename.toLowerCase())) {
    if (previousCssLoader) return previousCssLoader(loadedModule, filename);
    throw new Error(`Unexpected CSS import in trade outcome render test: ${filename}`);
  }
  const classNames = [...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  loadedModule.exports = Object.fromEntries([...new Set(classNames)].map((name) => [name, `test-${name}`]));
};
after(() => {
  if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
  else delete testRequire.extensions['.css'];
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

const WALLET = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';

function opened(market: 'ETH' | 'BTC', side: 'long' | 'short', details: PlannedRoute['details']): PlannedRoute {
  return {
    operation: 'increasePosition', walletAddress: WALLET, chainId: 1,
    transactions: [{ chainId: 1, from: WALLET, to: ROUTER, data: '0xef9e1aa700', value: 0n, kind: 'action', operation: 'increasePosition' }],
    policy: { walletAddress: WALLET, chainId: 1, reviewedAction: {
      kind: 'position-increase', poolAddress: positionPoolAddress(market, side), positionType: side, positionId: 0,
      inputTokenAddress: FX_TOKENS.ETH.address, inputAmount: 10n ** 18n, nativeInput: true,
      collateralTokenAddress: positionCollateralTokenAddress(market, side), debtTokenAddress: positionDebtTokenAddress(market, side),
    } },
    details,
  };
}

/** The text of rendered markup: a character scan that never emits "<" or ">", so no tag survives. */
function textOf(markup: string): string {
  let text = '';
  let inTag = false;
  for (const character of markup) {
    if (character === '<') inTag = true;
    else if (character === '>') inTag = false;
    else if (!inTag) text += character;
  }
  return text;
}

/** Rows as [label, visible text of the value], from rendered markup. */
function rows(html: string) {
  return [...html.matchAll(/<div class="test-row" data-outcome-fact="([^"]+)"><dt>[^]*?<\/dt><dd>(.*?)<\/dd><\/div>/g)]
    .map((match) => [match[1], textOf(match[2]).trim()]);
}

test('while the warm-up runs, the same rows hold their place with announced-off placeholders', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market: 'ETH', side: 'long', route: null }));
  assert.match(html, /^<div class="test-outcome" role="group" aria-label="Position preview" aria-busy="true" data-trade-outcome="pending">/);
  assert.deepEqual(rows(html).map(([label]) => label), ['Execution price', 'Liquidation price', 'f(x) fee']);
  for (const label of ['Loading execution price', 'Loading liquidation price', 'Loading f(x) fee']) {
    assert.ok(html.includes(`role="status" aria-live="off" aria-label="${label}"`));
  }
  // Execution price has no external USD valuation line.
  assert.doesNotMatch(html, /Loading USD value/);
});

test('a settled route shows compact reviewed estimates while retaining exact quote data', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const route = opened('ETH', 'long', {
    colls: '1500000000000000000', debts: '1010218412345678901234', executionPrice: '2500.123456789',
    protocolFeeQuote: { poolAddress: positionPoolAddress('ETH', 'long'), routerAddress: ROUTER, ratios: ['3000000', '0', '0', '0'] },
  });
  const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market: 'ETH', side: 'long', route }));
  assert.match(html, /data-trade-outcome="ready"/);
  assert.doesNotMatch(html, /aria-busy/);
  // The SDK execution price already divides out the wstETH rate.
  assert.deepEqual(rows(html), [
    ['Execution price', '≈ 2,500.12 fxUSD / stETH'],
    ['Liquidation price', ''],
    ['f(x) fee', '0.3%'],
  ]);
  assert.match(html, /≈ 2,500\.12 fxUSD \/ stETH/);
  assert.doesNotMatch(html, /data-review-value|Show full|2500\.123456789 fxUSD/);
  assert.equal(route.details?.executionPrice, '2500.123456789');
  assert.doesNotMatch(html, /Estimated collateral|Estimated debt|Loading USD value/);
  // A separate collateral accounting rate must never convert that price again.
  const converted = renderToStaticMarkup(React.createElement(TradeOutcomePreview, {
    market: 'ETH', side: 'long', route: { ...route, details: { ...route.details, stEthPerWstEth: '1200000000000000000' } },
  }));
  assert.deepEqual(rows(converted)[0], ['Execution price', '≈ 2,500.12 fxUSD / stETH']);
});

test('a short previews its quoted execution price and leaves an unreadable fee value blank', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, {
    market: 'BTC', side: 'short', route: opened('BTC', 'short', { colls: '1234500000000000000000', debts: '123456780000000000', executionPrice: '65000.25' }),
  }));
  assert.deepEqual(rows(html), [
    ['Execution price', '≈ 65,000.25 fxUSD / WBTC'],
    ['Liquidation price', ''],
    ['f(x) fee', ''],
  ]);
});

test('absent or invalid execution prices remain blank without deriving a price from collateral or debt', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  for (const executionPrice of [undefined, '', '0', '-2500', 'NaN', 'Infinity', '1e18']) {
    const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, {
      market: 'ETH', side: 'long', route: opened('ETH', 'long', { colls: '1500000000000000000', debts: '1000000000000000000000', executionPrice }),
    }));
    assert.deepEqual(rows(html)[0], ['Execution price', '']);
    assert.match(html, /aria-label="Execution price unavailable"/);
    assert.doesNotMatch(html, /Loading execution price|Estimated collateral/);
  }
});

test('fresh pool liquidation quotes render the native USD price for all four market and side combinations', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  for (const [market, side, expected] of [
    ['ETH', 'long', '≈ $500.00 / stETH'], ['BTC', 'long', '≈ $625.00 / WBTC'],
    ['ETH', 'short', '≈ $2,560.00 / stETH'], ['BTC', 'short', '≈ $3,200.00 / WBTC'],
  ] as const) {
    const route = opened(market, side, {
      colls: side === 'long' ? '2000000000000000000' : '1000000000000000000000',
      debts: side === 'long' ? '1000000000000000000000' : '250000000000000000',
      stEthPerWstEth: market === 'ETH' ? '1250000000000000000' : undefined,
      liquidationQuote: { poolAddress: positionPoolAddress(market, side), liquidateRatio: '800000000000000000', readAt: Date.now(),
        ...(market === 'ETH' ? { stEthPerWstEth: '1250000000000000000' } : {}) },
    });
    const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market, side, route }));
    assert.deepEqual(rows(html)[1], ['Liquidation price', expected.replace('.00', '')]);
    assert.ok(html.includes(expected.replace('.00', '')), 'the compact USD price remains visible');
    assert.doesNotMatch(html, /Show full liquidation price value|data-review-value/);
    assert.doesNotMatch(html, /Estimated collateral|Estimated debt/);
  }
});

test('expired or missing thresholds refresh, while malformed or mismatched fresh thresholds stay unavailable', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const quote = { poolAddress: positionPoolAddress('BTC', 'long'), liquidateRatio: '800000000000000000', readAt: Date.now() };
  for (const liquidationQuote of [undefined, { ...quote, readAt: Date.now() - 30_001 }, { ...quote, liquidateRatio: '0' }, { ...quote, poolAddress: positionPoolAddress('BTC', 'short') }]) {
    const route = opened('BTC', 'long', { colls: '2000000000000000000', debts: '1000000000000000000000', liquidationQuote });
    const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market: 'BTC', side: 'long', route }));
    assert.deepEqual(rows(html)[1], ['Liquidation price', '']);
  }
});

test('a route the review could not describe shows nothing at all', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  assert.equal(renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market: 'ETH', side: 'long', route: opened('ETH', 'long', {}) })), '');
});

test('facts-only public outcomes render the same figures without a route or another risk read', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const { positionOutcomeFacts } = await import('../src/lib/fx/reviewFormatting');
  const planned = opened('BTC', 'long', {colls:'2000000000000000000', debts:'1000000000000000000000', executionPrice:'2000', liquidationQuote:{poolAddress:positionPoolAddress('BTC','long'), liquidateRatio:'800000000000000000', readAt:Date.now()}});
  const facts = positionOutcomeFacts(planned)!;
  const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview,{market:'BTC',side:'long',route:null,facts}));
  assert.equal(rows(html)[0][0], 'Execution price');
  assert.match(html,/data-trade-outcome="ready"/);
  assert.doesNotMatch(html,/Loading execution|Loading liquidation|Connect wallet|preview only/i);
});
