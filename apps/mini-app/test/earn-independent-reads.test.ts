import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createEarnReadGuard } from '../src/lib/earnState';

const source = ts.createSourceFile('earn.tsx', readFileSync(new URL('../src/app/earn/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
function callback(name: string) {
  let result = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) result = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result, `${name} callback exists`);
  return ts.transpileModule(`(${result})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const reads = { config: deferred(), balance: deferred(), redeem: deferred() };
  const state: Record<string, any> = { config: null, data: null, readPending: {}, readWarnings: [], loading: false, error: '' };
  const guard = createEarnReadGuard();
  const wallet = { address: '0x1111111111111111111111111111111111111111' };
  const dataRef = { current: null as any };
  const setter = (key: string) => (value: any) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  let chain: Promise<unknown> = Promise.resolve();
  const calls = { config: 0, balance: 0, redeem: 0 };
  const sdk = { getFxSaveConfig: () => { calls.config++; return reads.config.promise; }, getFxSaveBalance: () => { calls.balance++; return reads.balance.promise; }, getFxSaveRedeemStatus: () => { calls.redeem++; return reads.redeem.promise; } };
  const bindings = { wallet, dataRef, readGuard: { current: guard }, setLoading: setter('loading'), setReadPending: setter('readPending'), setError: setter('error'), setData: setter('data'), setConfig: setter('config'), setReadWarnings: setter('readWarnings'), withReadDeadline: (value: unknown) => value, assertConfiguredPublicClientChain: () => chain, getFxReadFacade: () => sdk, userSafeError: () => 'Read unavailable' };
  const load = runInNewContext(callback('load'), bindings) as (force?: boolean) => Promise<void>;
  const planner = () => (runInNewContext(callback('planBuilder'), { ...state, walletData: state.data?.walletAddress === wallet.address ? state.data : null, wallet, mode: 'deposit', amount: '1', token: 'fxUSD', parseAmount: () => 1n, planDepositFxSave: () => undefined }) as () => unknown)();
  return { reads, calls, state, guard, wallet, dataRef, load, planner, setChain: (value: Promise<unknown>) => { chain = value; } };
}

test('Earn publishes config and balance before slow redemption; planners wait only for required successful reads', async () => {
  const h = harness();
  const pending = h.load();
  await flush();
  assert.equal(h.planner(), null);
  h.reads.balance.resolve({ balanceWei: 2n });
  await flush();
  assert.equal(h.state.data.balance.balanceWei, 2n);
  assert.equal(h.state.readPending.balance, false);
  assert.equal(h.state.loading, true);
  assert.equal(h.planner(), null, 'pending config cannot authorize review');
  h.reads.config.resolve({ cooldownPeriodSeconds: 100 });
  await flush();
  assert.equal(h.state.config.cooldownPeriodSeconds, 100);
  assert.equal(typeof h.planner(), 'function');
  assert.equal(h.state.readPending.redeemStatus, true);
  h.reads.redeem.reject(new Error('redemption unavailable'));
  await pending;
  assert.equal(h.state.loading, false);
  assert.deepEqual(Array.from(h.state.readWarnings), ['redemption status']);
  assert.equal(h.state.data.balance.balanceWei, 2n);
});

test('Earn reports a failed balance while unrelated redemption remains pending and keeps planning blocked', async () => {
  const h = harness();
  const pending = h.load();
  await flush();
  h.reads.config.resolve({});
  h.reads.balance.reject(new Error('balance unavailable'));
  await flush();
  assert.equal(h.state.readPending.balance, false);
  assert.equal(h.state.loading, true);
  assert.ok(h.state.readWarnings.includes('balance'));
  assert.equal(h.planner(), null);
  h.reads.redeem.resolve({ hasPendingRedeem: false });
  await pending;
});

test('superseded wallet reads cannot publish fields or finish the new wallet loading state', async () => {
  const h = harness();
  const old = h.load();
  await flush();
  const oldReads = { ...h.reads };
  h.guard.invalidate(); h.guard.activate();
  h.wallet.address = '0x2222222222222222222222222222222222222222';
  h.reads.config = deferred(); h.reads.balance = deferred(); h.reads.redeem = deferred();
  const current = h.load(true);
  await flush();
  oldReads.config.resolve({ old: true });
  oldReads.balance.resolve({ balanceWei: 99n });
  oldReads.redeem.resolve({ old: true });
  await old;
  assert.equal(h.state.config, null);
  assert.equal(h.state.data.balance, null);
  assert.equal(h.state.loading, true);
  assert.equal(h.dataRef.current.balance, null);
  assert.equal(h.state.data.walletAddress, h.wallet.address);
  h.reads.balance.resolve({ balanceWei: 3n });
  h.reads.config.resolve({ current: true });
  h.reads.redeem.resolve({ current: true });
  await current;
  assert.equal(h.state.data.balance.balanceWei, 3n);
  assert.equal(h.state.loading, false);
});

test('a wallet switch during chain verification prevents starting account reads', async () => {
  const h = harness();
  const chain = deferred();
  h.setChain(chain.promise);
  const pending = h.load();
  h.guard.invalidate(); h.guard.activate();
  chain.resolve(undefined);
  await pending;
  assert.equal(h.state.config, null);
  assert.equal(h.state.data.balance, null);
  assert.deepEqual(h.calls, { config: 0, balance: 0, redeem: 0 });
});

test('chain failure marks every required field unavailable and never enables deposit planning', async () => {
  const h = harness();
  h.setChain(Promise.reject(new Error('wrong chain')));
  await h.load();
  assert.equal(h.state.loading, false);
  assert.equal(h.state.readPending.config, false);
  assert.ok(h.state.readWarnings.includes('vault configuration'));
  assert.ok(h.state.readWarnings.includes('balance'));
  assert.equal(h.planner(), null);
});
