import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { transpileModule, ScriptTarget } from 'typescript';
import type { ProtocolPositionRefreshResult } from '../src/components/ProtocolPositionProvider';
import { loadPositionRefresh } from '../src/lib/positionRefreshQueue';
import { createPositionReadGuard, mergeVerifiedPositions, newlyVerifiedPositions, positionKey, unavailablePositionResult } from '../src/app/trade/fxUi';

const source = readFileSync(new URL('../src/components/ProtocolPositionProvider.tsx', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('  const loadAddressImpl ='), source.indexOf('  const pendingLoadRef ='));
const compiled = transpileModule(`${callback}\nglobalThis.load = loadAddressImpl;`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
function harness() {
  const guard = createPositionReadGuard();
  const requests: Array<{ resolve: (value: any) => void; reject: (reason: Error) => void }> = [];
  const commits: any[] = [];
  let now = 1000;
  const emptySnapshot = (walletAddress: string) => ({ walletAddress, positions: [] as Array<{ info: { positionId: number } }>, status: 'loading', failedGroups: [], lastVerifiedAt: null, refreshing: false, verifiedGroups: [] });
  const snapshotRef = { current: emptySnapshot('0xabc') };
  const EMPTY_RESULT: ProtocolPositionRefreshResult = { positions: [], successfulGroups: [], failedGroups: [], status: 'unavailable', newPositions: [] };
  const scope = { useCallback: (fn: unknown) => fn, readGuardRef: { current: guard }, sessionGeneration: { current: 1 }, Date: { now: () => now }, snapshotRef, emptySnapshot, commit: (value: any) => { commits.push(value); snapshotRef.current = value; }, readAllPositionsDetailed: () => new Promise((resolve, reject) => requests.push({ resolve, reject })), mergeVerifiedPositions, newlyVerifiedPositions, positionKey, unavailablePositionResult, EMPTY_RESULT, closedPositionKeysRef: { current: new Set() }, positionRetryAttemptsRef: { current: 0 }, positionRetryTimerRef: { current: null }, schedulePositionRetryRef: { current: null }, window: { clearTimeout() {} } };
  vm.runInNewContext(compiled, scope);
  return { guard, requests, commits, EMPTY_RESULT, snapshotRef, generation: scope.sessionGeneration, pending: { current: null } as Parameters<typeof loadPositionRefresh<any>>[0], load: (scope as any).load as (address: string) => Promise<any>, setNow(value: number) { now = value; } };
}
const read = (id: number) => ({ status: 'ready', positions: [{ market: 'ETH', side: 'long', info: { positionId: id } }], successfulGroups: [{ market: 'ETH', side: 'long' }], failedGroups: [] });

test('ordinary reads coalesce but the receipt starts a genuinely new provider request', async () => {
  const h = harness();
  const oldRead = loadPositionRefresh(h.pending, '0xAbC', h.load);
  assert.equal(loadPositionRefresh(h.pending, '0xabc', h.load), oldRead);
  h.setNow(2000); // confirmed action arrived while old request is unresolved
  const afterReceipt = loadPositionRefresh(h.pending, '0xabc', h.load, true);
  assert.notEqual(afterReceipt, oldRead);
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve(read(1));
  assert.equal(await oldRead, h.EMPTY_RESULT);
  assert.equal(h.pending.current?.promise, afterReceipt); // old finally cannot erase new read
  h.setNow(2100);
  h.requests[1].resolve(read(42));
  const fresh = await afterReceipt;
  assert.equal(fresh.positions[0].info.positionId, 42);
  assert.equal(fresh.readStartedAt, 2000);
  assert.equal(fresh.readCompletedAt, 2100);
  assert.equal(h.snapshotRef.current.positions[0].info.positionId, 42);
  assert.equal(h.pending.current, null);
});

for (const context of ['unmount', 'disconnect', 'account change', 'same-address reconnect']) {
  test(`a post-confirmation read cannot survive ${context}`, async () => {
    const h = harness();
    const pending = loadPositionRefresh(h.pending, '0xabc', h.load, true);
    h.guard.invalidate(); h.generation.current += 1;
    if (context === 'account change' || context === 'same-address reconnect') h.guard.activate();
    const commitsBefore = h.commits.length;
    h.requests[0].resolve(read(42));
    const result = await pending;
    assert.equal(result, h.EMPTY_RESULT);
    assert.equal(result.readStartedAt, undefined);
    assert.equal(h.commits.length, commitsBefore);
  });
}

test('a superseded or failed forced request has no successful freshness evidence', async () => {
  const h = harness();
  const cancelled = loadPositionRefresh(h.pending, '0xabc', h.load, true);
  h.guard.begin(); // another canonical read superseded it
  h.requests[0].resolve(read(1));
  assert.equal(await cancelled, h.EMPTY_RESULT);
  const failed = loadPositionRefresh(h.pending, '0xabc', h.load, true);
  h.requests[1].reject(new Error('RPC unavailable'));
  assert.equal(await failed, h.EMPTY_RESULT);
});

test('provider lifecycle invalidates pending reads and both completion paths request a fresh read', () => {
  assert.match(source, /return \(\) => \{\s*guard.invalidate\(\);/);
  assert.match(source, /guard.invalidate\(\);[^]*?sessionGeneration.current \+= 1;[^]*?pendingLoadRef.current = null/);
  for (const product of ['borrow', 'positions', 'trade']) {
    const page = readFileSync(new URL(`../src/app/${product}/page.tsx`, import.meta.url), 'utf8');
    assert.match(page, /confirmedAt = Date.now\(\)/);
    assert.match(page, /afterConfirmation: true/);
    assert.match(page, /confirmedPositionReadback\([^]*?read, confirmedAt\)/);
  }
});
