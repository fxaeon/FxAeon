'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UiPosition } from '@/app/trade/fxUi';
import { readCanonicalPositionContext } from '@/app/trade/canonicalPositionReader';
import { getEthereumClient } from '@/lib/fx';
import { withReadDeadline } from '@/lib/fx/readFacade';
import { averagePriceWad, indexMatchesChain, positionEntryPrice } from '@/lib/positionCostBasis';
import { loadIndexedPositionHistory } from '@/lib/protocolPositionHistory';
import { useProtocolPositions } from './ProtocolPositionProvider';
import {
  COST_BASIS_BEHIND_LIMIT,
  PositionCostBasisContext,
  positionCostBasisKey,
  type MarketMidPriceEntry,
  type PositionCostBasisEntry,
  type PositionCostBasisStore,
} from './PositionCostBasisContext';

/** A shown market's mid price is read again after this long. */
const PRICE_REFRESH_MS = 30_000;
/** The index usually trails the chain by a block or two: look again soon, then once a minute. */
const BEHIND_RETRY_MS = 6_000;
const BEHIND_SLOW_RETRY_MS = 60_000;
/** Index reads run two at a time; a wallet's first read can be a few pages each. */
const HISTORY_CONCURRENCY = 2;

/** Failed reads back off: 15 seconds, 30, 60, then every two minutes. */
function failureDelay(failures: number): number {
  return Math.min(120_000, 15_000 * 2 ** Math.max(0, failures - 1));
}

function withAmounts(positions: readonly UiPosition[]): UiPosition[] {
  return positions.filter((position) => position.info.rawColls > 0n || position.info.rawDebts > 0n);
}

/**
 * Reads each shown position's order record from the f(x) index and each shown
 * market's SDK mid price, for entry prices and PnL. A position's record is
 * read once, then only its newer orders: whenever its on-chain amounts move
 * away from the index's record, and again shortly while the index catches up.
 * Mid prices refresh every 30 seconds. Nothing is read while no figure is shown.
 */
