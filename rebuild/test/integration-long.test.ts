import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, encodeEventTopics, encodeFunctionResult, parseAbi } from 'viem';
import type { Abi } from 'viem';
import { TradeController } from '../src/domain/controller';
import type { StoragePort } from '../src/domain/journal';
import type { Hash, PreparedLong, Runtime } from '../src/domain/ports';
import { createProtocol } from '../src/protocol/index';
import { ADDRESSES, CONVERTER_ABI, DEBT_ROUTE, FEE_ABI, INPUT_ROUTE, MANAGER_ABI, OPEN_ABI, ORACLE_ABI, POOL_ABI, WAD, WRAPPING_ABI } from '../src/protocol/contracts';
import { createBrowserWallet } from '../src/wallet/browser';

/** Composition evidence only: no HTTP connection, private key, EVM execution,
 * or fork is involved. The unit harness runs this file in its own process,
 * giving the real SDK's first-client singleton an isolated lifetime.
 */
const RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/deterministic-composition';
const GRAPH_URL = 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth/3.0.0/gn';
const OWNER = '0x1111111111111111111111111111111111111111';
const EXACT_ETH = 100_000_000_000_000_001n;
const TX_HASH: Hash = `0x${'a7'.repeat(32)}`;
const BLOCK_HASH: Hash = `0x${'b8'.repeat(32)}`;
const POSITION_ID = 7_001n;
const ACTUAL_COLLATERAL = 299_999_999_999_999_999n;
const ACTUAL_DEBT = 606n * WAD + 17n;
const PRICE = 3_000n * WAD;
const RATE = WAD * 5n / 4n;
const MULTICALL_ABI = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
const RATE_ABI = parseAbi(['function getRate() view returns (uint256)']);
const READ_ABI: Abi = [...MANAGER_ABI, ...POOL_ABI, ...FEE_ABI, ...ORACLE_ABI, ...WRAPPING_ABI, ...CONVERTER_ABI, ...RATE_ABI];
const toHex = (value: bigint): Hash => `0x${value.toString(16)}`;

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
interface RpcRequest { readonly jsonrpc: string; readonly id: number; readonly method: string; readonly params: readonly unknown[] }
interface RawTransaction { readonly from: string; readonly to: string; readonly data: Hash; readonly value: Hash; readonly nonce: Hash; readonly chainId: Hash }

