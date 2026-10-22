import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeController } from '../src/domain/controller';
import { AppError } from '../src/domain/errors';
import { Journal } from '../src/domain/journal';
import type { StoragePort } from '../src/domain/journal';
import type { Hash, LongIntent, PreparedLong, ProtocolPort, Runtime, VerifiedReceipt, WalletPort, WalletSession } from '../src/domain/ports';

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
const TARGET = '0x2222222222222222222222222222222222222222' as const;
const HASH = `0x${'ab'.repeat(32)}` as Hash;
const BLOCK = `0x${'cd'.repeat(32)}` as Hash;
const initial: WalletSession = { id: 'selected-provider-1', address: ACCOUNT, chainId: 1, label: 'Test wallet' };
const T0 = 1_792_632_000_000;
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }

class MemoryStorage implements StoragePort {
  readonly map = new Map<string, string>();
  get length() { return this.map.size; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

function makePlan(intent: LongIntent, session: WalletSession, now = T0): PreparedLong {
  return { id: `0x${'12'.repeat(32)}`, sessionId: session.id, intent, preparedAt: now, expiresAt: now + 30_000,
    call: { chainId: 1, from: session.address, to: TARGET, value: intent.amountWei, nonce: 3, data: '0x12345678' },
    blockNumber: 25_000_000n, economics: { collateralStEthWei: intent.amountWei * 3n, debtFxUsdWei: intent.amountWei * 7000n,
      estimatedLeverageBps: 30_000, executionPriceUsdE18: 3500n * 10n ** 18n, minimumWstEthWei: intent.amountWei * 8n / 10n },
    gasLimit: 200_000n, feePerGasWei: 10_000_000_000n, estimatedNetworkFeeWei: 2_000_000_000_000_000n,
    requiredBalanceWei: intent.amountWei + 2_000_000_000_000_000n, simulation: 'passed' };
}

function system(options: { storage?: StoragePort; prepare?: ProtocolPort['prepare']; preflight?: ProtocolPort['preflight']; observe?: ProtocolPort['observe']; send?: WalletPort['send']; preparationMs?: number } = {}) {
  let session: WalletSession | null = initial;
  let now = T0;
  let sends = 0;
  let prepares = 0;
  const listeners = new Set<() => void>();
  const receipt: VerifiedReceipt = { hash: HASH, blockHash: BLOCK, blockNumber: 25_000_001n, status: 'success', networkFeeWei: 99n, positionId: 42n };
  const wallet: WalletPort = {
    choices: () => [{ id: 'choice', name: 'Test wallet', available: true }], session: () => session,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async connect() { session = initial; for (const fn of listeners) fn(); return initial; },
    disconnect() { session = null; for (const fn of listeners) fn(); },
    async assertSession(expected) { if (session?.id !== expected.id) throw new AppError('wallet-changed', 'Changed'); },
    async send(call, expected, guard) { guard.beforeDispatch(); sends++; return options.send ? options.send(call, expected, guard) : HASH; },
    async switchToEthereum() {}, dispose() {}
  };
  const protocol: ProtocolPort = {
    async readMarket() { return { chainId: 1, blockNumber: 25_000_000n, readAt: now, balanceWei: 10n ** 18n, minLeverageBps: 11_000, maxLeverageBps: 50_000, paused: false }; },
    async prepare(intent, owner, signal) { prepares++; return options.prepare ? options.prepare(intent, owner, signal) : makePlan(intent, owner, now); },
    preflight: options.preflight ?? (async () => {}), observe: options.observe ?? (async () => receipt)
  };
  const runtime: Runtime = { mode: 'simulation', protocol, wallet, host: { kind: 'browser', setBackHandler() {}, setTheme() {}, openWallet() {}, dispose() {} } };
  const storage = options.storage ?? new MemoryStorage();
  const controller = new TradeController(runtime, { storage, now: () => now, tickMs: 0, preparationMs: options.preparationMs, receiptPollMs: 1_000_000, withWalletLock: async (_account, task) => task() });
  controller.setAmount('0.1');
  return { controller, runtime, storage, receipt, get sends() { return sends; }, get prepares() { return prepares; },
    advance(ms: number) { now += ms; },
    change(next: WalletSession | null) { session = next; for (const fn of listeners) fn(); } };
}

test('[SEC-REVIEW-001][SEC-RUN-007] preparing and accepting a review sends nothing; explicit confirmation preserves exact bytes into receipt/history', async t => {
  let received: unknown;
  const s = system({ send: async call => { received = call; return HASH; } }); t.after(() => s.controller.dispose());
  await s.controller.prepare();
  const state = s.controller.getSnapshot();
  assert.equal(state.flow.stage, 'review'); assert.equal(s.sends, 0); assert.equal(state.history.length, 0);
  if (state.flow.stage !== 'review') return;
  assert.equal(state.flow.plan.intent.amountWei, 100_000_000_000_000_000n);
  await s.controller.confirm();
  assert.deepEqual(received, state.flow.plan.call); assert.equal(s.prepares, 1); assert.equal(s.sends, 1);
  assert.equal(s.controller.getSnapshot().flow.stage, 'confirmed');
  assert.equal(s.controller.getSnapshot().history[0]?.hash, HASH);
  assert.equal(s.controller.getSnapshot().history[0]?.verifiedInSession, true);
});

test('[SEC-REVIEW-003] cancel rejects a late planner even when it ignores AbortSignal', async t => {
  const wait = deferred<PreparedLong>(); let prepared!: PreparedLong;
  const s = system({ prepare: async (intent, session) => { prepared = makePlan(intent, session); return wait.promise; } }); t.after(() => s.controller.dispose());
  const pending = s.controller.prepare(); await tick(); s.controller.cancelReview();
  await pending; wait.resolve(prepared); await tick();
  assert.equal(s.controller.getSnapshot().flow.stage, 'editing'); assert.equal(s.sends, 0);
});

test('[SEC-REVIEW-003] a shared preparation deadline closes a stalled quote without prompting', async t => {
  const s = system({ prepare: () => new Promise(() => {}), preparationMs: 15 }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); assert.equal(s.controller.getSnapshot().flow.stage, 'failed'); assert.equal(s.sends, 0);
});

test('[SEC-REVIEW-002] expiry requires new explicit review and never confirm-time replans', async t => {
  const s = system(); t.after(() => s.controller.dispose()); await s.controller.prepare(); s.advance(30_001);
  await s.controller.confirm(); assert.equal(s.controller.getSnapshot().flow.stage, 'expired'); assert.equal(s.prepares, 1); assert.equal(s.sends, 0);
  await s.controller.prepare(); assert.equal(s.prepares, 2); assert.equal(s.controller.getSnapshot().flow.stage, 'review'); assert.equal(s.sends, 0);
});

test('[SEC-RUN-002] account retirement during preflight produces zero requests', async t => {
  const gate = deferred<void>();
  const s = system({ preflight: () => gate.promise }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); const pending = s.controller.confirm(); await tick(); s.change(null); gate.resolve(); await pending;
  assert.equal(s.sends, 0); assert.equal(s.controller.getSnapshot().flow.stage, 'editing');
});

test('[SEC-WALLET-012] retirement after dispatch preserves the original receipt without publishing holdings into a new account', async t => {
  const sent = deferred<Hash>(); const s = system({ send: () => sent.promise }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); const pending = s.controller.confirm(); await tick(); assert.equal(s.sends, 1);
  s.change({ ...initial, id: 'different-object', address: TARGET }); sent.resolve(HASH); await pending;
  assert.equal(s.sends, 1); assert.equal(s.controller.getSnapshot().history.length, 0);
  assert.equal(s.controller.getSnapshot().flow.stage, 'confirmed');
  s.change(initial); assert.equal(s.controller.getSnapshot().history[0]?.hash, HASH);
});

test('[SEC-LOCK-001] repeated confirm while the wallet is open issues exactly one request', async t => {
  const sent = deferred<Hash>(); const s = system({ send: () => sent.promise }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); const first = s.controller.confirm(); await tick(); await s.controller.confirm();
  assert.equal(s.sends, 1); sent.resolve(HASH); await first; assert.equal(s.sends, 1);
});

test('[SEC-RUN-002] a changed pending nonce blocks before dispatch', async t => {
  const s = system({ preflight: async () => { throw new AppError('nonce-changed', 'Nonce changed'); } }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.sends, 0); assert.equal(s.controller.getSnapshot().flow.stage, 'failed');
});

test('[SEC-POLICY-004] a planner cannot replace the accepted input amount', async t => {
  const s = system({ prepare: async (intent, owner) => makePlan({ ...intent, amountWei: intent.amountWei + 1n }, owner) }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); assert.equal(s.controller.getSnapshot().flow.stage, 'failed'); assert.equal(s.sends, 0);
});

test('[SEC-RUN-008] throwing view observers cannot interrupt dispatch, journal or receipt proof', async t => {
  const s = system(); t.after(() => s.controller.dispose()); s.controller.subscribe(() => { throw new Error('broken view'); });
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.controller.getSnapshot().history[0]?.state, 'confirmed'); assert.equal(s.sends, 1);
});

test('[SEC-RECOVERY-003][SEC-RECOVERY-006] unknown confirmation retains the hash and blocks resubmission', async t => {
  const s = system({ observe: async () => { throw new Error('RPC interrupted'); } }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.controller.getSnapshot().flow.stage, 'unverified');
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.sends, 1); assert.equal(s.prepares, 1);
  assert.equal(s.controller.getSnapshot().history[0]?.hash, HASH);
});