export default function PositionCostBasisProvider({ children }: { children: ReactNode }) {
  const { positions, walletAddress, lastVerifiedAt } = useProtocolPositions();
  const [entries, setEntries] = useState<ReadonlyMap<string, PositionCostBasisEntry>>(() => new Map());
  const [prices, setPrices] = useState<PositionCostBasisStore['prices']>({});
  const [demand, setDemand] = useState(0);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const entriesRef = useRef(entries);
  const pricesRef = useRef(prices);
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Set<string>());
  const shownRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const register = useCallback(() => {
    setDemand((count) => count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setDemand((count) => count - 1);
    };
  }, []);

  // Writes land in the refs at once, so the scheduler below sees its own reads.
  const updateEntry = useCallback((key: string, update: (current: PositionCostBasisEntry | undefined) => PositionCostBasisEntry) => {
    const next = new Map(entriesRef.current);
    next.set(key, update(entriesRef.current.get(key)));
    entriesRef.current = next;
    setEntries(next);
  }, []);
  const updatePrice = useCallback((market: UiPosition['market'], update: (current: MarketMidPriceEntry | undefined) => MarketMidPriceEntry) => {
    const next = { ...pricesRef.current, [market]: update(pricesRef.current[market]) };
    pricesRef.current = next;
    setPrices(next);
  }, []);

  const scheduleRef = useRef<() => void>(() => undefined);

  const readHistory = useCallback(async (position: UiPosition, generation: number) => {
    const key = positionCostBasisKey(position);
    const inFlight = inFlightRef.current;
    inFlight.add(key);
    const before = entriesRef.current.get(key);
    // Continue from the last record, unless the index has stayed behind it: then read it whole again.
    const previous = before?.record && before.behind < 2 ? before.record.history : null;
    updateEntry(key, (current) => ({ record: current?.record ?? null, pending: true, failures: current?.failures ?? 0, behind: current?.behind ?? 0, readAt: current?.readAt ?? 0 }));
    try {
      const history = await loadIndexedPositionHistory({ market: position.market, side: position.side, positionId: position.info.positionId, previous });
      if (generation !== generationRef.current) return;
      const latest = positionsRef.current.find((item) => positionCostBasisKey(item) === key) ?? position;
      const matches = indexMatchesChain(history, latest.info);
      const entryWad = positionEntryPrice({ market: position.market, side: position.side, orders: history.orders });
      updateEntry(key, (current) => ({ record: { history, entryWad }, pending: false, failures: 0, behind: matches ? 0 : (current?.behind ?? 0) + 1, readAt: Date.now() }));
    } catch {
      if (generation !== generationRef.current) return;
      updateEntry(key, (current) => ({ record: current?.record ?? null, pending: false, failures: (current?.failures ?? 0) + 1, behind: current?.behind ?? 0, readAt: Date.now() }));
    } finally {
      inFlight.delete(key);
      if (generation === generationRef.current) scheduleRef.current();
    }
  }, [updateEntry]);

  const readPrice = useCallback(async (market: UiPosition['market'], generation: number) => {
    updatePrice(market, (current) => ({ price: current?.price ?? null, pending: true, failures: current?.failures ?? 0, readAt: current?.readAt ?? 0 }));
    try {
      // The SDK's averagePrice: the mean of its FxRoute buy and sell quotes, per stETH or WBTC.
      const context = await withReadDeadline(readCanonicalPositionContext({ client: getEthereumClient(), group: { market, side: 'long' } }));
      if (generation !== generationRef.current) return;
      const priceWad = averagePriceWad(context.averageNumerator, context.averageDenominator);
      if (priceWad === null) throw new RangeError('the mid price was empty');
      const readAt = Date.now();
      updatePrice(market, () => ({ price: { priceWad, rateWad: context.rate, readAt }, pending: false, failures: 0, readAt }));
    } catch {
      if (generation !== generationRef.current) return;
      updatePrice(market, (current) => ({ price: current?.price ?? null, pending: false, failures: (current?.failures ?? 0) + 1, readAt: Date.now() }));
    } finally {
      if (generation === generationRef.current) scheduleRef.current();
    }
  }, [updatePrice]);

  // Start every read that is due, and wake for the next one.
  scheduleRef.current = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!shownRef.current) return;
    const generation = generationRef.current;
    const now = Date.now();
    const targets = withAmounts(positionsRef.current);
    let nextAt = Number.POSITIVE_INFINITY;
    const due = (at: number) => {
      if (at <= now) return true;
      nextAt = Math.min(nextAt, at);
      return false;
    };
    for (const market of new Set(targets.map((position) => position.market))) {
      const entry = pricesRef.current[market];
      if (entry?.pending) continue;
      const at = !entry ? now : entry.readAt + (entry.failures > 0 ? failureDelay(entry.failures) : PRICE_REFRESH_MS);
      if (due(at)) void readPrice(market, generation);
    }
    for (const position of targets) {
      const key = positionCostBasisKey(position);
      if (inFlightRef.current.has(key)) continue;
      const entry = entriesRef.current.get(key);
      const record = entry?.record ?? null;
      if (entry && entry.failures === 0 && record && indexMatchesChain(record.history, position.info)) continue;
      const at = !entry ? now
        : entry.readAt + (entry.failures > 0 ? failureDelay(entry.failures) : entry.behind < COST_BASIS_BEHIND_LIMIT ? BEHIND_RETRY_MS : BEHIND_SLOW_RETRY_MS);
      if (!due(at)) continue;
      if (inFlightRef.current.size >= HISTORY_CONCURRENCY) {
        // The next read to finish schedules again.
        nextAt = Math.min(nextAt, now + BEHIND_RETRY_MS);
        continue;
      }
      void readHistory(position, generation);
    }
    if (Number.isFinite(nextAt)) timerRef.current = window.setTimeout(() => scheduleRef.current(), Math.max(0, nextAt - Date.now()) + 1);
  };

  // A new wallet starts clean; reads still in flight for the old one are ignored.
  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = new Set();
    entriesRef.current = new Map();
    pricesRef.current = {};
    setEntries(entriesRef.current);
    setPrices(pricesRef.current);
  }, [walletAddress]);

  const signature = useMemo(() => withAmounts(positions)
    .map((position) => `${positionCostBasisKey(position)}:${position.info.rawColls}:${position.info.rawDebts}`)
    .join('|'), [positions]);
  const shown = demand > 0;
  useEffect(() => {
    shownRef.current = shown;
    // Records of positions no longer held are dropped.
    const held = new Set(withAmounts(positionsRef.current).map(positionCostBasisKey));
    if ([...entriesRef.current.keys()].some((key) => !held.has(key))) {
      entriesRef.current = new Map([...entriesRef.current].filter(([key]) => held.has(key)));
      setEntries(entriesRef.current);
    }
    scheduleRef.current();
  }, [lastVerifiedAt, shown, signature, walletAddress]);

  useEffect(() => () => {
    generationRef.current += 1;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const value = useMemo<PositionCostBasisStore>(() => ({ entries, prices, register }), [entries, prices, register]);
  return <PositionCostBasisContext.Provider value={value}>{children}</PositionCostBasisContext.Provider>;
}
