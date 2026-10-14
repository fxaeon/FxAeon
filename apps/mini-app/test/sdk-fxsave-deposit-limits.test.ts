import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import type { FxSdk, FxSdkConfig } from '@aladdindao/fx-sdk';
import { custom, decodeFunctionData, encodeFunctionResult, parseAbi, type Hex } from 'viem';

const requireSdk = createRequire(import.meta.url);
const sdkDirectory = dirname(requireSdk.resolve('@aladdindao/fx-sdk'));
// Native import ensures both distributed bundles run even when tsx compiles
// this test as CommonJS; each bundle owns its own internal client singleton.
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
  'function previewDeposit(address token,uint256 amount) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function deposit(uint256 assets,address receiver) returns (uint256 shares)',
  'function depositToFxSave((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address tokenOut,uint256 minShares,address receiver)',
]);

// Exercise the installed planner with a strictly in-memory transport. These
// fixtures document the pinned SDK limitation, not a promised final-share
// tolerance. The app must disclose it without rewriting financial calldata.
for (const bundle of ['ESM', 'CommonJS'] as const) {
  test(`installed ${bundle} fxSAVE stable deposits ignore selected slippage and retain the exact SDK floor`, async (context) => {
    const { FxSdk: Sdk } = bundle === 'ESM'
      ? await importNative(pathToFileURL(resolve(sdkDirectory, 'index.js')).href)
      : requireSdk('@aladdindao/fx-sdk') as { FxSdk: typeof FxSdk };
    let quoteClock = Date.now();
    context.mock.method(Date, 'now', () => quoteClock);
    async function planAtFreshTime<T extends object>(build: () => Promise<T>): Promise<T> {
      quoteClock += 1;
      const plan = await build();
      const quote = (plan as { fxSaveQuote?: { readAt: number } }).fxSaveQuote;
      assert.ok(quote, 'a deposit preserves its accepted quote metadata');
      assert.ok(Number.isSafeInteger(quote.readAt) && quote.readAt > 0);
      assert.equal(quote.readAt, quoteClock, 'each plan records its own strictly advancing read time');
      return plan;
    }
    let preview = 100n * WAD;
    let index = 125n * WAD / 100n;
    let allowance = 0n;
    function read(data: Hex): Hex {
      const decoded = decodeFunctionData({ abi: ABI, data });
      switch (decoded.functionName) {
        case 'aggregate3':
          return encodeFunctionResult({ abi: ABI, functionName: 'aggregate3', result: decoded.args[0].map(call => ({ success: true, returnData: read(call.callData) })) });
        case 'allowance': return encodeFunctionResult({ abi: ABI, functionName: 'allowance', result: allowance });
        case 'queryConvert': return encodeFunctionResult({ abi: ABI, functionName: 'queryConvert', result: decoded.args[0] });
        case 'previewDeposit': return encodeFunctionResult({ abi: ABI, functionName: 'previewDeposit', result: preview });
        case 'convertToAssets': return encodeFunctionResult({ abi: ABI, functionName: 'convertToAssets', result: index });
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
    for (const tokenIn of ['usdc', 'fxUSD'] as const) {
      const amount = tokenIn === 'usdc' ? 100_000_000n : 100n * WAD;
      for (const fixture of [
        { preview: 100n * WAD, index: WAD },
        { preview: 100n * WAD + 123n, index: 125n * WAD / 100n + 7n },
        { preview: 100n * WAD, index: 0n },
      ]) {
        ({ preview, index } = fixture);
        for (allowance of [0n, amount]) {
          // Omitted slippage is what the corrected UI sends. All transaction
          // and quote terms remain identical; each read has its own timestamp.
          const reference = await planAtFreshTime(() => sdk.depositFxSave({ userAddress: WALLET, tokenIn, amount }));
          for (const slippage of [0.01, 0.04, 0.1, 0.29, 0.5, 1, 2]) {
            const plan = await planAtFreshTime(() => sdk.depositFxSave({ userAddress: WALLET, tokenIn, amount, slippage }));
            assert.deepEqual(timeIndependentPlan(plan), timeIndependentPlan(reference));
          }
          assert.equal(reference.txs.length, allowance === 0n ? 2 : 1);
          const action = reference.txs.at(-1)!;
          const decoded = decodeFunctionData({ abi: ABI, data: action.data as Hex });
          assert.equal(decoded.functionName, 'depositToFxSave');
          if (decoded.functionName !== 'depositToFxSave') throw new Error('Unexpected deposit action');
          assert.equal(decoded.args[2], index > 0n ? preview * WAD * 9996n / index / 10_000n : preview);
          assert.equal(decoded.args[0].amount, amount);
          assert.equal(decoded.args[3].toLowerCase(), WALLET.toLowerCase());
          assert.equal(action.nonce, allowance === 0n ? 5 : 4);
          assert.equal(action.value, 0n);
        }
      }
    }
  });
}
