import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatReviewFactValue } from '../src/components/review/reviewFactFormatting';

const format = (value: string, label = 'Amount', title?: string) => formatReviewFactValue({ label, value, title });

test('screenshot financial rows share short, honestly rounded amounts', () => {
  for (const [value, expected] of [
    ['721.13279179306640625 fxUSD', '≈ 721.13 fxUSD'],
    ['0.72113279 fxUSD (0.1%)', '≈ 0.7211 fxUSD (0.1%)'],
    ['0.358481260986328125 stETH', '≈ 0.3585 stETH'],
    ['720.89147659306640625 fxUSD', '≈ 720.89 fxUSD'],
  ]) {
    const result = format(value);
    assert.equal(result.display, expected);
    assert.equal(result.original, value);
    assert.equal(result.shortened, true);
    assert.equal(result.expandable, true);
  }
});

test('whole amounts never lose digits, including carry beyond safe integer range', () => {
  assert.equal(format('900719925474099312345678901234567890 fxUSD').display, '900,719,925,474,099,312,345,678,901,234,567,890 fxUSD');
  assert.equal(format('9007199254740993.999 fxUSD').display, '≈ 9,007,199,254,740,994 fxUSD');
  assert.equal(format('9,007,199,254,740,993.12 fxUSD').display, '9,007,199,254,740,993.12 fxUSD');
  assert.equal(format('1234 fxUSD').shortened, false);
});

test('zero and tiny nonzero values remain truthful without underflow', () => {
  assert.equal(format('0.000000000000000000 fxUSD').display, '0 fxUSD');
  assert.equal(format('0.000000000000000001 stETH').display, '0.000000000000000001 stETH');
  assert.equal(format('0.00000000000000000123456789 stETH').display, '≈ 0.000000000000000001235 stETH');
  assert.equal(format('0.999999 fxUSD').display, '≈ 1 fxUSD');
  assert.equal(format('1.230000 fxUSD').display, '1.23 fxUSD');
  assert.equal(format('1.230000 fxUSD').shortened, false);
});

test('existing approximation and fee suffix survive with no duplicated markers', () => {
  assert.equal(format('≈ 721.13279179306640625 fxUSD').display, '≈ 721.13 fxUSD');
  assert.equal(format('≈721.13 fxUSD').display, '≈ 721.13 fxUSD');
  assert.equal(format('≈ 0.72113279 fxUSD (0.1%)').display, '≈ 0.7211 fxUSD (0.1%)');
  assert.equal(format('0.1 fxUSD (0.12345678%)').display, '0.1 fxUSD (0.12345678%)');
});

test('native maximum fee fallbacks stay compact without dropping their bound qualifier', () => {
  const value = '0.000196869981 ETH max';
  const result = format(value, 'Network fee max', '0.000196869981 ETH max; actual fee may be lower.');
  assert.equal(result.display, '≈ 0.0001969 ETH max');
  assert.equal(result.original, value);
  assert.equal(result.detail, '0.000196869981 ETH max; actual fee may be lower.');
  assert.equal(format('≈ 0.000196869981 ETH max').display, '≈ 0.0001969 ETH max');
  assert.equal(format('0.72113279 fxUSD (0.1%) max').display, '≈ 0.7211 fxUSD (0.1%) max');
  assert.equal(format('0.000000000000000001 ETH max').display, '0.000000000000000001 ETH max');
  for (const unknown of ['0.123456 max', '0.123456% max', '0.123456 stETH/wstETH max', '0.123456 ETH maximum']) {
    assert.equal(format(unknown).display, unknown);
  }
});

test('unavailable, inequalities, free-form ratios, identifiers and malformed numbers remain unchanged', () => {
  for (const value of ['Unavailable', 'Pending', 'Included in gas fee', '—', '3210.123456 fxUSD per stETH', '1.234567 ×', '30 min', '<0.00000001 ETH', '≥1.234567 fxUSD', '9007199254740993123', '1,23.456789 fxUSD', '1e-18 stETH', '0 raw units', '5% of debt', '10 fxUSD; excludes gas']) {
    assert.equal(format(value).display, value);
    assert.equal(format(value).shortened, false);
  }
});

test('currency and complete percentages compact string-safely without losing sign', () => {
  assert.equal(format('$9007199254740993.123456', 'Value').display, '≈ $9,007,199,254,740,993.12');
  assert.equal(format('-0.12345678%', 'Price impact').display, '≈ -0.1235%');
  assert.equal(format('£721.13279179306640625', 'Value').display, '≈ £721.13');
  assert.equal(format('0.000000000000000001%', 'Fee').display, '0.000000000000000001%');
});

