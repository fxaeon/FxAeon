import type { Page, Route } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi, toFunctionSelector } from 'viem';
import { resolveBridgeTokenAddress } from '../../src/lib/fx';
import { FX_TOKENS, type FxTokenKey } from '../../src/lib/fx/tokens';
import { positionPoolAddress } from '../../src/lib/fx/policy';
import type { FxChainId } from '../../src/lib/fx/types';
import { BORROW_FUNDING_HISTORY_URL } from '../../src/lib/fx/borrowFundingHistory';

// Explicit illustrative protocol state. Wallet balance modes do not change
// market funding or risk parameters; unavailable mode fails these reads.
const POOL_CONFIGURATION = '0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d';
const ANNUAL_FUNDING_RATIO = 45_318_576_060_452_136n;
const FUNDING_READ_ABI = parseAbi([
  'function getLongPoolFundingRatio(address pool) view returns (uint256)',
  'function getShortPoolFundingRatio(address pool) view returns (uint256)',
]);

const erc20Balances: Partial<Record<FxTokenKey, bigint>> = {
  WETH: 400_000_000_000_000_000n,
  wstETH: 250_000_000_000_000_000n,
  stETH: 150_000_000_000_000_000n,
  WBTC: 30_000n,
  USDC: 4_500_000_000n,
  USDT: 1_250_000_000n,
  fxUSD: 1_200_000_000_000_000_000_000n,
  fxUSDBasePool: 400_000_000_000_000_000n,
  fxSAVE: 600_000_000_000_000_000_000n,
  FXN: 200_000_000_000_000_000_000n,
};

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

export type GalleryBalanceState = 'funded' | 'zero' | 'unavailable';
export type GalleryRead = { method: string; chainId: FxChainId };

function tokenBalance(address: string | undefined, chainId: FxChainId, state: GalleryBalanceState): bigint | undefined {
  // Pair the explicit empty index with the canonical NFT counts. Unknown
  // contracts still fail instead of silently inventing an empty portfolio.
  if (chainId === 1 && (['ETH', 'BTC'] as const).some((market) =>
    (['long', 'short'] as const).some((side) => positionPoolAddress(market, side).toLowerCase() === address?.toLowerCase()))) return 0n;
  const token = Object.values(FX_TOKENS).find((item) => item.address.toLowerCase() === address?.toLowerCase());
  if (token && chainId === 1) return state === 'zero' ? 0n : erc20Balances[token.key] ?? 0n;
  if (chainId === 8453) {
    for (const key of ['fxUSD', 'fxSAVE'] as const) {
      if (resolveBridgeTokenAddress(key, chainId).toLowerCase() === address?.toLowerCase()) return 0n;
    }
  }
  return undefined;
}

