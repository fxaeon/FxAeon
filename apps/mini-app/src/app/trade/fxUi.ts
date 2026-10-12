import { formatUnits, parseUnits, type Address } from 'viem';
import { tokens as sdkTokens } from '@aladdindao/fx-sdk';
import type { PositionInfo } from '@aladdindao/fx-sdk';
import { assertPublicClientChain, assertWalletAddress, getEthereumClient, getFxReadFacade, type FxPublicClient } from '@/lib/fx';
import { withReadDeadline } from '@/lib/fx/readFacade';
import { positionPoolAddress } from '@/lib/fx/policy';
import { discoverDirectWalletPositionIds, readDirectWalletPositionCount, readDirectWalletPositionCounts } from './directPositionDiscovery';
import { FX_READ_DEADLINE_MS } from '@/lib/fx/readFacade';
import { readCanonicalPositionContext, readCanonicalPositionInfo } from './canonicalPositionReader';

export type UiMarket = 'ETH' | 'BTC';
export type UiSide = 'long' | 'short';
export type UiToken = 'ETH' | 'WETH' | 'stETH' | 'wstETH' | 'WBTC' | 'USDC' | 'USDT' | 'fxUSD';
export type SaveToken = 'usdc' | 'fxUSD' | 'fxUSDBasePool';

/** Allow ordinary browser SDK multicall hydration to finish before direct discovery. */
export const POSITION_INDEXER_READ_TIMEOUT_MS = 8_000;

export const FXSAVE_ADDRESS = '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39' as Address;

export const TOKEN_META: Record<UiToken | 'fxSAVE' | 'fxUSDBasePool', { address: Address; decimals: number }> = {
  ETH: { address: sdkTokens.eth as Address, decimals: 18 },
  WETH: { address: sdkTokens.weth as Address, decimals: 18 },
  stETH: { address: sdkTokens.stETH as Address, decimals: 18 },
  wstETH: { address: sdkTokens.wstETH as Address, decimals: 18 },
  WBTC: { address: sdkTokens.WBTC as Address, decimals: 8 },
  USDC: { address: sdkTokens.usdc as Address, decimals: 6 },
  USDT: { address: sdkTokens.usdt as Address, decimals: 6 },
  fxUSD: { address: sdkTokens.fxUSD as Address, decimals: 18 },
  fxSAVE: { address: FXSAVE_ADDRESS, decimals: 18 },
  fxUSDBasePool: { address: sdkTokens.fxUSDBasePool as Address, decimals: 18 },
};

