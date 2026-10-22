import { isAddress, zeroAddress, type Address } from 'viem';
import { assertPublicClientChain, getEthereumClient } from './clients';
import { positionPoolAddress } from './policy';
import { withReadDeadline } from './readFacade';
import type { FxSdkMarket } from './tokens';
import type { FxPublicClient } from './types';

export const BORROW_FUNDING_MAX_AGE_MS = 60_000;

// Minimal view ABIs verified against @aladdindao/fx-sdk 1.0.5's long-pool
// configuration() and PoolConfiguration.getLongPoolFundingRatio(address).
// The effective ratio is annual, 1e18-scaled, and applies to collateral:
// https://github.com/AladdinDAO/fx-protocol-contracts/blob/main/contracts/core/PoolConfiguration.sol#L272-L305
// https://github.com/AladdinDAO/fx-protocol-contracts/blob/main/contracts/core/pool/AaveFundingPool.sol#L96-L118
const CONFIGURATION_ABI = [{ type: 'function', name: 'configuration', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;
const FUNDING_ABI = [{ type: 'function', name: 'getLongPoolFundingRatio', stateMutability: 'view', inputs: [{ name: 'pool', type: 'address' }], outputs: [{ name: 'fundingRatio', type: 'uint256' }] }] as const;

export type BorrowFundingRate = {
  market: FxSdkMarket;
  pool: Address;
  ratio: bigint;
  /** Read start, so transport time never extends the freshness window. */
  readAt: number;
};

/** A chain-bound public read, not a debt APR, quote guarantee or signing term. */
export async function readBorrowFundingRate(market: FxSdkMarket, client?: FxPublicClient): Promise<BorrowFundingRate> {
  const readAt = Date.now();
  return withReadDeadline((async () => {
    const reader = client ?? getEthereumClient();
    await assertPublicClientChain(reader, 1);
    const pool = positionPoolAddress(market, 'long');
    const configuration = await reader.readContract({ address: pool, abi: CONFIGURATION_ABI, functionName: 'configuration' });
    if (typeof configuration !== 'string' || !isAddress(configuration, { strict: false }) || configuration.toLowerCase() === zeroAddress) {
      throw new Error('Borrow funding configuration unavailable');
    }
    const ratio = await reader.readContract({ address: configuration, abi: FUNDING_ABI, functionName: 'getLongPoolFundingRatio', args: [pool] });
    if (typeof ratio !== 'bigint' || ratio < 0n || ratio >= 2n ** 256n) throw new Error('Borrow funding ratio unavailable');
    return { market, pool, ratio, readAt };
  })());
}

export function borrowFundingIsFresh(rate: BorrowFundingRate | null | undefined, market: FxSdkMarket, now = Date.now()): rate is BorrowFundingRate {
  return Boolean(rate && rate.market === market && typeof rate.pool === 'string' && rate.pool.toLowerCase() === positionPoolAddress(market, 'long').toLowerCase()
    && typeof rate.ratio === 'bigint' && rate.ratio >= 0n && rate.ratio < 2n ** 256n
    && Number.isSafeInteger(rate.readAt) && rate.readAt > 0 && now >= rate.readAt && now - rate.readAt < BORROW_FUNDING_MAX_AGE_MS);
}

/** Exact ratio-to-percent conversion; a tiny positive APR never reads as zero. */
export function formatBorrowFundingApr(ratio: bigint): string {
  if (ratio < 0n) throw new RangeError('Funding ratio must be nonnegative');
  if (ratio === 0n) return '0%';
  const percentScale = 10n ** 16n;
  const shown = ratio / 10n ** 12n; // four decimal places of percent, rounded down
  if (shown === 0n) return '<0.0001%';
  const fraction = (ratio % percentScale / 10n ** 12n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${shown * 10n ** 12n === ratio ? '' : '≈ '}${ratio / percentScale}${fraction ? `.${fraction}` : ''}%`;
}
