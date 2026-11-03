import React from 'react';
import { createRoot } from 'react-dom/client';
import PositionsPage from '@/app/positions/page';
import { liveMarketStore } from '@/lib/liveMarketStore';

/**
 * The real Positions page, rows, details, form and review shell against
 * inline mocks (see e2e/positions-harness/positions-screens.spec.ts). The
 * spec sets `__positionsScreensConfig` before this bundle runs: the theme and
 * which positions are open. Values come from mainnet at block 26,149,707.
 */
type Config = { theme?: 'official' | 'dark' | 'light'; positions?: string[] };
const config = ((globalThis as { __positionsScreensConfig?: Config }).__positionsScreensConfig ?? {}) as Config;
const account = '0x930f0000000000000000000000000000000098b9';
const E18 = 10n ** 18n;
const units = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * E18 + BigInt(fraction.padEnd(18, '0').slice(0, 18));
};
const position = (market: 'ETH' | 'BTC', side: 'long' | 'short', positionId: number, colls: string, debts: string, leverage: number) => ({
  market, side, info: {
    positionId, rawColls: units(colls), rawDebts: units(debts), currentLeverage: leverage, lsdLeverage: side === 'short' ? leverage - 1 : leverage,
    rawCollsToken: side === 'short' ? 'fxUSD' : market === 'ETH' ? 'ETH' : 'WBTC', rawDebtsToken: side === 'short' ? market === 'ETH' ? 'wstETH' : 'WBTC' : 'fxUSD',
    rawCollsDecimals: 18, rawDebtsDecimals: 18,
  },
});
const reading = (side: 'long' | 'short', debtRatio: bigint, priceAtRead: number) => ({
  side, debtRatio, rebalanceRatio: (side === 'long' ? 880n : 900n) * E18 / 1000n, liquidateRatio: 950n * E18 / 1000n, priceAtRead,
});
const FIXTURES = {
  long: { position: position('ETH', 'long', 2033, '9.176999662367526796', '12712.585067464289054913', 2.31), brake: reading('long', 566_668_650_163_636_650n, 2_444.58) },
  short: { position: position('BTC', 'short', 109, '66118.199903649059291307', '0.62029145', 4.22), brake: reading('short', 764_896_271_142_408_058n, 81_354.96) },
  rebalance: { position: position('ETH', 'long', 2034, '10', '22100', 9.62), brake: reading('long', 904_002_759_092_906_243n, 2_444.58) },
  ethShort: { position: position('ETH', 'short', 174, '1295.590438343481988696', '0.259847242455099248', 2.57), brake: reading('short', 611_762_286_690_787_743n, 2_444.58) },
  btcLong: { position: position('BTC', 'long', 933, '0.264897488525629655', '14479.429472333263444561', 3.04), brake: reading('long', 673_118_000_000_000_000n, 81_354.96) },
} as const;
const keys = (config.positions ?? ['long', 'short', 'rebalance', 'ethShort']) as Array<keyof typeof FIXTURES>;
const positions = keys.map((key) => FIXTURES[key].position);
/** Each position's entry price and PnL at a DEX mid price, as the cost-basis provider would resolve them. */
const ready = (entry: string, mid: string, usdCents: bigint, percentBps: bigint) => ({ status: 'ready', entryWad: units(entry), pnl: { usdCents, percentBps }, pnlStatus: 'ready', priceWad: units(mid) });
const COST_BASIS: Record<string, unknown> = {
  'ETH:long:2033': ready('2361.2385', '2311.88', -45_296n, -573n),
  'BTC:short:109': ready('80120.40', '81354.96', -76_579n, -650n),
  'ETH:long:2034': { status: 'loading' },
  'ETH:short:174': ready('2473.3921', '2311.88', 5_229n, 725n),
  'BTC:long:933': { status: 'unavailable' },
};

declare global {
  var __positionsScreens: {
    wallet: { ready: boolean; authenticated: boolean; address: string; chainId: number; connectionVersion: number; isEmbedded: boolean };
    shared: Record<string, unknown>;
    brakes: Record<string, unknown>;
    costBasis: Record<string, unknown>;
    prices: Record<string, number>;
    walletRequests: number;
    rerender?: () => void;
  };
}

globalThis.__positionsScreens = {
  wallet: { ready: true, authenticated: true, address: account, chainId: 1, connectionVersion: 1, isEmbedded: true },
  shared: {
    walletAddress: account, positions, pendingPositions: [], status: 'ready', failedGroups: [], verifiedGroups: [],
    lastVerifiedAt: Date.now(), refreshing: false, refresh: async () => ({ positions }),
    reconcileClosedPosition: async () => true, trackConfirmedPosition: async () => true, checkingConfirmedPositions: false,
  },
  brakes: Object.fromEntries(keys.map((key) => {
    const { position: item, brake } = FIXTURES[key];
    return [`${item.market}:${item.side}:${item.info.positionId}`, brake];
  })),
  costBasis: COST_BASIS,
  prices: { ETH: 2_444.58, WETH: 2_444.58, stETH: 2_443.9, wstETH: 3_045.7, WBTC: 81_354.96, fxUSD: 1, USDC: 1, USDT: 1 },
  walletRequests: 0,
};

const theme = 'dark';
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = 'dark';
liveMarketStore.setStatus('live');
for (const [market, price] of [['ETH', 2_444.58], ['BTC', 81_354.96]] as const) {
  const now = Date.now();
  liveMarketStore.acceptQuote({ market, productId: `${market}-USD`, price, open24h: price, high24h: price, low24h: price, percentChange24h: 0, sequence: now, sourceAt: now, receivedAt: now, source: 'coinbase' });
}

function HarnessRoot() {
  const [, forceRender] = React.useState(0);
  globalThis.__positionsScreens.rerender = () => forceRender((value) => value + 1);
  return <PositionsPage />;
}
createRoot(document.getElementById('root')!).render(<HarnessRoot />);
document.documentElement.dataset.harnessReady = 'true';
