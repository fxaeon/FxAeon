import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UiPosition } from '../src/app/trade/fxUi';
import type { PositionBrakeEntry, PositionBrakeStore } from '../src/components/PositionBrakeContext';

// Several legacy JSX-only leaf components are transformed for Next's browser
// bundle and expect a global React binding under this CJS smoke-test runner.
// Keep the compatibility shim isolated to this test process.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const positionCardStylesPath = fileURLToPath(new URL('../src/components/ProtocolPositionCard.module.css', import.meta.url));

/** Render with the real card module, exposing its CSS module class names under SSR. */
async function withCardModule<T>(run: (modules: {
  card: typeof import('../src/components/ProtocolPositionCard');
  brake: typeof import('../src/components/PositionBrakeContext');
}) => T | Promise<T>): Promise<T> {
  const previousCssLoader = testRequire.extensions['.css'];
  try {
    // tsx runs this focused source test through CommonJS; teach only that
    // loader how to expose this CSS module's class names during SSR.
    testRequire.extensions['.css'] = (loadedModule, filename) => {
      if (filename.toLowerCase() !== positionCardStylesPath.toLowerCase()) {
        if (previousCssLoader) return previousCssLoader(loadedModule, filename);
        throw new Error(`Unexpected CSS import in position card render test: ${filename}`);
      }

      const source = readFileSync(filename, 'utf8');
      const classNames = [...source.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
      loadedModule.exports = Object.fromEntries([...new Set(classNames)].map((name) => [name, `test-${name}`]));
    };
    return await run({
      card: await import('../src/components/ProtocolPositionCard'),
      brake: await import('../src/components/PositionBrakeContext'),
    });
  } finally {
    if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
    else delete testRequire.extensions['.css'];
  }
}

test.after(() => {
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

const E18 = 10n ** 18n;
// The SDK's own symbols: fx-sdk 1.0.5 names the wstETH long pool's
// collateral "ETH", though the pool accounts it in stETH.
const ethLong: UiPosition = {
  market: 'ETH',
  side: 'long',
  info: {
    positionId: 42,
    rawColls: E18,
    rawDebts: 5n * 10n ** 17n,
    currentLeverage: 2,
    lsdLeverage: 2,
    rawCollsToken: 'ETH',
    rawDebtsToken: 'fxUSD',
    rawCollsDecimals: 18,
    rawDebtsDecimals: 18,
  },
};
const btcShort: UiPosition = {
  market: 'BTC',
  side: 'short',
  info: { ...ethLong.info, positionId: 7, rawCollsToken: 'fxUSD', rawDebtsToken: 'WBTC', currentLeverage: 1.5, lsdLeverage: 0.5 },
};

function brakeStore(entries: Record<string, PositionBrakeEntry>): PositionBrakeStore {
  return { entries: new Map(Object.entries(entries)), register: () => () => undefined };
}

function readyEntry(position: UiPosition, debtRatio: bigint, thresholds = { rebalanceRatio: 88n * E18 / 100n, liquidateRatio: 95n * E18 / 100n }, priceAtRead: number | null = 2_400): PositionBrakeEntry {
  return {
    record: {
      reading: { side: position.side, debtRatio, ...thresholds, priceAtRead },
      readAt: Date.now(),
      rawColls: position.info.rawColls,
      rawDebts: position.info.rawDebts,
    },
    pending: false,
    failed: false,
  };
}

test('a position row leads with identity and value; its details keep every figure and raw unit', async () => {
  await withCardModule(({ card: { ProtocolPositionCard, ProtocolPositionDetails } }) => {
    const html = renderToStaticMarkup(React.createElement(ProtocolPositionCard, { position: ethLong }));

    assert.match(html, /<article class="test-row" data-position-key="ETH:long:42">/);
    assert.match(html, /Position value/);
    assert.match(html, /aria-label="Loading value"/);
    assert.match(html, /<strong>2×<\/strong> leverage<span aria-hidden="true">·<\/span>#42/);
    assert.doesNotMatch(html, /title="—"|Value loading|Price delayed|USD unavailable/);
    // The row is compact: its four figures live in the position's details.
    assert.doesNotMatch(html, /Market price|Debt \/ collateral|stETH/);
    // The side is a word in its own color, not a pill.
    assert.match(html, /<span class="test-side test-long">Long<\/span>/);
    assert.match(renderToStaticMarkup(React.createElement(ProtocolPositionCard, { position: btcShort })), /<span class="test-side test-short">Short<\/span>/);
    // Without a brake read there is no line, no marker, and no zero.
    assert.doesNotMatch(html, /Rebalances|rebalance point|data-brake-marker/);

    const details = renderToStaticMarkup(React.createElement(ProtocolPositionDetails, { position: ethLong, headingId: 'manage-position-heading' }));
    assert.match(details, /<section class="test-details " data-position-details="ETH:long:42" aria-labelledby="manage-position-heading">/);
    assert.match(details, /<h2 id="manage-position-heading" class="sr-only">ETH Long · #42<\/h2>/);
    // An ETH long's collateral is the pool's stETH accounting, named as such.
    for (const [label, value] of [['Collateral', '1 stETH<small>'], ['Debt', '0.5 fxUSD<small>'], ['Market price', ''], ['Debt / collateral', '']]) {
      assert.match(details, new RegExp(`<dt>${label.replace('/', '\\/')}</dt><dd>${value}`), `${label} is listed`);
    }
    assert.equal((details.match(/<div class="test-fact"/g) ?? []).length, 4);
    assert.doesNotMatch(details, /test-metric|test-tile/);

    const zeroHtml = renderToStaticMarkup(React.createElement(ProtocolPositionDetails, {
      position: { ...ethLong, info: { ...ethLong.info, positionId: 43, rawColls: 0n, rawDebts: 0n } },
    }));
    assert.ok((zeroHtml.match(/\$0\.00/g) ?? []).length >= 3, 'known zero balances stay visible as $0.00');
  });
});

test('compact management keeps balances and risk outside its closed secondary-metric disclosure', async () => {
  await withCardModule(({ card: { ProtocolPositionDetails }, brake: { PositionBrakeContext } }) => {
    const html = renderToStaticMarkup(React.createElement(PositionBrakeContext.Provider, {
      value: brakeStore({ 'ETH:long:42': readyEntry(ethLong, 90n * E18 / 100n) }),
    }, React.createElement(ProtocolPositionDetails, { position: ethLong, compact: true })));
    const primary = html.split('<details')[0];
    assert.match(primary, /<dt>Collateral<\/dt><dd>1 stETH/);
    assert.match(primary, /<dt>Debt<\/dt><dd>0\.5 fxUSD/);
    assert.match(primary, /At the rebalance point/);
    assert.doesNotMatch(primary, /<dt>Market price|<dt>Debt \/ collateral/);
    assert.match(html, /<details class="test-metricDisclosure"><summary>Position details/);
    assert.match(html, /<dt>Market price/);
    assert.match(html, /<dt>Debt \/ collateral/);
    assert.match(html, /<dt>Collateral value/);
    assert.match(html, /<dt>Debt value/);
  });
});

test('every pool names its collateral and debt units in the details the way its review does', async () => {
  await withCardModule(({ card: { ProtocolPositionDetails } }) => {
    const symbols = { ETH: { long: ['ETH', 'fxUSD'], short: ['fxUSD', 'wstETH'] }, BTC: { long: ['WBTC', 'fxUSD'], short: ['fxUSD', 'WBTC'] } } as const;
    for (const [market, side, collateral, debt] of [
      ['ETH', 'long', '1 stETH', '0.5 fxUSD'],
      ['ETH', 'short', '1 fxUSD', '0.5 wstETH'],
      ['BTC', 'long', '1 WBTC', '0.5 fxUSD'],
      ['BTC', 'short', '1 fxUSD', '0.5 WBTC'],
    ] as const) {
      const [rawCollsToken, rawDebtsToken] = symbols[market][side];
      const details = renderToStaticMarkup(React.createElement(ProtocolPositionDetails, {
        position: { market, side, info: { ...ethLong.info, rawCollsToken, rawDebtsToken } },
      }));
      assert.match(details, new RegExp(`<dt>Collateral</dt><dd>${collateral}<small>`), `${market} ${side} collateral`);
      assert.match(details, new RegExp(`<dt>Debt</dt><dd>${debt}<small>`), `${market} ${side} debt`);
    }
  });
});

test('positions list as a ruled stack of rows that open their position', async () => {
  await withCardModule(({ card: { ProtocolPositionCard, ProtocolPositionList } }) => {
    const html = renderToStaticMarkup(React.createElement(ProtocolPositionList, { label: 'Open positions' },
      React.createElement(ProtocolPositionCard, { key: 'a', position: ethLong, onSelect: () => undefined, selected: true }),
      React.createElement(ProtocolPositionCard, { key: 'b', position: btcShort, href: '/positions?position=BTC%3Ashort%3A7' })));
    assert.match(html, /<div role="list" aria-label="Open positions" class="test-list ">/);
    assert.equal((html.match(/<div role="listitem" class="test-listItem">/g) ?? []).length, 2);
    assert.match(html, /<button type="button" class="test-row test-interactive test-selected" aria-current="true" data-position-key="ETH:long:42">/);
    assert.match(html, /<a class="test-row test-interactive" data-position-key="BTC:short:7" href="\/positions\?position=BTC%3Ashort%3A7">/);
    assert.equal((html.match(/test-navigateIcon/g) ?? []).length, 2, 'a row that opens its position says so');
  });
});

test('a current brake read draws the marker and the plain line, with liquidation for screen readers', async () => {
  await withCardModule(({ card: { ProtocolPositionCard }, brake: { PositionBrakeContext } }) => {
    const render = (position: UiPosition, entry: PositionBrakeEntry, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: brakeStore({ [`${position.market}:${position.side}:${position.info.positionId}`]: entry }) },
      React.createElement(ProtocolPositionCard, { position, ...props }),
    ));

    const long = render(ethLong, readyEntry(ethLong, 66n * E18 / 100n));
    assert.match(long, /data-position-split="true"[^>]*data-brake="clear"/);
    assert.match(long, /--debt-share:0\.66/);
    assert.match(long, /--rebalance-at:0\.88/);
    assert.match(long, /--liquidate-at:0\.95/);
    assert.match(long, /data-brake-marker="rebalance"/);
    assert.match(long, /data-brake-marker="liquidation"/);
    assert.match(long, /data-position-brake="clear"[^>]*><span>Rebalances if ETH falls ≈\u00a025% \(≈\u00a0\$1,800\)<span class="sr-only"> If rebalancing can’t keep up, liquidation becomes possible once ETH falls ≈\u00a030% \(≈\u00a0\$1,668\)\.<\/span><\/span>/);
    // The bar stays decorative; its words are in the line.
    assert.match(long, /<span class="test-split" aria-hidden="true"/);

    const short = render(btcShort, readyEntry(btcShort, 75n * E18 / 100n, { rebalanceRatio: 90n * E18 / 100n, liquidateRatio: 95n * E18 / 100n }, 81_354.96));
    assert.match(short, /Rebalances if BTC rises ≈\u00a020% \(≈\u00a0\$97,625\)/);

    const noQuote = render(ethLong, readyEntry(ethLong, 66n * E18 / 100n, undefined, null));
    assert.match(noQuote, /Rebalances if ETH falls ≈\u00a025%<span class="sr-only">/);
  });
});

test('reads in flight reserve the line, and failed or stale reads leave the plain split', async () => {
  await withCardModule(({ card: { ProtocolPositionCard }, brake: { PositionBrakeContext, POSITION_BRAKE_MAX_AGE_MS } }) => {
    const render = (store: PositionBrakeStore, position: UiPosition = ethLong) => renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: store },
      React.createElement(ProtocolPositionCard, { position }),
    ));
    const key = 'ETH:long:42';
    const loading = render(brakeStore({}));
    assert.match(loading, /role="status" aria-label="Loading rebalance point"/);
    assert.match(render(brakeStore({ [key]: { record: null, pending: true, failed: false } })), /Loading rebalance point/);

    const failed = render(brakeStore({ [key]: { record: null, pending: false, failed: true } }));
    assert.doesNotMatch(failed, /Loading rebalance point|Rebalances|data-brake-marker|data-brake=/);

    const stale = readyEntry(ethLong, 66n * E18 / 100n);
    stale.record!.readAt -= POSITION_BRAKE_MAX_AGE_MS + 1;
    assert.doesNotMatch(render(brakeStore({ [key]: { ...stale, failed: true } })), /Rebalances|data-brake-marker/);
    // A read for other amounts is not shown for this position.
    const changed = { ...ethLong, info: { ...ethLong.info, rawDebts: 6n * 10n ** 17n } };
    assert.doesNotMatch(render(brakeStore({ [key]: { ...readyEntry(ethLong, 66n * E18 / 100n), failed: true } }), changed), /Rebalances|data-brake-marker/);
    // A position without debt has nothing to brake.
    const noDebt = { ...ethLong, info: { ...ethLong.info, rawDebts: 0n } };
    assert.doesNotMatch(render(brakeStore({})), /Rebalances/);
    assert.doesNotMatch(render(brakeStore({}), noDebt), /Loading rebalance point|Rebalances/);
  });
});

