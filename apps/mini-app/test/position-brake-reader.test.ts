import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { toFunctionSignature, type Address } from 'viem';
import {
  POOL_BRAKE_PARAMETER_TTL_MS,
  POSITION_BRAKE_MULTICALL_BYTES,
  POSITION_BRAKE_ORACLE_ABI,
  POSITION_BRAKE_POOL_ABI,
  POSITION_BRAKE_WSTETH,
  POSITION_BRAKE_WSTETH_RATE_ABI,
  createPoolBrakeParameterCache,
  readPositionBrakes,
  type PositionBrakeClient,
  type PositionBrakeTarget,
} from '../src/app/trade/positionBrakeReader';
import { positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { checkBasisDebtRatio } from '../src/lib/positionBrake';

const E18 = 10n ** 18n;
const ETH_LONG_POOL = positionPoolAddress('ETH', 'long');
const ETH_SHORT_POOL = positionPoolAddress('ETH', 'short');
const BTC_LONG_POOL = positionPoolAddress('BTC', 'long');
const ORACLES: Record<string, Address> = {
  [ETH_LONG_POOL.toLowerCase()]: '0x0C5C61025f047cB7e3e85852dC8eAFd7b9a4Abfb',
  [ETH_SHORT_POOL.toLowerCase()]: '0x222786833b5fd5eE21532d8b576391bAbeFdAAd1',
  [BTC_LONG_POOL.toLowerCase()]: '0xb3c90e64EB6f456A5F5C17Aa99b6aecA6f4a6390',
};

/** stETH per wstETH, as the two ETH oracles put it at that block. */
const STETH_PER_WSTETH = 1_245_860_000_000_000_000n;

type Call = { address: Address; functionName: string; args?: readonly unknown[] };
type Responder = (call: Call) => { status: 'success'; result: unknown } | { status: 'failure'; error: unknown };

/** Values read from mainnet at block 26,149,707, used here as fixtures only. */
const chain: Record<string, Responder> = {
  getRebalanceRatios: (call) => ({ status: 'success', result: call.address === ETH_SHORT_POOL ? [900n * E18 / 1000n, 25_000_000n] : [880n * E18 / 1000n, 25_000_000n] }),
  getLiquidateRatios: () => ({ status: 'success', result: [950n * E18 / 1000n, 40_000_000n] }),
  priceOracle: (call) => ({ status: 'success', result: ORACLES[call.address.toLowerCase()] }),
  getPositionDebtRatio: (call) => ({ status: 'success', result: call.args?.[0] === 2033n ? 566_666_920_642_971_884n : 600n * E18 / 1000n }),
  getPrice: (call) => ({
    status: 'success',
    result: call.address === ORACLES[ETH_LONG_POOL.toLowerCase()]
      ? [2_444_585_858_023_510_186_210n, 2_444_578_396_940_640_991_110n, 2_448_287_872_868_744_829_475n]
      : call.address === ORACLES[ETH_SHORT_POOL.toLowerCase()]
        ? [328_340_809_079_147n, 327_844_330_473_433n, 328_341_811_206_135n]
        : [81_354_963_409_200_000_000_000n, 81_204_939_755_279_203_492_225n, 81_531_938_834_473_843_665_688n],
  }),
  stEthPerToken: () => ({ status: 'success', result: STETH_PER_WSTETH }),
};

function fakeClient(overrides: Partial<Record<string, Responder>> = {}, options: { hang?: boolean; throwOn?: number; truncate?: number } = {}) {
  const requests: Call[][] = [];
  const batchSizes: (number | undefined)[] = [];
  const client: PositionBrakeClient = {
    multicall: async ({ contracts, batchSize }) => {
      requests.push(contracts.map(({ address, functionName, args }) => ({ address, functionName, args })));
      batchSizes.push(batchSize);
      if (options.hang) return new Promise(() => undefined);
      if (options.throwOn === requests.length) throw new Error('RPC unavailable');
      const results = contracts.map((call) => (overrides[call.functionName] ?? chain[call.functionName])(call));
      return options.truncate === requests.length ? results.slice(1) : results;
    },
  };
  return { client, requests, batchSizes };
}

const target = (market: 'ETH' | 'BTC', side: 'long' | 'short', positionId: number): PositionBrakeTarget => ({ key: `${market}:${side}:${positionId}`, market, side, positionId });

test('the brake ABI matches the pinned contracts and the pool ABI fx-sdk bundles', () => {
  assert.deepEqual(POSITION_BRAKE_POOL_ABI.map((item) => toFunctionSignature(item)), [
    'getPositionDebtRatio(uint256)', 'getRebalanceRatios()', 'getLiquidateRatios()', 'priceOracle()',
  ]);
  assert.deepEqual(POSITION_BRAKE_ORACLE_ABI.map((item) => toFunctionSignature(item)), ['getPrice()']);

  // fx-sdk 1.0.5 bundles these ABIs but does not export them; read its literals.
  const bundle = readFileSync(createRequire(import.meta.url).resolve('@aladdindao/fx-sdk'), 'utf8');
  const literal = (name: string): Array<{ name?: string; type: string; stateMutability?: string; inputs: { type: string }[]; outputs?: { type: string }[] }> => {
    const start = bundle.indexOf('[', bundle.indexOf(`var ${name} = [`));
    assert.ok(start > 0, `${name} is bundled`);
    let depth = 0;
    let quoted = false;
    for (let index = start; index < bundle.length; index += 1) {
      const char = bundle[index];
      if (char === '"' && bundle[index - 1] !== '\\') quoted = !quoted;
      if (quoted) continue;
      if (char === '[') depth += 1;
      if (char === ']' && --depth === 0) return new Function(`return ${bundle.slice(start, index + 1)}`)();
    }
    throw new Error(`${name} literal did not close`);
  };
  const sdkPool = literal('AFPool_default');
  const sdkOracle = literal('PriceOracle_default');
  for (const [ours, theirs] of [[POSITION_BRAKE_POOL_ABI, sdkPool], [POSITION_BRAKE_ORACLE_ABI, sdkOracle]] as const) {
    for (const item of ours) {
      const match = theirs.find((entry) => entry.type === 'function' && entry.name === item.name);
      assert.ok(match, `fx-sdk bundles ${item.name}`);
      assert.equal(match.stateMutability, 'view');
      assert.deepEqual(match.inputs.map((input) => input.type), item.inputs.map((input) => input.type));
      assert.deepEqual(match.outputs?.map((output) => output.type), item.outputs.map((output) => output.type));
    }
  }
});

test('a cold read fetches pool thresholds once, then batches every ratio with each oracle price', async () => {
  const { client, requests, batchSizes } = fakeClient();
  const cache = createPoolBrakeParameterCache();
  let now = 1_000_000;
  const targets = [target('ETH', 'long', 2033), target('ETH', 'long', 7), target('ETH', 'short', 174), target('BTC', 'long', 933)];
  const outcomes = await readPositionBrakes({ client, targets, cache, now: () => now });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].map((call) => call.functionName), [
    'getRebalanceRatios', 'getLiquidateRatios', 'priceOracle',
    // The wstETH short's rate prices its debt per stETH.
    'getRebalanceRatios', 'getLiquidateRatios', 'priceOracle', 'stEthPerToken',
    'getRebalanceRatios', 'getLiquidateRatios', 'priceOracle',
  ]);
  assert.equal(requests[0][6].address, POSITION_BRAKE_WSTETH);
  assert.deepEqual(requests[1].map((call) => `${call.functionName}@${call.address}`), [
    `getPositionDebtRatio@${ETH_LONG_POOL}`, `getPositionDebtRatio@${ETH_LONG_POOL}`, `getPositionDebtRatio@${ETH_SHORT_POOL}`, `getPositionDebtRatio@${BTC_LONG_POOL}`,
    // The oracle comes from each pool's own priceOracle(), never a constant.
    `getPrice@${ORACLES[ETH_LONG_POOL.toLowerCase()]}`, `getPrice@${ORACLES[ETH_SHORT_POOL.toLowerCase()]}`, `getPrice@${ORACLES[BTC_LONG_POOL.toLowerCase()]}`,
  ]);
  assert.deepEqual(requests[1].slice(0, 4).map((call) => call.args), [[2033n], [7n], [174n], [933n]]);
  assert.deepEqual(batchSizes, [POSITION_BRAKE_MULTICALL_BYTES, POSITION_BRAKE_MULTICALL_BYTES]);

  const eth = outcomes.get('ETH:long:2033');
  assert.ok(eth?.status === 'ready');
  assert.equal(eth.sample.anchorDebtRatio, 566_666_920_642_971_884n);
  assert.equal(eth.sample.debtRatio, checkBasisDebtRatio(566_666_920_642_971_884n, 2_444_585_858_023_510_186_210n, 2_444_578_396_940_640_991_110n));
  assert.ok(eth.sample.debtRatio > eth.sample.anchorDebtRatio, 'the minimum price makes the stricter ratio');
  assert.equal(eth.sample.rebalanceRatio, 880n * E18 / 1000n);
  assert.equal(eth.sample.liquidateRatio, 950n * E18 / 1000n);
  const shortOutcome = outcomes.get('ETH:short:174');
  assert.ok(shortOutcome?.status === 'ready');
  assert.equal(shortOutcome.sample.rebalanceRatio, 900n * E18 / 1000n, 'each pool keeps its own threshold');
  assert.equal(shortOutcome.sample.stEthPerWstEth, STETH_PER_WSTETH);
  assert.equal(eth.sample.stEthPerWstEth, undefined, 'an ETH long already counts stETH');

  // Within the cache window a refresh is one multicall: ratios and prices only.
  now += POOL_BRAKE_PARAMETER_TTL_MS - 1;
  await readPositionBrakes({ client, targets, cache, now: () => now });
  assert.equal(requests.length, 3);
  assert.ok(requests[2].every((call) => call.functionName === 'getPositionDebtRatio' || call.functionName === 'getPrice'));
  // After it, thresholds are read again.
  now += 1;
  await readPositionBrakes({ client, targets, cache, now: () => now });
  assert.equal(requests.length, 5);
  assert.equal(requests[3][0].functionName, 'getRebalanceRatios');
});

