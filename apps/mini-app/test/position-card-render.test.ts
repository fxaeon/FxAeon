import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UiPosition } from '../src/app/trade/fxUi';
import type { PositionBrakeEntry, PositionBrakeStore } from '../src/components/PositionBrakeContext';
import type { PositionCostBasisEntry, PositionCostBasisStore } from '../src/components/PositionCostBasisContext';

// Several legacy JSX-only leaf components are transformed for Next's browser
// bundle and expect a global React binding under this CJS smoke-test runner.
// Keep the compatibility shim isolated to this test process.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const cardStylesPaths = new Set(['ProtocolPositionCard.module.css', 'InfoHelp.module.css']
  .map((path) => fileURLToPath(new URL(`../src/components/${path}`, import.meta.url)).toLowerCase()));

/** Render with the real card module, exposing its CSS module class names under SSR. */
async function withCardModule<T>(run: (modules: {
  card: typeof import('../src/components/ProtocolPositionCard');
  brake: typeof import('../src/components/PositionBrakeContext');
  costBasis: typeof import('../src/components/PositionCostBasisContext');
}) => T | Promise<T>): Promise<T> {
  const previousCssLoader = testRequire.extensions['.css'];
  try {
    // tsx runs this focused source test through CommonJS; teach only that
    // loader how to expose the card's CSS module class names during SSR.
    testRequire.extensions['.css'] = (loadedModule, filename) => {
      if (!cardStylesPaths.has(filename.toLowerCase())) {
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
      costBasis: await import('../src/components/PositionCostBasisContext'),
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

function factValue(html: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = html.match(new RegExp(`<div class="test-fact"><dt>${escapedLabel}</dt><dd>([\\s\\S]*?)</dd></div>`));
  assert.ok(row, `${label} is listed`);
  return row[1].split('<small')[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
    assert.equal(factValue(details, 'Collateral'), '1 stETH');
    assert.equal(factValue(details, 'Debt'), '0.5 fxUSD');
    assert.match(details, /<dt>Market price<\/dt>/);
    assert.match(details, /<dt>Debt \/ collateral<\/dt>/);
    // Entry price and estimated PnL sit in the same list, their assumptions behind info controls.
    assert.equal((details.match(/<div class="test-fact"/g) ?? []).length, 6);
    assert.match(details, /Entry price<\/span><button[^>]*aria-label="About Entry price"/);
    assert.match(details, /Est\. PnL<\/span><button[^>]*aria-label="About Est\. PnL"/);
    // Without its index read neither figure is guessed.
    assert.match(details, /aria-label="Entry price unavailable"/);
    assert.match(details, /aria-label="Estimated PnL unavailable"/);
    assert.doesNotMatch(details, /test-metric|test-tile/);

    const zeroHtml = renderToStaticMarkup(React.createElement(ProtocolPositionDetails, {
      position: { ...ethLong, info: { ...ethLong.info, positionId: 43, rawColls: 0n, rawDebts: 0n } },
    }));
    assert.ok((zeroHtml.match(/\$0\.00/g) ?? []).length >= 3, 'known zero balances stay visible as $0.00');
  });
});

test('compact management keeps risk visible and position facts in a clear details disclosure', async () => {
  await withCardModule(({ card: { ProtocolPositionDetails }, brake: { PositionBrakeContext } }) => {
    const html = renderToStaticMarkup(React.createElement(PositionBrakeContext.Provider, {
      value: brakeStore({ 'ETH:long:42': readyEntry(ethLong, 90n * E18 / 100n) }),
    }, React.createElement(ProtocolPositionDetails, { position: ethLong, compact: true })));
    const primary = html.split('<details')[0];
    assert.match(primary, /At the rebalance point/);
    assert.doesNotMatch(primary, /<dt>Collateral|<dt>Debt|<dt>Market price/);
    assert.match(html, /<details class="test-metricDisclosure"><summary title="View position details"><span>Position details/);
    assert.equal(factValue(html, 'Collateral'), '1 stETH');
    assert.equal(factValue(html, 'Debt'), '0.5 fxUSD');
    assert.match(html, /<dt>Market price/);
    assert.match(html, /<dt>Debt \/ collateral/);
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
      assert.equal(factValue(details, 'Collateral'), collateral, `${market} ${side} collateral`);
      assert.equal(factValue(details, 'Debt'), debt, `${market} ${side} debt`);
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

test('without a live quote the thresholds name the pool’s own price per stETH or WBTC, not a dash', async () => {
  await withCardModule(({ card: { ProtocolPositionCard, ProtocolPositionDetails }, brake: { PositionBrakeContext } }) => {
    const entry = readyEntry(ethLong, 66n * E18 / 100n, undefined, null);
    entry.record!.reading.poolPrices = { rebalance: 1_575, liquidate: 1_459 };
    const store = brakeStore({ 'ETH:long:42': entry });
    // (The overview row is covered with ready prices in position-presentation-render.)
    for (const component of [
      React.createElement(ProtocolPositionCard, { position: ethLong }),
      React.createElement(ProtocolPositionDetails, { position: ethLong }),
    ]) {
      const html = renderToStaticMarkup(React.createElement(PositionBrakeContext.Provider, { value: store }, component));
      assert.match(html, /data-position-price="rebalance">≈\u00a0\$1,575 \/ stETH</);
      assert.match(html, /data-position-price="liquidation">≈\u00a0\$1,459 \/ stETH</);
      assert.doesNotMatch(html, /aria-hidden="true">—</);
    }
    // Without either price the dash stays, with its words for screen readers.
    const unknown = renderToStaticMarkup(React.createElement(PositionBrakeContext.Provider, { value: brakeStore({ 'ETH:long:42': readyEntry(ethLong, 66n * E18 / 100n, undefined, null) }) },
      React.createElement(ProtocolPositionCard, { position: ethLong })));
    assert.match(unknown, /<span aria-hidden="true">—<\/span><span class="sr-only">Estimated rebalance price unavailable<\/span>/);
  });
});

const PRICE = { priceWad: 2_600n * E18, rateWad: 12n * E18 / 10n, readAt: Date.now() };
function costBasisStore(entries: Record<string, PositionCostBasisEntry>, prices: PositionCostBasisStore['prices'] = { ETH: { price: PRICE, pending: false, failures: 0, readAt: PRICE.readAt } }): PositionCostBasisStore {
  return { entries: new Map(Object.entries(entries)), prices, register: () => () => undefined };
}
/** An index record of ethLong at its on-chain amounts, with an entry of 2,500 per stETH. */
function costBasisEntry(position: UiPosition, overrides: Partial<PositionCostBasisEntry> = {}, colls = position.info.rawColls): PositionCostBasisEntry {
  return {
    record: {
      history: { market: position.market, side: position.side, positionId: position.info.positionId, block: 1n, colls, debts: position.info.rawDebts, targetLeverage: '2', isClosed: false, orders: [] },
      entryWad: 2_500n * E18,
    },
    pending: false, failures: 0, behind: 0, readAt: Date.now(), ...overrides,
  };
}
const costFact = (html: string, kind: 'entry' | 'pnl') => {
  const cell = html.match(new RegExp(`data-position-cost-basis="${kind}"[^>]*>([\\s\\S]*?)</(?:dd|span)>(?:</span>)?`));
  assert.ok(cell, `${kind} is shown`);
  return cell[0];
};
const text = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('a position shows its entry price and estimated PnL once the index matches the chain', async () => {
  await withCardModule(({ card: { ProtocolPositionCard, ProtocolPositionDetails }, costBasis: { PositionCostBasisContext, COST_BASIS_BEHIND_LIMIT } }) => {
    const render = (store: PositionCostBasisStore, component: React.ReactElement) => renderToStaticMarkup(React.createElement(PositionCostBasisContext.Provider, { value: store }, component));
    const details = (store: PositionCostBasisStore) => render(store, React.createElement(ProtocolPositionDetails, { position: ethLong }));
    const ready = costBasisStore({ 'ETH:long:42': costBasisEntry(ethLong) });

    // 1 stETH bought at 2,500 and priced at the 2,600 mid: +$100, and +4% × 2 target leverage.
    const html = details(ready);
    assert.match(text(costFact(html, 'entry')), /≈ \$2,500\.00 \/ stETH/);
    assert.match(text(costFact(html, 'pnl')), /≈ \+\$100\.00 \(\+8\.00%\) at ≈ \$2,600\.00 \/ stETH/);
    // Its assumptions name what it leaves out.
    assert.match(html, /aria-label="About Est\. PnL"/);
    // A compact row keeps to its value and brake; the figures belong to the details.
    assert.doesNotMatch(render(ready, React.createElement(ProtocolPositionCard, { position: ethLong })), /PnL|Entry price/);
    // A short's figures move the other way.
    const short: UiPosition = { ...ethLong, side: 'short', info: { ...ethLong.info, rawCollsToken: 'fxUSD', rawDebtsToken: 'wstETH' } };
    const shortHtml = render(costBasisStore({ 'ETH:short:42': costBasisEntry(short) }), React.createElement(ProtocolPositionDetails, { position: short }));
    // 0.5 wstETH of debt is 0.6 stETH: (2,600 − 2,500) × −0.6 = −$60.
    assert.match(text(costFact(shortHtml, 'pnl')), /≈ −\$60\.00 \(−8\.00%\)/);

    // While its first read runs, both hold their place.
    for (const pending of [costBasisStore({}), costBasisStore({ 'ETH:long:42': { record: null, pending: true, failures: 0, behind: 0, readAt: 0 } })]) {
      const loading = details(pending);
      assert.match(loading, /aria-label="Loading entry price"/);
      assert.match(loading, /aria-label="Loading estimated PnL"/);
    }
    // An index behind the chain never prices a figure: it waits, then says unavailable.
    const behind = (count: number) => details(costBasisStore({ 'ETH:long:42': costBasisEntry(ethLong, { behind: count }, ethLong.info.rawColls - 10n ** 10n) }));
    assert.match(behind(1), /aria-label="Loading entry price"/);
    assert.match(behind(COST_BASIS_BEHIND_LIMIT), /aria-label="Entry price unavailable"/);
    for (const count of [1, COST_BASIS_BEHIND_LIMIT]) assert.doesNotMatch(behind(count), /\$2,500|\$100\.00/);
    // A failed read, or orders that give no entry, show nothing.
    assert.match(details(costBasisStore({ 'ETH:long:42': { record: null, pending: false, failures: 1, behind: 0, readAt: Date.now() } })), /aria-label="Entry price unavailable"/);
    const noEntry = costBasisEntry(ethLong);
    noEntry.record!.entryWad = null;
    assert.match(details(costBasisStore({ 'ETH:long:42': noEntry })), /aria-label="Estimated PnL unavailable"/);

    // The entry stands without a current mid price; the PnL waits for one or says it is unavailable.
    const noPrice = details(costBasisStore({ 'ETH:long:42': costBasisEntry(ethLong) }, {}));
    assert.match(text(costFact(noPrice, 'entry')), /≈ \$2,500\.00 \/ stETH/);
    assert.match(noPrice, /aria-label="Loading estimated PnL"/);
    const old = { price: { ...PRICE, readAt: Date.now() - 121_000 }, pending: false, failures: 2, readAt: Date.now() };
    assert.match(details(costBasisStore({ 'ETH:long:42': costBasisEntry(ethLong) }, { ETH: old })), /aria-label="Estimated PnL unavailable"/);
    // A position without collateral or debt has neither.
    const empty = { ...ethLong, info: { ...ethLong.info, rawColls: 0n, rawDebts: 0n } };
    assert.doesNotMatch(render(ready, React.createElement(ProtocolPositionDetails, { position: empty })), /Entry price|Est\. PnL/);
  });
});
