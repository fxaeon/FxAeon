import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiPosition } from '../../src/app/trade/fxUi';
import { ProtocolPositionCard, ProtocolPositionDetails, ProtocolPositionList, ProtocolPositionSkeleton } from '../../src/components/ProtocolPositionCard';
import { PositionBrakeContext, type PositionBrakeStore } from '../../src/components/PositionBrakeContext';
import PositionBrakeProvider from '../../src/components/PositionBrakeProvider';
import { liveMarketStore } from '../../src/lib/liveMarketStore';

/**
 * Position cards with the real brake provider and reader. The spec sets
 * `__brakeConfig` before this bundle runs: which scenarios to show, the
 * theme, how the cards are wrapped, and the live quotes. Each scenario's
 * on-chain ratio is answered by the fake client below; "fail" makes that
 * position's read revert. Values come from mainnet at block 26,149,707.
 */
type Variant = 'article' | 'link' | 'button';
type Config = { theme?: 'official' | 'dark' | 'light'; scenarios?: string[]; variant?: Variant; quotes?: { ETH?: number; BTC?: number }; loading?: boolean; skeleton?: boolean; details?: string };
type Call = { address: string; functionName: string; args?: readonly unknown[] };

const config = ((globalThis as { __brakeConfig?: Config }).__brakeConfig ?? {}) as Config;
const E18 = 10n ** 18n;
const units = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * E18 + BigInt(fraction.padEnd(18, '0').slice(0, 18));
};
const POOLS: Record<string, string> = {
  'ETH:long': '0x6ecfa38fee8a5277b91efda204c235814f0122e8', 'BTC:long': '0xab709e26fa6b0a30c119d8c55b887ded24952473',
  'ETH:short': '0x25707b9e6690b52c60ae6744d711cf9c1dfc1876', 'BTC:short': '0xa0cc8162c523998856d59065faa254f87d20a5b0',
};
const ORACLES: Record<string, string> = {
  [POOLS['ETH:long']]: '0x0C5C61025f047cB7e3e85852dC8eAFd7b9a4Abfb', [POOLS['BTC:long']]: '0xb3c90e64EB6f456A5F5C17Aa99b6aecA6f4a6390',
  [POOLS['ETH:short']]: '0x222786833b5fd5eE21532d8b576391bAbeFdAAd1', [POOLS['BTC:short']]: '0x5d2c6215555B36889ef235c6d5cCDE22E9964e6a',
};
const ORACLE_PRICES: Record<string, readonly [bigint, bigint, bigint]> = {
  [ORACLES[POOLS['ETH:long']].toLowerCase()]: [2_444_585_858_023_510_186_210n, 2_444_578_396_940_640_991_110n, 2_448_287_872_868_744_829_475n],
  [ORACLES[POOLS['BTC:long']].toLowerCase()]: [81_354_963_409_200_000_000_000n, 81_204_939_755_279_203_492_225n, 81_531_938_834_473_843_665_688n],
  [ORACLES[POOLS['ETH:short']].toLowerCase()]: [328_340_809_079_147n, 327_844_330_473_433n, 328_341_811_206_135n],
  [ORACLES[POOLS['BTC:short']].toLowerCase()]: [12_291_813_038_747n, 12_265_132_097_866n, 12_314_521_789_113n],
};

type Scenario = { position: UiPosition; ratio: bigint | 'fail' };
const position = (market: 'ETH' | 'BTC', side: 'long' | 'short', positionId: number, colls: string, debts: string, leverage: number): UiPosition => ({
  market, side, info: {
    positionId, rawColls: units(colls), rawDebts: units(debts), currentLeverage: leverage, lsdLeverage: side === 'short' ? leverage - 1 : leverage,
    rawCollsToken: side === 'short' ? 'fxUSD' : market === 'ETH' ? 'ETH' : 'WBTC', rawDebtsToken: side === 'short' ? market === 'ETH' ? 'wstETH' : 'WBTC' : 'fxUSD',
    rawCollsDecimals: 18, rawDebtsDecimals: 18,
  },
});
const SCENARIOS: Record<string, Scenario> = {
  long: { position: position('ETH', 'long', 2033, '9.176999662367526796', '12712.585067464289054913', 2.31), ratio: 566_666_920_642_971_884n },
  short: { position: position('BTC', 'short', 109, '66118.199903649059291307', '0.62029145', 4.22), ratio: 763_235_966_667_704_764n },
  near: { position: position('ETH', 'long', 2029, '18.145839102274675694', '38423.378752384827483799', 7.47), ratio: 866_190_070_798_763_549n },
  rebalance: { position: position('ETH', 'long', 2034, '10', '22100', 9.62), ratio: 904_000_000_000_000_000n },
  failed: { position: position('BTC', 'long', 933, '0.264897488525629655', '14479.429472333263444561', 3.04), ratio: 'fail' },
  ethShort: { position: position('ETH', 'short', 174, '1295.590438343481988696', '0.259847242455099248', 2.57), ratio: 610_837_251_243_697_043n },
  // Short figures that fit one line at 320px, for comparing card heights.
  tidy: { position: position('ETH', 'long', 12, '2.5', '3100', 2.03), ratio: 507_243_000_000_000_000n },
};

