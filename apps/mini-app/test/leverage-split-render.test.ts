import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Match the isolated JSX/CSS loader used by the position-card render tests.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
const stylesPaths = new Set(['LeverageSplit', 'PageSections', 'YieldFlow', 'trade-surfaces', 'AmountField'].map((name) =>
  fileURLToPath(new URL(`../src/components/${name}.module.css`, import.meta.url)).toLowerCase()));
testRequire.extensions['.css'] = (loadedModule, filename) => {
  if (!stylesPaths.has(filename.toLowerCase())) {
    if (previousCssLoader) return previousCssLoader(loadedModule, filename);
    throw new Error(`Unexpected CSS import in leverage split render test: ${filename}`);
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

/** Visible text of rendered markup: strip tags until none remain, since one pass can leave fragments. */
function textOf(html: string) {
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, '');
  } while (text !== previous);
  return text;
}

function splitRows(html: string) {
  return [...html.matchAll(/<li[^>]*style="--borrowed:([^"]+)"[^>]*>(.*?)<\/li>/g)].map((match) => ({
    borrowed: Number(match[1]),
    text: textOf(match[2]),
  }));
}

test('long illustrations preserve collateral-based leverage and rounded labels', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  const html = renderToStaticMarkup(React.createElement(LeverageSplit, { side: 'long' }));
  const rows = splitRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].borrowed, 1 / 2);
  assert.equal(rows[0].text, '2×50% debt · 50% equity');
  assert.equal(rows[1].borrowed, 2 / 3);
  assert.equal(rows[1].text, '3×67% debt · 33% equity');
});

test('short illustrations use borrowed exposure over equity for 2× and 3×', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  const html = renderToStaticMarkup(React.createElement(LeverageSplit, { side: 'short' }));
  assert.match(html, /aria-label="Debt and equity share of a position by leverage, before fees"/);
  const rows = splitRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].borrowed, 2 / 3);
  assert.equal(rows[0].text, '2×67% debt · 33% equity');
  assert.equal(rows[1].borrowed, 3 / 4);
  assert.equal(rows[1].text, '3×75% debt · 25% equity');
});

test('both directions show the same leverages, so comparing them never changes the layout', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  const leverages = (side: 'long' | 'short') => splitRows(renderToStaticMarkup(React.createElement(LeverageSplit, { side })))
    .map((row) => row.text.slice(0, row.text.indexOf('×') + 1));
  assert.deepEqual(leverages('long'), ['2×', '3×']);
  assert.deepEqual(leverages('short'), leverages('long'));
});

test('Trade education follows the ticket side and keeps its copy consistent with the bars', async () => {
  const { TradeSections } = await import('../src/components/ProductSections');
  for (const market of ['ETH', 'BTC'] as const) {
    for (const side of ['long', 'short', 'long'] as const) {
      const html = renderToStaticMarkup(React.createElement(TradeSections, {
        market, side, leverage: { min: side === 'long' ? 1.1 : 0.1, max: 6 },
        openPositions: null, positionsStatus: 'disconnected',
      }));
      const rows = splitRows(html);
      // The ticket's slider explains the chosen leverage live, so the examples
      // offer no Long/Short switch of their own: they show the ticket's side.
      assert.doesNotMatch(html, /role="radiogroup"|role="radio"/);
      assert.doesNotMatch(html, />Example</);
      assert.match(html, /aria-label="Debt and equity share of a position by leverage, before fees"/);
      assert.equal(rows.length, 2);
      assert.equal(rows[1].borrowed, side === 'long' ? 2 / 3 : 3 / 4);
      if (side === 'long') {
        assert.match(html, /a 3× long carries 67% debt and 33% equity/);
        assert.equal(rows[1].text, '3×67% debt · 33% equity');
      } else {
        assert.match(html, /a 3× short carries 75% debt and 25% equity/);
        assert.equal(rows[1].text, '3×75% debt · 25% equity');
      }
    }
  }
});

