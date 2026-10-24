import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFunctionData, erc20Abi, multicall3Abi, decodeFunctionResult } from 'viem';
import { galleryRpcResult } from '../e2e/fixtures/refinement-gallery';
import { FX_TOKENS } from '../src/lib/fx/tokens';

const owner = '0x930f0000000000000000000000000000000098b9' as const;
const balanceCall = { to: FX_TOKENS.USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) };

test('gallery balances distinguish positive, verified zero, and failed reads', () => {
  assert.equal(BigInt(galleryRpcResult('eth_getBalance', [owner, 'latest'], 1) as string), 1_250_000_000_000_000_000n);
  assert.equal(BigInt(galleryRpcResult('eth_call', [balanceCall, 'latest'], 1) as string), 4_500_000_000n);
  assert.equal(galleryRpcResult('eth_getBalance', [owner, 'latest'], 1, 'zero'), '0x0');
  assert.equal(BigInt(galleryRpcResult('eth_call', [balanceCall, 'latest'], 1, 'zero') as string), 0n);
  assert.equal(galleryRpcResult('eth_chainId', [], 8453, 'unavailable'), '0x2105');
  assert.throws(() => galleryRpcResult('eth_getBalance', [owner, 'latest'], 1, 'unavailable'), /unavailable/);
  assert.throws(() => galleryRpcResult('eth_call', [balanceCall, 'latest'], 1, 'unavailable'), /unavailable/);
});

test('zero state propagates through multicall without fabricating unknown token balances', () => {
  const data = encodeFunctionData({ abi: multicall3Abi, functionName: 'aggregate3', args: [[
    { target: balanceCall.to, callData: balanceCall.data, allowFailure: true },
    { target: owner, callData: balanceCall.data, allowFailure: true },
  ]] });
  const result = galleryRpcResult('eth_call', [{ to: owner, data }, 'latest'], 1, 'zero') as `0x${string}`;
  const decoded = decodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', data: result });
  assert.equal(decoded[0].success, true);
  assert.equal(BigInt(decoded[0].returnData), 0n);
  assert.equal(decoded[1].success, false);
  assert.throws(() => galleryRpcResult('eth_call', [{ ...balanceCall, to: owner }, 'latest'], 1, 'zero'), /does not define balanceOf/);
});

test('gallery never supports wallet signing or transaction broadcasts', () => {
  for (const state of ['funded', 'zero', 'unavailable'] as const) {
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_signTypedData_v4']) {
      assert.throws(() => galleryRpcResult(method, [], 1, state));
    }
  }
});
