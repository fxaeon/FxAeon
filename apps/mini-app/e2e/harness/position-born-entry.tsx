import React from 'react';
import { createRoot } from 'react-dom/client';
import TradePage from '@/app/trade/page';
import PositionsPage from '@/app/positions/page';
import { liveMarketStore } from '@/lib/liveMarketStore';
import { positionPoolAddress } from '@/lib/fx/policy';

/**
 * Trade's confirmed result for either a newly opened ETH Long (#4242) or a
 * closed ETH Long, then the real Positions page behind a stand-in for Next's
 * router: push() writes the URL at once and renders the next page a little
 * later, as the app router does.
 * The spec (e2e/positions-harness/position-born.spec.ts) sets
 * `__positionBornConfig` before this bundle runs: the theme, whether the chain
 * has returned the new position yet, and the router's delay.
 */
type Config = { theme?: 'official' | 'dark' | 'light'; readable?: boolean; navigationDelayMs?: number; closedPosition?: boolean };
const config = ((globalThis as { __positionBornConfig?: Config }).__positionBornConfig ?? {}) as Config;
const account = '0x930f0000000000000000000000000000000098b9';
const E18 = 10n ** 18n;
const units = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * E18 + BigInt(fraction.padEnd(18, '0').slice(0, 18));
};
const ETH_PRICE = 2_444.58;
const NEW_ID = 4242;

// Opened at a 2.8× target (the ticket drew 64% debt); the chain read after
// fees says 62.9%. The row must draw the read, never the target.
const born = {
  market: 'ETH' as const, side: 'long' as const,
  info: {
    positionId: NEW_ID, rawColls: units('1.4'), rawDebts: units('2152.4'), currentLeverage: 2.69, lsdLeverage: 2.69,
    rawCollsToken: 'ETH', rawDebtsToken: 'fxUSD', rawCollsDecimals: 18, rawDebtsDecimals: 18,
  },
};
const existing = {
  market: 'ETH' as const, side: 'long' as const,
  info: {
    positionId: 2033, rawColls: units('9.176999662367526796'), rawDebts: units('12712.585067464289054913'), currentLeverage: 2.31, lsdLeverage: 2.31,
    rawCollsToken: 'ETH', rawDebtsToken: 'fxUSD', rawCollsDecimals: 18, rawDebtsDecimals: 18,
  },
};
const reading = (debtRatio: bigint) => ({ side: 'long' as const, debtRatio, rebalanceRatio: 880n * E18 / 1000n, liquidateRatio: 950n * E18 / 1000n, priceAtRead: ETH_PRICE });

const hash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
const hint = {
  version: 1, chainId: 1, operation: 'increasePosition', walletAddress: account, market: 'ETH', side: 'long',
  poolAddress: positionPoolAddress('ETH', 'long'), positionId: NEW_ID, transactionHash: hash, blockNumber: '24000000', blockHash,
};
const action = {
  chainId: 1, from: account, to: router, data: '0x12345678', value: 500_000_000_000_000_000n,
  kind: 'action', type: 'increasePosition', operation: 'increasePosition',
};
const result = {
  status: 'confirmed', operation: 'increasePosition', chainId: 1, walletAddress: account,
  steps: [{
    index: 0, transaction: action, hash, status: 'confirmed', confirmations: 1, requiredConfirmations: 1,
    receipt: {
      status: 'success', transactionHash: hash, blockHash, blockNumber: 24_000_000n, transactionIndex: 0, from: account, to: router,
      gasUsed: 310_000n, cumulativeGasUsed: 310_000n, effectiveGasPrice: 1_200_000_000n, logs: [], logsBloom: `0x${'0'.repeat(512)}`,
      contractAddress: null, type: 'eip1559',
    },
  }],
};
const closedAction = { ...action, operation: 'reducePosition', type: 'reducePosition', value: 0n };
const closedResult = {
  ...result,
  operation: 'reducePosition',
  steps: result.steps.map((step) => ({ ...step, transaction: closedAction })),
};
const route = {
  operation: 'increasePosition', chainId: 1, walletAddress: account, transactions: [action],
  details: { routeType: 'Open ETH long position', requestedLeverage: 2.8 },
  policy: {
    walletAddress: account, chainId: 1,
    reviewedAction: {
      kind: 'position-increase', poolAddress: positionPoolAddress('ETH', 'long'), positionId: 0,
      inputTokenAddress: '0x0000000000000000000000000000000000000000', inputAmount: 500_000_000_000_000_000n, nativeInput: true,
      collateralTokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', debtTokenAddress: '0x085780639CC2cACd35E474e71f4d000e2405d8f6',
      positionType: 'long', requestedLeverage: 2.8, slippagePercent: 1,
    },
  },
};
const closedRoute = {
  ...route,
  operation: 'reducePosition',
  transactions: [closedAction],
  details: { routeType: 'Close ETH long position' },
  policy: { ...route.policy, reviewedAction: { ...route.policy.reviewedAction, kind: 'position-reduce', positionId: existing.info.positionId, isClosePosition: true } },
};

