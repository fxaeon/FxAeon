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
  const html = renderToStaticMarkup(React.createElement(LeverageSplit, { side: 'long', debtLabel: 'minted fxUSD' }));
  const rows = splitRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].borrowed, 1 / 2);
  assert.equal(rows[0].text, '2×50% minted fxUSD · 50% yours');
  assert.equal(rows[1].borrowed, 2 / 3);
  assert.equal(rows[1].text, '3×67% minted fxUSD · 33% yours');
});

test('short illustrations use borrowed exposure over equity for 2× and 3×', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  const html = renderToStaticMarkup(React.createElement(LeverageSplit, { side: 'short', debtLabel: 'borrowed wstETH' }));
  assert.match(html, /aria-label="Share of a position that is borrowed wstETH, by leverage, before fees"/);
  const rows = splitRows(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].borrowed, 2 / 3);
  assert.equal(rows[0].text, '2×67% borrowed wstETH · 33% yours');
  assert.equal(rows[1].borrowed, 3 / 4);
  assert.equal(rows[1].text, '3×75% borrowed wstETH · 25% yours');
});

test('both directions show the same leverages, so comparing them never changes the layout', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  const leverages = (side: 'long' | 'short') => splitRows(renderToStaticMarkup(React.createElement(LeverageSplit, { side, debtLabel: 'debt' })))
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
      assert.match(html, new RegExp(`aria-label="Share of a position that is ${side === 'long' ? 'minted fxUSD' : `borrowed ${market === 'ETH' ? 'wstETH' : 'WBTC'}`}, by leverage, before fees"`));
      assert.equal(rows.length, 2);
      assert.equal(rows[1].borrowed, side === 'long' ? 2 / 3 : 3 / 4);
      if (side === 'long') {
        assert.match(html, /a 3× long is two thirds minted fxUSD and one third yours/);
        assert.equal(rows[1].text, '3×67% minted fxUSD · 33% yours');
      } else {
        assert.match(html, /a 3× short is three quarters borrowed and one quarter yours/);
        assert.equal(rows[1].text, `3×75% borrowed ${market === 'ETH' ? 'wstETH' : 'WBTC'} · 25% yours`);
      }
    }
  }
});

