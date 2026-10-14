import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import type { FxSdk, FxSdkConfig } from '@aladdindao/fx-sdk';
import { custom, decodeFunctionData, encodeFunctionResult, parseAbi, type Hex } from 'viem';

const requireSdk = createRequire(import.meta.url);
const sdkDirectory = dirname(requireSdk.resolve('@aladdindao/fx-sdk'));
const importNative = new Function('url', 'return import(url)') as (url: string) => Promise<{ FxSdk: typeof FxSdk }>;
const WALLET = '0x1111111111111111111111111111111111111111';
const WAD = 10n ** 18n;
function timeIndependentPlan(plan: object) {
  const quote = (plan as { fxSaveQuote?: Record<string, unknown> }).fxSaveQuote;
  return quote ? { ...plan, fxSaveQuote: { ...quote, readAt: 0 } } : plan;
}
const ABI = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function queryConvert(uint256 amount,uint256 encoding,uint256[] routes) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256,uint256)',
  'function instantRedeemFeeRatio() view returns (uint256)',
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function deposit(uint256 assets,address receiver) returns (uint256 shares)',
  'function redeem(uint256 shares,address receiver,address owner) returns (uint256 assets)',
  'function requestRedeem(uint256 shares)',
  'function instantRedeemFromFxSave((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) fxusdParams,(address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) usdcParams,uint256 amount,address receiver)',
]);

