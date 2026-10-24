import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { USD_PRICE_MAX_AGE_MS, type UsdPriceSnapshot } from '../src/lib/prices';
import { orderCompactReviewFacts } from '../src/components/review/reviewHierarchy';
import type { PositionOutcomeFacts } from '../src/lib/fx/reviewFormatting';
const require = createRequire(import.meta.url);
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (module, path) => {
  const names = [...readFileSync(path, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  module.exports = Object.fromEntries(names.map(name => [name, name]));
};
let snapshot: UsdPriceSnapshot;
const provider = require.resolve('../src/components/PriceProvider');
const actualProvider = require(provider);
require.cache[provider]!.exports = { ...actualProvider, useUsdPrices: () => snapshot };
const { FeeAmount, CollateralAmount } = require('../src/components/review/AmountUsd') as typeof import('../src/components/review/AmountUsd');
const { ProtocolFeeAmount, protocolFeeUsdValue } = require('../src/components/review/ProtocolFeeAmount') as typeof import('../src/components/review/ProtocolFeeAmount');
after(() => {
  require.cache[provider]!.exports = actualProvider;
  if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css'];
  if (previousReact) globalReact.React = previousReact; else Reflect.deleteProperty(globalThis, 'React');
});
const visible = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const now = Date.now();
const fresh: UsdPriceSnapshot = { prices: { ETH: 2400, wstETH: 2880, fxUSD: .99 }, updatedAt: now, status: 'ready' };
const collateral: PositionOutcomeFacts['collateral'] = { label: 'Estimated collateral', value: '≈ 0.83524128 stETH', title: '0.835241284230594092 stETH (0.670412512785242112 wstETH at 1.245861716930919999 stETH per wstETH)', exact: '0.670412512785242112', symbol: 'wstETH' };
const renderCollateral = (value = collateral) => render(React.createElement(CollateralAmount, { collateral: value }));
test('review fee makes fresh USD primary and preserves exact native cap', () => {
  snapshot = fresh;
  const html = render(React.createElement(FeeAmount, { fact: { value: '0.00024 ETH (max)', title: '0.000240000000000001 ETH (max)' } }));
  assert.match(html, /<summary[^>]*>[\s\S]*?≈ \$0\.58[\s\S]*?<\/summary>/);
  assert.match(html, /<p>0\.000240000000000001 ETH \(max\)/);
  assert.match(html, /native amount governs the transaction/);
});
test('review fee falls back to native for missing, stale, future or invalid price', () => {
  for (const invalid of [{ ...fresh, prices: { fxUSD: 1 } }, { ...fresh, updatedAts: { ETH: now - USD_PRICE_MAX_AGE_MS - 10 } }, { ...fresh, updatedAts: { ETH: now + 60_000 } }, { ...fresh, prices: { ETH: 0 } }]) {
    snapshot = invalid;
    const html = render(React.createElement(FeeAmount, { fact: { value: '0.00024 ETH (max)' } }));
    assert.match(html, /data-usd-state="unavailable"[^>]*>0\.00024 ETH \(max\)/);
    assert.doesNotMatch(visible(html), /\$/);
  }
});

test('protocol fee dollars value each quoted token, preserving native amount and rate disclosure', () => {
  snapshot = { ...fresh, prices: { fxUSD: .98, USDC: 1.02 } };
  const fact = { label: 'f(x) fee', value: '5%', title: '1 fxUSD + 2 USDC; 5% of both gross redemption legs, before conversion.', feeAmounts: [{ amount: '1', symbol: 'fxUSD' }, { amount: '2', symbol: 'USDC' }] };
  const html = render(React.createElement(ProtocolFeeAmount, { fact }));
  assert.match(html, /<summary[^>]*aria-label="≈ \$3\.02\. Show f\(x\) fee amount and rate breakdown"[^>]*>[\s\S]*?>≈ \$3\.02</);
  assert.match(visible(html), /1 fxUSD \+ 2 USDC; 5% of both gross redemption legs/);
  assert.match(visible(html), /current-price estimate/);
  assert.equal(protocolFeeUsdValue(fact, snapshot), 3.02);
});

test('protocol fee requires all charged-leg prices and rejects missing amount bases without guessing a peg', () => {
  const fact = { label: 'f(x) fee', value: '5%', feeAmounts: [{ amount: '1', symbol: 'fxUSD' }, { amount: '2', symbol: 'USDC' }] };
  for (const invalid of [
    { ...fresh, prices: { fxUSD: .99 } },
    { ...fresh, prices: { fxUSD: .99, USDC: 1 }, updatedAts: { USDC: now - USD_PRICE_MAX_AGE_MS - 1 } },
    { ...fresh, prices: { fxUSD: .99, USDC: 1 }, updatedAts: { USDC: now + 60_000 } },
    { ...fresh, prices: { fxUSD: .99, USDC: NaN } },
  ]) {
    snapshot = invalid;
    assert.equal(protocolFeeUsdValue(fact, snapshot), null);
    const html = render(React.createElement(ProtocolFeeAmount, { fact }));
    assert.match(html, /data-usd-state="unavailable">Unavailable/);
    assert.match(html, /Full value<\/span><span[^>]*>5%/);
  }
  assert.equal(protocolFeeUsdValue({ ...fact, feeAmounts: undefined }, fresh), null);
  assert.equal(protocolFeeUsdValue({ ...fact, feeAmounts: [] }, fresh), 0, 'validated zero rates need no fabricated price');
  assert.equal(protocolFeeUsdValue({ ...fact, feeAmounts: [{ amount: '1e4', symbol: 'fxUSD' }] }, fresh), null);
  snapshot = fresh;
  const dust = render(React.createElement(ProtocolFeeAmount, { fact: { ...fact, feeAmounts: [{ amount: '0.000000000000000001', symbol: 'fxUSD' }] } }));
  assert.match(dust, /&lt;\$0\.01/);
  assert.doesNotMatch(dust, />\$0\.00</);
});
test('long collateral values original wstETH quote, not normalized stETH or execution price', () => {
  snapshot = { ...fresh, prices: { wstETH: 2880, stETH: 10000, ETH: 100000 } };
  const html = renderCollateral();
  assert.match(visible(html), /≈ \$1,930\.79/);
  assert.match(html, /not position notional or an execution price/);
  assert.match(html, /1\.245861716930919999 stETH per wstETH/);
});
test('collateral keeps native amount for missing, stale, future or invalid matching asset', () => {
  for (const invalid of [{ ...fresh, prices: { ETH: 2400, stETH: 2400 } }, { ...fresh, updatedAts: { wstETH: now - USD_PRICE_MAX_AGE_MS - 10, ETH: now } }, { ...fresh, updatedAts: { wstETH: now + 60_000 } }, { ...fresh, prices: { wstETH: NaN } }]) {
    snapshot = invalid;
    const html = renderCollateral();
    assert.match(visible(html), /≈ 0\.83524128 stETH/);
    assert.match(html, /USD value unavailable: no fresh matching wstETH price/);
    assert.doesNotMatch(visible(html), /\$/);
  }
});
test('short backing uses fresh fxUSD price and never assumes a dollar peg', () => {
  snapshot = fresh;
  const short = { ...collateral, exact: '1234.5', symbol: 'fxUSD', value: '1,234.5 fxUSD', title: '1234.5 fxUSD' };
  assert.match(visible(renderCollateral(short)), /≈ \$1,222\.16/);
  snapshot = { ...fresh, prices: { ETH: 2400, wstETH: 2880 } };
  assert.match(visible(renderCollateral(short)), /1,234\.5 fxUSD/);
});
test('borrow order preserves net-versus-gross facts and never mutates accepted data', () => {
  const facts = ['Debt added', 'Loan-to-value', 'Estimated received', 'Minimum received'].map(label => ({ label, value: label }));
  assert.deepEqual(orderCompactReviewFacts(facts, true).map(fact => fact.label), ['Estimated received', 'Debt added', 'Loan-to-value', 'Minimum received']);
  assert.equal(orderCompactReviewFacts(facts, false), facts);
  assert.equal(facts[0].label, 'Debt added');
});
test('display retains price demand and matching-asset expiry redraw', () => {
  const source = readFileSync(new URL('../src/components/review/AmountUsd.tsx', import.meta.url), 'utf8');
  assert.match(source, /priceDemandRegistry.acquire\(\)/);
  assert.match(source, /quote.updatedAts\?\.\[key\] \?\? quote.updatedAt/);
  assert.match(source, /timestamp \+ USD_PRICE_MAX_AGE_MS - Date.now\(\) \+ 1/);
  assert.match(source, /collateralUsdEstimate\(collateral, freshDisplayPrices\(quote\)\)/);
});

test('compact review amounts preserve exact disclosures, network, estimates and receipt presentation', () => {
  snapshot = fresh;
  const { TransactionAmountFlow } = require('../src/components/review/TransactionAmountFlow') as typeof import('../src/components/review/TransactionAmountFlow');
  const facts = [
    { label: 'Deposit', value: '0.008793346701694145 ETH' },
    { label: 'Estimated fxUSD received', value: '1.204548856269749526 fxUSD' },
  ];
  const normal = render(React.createElement(TransactionAmountFlow, { facts, chainId: 1 }));
  const compact = render(React.createElement(TransactionAmountFlow, { facts, chainId: 1, compact: true }));
  const disclosures = (html: string) => [...html.matchAll(/<summary[^>]*aria-label="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(disclosures(compact), disclosures(normal));
  assert.match(compact, /data-amount-provenance="review"/);
  assert.match(compact, /data-compact-amounts="2"/);
  assert.match(visible(compact), /Deposit/);
  assert.match(visible(compact), /Receive · estimated/);
  assert.match(visible(compact), /Ethereum/);
  assert.match(compact, /data-usd-state="estimate"/);
  for (const fact of facts) assert.ok(compact.includes(fact.value));
  const receipt = render(React.createElement(TransactionAmountFlow, { facts, chainId: 1, compact: true, receipt: true }));
  assert.match(receipt, /data-amount-provenance="receipt"/);
  assert.doesNotMatch(receipt, /data-compact-amounts/);
});