test('[STEP3-COMPOSITION] exact wei passes real SDK, protocol, controller and browser wallet; canonical history reload observes without replay', { timeout: 25_000 }, async t => {
  const storage = new MemoryStorage();
  const rpcRequests: RpcRequest[] = [];
  const walletRequests: { method: string; params?: readonly unknown[] }[] = [];
  const simulations: { transaction: Record<string, unknown>; block: unknown }[] = [];
  const rawSends: RawTransaction[] = [];
  let converterReads = 0;
  let graphReads = 0;
  let ownerReads = 0;
  let accepted: PreparedLong | undefined;
  let submitted: RawTransaction | undefined;

  function readContract(transaction: { to: string; data: Hash }): Hash {
    const target = transaction.to.toLowerCase();
    if (target === '0xca11bde05977b3631167028862be2a173976ca11') {
      const decoded = decodeFunctionData({ abi: MULTICALL_ABI, data: transaction.data });
      const result = decoded.args[0].map(call => ({ success: true, returnData: readContract({ to: call.target, data: call.callData }) }));
      return encodeFunctionResult({ abi: MULTICALL_ABI, functionName: 'aggregate3', result });
    }
    const decoded = decodeFunctionData({ abi: READ_ABI, data: transaction.data });
    let result: unknown;
    switch (decoded.functionName) {
      case 'getPoolInfo':
        assert.equal(target, ADDRESSES.manager);
        result = [1_000n * WAD, 0n, 0n, 1_000_000n * WAD, 0n]; break;
      case 'paused': assert.equal(target, ADDRESSES.manager); result = false; break;
      case 'getDebtRatioRange': assert.equal(target, ADDRESSES.pool); result = [WAD / 20n, WAD * 9n / 10n]; break;
      case 'getPoolFeeRatio': assert.equal(target, ADDRESSES.configuration); result = [0n, 0n, 0n, 0n]; break;
      case 'getPrice': assert.equal(target, ADDRESSES.oracle); result = [PRICE, PRICE, PRICE]; break;
      case 'getRate': assert.equal(target, '0x81a777c4ab65229d1bf64dae4c831bdf628ccc7f'); result = RATE; break;
      case 'stEthPerToken': assert.equal(target, ADDRESSES.wstEth); result = RATE; break;
      case 'ownerOf':
        assert.ok(submitted, 'Ownership is requested only after submission');
        assert.equal(target, ADDRESSES.pool); assert.equal(decoded.args?.[0], POSITION_ID);
        ownerReads++; result = OWNER; break;
      case 'getPosition':
        assert.ok(submitted); assert.equal(target, ADDRESSES.pool); assert.equal(decoded.args?.[0], POSITION_ID);
        result = [ACTUAL_COLLATERAL, ACTUAL_DEBT]; break;
      case 'queryConvert': {
        assert.equal(target, ADDRESSES.converter); converterReads++;
        const [amount, , routes] = decoded.args as readonly [bigint, bigint, readonly bigint[]];
        if (routes.length === INPUT_ROUTE.length && routes.every((value, index) => value === INPUT_ROUTE[index])) {
          assert.equal(amount, EXACT_ETH, 'The native quote keeps the final wei');
          result = amount * WAD / RATE;
        } else if (routes.length === DEBT_ROUTE.length && routes.every((value, index) => value === DEBT_ROUTE[index])) {
          result = amount * WAD * WAD / (PRICE * RATE);
        } else {
          assert.equal(amount, 10n ** 16n, 'The only third converter path is the SDK sell-price sample');
          result = amount * PRICE * RATE / (WAD * WAD);
        }
        break;
      }
      default: throw new Error(`Unexpected deterministic contract read: ${decoded.functionName}`);
    }
    return encodeFunctionResult({ abi: READ_ABI, functionName: decoded.functionName, result });
  }

  function rpcResult(request: RpcRequest): unknown {
    const { method, params } = request;
    switch (method) {
      case 'eth_chainId': return '0x1';
      case 'eth_blockNumber': return submitted ? '0x65' : '0x64';
      case 'eth_getBalance': return toHex(2n * WAD);
      case 'eth_getTransactionCount': assert.equal(params[0], OWNER); return '0x7';
      case 'eth_estimateGas': assert.equal(params[1], 'pending'); return toHex(500_000n);
      case 'eth_feeHistory': return { oldestBlock: '0x60', baseFeePerGas: Array(6).fill(toHex(1_000_000_000n)),
        gasUsedRatio: Array(5).fill(0.5), reward: Array.from({ length: 5 }, () => [toHex(100_000_000n)]) };
      case 'eth_call': {
        const transaction = params[0] as { to: string; data: Hash } & Record<string, unknown>;
        if (transaction.to.toLowerCase() === ADDRESSES.router) {
          simulations.push({ transaction, block: params[1] });
          assert.equal(params[1], 'pending');
          assert.equal(transaction.from, OWNER); assert.equal(BigInt(String(transaction.value)), EXACT_ETH);
          assert.equal(transaction.nonce, '0x7');
          return '0x';
        }
        return readContract(transaction);
      }
      case 'eth_getTransactionByHash':
        assert.equal(params[0], TX_HASH);
        return submitted ? { ...submitted, hash: TX_HASH, input: submitted.data, blockHash: BLOCK_HASH, blockNumber: '0x65' } : null;
      case 'eth_getTransactionReceipt':
        assert.equal(params[0], TX_HASH);
        return submitted ? { transactionHash: TX_HASH, from: OWNER, to: ADDRESSES.router, blockHash: BLOCK_HASH, blockNumber: '0x65',
          status: '0x1', gasUsed: toHex(480_000n), effectiveGasPrice: toHex(1_000_000_000n), logs: [{
            address: ADDRESSES.pool, transactionHash: TX_HASH, blockHash: BLOCK_HASH, blockNumber: '0x65', logIndex: '0x0', removed: false, data: '0x',
            topics: encodeEventTopics({ abi: POOL_ABI, eventName: 'Transfer', args: { from: ADDRESSES.native, to: OWNER, tokenId: POSITION_ID } }),
          }] } : null;
      case 'eth_getBlockByNumber': assert.equal(params[0], '0x65'); return { hash: BLOCK_HASH, number: '0x65' };
      default: throw new Error(`Network access is disabled; unexpected RPC method ${method}`);
    }
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    assert.equal(init?.method, 'POST');
    if (url === GRAPH_URL) {
      const body = JSON.parse(String(init?.body)) as { query: string };
      assert.ok(body.query.includes(`owner: "${OWNER}"`)); graphReads++;
      // The real SDK reader sees a lagging index; canonical reads must still
      // establish the receipt-proven position and its distinct accounting.
      return Response.json({ data: { positions: [] } });
    }
    assert.equal(url, RPC_URL, 'No unhandled URL may escape the deterministic transport');
    const request = JSON.parse(String(init?.body)) as RpcRequest;
    assert.equal(request.jsonrpc, '2.0');
    if (request.method !== 'eth_chainId') assert.ok(rpcRequests.some(previous => previous.method === 'eth_chainId'), 'Financial reads follow a chain proof');
    rpcRequests.push(request);
    return Response.json({ jsonrpc: '2.0', id: request.id, result: rpcResult(request) });
  }) as typeof fetch;

  const provider = {
    async request(request: { method: string; params?: readonly unknown[] }): Promise<unknown> {
      walletRequests.push(request);
      if (request.method === 'eth_requestAccounts' || request.method === 'eth_accounts') return [OWNER];
      if (request.method === 'eth_chainId') return '0x1';
      assert.equal(request.method, 'eth_sendTransaction', 'Only the selected wallet may receive the one transaction request');
      assert.ok(accepted, 'Explicit review occurs before the provider request');
      assert.equal(request.params?.length, 1);
      const transaction = request.params[0] as RawTransaction;
      assert.deepEqual(transaction, { from: accepted.call.from, to: accepted.call.to, data: accepted.call.data,
        value: toHex(accepted.call.value), nonce: toHex(BigInt(accepted.call.nonce)), chainId: '0x1' });
      assert.equal(BigInt(transaction.value), EXACT_ETH);
      assert.equal(rawSends.length, 0, 'There is no replay or approval request');
      const saved = [...storage.values.values()].map(raw => JSON.parse(raw) as { hash?: string; call: { data: string; value: string } });
      assert.ok(saved.some(record => record.hash === undefined && record.call.data === transaction.data && record.call.value === String(EXACT_ETH)),
        'The exact prospective attempt is durably journaled before the prompt');
      rawSends.push(transaction); submitted = transaction;
      return TX_HASH;
    },
  };
  const disposers: (() => void)[] = [];
  t.after(() => { for (const dispose of disposers.reverse()) dispose(); globalThis.fetch = originalFetch; });
  const makeController = async (): Promise<TradeController> => {
    const wallet = createBrowserWallet({ events: new EventTarget(), injected: () => provider });
    disposers.push(() => wallet.dispose());
    await wallet.connect('injected:generic');
    const runtime: Runtime = { mode: 'simulation', wallet, protocol: createProtocol({ rpcUrls: [RPC_URL] }),
      host: { kind: 'browser', setBackHandler() {}, setTheme() {}, openWallet() {}, dispose() {} } };
    const controller = new TradeController(runtime, { storage, tickMs: 0, receiptPollMs: 1_000_000,
      withWalletLock: async (_account, task) => task() });
    disposers.push(() => controller.dispose());
    return controller;
  };

  const controller = await makeController();
  controller.setAmount('0.100000000000000001'); controller.setLeverage('3'); controller.setSlippage(100);
  await controller.refreshMarket();
  assert.equal(controller.getSnapshot().market.status, 'ready');
  await controller.prepare();
  const review = controller.getSnapshot().flow;
  assert.equal(review.stage, 'review', JSON.stringify(review, (_key, value) => typeof value === 'bigint' ? String(value) : value));
  if (review.stage !== 'review') throw new Error('Real planner did not produce a review');
  accepted = review.plan;
  assert.equal(accepted.intent.amountWei, EXACT_ETH); assert.equal(accepted.call.value, EXACT_ETH);
  assert.equal(accepted.simulation, 'passed'); assert.ok(Object.isFrozen(accepted.call));
  const decoded = decodeFunctionData({ abi: OPEN_ABI, data: accepted.call.data });
  assert.equal(decoded.args[0].amount, EXACT_ETH); assert.equal(decoded.args[2], 0n);
  assert.ok(converterReads > 100, 'The installed SDK borrowing solver evaluated the native route');
  assert.equal(rawSends.length, 0, 'Preparing review never opens a transaction prompt');
  assert.equal(storage.length, 0, 'An unsigned review is not a submitted attempt');
  const quoteReadsAtReview = converterReads;

  await controller.confirm();
  const confirmed = controller.getSnapshot().flow;
  assert.equal(confirmed.stage, 'confirmed');
  if (confirmed.stage !== 'confirmed') throw new Error('Canonical receipt did not confirm');
  assert.equal(rawSends.length, 1);
  assert.equal(converterReads, quoteReadsAtReview + 1, 'Preflight independently rechecks input conversion without replanning');
  assert.equal(simulations.length, 2, 'The same call is simulated during preparation and preflight');
  for (const simulation of simulations) {
    assert.equal(simulation.transaction.data, accepted.call.data);
    assert.equal(simulation.transaction.value, toHex(EXACT_ETH));
    assert.equal(simulation.transaction.nonce, toHex(BigInt(accepted.call.nonce)));
  }
  assert.equal(confirmed.receipt.hash, TX_HASH); assert.equal(confirmed.receipt.blockHash, BLOCK_HASH);
  assert.equal(confirmed.receipt.positionId, POSITION_ID);
  assert.equal(confirmed.receipt.position?.collateralStEthWei, ACTUAL_COLLATERAL);
  assert.equal(confirmed.receipt.position?.debtFxUsdWei, ACTUAL_DEBT);
  assert.notEqual(confirmed.receipt.position?.collateralStEthWei, accepted.economics.collateralStEthWei);
  assert.equal(confirmed.receipt.networkFeeWei, 480_000_000_000_000n);
  assert.notEqual(confirmed.receipt.networkFeeWei, accepted.estimatedNetworkFeeWei);
  assert.ok(ownerReads >= 2); assert.equal(graphReads, 1);
  const history = controller.getSnapshot().history[0]!;
  assert.equal(history.account, OWNER); assert.equal(history.amountWei, String(EXACT_ETH));
  assert.equal(history.state, 'confirmed'); assert.equal(history.verifiedInSession, true);
  assert.equal(history.receipt?.position?.debtFxUsdWei, ACTUAL_DEBT);
  controller.dispose();

  // A new controller and wallet binding recover hints, not the executable plan.
  const resumed = await makeController();
  const recovered = resumed.getSnapshot().history[0]!;
  assert.equal(recovered.id, history.id); assert.equal(recovered.hash, TX_HASH);
  assert.equal(recovered.state, 'pending'); assert.equal(recovered.verifiedInSession, false);
  assert.equal(recovered.receipt, undefined); assert.equal(resumed.getSnapshot().flow.stage, 'editing');
  await resumed.confirm(); assert.equal(rawSends.length, 1);
  const converterReadsBeforeRecovery = converterReads;
  await resumed.checkReceipt(recovered.id);
  const verifiedAgain = resumed.getSnapshot().history[0]!;
  assert.equal(verifiedAgain.state, 'confirmed'); assert.equal(verifiedAgain.verifiedInSession, true);
  assert.equal(verifiedAgain.receipt?.positionId, POSITION_ID);
  assert.equal(verifiedAgain.receipt?.position?.collateralStEthWei, ACTUAL_COLLATERAL);
  assert.equal(resumed.getSnapshot().flow.stage, 'editing', 'A restored receipt does not restore an accepted review');
  await resumed.confirm();
  assert.equal(converterReads, converterReadsBeforeRecovery, 'Recovery invokes no planner or converter quote');
  assert.equal(rawSends.length, 1); assert.equal(graphReads, 2);
  assert.equal(walletRequests.filter(request => request.method === 'eth_sendTransaction').length, 1);
  assert.ok(rpcRequests.every(request => !/send|sign/i.test(request.method)), 'The chain-read transport never signs or broadcasts');
});
