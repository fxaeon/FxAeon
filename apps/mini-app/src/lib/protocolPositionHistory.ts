import {
  isAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { assertPublicClientChain, getEthereumClient } from './fx/clients';
import { positionPoolAddress } from './fx/policy';
import { withReadDeadline } from './fx/readFacade';
import type { FxPublicClient } from './fx/types';
import type { IndexedOrder } from './positionCostBasis';
import { decodePositionRouterEvent, positionRouterEventMatchesRecipient } from './positionRouterEvents';

const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const POSITIONS_PER_PAGE = 25;
const ORDERS_PER_PAGE = 5;
const MAX_VERIFIED_TRANSACTIONS = 20;

/** Public indexes used by fx-sdk@1.0.5 getPositions for each market and side. */
const INDEXES = [
  { market: 'ETH', side: 'long', url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth/3.0.0/gn' },
  { market: 'BTC', side: 'long', url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wbtc/3.0.0/gn' },
  // The pinned SDK's wstETH short index is older and has no `realOwner` field.
  { market: 'ETH', side: 'short', supportsRealOwner: false, url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth-short/v0.1.0/gn' },
  { market: 'BTC', side: 'short', url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wbtc-short/v2.0.0/gn' },
] as const;

type Market = (typeof INDEXES)[number]['market'];
type Side = (typeof INDEXES)[number]['side'];
export type ProtocolActivityKind = 'open' | 'reduce' | 'close';

export interface ProtocolPositionActivity {
  chainId: 1;
  hash: Hex;
  positionId: number;
  market: Market;
  side: Side;
  kind: ProtocolActivityKind;
  poolAddress: Address;
  blockNumber: bigint;
  timestamp: number;
}

export interface ProtocolHistoryCursor {
  /** Offset in this market's wallet-linked position set. */
  positions: number;
  /** Offset in this page's ordered Open/Close protocol records. */
  orders: number;
}

export interface ProtocolPositionHistoryResult {
  items: ProtocolPositionActivity[];
  /** Some indexed rows are not shown: an index or receipt read failed, or an event did not verify. */
  partial: boolean;
  /** An index or receipt read failed, so activity may be missing (a non-matching event is not a failure). */
  incomplete?: boolean;
  /** One cursor per market index; `-1` means that index is exhausted. */
  cursor: ProtocolHistoryCursor[];
  hasMore: boolean;
}

interface Candidate extends ProtocolPositionActivity {
  poolAddress: Address;
}

interface IndexPage {
  candidates: Candidate[];
  next: ProtocolHistoryCursor | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function decimalBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

function parsePositionId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositionPage(value: unknown): Map<string, { isClosed: boolean; blockNumber: bigint }> {
  const data = asRecord(asRecord(value)?.data);
  if (!Array.isArray(data?.positions)) throw new Error('The protocol index returned an unexpected response.');
  const positions = new Map<string, { isClosed: boolean; blockNumber: bigint }>();
  for (const rawPosition of data.positions.slice(0, POSITIONS_PER_PAGE)) {
    const position = asRecord(rawPosition);
    const id = typeof position?.id === 'string' ? position.id : '';
    const blockNumber = decimalBigInt(position?.blockNumber);
    if (!parsePositionId(id) || blockNumber === null || typeof position?.isClosed !== 'boolean') continue;
    positions.set(id, { isClosed: position.isClosed, blockNumber });
  }
  return positions;
}

function indexedPositionId(order: Record<string, unknown>, hash: Hex, positions: Map<string, { isClosed: boolean; blockNumber: bigint }>): string | null {
  const explicitId = typeof order.positionId === 'string' ? order.positionId : null;
  const entityId = typeof order.id === 'string' ? order.id : null;
  if (entityId) {
    // Goldsky's Order entity exposes identity as `${positionId}_${transactionHash}`;
    // `positionId` is accepted as a filter but omitted from selected response fields.
    const match = entityId.match(/^([1-9][0-9]{0,15})_(0x[0-9a-f]{64})$/i);
    if (match && match[2].toLowerCase() === hash.toLowerCase() && positions.has(match[1])) {
      if (explicitId !== null && explicitId !== match[1]) return null;
      return match[1];
    }
    if (explicitId === null) return null;
  }
  return explicitId !== null && positions.has(explicitId) ? explicitId : null;
}

function parseOrder(value: unknown, positions: Map<string, { isClosed: boolean; blockNumber: bigint }>, index: (typeof INDEXES)[number]): Candidate | null {
  const order = asRecord(value);
  if (!order || (order.type !== 'Open' && order.type !== 'Close')) return null;
  const hash = typeof order.hash === 'string' && HASH_PATTERN.test(order.hash) ? order.hash.toLowerCase() as Hex : null;
  const positionIdRaw = hash ? indexedPositionId(order, hash, positions) : null;
  const positionState = positionIdRaw ? positions.get(positionIdRaw) : undefined;
  const positionId = positionIdRaw ? parsePositionId(positionIdRaw) : null;
  const blockNumber = decimalBigInt(order.blockNumber);
  const timestampRaw = decimalBigInt(order.timestamp);
  if (!positionState || positionId === null || !hash || blockNumber === null || timestampRaw === null
    || timestampRaw <= 0n || timestampRaw > 8_640_000_000_000n) return null;

  // `Close` covers both reductions and full closes. The indexer's closed flag
  // and final position block distinguish the final close from older reductions.
  const kind: ProtocolActivityKind = order.type === 'Open'
    ? 'open'
    : positionState.isClosed && positionState.blockNumber === blockNumber ? 'close' : 'reduce';
  return {
    chainId: 1,
    hash,
    positionId,
    market: index.market,
    side: index.side,
    kind,
    blockNumber,
    timestamp: Number(timestampRaw),
    poolAddress: positionPoolAddress(index.market, index.side),
  };
}

function positionsQuery(walletAddress: Address, offset: number, supportsRealOwner: boolean): string {
  const walletFilter = supportsRealOwner
    ? `or: [{ owner: "${walletAddress}" }, { realOwner: "${walletAddress}" }]`
    : `owner: "${walletAddress}"`;
  return `query WalletPositionHistory { positions(first: ${POSITIONS_PER_PAGE}, skip: ${offset}, where: { ${walletFilter} }, orderBy: blockNumber, orderDirection: desc) { id isClosed blockNumber } }`;
}

async function queryIndex(
  index: (typeof INDEXES)[number],
  walletAddress: Address,
  fetcher: typeof fetch,
  cursor: ProtocolHistoryCursor,
): Promise<IndexPage> {
  if (cursor.positions < 0) return { candidates: [], next: null };
  const positionResponse = await fetcher(index.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: positionsQuery(walletAddress, cursor.positions, !('supportsRealOwner' in index) || index.supportsRealOwner) }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!positionResponse.ok) throw new Error(`Protocol index returned HTTP ${positionResponse.status}.`);
  const positionBody: unknown = await positionResponse.json();
  if (Array.isArray(asRecord(positionBody)?.errors) && (asRecord(positionBody)?.errors as unknown[]).length > 0) throw new Error('Protocol index query failed.');
  const positions = parsePositionPage(positionBody);
  if (positions.size === 0) return { candidates: [], next: null };

  const positionIds = [...positions.keys()];
  const orderQuery = `query WalletPositionOrders { orders(first: ${ORDERS_PER_PAGE}, skip: ${cursor.orders}, where: { positionId_in: [${positionIds.map((id) => `"${id}"`).join(',')}], type_in: ["Open", "Close"] }, orderBy: blockNumber, orderDirection: desc) { id type hash blockNumber timestamp } }`;
  const orderResponse = await fetcher(index.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: orderQuery }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!orderResponse.ok) throw new Error(`Protocol index returned HTTP ${orderResponse.status}.`);
  const orderBody: unknown = await orderResponse.json();
  const orderRoot = asRecord(orderBody);
  const orderData = asRecord(orderRoot?.data);
  if (Array.isArray(orderRoot?.errors) && orderRoot.errors.length > 0) throw new Error('Protocol index query failed.');
  if (!Array.isArray(orderData?.orders)) throw new Error('The protocol index returned an unexpected response.');
  const candidates = orderData.orders.slice(0, ORDERS_PER_PAGE)
    .map((order) => parseOrder(order, positions, index))
    .filter((candidate): candidate is Candidate => candidate !== null);
  const next = orderData.orders.length >= ORDERS_PER_PAGE
    ? { positions: cursor.positions, orders: cursor.orders + ORDERS_PER_PAGE }
    : positions.size >= POSITIONS_PER_PAGE
      ? { positions: cursor.positions + POSITIONS_PER_PAGE, orders: 0 }
      : null;
  return { candidates, next };
}

function sameAddress(left: unknown, right: string): boolean {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

function decodeMatchingEvent(
  log: TransactionReceipt['logs'][number],
  candidate: Candidate,
  walletAddress: Address,
  receiptLogs: TransactionReceipt['logs'],
): boolean {
  const event = decodePositionRouterEvent(log);
  if (!event
    || !sameAddress(event.pool, candidate.poolAddress)
    || event.positionId !== BigInt(candidate.positionId)
    || (candidate.kind === 'open') !== (event.operation === 'open')) return false;
  return positionRouterEventMatchesRecipient(event, log, receiptLogs, walletAddress);
}

async function verifyCandidates(candidates: Candidate[], walletAddress: Address, client: FxPublicClient, onReadFailure: () => void): Promise<ProtocolPositionActivity[]> {
  const first = candidates[0];
  if (!first) return [];
  try {
    const receipt = await withReadDeadline(client.getTransactionReceipt({ hash: first.hash }));
    if (receipt.status !== 'success'
      || !sameAddress(receipt.transactionHash, first.hash)) return [];
    const events = candidates.filter((candidate) => candidate.blockNumber === receipt.blockNumber
      && receipt.logs.some((log) => sameAddress(log.transactionHash, candidate.hash)
        && log.blockNumber === receipt.blockNumber
        && sameAddress(log.blockHash, receipt.blockHash)
        && decodeMatchingEvent(log, candidate, walletAddress, receipt.logs)));
    return events.map((candidate) => ({
      chainId: 1,
      hash: candidate.hash,
      positionId: candidate.positionId,
      market: candidate.market,
      side: candidate.side,
      kind: candidate.kind,
      poolAddress: candidate.poolAddress,
      blockNumber: candidate.blockNumber,
      timestamp: candidate.timestamp,
    }));
  } catch {
    // An unreadable receipt is a gap in what History can show, not a rejection.
    onReadFailure();
    return [];
  }
}

async function mapBounded<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function nextCursor(result: PromiseSettledResult<IndexPage>, current: ProtocolHistoryCursor): ProtocolHistoryCursor {
  if (result.status === 'rejected') return current;
  return result.value.next ?? { positions: -1, orders: -1 };
}

/**
 * Read one bounded page of wallet-linked position activity, then verify each
 * displayed row against a successful Ethereum receipt and protocol router log.
 */
export async function loadProtocolPositionHistory(params: {
  walletAddress: string;
  client?: FxPublicClient;
  fetcher?: typeof fetch;
  cursor?: ProtocolHistoryCursor[];
}): Promise<ProtocolPositionHistoryResult> {
  if (!isAddress(params.walletAddress, { strict: false })) throw new Error('Connect a valid wallet to load protocol activity.');
  const walletAddress = params.walletAddress.toLowerCase() as Address;
  const fetcher = params.fetcher ?? fetch;
  const cursors = INDEXES.map((_, index) => params.cursor?.[index] ?? { positions: 0, orders: 0 });
  const indexResults = await Promise.allSettled(INDEXES.map((index, i) => queryIndex(index, walletAddress, fetcher, cursors[i])));
  const candidates = indexResults.flatMap((result) => result.status === 'fulfilled' ? result.value.candidates : []);
  if (indexResults.every((result) => result.status === 'rejected')) throw new Error('Protocol activity could not be loaded. Retry when network access is available.');

  const byHash = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.chainId}:${candidate.hash}`;
    const group = byHash.get(key) ?? [];
    if (!group.some((item) => item.positionId === candidate.positionId && item.market === candidate.market && item.side === candidate.side && item.kind === candidate.kind)) group.push(candidate);
    byHash.set(key, group);
  }
  const latest = [...byHash.entries()]
    .map(([key, group]) => [key, group.sort((left, right) => right.blockNumber === left.blockNumber ? right.timestamp - left.timestamp : left.blockNumber > right.blockNumber ? -1 : 1)] as const)
    .sort((left, right) => {
      const first = left[1][0];
      const second = right[1][0];
      return second.blockNumber === first.blockNumber ? second.timestamp - first.timestamp : second.blockNumber > first.blockNumber ? 1 : -1;
    })
    .slice(0, MAX_VERIFIED_TRANSACTIONS);
  const expectedEventKeys = new Set(latest.flatMap(([, group]) => group.map((candidate) => `${candidate.chainId}:${candidate.hash}:${candidate.poolAddress.toLowerCase()}:${candidate.positionId}:${candidate.kind}`)));

  let client = params.client;
  if (latest.length > 0) {
    client ??= getEthereumClient();
    await withReadDeadline(assertPublicClientChain(client, 1));
  }
  let receiptReadFailed = false;
  const verified = client ? (await mapBounded(latest, 4, ([, group]) => verifyCandidates(group, walletAddress, client!, () => { receiptReadFailed = true; }))).flat() : [];
  const itemsByEvent = new Map<string, ProtocolPositionActivity>();
  for (const item of verified) if (item) {
    const key = `${item.chainId}:${item.hash}:${item.poolAddress.toLowerCase()}:${item.positionId}:${item.kind}`;
    itemsByEvent.set(key, item);
  }
  const cursor = INDEXES.map((_, index) => nextCursor(indexResults[index], cursors[index]));
  return {
    items: [...itemsByEvent.values()].sort((left, right) => right.blockNumber === left.blockNumber ? right.timestamp - left.timestamp : left.blockNumber > right.blockNumber ? -1 : 1),
    partial: indexResults.some((result) => result.status === 'rejected') || [...expectedEventKeys].some((key) => !itemsByEvent.has(key)),
    incomplete: indexResults.some((result) => result.status === 'rejected') || receiptReadFailed,
    cursor,
    hasMore: cursor.some((item) => item.positions >= 0),
  };
}

/**
 * The indexes the official f(x) app reads one position's orders from. The
 * wstETH short's is a later deployment of the SDK's index with the same
 * records and a `realOwner` field; the other three are the SDK's own.
 */
const COST_BASIS_INDEXES: Record<`${Market}:${Side}`, string> = {
  'ETH:long': 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth/3.0.0/gn',
  'BTC:long': 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wbtc/3.0.0/gn',
  'ETH:short': 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth-short-backup/v2.0.0/gn',
  'BTC:short': 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wbtc-short/v2.0.0/gn',
};
/** The index's largest page; a position with more orders is read in several. */
export const INDEXED_ORDER_PAGE_SIZE = 1_000;
/** Funding snapshots make long-lived longs the largest: about 1,600 orders in October 2026. */
const MAX_INDEXED_ORDER_PAGES = 40;
const INDEXED_ORDER_FIELDS = 'id type logIndex blockNumber deltaColls deltaDebts positionColls positionDebts oldPositionColls execPrice price priceRate protocolFees tickMovement { typeLogIndex }';

export interface IndexedPositionHistory {
  market: Market;
  side: Side;
  positionId: number;
  /** The index block every record here was read at. */
  block: bigint;
  /** The index's record of the position at that block, in pool units (1e18). */
  colls: bigint;
  debts: bigint;
  /** The target leverage of the position's last change, a decimal such as "3.18". */
  targetLeverage: string | null;
  isClosed: boolean;
  orders: IndexedOrder[];
}

function signedDecimalBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,77})$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

function indexedUint(value: unknown, label: string): bigint {
  const parsed = decimalBigInt(value);
  if (parsed === null) throw new TypeError(`indexed ${label} was malformed`);
  return parsed;
}

/** A signed order amount; the index leaves it null where an order moves none. */
function indexedAmount(value: unknown, label: string): bigint {
  if (value === null || value === undefined) return 0n;
  const parsed = signedDecimalBigInt(value);
  if (parsed === null) throw new TypeError(`indexed ${label} was malformed`);
  return parsed;
}

function parseIndexedOrder(value: unknown, positionId: string): IndexedOrder {
  const order = asRecord(value);
  const id = typeof order?.id === 'string' ? order.id : '';
  if (!order || !id.startsWith(`${positionId}_`) || id.length > 200) throw new TypeError('indexed order does not belong to this position');
  if (typeof order.type !== 'string' || !/^[A-Za-z]{1,40}$/.test(order.type)) throw new TypeError('indexed order type was malformed');
  // A tick movement sorts by its own event's log index, as the official app sorts it.
  const tickLogIndex = order.type === 'TickMovement' ? asRecord(order.tickMovement)?.typeLogIndex : undefined;
  const logIndex = Number(indexedUint(tickLogIndex ?? order.logIndex, 'log index'));
  if (!Number.isSafeInteger(logIndex)) throw new TypeError('indexed log index was malformed');
  return {
    id,
    type: order.type,
    blockNumber: indexedUint(order.blockNumber, 'block number'),
    logIndex,
    deltaColls: indexedAmount(order.deltaColls, 'collateral change'),
    deltaDebts: indexedAmount(order.deltaDebts, 'debt change'),
    positionColls: indexedUint(order.positionColls, 'collateral'),
    positionDebts: indexedUint(order.positionDebts, 'debt'),
    oldPositionColls: order.oldPositionColls === null || order.oldPositionColls === undefined ? null : indexedUint(order.oldPositionColls, 'previous collateral'),
    execPrice: indexedUint(order.execPrice, 'execution price'),
    price: indexedUint(order.price, 'oracle price'),
    priceRate: indexedUint(order.priceRate, 'price rate'),
    protocolFees: order.protocolFees === null || order.protocolFees === undefined ? null : indexedAmount(order.protocolFees, 'protocol fee'),
  };
}

/**
 * Read one position's complete order record from its pool's index, every page
 * pinned to the block of the first, so orders indexed meanwhile cannot slip
 * between pages. With `previous` (an earlier read of the same position) only
 * orders after its block are fetched and added to it.
 */
export async function loadIndexedPositionHistory(params: {
  market: Market;
  side: Side;
  positionId: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  previous?: IndexedPositionHistory | null;
}): Promise<IndexedPositionHistory> {
  const { market, side, positionId } = params;
  const url = COST_BASIS_INDEXES[`${market}:${side}`];
  if (!url || !Number.isSafeInteger(positionId) || positionId <= 0) throw new TypeError('Choose a valid position to read its orders.');
  const fetcher = params.fetcher ?? fetch;
  const id = String(positionId);
  const previous = params.previous && params.previous.market === market && params.previous.side === side
    && params.previous.positionId === positionId ? params.previous : null;
  const request = async (query: string): Promise<Record<string, unknown>> => {
    const signals = [AbortSignal.timeout(12_000), ...(params.signal ? [params.signal] : [])];
    const controller = new AbortController();
    const abort = () => controller.abort();
    for (const signal of signals) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Protocol index returned HTTP ${response.status}.`);
      const body = asRecord(await response.json());
      const data = asRecord(body?.data);
      if ((Array.isArray(body?.errors) && body.errors.length > 0) || !data) throw new Error('Protocol index query failed.');
      return data;
    } finally {
      for (const signal of signals) signal.removeEventListener('abort', abort);
    }
  };
  const where = (cursor: string) => `{ positionId: "${id}", id_gt: "${cursor}"${previous ? `, blockNumber_gt: "${previous.block}"` : ''} }`;
  const first = await request(`query PositionCostBasis { _meta { block { number } hasIndexingErrors } position(id: "${id}") { colls debts targetLeverage isClosed } orders(first: ${INDEXED_ORDER_PAGE_SIZE}, orderBy: id, orderDirection: asc, where: ${where('')}) { ${INDEXED_ORDER_FIELDS} } }`);
  const meta = asRecord(first._meta);
  const blockNumber = asRecord(meta?.block)?.number;
  if (meta?.hasIndexingErrors !== false || typeof blockNumber !== 'number' || !Number.isSafeInteger(blockNumber) || blockNumber <= 0) {
    throw new Error('The protocol index is not current.');
  }
  const block = BigInt(blockNumber);
  if (previous && block < previous.block) throw new Error('The protocol index moved back.');
  const position = asRecord(first.position);
  if (!position) throw new Error('The protocol index has no record of this position.');
  const targetLeverage = position.targetLeverage ?? null;
  if ((targetLeverage !== null && (typeof targetLeverage !== 'string' || targetLeverage.length > 80)) || typeof position.isClosed !== 'boolean') {
    throw new TypeError('The protocol index returned an unexpected position.');
  }

  const orders = new Map((previous?.orders ?? []).map((order) => [order.id, order]));
  let page: unknown = first.orders;
  for (let pageIndex = 0; ; pageIndex += 1) {
    if (!Array.isArray(page) || page.length > INDEXED_ORDER_PAGE_SIZE) throw new Error('The protocol index returned an unexpected response.');
    for (const value of page) {
      const order = parseIndexedOrder(value, id);
      if (order.blockNumber > block) throw new Error('The protocol index returned an order past its block.');
      orders.set(order.id, order);
    }
    if (page.length < INDEXED_ORDER_PAGE_SIZE) break;
    if (pageIndex === MAX_INDEXED_ORDER_PAGES - 1) throw new Error('This position has more orders than FxAeon reads.');
    const cursor = String(asRecord(page[page.length - 1])?.id);
    page = (await request(`query PositionCostBasisPage { orders(first: ${INDEXED_ORDER_PAGE_SIZE}, block: { number: ${blockNumber} }, orderBy: id, orderDirection: asc, where: ${where(cursor)}) { ${INDEXED_ORDER_FIELDS} } }`)).orders;
  }
  return {
    market,
    side,
    positionId,
    block,
    colls: indexedUint(position.colls, 'position collateral'),
    debts: indexedUint(position.debts, 'position debt'),
    targetLeverage: targetLeverage as string | null,
    isClosed: position.isClosed,
    orders: [...orders.values()],
  };
}