test('[SEC-RECOVERY-003] missing receipt stays pending, never becomes failed or automatically retryable', async t => {
  const s = system({ observe: async () => null }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.controller.getSnapshot().flow.stage, 'pending');
  await s.controller.confirm(); assert.equal(s.sends, 1);
});

test('[SEC-RUN-009] wrong-hash receipt cannot confirm a reviewed action', async t => {
  const s = system({ observe: async () => ({ hash: BLOCK, blockHash: BLOCK, blockNumber: 2n, status: 'success', positionId: 42n, networkFeeWei: 1n }) }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.controller.getSnapshot().flow.stage, 'unverified');
});

test('[SEC-MINT-001] outer transaction success without verified mint cannot say the position opened', async t => {
  const s = system({ observe: async () => ({ hash: HASH, blockHash: BLOCK, blockNumber: 2n, status: 'success', networkFeeWei: 10n }) }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.controller.getSnapshot().flow.stage, 'unverified');
  assert.equal(s.controller.getSnapshot().history[0]?.state, 'unverified');
});

test('[SEC-RECEIPT-002] canonical revert retains actual fee and hash without position success', async t => {
  const s = system({ observe: async () => ({ hash: HASH, blockHash: BLOCK, blockNumber: 2n, status: 'reverted', networkFeeWei: 123n }) }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm(); const flow = s.controller.getSnapshot().flow;
  assert.equal(flow.stage, 'failed'); if (flow.stage !== 'failed') return;
  assert.equal(flow.error.code, 'reverted'); assert.equal(flow.hash, HASH); assert.equal(flow.receipt?.networkFeeWei, 123n);
  assert.equal(s.controller.getSnapshot().history[0]?.state, 'reverted');
});

test('[SEC-RUN-007] explicit rejection and unknown dispatch have different recovery states', async t => {
  for (const code of ['user-rejected', 'submission-unknown'] as const) {
    const s = system({ send: async () => { throw new AppError(code, 'Wallet result'); } }); t.after(() => s.controller.dispose());
    await s.controller.prepare(); await s.controller.confirm();
    assert.equal(s.controller.getSnapshot().history[0]?.state, code === 'user-rejected' ? 'declined' : 'unverified');
    assert.equal(s.controller.getSnapshot().flow.stage, code === 'user-rejected' ? 'failed' : 'unverified');
  }
});

test('[SEC-RECOVERY-002] persisted success is downgraded to observation and cannot restore an executable review', async t => {
  const storage = new MemoryStorage(); const s = system({ storage }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm();
  const recovered = new Journal(storage).entries(ACCOUNT);
  assert.equal(recovered.length, 1); assert.equal(recovered[0]?.state, 'pending'); assert.equal(recovered[0]?.verifiedInSession, false);
  assert.equal(recovered[0]?.receipt, undefined);
  const resumed = system({ storage }); t.after(() => resumed.controller.dispose());
  await resumed.controller.confirm(); assert.equal(resumed.sends, 0); assert.equal(resumed.controller.getSnapshot().flow.stage, 'editing');
});

test('[SEC-RECOVERY-005] storage failure after dispatch does not erase the in-memory hash or the earlier unresolved intent', async t => {
  const storage = new MemoryStorage();
  const write = storage.setItem.bind(storage); let writes = 0;
  storage.setItem = (key, value) => { if (writes++ > 0) throw new Error('Quota'); write(key, value); };
  const s = system({ storage, observe: async () => null }); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm(); assert.equal(s.controller.getSnapshot().history[0]?.hash, HASH);
  assert.equal(new Journal(storage).unresolved(ACCOUNT), true);
});

test('[SEC-AMOUNT-003] invalid replacement clears a previous spend instead of silently retaining it', t => {
  const s = system(); t.after(() => s.controller.dispose()); s.controller.setAmount('1e4');
  assert.equal(s.controller.getSnapshot().input.amount, '');
});

test('[SEC-POLICY-001] wrong network never reaches the planner', async t => {
  const s = system(); t.after(() => s.controller.dispose()); s.change({ ...initial, id: 'base', chainId: 8453 });
  await s.controller.prepare(); assert.equal(s.prepares, 0); assert.equal(s.sends, 0);
});

test('[SEC-LOCK-002] an already open tab discovers another tab’s dispatch before its own wallet request', async t => {
  const storage = new MemoryStorage();
  const first = system({ storage, observe: async () => null });
  const second = system({ storage });
  t.after(() => { first.controller.dispose(); second.controller.dispose(); });
  await first.controller.prepare(); await second.controller.prepare();
  assert.equal(second.controller.getSnapshot().flow.stage, 'review');
  await first.controller.confirm(); await second.controller.confirm();
  assert.equal(first.sends, 1); assert.equal(second.sends, 0);
  assert.equal(second.controller.getSnapshot().history[0]?.hash, HASH);
  assert.equal(second.controller.getSnapshot().history[0]?.verifiedInSession, false);
});

test('[SEC-RECOVERY-002] a neighboring tab’s hash is discoverable but its success label is never proof', () => {
  const storage = new MemoryStorage();
  const reader = new Journal(storage); const writer = new Journal(storage);
  const record = writer.begin(makePlan({ market: 'ETH', side: 'long', token: 'ETH', amountWei: 1n, leverageBps: 30_000, slippageBps: 50 }, initial), T0);
  assert.equal(reader.unresolved(ACCOUNT), true);
  assert.equal(reader.entries(ACCOUNT)[0]?.hash, undefined);
  writer.update(record.view.id, { hash: HASH, state: 'confirmed', verifiedInSession: true });
  assert.equal(reader.get(record.view.id)?.view.hash, HASH);
  assert.equal(reader.get(record.view.id)?.view.state, 'pending');
  assert.equal(reader.get(record.view.id)?.view.verifiedInSession, false);
});

test('[SEC-REVIEW-002] the dispatch guard rejects expiry after the final asynchronous wallet checks', async t => {
  const s = system(); t.after(() => s.controller.dispose());
  const original = s.runtime.wallet.send.bind(s.runtime.wallet);
  s.runtime.wallet.send = async (call, session, guard) => { s.advance(30_001); return original(call, session, guard); };
  await s.controller.prepare(); await s.controller.confirm();
  assert.equal(s.sends, 0); assert.equal(s.controller.getSnapshot().flow.stage, 'expired');
  assert.equal(s.controller.getSnapshot().history.length, 0);
});

test('[SEC-REVIEW-002] clock rollback cannot extend accepted review authority', async t => {
  const s = system(); t.after(() => s.controller.dispose());
  await s.controller.prepare(); s.advance(-1); await s.controller.confirm();
  assert.equal(s.sends, 0); assert.equal(s.controller.getSnapshot().flow.stage, 'expired');
});

test('[SEC-LOCK-002][SEC-RECOVERY-005] denied pre-prompt persistence blocks both tabs before either wallet request', async t => {
  const storage: StoragePort = { length: 0, key: () => null, getItem: () => null, setItem() { throw new Error('Storage denied'); } };
  const first = system({ storage }); const second = system({ storage });
  t.after(() => { first.controller.dispose(); second.controller.dispose(); });
  await first.controller.prepare(); await second.controller.prepare();
  await first.controller.confirm(); await second.controller.confirm();
  assert.equal(first.sends, 0); assert.equal(second.sends, 0);
  assert.equal(first.controller.getSnapshot().flow.stage, 'failed');
  assert.equal(second.controller.getSnapshot().history.length, 0);
});

test('[SEC-RECOVERY-002] a stored declined label cannot clear an unknown no-hash submission', () => {
  const storage = new MemoryStorage(); const writer = new Journal(storage);
  const record = writer.begin(makePlan({ market: 'ETH', side: 'long', token: 'ETH', amountWei: 1n, leverageBps: 30_000, slippageBps: 50 }, initial), T0);
  const key = storage.key(0)!; const hint = JSON.parse(storage.getItem(key)!); hint.state = 'declined';
  storage.setItem(key, JSON.stringify(hint));
  const recovered = new Journal(storage);
  assert.equal(recovered.unresolved(ACCOUNT), true); assert.equal(recovered.get(record.view.id)?.view.state, 'unverified');
});

test('[SEC-REVIEW-003] cancelling a hung read-only wallet check releases confirmation for a new review', async t => {
  const s = system(); t.after(() => s.controller.dispose());
  await s.controller.prepare();
  const original = s.runtime.wallet.assertSession;
  s.runtime.wallet.assertSession = async () => new Promise(() => {});
  const first = s.controller.confirm(); await tick(); s.controller.cancelReview();
  const settled = await Promise.race([first.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50))]);
  assert.equal(settled, true); assert.equal(s.sends, 0);
  s.runtime.wallet.assertSession = original;
  await s.controller.prepare(); await s.controller.confirm();
  assert.equal(s.sends, 1); assert.equal(s.controller.getSnapshot().flow.stage, 'confirmed');
});

