import { formatUnits, type Address, type ContractFunctionParameters, type PublicClient } from 'viem';
import { getEthereumClient } from '@/lib/fx/clients';
import { FX_ORACLES, oracleUsdPrice } from '@/lib/fx/oracleComparison';
import { withReadDeadline } from '@/lib/fx/readFacade';
import { FX_TOKENS, type FxTokenKey } from '@/lib/fx/tokens';
import type { FxPublicClient } from '@/lib/fx/types';
import type { UsdPriceMap, UsdPriceUpdate } from '@/lib/prices';

/**
 * Display prices read where f(x) reads them: its own price oracles, its vault
 * NAVs and the Chainlink feeds behind them, in one call at one block. Every
 * value is stamped with that block's time, so the provider's freshness rules
 * apply unchanged. Display only; nothing here prices a transaction.
 */

const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = [{ type: 'function', name: 'getCurrentBlockTimestamp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const ORACLE_ABI = [{ type: 'function', name: 'getPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] }] as const;
const NAV_ABI = [{ type: 'function', name: 'nav', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const FEED_ABI = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [
  { type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' },
] }] as const;

/** f(x)'s pool oracles give stETH and WBTC directly; inverting the short oracle gives wstETH. */
const ORACLE_PRICES = [
  { key: 'stETH', address: FX_ORACLES.ETH.long, side: 'long' },
  { key: 'wstETH', address: FX_ORACLES.ETH.short, side: 'short' },
  { key: 'WBTC', address: FX_ORACLES.BTC.long, side: 'long' },
] as const;

/**
 * Chainlink USD feeds (8 decimals). A feed updates on a price deviation or its
 * heartbeat, so its answer is current at the read block until one heartbeat
 * passes without an update; after that it is stale and left out.
 */
export const CHAINLINK_USD_FEEDS = [
  { key: 'ETH', address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', heartbeatSeconds: 3_600 },
  { key: 'USDC', address: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', heartbeatSeconds: 86_400 },
  { key: 'USDT', address: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', heartbeatSeconds: 86_400 },
] as const;
const FEED_GRACE_SECONDS = 600;
const PROTOCOL_BLOCK_MAX_AGE_SECONDS = 300;

/** USD per share, as the vaults value their own shares. Addresses resolve at read time. */
const NAV_PRICES = ['fxSAVE', 'fxUSDBasePool'] as const;

type Read = { status: 'success'; result: unknown } | { status: 'failure'; error?: unknown };

/** Validate one call's reads at one block. A failed or implausible read leaves that token out. */
export function protocolPricesFromReads(reads: readonly Read[], now = Date.now()): UsdPriceUpdate {
  const [stamp, ...rest] = reads;
  const blockSeconds = stamp?.status === 'success' && typeof stamp.result === 'bigint' ? Number(stamp.result) : NaN;
  if (!Number.isSafeInteger(blockSeconds) || blockSeconds <= 0) throw new Error('Protocol price block unavailable');
  // A lagging or future node block is not a current observation.
  if (now / 1000 - blockSeconds > PROTOCOL_BLOCK_MAX_AGE_SECONDS || blockSeconds - now / 1000 > 120) throw new Error('Protocol price block is not recent');
  const prices: UsdPriceMap = {};
  const accept = (key: FxTokenKey, usd: number) => { if (Number.isFinite(usd) && usd > 0) prices[key] = usd; };
  const oracleReads = rest.slice(0, ORACLE_PRICES.length);
  const feedReads = rest.slice(ORACLE_PRICES.length, ORACLE_PRICES.length + CHAINLINK_USD_FEEDS.length);
  const navReads = rest.slice(ORACLE_PRICES.length + CHAINLINK_USD_FEEDS.length);
  ORACLE_PRICES.forEach(({ key, side }, index) => {
    const read = oracleReads[index];
    if (read?.status !== 'success') return;
    try { accept(key, oracleUsdPrice(read.result, side)); } catch { /* an unordered or empty oracle answer is not a price */ }
  });
  CHAINLINK_USD_FEEDS.forEach(({ key, heartbeatSeconds }, index) => {
    const read = feedReads[index];
    if (read?.status !== 'success' || !Array.isArray(read.result)) return;
    const [, answer, , updatedAt] = read.result as unknown[];
    if (typeof answer !== 'bigint' || answer <= 0n || typeof updatedAt !== 'bigint') return;
    const age = blockSeconds - Number(updatedAt);
    if (age < 0 || age > heartbeatSeconds + FEED_GRACE_SECONDS) return;
    accept(key, Number(formatUnits(answer, 8)));
  });
  NAV_PRICES.forEach((key, index) => {
    const read = navReads[index];
    if (read?.status !== 'success' || typeof read.result !== 'bigint') return;
    const usd = Number(formatUnits(read.result, 18));
    // A share NAV far from a dollar is a broken read, not a price.
    if (usd > 0.5 && usd < 10) accept(key, usd);
  });
  // WETH is ETH, one quote.
  if (prices.ETH) prices.WETH = prices.ETH;
  const keys = Object.keys(prices) as FxTokenKey[];
  if (!keys.length) throw new Error('Protocol prices unavailable');
  const at = blockSeconds * 1000;
  return { prices, updatedAt: at, updatedAts: Object.fromEntries(keys.map(key => [key, at])) };
}

export async function readFxProtocolPrices(client?: FxPublicClient): Promise<UsdPriceUpdate> {
  return withReadDeadline((async () => {
    // The production client is a viem public client; its multicall keeps every read at one block.
    const reader = (client ?? getEthereumClient()) as FxPublicClient & Pick<PublicClient, 'multicall'>;
    // The order matches protocolPricesFromReads: block time, oracles, feeds, NAVs.
    const contracts: ContractFunctionParameters[] = [
      { address: MULTICALL3, abi: MULTICALL3_ABI, functionName: 'getCurrentBlockTimestamp' },
      ...ORACLE_PRICES.map(({ address }) => ({ address: address as Address, abi: ORACLE_ABI, functionName: 'getPrice' })),
      ...CHAINLINK_USD_FEEDS.map(({ address }) => ({ address: address as Address, abi: FEED_ABI, functionName: 'latestRoundData' })),
      ...NAV_PRICES.map(key => ({ address: FX_TOKENS[key].address, abi: NAV_ABI, functionName: 'nav' })),
    ];
    const reads = await reader.multicall({ allowFailure: true, contracts });
    return protocolPricesFromReads(reads as readonly Read[]);
  })(), 8_000);
}

/** f(x)'s own price service, which its app polls for FXN and fxUSD. */
export const FX_PRICE_SERVICE_ENDPOINT = 'https://api.aladdin.club/api/coingecko/price';
const FX_PRICE_SERVICE_KEYS = ['FXN', 'fxUSD'] as const satisfies readonly FxTokenKey[];

/**
 * The service publishes no source time, so a quote is stamped when it is
 * received. Its stablecoin entries are fixed at 1 and never used: a peg is not
 * a price. Only FXN and fxUSD are taken, within sane bounds.
 */
export function parseFxPriceService(payload: unknown, receivedAt = Date.now()): UsdPriceUpdate {
  const data = payload && typeof payload === 'object' && (payload as { code?: unknown }).code === 200
    ? (payload as { data?: unknown }).data : undefined;
  if (!data || typeof data !== 'object') throw new Error('Price service response has no data');
  const prices: UsdPriceMap = {};
  for (const key of FX_PRICE_SERVICE_KEYS) {
    const usd = Number((data as Record<string, { usd?: unknown }>)[key]?.usd);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    if (key === 'fxUSD' && (usd < 0.5 || usd > 1.5)) continue;
    prices[key] = usd;
  }
  const keys = Object.keys(prices) as FxTokenKey[];
  if (!keys.length) throw new Error('Price service has no validated prices');
  return { prices, updatedAt: receivedAt, updatedAts: Object.fromEntries(keys.map(key => [key, receivedAt])) };
}
