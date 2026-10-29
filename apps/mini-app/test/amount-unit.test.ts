import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { AMOUNT_UNIT_KEY, readAmountUnit, writeAmountUnit } from '../src/lib/amountUnit';
import { tokenAmountForUsd, usdEntryForToken } from '../src/lib/amount';
import type { UsdPriceSnapshot } from '../src/lib/prices';

// Static rendering always starts in tokens, so the unit and the price feed are stubbed.
const require = createRequire(import.meta.url);
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (loaded, filename) => {
  loaded.exports = Object.fromEntries([...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => [match[1], match[1]]));
};
let unit: 'token' | 'usd' = 'token';
let snapshot: UsdPriceSnapshot = { prices: { ETH: 3456.78, fxUSD: 0.998 }, updatedAt: Date.now(), status: 'ready' };
const unitPath = require.resolve('../src/lib/amountUnit');
const actualUnit = require(unitPath);
require.cache[unitPath]!.exports = { ...actualUnit, useAmountUnit: () => [unit, () => undefined] };
const providerPath = require.resolve('../src/components/PriceProvider');
const actualProvider = require(providerPath);
require.cache[providerPath]!.exports = { ...actualProvider, useUsdPrices: () => snapshot };
const { AmountCounterpart, AmountFigure, InlineAmount } = require('../src/components/review/AmountUsd') as typeof import('../src/components/review/AmountUsd');
const { AmountFieldView } = require('../src/components/AmountField') as typeof import('../src/components/AmountField');
after(() => {
  require.cache[unitPath]!.exports = actualUnit;
  require.cache[providerPath]!.exports = actualProvider;
  if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css'];
  if (previousReact) globalReact.React = previousReact; else Reflect.deleteProperty(globalThis, 'React');
});
const visible = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function withWindow(value: unknown, callback: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  try { callback(); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
}

test('the unit preference defaults to tokens, persists on the device and survives blocked storage', () => {
  const store = new Map<string, string>();
  const localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  withWindow({ localStorage }, () => {
    assert.equal(readAmountUnit(), 'token');
    writeAmountUnit('usd');
    assert.equal(store.get(AMOUNT_UNIT_KEY), 'usd');
    assert.equal(readAmountUnit(), 'usd');
    store.set(AMOUNT_UNIT_KEY, 'euros');
    assert.equal(readAmountUnit(), 'usd', 'an unknown stored value keeps the current choice');
    writeAmountUnit('token');
    assert.equal(readAmountUnit(), 'token');
  });
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  withWindow({ localStorage: blocked }, () => {
    writeAmountUnit('usd');
    assert.equal(readAmountUnit(), 'usd', 'the choice still holds for this page');
    writeAmountUnit('token');
  });
});

test('typed dollars become a token amount rounded down to a meaningful precision', () => {
  assert.equal(tokenAmountForUsd('100', 3456.78, 18), '0.02892865');
  assert.equal(tokenAmountForUsd('100', 0.9998, 18), '100.02');
  assert.equal(tokenAmountForUsd('25.5', 1, 6), '25.5');
  assert.equal(tokenAmountForUsd('100', 100_000, 8), '0.001', 'precision never exceeds the token’s decimals');
  assert.equal(tokenAmountForUsd('12.', 1, 6), '12', 'a trailing decimal point is still being typed');
  assert.equal(tokenAmountForUsd('0', 3000, 18), '0');
  for (const [usd, price] of [['', 1], ['abc', 1], ['1e3', 1], ['5', 0], ['5', Number.NaN]] as const) assert.equal(tokenAmountForUsd(usd, price, 18), '');
  // Rounding down never asks for more than was typed.
  assert.ok(Number(tokenAmountForUsd('100', 3456.78, 18)) * 3456.78 <= 100);
  assert.equal(usdEntryForToken('0.02892824', 3456.78), '99.99');
  assert.equal(usdEntryForToken('12.5', 1), '12.50');
  assert.equal(usdEntryForToken('100', 1), '100');
  assert.equal(usdEntryForToken('', 1), '');
});

test('amount legs lead with the reader’s unit and offer the other as the toggle', () => {
  unit = 'token';
  const figure = (amount: string) => render(React.createElement(AmountFigure, { amount, symbol: 'ETH', children: '0.5 ETH' }));
  const counterpart = (amount: string) => render(React.createElement(AmountCounterpart, { amount, symbol: 'ETH', token: '0.5 ETH' }));
  assert.equal(visible(figure('0.5')), '0.5 ETH');
  assert.match(counterpart('0.5'), /<button type="button"[^>]*data-unit-swap="usd"[^>]*><span>≈ \$1,728\.39<\/span>/);
  assert.match(counterpart('0.5'), /title="Show amounts in US dollars"/);

  unit = 'usd';
  assert.equal(visible(figure('0.5')), '≈ $1,728.39');
  assert.match(counterpart('0.5'), /data-unit-swap="token"[^>]*><span>0\.5 ETH<\/span>/);
  assert.match(counterpart('0.5'), /title="Show amounts in tokens"/);

  // Without a fresh price the token leads and nothing pretends to toggle.
  snapshot = { ...snapshot, prices: { fxUSD: 1 } };
  assert.equal(visible(figure('0.5')), '0.5 ETH');
  assert.doesNotMatch(counterpart('0.5'), /<button/);
  assert.match(counterpart('0.5'), /data-usd-state="unavailable"/);
  snapshot = { ...snapshot, prices: { ETH: 3456.78, fxUSD: 0.998 } };
  unit = 'token';
});

test('fact-row amounts carry their USD estimate beneath, in either unit', () => {
  unit = 'token';
  const row = () => render(React.createElement(InlineAmount, { amount: '1000', symbol: 'fxUSD', token: '1,000 fxUSD' }));
  assert.match(row(), /data-amount-unit="token">1,000 fxUSD<\/span><small[^>]*data-usd-state="estimate"><button[^>]*><span>≈ \$998\.00<\/span>/);
  unit = 'usd';
  assert.match(row(), /data-amount-unit="usd">≈ \$998\.00<\/span><small[^>]*><button[^>]*><span>1,000 fxUSD<\/span>/);
  assert.equal(visible(render(React.createElement(InlineAmount, { amount: '3', symbol: 'min', token: '3 min' }))), '3 min', 'unpriced units stay as reviewed');
  unit = 'token';
});

function field(props: Partial<React.ComponentProps<typeof AmountFieldView>>) {
  return render(React.createElement(AmountFieldView, { value: '0.5', onChange: () => undefined, symbol: 'ETH', label: 'Amount', unitPrice: 3456.78, priceStatus: 'ready', ...props }));
}

test('the amount field’s value line switches entry to dollars, as on Jumper', () => {
  unit = 'token';
  const tokens = field({});
  assert.match(tokens, /aria-label="Amount in ETH"/);
  assert.match(tokens, /data-unit-swap="usd"[^>]*><span>≈ \$1,728\.39<\/span>/);
  assert.match(tokens, /title="Enter the amount in US dollars"/);
  assert.doesNotMatch(tokens, /data-amount-unit="usd"/);

  unit = 'usd';
  const dollars = field({});
  assert.match(dollars, /aria-label="Amount in US dollars"/);
  assert.match(dollars, /data-amount-unit="usd"/);
  assert.match(dollars, /class="currency"[^>]*>\$<\/span>/);
  assert.match(dollars, /data-unit-swap="token"[^>]*><span>0\.5 ETH<\/span>/, 'the token amount the form keeps is shown beneath');
  assert.match(dollars, /title="Enter the amount in ETH"/);

  // No fresh price: tokens only, and the value line is not a control.
  const unpriced = field({ unitPrice: undefined, priceStatus: 'unavailable' });
  assert.match(unpriced, /aria-label="Amount in ETH"/);
  assert.doesNotMatch(unpriced, /data-unit-swap/);
  // A field that hides its value line never switches to dollars.
  assert.match(field({ showUsdValue: false }), /aria-label="Amount in ETH"/);
  unit = 'token';
});
