import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type { BridgePreview } from '../src/lib/fx/bridgePreview';
const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild');
function fixture() {
  let now = 1_800_000_000_000;
  let resolveGas!: (value: unknown) => void;
  let rejectGas!: (error: Error) => void;
  const gas = new Promise((resolve, reject) => { resolveGas = resolve; rejectGas = reject; });
  const client = { getBlockNumber: async () => 123n, getBalance: async () => 100n, readContract: async () => [{}, [], { amountReceivedLD: 99n }] };
  const imports: Record<string, unknown> = {
    viem: { parseAbi: () => [] },
    './bridge': { planBridge: async () => ({ chainId: 1, quote: { nativeFee: 2n, minAmountLD: 98n, amountLD: 100n }, transactions: [{ to: 'source' }] }), resolveBridgeTokenAddress: () => 'destination', resolveBridgeApprovalTokenAddress: () => 'token', getBridgeApprovalAllowance: async () => 100n },
    './clients': { getPublicClient: () => client, assertPublicClientChain: async () => undefined },
    './validation': { validateBridgeRoute: () => undefined },
    './readFacade': { withReadDeadline: (promise: Promise<unknown>) => promise },
    './gasCost': { estimatePlannedRouteCost: () => gas, networkFeeWei: () => 3n },
  };
  const module = { exports: {} as { fetchBridgePreview: (params: object, update?: (value: BridgePreview) => void) => Promise<BridgePreview> } };
  const source = readFileSync(new URL('../src/lib/fx/bridgePreview.ts', import.meta.url), 'utf8');
  runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports, require: (name: string) => imports[name], Date: { now: () => now } });
  const updates: BridgePreview[] = [];
  return { read: () => module.exports.fetchBridgePreview({ sourceChainId: 1, destinationChainId: 8453, amount: 100n, wallet: 'wallet', recipient: 'recipient', token: 'fxUSD' }, value => updates.push(value)), updates, resolveGas, rejectGas,
    expire: () => { now += 30_000; }, cost: () => ({ status: 'current', validUntil: now + 10_000 }), flush: async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}

test('verified amounts resolve before deferred gas and enrichment retains the original observation', async () => {
  const h = fixture();
  const initial = await h.read();
  assert.equal(initial.estimatedReceived, 99n);
  assert.equal(initial.minimumReceived, 98n);
  assert.equal(initial.nativeFee, 2n);
  assert.equal(initial.sourceGas, undefined);
  assert.equal(h.updates.length, 0);
  h.resolveGas(h.cost()); await h.flush();
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].sourceGas, 3n);
  assert.equal(h.updates[0].readAt, initial.readAt);
  assert.equal(h.updates[0].estimatedReceived, initial.estimatedReceived);
});

test('late gas cannot renew an expired preview and failed gas never rejects the verified amounts', async () => {
  const expired = fixture(); const initial = await expired.read();
  expired.expire(); expired.resolveGas(expired.cost()); await expired.flush();
  assert.equal(expired.updates.length, 0);
  assert.equal(initial.sourceGas, undefined);
  const failed = fixture(); const receipt = await failed.read();
  failed.rejectGas(new Error('Gas unavailable')); await failed.flush();
  assert.equal(receipt.estimatedReceived, 99n);
  assert.equal(failed.updates.length, 0);
});
