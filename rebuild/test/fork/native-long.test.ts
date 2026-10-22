import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData } from 'viem';
import { TradeController } from '../../src/domain/controller';
import type { StoragePort } from '../../src/domain/journal';
import type { Address, PreparedLong, Runtime } from '../../src/domain/ports';
import { createProtocol } from '../../src/protocol/index';
import { ADDRESSES, OPEN_ABI, POOL_ABI } from '../../src/protocol/contracts';
import { createBrowserWallet } from '../../src/wallet/browser';
import { GuardedFork, hash, invariant, loopbackUrl, quantity, record } from './guard';
import { validateProof } from './manifest';
import type { NativeLongProof } from './manifest';
import { disposableProvider } from './provider';

class DurableTestStorage implements StoragePort {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const EXACT_WEI = 100_000_000_000_000_001n;

// This case is intentionally absent from ordinary unit discovery. Run only with
// scripts/fork-run.mjs. Missing access is a real failure, never a skipped test.
test('[FORK-NATIVE-LONG] real f(x) contracts receive the exact production review and recovery never resends', { timeout: 150_000 }, async t => {
  const startedAt = new Date().toISOString();
  const local = loopbackUrl(process.env.FX_REBUILD_FORK_RPC ?? '');
  invariant(process.env.FX_REBUILD_FORK_BASE && /^[1-9][0-9]*$/.test(process.env.FX_REBUILD_FORK_BASE), 'The dedicated launcher must provide the pinned fork block.');
  const expected = { blockNumber: BigInt(process.env.FX_REBUILD_FORK_BASE),
    blockHash: hash(process.env.FX_REBUILD_FORK_HASH), instanceId: hash(process.env.FX_REBUILD_FORK_INSTANCE) };
  const runId = process.env.FX_REBUILD_FORK_RUN;
  invariant(runId && /^[0-9a-f-]{36}$/.test(runId), 'The dedicated launcher must provide a fresh run ID.');
  const sourceManifestHash = process.env.FX_REBUILD_FORK_SOURCE;
  invariant(sourceManifestHash && /^[0-9a-f]{64}$/.test(sourceManifestHash), 'The dedicated launcher must provide its source manifest hash.');
  const proofPath = resolve(process.env.FX_REBUILD_FORK_PROOF ?? '');
  const ownedResults = fileURLToPath(new URL('./results/', import.meta.url));
  invariant(dirname(proofPath) + '/' === ownedResults && proofPath.endsWith('/native-long-proof.json'), 'The proof file must stay inside the owned fork results directory.');
  const upstreamKeys = ['ANVIL_FORK_URL', 'NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL', 'ALCHEMY_RPC_URL', 'VITE_ETHEREUM_RPC_URLS'];
  assert.ok(upstreamKeys.every(name => !process.env[name]), 'The execution process must not inherit any upstream RPC configuration');

  const originalFetch = globalThis.fetch;
  let localRequests = 0;
  // All protocol data and sends go to the owned local process. The SDK's
  // external index is explicitly unavailable, never replaced with fake data.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    invariant(new URL(url).href === local, 'External indexing and RPC access are disabled inside the actual fork case.');
    localRequests++;
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const fork = new GuardedFork(local, expected);
  const identity = await fork.prove();
  const snapshot = await fork.snapshot();
  t.after(async () => { await fork.revert(snapshot); });
  let accepted: PreparedLong | undefined;
  const provider = await disposableProvider(fork, () => accepted?.call);
  const storage = new DurableTestStorage();
  const controllers: TradeController[] = [];
  const wallets: ReturnType<typeof createBrowserWallet>[] = [];
  t.after(() => { controllers.forEach(value => value.dispose()); wallets.forEach(value => value.dispose()); });
  const makeController = async () => {
    const wallet = createBrowserWallet({ events: new EventTarget(), injected: () => provider });
    wallets.push(wallet);
    await wallet.connect('injected:generic');
    const runtime: Runtime = { mode: 'fork', wallet, protocol: createProtocol({ rpcUrls: [local], allowLocalFork: true }),
      host: { kind: 'browser', setBackHandler() {}, setTheme() {}, openWallet() {}, dispose() {} } };
    const controller = new TradeController(runtime, { storage, tickMs: 0, receiptPollMs: 1_000_000,
      withWalletLock: async (_account, work) => work() });
    controllers.push(controller);
    return controller;
  };

  const controller = await makeController();
  const balanceBefore = quantity(await fork.read('eth_getBalance', [provider.address, 'latest']));
  assert.equal(balanceBefore, 2n * 10n ** 18n);
  controller.setAmount('0.100000000000000001'); controller.setLeverage('3'); controller.setSlippage(100);
  await controller.refreshMarket();
  assert.equal(controller.getSnapshot().market.status, 'ready', 'Real pool data must load; unavailable data cannot authorize this proof');
  await controller.prepare();
  const review = controller.getSnapshot().flow;
  assert.equal(review.stage, 'review', 'Real SDK planning, decoded policy, independent economics and simulation must all succeed');
  if (review.stage !== 'review') throw new Error('The actual protocol could not prepare a review.');
  accepted = review.plan;
  assert.equal(accepted.call.value, EXACT_WEI); assert.equal(accepted.intent.amountWei, EXACT_WEI);
  assert.equal(accepted.call.from, provider.address); assert.equal(accepted.call.to, ADDRESSES.router);
  assert.equal(accepted.simulation, 'passed');
  const decoded = decodeFunctionData({ abi: OPEN_ABI, data: accepted.call.data });
  assert.equal(decoded.args[0].amount, EXACT_WEI); assert.equal(decoded.args[1].toLowerCase(), ADDRESSES.pool); assert.equal(decoded.args[2], 0n);
  assert.equal(provider.issued, 0, 'Preparation must not request a signature');
  assert.equal(storage.length, 0);

  await controller.confirm();
  assert.equal(provider.issued, 1, 'Exactly one disposable wallet signing request is required');
  assert.equal(provider.submitted.length, 1, 'There is no approval or second transaction');
  const transactionHash = provider.submitted[0]!.hash;
  assert.deepEqual(provider.submitted[0]!.call, accepted.call);
  let flow = controller.getSnapshot().flow;
  for (let attempt = 0; flow.stage !== 'confirmed' && attempt < 6; attempt++) {
    const history = controller.getSnapshot().history.find(value => value.hash === transactionHash);
    assert.ok(history, 'The real dispatch must have a recoverable journal entry');
    await controller.checkReceipt(history.id);
    flow = controller.getSnapshot().flow;
    if (flow.stage !== 'confirmed') await new Promise(resolveTick => setTimeout(resolveTick, 250));
  }
  assert.equal(flow.stage, 'confirmed', 'Canonical receipt, unambiguous mint and current ownership are required');
  if (flow.stage !== 'confirmed') throw new Error('The local transaction did not establish a verified position.');
  const receipt = flow.receipt;
  assert.equal(receipt.status, 'success'); assert.equal(receipt.hash, transactionHash);
  assert.ok(receipt.positionId && receipt.positionId > 0n);
  assert.ok(receipt.position && receipt.position.collateralStEthWei > 0n && receipt.position.debtFxUsdWei > 0n);
  assert.ok(receipt.blockNumber > identity.blockNumber); assert.ok(receipt.networkFeeWei > 0n);
  const mined = record(await fork.read('eth_getTransactionByHash', [transactionHash]));
  assert.equal(mined.input, accepted.call.data); assert.equal(quantity(mined.value), EXACT_WEI);
  assert.equal(quantity(mined.nonce), BigInt(accepted.call.nonce)); assert.equal(hash(mined.blockHash), receipt.blockHash);
  assert.equal(String(mined.from).toLowerCase(), provider.address); assert.equal(String(mined.to).toLowerCase(), ADDRESSES.router);
  const rawReceipt = record(await fork.read('eth_getTransactionReceipt', [transactionHash]));
  assert.equal(quantity(rawReceipt.status), 1n); assert.equal(quantity(rawReceipt.gasUsed) * quantity(rawReceipt.effectiveGasPrice), receipt.networkFeeWei);
  const block = record(await fork.read('eth_getBlockByNumber', [`0x${receipt.blockNumber.toString(16)}`, false]));
  assert.equal(hash(block.hash), receipt.blockHash);
  const ownerData = await fork.read('eth_call', [{ to: ADDRESSES.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'ownerOf', args: [receipt.positionId] }) }, 'latest']);
  const owner = decodeFunctionResult({ abi: POOL_ABI, functionName: 'ownerOf', data: ownerData as Address }).toLowerCase();
  assert.equal(owner, provider.address);
  const positionData = await fork.read('eth_call', [{ to: ADDRESSES.pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'getPosition', args: [receipt.positionId] }) }, 'latest']);
  const [collateral, debt] = decodeFunctionResult({ abi: POOL_ABI, functionName: 'getPosition', data: positionData as Address });
  assert.equal(collateral, receipt.position.collateralStEthWei); assert.equal(debt, receipt.position.debtFxUsdWei);
  const balanceAfter = quantity(await fork.read('eth_getBalance', [provider.address, 'latest']));
  assert.equal(balanceBefore - balanceAfter, EXACT_WEI + receipt.networkFeeWei);
  const history = controller.getSnapshot().history[0]!;
  assert.equal(history.hash, transactionHash); assert.equal(history.state, 'confirmed'); assert.equal(history.verifiedInSession, true);
  controller.dispose(); wallets[0]!.dispose(); accepted = undefined;

  const resumed = await makeController();
  const recovered = resumed.getSnapshot().history[0]!;
  assert.equal(recovered.hash, transactionHash); assert.equal(recovered.state, 'pending'); assert.equal(recovered.verifiedInSession, false);
  assert.equal(recovered.receipt, undefined); assert.equal(resumed.getSnapshot().flow.stage, 'editing');
  await resumed.confirm(); assert.equal(provider.issued, 1);
  const readsBeforeRecovery = localRequests;
  await resumed.checkReceipt(recovered.id);
  const checked = resumed.getSnapshot().history[0]!;
  assert.ok(localRequests > readsBeforeRecovery, 'Recovery must repeat actual canonical reads');
  assert.equal(checked.verifiedInSession, true); assert.equal(checked.receipt?.positionId, receipt.positionId);
  assert.equal(checked.receipt?.position?.collateralStEthWei, collateral); assert.equal(checked.receipt?.position?.debtFxUsdWei, debt);
  await resumed.confirm(); assert.equal(provider.issued, 1); assert.equal(provider.submitted.length, 1);
  await fork.prove();

  const proof: NativeLongProof = {
    schemaVersion: 1, kind: 'fxaeon-native-long-fork', runId, sourceManifestHash, startedAt, completedAt: new Date().toISOString(),
    fork: { blockNumber: String(identity.blockNumber), blockHash: identity.blockHash, instanceId: identity.instanceId, clientVersion: identity.clientVersion },
    review: { from: review.plan.call.from, to: review.plan.call.to, data: review.plan.call.data, valueWei: String(EXACT_WEI),
      nonce: review.plan.call.nonce, minimumWstEthWei: String(review.plan.economics.minimumWstEthWei) },
    execution: { hash: transactionHash, blockHash: receipt.blockHash, blockNumber: String(receipt.blockNumber), status: 'success',
      minedData: String(mined.input), minedValueWei: String(quantity(mined.value)), minedNonce: Number(quantity(mined.nonce)),
      positionId: String(receipt.positionId), currentOwner: owner, collateralStEthWei: String(collateral), debtFxUsdWei: String(debt),
      networkFeeWei: String(receipt.networkFeeWei), balanceBeforeWei: String(balanceBefore), balanceAfterWei: String(balanceAfter) },
    recovery: { hash: transactionHash, positionId: String(receipt.positionId), dispatchesBefore: 1, dispatchesAfter: provider.issued, canonicalReadsRepeated: true },
  };
  validateProof(proof, { ...identity, runId, sourceManifestHash });
  mkdirSync(ownedResults, { recursive: true });
  const temporary = `${proofPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 }); renameSync(temporary, proofPath);
});