test('complete execution and risk-price ratios compact only the amount and preserve denomination', () => {
  for (const [value, expected] of [
    ['2400.123456789 fxUSD / stETH', '≈ 2,400.12 fxUSD / stETH'],
    ['≈ $2285.1912345 / stETH', '≈ $2,285.19 / stETH'],
    ['9007199254740993.123456789 fxUSD / WBTC', '≈ 9,007,199,254,740,993.12 fxUSD / WBTC'],
    ['0.012345 stETH/wstETH', '≈ 0.01235 stETH/wstETH'],
    ['0.000000000000000001 fxUSD / stETH', '0.000000000000000001 fxUSD / stETH'],
    ['≈ £1234.12345678/ETH', '≈ £1,234.12/ETH'],
  ]) {
    const result = format(value, 'Execution price', `${value}; accepted quote, not an external USD valuation.`);
    assert.equal(result.display, expected);
    assert.equal(result.original, value);
    assert.equal(result.detail, `${value}; accepted quote, not an external USD valuation.`);
  }
  for (const unknown of ['1 of 2', '1.234567/2', '2400.123456 fxUSD /', '2400.123456 fxUSD / 1 stETH', '2400.123456 fxUSD / stETH / wstETH', '0.123456% / stETH', '1.234567 ETH / min', '$1.234567 / min', '<2400.123456 fxUSD / stETH', 'Position 2400.123456 fxUSD / stETH']) {
    assert.equal(format(unknown, 'Execution price').display, unknown);
  }
});

test('minima retain their identity and source titles cannot replace values or caveats', () => {
  const minimum = Object.freeze({ label: 'Minimum received', value: '99.123456789 wstETH', title: '99.123456789 wstETH; signed minimum, not expected output.' });
  const minimumResult = formatReviewFactValue(minimum);
  assert.equal(minimumResult.display, '≈ 99.12 wstETH');
  assert.equal(minimumResult.original, minimum.value);
  assert.equal(minimumResult.detail, minimum.title);
  const missing = format('Unavailable', 'Estimated collateral', 'The SDK quote does not deduct supply fees.');
  assert.equal(missing.display, 'Unavailable');
  assert.equal(missing.detail, 'The SDK quote does not deduct supply fees.');
  assert.equal(missing.expandable, true);
  const source = format('0.35848126 stETH', 'Estimated collateral', '0.358481260986328125 stETH (0.3 wstETH at 1.19493753662109375 stETH per wstETH)');
  assert.equal(source.display, '≈ 0.3585 stETH');
  assert.equal(source.detail, '0.358481260986328125 stETH (0.3 wstETH at 1.19493753662109375 stETH per wstETH)');
  assert.equal(format('0 fxUSD', 'Amount', '0 fxUSD').expandable, false);
});

const require = createRequire(import.meta.url);
const previousCss = require.extensions['.css'];
require.extensions['.css'] = (loaded, file) => {
  const names = [...readFileSync(file, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(match => match[1]);
  loaded.exports = Object.fromEntries(names.map(name => [name, name]));
};
const oldReact = (globalThis as any).React;
(globalThis as any).React = React;
after(() => { if (previousCss) require.extensions['.css'] = previousCss; else delete require.extensions['.css']; (globalThis as any).React = oldReact; });

test('review value renders a compact amount without a numeric disclosure or source panel', async () => {
  const { ReviewFactValue } = await import('../src/components/review/ReviewFactValue');
  const fact = { label: 'Estimated debt', value: '721.13279179306640625 fxUSD', title: '721.13279179306640625 fxUSD; excludes gas.' };
  const html = renderToStaticMarkup(React.createElement(ReviewFactValue, { fact, className: 'externalValue' }));
  assert.equal(html, '<span class="value externalValue">≈ 721.13 fxUSD</span>');
  assert.doesNotMatch(html, /<details|<summary|721\.13279179306640625|excludes gas/);
  const css = readFileSync(new URL('../src/components/review/ReviewFactValue.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /summary|expanded|original/);
});

test('short review values stay compact and unavailable values remain visually blank with accessible labels', async () => {
  const { ReviewFactValue } = await import('../src/components/review/ReviewFactValue');
  const plain = renderToStaticMarkup(React.createElement(ReviewFactValue, { fact: { label: 'Gas fee', value: 'Unavailable' } }));
  assert.match(plain, /aria-label="Gas fee unavailable"/);
  assert.match(plain, /missing-value-unavailable/);
  assert.doesNotMatch(plain, />Unavailable</);
  const caveat = renderToStaticMarkup(React.createElement(ReviewFactValue, { fact: { label: 'Gas fee', value: 'Unavailable', title: 'Simulation failed; not a zero fee.' } }));
  assert.match(caveat, /aria-label="Gas fee unavailable"/);
  assert.doesNotMatch(caveat, /Simulation failed|>Unavailable</);
});

test('missing risk estimates keep their decision label and explanation without visible placeholder copy', async () => {
  const { ReviewRiskPrices } = await import('../src/components/review/ReviewRiskPrices');
  const html = renderToStaticMarkup(React.createElement(ReviewRiskPrices, { route: null }));
  assert.match(html, /aria-label="Risk estimates unavailable"/);
  assert.doesNotMatch(html, />Unavailable|>Checking pool risk/);
  assert.match(html, /About Risk estimates/);
});