export const ETH_MARKET_TOKENS: readonly UiToken[] = ['ETH', 'WETH', 'stETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
// The SDK accepts every ETH-market input token for both long and short
// positions. stETH is excluded only from an ETH-short *output* picker.
export const ETH_SHORT_MARKET_TOKENS: readonly UiToken[] = ['ETH', 'WETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
export const BTC_MARKET_TOKENS: readonly UiToken[] = ['WBTC', 'USDC', 'USDT', 'fxUSD'];

/** Mirror the exact input-token allow-list enforced by fx-sdk. */
export function positionInputTokenOptions(market: UiMarket): readonly UiToken[] {
  return market === 'BTC' ? BTC_MARKET_TOKENS : ETH_MARKET_TOKENS;
}

/** The SDK excludes stETH only when it is the output of an ETH short. */
export function positionOutputTokenOptions(market: UiMarket, side: UiSide): readonly UiToken[] {
  if (market === 'BTC') return BTC_MARKET_TOKENS;
  return side === 'short' ? ETH_SHORT_MARKET_TOKENS : ETH_MARKET_TOKENS;
}

const WAD = 10n ** 18n;
const WSTETH_RATE_ABI = [{ type: 'function', name: 'stEthPerToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
const POSITION_STATE_ABI = [{ type: 'function', name: 'getPosition', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'collateral', type: 'uint256' }, { name: 'debt', type: 'uint256' }] }] as const;

export async function readCanonicalPositionState(params: {
  client: Pick<FxPublicClient, 'readContract'>;
  group: PositionGroup;
  positionId: number;
}): Promise<readonly [bigint, bigint]> {
  if (!Number.isSafeInteger(params.positionId) || params.positionId < 0) throw new TypeError('position ID must be a non-negative safe integer');
  const state = await withReadDeadline(params.client.readContract({
    address: positionPoolAddress(params.group.market, params.group.side),
    abi: POSITION_STATE_ABI,
    functionName: 'getPosition',
    args: [BigInt(params.positionId)],
  }));
  if (!Array.isArray(state) || state.length !== 2 || typeof state[0] !== 'bigint' || typeof state[1] !== 'bigint' || state[0] < 0n || state[1] < 0n) {
    throw new TypeError(`canonical position state for ${String(params.positionId)} was malformed`);
  }
  return [state[0], state[1]];
}

export function tokenAddress(token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): Address {
  return TOKEN_META[token].address;
}

export function tokenDecimals(token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): number {
  return TOKEN_META[token].decimals;
}

export function parseAmount(value: string, token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): bigint | null {
  if (!value || value === 'all') return null;
  try {
    const amount = parseUnits(value, tokenDecimals(token));
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

export function parseZeroAmount(value: string, token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): bigint | null {
  if (!value) return 0n;
  try {
    return parseUnits(value, tokenDecimals(token));
  } catch {
    return null;
  }
}

export function formatAmount(value: bigint | undefined, decimals = 18, digits = 5): string {
  if (value === undefined) return '—';
  const raw = formatUnits(value, decimals);
  const [integer, fraction = ''] = raw.split('.');
  const trimmed = fraction.slice(0, digits).replace(/0+$/, '');
  return trimmed ? `${integer}.${trimmed}` : integer;
}

export interface UiPosition {
  market: UiMarket;
  side: UiSide;
  info: PositionInfo;
}

export interface PositionGroup {
  market: UiMarket;
  side: UiSide;
}

export interface PositionGroupFailure extends PositionGroup {
  /** Retained for diagnostics; UI callers must pass it through userSafeError. */
  reason: unknown;
}

export interface PositionReadResult {
  positions: UiPosition[];
  successfulGroups: PositionGroup[];
  failedGroups: PositionGroupFailure[];
  status: 'ready' | 'partial' | 'unavailable';
}

export const POSITION_GROUPS: readonly PositionGroup[] = [
  { market: 'ETH', side: 'long' },
  { market: 'ETH', side: 'short' },
  { market: 'BTC', side: 'long' },
  { market: 'BTC', side: 'short' },
] as const;

/** A chain-level failure invalidates every pool, including retained rows. */
export function unavailablePositionResult(reason: unknown): PositionReadResult {
  return {
    positions: [],
    successfulGroups: [],
    failedGroups: POSITION_GROUPS.map((group) => ({ ...group, reason })),
    status: 'unavailable',
  };
}

/** Short routes use the SDK's LSD exposure, not collateral/debt leverage. */
export function positionDisplayLeverage(position: UiPosition): { value: number | null; label: string } {
  const value = position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage;
  return { value: Number.isFinite(value) && value >= 0 ? value : null, label: 'leverage' };
}

/** Seed the editable target from the measured position leverage. */
export function positionTargetLeverage(position: UiPosition): number | null {
  const display = positionDisplayLeverage(position).value;
  return display === null ? null : Number(Math.max(0.1, display).toFixed(2));
}

/** Scope asynchronous refreshes to one mounted wallet session. */
export function createPositionReadGuard() {
  let active = true;
  let generation = 0;
  return {
    begin: (): number | null => active ? ++generation : null,
    isCurrent: (request: number): boolean => active && request === generation,
    activate: (): void => { active = true; },
    invalidate: (): void => { active = false; generation += 1; },
  };
}

export function positionIsStale(position: UiPosition, failedGroups: readonly PositionGroupFailure[]): boolean {
  const group = positionGroupKey(position);
  return failedGroups.some((failure) => positionGroupKey(failure) === group);
}

/**
 * Position contracts expose collateral and debt in their own accounting units.
 * Keep the SDK's returned precision for position fields; it is intentionally
 * distinct from the ERC-20 precision used by editable token inputs (for
 * example, WBTC input is 8 decimals while a BTC pool position is WAD-scaled).
 */
export function positionTokenDecimals(
  position: UiPosition,
  field: 'collateral' | 'debt',
): number {
  return field === 'collateral' ? position.info.rawCollsDecimals : position.info.rawDebtsDecimals;
}

/**
 * Settle every supported position group independently. A transient failure in
 * one pool must not hide positions already verified in the other pools.
 * Ordering remains the canonical POSITION_GROUPS order rather than network
 * completion order, which keeps UI selection and screenshot output stable.
 */
export async function settlePositionGroups(
  readGroup: (group: PositionGroup) => Promise<PositionInfo[]>,
  verifyGroup?: (group: PositionGroup, positions: PositionInfo[]) => Promise<PositionInfo[]>,
): Promise<PositionReadResult> {
  const settled = await Promise.allSettled(POSITION_GROUPS.map(async (group) => {
    const positions = await readGroup(group);
    if (!Array.isArray(positions)) throw new TypeError('Position group response must be an array');
    return { group, positions: verifyGroup ? await verifyGroup(group, positions) : positions };
  }));

  const positions: UiPosition[] = [];
  const successfulGroups: PositionGroup[] = [];
  const failedGroups: PositionGroupFailure[] = [];

  settled.forEach((result, index) => {
    const group = POSITION_GROUPS[index];
    if (result.status === 'rejected') {
      failedGroups.push({ ...group, reason: result.reason });
      return;
    }
    successfulGroups.push(group);
    positions.push(...result.value.positions
      // The indexer retains closed NFT positions for history. The Positions
      // surface is an open-position workspace, so omit records whose accounting
      // fields are both zero rather than presenting them as actionable exposure.
      .filter((info) => info.rawColls > 0n || info.rawDebts > 0n)
      .map((info) => ({ market: group.market, side: group.side, info })));
  });

  return {
    positions,
    successfulGroups,
    failedGroups,
    status: failedGroups.length === 0
      ? 'ready'
      : successfulGroups.length === 0
        ? 'unavailable'
        : 'partial',
  };
}

/** Verify every discovered ID against the canonical ERC-721 ownerOf read. */
export async function verifyPositionGroupOwnership(params: {
  client: Pick<FxPublicClient, 'readContract'>;
  walletAddress: string;
  group: PositionGroup;
  positions: PositionInfo[];
}): Promise<PositionInfo[]> {
  const pool = positionPoolAddress(params.group.market, params.group.side);
  const valid = params.positions.map((info) => {
    if (!Number.isSafeInteger(info.positionId) || info.positionId < 0) throw new TypeError('indexer returned a malformed position ID');
    if (typeof info.rawColls !== 'bigint' || typeof info.rawDebts !== 'bigint' || info.rawColls < 0n || info.rawDebts < 0n) {
      throw new TypeError(`indexer returned malformed fields for position ${String(info.positionId)}`);
    }
    return info;
  });
  const checks = await Promise.allSettled(valid.map(async (info) => {
    const tokenId = BigInt(info.positionId);
    const [collateral, debt] = await readCanonicalPositionState({ client: params.client, group: params.group, positionId: info.positionId });
    const closed = collateral === 0n && debt === 0n;
    // Retain a still-owned zero-accounting NFT in the verified ID set so it
    // satisfies balanceOf completeness and avoids a full historical ID scan.
    // settlePositionGroups removes closed rows from the actionable UI after
    // ownership reconciliation. Burned/stale indexer IDs still fail ownerOf
    // and fall through to direct discovery.
    let owner: unknown;
    try {
      owner = await withReadDeadline(params.client.readContract({
        address: pool,
        abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }] as const,
        functionName: 'ownerOf',
        args: [tokenId],
      }));
    } catch (cause) {
      // Closed indexer rows may outlive a burned NFT. Their accounting is
      // already canonical zero, so discard only that stale row; uncertainty
      // for a position with live accounting must remain a hard failure.
      if (closed) return null;
      throw cause;
    }
    if (typeof owner !== 'string' || owner.toLowerCase() !== params.walletAddress.toLowerCase()) {
      if (closed) return null;
      throw new Error(`${params.group.market} ${params.group.side} position ownership verification was incomplete`);
    }
    return info;
  }));
  const verified: PositionInfo[] = [];
  checks.forEach((check) => {
    if (check.status !== 'fulfilled') throw check.reason;
    if (check.value) verified.push(check.value);
  });
  return verified;
}

/**
 * Reconcile the SDK's fast indexer result with the wallet's canonical NFT
 * balance. Indexer omissions and ownership races fall through to a bounded
 * ownerOf scan; an incomplete scan rejects the group so callers never render
 * a false empty wallet. Only the IDs found by that scan are hydrated through
 * the pinned SDK-compatible canonical reader.
 */
type PositionGroupReadParams = {
  client: FxPublicClient;
  sdk: Pick<ReturnType<typeof getFxReadFacade>, 'getPositions'>;
  walletAddress: Address;
  group: PositionGroup;
  /** Test hook; production reserves most of the shared refresh deadline. */
  indexerTimeoutMs?: number;
};

export async function readPositionGroupWithDirectFallback(params: PositionGroupReadParams): Promise<PositionInfo[]> {
  const deadlineAt = Date.now() + FX_READ_DEADLINE_MS;
  // A zero balance is authoritative and avoids an indexer request entirely.
  // This matters for disconnected/empty pools and keeps the fast path cheap.
  const expectedCount = await readDirectWalletPositionCount({
    client: params.client,
    walletAddress: params.walletAddress,
    group: params.group,
    deadlineAt,
  });
  return readPositionGroupWithInitialCount(params, expectedCount, deadlineAt);
}

async function readPositionGroupWithInitialCount(params: PositionGroupReadParams, expectedCount: bigint, deadlineAt: number): Promise<PositionInfo[]> {
  if (expectedCount === 0n) return [];

  let indexed: PositionInfo[] = [];
  try {
    indexed = await withReadDeadline(params.sdk.getPositions({
        userAddress: params.walletAddress,
        market: params.group.market,
        type: params.group.side,
      }), Math.min(params.indexerTimeoutMs ?? POSITION_INDEXER_READ_TIMEOUT_MS, Math.max(1, deadlineAt - Date.now())));
  } catch {
    // A failed indexer query is precisely the case the direct wallet path is
    // intended to cover. The canonical balance/read below remains authoritative.
  }

  let verified: PositionInfo[] = [];
  try {
    verified = await withReadDeadline(verifyPositionGroupOwnership({
      client: params.client,
      walletAddress: params.walletAddress,
      group: params.group,
      positions: indexed,
    }), Math.max(1, deadlineAt - Date.now()));
  } catch {
    // Ownership mismatch or an incomplete canonical check invalidates the
    // indexer set and forces a complete direct reconciliation.
    verified = [];
  }

  const discovery = await discoverDirectWalletPositionIds({
    client: params.client,
    walletAddress: params.walletAddress,
    group: params.group,
    verifiedIndexerIds: verified.map((info) => info.positionId),
    expectedCount,
    deadlineAt,
  });
  if (!discovery.usedScan) {
    const finalCount = await readDirectWalletPositionCount({
      client: params.client,
      walletAddress: params.walletAddress,
      group: params.group,
      deadlineAt,
    });
    if (finalCount !== expectedCount) throw new Error('position NFT ownership changed during indexer verification');
    const byId = new Map(verified.map((info) => [info.positionId, info]));
    return discovery.ids.map((positionId) => byId.get(positionId)).filter((info): info is PositionInfo => info !== undefined);
  }

  // Hydrate every scanned ID, including IDs also present in the indexer. The
  // quote/rate context is shared per pool and reads are concurrency-limited so
  // a large wallet cannot create an unbounded RPC burst.
  const context = await withReadDeadline(readCanonicalPositionContext({
    client: params.client,
    group: params.group,
  }), Math.max(1, deadlineAt - Date.now()));
  const hydrated: PositionInfo[] = [];
  for (let start = 0; start < discovery.ids.length; start += 8) {
    const batch = discovery.ids.slice(start, start + 8);
    hydrated.push(...await withReadDeadline(Promise.all(batch.map((positionId) => readCanonicalPositionInfo({
      client: params.client,
      group: params.group,
      positionId,
      context,
    }))), Math.max(1, deadlineAt - Date.now())));
  }
  const finalVerified = await withReadDeadline(verifyPositionGroupOwnership({
    client: params.client,
    walletAddress: params.walletAddress,
    group: params.group,
    positions: hydrated,
  }), Math.max(1, deadlineAt - Date.now()));
  const finalCount = await readDirectWalletPositionCount({
    client: params.client,
    walletAddress: params.walletAddress,
    group: params.group,
    deadlineAt,
  });
  if (finalCount !== expectedCount) throw new Error('position NFT ownership changed during direct discovery');
  return finalVerified;
}

export async function readAllPositionsDetailed(walletAddress: string): Promise<PositionReadResult> {
  return readAllPositionsFromClient({ walletAddress, client: getEthereumClient() });
}

/** Injected read boundary for deterministic transport/ownership regression tests. */
export async function readAllPositionsFromClient(params: {
  walletAddress: string;
  client: FxPublicClient;
  sdk?: PositionGroupReadParams['sdk'];
}): Promise<PositionReadResult> {
  assertWalletAddress(params.walletAddress);
  const walletAddress = params.walletAddress as Address;
  await withReadDeadline(assertPublicClientChain(params.client, 1));
  const sdk = params.sdk ?? getFxReadFacade();
  const deadlineAt = Date.now() + FX_READ_DEADLINE_MS;
  const counts = readDirectWalletPositionCounts({ client: params.client, walletAddress, groups: POSITION_GROUPS, deadlineAt });
  return settlePositionGroups(
    async (group) => {
      const count = await counts[POSITION_GROUPS.indexOf(group)];
      return readPositionGroupWithInitialCount({ client: params.client, sdk, walletAddress, group }, count, deadlineAt);
    },
  );
}

/**
 * Backwards-compatible position array reader. Partial reads return every
 * verified position; a total outage still rejects so existing callers cannot
 * mistake an unavailable RPC/indexer for an empty portfolio.
 */
export async function readAllPositions(walletAddress: string): Promise<UiPosition[]> {
  const result = await readAllPositionsDetailed(walletAddress);
  if (result.status === 'unavailable') {
    throw new Error('Position state is unavailable for every supported market', {
      cause: result.failedGroups.map((failure) => failure.reason),
    });
  }
  return result.positions;
}

export function positionCollateralDecimals(position: UiPosition): number {
  return positionTokenDecimals(position, 'collateral');
}

export function positionDebtDecimals(position: UiPosition): number {
  return positionTokenDecimals(position, 'debt');
}

export function positionKey(position: UiPosition): string {
  return `${position.market}:${position.side}:${position.info.positionId}`;
}

export function positionGroupKey(group: PositionGroup): string {
  return `${group.market}:${group.side}`;
}

/**
 * Reconcile a fresh independently-settled read with the last verified
 * snapshot. Successful groups replace their previous rows (including an
 * honestly empty response), while failed groups retain their last verified
 * rows until that pool can be checked again.
 */
export function mergeVerifiedPositions(
  previous: readonly UiPosition[],
  result: PositionReadResult,
): UiPosition[] {
  const successful = new Set(result.successfulGroups.map(positionGroupKey));
  const nextByGroup = new Map<string, UiPosition[]>();

  for (const group of POSITION_GROUPS) {
    nextByGroup.set(positionGroupKey(group), []);
  }
  for (const item of previous) {
    const group = positionGroupKey(item);
    if (!successful.has(group)) nextByGroup.get(group)?.push(item);
  }
  for (const item of result.positions) {
    const group = positionGroupKey(item);
    if (successful.has(group)) nextByGroup.get(group)?.push(item);
  }

  return POSITION_GROUPS.flatMap((group) => nextByGroup.get(positionGroupKey(group)) ?? []);
}

/** Return only IDs newly verified by this read; retained failed-group data is excluded. */
export function newlyVerifiedPositions(
  previous: readonly UiPosition[],
  result: PositionReadResult,
  baselineGroups: readonly PositionGroup[] = result.successfulGroups,
): UiPosition[] {
  const previousKeys = new Set(previous.map(positionKey));
  const baselined = new Set(baselineGroups.map(positionGroupKey));
  return result.positions.filter((position) => baselined.has(positionGroupKey(position)) && !previousKeys.has(positionKey(position)));
}

/**
 * fx-sdk's reducePosition amount is not one universal unit:
 * - long positions use raw collateral units;
 * - BTC shorts use raw debt units;
 * - ETH/wstETH shorts use raw debt normalized by the live stETH-per-token rate.
 * Full closes use a positive sentinel because the SDK's close branch ignores
 * the amount after its positive-input validation.
 */
export function calculateSdkReductionAmountWei(params: {
  market: UiMarket;
  side: UiSide;
  rawCollateralWei: bigint;
  rawDebtWei: bigint;
  fractionBps: number;
  wstEthRateWei?: bigint;
}): bigint {
  const { market, side, rawCollateralWei, rawDebtWei, fractionBps, wstEthRateWei } = params;
  if (!Number.isInteger(fractionBps) || fractionBps <= 0 || fractionBps > 10_000) {
    throw new RangeError('Reduction fraction must be from 1% to 100%');
  }
  if (rawCollateralWei <= 0n) throw new RangeError('Position collateral must be greater than zero');
  if (fractionBps === 10_000) return 1n;
  if (side === 'long') {
    const amount = (rawCollateralWei * BigInt(fractionBps)) / 10_000n;
    if (amount <= 0n || amount >= rawCollateralWei) throw new RangeError('Reduction rounds to an invalid SDK amount');
    return amount;
  }
  if (rawDebtWei <= 0n) throw new RangeError('Position debt must be greater than zero');
  const rate = market === 'ETH' ? wstEthRateWei : WAD;
  if (rate === undefined || rate <= 0n) throw new RangeError('A positive stETH conversion rate is required for an ETH short');
  const numerator = rawDebtWei * rate;
  const basis = numerator / WAD;
  const amount = (numerator * BigInt(fractionBps)) / (WAD * 10_000n);
  if (amount <= 0n || amount >= basis) throw new RangeError('Reduction rounds to an invalid SDK amount');
  return amount;
}

export async function getSdkReductionAmountWei(params: {
  client?: Pick<FxPublicClient, 'readContract'>;
  market: UiMarket;
  side: UiSide;
  rawCollateralWei: bigint;
  rawDebtWei: bigint;
  fractionBps: number;
}): Promise<bigint> {
  let wstEthRateWei: bigint | undefined;
  if (params.side === 'short' && params.market === 'ETH' && params.fractionBps < 10_000) {
    const client = params.client ?? getEthereumClient();
    await assertPublicClientChain(client as FxPublicClient, 1);
    wstEthRateWei = await client.readContract({ address: tokenAddress('wstETH'), abi: WSTETH_RATE_ABI, functionName: 'stEthPerToken' });
  }
  return calculateSdkReductionAmountWei({ ...params, wstEthRateWei });
}