const readable = config.readable ?? true;
declare global {
  var __positionBorn: {
    wallet: { ready: boolean; authenticated: boolean; address: string; chainId: number; connectionVersion: number; isEmbedded: boolean };
    shared: Record<string, unknown>;
    brakes: Record<string, unknown>;
    prices: Record<string, number>;
    result: typeof result | typeof closedResult;
    route: typeof route | typeof closedRoute;
    closedPosition: boolean;
    hint: typeof hint;
    identity: { market: 'ETH'; side: 'long'; positionId: number; transactionHash: string };
    path: string;
    navigations: string[];
    prefetches: number;
    completed: boolean;
    navigate: (href: string) => void;
    makeReadable: () => void;
    setPath?: (path: string) => void;
    rerender?: () => void;
  };
}

const positionsWith = (withBorn: boolean) => withBorn ? [existing, born] : [existing];
globalThis.__positionBorn = {
  wallet: { ready: true, authenticated: true, address: account, chainId: 1, connectionVersion: 1, isEmbedded: true },
  shared: {
    walletAddress: account, positions: positionsWith(readable), pendingPositions: readable ? [] : [hint], status: 'ready', failedGroups: [], verifiedGroups: [],
    lastVerifiedAt: Date.now(), refreshing: false, refresh: async () => ({ positions: [] }),
    reconcileClosedPosition: async () => true, trackConfirmedPosition: async () => true, checkingConfirmedPositions: !readable,
    refreshConfirmedPositions: async () => undefined,
  },
  brakes: {
    'ETH:long:2033': reading(566_668_650_163_636_650n),
    [`ETH:long:${NEW_ID}`]: reading(628_920_000_000_000_000n),
  },
  prices: { ETH: ETH_PRICE, WETH: ETH_PRICE, stETH: 2_443.9, wstETH: 3_045.7, WBTC: 81_354.96, fxUSD: 1, USDC: 1, USDT: 1 },
  result: config.closedPosition ? closedResult : result,
  route: config.closedPosition ? closedRoute : route,
  closedPosition: Boolean(config.closedPosition),
  hint,
  identity: { market: 'ETH', side: 'long', positionId: NEW_ID, transactionHash: hash },
  path: window.location.pathname,
  navigations: [],
  prefetches: 0,
  completed: false,
  navigate(href) {
    const url = new URL(href, window.location.href);
    window.history.pushState({}, '', `${url.pathname}${url.search}`);
    globalThis.__positionBorn.navigations.push(href);
    // The app router fetches and renders the next page asynchronously.
    window.setTimeout(() => {
      globalThis.__positionBorn.path = url.pathname;
      globalThis.__positionBorn.setPath?.(url.pathname);
    }, config.navigationDelayMs ?? 40);
  },
  makeReadable() {
    const harness = globalThis.__positionBorn;
    harness.shared = { ...harness.shared, positions: positionsWith(true), pendingPositions: [], checkingConfirmedPositions: false };
    harness.rerender?.();
  },
};

const theme = 'dark';
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = 'dark';
liveMarketStore.setStatus('live');
const now = Date.now();
liveMarketStore.acceptQuote({ market: 'ETH', productId: 'ETH-USD', price: ETH_PRICE, open24h: ETH_PRICE, high24h: ETH_PRICE, low24h: ETH_PRICE, percentChange24h: 0, sequence: now, sourceAt: now, receivedAt: now, source: 'coinbase' });

function HarnessRoot() {
  const [path, setPath] = React.useState(window.location.pathname);
  const [, forceRender] = React.useState(0);
  globalThis.__positionBorn.setPath = setPath;
  globalThis.__positionBorn.rerender = () => forceRender((value) => value + 1);
  return path.startsWith('/positions') ? <PositionsPage key="positions" /> : <TradePage key="trade" />;
}
createRoot(document.getElementById('root')!).render(<HarnessRoot />);
document.documentElement.dataset.harnessReady = 'true';
