import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { acceptedFxSaveQuote } from '../src/lib/fx/fxSaveReviewQuote';
import { normalizeTxResult } from '../src/lib/fx/normalize';
import { routeFinancialReviewFacts } from '../src/lib/fx/reviewFormatting';
import { ROUTE_PREFETCH_TTL_MS } from '../src/lib/fx/routePrefetch';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { PlannedRoute } from '../src/lib/fx/types';

const WAD = 10n ** 18n;
const WALLET = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
const VAULT = FX_TOKENS.fxSAVE.address;
const BASE = FX_TOKENS.fxUSDBasePool.address;

for (const bundle of ['index.js', 'index.cjs']) {
  test(`${bundle} keeps accepted fxSAVE fee/output metadata without changing calldata`, async () => {
    const source = readFileSync(resolve('node_modules/@aladdindao/fx-sdk/dist', bundle), 'utf8');
    const start = source.indexOf('async function depositFxSave(request)');
    const end = source.indexOf('// src/core/index.ts', start);
    const reads: string[] = [];
    const client = { chain: { id: 1 }, readContract: async ({ address, functionName, args }: { address: string; functionName: string; args: bigint[] }) => {
      reads.push(`${address}:${functionName}`);
      if (functionName === 'convertToAssets') return 2n * WAD;
      if (functionName === 'previewDeposit') return address === BASE ? 100n * WAD : args[0] / 2n;
      if (functionName === 'previewRedeem') return address === BASE ? [100n * WAD, 50_000_000n] : args[0] * 2n;
      if (functionName === 'instantRedeemFeeRatio') return WAD / 20n;
      throw new Error(`Unexpected read ${functionName}`);
    } };
    const selectors: Record<string, string> = { deposit: '0x6e553f65', redeem: '0xba087652', depositToFxSave: '0x3ea34dc0', instantRedeemFromFxSave: '0x6d701088', requestRedeem: '0xaa2f892d', convert: '0xabcdef12' };
    const encode = ({ functionName }: { functionName: string }) => selectors[functionName];
    const bindings = {
      contracts: { FxSave_fxSAVE: VAULT, FxUSDBasePool: BASE, Router_Diamond: ROUTER },
      tokens: { fxUSD: FX_TOKENS.fxUSD.address, usdc: FX_TOKENS.USDC.address },
      getClient: () => client, getNonce: async () => 0, approveToken: async () => null,
      resolveTokenAddress: (token: string) => token === 'usdc' ? FX_TOKENS.USDC.address : token === 'fxUSD' ? FX_TOKENS.fxUSD.address : BASE,
      getDepositSpender: (token: string) => token === 'fxUSDBasePool' ? VAULT : ROUTER,
      isAddress: () => true, encodeFunctionData: encode, viem: { isAddress: () => true, encodeFunctionData: encode },
      getQueryConvert: async (amount: bigint, route: { fromTokenAddress?: string }) => route.fromTokenAddress === FX_TOKENS.fxUSD.address ? amount / 10n ** 12n : amount,
      getZapRoutes: (route: object) => ({ ...route, encoding: 0n, routes: [] }), FEE_PRECISION: WAD,
      SavingFxUSD_default: {}, FxUSDBasePool_default: {}, MultiPathConverter_default: {}, SavingFxUSDFacet_default: {},
    };
    const methods = new Function(...Object.keys(bindings), `${source.slice(start, end)}; return { depositFxSave, withdrawFxSave };`)(...Object.values(bindings));
    const deposit = await methods.depositFxSave({ userAddress: WALLET, tokenIn: 'usdc', amount: 100_000_000n });
    assert.equal(deposit.fxSaveQuote.estimatedOutput, (50n * WAD).toString());
    assert.equal(deposit.fxSaveQuote.actionData, deposit.txs[0].data);
    assert.equal(deposit.txs[0].value, 0n);
    const withdrawn = await methods.withdrawFxSave({ userAddress: WALLET, tokenOut: 'usdc', amount: WAD, instant: true, slippage: 1 });
    assert.equal(withdrawn.fxSaveQuote.instantFeeRatio, (WAD / 20n).toString());
    assert.equal(withdrawn.fxSaveQuote.estimatedOutput, '142500000');
    assert.equal(withdrawn.fxSaveQuote.netFxUSD, (95n * WAD).toString());
    assert.equal(withdrawn.fxSaveQuote.netUSDC, '47500000');
    assert.equal(withdrawn.fxSaveQuote.actionData, withdrawn.txs[0].data);
    const direct = await methods.withdrawFxSave({ userAddress: WALLET, tokenOut: 'fxUSDBasePool', amount: WAD });
    assert.equal(direct.fxSaveQuote.estimatedOutput, (2n * WAD).toString());
    const queued = await methods.withdrawFxSave({ userAddress: WALLET, tokenOut: 'usdc', amount: WAD });
    assert.equal(queued.fxSaveQuote, undefined);
    assert.equal(reads.filter(read => read.endsWith(':instantRedeemFeeRatio')).length, 1);
  });
}