const scenarioKeys = config.scenarios ?? ['long', 'short', 'near', 'rebalance', 'failed'];
const listeners = new Set<() => void>();
const calls: Call[][] = [];
let snapshot = {
  walletAddress: '0x930f0000000000000000000000000000000098b9',
  positions: scenarioKeys.map((key) => SCENARIOS[key].position),
  lastVerifiedAt: Date.now(),
  status: 'ready', failedGroups: [], refreshing: false, verifiedGroups: [], pendingPositions: [],
};
const ratios = new Map(scenarioKeys.map((key) => [`${POOLS[`${SCENARIOS[key].position.market}:${SCENARIOS[key].position.side}`]}:${SCENARIOS[key].position.info.positionId}`, SCENARIOS[key].ratio]));
// `loading` holds every read until the spec releases them all at once.
let holding = Boolean(config.loading);
const held: Array<() => void> = [];
let showCards = true;

function respond(call: Call): { status: 'success'; result: unknown } | { status: 'failure'; error: Error } {
  const pool = call.address.toLowerCase();
  if (call.functionName === 'getRebalanceRatios') return { status: 'success', result: [pool === POOLS['ETH:short'] || pool === POOLS['BTC:short'] ? 900n * E18 / 1000n : 880n * E18 / 1000n, 25_000_000n] };
  if (call.functionName === 'getLiquidateRatios') return { status: 'success', result: [950n * E18 / 1000n, 40_000_000n] };
  if (call.functionName === 'priceOracle') return { status: 'success', result: ORACLES[pool] };
  if (call.functionName === 'getPrice') return { status: 'success', result: ORACLE_PRICES[pool] };
  const ratio = ratios.get(`${pool}:${String(call.args?.[0])}`);
  return ratio === undefined || ratio === 'fail' ? { status: 'failure', error: new Error('execution reverted') } : { status: 'success', result: ratio };
}

function setQuote(market: 'ETH' | 'BTC', price: number) {
  const now = Date.now();
  liveMarketStore.acceptQuote({ market, productId: `${market}-USD`, price, open24h: price, high24h: price, low24h: price, percentChange24h: 0, sequence: now * 10 + (market === 'ETH' ? 1 : 2), sourceAt: now, receivedAt: now, source: 'coinbase' });
}

const harness = {
  calls,
  client: {
    multicall: async ({ contracts }: { contracts: Call[] }) => {
      calls.push(contracts.map(({ address, functionName, args }) => ({ address, functionName, args })));
      if (holding) await new Promise<void>((resolve) => { held.push(resolve); });
      return contracts.map(respond);
    },
  },
  prices: { ETH: 2_444.58, WETH: 2_444.58, stETH: 2_443.9, wstETH: 3_045.7, WBTC: 81_354.96, fxUSD: 1, USDC: 1, USDT: 1 },
  subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  snapshot: () => snapshot,
  /** A verified position refresh, as each new block brings. */
  refresh: () => { snapshot = { ...snapshot, lastVerifiedAt: Date.now() + 1 }; listeners.forEach((listener) => listener()); },
  setRatio: (key: string, ratio: string | 'fail') => {
    const { position: item } = SCENARIOS[key];
    ratios.set(`${POOLS[`${item.market}:${item.side}`]}:${item.info.positionId}`, ratio === 'fail' ? 'fail' : BigInt(ratio));
  },
  setQuote,
  release: () => { holding = false; held.splice(0).forEach((resolve) => resolve()); },
  setCardsShown: (shown: boolean) => { showCards = shown; listeners.forEach((listener) => listener()); },
};
(globalThis as { __brakeHarness?: typeof harness }).__brakeHarness = harness;

const theme = 'dark';
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = 'dark';
liveMarketStore.setStatus('live');
for (const [market, price] of Object.entries(config.quotes ?? {}) as Array<['ETH' | 'BTC', number]>) setQuote(market, price);

const loadingStore: PositionBrakeStore = { entries: new Map(), register: () => () => undefined };

function Cards() {
  const shown = useSyncExternalStore(harness.subscribe, () => showCards, () => showCards);
  const variant = config.variant ?? 'article';
  return <main style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, maxWidth: 680, margin: '0 auto' }}>
    {config.skeleton && <section data-scenario="skeleton"><ProtocolPositionSkeleton /></section>}
    {config.skeleton && <section data-scenario="loading"><PositionBrakeContext.Provider value={loadingStore}><ProtocolPositionCard position={SCENARIOS[scenarioKeys[0]].position} /></PositionBrakeContext.Provider></section>}
    {config.details && <section data-scenario="details"><ProtocolPositionDetails position={SCENARIOS[config.details].position} headingId="details-heading" /></section>}
    {/* Rows sit in a ruled list, as every page lists them. */}
    {shown && <ProtocolPositionList label="Positions">
      {scenarioKeys.map((key) => <section key={key} data-scenario={key}>
        <ProtocolPositionCard position={SCENARIOS[key].position}
          {...(variant === 'link' ? { href: `/positions?position=${key}` } : variant === 'button' ? { onSelect: () => undefined } : {})} />
      </section>)}
    </ProtocolPositionList>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<PositionBrakeProvider><Cards /></PositionBrakeProvider>);
document.documentElement.dataset.harnessReady = 'true';
