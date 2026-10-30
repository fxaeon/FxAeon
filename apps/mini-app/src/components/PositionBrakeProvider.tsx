'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UiPosition } from '@/app/trade/fxUi';
import { createPoolBrakeParameterCache, readPositionBrakes, type PositionBrakeClient, type PositionBrakeOutcome } from '@/app/trade/positionBrakeReader';
import { getEthereumClient } from '@/lib/fx';
import { isLiveQuoteFresh } from '@/lib/liveMarket';
import { liveMarketStore } from '@/lib/liveMarketStore';
import { poolThresholdPrice } from '@/lib/positionBrake';
import { useProtocolPositions } from './ProtocolPositionProvider';
import {
  POSITION_BRAKE_MAX_AGE_MS,
  PositionBrakeContext,
  positionBrakeKey,
  type PositionBrakeEntry,
  type PositionBrakeStore,
} from './PositionBrakeContext';

/** A shown card asks again after this long even without a new position snapshot. */
const BRAKE_REUSE_MS = 15_000;

/** The live quote the card moves with, taken the moment a chain read lands. */
function freshMarketQuote(market: UiPosition['market'], now: number): number | null {
  const { quote, status } = liveMarketStore.getSnapshot(market);
  return status === 'live' && isLiveQuoteFresh(quote, now) && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
}

function withDebt(positions: readonly UiPosition[]): UiPosition[] {
  return positions.filter((position) => position.info.rawDebts > 0n);
}

/**
 * Reads each shown position's debt ratio and its pool's live thresholds on the
 * position refresh cadence: after every verified position snapshot (each block
 * while realtime updates run, and on focus), and when a card first appears.
 * One read runs at a time; a request during it runs once afterwards.
 */
export default function PositionBrakeProvider({ children }: { children: ReactNode }) {
  const { positions, walletAddress, lastVerifiedAt } = useProtocolPositions();
  const [entries, setEntries] = useState<ReadonlyMap<string, PositionBrakeEntry>>(() => new Map());
  const [demand, setDemand] = useState(0);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [cache] = useState(() => createPoolBrakeParameterCache());
  const generationRef = useRef(0);
  const runningRef = useRef(false);
  const rerunRef = useRef(false);
  const lastTriggerRef = useRef('');

  const register = useCallback(() => {
    setDemand((count) => count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setDemand((count) => count - 1);
    };
  }, []);

  const readRef = useRef<() => Promise<void>>(async () => undefined);
  readRef.current = async () => {
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    const targets = withDebt(positionsRef.current);
    if (!targets.length) return;
    runningRef.current = true;
    const generation = generationRef.current;
    const keys = new Set(targets.map(positionBrakeKey));
    setEntries((current) => {
      const next = new Map<string, PositionBrakeEntry>();
      for (const key of keys) next.set(key, { record: current.get(key)?.record ?? null, pending: true, failed: current.get(key)?.failed ?? false });
      return next;
    });
    let outcomes: Map<string, PositionBrakeOutcome>;
    try {
      outcomes = await readPositionBrakes({
        client: getEthereumClient() as unknown as PositionBrakeClient,
        targets: targets.map((position) => ({ key: positionBrakeKey(position), market: position.market, side: position.side, positionId: position.info.positionId })),
        cache,
      });
    } catch (reason) {
      outcomes = new Map(targets.map((position) => [positionBrakeKey(position), { status: 'failed', reason }]));
    }
    runningRef.current = false;
    if (generation === generationRef.current) {
      const readAt = Date.now();
      const quotes = { ETH: freshMarketQuote('ETH', readAt), BTC: freshMarketQuote('BTC', readAt) };
      setEntries((current) => {
        const next = new Map(current);
        for (const position of targets) {
          const key = positionBrakeKey(position);
          const outcome = outcomes.get(key);
          // The pool's own threshold prices, for when no live quote prices them.
          const poolPrice = (ratio: bigint) => poolThresholdPrice({
            market: position.market, side: position.side, rawColls: position.info.rawColls, rawDebts: position.info.rawDebts,
            ratio, stEthPerWstEth: outcome?.status === 'ready' ? outcome.sample.stEthPerWstEth : undefined,
          });
          next.set(key, outcome?.status === 'ready'
            ? {
              record: {
                reading: {
                  side: position.side,
                  debtRatio: outcome.sample.debtRatio,
                  rebalanceRatio: outcome.sample.rebalanceRatio,
                  liquidateRatio: outcome.sample.liquidateRatio,
                  priceAtRead: quotes[position.market],
                  poolPrices: { rebalance: poolPrice(outcome.sample.rebalanceRatio), liquidate: poolPrice(outcome.sample.liquidateRatio) },
                },
                readAt,
                rawColls: position.info.rawColls,
                rawDebts: position.info.rawDebts,
              },
              pending: false,
              failed: false,
            }
            // Keep the last good read through a failed refresh; cards drop it once it ages out.
            : { record: current.get(key)?.record ?? null, pending: false, failed: true });
        }
        return next;
      });
    }
    if (rerunRef.current) {
      rerunRef.current = false;
      void readRef.current();
    }
  };

  // A new wallet starts clean; a read still in flight for the old one is ignored.
  useEffect(() => {
    generationRef.current += 1;
    lastTriggerRef.current = '';
    setEntries(new Map());
  }, [walletAddress]);

  const signature = useMemo(() => withDebt(positions)
    .map((position) => `${positionBrakeKey(position)}:${position.info.rawColls}:${position.info.rawDebts}`)
    .join('|'), [positions]);
  const shown = demand > 0;
  useEffect(() => {
    if (!shown || !signature) return;
    const trigger = `${walletAddress ?? ''}@${lastVerifiedAt ?? ''}@${signature}`;
    const now = Date.now();
    const stale = withDebt(positionsRef.current).some((position) => {
      const record = entriesRef.current.get(positionBrakeKey(position))?.record;
      return !record || record.rawColls !== position.info.rawColls || record.rawDebts !== position.info.rawDebts || now - record.readAt > BRAKE_REUSE_MS;
    });
    if (trigger === lastTriggerRef.current && !stale) return;
    lastTriggerRef.current = trigger;
    void readRef.current();
  }, [lastVerifiedAt, shown, signature, walletAddress]);

  // Wake the cards when a read ages out, so they stop presenting it as current.
  useEffect(() => {
    const now = Date.now();
    const expiries = [...entries.values()].flatMap((entry) => entry.record ? [entry.record.readAt + POSITION_BRAKE_MAX_AGE_MS] : []).filter((expiry) => expiry >= now);
    if (!expiries.length) return undefined;
    const timer = window.setTimeout(() => setEntries((current) => new Map(current)), Math.min(...expiries) - now + 1);
    return () => window.clearTimeout(timer);
  }, [entries]);

  const value = useMemo<PositionBrakeStore>(() => ({ entries, register }), [entries, register]);
  return <PositionBrakeContext.Provider value={value}>{children}</PositionBrakeContext.Provider>;
}