export function galleryRpcResult(method: string, params: unknown[], chainId: FxChainId, state: GalleryBalanceState = 'funded'): unknown {
  if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
  if (state === 'unavailable') throw new Error('Simulated gallery RPC unavailable');
  if (method === 'eth_blockNumber') return '0x1430f00';
  if (method === 'eth_getBalance') return `0x${(state === 'zero' ? 0n : 1_250_000_000_000_000_000n).toString(16)}`;
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_getCode') return '0x';
  if (method !== 'eth_call') throw new Error(`gallery RPC fixture does not define ${method}`);

  const call = params[0] as { to?: string; data?: string } | undefined;
  const selector = call?.data?.slice(0, 10).toLowerCase();
  if (chainId === 1 && call?.to && call.data) {
    const pool = (['ETH', 'BTC'] as const).flatMap(market => (['long', 'short'] as const).map(side => ({ market, side, address: positionPoolAddress(market, side) })))
      .find(item => item.address.toLowerCase() === call.to!.toLowerCase());
    if (pool) {
      if (selector === toFunctionSelector('configuration()') && call.data.length === 10) return `0x${word(BigInt(POOL_CONFIGURATION))}`;
      if (selector === toFunctionSelector('getDebtRatioRange()') && call.data.length === 10) return pool.side === 'long'
        ? `0x${word(25_600_000_000_000_000n)}${word(855_000_000_000_000_000n)}`
        : `0x${word(90_909_090_909_090_909n)}${word(875_000_000_000_000_000n)}`;
      if (selector === toFunctionSelector('getRebalanceRatios()') && call.data.length === 10) return `0x${word(880_000_000_000_000_000n)}${word(25_000_000n)}`;
      if (selector === toFunctionSelector('getLiquidateRatios()') && call.data.length === 10) return `0x${word(950_000_000_000_000_000n)}${word(40_000_000n)}`;
    }
    if (call.to.toLowerCase() === POOL_CONFIGURATION.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: FUNDING_READ_ABI, data: call.data as `0x${string}` });
      const side = decoded.functionName === 'getLongPoolFundingRatio' ? 'long' : 'short';
      if (call.data.length !== 74 || !(['ETH', 'BTC'] as const).some(market => positionPoolAddress(market, side).toLowerCase() === decoded.args[0].toLowerCase())) {
        throw new Error('gallery funding read requires its canonical pool');
      }
      return encodeFunctionResult({ abi: FUNDING_READ_ABI, functionName: decoded.functionName, result: side === 'long' ? ANNUAL_FUNDING_RATIO : 0n });
    }
    if (call.to.toLowerCase() === FX_TOKENS.wstETH.address.toLowerCase()
      && selector === toFunctionSelector('stEthPerToken()') && call.data.length === 10) return `0x${word(1_250_000_000_000_000_000n)}`;
  }
  if (selector === '0x82ad56cb' && call?.data) {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data as `0x${string}` });
    if (decoded.functionName === 'aggregate3') {
      const results = decoded.args[0].map((subcall) => {
        try {
          // Nested multicalls are not part of this read-only fixture.
          if (subcall.callData.slice(0, 10) === '0x82ad56cb') throw new Error('nested multicall');
          return { success: true, returnData: galleryRpcResult('eth_call', [{ to: subcall.target, data: subcall.callData }], chainId, state) as `0x${string}` };
        } catch {
          return { success: false, returnData: '0x' as `0x${string}` };
        }
      });
      return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: results });
    }
  }
  // Only explicitly modeled token balance reads receive financial values.
  if (selector === '0x70a08231') {
    const balance = tokenBalance(call?.to, chainId, state);
    if (balance !== undefined) return `0x${word(balance)}`;
    throw new Error(`gallery RPC fixture does not define balanceOf for ${call?.to ?? 'unknown token'}`);
  }
  if (call?.to?.toLowerCase() === FX_TOKENS.fxSAVE.address.toLowerCase()
    && selector === toFunctionSelector('convertToAssets(uint256)')) {
    return `0x${word(BigInt(`0x${call.data?.slice(10) ?? '0'}`))}`;
  }
  if (call?.to?.toLowerCase() === FX_TOKENS.fxSAVE.address.toLowerCase()
    && selector === toFunctionSelector('lockedProxy(address)')) return `0x${word(0n)}`;
  if (call?.to?.toLowerCase() === FX_TOKENS.fxSAVE.address.toLowerCase()) {
    const vaultReads: Record<string, bigint> = {
      [toFunctionSelector('totalSupply()')]: 1_000_000n * 10n ** 18n,
      [toFunctionSelector('totalAssets()')]: 1_000_000n * 10n ** 18n,
      [toFunctionSelector('getExpenseRatio()')]: 10n ** 17n,
      [toFunctionSelector('getHarvesterRatio()')]: 10n ** 16n,
      [toFunctionSelector('getThreshold()')]: 10n ** 18n,
    };
    if (selector && vaultReads[selector] !== undefined) return `0x${word(vaultReads[selector])}`;
  }
  if (call?.to?.toLowerCase() === FX_TOKENS.fxUSDBasePool.address.toLowerCase()
    && selector === toFunctionSelector('redeemCoolDownPeriod()')) return `0x${word(259_200n)}`;
  if (call?.to?.toLowerCase() === FX_TOKENS.fxUSDBasePool.address.toLowerCase()
    && selector === toFunctionSelector('instantRedeemFeeRatio()')) return `0x${word(5n * 10n ** 15n)}`;
  throw new Error(`gallery RPC fixture does not define ${method} read ${selector ?? 'without selector'}`);
}

/** Only the known public position indexes and the official funding-history
 * query receive gallery data. Unknown queries never become healthy empties. */
