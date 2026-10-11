import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PositionInfo } from '@aladdindao/fx-sdk';
import { createPublicClient, decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi, type Address, type Hex } from 'viem';
import { base, mainnet } from 'viem/chains';
import { readDirectWalletPositionCounts } from '../src/app/trade/directPositionDiscovery';
import { POSITION_GROUPS, readAllPositionsFromClient, readPositionGroupWithDirectFallback, settlePositionGroups, type PositionGroup } from '../src/app/trade/fxUi';
import { assertPublicClientChain, getRpcTransport } from '../src/lib/fx/clients';
import { positionPoolAddress } from '../src/lib/fx/policy';
import type { FxPublicClient } from '../src/lib/fx/types';

const wallet = '0x1111111111111111111111111111111111111111' as Address;
const otherWallet = '0x2222222222222222222222222222222222222222' as Address;
const pools = POSITION_GROUPS.map(group => positionPoolAddress(group.market, group.side).toLowerCase());
const ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getPosition(uint256 tokenId) view returns (uint256 collateral, uint256 debt)',
  'function getNextPositionId() view returns (uint256)',
]);
const WAD = 10n ** 18n;
type Slot = { success: boolean; returnData: Hex };
type Request = { method: string; params?: [{ to?: Address; data?: Hex }]; id: number };
type Read = { pool: number; functionName: string; args: readonly unknown[] };
function groupKey(group: PositionGroup) { return `${group.market}:${group.side}`; }
function info(positionId: number): PositionInfo {
  return { positionId, rawColls: 2n * WAD, rawDebts: WAD, currentLeverage: 2, lsdLeverage: 2,
    rawCollsToken: 'wstETH', rawDebtsToken: 'fxUSD', rawCollsDecimals: 18, rawDebtsDecimals: 18 };
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

/** Real viem ABI encoding/decoding and FxAeon's real chain-pinned HTTP transport.
 * Only remote JSON-RPC responses and the external indexer are fixture data. */
function fixture(options: {
  counts?: readonly bigint[];
  failedSlots?: readonly number[];
  malformedSlots?: readonly number[];
  failedDirect?: readonly number[];
  finalCounts?: Readonly<Record<number, bigint>>;
  aggregate?: 'revert' | 'malformed' | 'short' | 'long';
  remoteChainId?: number;
  metadataChain?: typeof mainnet | typeof base;
  foreignOwners?: boolean;
  directGate?: { pool: number; promise: Promise<void> };
  aggregateGate?: Promise<void>;
} = {}) {
  const requests: Request[] = [];
  const directReads: Read[] = [];
  const batches: Read[][] = [];
  const indexed: { wallet: string; pool: number }[] = [];
  let counts = [...options.counts ?? [0n, 0n, 0n, 0n]];
  let currentWallet = wallet;
  const read = (target: Address, data: Hex): Read => {
    const decoded = decodeFunctionData({ abi: ABI, data });
    const pool = pools.indexOf(target.toLowerCase());
    assert.notEqual(pool, -1, 'every pool call targets a reviewed position pool');
    return { pool, functionName: decoded.functionName, args: decoded.args ?? [] };
  };
  const encode = (call: Read, aggregate: boolean): Hex => {
    switch (call.functionName) {
      case 'balanceOf':
        assert.equal(String(call.args[0]).toLowerCase(), currentWallet.toLowerCase());
        return encodeFunctionResult({ abi: ABI, functionName: 'balanceOf', result: aggregate ? counts[call.pool] : options.finalCounts?.[call.pool] ?? counts[call.pool] });
      case 'getPosition': return encodeFunctionResult({ abi: ABI, functionName: 'getPosition', result: [2n * WAD, WAD] });
      case 'ownerOf': return encodeFunctionResult({ abi: ABI, functionName: 'ownerOf', result: options.foreignOwners ? otherWallet : currentWallet });
      case 'getNextPositionId': return encodeFunctionResult({ abi: ABI, functionName: 'getNextPositionId', result: 2n });
      default: throw new Error(`Unexpected contract read: ${call.functionName}`);
    }
  };
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Request;
    requests.push(request);
    let result: string;
    let rpcError = false;
    if (request.method === 'eth_chainId') result = `0x${(options.remoteChainId ?? 1).toString(16)}`;
    else {
      assert.equal(request.method, 'eth_call');
      const { to, data } = request.params![0];
      assert.ok(to && data);
      if (to.toLowerCase() === mainnet.contracts.multicall3.address.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: multicall3Abi, data });
        assert.equal(decoded.functionName, 'aggregate3');
        if (decoded.functionName !== 'aggregate3') throw new Error('Unexpected multicall method');
        const calls = decoded.args[0].map(call => read(call.target, call.callData));
        batches.push(calls);
        const isCountBatch = calls.every(call => call.functionName === 'balanceOf');
        if (isCountBatch && options.aggregateGate) await options.aggregateGate;
        if (isCountBatch && options.aggregate === 'revert') { rpcError = true; result = '0x'; }
        else if (isCountBatch && options.aggregate === 'malformed') result = '0x';
        else {
          let slots: Slot[] = calls.map(call => ({
            success: !isCountBatch || !options.failedSlots?.includes(call.pool),
            returnData: isCountBatch && options.malformedSlots?.includes(call.pool) ? '0x1234' : encode(call, true),
          }));
          if (isCountBatch && options.aggregate === 'short') slots = slots.slice(0, -1);
          if (isCountBatch && options.aggregate === 'long') slots.push({ success: true, returnData: encode(calls[0], true) });
          result = encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: slots });
        }
      } else {
        const call = read(to, data);
        directReads.push(call);
        if (call.functionName === 'balanceOf' && options.directGate?.pool === call.pool) await options.directGate.promise;
        rpcError = call.functionName === 'balanceOf' && Boolean(options.failedDirect?.includes(call.pool));
        result = rpcError ? '0x' : encode(call, false);
      }
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
      ...(rpcError ? { error: { code: 3, message: 'execution reverted: fixture unavailable' } } : { result }) }),
    { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = createPublicClient({ chain: options.metadataChain ?? mainnet,
    transport: getRpcTransport(['https://eth-mainnet.g.alchemy.com/v2/position-count-fixture'], 1, fetchFn) }) as unknown as FxPublicClient;
  const sdk = { getPositions: async ({ userAddress, market, type }: { userAddress: string; market: string; type: string }) => {
    const pool = POSITION_GROUPS.findIndex(group => group.market === market && group.side === type);
    indexed.push({ wallet: userAddress, pool });
    assert.equal(userAddress.toLowerCase(), currentWallet.toLowerCase());
    return Array.from({ length: Number(counts[pool]) }, (_, index) => info((pool + 1) * 100 + index + 1));
  } };
  return { client, sdk, requests, directReads, batches, indexed,
    set: (next: readonly bigint[], address: Address = currentWallet) => { counts = [...next]; currentWallet = address; },
    run: () => readAllPositionsFromClient({ client, sdk, walletAddress: currentWallet }),
    baseline: async () => {
      await assertPublicClientChain(client, 1);
      return settlePositionGroups(group => readPositionGroupWithDirectFallback({ client, sdk, walletAddress: currentWallet, group }));
    },
  };
}
const ethCalls = (f: ReturnType<typeof fixture>) => f.requests.filter(request => request.method === 'eth_call').length;
const directCounts = (f: ReturnType<typeof fixture>) => f.directReads.filter(read => read.functionName === 'balanceOf').map(read => read.pool);

