import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createEarnEstimateGuard } from '../src/lib/earnPublicEstimate';

const helperSource = readFileSync(new URL('../src/lib/earnPublicEstimate.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/app/earn/page.tsx', import.meta.url), 'utf8');

function publicQuoteHarness() {
  const calls: Array<{ address: string; functionName: string; args: readonly unknown[]; account?: unknown; userAddress?: unknown }> = [];
  const client = { readContract: async (request: { address: string; functionName: string; args: readonly unknown[]; account?: unknown; userAddress?: unknown }) => {
    calls.push(request);
    return calls.length === 1 ? 12n : 9n;
  } };
  const addresses = { fxUSDBasePool: { address: '0xbase' }, fxSAVE: { address: '0xsave' }, fxUSD: { address: '0xfxusd' }, USDC: { address: '0xusdc' } };
  const sdkSource = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: Record<string, unknown> = {};
  const require = (id: string) => {
    if (id === './fx/tokens') return { FX_TOKENS: addresses };
    if (id === './fx/clients') return { assertConfiguredPublicClientChain: async (chainId: number) => assert.equal(chainId, 1), getPublicClient: () => client };
    if (id === './fx/readFacade') return { withReadDeadline: <T>(task: Promise<T>) => task };
    throw new Error(`Unexpected dependency ${id}`);
  };
  runInNewContext(sdkSource, { exports, require });
  return { quote: exports.quotePublicFxSaveDeposit as (token: 'fxUSD' | 'usdc', amount: bigint) => Promise<bigint>, calls };
}

test('public fxSAVE deposit quote follows the pinned SDK previews without account reads', async () => {
  const h = publicQuoteHarness();
  assert.equal(await h.quote('usdc', 1_000_000n), 9n);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(Array.from(h.calls[0].args), ['0xusdc', 1_000_000n]);
  assert.deepEqual(Array.from(h.calls[1].args), [12n]);
  assert.ok(h.calls.every(call => call.functionName === 'previewDeposit'));
  assert.ok(h.calls.every(call => !('account' in call) && !('userAddress' in call)));

  const sdk = readFileSync(new URL('../node_modules/@aladdindao/fx-sdk/dist/index.js', import.meta.url), 'utf8');
  const deposit = sdk.slice(sdk.indexOf('async function depositFxSave(request)'), sdk.indexOf('async function withdrawFxSave(request)'));
  assert.match(deposit, /FxUSDBasePool[\s\S]*?functionName: "previewDeposit"/);
  assert.match(deposit, /functionName: "previewDeposit", args: \[basePoolSharesOut\]/);
});

test('edited or cancelled Earn inputs reject late public quotes', async () => {
  const guard = createEarnEstimateGuard();
  const oldRequest = guard.next();
  const currentRequest = guard.next();
  assert.equal(guard.current(oldRequest), false);
  assert.equal(guard.current(currentRequest), true);
  guard.invalidate();
  assert.equal(guard.current(currentRequest), false);
});

test('public estimate never enables wallet-gated Earn planning', () => {
  const source = ts.createSourceFile('earn.tsx', pageSource, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'planBuilder' && node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  const js = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const plan = runInNewContext(js, { wallet: { address: undefined }, walletData: null, publicDepositEstimate: 9n }) as () => unknown;
  assert.equal(plan(), null);
});