test('each action page keeps its live facts and f(x) explainer, and leaves steps and questions to one Docs link', async () => {
  const { BorrowSections, EarnSections, MoveSections, TradeSections } = await import('../src/components/ProductSections');
  const pages = [
    { docs: 'trade', html: renderToStaticMarkup(React.createElement(TradeSections, { market: 'ETH', side: 'long', leverage: { min: 1.1, max: 6.1 }, openPositions: 2, positionsStatus: 'ready' })),
      keeps: ['ETH at a glance', '24h low', 'Live market feed', 'Where leverage comes from', 'Share of a position', 'A brake before liquidation'] },
    { docs: 'earn', html: renderToStaticMarkup(React.createElement(EarnSections, { apy: '6.29%', apyStatus: 'unavailable', cooldown: '1h', instantFee: '1%', vaultStatus: 'unavailable' })),
      keeps: ['The vault at a glance', '6.29%', 'Instant withdrawal fee', 'Where the yield comes from', 'Sources of stability pool rewards'] },
    { docs: 'borrow', html: renderToStaticMarkup(React.createElement(BorrowSections, { ltvLimit: '85.4%' })),
      keeps: ['Terms at a glance', '85.4%', 'ETH, WETH, stETH, wstETH, or WBTC', 'A brake before liquidation'] },
    { docs: 'move', html: renderToStaticMarkup(React.createElement(MoveSections)), keeps: ['Routes at a glance', 'LayerZero'] },
  ];
  for (const { docs, html, keeps } of pages) {
    // Visible copy, or an accessible name such as the split's list label.
    for (const copy of keeps) assert.ok(textOf(html).includes(copy) || html.includes(copy), `${docs} keeps "${copy}"`);
    // The generic step lists and question accordions now live in Docs.
    assert.doesNotMatch(html, /<details|<ol(?![^>]*aria-label="Share of a position)/, `${docs} has no steps or questions`);
    assert.doesNotMatch(textOf(html), /in three steps|Before you (?:trade|deposit|move)\b/);
    const docsLinks = [...html.matchAll(/href="\/docs[^"]*"/g)].map((match) => match[0]);
    assert.deepEqual(docsLinks, [`href="/docs/guide/${docs}"`], `${docs} has one in-app link to its Docs guide`);
    assert.match(html, new RegExp(`href="/docs/guide/${docs}">How it works<svg[^>]*lucide-chevron-right`), 'an in-app link uses a chevron');
  }
});

test('the ticket caption states the split at the chosen leverage, with the same figures as the examples', async () => {
  const { LeverageSplit, LeverageSplitCaption } = await import('../src/components/LeverageSplit');
  const caption = (side: 'long' | 'short', leverage: number, debtLabel: string) => renderToStaticMarkup(React.createElement(LeverageSplitCaption, {
    id: 'leverage-split', side, debtLabel, leverage, min: 1.1, max: 6.1,
  }));
  assert.equal(textOf(caption('long', 3, 'minted fxUSD')), '67% minted fxUSD · 33% yours at 3.0×, before fees');
  assert.equal(textOf(caption('short', 3, 'borrowed WBTC')), '75% borrowed WBTC · 25% yours at 3.0×, before fees');
  assert.match(caption('long', 3, 'minted fxUSD'), /<span class="sr-only"> at 3\.0×, before fees<\/span>/);
  // The caption and the examples come from one calculation, so they can never disagree.
  for (const side of ['long', 'short'] as const) {
    const examples = splitRows(renderToStaticMarkup(React.createElement(LeverageSplit, { side, debtLabel: 'debt' })));
    for (const [index, leverage] of [2, 3].entries()) {
      const figures = textOf(caption(side, leverage, 'debt')).replace(/ at .*$/, '');
      assert.equal(`${leverage}×${figures}`, examples[index].text);
    }
  }
});

test('the leverage slider is a native slider in leverage units whose track draws the split', async () => {
  const { LeverageSplitRange } = await import('../src/components/LeverageSplit');
  const { debtShare } = await import('../src/lib/leverageShare');
  const render = (side: 'long' | 'short', value: number, min: number, max: number, debtLabel: string) => renderToStaticMarkup(React.createElement(LeverageSplitRange, {
    id: 'lever', label: 'Target leverage slider', side, debtLabel, value, leverage: value, min, max, describedBy: 'split', captionId: 'split', onChange: () => undefined,
  }));
  const long = render('long', 2.8, 1.1, 6.1, 'minted fxUSD');
  // Value, bounds and step are leverage; the spoken value adds the split it draws.
  const input = /<input[^>]*>/.exec(long)![0];
  for (const attribute of ['type="range"', 'id="lever"', 'min="1.1"', 'max="6.1"', 'step="0.1"', 'value="2.8"', 'aria-label="Target leverage slider"', 'aria-valuetext="2.8×, 64% minted fxUSD"', 'aria-describedby="split"']) {
    assert.ok(input.includes(attribute), `${attribute} in ${input}`);
  }
  assert.match(render('short', 2.8, 0.1, 6, 'borrowed wstETH'), /aria-valuetext="2\.8×, 74% borrowed wstETH"/);
  // The thumb sits at the debt share, and the range's ends where their leverages fall on the split.
  const style = /class="test-slider"[^>]*style="([^"]+)"/.exec(long)![1];
  assert.equal(style, `--share:${debtShare('long', 2.8)};--min-share:${debtShare('long', 1.1)};--max-share:${debtShare('long', 6.1)}`);
  // The bar is the split alone: nothing is ever cut into it. Ticks live on their own layer, drawing
  // only, and need the measured track for their spacing, so none is drawn before layout.
  assert.match(long, /<div class="test-sliderBar" aria-hidden="true"><i class="test-sliderDebt"><\/i><i class="test-sliderYours"><\/i><i class="test-sliderOff" data-end="min"><\/i><i class="test-sliderOff" data-end="max"><\/i><\/div>/);
  assert.match(long, /<div class="test-sliderTicks" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(long, /class="test-sliderTick"/);
  assert.match(long, /<span class="test-sliderThumb" aria-hidden="true"><\/span>/);
  // The range ends and the caption keep their row under the track.
  assert.equal(textOf(/<div class="test-bounds"[^>]*>(.*)<\/div>/.exec(long)![1]), '1.1×64% minted fxUSD · 36% yours at 2.8×, before fees6.1×');
});

test('the slider keeps its value inside the range while the caption follows the typed leverage', async () => {
  const { LeverageSplitRange } = await import('../src/components/LeverageSplit');
  const html = renderToStaticMarkup(React.createElement(LeverageSplitRange, {
    id: 'lever', label: 'Target leverage slider', side: 'long', debtLabel: 'minted fxUSD', value: 1.1, leverage: 0.5, min: 1.1, max: 6.1, captionId: 'split', onChange: () => undefined,
  }));
  assert.match(html, /value="1\.1"/);
  assert.match(html, /<span id="split" class="test-caption" data-empty="true"><\/span>/);
});

test('outside the live range, while typing, the caption keeps its slot but says nothing', async () => {
  const { LeverageSplitCaption } = await import('../src/components/LeverageSplit');
  for (const leverage of [0, 0.5, 1, 6.2, Number.NaN]) {
    const html = renderToStaticMarkup(React.createElement(LeverageSplitCaption, { id: 'split', side: 'long', debtLabel: 'minted fxUSD', leverage, min: 1.1, max: 6.1 }));
    assert.match(html, /^<span id="split" class="[^"]+" data-empty="true"><\/span>$/, `${leverage}×`);
  }
});