test('a failure stays with the positions it covers', async () => {
  const cache = createPoolBrakeParameterCache();
  const targets = [target('ETH', 'long', 1), target('ETH', 'long', 2), target('ETH', 'short', 3), target('BTC', 'long', 4)];
  const { client } = fakeClient({
    getLiquidateRatios: (call) => call.address === ETH_SHORT_POOL ? { status: 'failure', error: new Error('reverted') } : chain.getLiquidateRatios(call),
    getPositionDebtRatio: (call) => call.args?.[0] === 2n ? { status: 'failure', error: new Error('reverted') } : chain.getPositionDebtRatio(call),
    getPrice: (call) => call.address === ORACLES[BTC_LONG_POOL.toLowerCase()] ? { status: 'success', result: [1n, 0n, 1n] } : chain.getPrice(call),
  });
  const outcomes = await readPositionBrakes({ client, targets, cache });
  assert.deepEqual([...outcomes.entries()].map(([key, outcome]) => [key, outcome.status]).sort(), [
    ['BTC:long:4', 'failed'], ['ETH:long:1', 'ready'], ['ETH:long:2', 'failed'], ['ETH:short:3', 'failed'],
  ]);
  // A failed pool is not cached, so the next refresh asks again.
  assert.equal(cache.get(ETH_SHORT_POOL, Date.now()), undefined);
  assert.ok(cache.get(ETH_LONG_POOL, Date.now()));
});

