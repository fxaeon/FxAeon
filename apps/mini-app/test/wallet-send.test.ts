import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { prepareWalletSend, prepareWalletSendMax, transferPayload, type SendInput } from '../src/lib/walletSend';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { buildGasTierQuotesFromPrices } from '../src/lib/fx/gasFeePolicy';
import { clearPendingHashJournalForTests, recordPendingHash, readPendingHashJournal } from '../src/lib/fx/journal';
const wallet = '0x1111111111111111111111111111111111111111' as Address;
const recipient = '0x2222222222222222222222222222222222222222' as Address;
const input: SendInput = { walletAddress: wallet, recipient, chainId: 1, tokenAddress: null, amount: '0.1', tier: 'standard' };
function deps(overrides: Record<string, unknown> = {}, chainId: 1 | 8453 = 1) {
  return { client: { getChainId: async () => chainId, getBalance: async () => 10n ** 18n, readContract: async () => 100_000_000n,
    getTransactionCount: async () => 7, estimateGas: async () => 21_000n, call: async () => ({ data: '0x' }), ...overrides } as never,
    fetchFees: async () => buildGasTierQuotesFromPrices(chainId, 10n, { standard: 12n, fast: 15n, rapid: 20n }, 'rpc', Date.now(), Date.now()) };
}
test('send builds exact native value and ERC20 transfer, without approvals', () => {
  assert.equal(transferPayload(input).value, 100000000000000000n);
  const token = transferPayload({ ...input, tokenAddress: FX_TOKENS.USDC.address, amount: '1.234567' });
  assert.equal(token.value, 0n);
  assert.equal(token.to, FX_TOKENS.USDC.address);
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: token.data }), { functionName: 'transfer', args: [recipient, 1234567n] });
});
test('rejects unsupported tokens, zero recipient, excess precision and invalid amounts', () => {
  for (const change of [{ tokenAddress: recipient }, { recipient: '0x0000000000000000000000000000000000000000' as Address },
    { tokenAddress: FX_TOKENS.USDC.address, amount: '0.0000001' }, { amount: '1e5' }, { amount: '-1' }, { amount: '0' }]) assert.throws(() => transferPayload({ ...input, ...change }));
});
test('fees use live tiers, gas headroom and an exact native reserve', async () => {
  const standard = await prepareWalletSend(input, deps());
  const rapid = await prepareWalletSend({ ...input, tier: 'rapid' }, deps());
  assert.equal(standard.estimatedFee, 21_000n * 12n);
  assert.equal(standard.requiredNative, standard.value + 25_200n * 22n);
  assert.equal(rapid.maxFeePerGas, 30n);
  assert.equal(rapid.maxPriorityFeePerGas, 10n);
  assert.equal(rapid.nonce, 7);
});
test('rejects insufficient gas funds, wrong chain and ERC20 false return', async () => {
  await assert.rejects(prepareWalletSend(input, deps({ getBalance: async () => 100000000000000000n })), /network cost/);
  await assert.rejects(prepareWalletSend(input, deps({}, 8453)), /chain/);
  await assert.rejects(prepareWalletSend({ ...input, tokenAddress: FX_TOKENS.USDC.address }, deps({ call: async () => ({ data: `0x${'0'.repeat(64)}` }) })), /rejected/);
});
test('Base requires and includes L1 and operator cost', async () => {
  await assert.rejects(prepareWalletSend({ ...input, chainId: 8453 }, deps({}, 8453)), /Base network cost/);
  const quote = await prepareWalletSend({ ...input, chainId: 8453 }, deps({ estimateL1Fee: async () => 1000n, estimateOperatorFee: async () => 200n }, 8453));
  assert.equal(quote.estimatedFee, 21_000n * 12n + 1200n);
  assert.equal(quote.requiredNative, quote.value + 25_200n * 22n + 1440n);
});

test('native Send Max verifies the exact amount and real contract recipient reserve', async () => {
  const calls: Array<{ to: Address; value: bigint }> = [];
  const result = await prepareWalletSendMax(input, 10n ** 18n, deps({
    estimateGas: async (tx: { to: Address; value: bigint }) => { calls.push(tx); return tx.to === recipient ? 50_000n : 21_000n; },
  }));
  assert.equal(result.amountWei, 10n ** 18n - 60_000n * 22n);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((tx) => tx.to === recipient));
  assert.equal(calls.at(-1)?.value, result.amountWei);
  assert.ok(result.validUntil > Date.now());
});

test('native Send Max includes buffered Base fees and rejects an unavailable fee component', async () => {
  const baseInput = { ...input, chainId: 8453 as const };
  const result = await prepareWalletSendMax(baseInput, 10n ** 18n, deps({ estimateL1Fee: async () => 1000n, estimateOperatorFee: async () => 200n }, 8453));
  assert.equal(result.amountWei, 10n ** 18n - 25_200n * 22n - 1440n);
  await assert.rejects(prepareWalletSendMax(baseInput, 10n ** 18n, deps({}, 8453)), /Base network cost is unavailable/);
  await assert.rejects(prepareWalletSendMax(input, 100n, deps({ getBalance: async () => 100n })), /Not enough ETH/);
});
test('a submitted send persists with its nonce and stays pending', () => {
  clearPendingHashJournalForTests();
  recordPendingHash({ operation: 'sendAsset', stepKind: 'action', intent: 'Send', walletAddress: wallet, chainId: 1,
    hash: `0x${'a'.repeat(64)}` as Hex, to: recipient, value: 1n, data: '0x', nonce: 7 });
  const [record] = readPendingHashJournal();
  assert.equal(record.operation, 'sendAsset'); assert.equal(record.status, 'pending'); assert.equal(record.nonce, 7);
  clearPendingHashJournalForTests();
});