test('[SEC-RECOVERY-004] a late receipt for an older attempt updates history without replacing a new review', async t => {
  const s = system(); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm();
  const previous = s.controller.getSnapshot().history[0]!;
  const delayed = deferred<VerifiedReceipt>(); s.runtime.protocol.observe = async () => delayed.promise;
  const observation = s.controller.checkReceipt(previous.id); await tick();
  s.controller.setAmount('0.2'); await s.controller.prepare();
  assert.equal(s.controller.getSnapshot().flow.stage, 'review');
  delayed.resolve(s.receipt); await observation;
  const flow = s.controller.getSnapshot().flow;
  assert.equal(flow.stage, 'review'); if (flow.stage === 'review') assert.equal(flow.plan.intent.amountWei, 200_000_000_000_000_000n);
});

test('[SEC-RECEIPT-001] a failed recheck withdraws current receipt proof instead of retaining verified position output', async t => {
  const s = system(); t.after(() => s.controller.dispose());
  await s.controller.prepare(); await s.controller.confirm();
  const id = s.controller.getSnapshot().history[0]!.id;
  s.runtime.protocol.observe = async () => { throw new Error('Reorg or unavailable evidence'); };
  await s.controller.checkReceipt(id);
  const history = s.controller.getSnapshot().history[0]!;
  assert.equal(history.state, 'unverified'); assert.equal(history.verifiedInSession, false); assert.equal(history.receipt, undefined);
});

test('[SEC-MINT-001] fresh outer receipt proof survives a missing position while position success stays withheld', async t => {
  const s = system({ observe: async () => ({ hash: HASH, blockHash: BLOCK, blockNumber: 2n, status: 'success', networkFeeWei: 10n }) });
  t.after(() => s.controller.dispose()); await s.controller.prepare(); await s.controller.confirm();
  const row = s.controller.getSnapshot().history[0]!;
  assert.equal(row.state, 'unverified'); assert.equal(row.verifiedInSession, true); assert.equal(row.receipt?.status, 'success'); assert.equal(row.receipt?.positionId, undefined);
});

test('[SEC-REVIEW-003] synchronous wallet retirement observes the already-started preparation rejection', async t => {
  const s = system(); t.after(() => s.controller.dispose());
  s.runtime.wallet.assertSession = async () => { s.change(null); throw new AppError('cancelled', 'Retired synchronously'); };
  await s.controller.prepare(); await tick();
  assert.equal(s.controller.getSnapshot().flow.stage, 'editing'); assert.equal(s.sends, 0);
});