test('thresholds the pool cannot have, a zero oracle, or malformed values never become a brake', async () => {
  const cases: Partial<Record<string, Responder>>[] = [
    { getRebalanceRatios: () => ({ status: 'success', result: [0n, 25_000_000n] }) },
    { getLiquidateRatios: () => ({ status: 'success', result: [880n * E18 / 1000n, 40_000_000n] }) },
    { priceOracle: () => ({ status: 'success', result: '0x0000000000000000000000000000000000000000' }) },
    { priceOracle: () => ({ status: 'success', result: 'not an address' }) },
    { getRebalanceRatios: () => ({ status: 'success', result: [880n * E18 / 1000n] }) },
    { getPositionDebtRatio: () => ({ status: 'success', result: -1n }) },
    { getPositionDebtRatio: () => ({ status: 'success', result: 5 }) },
    { getPrice: () => ({ status: 'success', result: [0n, 1n, 1n] }) },
    { getPrice: () => ({ status: 'success', result: [1n, 1n] }) },
  ];
  for (const overrides of cases) {
    const { client } = fakeClient(overrides);
    const outcomes = await readPositionBrakes({ client, targets: [target('ETH', 'long', 9)], cache: createPoolBrakeParameterCache() });
    assert.equal(outcomes.get('ETH:long:9')?.status, 'failed', JSON.stringify(Object.keys(overrides)));
  }
});