export function galleryGoldskyResult(url: string, body: unknown, state: GalleryBalanceState = 'funded', now = Date.now()): unknown {
  if (state === 'unavailable') throw new Error('Simulated gallery index unavailable');
  const query = body && typeof body === 'object' && 'query' in body ? (body as { query?: unknown }).query : undefined;
  if (typeof query !== 'string' || /\bmutation\b/i.test(query)) throw new Error('gallery index requires a defined read query');
  if (url === BORROW_FUNDING_HISTORY_URL) {
    const type = /fundingId_:\s*\{\s*type:\s*"(wstETH|WBTC)"\s*\}/.exec(query)?.[1];
    const startAt = Number(/timestamp_gte:\s*"(\d+)"/.exec(query)?.[1]);
    const endAt = Math.floor(now / 1000);
    if (!type || !Number.isSafeInteger(startAt) || startAt <= 0 || startAt >= endAt || !/\bsnapshots\s*\(/.test(query)) throw new Error('gallery funding history query is not defined');
    const snapshot = (timestamp: number, ratio: bigint) => ({ timestamp: timestamp.toString(), fundingRate: ratio.toString(), fundingId: { type } });
    const snapshots = Array.from({ length: 31 }, (_, day) => snapshot(startAt + day * 86_400,
      day < 10 ? 0n : day < 20 ? 30_000_000_000_000_000n : ANNUAL_FUNDING_RATIO)).filter(row => Number(row.timestamp) <= endAt);
    const skip = Number(/skip:\s*(\d+)/.exec(query)?.[1] ?? 0);
    return { data: {
      _meta: { block: { number: 0x1430f00, timestamp: endAt }, hasIndexingErrors: false },
      previous: [snapshot(startAt - 1, 0n)], snapshots: snapshots.slice(skip, skip + 1000),
    } };
  }
  const positionIndexes = ['fx-v2-wsteth/3.0.0', 'fx-v2-wbtc/3.0.0', 'fx-v2-wsteth-short/v0.1.0', 'fx-v2-wbtc-short/v2.0.0'];
  if (positionIndexes.some(index => url === `https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/${index}/gn`)
    && /\b(?:positions|orders)\s*\(/.test(query)) return { data: { positions: [], orders: [] } };
  throw new Error('gallery index fixture does not define this query');
}

async function fulfillRpc(route: Route, chainId: FxChainId, state: GalleryBalanceState, reads: GalleryRead[]): Promise<void> {
  let payload: unknown;
  try { payload = route.request().postDataJSON(); } catch { payload = null; }
  const requests = Array.isArray(payload) ? payload : [payload];
  const response = requests.map((request) => {
    const item = request as { id?: unknown; method?: unknown; params?: unknown[] } | null;
    const method = typeof item?.method === 'string' ? item.method : '';
    reads.push({ method, chainId });
    try {
      return { jsonrpc: '2.0', id: item?.id ?? null, result: galleryRpcResult(method, item?.params ?? [], chainId, state) };
    } catch (reason) {
      return { jsonrpc: '2.0', id: item?.id ?? null, error: { code: -32000, message: reason instanceof Error ? reason.message : String(reason) } };
    }
  });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(payload) ? response : response[0]) });
}

/** Deterministic, read-only gallery values; position groups are ready-empty from the explicit index fixture. */
export async function installRefinementGalleryFixtures(page: Page, state: GalleryBalanceState = 'funded'): Promise<{ reads: GalleryRead[] }> {
  const reads: GalleryRead[] = [];
  await page.routeWebSocket(/^wss:\/\/(eth|base)-mainnet\.g\.alchemy\.com\/v2\//, (socket) => {
    socket.onMessage((message) => {
      const request = JSON.parse(String(message)) as { id: number; method: string };
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        ...(request.method === 'eth_subscribe' ? { result: `0x${request.id.toString(16)}` }
          : request.method === 'eth_unsubscribe' ? { result: true }
            : { error: { code: -32601, message: 'Unsupported gallery subscription method' } }),
      }));
    });
  });
  await page.route('https://eth-mainnet.g.alchemy.com/v2/**', (route) => fulfillRpc(route, 1, state, reads));
  await page.route('https://base-mainnet.g.alchemy.com/v2/**', (route) => fulfillRpc(route, 8453, state, reads));
  await page.route('https://mainnet.infura.io/v3/**', (route) => fulfillRpc(route, 1, state, reads));
  await page.route('https://base-mainnet.infura.io/v3/**', (route) => fulfillRpc(route, 8453, state, reads));
  await page.route('https://api.goldsky.com/api/public/**', async route => {
    try {
      const body = galleryGoldskyResult(route.request().url(), route.request().postDataJSON(), state);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    } catch (error) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: error instanceof Error ? error.message : 'Gallery index unavailable' }] }) });
    }
  });
  return { reads };
}
