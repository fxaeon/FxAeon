import { isAddress, zeroAddress, type Address } from 'viem';
import { assertPublicClientChain, getEthereumClient } from './clients';
import { positionPoolAddress } from './policy';
import { withReadDeadline } from './readFacade';
import { formatBorrowFundingEightHour } from './borrowFunding';
import type { FxSdkMarket } from './tokens';
import type { FxPublicClient } from './types';

export const TRADE_FUNDING_MAX_AGE_MS = 60_000;
export type TradeFundingSide = 'long' | 'short';
export type TradeFundingOffset = { oppositeRatio: bigint; longCollateral: bigint; shortCollateral: bigint; shortDebt: bigint; blockNumber: bigint };
export type TradeFundingRate = { market: FxSdkMarket; side: TradeFundingSide; pool: Address; ratio: bigint; readAt: number; offset?: TradeFundingOffset };
const CONFIGURATION_ABI = [{ type: 'function', name: 'configuration', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;
const LONG_ABI = [{ type: 'function', name: 'getLongPoolFundingRatio', stateMutability: 'view', inputs: [{ name: 'pool', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
const SHORT_ABI = [{ type: 'function', name: 'getShortPoolFundingRatio', stateMutability: 'view', inputs: [{ name: 'pool', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
const COLLATERAL_ABI = [{ type: 'function', name: 'getTotalRawCollaterals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const DEBT_ABI = [{ type: 'function', name: 'getTotalRawDebts', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const uint = (value: unknown): value is bigint => typeof value === 'bigint' && value >= 0n && value < 2n ** 256n;
const validConfiguration = (value: unknown): value is Address => typeof value === 'string' && isAddress(value, { strict: false }) && value.toLowerCase() !== zeroAddress;

/** Read annual collateral charges and optional earnings inputs at one Ethereum block.
 * ShortPool.sol uses getShortPoolFundingRatio(this), never Borrow's net long rate:
 * https://github.com/AladdinDAO/fx-protocol-contracts/blob/main/contracts/core/short/ShortPool.sol#L102-L108
 * Offsets follow deployed f(x) frontend poolConfig arithmetic; SDK execution-price
 * evidence is supplied separately by the reviewed route, never a display price. */
async function readRate(market: FxSdkMarket, side: TradeFundingSide, client: FxPublicClient): Promise<TradeFundingRate> {
  const readAt = Date.now();
  const pool = positionPoolAddress(market, side);
  return withReadDeadline((async () => {
    await assertPublicClientChain(client, 1);
    const blockNumber = await client.getBlockNumber();
    if (!uint(blockNumber)) throw new Error('Trade funding block unavailable');
    const longPool = positionPoolAddress(market, 'long'), shortPool = positionPoolAddress(market, 'short');
    const readRatio = async (target: Address, targetSide: TradeFundingSide) => {
      const configuration = await client.readContract({ address: target, abi: CONFIGURATION_ABI, functionName: 'configuration', blockNumber });
      if (!validConfiguration(configuration)) throw new Error('Trade funding configuration unavailable');
      const ratio = targetSide === 'long'
        ? await client.readContract({ address: configuration, abi: LONG_ABI, functionName: 'getLongPoolFundingRatio', args: [target], blockNumber })
        : await client.readContract({ address: configuration, abi: SHORT_ABI, functionName: 'getShortPoolFundingRatio', args: [target], blockNumber });
      if (!uint(ratio)) throw new Error('Trade funding ratio unavailable');
      return ratio;
    };
    // Failure or slowness in optional offsets never discards proven gross cost.
    const offset = withReadDeadline(Promise.resolve().then(() => Promise.all([
      readRatio(side === 'long' ? shortPool : longPool, side === 'long' ? 'short' : 'long'),
      client.readContract({ address: longPool, abi: COLLATERAL_ABI, functionName: 'getTotalRawCollaterals', blockNumber }),
      client.readContract({ address: shortPool, abi: COLLATERAL_ABI, functionName: 'getTotalRawCollaterals', blockNumber }),
      client.readContract({ address: shortPool, abi: DEBT_ABI, functionName: 'getTotalRawDebts', blockNumber }),
    ])).then(([oppositeRatio, longCollateral, shortCollateral, shortDebt]) => {
      if (![oppositeRatio, longCollateral, shortCollateral, shortDebt].every(uint)) return undefined;
      return { oppositeRatio, longCollateral, shortCollateral, shortDebt, blockNumber } as TradeFundingOffset;
    }), 1_500).catch(() => undefined);
    const ratio = await readRatio(pool, side);
    return { market, side, pool, ratio, readAt, offset: await offset };
  })(), 4_000);
}

/** Only the canonical chain-verified reader is shared. Errors are never cached;
 * transport time and cache hits never renew the original freshness timestamp. */
export function createTradeFundingCache(read: (market: FxSdkMarket, side: TradeFundingSide) => Promise<TradeFundingRate>) {
  const values = new Map<string, TradeFundingRate>();
  const pending = new Map<string, Promise<TradeFundingRate>>();
  return (market: FxSdkMarket, side: TradeFundingSide): Promise<TradeFundingRate> => {
    const key = `1:${market}:${side}:${positionPoolAddress(market, side).toLowerCase()}`;
    const prior = values.get(key);
    if (tradeFundingIsFresh(prior, market, side)) return Promise.resolve(prior);
    if (pending.has(key)) return pending.get(key)!;
    const request = Promise.resolve().then(() => read(market, side)).then(rate => {
      if (tradeFundingIsFresh(rate, market, side) && rate.offset && [rate.offset.oppositeRatio, rate.offset.longCollateral, rate.offset.shortCollateral, rate.offset.shortDebt, rate.offset.blockNumber].every(uint)) values.set(key, Object.freeze({ ...rate, ...(rate.offset ? { offset: Object.freeze({ ...rate.offset }) } : {}) }));
      return rate;
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
    pending.set(key, request);
    return request;
  };
}
const sharedRead = createTradeFundingCache((market, side) => readRate(market, side, getEthereumClient()));
export function readTradeFundingRate(market: FxSdkMarket, side: TradeFundingSide, client?: FxPublicClient): Promise<TradeFundingRate> {
  return client ? readRate(market, side, client) : sharedRead(market, side);
}

export function tradeFundingIsFresh(rate: TradeFundingRate | null | undefined, market: FxSdkMarket, side: TradeFundingSide, now = Date.now()): rate is TradeFundingRate {
  return Boolean(rate && rate.market === market && rate.side === side && typeof rate.pool === 'string' && rate.pool.toLowerCase() === positionPoolAddress(market, side).toLowerCase()
    && uint(rate.ratio) && Number.isSafeInteger(rate.readAt) && rate.readAt > 0 && now >= rate.readAt && now - rate.readAt < TRADE_FUNDING_MAX_AGE_MS);
}

/** Algebraically equivalent to official poolConfig net charge. priceWad is the
 * SDK's native two-sided execution-price sample in fxUSD per stETH/WBTC, 1e18;
 * rateRes converts ETH short debt from wstETH to stETH (BTC uses 1e18).
 * Keep the rational offset until final division; never silently clamp earnings. */
export function tradeFundingNetRatio(rate: TradeFundingRate, priceWad?: bigint, rateRes?: bigint): bigint | undefined {
  const o = rate.offset;
  if (!o || !Object.values(o).every(uint)) return undefined;
  if (o.oppositeRatio === 0n || (rate.side === 'long' ? o.shortCollateral === 0n : o.shortDebt === 0n)) return rate.ratio;
  if (!priceWad || !rateRes || !uint(priceWad) || !uint(rateRes)) return undefined;
  const wad = 10n ** 18n;
  if (o.longCollateral === 0n) return undefined;
  if (rate.side === 'long') {
    return rate.ratio - o.shortCollateral * o.oppositeRatio * wad / (o.longCollateral * priceWad);
  }
  if (o.shortCollateral === 0n) return undefined;
  return rate.ratio - o.oppositeRatio * o.shortDebt * rateRes * priceWad / (wad * wad * o.shortCollateral);
}

export function tradeFundingDisplay(rate: TradeFundingRate, netRatio?: bigint) {
  const ratio = netRatio ?? rate.ratio;
  const formatted = formatBorrowFundingEightHour(ratio < 0n ? -ratio : ratio);
  const value = ratio < 0n ? formatted.startsWith('≈ ') ? formatted.replace('≈ ', '≈ -') : formatted.startsWith('<') ? '(-'+formatted.slice(1)+', 0%)' : '-'+formatted : formatted;
  return { label: netRatio === undefined ? 'Gross funding charge' : 'Funding rate', value: `${value} / 8h`,
    title: netRatio === undefined ? 'Gross charge on all pool collateral per eight hours. The earnings offset is unverified. Variable; separate from protocol and network fees.' : 'Net collateral funding per eight hours after the opposite-pool earnings offset, using this reviewed route’s price sample. Negative values represent net earnings. Variable; separate from protocol and network fees.' };
}