function instantRoute(): PlannedRoute {
  const route = normalizeTxResult('withdrawFxSave', {
    txs: [{ to: ROUTER, data: '0x6d701088', type: 'instantRedeem' }],
    fxSaveQuote: { kind: 'instant-withdraw', tokenAddress: FX_TOKENS.USDC.address, actionTo: ROUTER, actionData: '0x6d701088',
      inputAmount: WAD.toString(), readAt: Date.now(), estimatedOutput: '142500000', instantFeeRatio: (WAD / 20n).toString(),
      grossFxUSD: (100n * WAD).toString(), grossUSDC: '50000000', netFxUSD: (95n * WAD).toString(), netUSDC: '47500000' },
  }, WALLET);
  route.policy = { walletAddress: WALLET, chainId: 1, reviewedAction: { kind: 'fxsave-withdraw', tokenOutAddress: FX_TOKENS.USDC.address,
    amount: WAD, receiver: WALLET, directBasePool: false, instant: true, slippagePercent: 1 } };
  return route;
}

test('normalized accepted instant quote shows net chosen-token output and its own fee', () => {
  const route = instantRoute();
  const facts = routeFinancialReviewFacts(route);
  assert.equal(facts.find(f => f.label === 'Estimated received')?.value, '142.5 USDC');
  assert.equal(facts.find(f => f.label === 'f(x) fee')?.value, '5%');
  assert.deepEqual(facts.find(f => f.label === 'f(x) fee')?.feeAmounts, [{ amount: '5', symbol: 'fxUSD' }, { amount: '2.5', symbol: 'USDC' }]);
  assert.equal(facts.find(f => f.label === 'Instant fee (fxUSD leg)')?.value, '5 fxUSD');
  assert.equal(facts.find(f => f.label === 'Instant fee (USDC leg)')?.value, '2.5 USDC');
});

test('deposit and direct withdrawal estimates retain their actual output share units', () => {
  for (const deposit of [true, false]) {
    const actionTo = deposit ? ROUTER : VAULT;
    const actionData = deposit ? '0x3ea34dc0' : '0xba087652';
    const token = deposit ? FX_TOKENS.USDC : FX_TOKENS.fxUSDBasePool;
    const operation = deposit ? 'depositFxSave' : 'withdrawFxSave';
    const route = normalizeTxResult(operation, {
      txs: [{ to: actionTo, data: actionData, type: 'action' }],
      fxSaveQuote: { kind: deposit ? 'deposit' : 'direct-withdraw', actionTo, actionData, tokenAddress: token.address,
        inputAmount: '1000000', readAt: Date.now(), estimatedOutput: (2n * WAD).toString() },
    }, WALLET);
    route.policy = { chainId: 1, walletAddress: WALLET, reviewedAction: deposit
      ? { kind: 'fxsave-deposit', amount: 1_000_000n, tokenInAddress: token.address, receiver: WALLET, directBasePool: false }
      : { kind: 'fxsave-withdraw', amount: 1_000_000n, tokenOutAddress: token.address, receiver: WALLET, directBasePool: true, instant: false } };
    const fact = routeFinancialReviewFacts(route).find(f => f.label === (deposit ? 'Estimated fxSAVE received' : 'Estimated received'));
    assert.equal(fact?.value, deposit ? '2 fxSAVE' : '2 fxSP');
    const malformed = normalizeTxResult(operation, { txs: [{ to: actionTo, data: actionData }], fxSaveQuote: { ...route.details!.fxSaveQuote, estimatedOutput: '-1' } }, WALLET);
    assert.equal(malformed.details!.fxSaveQuote, undefined);
  }
});

test('a failed optional preview keeps the accepted fee and explicitly marks the output unavailable', () => {
  const route = instantRoute();
  delete route.details!.fxSaveQuote!.estimatedOutput;
  assert.ok(acceptedFxSaveQuote(route));
  const facts = routeFinancialReviewFacts(route);
  assert.equal(facts.find(f => f.label === 'Estimated received')?.value, 'Unavailable');
  assert.equal(facts.find(f => f.label === 'f(x) fee')?.value, '5%');
});

test('stale, mixed, malformed and inconsistent fee metadata cannot show a receive estimate', () => {
  const route = instantRoute();
  const readAt = route.details!.fxSaveQuote!.readAt;
  assert.ok(acceptedFxSaveQuote(route, readAt));
  assert.equal(acceptedFxSaveQuote(route, readAt - 1), undefined);
  assert.equal(acceptedFxSaveQuote(route, readAt + ROUTE_PREFETCH_TTL_MS), undefined);
  for (const mutate of [
    (r: PlannedRoute) => { r.transactions[0].data = '0x12345678'; },
    (r: PlannedRoute) => { r.details!.fxSaveQuote!.inputAmount = '2'; },
    (r: PlannedRoute) => { r.details!.fxSaveQuote!.tokenAddress = FX_TOKENS.fxUSD.address; },
    (r: PlannedRoute) => { r.details!.fxSaveQuote!.instantFeeRatio = (WAD + 1n).toString(); },
    (r: PlannedRoute) => { r.details!.fxSaveQuote!.netUSDC = '50000000'; },
    (r: PlannedRoute) => { r.details!.fxSaveQuote!.estimatedOutput = '-1'; },
  ]) {
    const broken = structuredClone(route);
    mutate(broken);
    assert.equal(acceptedFxSaveQuote(broken, readAt), undefined);
    assert.equal(routeFinancialReviewFacts(broken).find(f => f.label === 'Estimated received')?.value, 'Unavailable');
  }
});
