'use client';

import { createContext, useContext, useEffect } from 'react';
import type { UiPosition } from '@/app/trade/fxUi';
import { indexMatchesChain, parseLeverageWad, positionPnl, type PositionPnl } from '@/lib/positionCostBasis';
import type { IndexedPositionHistory } from '@/lib/protocolPositionHistory';

/** A DEX mid price older than this no longer prices a PnL. Reads repeat every 30 seconds while shown. */
export const COST_BASIS_PRICE_MAX_AGE_MS = 120_000;
/** Reads in a row that find the index behind the chain before the figures read unavailable; reads go on. */
export const COST_BASIS_BEHIND_LIMIT = 4;

export interface CostBasisRecord {
  history: IndexedPositionHistory;
  /** The entry price its orders give (fxUSD per stETH or WBTC, 1e18), or null when they give none. */
  entryWad: bigint | null;
}

export interface PositionCostBasisEntry {
  /** The latest successful read. */
  record: CostBasisRecord | null;
  /** A read of this position is in flight. */
  pending: boolean;
  /** Reads in a row that failed. */
  failures: number;
  /** Reads in a row whose index record did not match the position's on-chain amounts. */
  behind: number;
  /** When the latest read ended. */
  readAt: number;
}

/** The SDK's averagePrice for a market and the rate that prices a short's debt in stETH. */
export interface MarketMidPrice {
  /** fxUSD per stETH or WBTC (1e18). */
  priceWad: bigint;
  /** stETH per wstETH for ETH, 1e18 for BTC (the SDK's rateRes). */
  rateWad: bigint;
  readAt: number;
}

export interface MarketMidPriceEntry {
  price: MarketMidPrice | null;
  pending: boolean;
  failures: number;
  /** When the latest read ended. */
  readAt: number;
}

export interface PositionCostBasisStore {
  entries: ReadonlyMap<string, PositionCostBasisEntry>;
  prices: Partial<Record<UiPosition['market'], MarketMidPriceEntry>>;
  /** Figures register while mounted, so reads run only while one is shown. */
  register: () => () => void;
}

export const PositionCostBasisContext = createContext<PositionCostBasisStore | null>(null);

export type PositionCostBasisStatus =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | {
    status: 'ready';
    /** fxUSD per stETH or WBTC (1e18). */
    entryWad: bigint;
    pnl: PositionPnl | null;
    pnlStatus: 'ready' | 'loading' | 'unavailable';
    /** The mid price the PnL is taken at (1e18), when one is current. */
    priceWad: bigint | null;
  };

type CostBasisPosition = Pick<UiPosition, 'market' | 'side'> & { info: Pick<UiPosition['info'], 'positionId' | 'rawColls' | 'rawDebts'> };

export function positionCostBasisKey(position: CostBasisPosition): string {
  return `${position.market}:${position.side}:${position.info.positionId}`;
}

/**
 * What a position may show: its entry price and PnL once the index's record
 * of it matches the chain within 1e10, placeholders while a read or the index
 * catches up, and nothing once reads fail or the index stays behind. A stale
 * index record never prices a figure.
 */
export function resolvePositionCostBasis(store: PositionCostBasisStore | null, position: CostBasisPosition, now: number): PositionCostBasisStatus {
  if (position.info.rawColls <= 0n && position.info.rawDebts <= 0n) return { status: 'none' };
  if (!store) return { status: 'unavailable' };
  const entry = store.entries.get(positionCostBasisKey(position));
  const record = entry?.record ?? null;
  if (!record || !indexMatchesChain(record.history, position.info)) {
    if (!entry || entry.pending || (entry.failures === 0 && entry.behind < COST_BASIS_BEHIND_LIMIT)) return { status: 'loading' };
    return { status: 'unavailable' };
  }
  if (record.entryWad === null) return { status: 'unavailable' };
  const market = store.prices[position.market];
  const price = market?.price && now >= market.price.readAt && now - market.price.readAt <= COST_BASIS_PRICE_MAX_AGE_MS ? market.price : null;
  if (!price) {
    return { status: 'ready', entryWad: record.entryWad, pnl: null, pnlStatus: !market || market.pending || market.failures === 0 ? 'loading' : 'unavailable', priceWad: null };
  }
  const pnl = positionPnl({
    side: position.side,
    entryWad: record.entryWad,
    priceWad: price.priceWad,
    rawColls: position.info.rawColls,
    rawDebts: position.info.rawDebts,
    rateWad: price.rateWad,
    targetLeverageWad: parseLeverageWad(record.history.targetLeverage),
  });
  return { status: 'ready', entryWad: record.entryWad, pnl, pnlStatus: pnl ? 'ready' : 'unavailable', priceWad: price.priceWad };
}

export function usePositionCostBasis(position: CostBasisPosition): PositionCostBasisStatus {
  const store = useContext(PositionCostBasisContext);
  const register = store?.register;
  useEffect(() => register?.(), [register]);
  return resolvePositionCostBasis(store, position, Date.now());
}