// Decode actual installed planners through an in-memory RPC transport. These
// checks establish which settings affect a route, without sending transactions
// or replacing the pinned SDK's arithmetic or policy validation.
for (const bundle of ['ESM', 'CommonJS'] as const) {
  test(`installed ${bundle} Earn routes use slippage only for instant stable withdrawals`, async (context) => {
    const { FxSdk: Sdk } = bundle === 'ESM'
      ? await importNative(pathToFileURL(resolve(sdkDirectory, 'index.js')).href)
      : requireSdk('@aladdindao/fx-sdk') as { FxSdk: typeof FxSdk };
    let quoteClock = Date.now();
    context.mock.method(Date, 'now', () => quoteClock);
    async function planAtFreshTime<T extends object>(build: () => Promise<T>, expectsQuote = true): Promise<T> {
      quoteClock += 1;
      const plan = await build();
      const quote = (plan as { fxSaveQuote?: { readAt: number } }).fxSaveQuote;
      if (expectsQuote) {
        assert.ok(quote, 'an executable savings quote preserves its accepted metadata');
        assert.ok(Number.isSafeInteger(quote.readAt) && quote.readAt > 0);
        assert.equal(quote.readAt, quoteClock, 'each plan records its own strictly advancing read time');
      } else {
        assert.equal(quote, undefined, 'a queued withdrawal does not invent an accepted receive quote');
      }
      return plan;
    }
    let allowance = 0n;
    function read(data: Hex): Hex {
      const decoded = decodeFunctionData({ abi: ABI, data });
      switch (decoded.functionName) {
        case 'aggregate3': return encodeFunctionResult({ abi: ABI, functionName: 'aggregate3', result: decoded.args[0].map(call => ({ success: true, returnData: read(call.callData) })) });
        case 'allowance': return encodeFunctionResult({ abi: ABI, functionName: 'allowance', result: allowance });
        case 'queryConvert': return encodeFunctionResult({ abi: ABI, functionName: 'queryConvert', result: decoded.args[0] });
        case 'convertToAssets': return encodeFunctionResult({ abi: ABI, functionName: 'convertToAssets', result: 125n * WAD / 100n });
        case 'previewRedeem': return encodeFunctionResult({ abi: ABI, functionName: 'previewRedeem', result: [100n * WAD + 123n, 50_000_017n] });
        case 'instantRedeemFeeRatio': return encodeFunctionResult({ abi: ABI, functionName: 'instantRedeemFeeRatio', result: 0n });
        default: throw new Error(`Unexpected mock call: ${decoded.functionName}`);
      }
    }
    const sdk = new Sdk({ chainId: 1, rpcUrl: 'https://example.invalid', rpcTransport: custom({
      request: async ({ method, params }) => {
        if (method === 'eth_getTransactionCount') return '0x4';
        if (method === 'eth_call') return read((params as [{ data: Hex }])[0].data);
        throw new Error(`Unexpected RPC method: ${method}`);
      },
    }, { retryCount: 0 }) as unknown as FxSdkConfig['rpcTransport'] });
    const amount = 10n * WAD + 1n;
    for (allowance of [0n, amount]) {
      const deposit = await planAtFreshTime(() => sdk.depositFxSave({ userAddress: WALLET, tokenIn: 'fxUSDBasePool', amount }));
      for (const slippage of [0.01, 0.29, 0.5, 2]) {
        const plan = await planAtFreshTime(() => sdk.depositFxSave({ userAddress: WALLET, tokenIn: 'fxUSDBasePool', amount, slippage }));
        assert.deepEqual(timeIndependentPlan(plan), timeIndependentPlan(deposit));
      }
      assert.equal(deposit.txs.length, allowance === 0n ? 2 : 1);
      const decoded = decodeFunctionData({ abi: ABI, data: deposit.txs.at(-1)!.data as Hex });
      assert.equal(decoded.functionName, 'deposit');
      assert.deepEqual(decoded.args, [amount, WALLET]);
    }
    for (const tokenOut of ['usdc', 'fxUSD', 'fxUSDBasePool'] as const) {
      const request = { userAddress: WALLET, tokenOut, amount, instant: false };
      const reference = await planAtFreshTime(() => sdk.withdrawFxSave(request), tokenOut === 'fxUSDBasePool');
      for (const slippage of [0.01, 0.29, 0.5, 2]) {
        const plan = await planAtFreshTime(() => sdk.withdrawFxSave({ ...request, slippage }), tokenOut === 'fxUSDBasePool');
        assert.deepEqual(timeIndependentPlan(plan), timeIndependentPlan(reference));
      }
      assert.equal(reference.txs.length, 1);
      const decoded = decodeFunctionData({ abi: ABI, data: reference.txs[0].data as Hex });
      assert.equal(decoded.functionName, tokenOut === 'fxUSDBasePool' ? 'redeem' : 'requestRedeem');
      assert.deepEqual(decoded.args, tokenOut === 'fxUSDBasePool' ? [amount, WALLET, WALLET] : [amount]);
    }
    for (const tokenOut of ['usdc', 'fxUSD'] as const) {
      for (allowance of [0n, amount]) {
        const request = { userAddress: WALLET, tokenOut, amount, instant: true };
        await assert.rejects(sdk.withdrawFxSave(request), /Slippage must be/);
        let previousMinima: readonly bigint[] | undefined;
        for (const slippage of [0.01, 0.29, 0.5, 2]) {
          const plan = await planAtFreshTime(() => sdk.withdrawFxSave({ ...request, slippage }));
          assert.equal(plan.txs.length, allowance === 0n ? 2 : 1);
          const action = plan.txs.at(-1)!;
          const decoded = decodeFunctionData({ abi: ABI, data: action.data as Hex });
          assert.equal(decoded.functionName, 'instantRedeemFromFxSave');
          if (decoded.functionName !== 'instantRedeemFromFxSave') throw new Error('Unexpected withdrawal action');
          const minima = [decoded.args[0].minOut, decoded.args[1].minOut];
          assert.ok(minima.every(minimum => minimum > 0n));
          if (previousMinima) assert.ok(minima.every((minimum, index) => minimum < previousMinima![index]));
          previousMinima = minima;
          assert.equal(decoded.args[2], amount);
          assert.equal(decoded.args[3], WALLET);
          assert.equal(action.nonce, allowance === 0n ? 5 : 4);
          assert.equal(action.value, 0n);
        }
      }
    }
  });
}
