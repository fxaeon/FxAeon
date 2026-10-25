import { isAddress, type Address } from 'viem';
import { assertPublicClientChain, getEthereumClient } from './clients';
import { positionPoolAddress } from './policy';
import { withReadDeadline } from './readFacade';
import type { FxPublicClient } from './types';

// Pinned fx-sdk 1.0.5 manager deployments and getPoolInfo ABIs. The pool's
// own poolManager() must independently match before its tuple is accepted.
const MANAGERS = { long: '0x250893CA4Ba5d05626C785e8da758026928FCD24', short: '0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D' } as const;
const MANAGER_ABI = [{ type: 'function', name: 'poolManager', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;
const outputs = (count: number) => Array.from({ length: count }, () => ({ type: 'uint256' }));
const infoAbi = (side: 'long' | 'short') => [{ type: 'function', name: 'getPoolInfo', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: outputs(side === 'long' ? 5 : 4) }] as const;
const MAX_UINT256 = (1n << 256n) - 1n;
export const POOL_CAPACITY_MAX_AGE_MS = 60_000;
export type PoolCapacity = { market: 'ETH' | 'BTC'; side: 'long' | 'short'; collateralRemaining: bigint; debtRemaining: bigint; collateralCapacity: bigint; collateralBalance: bigint; debtCapacity: bigint; debtBalance: bigint; readAt: number };

/** Long collateral capacity/balance are physical token units, distinct from
 * rawCollateral. Short debt tuple fields are rawDebtCapacity/rawDebtBalance:
 * 18-decimal debt units after the manager's scalar and rate provider. */
export function poolCapacityUnits(market: 'ETH' | 'BTC', side: 'long' | 'short') {
  return {
    collateralSymbol: side === 'short' ? 'fxUSD' : market === 'ETH' ? 'wstETH' : 'WBTC',
    collateralDecimals: side === 'long' && market === 'BTC' ? 8 : 18,
    debtSymbol: side === 'long' ? 'fxUSD' : market === 'ETH' ? 'stETH equivalent' : 'WBTC',
    debtDecimals: 18,
  };
}

export function parsePoolCapacity(tuple: unknown, side: 'long' | 'short') {
  if (!Array.isArray(tuple) || tuple.length !== (side === 'long' ? 5 : 4) || tuple.some(value => typeof value !== 'bigint' || value < 0n || value > MAX_UINT256)) throw new TypeError('Pool capacity unavailable');
  const [collateralCapacity, collateralBalance] = tuple as bigint[];
  const debtCapacity = tuple[side === 'long' ? 3 : 2] as bigint;
  const debtBalance = tuple[side === 'long' ? 4 : 3] as bigint;
  return { collateralCapacity, collateralBalance, debtCapacity, debtBalance,
    collateralRemaining: collateralCapacity > collateralBalance ? collateralCapacity - collateralBalance : 0n,
    debtRemaining: debtCapacity > debtBalance ? debtCapacity - debtBalance : 0n };
}

export async function readPoolCapacity(market: 'ETH' | 'BTC', side: 'long' | 'short', client?: FxPublicClient): Promise<PoolCapacity> {
  const readAt = Date.now();
  return withReadDeadline((async () => {
    const reader = client ?? getEthereumClient();
    await assertPublicClientChain(reader, 1);
    const manager = await reader.readContract({ address: positionPoolAddress(market, side), abi: MANAGER_ABI, functionName: 'poolManager' });
    if (typeof manager !== 'string' || !isAddress(manager, { strict: false }) || manager.toLowerCase() !== MANAGERS[side].toLowerCase()) throw new Error('Pool manager unavailable');
    const tuple = await reader.readContract({ address: manager as Address, abi: infoAbi(side), functionName: 'getPoolInfo', args: [positionPoolAddress(market, side)] });
    return { market, side, readAt, ...parsePoolCapacity(tuple, side) };
  })());
}
