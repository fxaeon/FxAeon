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

test('Borrow renders exact small debt, rational LTV and visible exact amounts behind its manager disclosure', () => {
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
  assert.match(compact, /<span aria-hidden="true">&lt;0\.00000001/);
  assert.match(compact, /<span class="sr-only">Exact amount: 0\.000000000000000001 WBTC/);
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