test('at the brake the card warns in plain words and links the f(x) docs where a link may sit', async () => {
  await withCardModule(({ card: { ProtocolPositionCard }, brake: { PositionBrakeContext } }) => {
    const store = brakeStore({ 'ETH:long:42': readyEntry(ethLong, 90n * E18 / 100n) });
    const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: store },
      React.createElement(ProtocolPositionCard, { position: ethLong, ...props }),
    ));
    const article = render();
    assert.match(article, /data-brake="rebalance"/);
    assert.match(article, /data-tone="warn" data-position-brake="rebalance"/);
    assert.match(article, /At the rebalance point\. The protocol may rebalance part of this position\./);
    assert.match(article, /<a href="https:\/\/fxprotocol\.gitbook\.io\/fx-docs\/f-x-protocol-mechanisms\/rebalancing-the-position-liquidation-brake" target="_blank" rel="noopener noreferrer">How rebalancing works/);

    for (const props of [{ href: '/positions?position=ETH%3Along%3A42' }, { onSelect: () => undefined }]) {
      const interactive = render(props);
      assert.match(interactive, /At the rebalance point/);
      assert.match(interactive, /title="How rebalancing works: https:\/\/fxprotocol\.gitbook\.io/);
      // No link inside a card that is itself a link or a button.
      assert.equal((interactive.match(/<a /g) ?? []).length, 'href' in props ? 1 : 0);
    }

    const liquidation = renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: brakeStore({ 'ETH:long:42': readyEntry(ethLong, 96n * E18 / 100n) }) },
      React.createElement(ProtocolPositionCard, { position: ethLong }),
    ));
    assert.match(liquidation, /At the liquidation point\. The protocol may liquidate this position\./);
    assert.match(liquidation, /rebalancing-the-position-liquidation-brake\/liquidation-process/);
  });
});

test('the loading card reserves the brake line', async () => {
  await withCardModule(({ card: { ProtocolPositionSkeleton } }) => {
    const html = renderToStaticMarkup(React.createElement(ProtocolPositionSkeleton));
    assert.match(html, /<span class="test-brake"><span aria-hidden="true" class="skeleton test-brakeSkeleton"><\/span><\/span>/);
  });
});
