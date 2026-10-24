import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AmountFieldViewProps } from '../src/components/AmountField';

// The isolated JSX/CSS loader the other render tests use.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
const stylesPath = fileURLToPath(new URL('../src/components/AmountField.module.css', import.meta.url)).toLowerCase();
testRequire.extensions['.css'] = (loadedModule, filename) => {
  if (filename.toLowerCase() !== stylesPath) {
    if (previousCssLoader) return previousCssLoader(loadedModule, filename);
    throw new Error(`Unexpected CSS import in amount field render test: ${filename}`);
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

/** Visible text of rendered markup: strip tags until none remain. */
function textOf(html: string) {
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, '');
  } while (text !== previous);
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function field(props: Partial<AmountFieldViewProps>) {
  const { AmountFieldView } = await import('../src/components/AmountField');
  const html = renderToStaticMarkup(React.createElement(AmountFieldView, { value: '', onChange: () => undefined, symbol: 'ETH', label: 'Amount', ...props }));
  const usd = /data-amount-usd[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  return { html, text: textOf(html), usd: textOf(/^<span>([\s\S]*?)<\/span>/.exec(usd)?.[1] ?? '') };
}

test('a route maximum can name its own authority without changing wallet maximum defaults', async () => {
  const borrowed = await field({ symbol: 'fxUSD', label: 'fxUSD to borrow', maxAmount: '1992.600237', maxLabel: 'Use borrowing maximum' });
  assert.match(borrowed.html, /aria-label="Use borrowing maximum"/);
  assert.doesNotMatch(borrowed.html, /Use 100% of available balance/);
  const wallet = await field({ balance: '1' });
  assert.match(wallet.html, /aria-label="Use 100% of available balance"/);
});

test('disconnected fields omit unusable balance shortcuts but preserve a verified public maximum', async () => {
  const disconnected = { status: 'disconnected' as const };
  const wallet = await field({ balanceState: disconnected, showPercentages: true });
  assert.doesNotMatch(wallet.html, /shortcuts|Use 100% of available balance/);
  const publicLimit = await field({ symbol: 'fxUSD', label: 'Borrow', balanceState: disconnected,
    maxAmount: '1992.600237', maxLabel: 'Use borrowing maximum', showPercentages: true });
  assert.match(publicLimit.html, /aria-label="Use borrowing maximum"/);
  assert.doesNotMatch(publicLimit.text, /25%|50%|75%/);
});

test('the Available figure rounds down, so it never reads as more than the wallet holds', async () => {
  assert.match((await field({ balanceState: { status: 'ready', amount: '0.123456789' } })).text, /Available: 0\.12345678 ETH/);
  assert.match((await field({ balanceState: { status: 'ready', amount: '1.999999999999999999' } })).text, /Available: 1\.99999999 ETH/);
  assert.match((await field({ balanceState: { status: 'ready', amount: '12500.5' }, symbol: 'USDC' })).text, /Available: 12,500\.5 USDC/);
  // A positive balance below the last place is named, never shown as zero.
  assert.match((await field({ balanceState: { status: 'ready', amount: '0.000000000000000001' } })).text, /Available: <0\.00000001 ETH/);
  assert.match((await field({ balanceState: { status: 'ready', amount: '0' } })).text, /Available: 0 ETH/);
  // The exact balance stays one hover away.
  assert.match((await field({ balanceState: { status: 'ready', amount: '0.123456789' } })).html, /title="0\.123456789 ETH"/);
});

test('persistent shortcuts expose disabled presets without granting an unavailable balance', async () => {
  for (const balanceState of [{ status: 'disconnected' as const }, { status: 'loading' as const }, { status: 'unavailable' as const }, { status: 'ready' as const, amount: '0' }]) {
    for (const allowAll of [false, true]) {
      const result = await field({ showShortcuts: true, balanceState, allowAll, symbol: allowAll ? 'fxSAVE' : 'USDC' });
      assert.match(result.text, /25%50%75%Max/);
      const buttons = result.html.match(/<button\b[^>]*>/g) ?? [];
      assert.equal(buttons.length, 4);
      assert.ok(buttons.every(button => /disabled=""/.test(button)), 'unavailable presets cannot submit or invent an amount');
      assert.match(result.html, /value=""/);
    }
  }
  assert.doesNotMatch((await field({ showShortcuts: false, balanceState: { status: 'ready', amount: '1' } })).html, /role="group"/);
  assert.doesNotMatch((await field({ showShortcuts: true, showPercentages: false, showMax: false })).html, /role="group"/);
});

test('the USD line marks only a priced estimate with ≈', async () => {
  const price = { unitPrice: 2_400, priceStatus: 'ready' as const };
  // Nothing entered, or an exact zero, is exactly $0.00, priced or not.
  assert.equal((await field({ ...price })).usd, '$0.00');
  assert.equal((await field({})).usd, '$0.00');
  assert.equal((await field({ ...price, value: '0', allowZero: true })).usd, '$0.00');
  assert.equal((await field({ ...price, value: '0.' })).usd, '$0.00');
  assert.equal((await field({ ...price, value: '1.5' })).usd, '≈ $3,600.00');
  // "<$0.01" already says it is approximate; it never doubles up as "≈ <$0.01".
  assert.equal((await field({ ...price, value: '0.000001' })).usd, '<$0.01');
  // Unparseable text is not $0.00: its worth is unknown.
  const malformed = await field({ ...price, value: '1,5' });
  assert.doesNotMatch(malformed.usd, /\$/);
  assert.match(malformed.html, /aria-label="USD value unavailable"/);
});

test('using the whole balance is worth what the balance is worth', async () => {
  const all = await field({ value: 'all', allowAll: true, symbol: 'fxSAVE', unitPrice: 1.05, priceStatus: 'ready', balanceState: { status: 'ready', amount: '600' } });
  assert.equal(all.usd, '≈ $630.00');
  const unknown = await field({ value: 'all', allowAll: true, symbol: 'fxSAVE', unitPrice: 1.05, priceStatus: 'ready', balanceState: { status: 'unavailable' } });
  assert.doesNotMatch(unknown.usd, /\$/);
});

test('whole-balance sentinel displays the exact known balance and stays selected as Max', async () => {
  const known = await field({ value: 'all', allowAll: true, balanceState: { status: 'ready', amount: '12.340000000000000001' } });
  assert.match(known.html, /value="12\.340000000000000001"/);
  assert.match(known.html, /data-selected="true"/);
  assert.doesNotMatch(known.html, /value="all"/);

  const unavailable = await field({ value: 'all', allowAll: true, balanceState: { status: 'unavailable' } });
  assert.match(unavailable.html, /value=""/);
  assert.match(unavailable.html, /title="Balance unavailable"/);
  assert.match(unavailable.html, /data-selected="true"/);
  assert.doesNotMatch(unavailable.html, /value="all"/);
});

test('an amount above the balance says how much is available and how to recover', async () => {
  const over = await field({ value: '2', balanceState: { status: 'ready', amount: '1.256789123' } });
  assert.match(over.text, /Amount exceeds your available 1\.25678912 ETH\. Enter less or use Max\./);
  const withoutMax = await field({ value: '2', showMax: false, balanceState: { status: 'ready', amount: '1.25' } });
  assert.match(withoutMax.text, /Amount exceeds your available 1\.25 ETH\. Enter less\./);
  // The field and the form's own blocker compare the exact balance, not the rounded figure.
  assert.doesNotMatch((await field({ value: '1.256789123', balanceState: { status: 'ready', amount: '1.256789123' } })).text, /exceeds/);
  // An empty wallet is named as such rather than "exceeds your available 0 ETH".
  assert.match((await field({ value: '1', balanceState: { status: 'ready', amount: '0' } })).text, /This wallet has no ETH\. Add some to continue\./);
  assert.match((await field({ value: '1', balanceState: { status: 'ready', amount: '0' }, tokenSelector: React.createElement('span', null, 'picker') })).text,
    /This wallet has no ETH\. Add some or choose another asset to continue\./);
});

test('asset precision remains visible as a field error', async () => {
  const result = await field({ value: '1.234', maxDecimals: 2 });
  assert.match(result.html, /This asset allows 2 decimal places/);
  assert.match(result.html, /aria-invalid="true"/);
});

test('a shortened resting preview leaves the exact controlled amount in the input', async () => {
  for (const [symbol, value, preview] of [
    ['ETH', '0.008793346701694145', '≈ 0.0087933'],
    ['fxUSD', '1.204548856269749526', '≈ 1.2045'],
  ]) {
    const result = await field({ symbol, value });
    assert.ok(result.html.includes(`value="${value}"`));
    assert.ok(result.html.includes(`title="${value}"`));
    assert.match(result.html, /class="test-entryPreview" aria-hidden="true"/);
    assert.ok(result.html.includes(preview));
  }
});