test('an unavailable or malformed multicall fails every position it was reading', async () => {
  const targets = [target('ETH', 'long', 1), target('BTC', 'long', 2)];
  for (const options of [{ throwOn: 1 }, { throwOn: 2 }, { truncate: 1 }, { truncate: 2 }]) {
    const { client } = fakeClient({}, options);
    const outcomes = await readPositionBrakes({ client, targets, cache: createPoolBrakeParameterCache() });
    assert.deepEqual([...outcomes.values()].map((outcome) => outcome.status), ['failed', 'failed'], JSON.stringify(options));
  }
  const { client, requests } = fakeClient({}, { hang: true });
  const started = Date.now();
  const outcomes = await readPositionBrakes({ client, targets, cache: createPoolBrakeParameterCache(), deadlineMs: 25 });
  assert.ok(Date.now() - started < 2_000);
  assert.equal(requests.length, 1);
  assert.deepEqual([...outcomes.values()].map((outcome) => outcome.status), ['failed', 'failed']);
});

test('invalid position IDs are rejected without a read', async () => {
  const { client, requests } = fakeClient();
  const outcomes = await readPositionBrakes({ client, targets: [target('ETH', 'long', 0), target('ETH', 'long', 1.5), target('ETH', 'long', Number.MAX_SAFE_INTEGER + 1)], cache: createPoolBrakeParameterCache() });
  assert.equal(requests.length, 0);
  assert.equal(outcomes.size, 3);
  assert.ok([...outcomes.values()].every((outcome) => outcome.status === 'failed'));
});

test('the wstETH short’s rate is wstETH’s own, and an unusable rate leaves only its pool price unknown', async () => {
  assert.equal(POSITION_BRAKE_WSTETH, FX_TOKENS.wstETH.address);
  assert.deepEqual(POSITION_BRAKE_WSTETH_RATE_ABI.map((item) => toFunctionSignature(item)), ['stEthPerToken()']);
  for (const rate of [{ status: 'failure', error: new Error('reverted') }, { status: 'success', result: E18 }, { status: 'success', result: 'x' }] as const) {
    const { client } = fakeClient({ stEthPerToken: () => rate });
    const cache = createPoolBrakeParameterCache();
    const outcomes = await readPositionBrakes({ client, targets: [target('ETH', 'short', 174)], cache });
    const outcome = outcomes.get('ETH:short:174');
    assert.ok(outcome?.status === 'ready', JSON.stringify(rate.status));
    assert.equal(outcome.sample.stEthPerWstEth, undefined);
    assert.equal(outcome.sample.rebalanceRatio, 900n * E18 / 1000n);
  }
  // Other pools never ask for it.
  const { client, requests } = fakeClient();
  await readPositionBrakes({ client, targets: [target('ETH', 'long', 1), target('BTC', 'long', 2)], cache: createPoolBrakeParameterCache() });
  assert.ok(requests.flat().every((call) => call.functionName !== 'stEthPerToken'));
});