test('empty wallet reduces four initial paid eth_call requests to one without skipping chain proof', async () => {
  const before = fixture();
  const after = fixture();
  assert.deepEqual(await after.run(), await before.baseline());
  assert.equal(ethCalls(before), 4);
  assert.equal(ethCalls(after), 1);
  assert.deepEqual(after.requests.map(request => request.method), ['eth_chainId', 'eth_call']);
  assert.deepEqual(after.batches[0].map(call => call.pool), [0, 1, 2, 3]);
  assert.equal(after.indexed.length, 0, 'authoritative empty pools require no indexer');
});

test('nonempty groups preserve rows, ownership/state checks and final count rechecks while saving three calls', async () => {
  const before = fixture({ counts: [1n, 2n, 0n, 1n] });
  const after = fixture({ counts: [1n, 2n, 0n, 1n] });
  const result = await after.run();
  assert.deepEqual(result, await before.baseline());
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.positions.map(position => position.info.positionId), [101, 201, 202, 401]);
  assert.equal(ethCalls(before), 15);
  assert.equal(ethCalls(after), 12);
  assert.deepEqual(directCounts(after).sort(), [0, 1, 3]);
  for (const fn of ['ownerOf', 'getPosition']) assert.equal(after.directReads.filter(read => read.functionName === fn).length, 4);
});

test('failed and malformed slots retry only their pools; a failed retry remains partial instead of false zero', async () => {
  const f = fixture({ counts: [1n, 1n, 0n, 0n], failedSlots: [0], malformedSlots: [1], failedDirect: [0] });
  const result = await f.run();
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.failedGroups.map(groupKey), ['ETH:long']);
  assert.deepEqual(result.successfulGroups.map(groupKey), ['ETH:short', 'BTC:long', 'BTC:short']);
  assert.deepEqual(result.positions.map(position => position.info.positionId), [201]);
  assert.deepEqual(directCounts(f).sort(), [0, 1, 1], 'one failed retry, one recovered retry, and its final count');
  assert.equal(ethCalls(f), 6);
});

