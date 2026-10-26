import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { withReadDeadline } from '../src/lib/fx/readFacade';
const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const service = readFileSync(new URL('../src/lib/fx/service.ts', import.meta.url), 'utf8');
function deferred() { let resolve!: (v: unknown) => void; let reject!: (e: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
for (const method of ['planIncreasePosition', 'planAdjustPositionLeverage']) for (const outcome of ['ready', 'failed', 'stalled']) test(method + ' plans in parallel with optional funding: ' + outcome, async context => {
  if (outcome === 'stalled') context.mock.timers.enable({ apis: ['setTimeout'] });
  const a = service.indexOf('export async function ' + method);
  const end = service.indexOf('export async function ', a + 10);
  const source = service.slice(a, end).replace('export ', '');
  const sdk = deferred(), funding = deferred(); let sdkStarted = false, fundingStarted = false;
  const route = { transactions: [], details: {} };
  const plan = runInNewContext(transformSync(source + '\n' + method, { loader: 'ts', format: 'cjs' }).code, {
    Promise, withReadDeadline,
    validateCommonPositionRequest() {}, assertPositiveAmount() {}, positionInputToken: (token: string) => token,
    assertConfiguredPublicClientChain: async () => {}, ethLongAccounting: () => undefined,
    readTradeFundingRate: () => { fundingStarted = true; return funding.promise; },
    getFxSdk: () => ({ increasePosition: () => { sdkStarted = true; return sdk.promise; }, adjustPositionLeverage: () => { sdkStarted = true; return sdk.promise; } }),
    assertAddress: (v: unknown) => v, toSdkTokenAddress: (v: unknown) => v, auditedTargets: () => [],
    normalizeRouteResult: () => [route], assertPositionEconomics: () => ({ effectiveLeverage: 3 }), assertSdkSlippage() {},
    isNativeToken: () => false, positionPoolAddress: () => 'pool', positionCollateralTokenAddress: () => 'collateral', positionDebtTokenAddress: () => 'debt',
    withReviewedPolicy: (r: object, policy: object) => ({ ...r, policy }), withRequestDetails: (r: object, details: object) => ({ ...r, details }),
  }) as (request: object) => Promise<Array<{ details: Record<string, unknown> }>>;
  const pending = plan({ market: 'BTC', type: 'short', positionId: 1, amount: 1n, inputTokenAddress: 'input', userAddress: 'wallet', leverage: 3 });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(sdkStarted, true); assert.equal(fundingStarted, true);
  if (outcome === 'failed') funding.reject(new Error('optional RPC unavailable'));
  else if (outcome === 'ready') funding.resolve({ market: 'BTC', side: 'short', pool: 'pool', ratio: 123n, readAt: 1700 });
  let settled = false;
  void pending.then(() => { settled = true; });
  sdk.resolve({});
  if (outcome === 'stalled') {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    context.mock.timers.tick(99);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'funding gets at most the extra 100ms window');
    context.mock.timers.tick(1);
  }
  const routes = await pending;
  assert.equal(routes.length, 1); assert.equal(routes[0].details.effectiveLeverage, 3);
  assert.deepEqual(routes[0].details.tradeFundingQuote && JSON.parse(JSON.stringify(routes[0].details.tradeFundingQuote)), outcome !== 'ready' ? undefined : { market: 'BTC', side: 'short', poolAddress: 'pool', ratio: '123', readAt: 1700 });
});

