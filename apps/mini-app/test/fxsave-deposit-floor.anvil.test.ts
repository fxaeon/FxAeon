import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, parseAbi, toFunctionSelector, type Address, type Hex } from 'viem';
import type { FxSdk } from '@aladdindao/fx-sdk';

const configured = process.env.FX_DEPOSIT_FORK_RPC;
const parsed = configured ? new URL(configured) : undefined;
if (parsed && (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash)) {
  throw new Error('FX_DEPOSIT_FORK_RPC must be a local HTTP endpoint');
}
const endpoint = parsed?.toString();
const requireSdk = createRequire(import.meta.url);
const sdkDirectory = process.env.FXSAVE_TEST_SDK_DIST ?? dirname(requireSdk.resolve('@aladdindao/fx-sdk'));
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708' as Address;
const FACET = '0x56afB443dE36340c32f1a461605171992480059D' as Address;
const POOL = '0x65C9A641afCEB9C0E6034e558A319488FA0FA3be' as Address;
const DONORS = ['0xc3d688b66703497daa19211eedff47f25384cdc3', '0xf977814e90da44bfa03b6295a0616a897441acec', '0x55fe002aeff02f77364de339a1292923a15844b8'] as const;
const ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function previewDeposit(address,uint256) view returns (uint256)',
  'function facetAddress(bytes4 selector) view returns (address)',
  'function depositToFxSave((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address tokenOut,uint256 minShares,address receiver)',
  'event Deposit(address indexed caller,address indexed receiver,address indexed tokenIn,uint256 amountTokenToDeposit,uint256 amountSharesOut)',
]);

async function rpc<T>(method: string, params: readonly unknown[] = []): Promise<T> {
  const response = await fetch(endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(120_000) });
  const body = await response.json() as { result?: T; error?: { message: string; data?: unknown } };
  if (body.error) throw new Error(`${body.error.message} ${JSON.stringify(body.error.data ?? '')}`);
  return body.result as T;
}
const quantity = (n: bigint): Hex => `0x${n.toString(16)}`;
async function contractCall(to: Address, data: Hex, from?: Address): Promise<Hex> {
  return rpc('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']);
}
async function receipt<T>(hash: Hex): Promise<T> {
  for (let attempt = 0; attempt < 240; attempt++) {
    const result = await rpc<T | null>('eth_getTransactionReceipt', [hash]);
    if (result) return result;
    await delay(500);
  }
  throw new Error('Fork transaction receipt did not arrive');
}

test('forked deployed router enforces the reviewed fxSP floor at its actual boundary', { skip: !endpoint, timeout: 600_000 }, async () => {
  assert.match(await rpc<string>('web3_clientVersion'), /^anvil\//i);
  assert.equal(await rpc('eth_chainId'), '0x1');
  const metadata = await rpc<{ forkedNetwork?: { forkBlockNumber?: number } }>('anvil_metadata');
  assert.ok(metadata.forkedNetwork?.forkBlockNumber, 'a mainnet fork is required');
  const facet = decodeFunctionResult({ abi: ABI, functionName: 'facetAddress', data: await contractCall(ROUTER, encodeFunctionData({ abi: ABI, functionName: 'facetAddress', args: ['0x3ea34dc0'] })) });
  assert.equal(facet.toLowerCase(), FACET.toLowerCase());
  const wallet = (await rpc<Address[]>('eth_accounts'))[0];
  const snapshot = await rpc<string>('evm_snapshot');
  try {
    const amount = 100_000_000n;
    let donor: Address | undefined;
    for (const candidate of DONORS) {
      const balance = BigInt(await contractCall(TOKEN, encodeFunctionData({ abi: ABI, functionName: 'balanceOf', args: [candidate] })));
      if (balance >= amount) { donor = candidate; break; }
    }
    assert.ok(donor, 'a forked USDC donor must have sufficient balance');
    await rpc('anvil_impersonateAccount', [donor]);
    await rpc('anvil_setBalance', [donor, quantity(10n ** 19n)]);
    const fundingHash = await rpc<Hex>('eth_sendTransaction', [{ from: donor, to: TOKEN, data: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [wallet, amount] }) }]);
    const funding = await receipt<{ status: Hex }>(fundingHash);
    assert.equal(funding.status, '0x1');
    await rpc('anvil_stopImpersonatingAccount', [donor]);
    const approveHash = await rpc<Hex>('eth_sendTransaction', [{ from: wallet, to: TOKEN, data: encodeFunctionData({ abi: ABI, functionName: 'approve', args: [ROUTER, amount] }) }]);
    assert.equal((await receipt<{ status: Hex }>(approveHash)).status, '0x1');

    const { FxSdk: Sdk } = requireSdk(resolve(sdkDirectory, 'index.cjs')) as { FxSdk: typeof FxSdk };
    const sdk = new Sdk({ chainId: 1, rpcUrl: endpoint });
    const preview = BigInt(await contractCall(POOL, encodeFunctionData({ abi: ABI, functionName: 'previewDeposit', args: [TOKEN, amount] })));
    const plan = await sdk.depositFxSave({ userAddress: wallet, tokenIn: 'usdc', amount, slippage: 0.5 });
    const action = plan.txs.at(-1)!;
    assert.equal(action.to.toLowerCase(), ROUTER.toLowerCase());
    const decoded = decodeFunctionData({ abi: ABI, data: action.data as Hex });
    assert.equal(decoded.functionName, 'depositToFxSave');
    if (decoded.functionName !== 'depositToFxSave') throw new Error('Unexpected action');
    assert.equal(decoded.args[2], (preview * 9950n + 9999n) / 10000n);

    const beforeAction = await rpc<string>('evm_snapshot');
    const actionHash = await rpc<Hex>('eth_sendTransaction', [{ from: wallet, to: ROUTER, data: action.data, gas: '0x5b8d80' }]);
    const actionReceipt = await receipt<{ status: Hex; logs: Array<{ address: Address; data: Hex; topics: [Hex, ...Hex[]] }> }>(actionHash);
    assert.equal(actionReceipt.status, '0x1', 'reviewed floor must succeed against the deployed router');
    const deposit = actionReceipt.logs.filter(log => log.address.toLowerCase() === POOL.toLowerCase()).flatMap(log => {
      try { const event = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics }); return event.eventName === 'Deposit' ? [event.args] : []; } catch { return []; }
    })[0];
    assert.ok(deposit, 'base pool must emit its actual minted-share amount');
    const minted = deposit.amountSharesOut;
    assert.ok(minted >= decoded.args[2]);
    console.log(`fork block=${metadata.forkedNetwork.forkBlockNumber} previewFxSP=${preview} reviewedMinimumFxSP=${decoded.args[2]} mintedFxSP=${minted}`);
    assert.equal(await rpc('evm_revert', [beforeAction]), true);
    const withFloor = (minimum: bigint) => encodeFunctionData({ abi: ABI, functionName: 'depositToFxSave', args: [decoded.args[0], decoded.args[1], minimum, decoded.args[3]] });
    await contractCall(ROUTER, withFloor(minted), wallet);
    const insufficientShares = toFunctionSelector('ErrInsufficientSharesOut()');
    await assert.rejects(contractCall(ROUTER, withFloor(minted + 1n), wallet), error => error instanceof Error && error.message.toLowerCase().includes(insufficientShares.toLowerCase()));
  } finally {
    assert.equal(await rpc('evm_revert', [snapshot]), true);
  }
});