for (const aggregate of ['revert', 'malformed', 'short', 'long'] as const) {
  test(`aggregate ${aggregate} falls back to exactly four direct counts`, async () => {
    const f = fixture({ aggregate });
    const result = await f.run();
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.successfulGroups, POSITION_GROUPS);
    assert.deepEqual(result.positions, []);
    assert.equal(ethCalls(f), 5);
    assert.deepEqual(directCounts(f).sort(), [0, 1, 2, 3]);
  });
}

test('aggregate and all direct count failures remain unavailable, with bounded retries', async () => {
  const f = fixture({ aggregate: 'revert', failedDirect: [0, 1, 2, 3] });
  const result = await f.run();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.successfulGroups.length, 0);
  assert.equal(result.failedGroups.length, 4);
  assert.equal(ethCalls(f), 5);
});

test('wallet and chain guards reject before any position reads', async () => {
  const invalid = fixture();
  await assert.rejects(readAllPositionsFromClient({ client: invalid.client, sdk: invalid.sdk, walletAddress: 'not-an-address' }));
  assert.equal(invalid.requests.length, 0);
  for (const options of [{ remoteChainId: 8453 }, { metadataChain: base }]) {
    const f = fixture(options);
    await assert.rejects(f.run(), /chain/i);
    assert.equal(ethCalls(f), 0);
    assert.equal(f.indexed.length, 0);
  }
});

test('the final count still rejects an ownership race after a successful batched initial count', async () => {
  const f = fixture({ counts: [1n, 0n, 0n, 0n], finalCounts: { 0: 2n } });
  const result = await f.run();
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.positions, []);
  assert.deepEqual(result.failedGroups.map(groupKey), ['ETH:long']);
  assert.match(String(result.failedGroups[0].reason), /ownership changed/);
  assert.deepEqual(f.directReads.map(read => read.functionName).sort(), ['balanceOf', 'getPosition', 'ownerOf']);
});

test('foreign indexer ownership is still rejected even when the batched count says one', async () => {
  const f = fixture({ counts: [1n, 0n, 0n, 0n], foreignOwners: true });
  const result = await f.run();
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.positions, []);
  assert.deepEqual(result.failedGroups.map(groupKey), ['ETH:long']);
  assert.ok(f.directReads.some(read => read.functionName === 'ownerOf'));
  assert.ok(f.directReads.some(read => read.functionName === 'getNextPositionId'));
});

test('every refresh and account rereads all initial counts without reusing a previous empty wallet', async () => {
  const f = fixture();
  assert.deepEqual((await f.run()).positions, []);
  f.set([1n, 0n, 0n, 0n]);
  assert.deepEqual((await f.run()).positions.map(position => position.info.positionId), [101]);
  f.set([0n, 0n, 1n, 0n], otherWallet);
  assert.deepEqual((await f.run()).positions.map(position => position.info.positionId), [301]);
  const countBatches = f.batches.filter(batch => batch.every(call => call.functionName === 'balanceOf'));
  assert.equal(countBatches.length, 3);
  assert.deepEqual(countBatches.map(batch => batch[0].args[0]), [wallet, wallet, otherWallet]);
  assert.equal(f.requests.filter(request => request.method === 'eth_chainId').length, 3);
});

test('a pending direct fallback does not block healthy pool count promises', async () => {
  const gate = deferred();
  const f = fixture({ failedSlots: [0], directGate: { pool: 0, promise: gate.promise } });
  const counts = readDirectWalletPositionCounts({ client: f.client, groups: POSITION_GROUPS, walletAddress: wallet, deadlineAt: Date.now() + 2_000 });
  const settled = Promise.allSettled(counts);
  let blockedSettled = false;
  void counts[0].then(() => { blockedSettled = true; }, () => { blockedSettled = true; });
  try {
    assert.deepEqual(await Promise.all(counts.slice(1)), [0n, 0n, 0n]);
    assert.equal(blockedSettled, false);
  } finally { gate.release(); }
  assert.ok((await settled).every(result => result.status === 'fulfilled'));
  assert.deepEqual(directCounts(f), [0]);
});

test('an expired aggregate deadline never starts direct fallbacks even before the wall clock catches up', async (t) => {
  const gate = deferred();
  const f = fixture({ aggregateGate: gate.promise });
  await assertPublicClientChain(f.client, 1);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const results = await Promise.allSettled(readDirectWalletPositionCounts({
    client: f.client, groups: POSITION_GROUPS, walletAddress: wallet, deadlineAt: Date.now() + 30,
  }));
  gate.release();
  assert.ok(results.every(result => result.status === 'rejected' && /deadline/.test(String(result.reason))));
  assert.deepEqual(directCounts(f), []);
  assert.equal(ethCalls(f), 1);
});
