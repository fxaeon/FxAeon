import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UiPosition } from '../src/app/trade/fxUi';
import type { UsdPriceSnapshot } from '../src/lib/prices';

const require = createRequire(import.meta.url);
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (module, path) => {
  const names = [...readFileSync(path, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  module.exports = Object.fromEntries(names.map(name => [name, `test-${name}`]));
};

// Deterministic display-provider snapshots, not browser/provider or chain evidence.
let snapshot: UsdPriceSnapshot;
const pricesPath = require.resolve('../src/components/PriceProvider');
const actualPrices = require(pricesPath);
require.cache[pricesPath]!.exports = {
  ...actualPrices,
  useUsdPrices: () => ({ ...snapshot, refreshing: false, refresh: async () => undefined }),
  useLiveMarketQuote: () => ({ quote: null, isFresh: false }),
};
const brakePath = require.resolve('../src/components/PositionBrakeContext');
const actualBrake = require(brakePath);
require.cache[brakePath]!.exports = { ...actualBrake, usePositionBrake: () => ({ status: 'unavailable' }) };
const overlayPath = require.resolve('../src/lib/useOverlayDialog');
const actualOverlay = require(overlayPath);
require.cache[overlayPath]!.exports = { ...actualOverlay, useOverlayDialog: () => React.useRef(null) };
const domPath = require.resolve('react-dom');
const actualDom = require(domPath);
require.cache[domPath]!.exports = { ...actualDom, createPortal: (child: React.ReactNode) => child };
const previousDocument = globalThis.document;
Object.defineProperty(globalThis, 'document', { value: { body: {} }, configurable: true, writable: true });
const originalUseState = React.useState;
// Render an already-expanded Portfolio state without claiming an onToggle/browser test.
React.useState = ((initial: unknown) => initial === false ? [true, () => undefined] : originalUseState(initial)) as typeof React.useState;
const { ProtocolPositionCard, ProtocolPositionDetails, ProtocolPositionIdentity } = require('../src/components/ProtocolPositionCard') as typeof import('../src/components/ProtocolPositionCard');
const { PortfolioPositionRows } = require('../src/components/PortfolioPositionRows') as typeof import('../src/components/PortfolioPositionRows');
const { BorrowPositionCard, BorrowPositionManager } = require('../src/components/BorrowPositionCards') as typeof import('../src/components/BorrowPositionCards');
const { PositionTokenAmount } = require('../src/components/PositionPresentation') as typeof import('../src/components/PositionPresentation');

test.after(() => {
  if (previousCss) require.extensions['.css'] = previousCss;
  else delete require.extensions['.css'];
  require.cache[pricesPath]!.exports = actualPrices;
  require.cache[brakePath]!.exports = actualBrake;
  require.cache[domPath]!.exports = actualDom;
  require.cache[overlayPath]!.exports = actualOverlay;
  React.useState = originalUseState;
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
  if (previousDocument) globalThis.document = previousDocument;
  else Reflect.deleteProperty(globalThis, 'document');
});

const symbols = { ETH: { long: ['ETH', 'fxUSD'], short: ['fxUSD', 'wstETH'] }, BTC: { long: ['WBTC', 'fxUSD'], short: ['fxUSD', 'WBTC'] } } as const;
function position(market: 'ETH' | 'BTC', side: 'long' | 'short', rawColls = 10n ** 12n, rawDebts = 10n ** 15n, metric = 0): UiPosition {
  const [rawCollsToken, rawDebtsToken] = symbols[market][side];
  return { market, side, info: { positionId: 42, rawColls, rawDebts, rawCollsToken, rawDebtsToken, rawCollsDecimals: 18, rawDebtsDecimals: 18, currentLeverage: metric, lsdLeverage: metric } };
}
const render = (component: React.ReactNode) => renderToStaticMarkup(component);
const visibleText = (html: string) => html.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
function freshPrices() { snapshot = { prices: { ETH: 2400, stETH: 2400, wstETH: 3000, WBTC: 100000, fxUSD: 1 }, status: 'ready', updatedAt: Date.now() }; }

for (const market of ['ETH', 'BTC'] as const) for (const side of ['long', 'short'] as const) {
  test(`${market} ${side}: sentinel and all boundaries render honestly in card, identity, overview, details and Portfolio`, () => {
    freshPrices();
    const threshold = market === 'ETH' ? 5n * 10n ** 14n : 5n * 10n ** 12n;
    for (const raw of [1n, 10n ** 12n, threshold - 1n, threshold, threshold + 1n, 10n ** 18n]) for (const metric of [0, -1, NaN, 2]) {
      const p = position(market, side, raw, 1n, metric);
      for (const component of [
        React.createElement(ProtocolPositionCard, { position: p }),
        React.createElement(ProtocolPositionCard, { position: p, overview: true }),
        React.createElement(ProtocolPositionIdentity, { position: p }),
        React.createElement(ProtocolPositionDetails, { position: p, compact: true }),
        React.createElement(PortfolioPositionRows, { positions: [p], failedGroups: [] }),
      ]) {
        const html = render(component);
        assert.doesNotMatch(html, /Loading|aria-busy="true"|>0×/);
        if (metric === 2) assert.match(html, /2×/);
        else {
          assert.match(visibleText(html), /Leverage unavailable/);
          assert.match(html, /current leverage metric cannot be provided for this position/);
        }
      }
    }
    const p = position(market, side);
    const details = render(React.createElement(ProtocolPositionDetails, { position: p, compact: true }));
    assert.match(visibleText(details), /0\.000001/);
    assert.match(visibleText(details), /0\.001/);
    assert.match(details, /test-factUnit/);
    const portfolio = render(React.createElement(PortfolioPositionRows, { positions: [p], failedGroups: [] }));
    const described = portfolio.match(/<summary[^>]*aria-describedby="([^"]+)"/)![1].split(' ');
    assert.ok(described.some(id => portfolio.includes(`<small id="${id}"><span data-position-leverage="unavailable">`)), 'focusable summary describes leverage explanation');
    assert.match(visibleText(portfolio), /0\.000001/);
    assert.match(visibleText(portfolio), /0\.001/);
    for (const [rawColls, rawDebts, label] of [[0n, 0n, 'No balance'], [1n, 0n, 'No debt']] as const) {
      const state = position(market, side, rawColls, rawDebts);
      for (const component of [
        React.createElement(ProtocolPositionCard, { position: state }),
        React.createElement(ProtocolPositionCard, { position: state, overview: true }),
        React.createElement(ProtocolPositionIdentity, { position: state }),
        React.createElement(ProtocolPositionDetails, { position: state, compact: true }),
        React.createElement(PortfolioPositionRows, { positions: [state], failedGroups: [] }),
      ]) assert.match(render(component), new RegExp(label));
    }
    const invalid = position(market, side, -1n, 1n);
    for (const component of [
      React.createElement(ProtocolPositionCard, { position: invalid }),
      React.createElement(ProtocolPositionCard, { position: invalid, overview: true }),
      React.createElement(ProtocolPositionIdentity, { position: invalid }),
      React.createElement(ProtocolPositionDetails, { position: invalid, compact: true }),
      React.createElement(PortfolioPositionRows, { positions: [invalid], failedGroups: [] }),
    ]) assert.match(render(component), /accounting is invalid/);
  });
}

test('Borrow renders exact small debt and rational LTV while amount values stay static', () => {
  freshPrices();
  const p = position('ETH', 'long');
  const card = render(React.createElement(BorrowPositionCard, { position: p, stale: false, onOpen: () => undefined }));
  assert.match(visibleText(card), /0\.001 fxUSD/);
  assert.match(visibleText(card), /0\.000001 stETH/);
  assert.match(visibleText(card), /≈ 41\.67%/);
  assert.match(card, /≈ &lt;\$0\.01/);
  assert.doesNotMatch(card, /<details|Loading/);
  const tiny = position('BTC', 'long', 1n, 1n);
  const compact = render(React.createElement(BorrowPositionCard, { position: tiny, stale: false, onOpen: () => undefined }));
  assert.match(visibleText(compact), /0\.000000000000000001 WBTC/);
  assert.match(visibleText(compact), /0\.000000000000000001 fxUSD/);
  assert.doesNotMatch(compact, /title="0\.000000000000000001 WBTC"/);
  assert.equal(tiny.info.rawColls, 1n);
  assert.equal(tiny.info.rawDebts, 1n);
  const manager = render(React.createElement(BorrowPositionManager, { position: tiny, stale: false, inputStage: true, locked: false, triggerRef: { current: null }, onClose: () => undefined, children: null }));
  const facts = manager.slice(manager.indexOf('<dl>'));
  assert.match(visibleText(facts), /Collateral 0\.000000000000000001 WBTC/);
  assert.match(visibleText(facts), /Outstanding debt 0\.000000000000000001 fxUSD/);
  assert.equal((manager.match(/<details/g) ?? []).length, 1);
});

test('stale/unavailable prices never acquire a subcent marker or an LTV from nonzero quantities', () => {
  freshPrices();
  snapshot.updatedAt = Date.now() - 24 * 60 * 60 * 1000;
  const p = position('ETH', 'long');
  const renderCard = (stale: boolean) => render(React.createElement(BorrowPositionCard, { position: p, stale, onOpen: () => undefined }));
  const old = renderCard(false);
  assert.match(old, /Loan-to-value unavailable/);
  assert.doesNotMatch(old, /41\.67%|&lt;\$0\.01/);
  freshPrices();
  assert.doesNotMatch(renderCard(true), /41\.67%|&lt;\$0\.01/);
  snapshot = { prices: {}, status: 'unavailable', updatedAt: null };
  assert.doesNotMatch(renderCard(false), /Loading|&lt;\$0\.01/);
});

test('negative subcent net value keeps its sign, while exact compact quantities use real accessible text', () => {
  freshPrices();
  const p = position('ETH', 'long', 1n, 10n ** 15n);
  const html = render(React.createElement(ProtocolPositionCard, { position: p }));
  assert.match(visibleText(html), /Negative &lt;\$0\.01/);
  const amount = render(React.createElement(PositionTokenAmount, { raw: 123456789n, decimals: 9, symbol: 'fxUSD', compact: true }));
  assert.match(amount, /aria-hidden="true">≈ 0\.12345678 fxUSD/);
  assert.match(amount, /class="sr-only">Exact amount: 0\.123456789 fxUSD/);
});

const { PositionCostBasisContext } = require('../src/components/PositionCostBasisContext') as typeof import('../src/components/PositionCostBasisContext');
type CostBasisStore = import('../src/components/PositionCostBasisContext').PositionCostBasisStore;
const E18 = 10n ** 18n;
/** An index record matching `p` with an entry of 2,000 per stETH, priced at a 2,200 mid. */
function costBasis(p: UiPosition, overrides: Partial<CostBasisStore['entries'] extends ReadonlyMap<string, infer Entry> ? Entry : never> = {}): CostBasisStore {
  const now = Date.now();
  return {
    entries: new Map([[`${p.market}:${p.side}:${p.info.positionId}`, {
      record: { history: { market: p.market, side: p.side, positionId: p.info.positionId, block: 1n, colls: p.info.rawColls, debts: p.info.rawDebts, targetLeverage: '3', isClosed: false, orders: [] }, entryWad: 2_000n * E18 },
      pending: false, failures: 0, behind: 0, readAt: now, ...overrides,
    }]]),
    prices: { ETH: { price: { priceWad: 2_200n * E18, rateWad: E18, readAt: now }, pending: false, failures: 0, readAt: now } },
    register: () => () => undefined,
  };
}
const withCostBasis = (store: CostBasisStore, component: React.ReactElement) => render(React.createElement(PositionCostBasisContext.Provider, { value: store }, component));
/** Swap the mocked brake hook for one render. */
function withBrake<T>(status: unknown, run: () => T): T {
  const mock = require.cache[brakePath]!.exports;
  const previous = mock.usePositionBrake;
  mock.usePositionBrake = () => status;
  try { return run(); } finally { mock.usePositionBrake = previous; }
}

test('a Positions row carries its estimated PnL as its own labelled line under the value', () => {
  freshPrices();
  const p = position('ETH', 'long', 2n * E18, 1_000n * E18, 2);
  const row = withCostBasis(costBasis(p), React.createElement(ProtocolPositionCard, { position: p, overview: true, onSelect: () => undefined }));
  // 2 stETH from 2,000 to 2,200: +$400, +10% × 3 target leverage. The value stays the value.
  assert.match(row, /<span class="test-overviewPnl" data-position-cost-basis="pnl" title="An estimate, not an amount you would receive[^"]*excludes exit costs[^"]*"><span class="test-overviewMetricLabel">Est\. PnL<\/span> <span class="test-overviewPnlFigure">≈\u00a0\+\$400\.00 \(\+30\.00%\)<\/span><\/span>/);
  assert.match(visibleText(row), /≈ \$3,800\.00 Est\. PnL/);
  // While the index is read the line holds its place; a failed read leaves it blank, never zero.
  assert.match(withCostBasis({ ...costBasis(p), entries: new Map() }, React.createElement(ProtocolPositionCard, { position: p, overview: true })), /data-position-cost-basis="pnl"[^>]*><span class="test-overviewMetricLabel">Est\. PnL<\/span> <span class="test-overviewPnlFigure"><span role="status" aria-label="Loading estimated PnL"/);
  const failed = withCostBasis(costBasis(p, { record: null, failures: 1 }), React.createElement(ProtocolPositionCard, { position: p, overview: true }));
  assert.match(failed, /aria-label="Estimated PnL unavailable"/);
  assert.doesNotMatch(failed, /\$400|\$0\.00 \(/);
  // Without the provider (outside wallet routes) the line says so too.
  assert.match(render(React.createElement(ProtocolPositionCard, { position: p, overview: true })), /aria-label="Estimated PnL unavailable"/);
});

test('without a live quote a Positions row names the pool’s own threshold prices', () => {
  freshPrices();
  const p = position('ETH', 'long', 2n * E18, 1_000n * E18, 2);
  const reading = { side: 'long', debtRatio: 66n * E18 / 100n, rebalanceRatio: 88n * E18 / 100n, liquidateRatio: 95n * E18 / 100n, priceAtRead: null, poolPrices: { rebalance: 569, liquidate: 527 } };
  const row = withBrake({ status: 'ready', reading, readAt: Date.now() }, () => render(React.createElement(ProtocolPositionCard, { position: p, overview: true })));
  assert.match(row, /data-position-price="rebalance">≈\u00a0\$569 \/ stETH</);
  assert.match(row, /data-position-price="liquidation">≈\u00a0\$527 \/ stETH</);
});

test('an open Portfolio row lists the entry price and estimated PnL with the risk estimates', () => {
  freshPrices();
  const p = position('ETH', 'long', 2n * E18, 1_000n * E18, 2);
  const html = withCostBasis(costBasis(p), React.createElement(PortfolioPositionRows, { positions: [p], failedGroups: [] }));
  const cell = (kind: string) => visibleText(html.match(new RegExp(`<dd data-position-cost-basis="${kind}">([\\s\\S]*?)</dd>`))![1]).trim();
  assert.equal(cell('entry'), '≈ $2,000.00 / stETH');
  assert.equal(cell('pnl'), '≈ +$400.00 (+30.00%) at ≈ $2,200.00 / stETH');
  // Both sit after the risk estimates, each with its assumptions behind an info control.
  assert.ok(html.indexOf('data-position-price="liquidation"') < html.indexOf('data-position-cost-basis="entry"'));
  assert.match(html, /aria-label="About Entry price"/);
  assert.match(html, /aria-label="About Est\. PnL"/);
  // A row kept from a failed refresh shows neither figure.
  const stale = withCostBasis(costBasis(p), React.createElement(PortfolioPositionRows, { positions: [p], failedGroups: [{ market: 'ETH', side: 'long', reason: new Error('offline') }] }));
  assert.match(stale, /aria-label="Entry price unavailable"/);
  assert.match(stale, /aria-label="Estimated PnL unavailable"/);
  assert.doesNotMatch(stale, /\$2,000\.00|\$400\.00/);
});

test('a Borrow card shows where rebalancing starts, as its Positions row does', () => {
  freshPrices();
  const p = position('ETH', 'long', 2n * E18, 1_000n * E18, 2);
  const card = (status: unknown, stale = false) => withBrake(status, () => render(React.createElement(BorrowPositionCard, { position: p, stale, onOpen: () => undefined })));
  const reading = { side: 'long', debtRatio: 66n * E18 / 100n, rebalanceRatio: 88n * E18 / 100n, liquidateRatio: 95n * E18 / 100n, priceAtRead: null, poolPrices: { rebalance: 569, liquidate: 527 } };
  assert.match(card({ status: 'ready', reading, readAt: Date.now() }), /<span>Est\. rebalance<\/span><strong data-position-price="rebalance">≈\u00a0\$569 \/ stETH<\/strong>/);
  // With the market quote at the read it is on that basis: 2,400 × 0.66 / 0.88 = 1,800.
  assert.match(card({ status: 'ready', reading: { ...reading, priceAtRead: 2_400 }, readAt: Date.now() }), /data-position-price="rebalance">≈\u00a0\$1,800</);
  assert.match(card({ status: 'ready', reading: { ...reading, debtRatio: 9n * E18 / 10n }, readAt: Date.now() }), /data-position-price="rebalance"><span class="test-reached">Reached<\/span>/);
  assert.match(card({ status: 'none' }), /data-position-price="rebalance">No debt</);
  assert.match(card({ status: 'loading' }), /data-position-price="rebalance"><span role="status" aria-label="Loading rebalance price" class="missing-value missing-value-sm"/);
  assert.match(card({ status: 'unavailable' }), /aria-label="Estimated rebalance price unavailable" class="missing-value missing-value-sm missing-value-unavailable/);
  // A card awaiting an update never shows a figure from the old read.
  assert.match(card({ status: 'ready', reading, readAt: Date.now() }, true), /aria-label="Estimated rebalance price unavailable" class="missing-value missing-value-sm missing-value-unavailable/);
});
