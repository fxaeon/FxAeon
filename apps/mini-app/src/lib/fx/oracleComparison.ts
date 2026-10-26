import { formatUnits, isAddress, type Address, type PublicClient } from 'viem';
import { assertPublicClientChain, getEthereumClient } from './clients';
import { positionPoolAddress } from './policy';
import { withReadDeadline } from './readFacade';
import type { FxPublicClient } from './types';
import type { UsdPriceSnapshot } from '../prices';

// Verified against fx-sdk 1.0.5 deployments and pinned contracts 5e198e93:
// StETHPriceOracle, WBTCPriceOracle, InverseWstETHPriceOracle and
// InversePriceOracle. Inverting the short oracle yields USD/wstETH or USD/WBTC;
// the ETH long oracle is already USD/stETH, not USD/ETH or USD/wstETH.
const ORACLES = {
  ETH: { long: '0x0C5C61025f047cB7e3e85852dC8eAFd7b9a4Abfb', short: '0x222786833b5fd5eE21532d8b576391bAbeFdAAd1' },
  BTC: { long: '0xb3c90e64EB6f456A5F5C17Aa99b6aecA6f4a6390', short: '0x5d2c6215555B36889ef235c6d5cCDE22E9964e6a' },
} as const;
const POOL_ABI = [{ type: 'function', name: 'priceOracle', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;
const ORACLE_ABI = [{ type: 'function', name: 'getPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] }] as const;
const INVERSE_BASIS_ABI = [
  { type: 'function', name: 'oracle', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'rateProvider', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;
export const ORACLE_COMPARISON_MAX_AGE_MS = 60_000;
export const ORACLE_MARKET_MAX_SKEW_MS = 5 * 60_000;
export type OracleObservation = { market: 'ETH' | 'BTC'; side: 'long' | 'short'; token: 'stETH' | 'wstETH' | 'WBTC'; usd: number; readAt: number; blockAt: number; blockNumber: bigint };

export function oracleUsdPrice(tuple: unknown, side: 'long' | 'short'): number {
  if (!Array.isArray(tuple) || tuple.length !== 3 || tuple.some(value => typeof value !== 'bigint' || value <= 0n || value >= (1n << 256n))) throw new TypeError('Oracle prices unavailable');
  const [anchor, minimum, maximum] = tuple as bigint[];
  if (minimum > anchor || anchor > maximum) throw new Error('Oracle prices not ordered');
  const price = Number(formatUnits(anchor, 18));
  const usd = side === 'short' ? 1 / price : price;
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Oracle price unavailable');
  return usd;
}

export async function readOracleObservation(market: 'ETH' | 'BTC', side: 'long' | 'short', client?: FxPublicClient): Promise<OracleObservation> {
  const readAt = Date.now();
  return withReadDeadline((async (): Promise<OracleObservation> => {
    const reader = client ?? getEthereumClient();
    await assertPublicClientChain(reader, 1);
    const blockNumber = await reader.getBlockNumber();
    if (typeof blockNumber !== 'bigint' || blockNumber <= 0n) throw new Error('Oracle block unavailable');
    // The production viem public client has this action. Keep the app's
    // broader transaction-client interface unchanged for unrelated consumers.
    const [block, oracle] = await Promise.all([
      (reader as FxPublicClient & Pick<PublicClient, 'getBlock'>).getBlock({ blockNumber }),
      reader.readContract({ address: positionPoolAddress(market, side), abi: POOL_ABI, functionName: 'priceOracle', blockNumber }),
    ]);
    const blockAt = Number(block.timestamp) * 1000;
    if (!Number.isSafeInteger(blockAt) || blockAt <= 0 || blockAt > readAt + 30_000 || readAt - blockAt > 120_000) throw new Error('Recent oracle block unavailable');
    if (typeof oracle !== 'string' || !isAddress(oracle, { strict: false }) || oracle.toLowerCase() !== ORACLES[market][side].toLowerCase()) throw new Error('Oracle basis not verified');
    if (side === 'short') {
      const [underlying, rate] = await Promise.all([
        reader.readContract({ address: oracle as Address, abi: INVERSE_BASIS_ABI, functionName: 'oracle', blockNumber }),
        reader.readContract({ address: oracle as Address, abi: INVERSE_BASIS_ABI, functionName: 'rateProvider', blockNumber }),
      ]);
      const expectedRate = market === 'ETH' ? '0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f' : '0x0000000000000000000000000000000000000000';
      if (typeof underlying !== 'string' || underlying.toLowerCase() !== ORACLES[market].long.toLowerCase() || typeof rate !== 'string' || rate.toLowerCase() !== expectedRate.toLowerCase()) throw new Error('Inverse oracle basis not verified');
    }
    const tuple = await reader.readContract({ address: oracle as Address, abi: ORACLE_ABI, functionName: 'getPrice', blockNumber });
    return { market, side, readAt, blockAt, blockNumber, token: market === 'BTC' ? 'WBTC' : side === 'long' ? 'stETH' : 'wstETH', usd: oracleUsdPrice(tuple, side) };
  })());
}

/** Signed oracle premium versus a recent quote for the exact same token. */
export function oracleMarketDifference(oracle: OracleObservation | null | undefined, prices: UsdPriceSnapshot, now = Date.now()): { percent: number; token: OracleObservation['token']; marketAt: number } | null {
  if (!oracle || !Number.isSafeInteger(oracle.readAt) || !Number.isSafeInteger(oracle.blockAt) || oracle.blockAt <= 0 || oracle.blockAt > now + 30_000 || now - oracle.blockAt > 180_000 || now < oracle.readAt || now - oracle.readAt >= ORACLE_COMPARISON_MAX_AGE_MS || prices.status === 'stale' || prices.status === 'unavailable') return null;
  const value = prices.prices[oracle.token];
  const timestamp = prices.updatedAts?.[oracle.token] ?? prices.updatedAt;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now
    || now - timestamp > ORACLE_MARKET_MAX_SKEW_MS || Math.abs(timestamp - oracle.blockAt) > ORACLE_MARKET_MAX_SKEW_MS || !Number.isFinite(oracle.usd) || oracle.usd <= 0) return null;
  return { percent: (oracle.usd / value - 1) * 100, token: oracle.token, marketAt: timestamp };
}