test('each action page keeps its live facts and f(x) explainer, and leaves steps and questions to one Docs link', async () => {
  const { BorrowSections, EarnSections, MoveSections, TradeSections } = await import('../src/components/ProductSections');
  const pages = [
    { docs: 'trade', html: renderToStaticMarkup(React.createElement(TradeSections, { market: 'ETH', side: 'long', leverage: { min: 1.1, max: 6.1 }, openPositions: 2, positionsStatus: 'ready' })),
      keeps: ['Market details', '24h low', 'Live market feed', 'How leverage works', 'Debt and equity share of a position', 'A brake before liquidation'] },
    { docs: 'earn', html: renderToStaticMarkup(React.createElement(EarnSections, { cooldown: '1h', instantFee: '1%', vaultStatus: 'unavailable' })),
      keeps: ['Withdrawal terms', '1h', 'Instant withdrawal fee', 'How fxSAVE earns yield', 'Sources of stability pool rewards'] },
    { docs: 'borrow', html: renderToStaticMarkup(React.createElement(BorrowSections, { ltvLimit: '85.4%' })),
      keeps: ['Borrowing terms', '85.4%', 'ETH, WETH, stETH, wstETH, or WBTC', 'A brake before liquidation'] },
    { docs: 'move', html: renderToStaticMarkup(React.createElement(MoveSections)), keeps: ['Transfer details', 'LayerZero'] },
  ];
  for (const { docs, html, keeps } of pages) {
    // Visible copy, or an accessible name such as the split's list label.
    for (const copy of keeps) assert.ok(textOf(html).includes(copy) || html.includes(copy), `${docs} keeps "${copy}"`);
    // The generic step lists and question accordions now live in Docs.
    assert.doesNotMatch(html, /<ol(?![^>]*aria-label="Debt and equity share of a position)/, `${docs} has no steps or questions`);
    assert.doesNotMatch(textOf(html), /in three steps|Before you (?:trade|deposit|move)\b/);
    const docsLinks = [...html.matchAll(/href="\/docs[^"]*"/g)].map((match) => match[0]);
    assert.deepEqual(docsLinks, [`href="/docs/guide/${docs}"`], `${docs} has one in-app link to its Docs guide`);
    assert.match(html, new RegExp(`href="/docs/guide/${docs}">How it works<svg[^>]*lucide-chevron-right`), 'an in-app link uses a chevron');
  }
});

test('the leverage slider uses live bounds and an accessible value with the position split', async () => {
  const { LeverageSplitRange } = await import('../src/components/LeverageSplit');
  const { leverageTrackPosition } = await import('../src/lib/leverageShare');
  const render = (side: 'long' | 'short', value: number, min: number, max: number) => renderToStaticMarkup(React.createElement(LeverageSplitRange, {
    id: 'lever', label: 'Target leverage slider', side, value, min, max, onChange: () => undefined,
  }));
  const long = render('long', 2.8, 1.1, 6.1);
  // Value, limits and step are leverage; the spoken value includes debt and equity.
  const input = /<input[^>]*>/.exec(long)![0];
  for (const attribute of ['type="range"', 'id="lever"', 'min="1.1"', 'max="6.1"', 'step="0.1"', 'value="2.8"', 'aria-label="Target leverage slider"', 'aria-valuetext="2.8×, 64% debt, 36% equity"']) {
    assert.ok(input.includes(attribute), `${attribute} in ${input}`);
  }
  assert.match(render('short', 2.8, 0.1, 6), /aria-valuetext="2\.8×, 74% debt, 26% equity"/);
  // The thumb and ticks share the linear leverage scale across the verified live bounds.
  const style = /class="test-slider"[^>]*style="([^"]+)"/.exec(long)![1];
  assert.equal(style, `--share:${leverageTrackPosition(2.8, 1.1, 6.1)}`);
  // The selected range is drawn independently from the decorative ticks. Ticks need the measured
  // track for their spacing, so none is drawn before layout.
  assert.match(long, /<div class="test-sliderBar" aria-hidden="true"><i class="test-sliderSelected"><\/i><i class="test-sliderRemaining"><\/i><\/div>/);
  assert.match(long, /<div class="test-sliderTicks" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(long, /class="test-sliderTick"/);
  assert.match(long, /<span class="test-sliderThumb" aria-hidden="true"><\/span>/);
  // The quiet footer keeps only the live minimum and maximum.
  assert.equal(textOf(/<div class="test-bounds"[^>]*>(.*)<\/div>/.exec(long)![1]), '1.1×6.1×');
});

test('the slider keeps its chosen value inside the live range', async () => {
  const { LeverageSplitRange } = await import('../src/components/LeverageSplit');
  const html = renderToStaticMarkup(React.createElement(LeverageSplitRange, {
    id: 'lever', label: 'Target leverage slider', side: 'long', value: 1.1, min: 1.1, max: 6.1, onChange: () => undefined,
  }));
  assert.match(html, /min="1\.1" max="6\.1" step="0\.1"[^>]*value="1\.1"/);
  assert.match(html, /aria-valuetext="1\.1×, 9% debt, 91% equity"/);
  assert.match(html, /class="test-bounds"[^>]*><span aria-hidden="true">1\.1×<\/span><span aria-hidden="true">6\.1×<\/span>/);
});
