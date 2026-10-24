import { isAddress, zeroAddress, type Address } from 'viem';
import { assertPublicClientChain, getEthereumClient } from './clients';
import { positionPoolAddress } from './policy';
import { FX_READ_DEADLINE_MS, withReadDeadline } from './readFacade';
import type { FxSdkMarket } from './tokens';
import type { FxPublicClient } from './types';

export const BORROW_FUNDING_MAX_AGE_MS = 60_000;
/** fxMINT Advanced and its historical chart quote funding per eight hours. */
export const BORROW_FUNDING_PERIODS_PER_YEAR = 365n * 3n;

// Minimal view ABIs verified against @aladdindao/fx-sdk 1.0.5's long-pool
// configuration() and PoolConfiguration.getLongPoolFundingRatio(address).
// The effective ratio is annual, 1e18-scaled, and applies to collateral:
// https://github.com/AladdinDAO/fx-protocol-contracts/blob/main/contracts/core/PoolConfiguration.sol#L272-L305
// https://github.com/AladdinDAO/fx-protocol-contracts/blob/main/contracts/core/pool/AaveFundingPool.sol#L96-L118
const CONFIGURATION_ABI = [{ type: 'function', name: 'configuration', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;
const FUNDING_ABI = [{ type: 'function', name: 'getLongPoolFundingRatio', stateMutability: 'view', inputs: [{ name: 'pool', type: 'address' }], outputs: [{ name: 'fundingRatio', type: 'uint256' }] }] as const;
const SHORT_FUNDING_ABI = [{ type: 'function', name: 'getShortPoolFundingRatio', stateMutability: 'view', inputs: [{ name: 'pool', type: 'address' }], outputs: [{ name: 'fundingRatio', type: 'uint256' }] }] as const;

export type BorrowFundingRate = {
  market: FxSdkMarket;
  pool: Address;
  ratio: bigint;
  /** Official Advanced uses net funding after short-pool earnings. A verified
   * zero short funding proves no offset without inventing an exchange price.
   * Otherwise leave net unknown; `ratio` remains the actual gross charge. */
  netRatio?: bigint;
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
    const grossRead = reader.readContract({ address: configuration, abi: FUNDING_ABI, functionName: 'getLongPoolFundingRatio', args: [pool] });
    // Start the optional offset beside the gross read. Its deadline leaves a
    // small return margin inside the overall budget, including a slow chain
    // or configuration read. It must never discard independently proven cost.
    const offsetBudget = Math.min(4_000, Math.max(0, readAt + FX_READ_DEADLINE_MS - Date.now() - 1));
    const offsetRead = offsetBudget > 0
      ? withReadDeadline(Promise.resolve().then(() => reader.readContract({ address: configuration, abi: SHORT_FUNDING_ABI, functionName: 'getShortPoolFundingRatio', args: [positionPoolAddress(market, 'short')] })), offsetBudget).catch(() => undefined)
      : Promise.resolve(undefined);
    const ratio = await grossRead;
    if (typeof ratio !== 'bigint' || ratio < 0n || ratio >= 2n ** 256n) throw new Error('Borrow funding ratio unavailable');
    const shortRatio = await offsetRead;
    return { market, pool, ratio, ...(shortRatio === 0n ? { netRatio: ratio } : {}), readAt };
  })());
}

export function borrowFundingIsFresh(rate: BorrowFundingRate | null | undefined, market: FxSdkMarket, now = Date.now()): rate is BorrowFundingRate {
  return Boolean(rate && rate.market === market && typeof rate.pool === 'string' && rate.pool.toLowerCase() === positionPoolAddress(market, 'long').toLowerCase()
    && typeof rate.ratio === 'bigint' && rate.ratio >= 0n && rate.ratio < 2n ** 256n
    && (rate.netRatio === undefined || (typeof rate.netRatio === 'bigint' && rate.netRatio >= 0n && rate.netRatio <= rate.ratio))
    && Number.isSafeInteger(rate.readAt) && rate.readAt > 0 && now >= rate.readAt && now - rate.readAt < BORROW_FUNDING_MAX_AGE_MS);
}

/** Only call a figure the official net rate when its offset was verified. */
export function borrowFundingDisplay(rate: BorrowFundingRate) {
  const net = rate.netRatio !== undefined;
  const ratio = rate.netRatio ?? rate.ratio;
  return { label: net ? 'Funding rate' : 'Gross funding charge', value: `${formatBorrowFundingEightHour(ratio)} / 8h`,
    status: ratio > 0n ? 'On' : 'Off',
    title: `${net ? 'Net funding matches f(x) Advanced: the short-pool funding offset is verified as zero.' : 'Gross collateral charge. The short-pool earnings offset could not be verified, so the net f(x) Advanced rate is unavailable.'} Eight-hour period, matching f(x). Gross annualized charge: ${formatBorrowFundingApr(rate.ratio)} of all collateral. A variable borrowing cost; separate from opening, repayment and network fees.` };
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

/** Same eight-hour period as the official fxMINT Advanced funding chart.
 * Keep positive subprecision charges visible rather than calling them off. */
export function formatBorrowFundingEightHour(ratio: bigint): string {
  if (ratio < 0n) throw new RangeError('Funding ratio must be nonnegative');
  if (ratio === 0n) return '0%';
  const unit = BORROW_FUNDING_PERIODS_PER_YEAR * 10n ** 12n;
  const shown = ratio / unit;
  if (shown === 0n) return '<0.0001%';
  const fraction = (shown % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${shown * unit === ratio ? '' : '≈ '}${shown / 10_000n}${fraction ? `.${fraction}` : ''}%`;
}
