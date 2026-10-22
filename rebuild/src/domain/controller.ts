import { intentFromInput, sameIntent } from './amount';
import { AppError, assertActive, safeError } from './errors';
import { Journal } from './journal';
import type { StoragePort } from './journal';
import type { PreparedLong, Runtime, WalletSession } from './ports';
import type { AppController, AppState, Flow, TicketInput } from './view';

export interface ControllerOptions {
  readonly now?: () => number;
  readonly storage?: StoragePort;
  readonly tickMs?: number;
  readonly preparationMs?: number;
  readonly receiptPollMs?: number;
  readonly withWalletLock?: <T>(account: string, task: () => Promise<T>) => Promise<T>;
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) immutable(item);
    Object.freeze(value);
  }
  return value;
}

async function browserWalletLock<T>(account: string, task: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new AppError('busy', 'This browser cannot safely reserve your wallet. Open FxAeon in a supported wallet browser.');
  }
  return navigator.locks.request(`fxaeon:sign:${account.toLowerCase()}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw new AppError('busy', 'Another FxAeon tab is using this wallet. Finish that request first.');
    return task();
  });
}

async function bounded<T>(work: Promise<T>, abort: AbortController, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const boundary = new Promise<never>((_, reject) => {
    cancel = () => reject(new AppError('cancelled', 'This request was cancelled.'));
    abort.signal.addEventListener('abort', cancel, { once: true });
    // Work may synchronously retire its own generation before this boundary
    // attaches. Still race/observe that promise so its later rejection is handled.
    if (abort.signal.aborted) cancel();
    timer = setTimeout(() => {
      reject(new AppError('unavailable', 'Verification took too long. No transaction was requested.'));
      abort.abort();
    }, ms);
  });
  try { return await Promise.race([work, boundary]); }
  finally {
    clearTimeout(timer);
    if (cancel) abort.signal.removeEventListener('abort', cancel);
  }
}

export class TradeController implements AppController {
  readonly #listeners = new Set<() => void>();
  readonly #journal: Journal;
  readonly #now: () => number;
  readonly #lock: NonNullable<ControllerOptions['withWalletLock']>;
  readonly #options: ControllerOptions;
  readonly #unwatch: () => void;
  readonly #tick?: ReturnType<typeof setInterval>;
  readonly #observers = new Map<string, AbortController>();
  readonly #polls = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #pollStarted = new Map<string, number>();
  #state: AppState;
  #operation?: AbortController;
  #marketRead?: AbortController;
  #generation = 0;
  #marketGeneration = 0;
  #confirming = false;
  #disposed = false;
  #activeRecord?: string;

  constructor(readonly runtime: Runtime, options: ControllerOptions = {}) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#lock = options.withWalletLock ?? browserWalletLock;
    this.#journal = new Journal(options.storage);
    const wallet = runtime.wallet.session();
    this.#state = Object.freeze({ route: 'trade', theme: 'dark', input: Object.freeze({ amount: '', leverage: '3', slippageBps: 50 }), wallet,
      choices: runtime.wallet.choices(), market: Object.freeze({ status: 'idle' }), flow: Object.freeze({ stage: 'editing' }),
      history: this.#journal.entries(wallet?.address), now: this.#now() });
    this.#unwatch = runtime.wallet.subscribe(() => this.#walletChanged());
    const tickMs = options.tickMs ?? 1_000;
    if (tickMs > 0) this.#tick = setInterval(() => {
      const now = this.#now();
      const flow = this.#state.flow;
      this.#publish({ now, ...(flow.stage === 'review' && now >= flow.plan.expiresAt ? { flow: { stage: 'expired', plan: flow.plan } as Flow } : {}) });
    }, tickMs);
  }

  getSnapshot = (): AppState => this.#state;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #publish(patch: Partial<AppState>): void {
    if (this.#disposed) return;
    const wallet = patch.wallet === undefined ? this.#state.wallet : patch.wallet;
    this.#state = Object.freeze({ ...this.#state, ...patch, history: this.#journal.entries(wallet?.address), now: this.#now() });
    for (const notify of this.#listeners) {
      try { notify(); } catch { /* A view observer cannot interrupt execution or recovery. */ }
    }
  }

  #retirePreparation(): void {
    this.#generation++;
    this.#operation?.abort();
    this.#operation = undefined;
    this.#activeRecord = undefined;
  }

  #walletChanged(): void {
    const previous = this.#state.wallet;
    const current = this.runtime.wallet.session();
    const changed = previous?.id !== current?.id || previous?.address !== current?.address || previous?.chainId !== current?.chainId;
    const patch: Partial<AppState> = { wallet: current, choices: this.runtime.wallet.choices() };
    if (changed) {
      if (['preparing', 'review', 'expired', 'checking'].includes(this.#state.flow.stage)) {
        this.#retirePreparation();
        Object.assign(patch, { flow: { stage: 'editing' }, notice: { code: 'wallet-changed', message: 'Wallet context changed. Review the trade again before signing.' } });
      }
      this.#marketRead?.abort();
      Object.assign(patch, { market: { status: 'idle' } });
    }
    this.#publish(patch);
    if (changed) {
      void this.refreshMarket();
      if (current) for (const entry of this.#journal.entries(current.address)) {
        if (entry.hash && !entry.verifiedInSession) void this.checkReceipt(entry.id);
      }
    }
  }

  #edit(patch: Partial<TicketInput>): void {
    if (['checking', 'signing', 'pending', 'unverified'].includes(this.#state.flow.stage)) return;
    this.#retirePreparation();
    this.#publish({ input: Object.freeze({ ...this.#state.input, ...patch }), flow: { stage: 'editing' }, notice: undefined });
  }
  setAmount(value: string): void {
    if (!/^\d*(?:\.\d*)?$/.test(value) || value.length > 100) {
      this.#edit({ amount: '' });
      this.#publish({ notice: { code: 'invalid-input', message: 'Enter an amount using digits and one decimal point.' } });
      return;
    }
    this.#edit({ amount: value });
  }
  setLeverage(value: string): void {
    this.#edit({ leverage: /^\d*(?:\.\d*)?$/.test(value) && value.length <= 8 ? value : '' });
  }
  setSlippage(value: number): void { this.#edit({ slippageBps: value }); }
  setTheme(value: 'dark' | 'light'): void {
    this.#publish({ theme: value });
    this.runtime.host.setTheme(value);
  }
  navigate(route: 'trade' | 'history'): void { this.#publish({ route }); }
  clearNotice(): void { this.#publish({ notice: undefined }); }

  async connect(choiceId: string): Promise<void> {
    try { await this.runtime.wallet.connect(choiceId); }
    catch (error) { this.#publish({ notice: safeError(error) }); }
  }
  disconnect(): void { this.runtime.wallet.disconnect(); }
  async switchChain(): Promise<void> {
    try { await this.runtime.wallet.switchToEthereum(); }
    catch (error) { this.#publish({ notice: safeError(error) }); }
  }

  async refreshMarket(): Promise<void> {
    if (this.#disposed) return;
    this.#marketRead?.abort();
    const abort = new AbortController();
    this.#marketRead = abort;
    const generation = ++this.#marketGeneration;
    const walletId = this.#state.wallet?.id;
    this.#publish({ market: { status: 'loading' } });
    try {
      const facts = await bounded(this.runtime.protocol.readMarket(this.#state.wallet?.address, abort.signal), abort, 15_000);
      if (generation !== this.#marketGeneration || walletId !== this.#state.wallet?.id || abort.signal.aborted) return;
      if (facts.chainId !== 1 || facts.readAt > this.#now() + 1_000 || this.#now() - facts.readAt > 15_000) {
        throw new AppError('unavailable', 'Current Ethereum market data could not be verified.');
      }
      this.#publish({ market: { status: 'ready', facts: immutable(facts) } });
    } catch (error) {
      if (generation === this.#marketGeneration && !this.#disposed) {
        this.#publish({ market: { status: 'error', message: safeError(error).message } });
      }
    }
  }

  async prepare(): Promise<void> {
    if (this.#disposed || ['checking', 'signing', 'pending', 'unverified'].includes(this.#state.flow.stage)) return;
    this.#retirePreparation();
    const generation = this.#generation;
    const abort = new AbortController();
    this.#operation = abort;
    try {
      const session = this.#state.wallet;
      if (!session) throw new AppError('wallet-changed', 'Connect your wallet to review this trade.');
      if (session.chainId !== 1) throw new AppError('wrong-chain', 'Switch your wallet to Ethereum to continue.');
      if (this.#journal.unresolved(session.address)) throw new AppError('busy', 'Check the unresolved transaction in History before starting another trade.');
      const intent = intentFromInput(this.#state.input);
      this.#publish({ flow: { stage: 'preparing' }, notice: undefined });
      const work = (async () => {
        await this.runtime.wallet.assertSession(session, abort.signal);
        assertActive(abort.signal);
        const prepared = await this.runtime.protocol.prepare(intent, session, abort.signal);
        assertActive(abort.signal);
        await this.runtime.wallet.assertSession(session, abort.signal);
        return prepared;
      })();
      const plan = await bounded(work, abort, this.#options.preparationMs ?? 45_000);
      if (generation !== this.#generation) return;
      assertActive(abort.signal);
      if (!sameIntent(plan.intent, intent) || plan.sessionId !== session.id || plan.call.from.toLowerCase() !== session.address.toLowerCase() ||
          plan.call.chainId !== 1 || plan.call.value !== intent.amountWei || plan.simulation !== 'passed' ||
          plan.preparedAt > this.#now() || plan.expiresAt <= this.#now() || plan.expiresAt - plan.preparedAt > 30_000 ||
          plan.expiresAt <= plan.preparedAt || plan.requiredBalanceWei < plan.call.value || plan.estimatedNetworkFeeWei <= 0n) {
        throw new AppError('policy', 'The prepared transaction does not match this review. No wallet request was made.');
      }
      if (generation !== this.#generation) return;
      this.#publish({ flow: { stage: 'review', plan: immutable(plan) } });
    } catch (error) {
      if (generation === this.#generation && !this.#disposed) this.#publish({ flow: { stage: 'failed', error: safeError(error) } });
    }
  }

  cancelReview(): void {
    if (!['editing', 'preparing', 'review', 'expired', 'checking', 'failed'].includes(this.#state.flow.stage)) return;
    this.#retirePreparation();
    this.#publish({ flow: { stage: 'editing' }, notice: undefined });
  }

  #checkAccepted(plan: PreparedLong, session: WalletSession): void {
    if (this.#now() < plan.preparedAt || this.#now() >= plan.expiresAt) throw new AppError('expired', 'This quote expired or the clock changed. Refresh and review the new terms.');
    if (this.#state.wallet?.id !== session.id || plan.sessionId !== session.id || !sameIntent(intentFromInput(this.#state.input), plan.intent)) {
      throw new AppError('wallet-changed', 'The wallet or trade changed. Review it again before signing.');
    }
  }

  async confirm(): Promise<void> {
    if (this.#disposed || this.#confirming || this.#state.flow.stage !== 'review') return;
    this.#confirming = true;
    const plan = this.#state.flow.plan;
    const session = this.#state.wallet;
    const abort = new AbortController();
    this.#operation = abort;
    const generation = ++this.#generation;
    let recordId: string | undefined;
    let issued = false;
    try {
      if (!session) throw new AppError('wallet-changed', 'Connect the reviewed wallet to continue.');
      this.#checkAccepted(plan, session);
      this.#publish({ flow: { stage: 'checking', plan } });
      await this.#lock(session.address, async () => {
        if (this.#journal.unresolved(session.address)) throw new AppError('busy', 'This wallet has an unresolved transaction. Check History first.');
        this.#checkAccepted(plan, session);
        await bounded((async () => {
          assertActive(abort.signal);
          await this.runtime.wallet.assertSession(session, abort.signal);
          assertActive(abort.signal);
          await this.runtime.protocol.preflight(plan, session, abort.signal);
          assertActive(abort.signal);
          await this.runtime.wallet.assertSession(session, abort.signal);
          assertActive(abort.signal);
        })(), abort, Math.min(15_000, plan.expiresAt - this.#now()));
        this.#checkAccepted(plan, session);
        const hash = await this.runtime.wallet.send(plan.call, session, {
          signal: abort.signal, maxReadMs: Math.min(15_000, plan.expiresAt - this.#now()),
          beforeDispatch: () => {
            assertActive(abort.signal);
            if (this.#disposed || generation !== this.#generation) throw new AppError('cancelled', 'This review is no longer active.');
            this.#checkAccepted(plan, session);
            const record = this.#journal.begin(plan, this.#now());
            recordId = record.view.id;
            this.#activeRecord = recordId;
            this.#publish({ flow: { stage: 'signing', plan } });
            assertActive(abort.signal);
            this.#checkAccepted(plan, session);
            issued = true;
          }
        });
        if (!recordId || !issued) throw new AppError('submission-unknown', 'The wallet did not preserve the reviewed authorization boundary. Check its activity before proceeding.');
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new AppError('submission-unknown', 'The wallet returned an unreadable transaction reference. Check your wallet before taking another action.');
        this.#journal.update(recordId, { hash, state: 'pending' });
        this.#publish({ flow: { stage: 'pending', plan, hash } });
      });
      if (recordId) await this.checkReceipt(recordId);
    } catch (error) {
      const failure = safeError(error);
      const definiteNoSend = ['user-rejected', 'wallet-changed', 'wrong-chain', 'expired', 'policy', 'nonce-changed', 'cancelled'].includes(failure.code);
      if (recordId) this.#journal.update(recordId, { state: definiteNoSend ? 'declined' : 'unverified' });
      if (this.#disposed || (generation !== this.#generation && !issued)) return;
      if (issued && !definiteNoSend) {
        this.#publish({ flow: { stage: 'unverified', plan, error: { code: 'submission-unknown', message: 'Submission could not be confirmed. Check your wallet and History. Do not submit this trade again.' } } });
      } else if (failure.code === 'expired') {
        this.#publish({ flow: { stage: 'expired', plan } });
      } else {
        this.#publish({ flow: { stage: 'failed', plan, error: failure } });
      }
    } finally { this.#confirming = false; }
  }

  async checkReceipt(id = this.#activeRecord): Promise<void> {
    if (!id || this.#disposed || this.#observers.has(id)) return;
    const record = this.#journal.get(id);
    if (!record || (record.view.account !== this.#state.wallet?.address.toLowerCase() && id !== this.#activeRecord)) return;
    const hash = record.view.hash;
    if (!hash) {
      this.#publish({ notice: { code: 'submission-unknown', message: 'No transaction hash is available. Check your wallet activity before taking another action.' } });
      return;
    }
    clearTimeout(this.#polls.get(id));
    this.#polls.delete(id);
    const abort = new AbortController();
    this.#observers.set(id, abort);
    try {
      const receipt = await bounded(this.runtime.protocol.observe(hash, record.call, abort.signal), abort, 25_000);
      if (this.#disposed) return;
      if (!receipt) {
        this.#journal.update(id, { state: 'pending', verifiedInSession: false, receipt: undefined });
        this.#publish({ ...(id === this.#activeRecord && record.plan ? { flow: { stage: 'pending', plan: record.plan, hash } as Flow } : {}) });
        const started = this.#pollStarted.get(id) ?? this.#now();
        this.#pollStarted.set(id, started);
        if (this.#now() - started < 90_000) {
          this.#polls.set(id, setTimeout(() => { void this.checkReceipt(id); }, this.#options.receiptPollMs ?? 2_500));
        } else {
          this.#unverified(id, 'Confirmation is taking longer than expected. Keep the hash and check again; do not resubmit.');
        }
        return;
      }
      if (receipt.hash.toLowerCase() !== hash.toLowerCase()) throw new AppError('receipt-unverified', 'The returned receipt does not match this transaction.');
      immutable(receipt);
      if (receipt.status === 'reverted') {
        this.#journal.update(id, { state: 'reverted', receipt, verifiedInSession: true });
        this.#publish({ ...(id === this.#activeRecord && record.plan ? { flow: { stage: 'failed', plan: record.plan, hash, receipt, error: { code: 'reverted', message: 'The transaction reverted on Ethereum. No position was opened. Network fees were still paid.' } } as Flow } : {}) });
      } else if (receipt.positionId === undefined) {
        this.#journal.update(id, { receipt, verifiedInSession: true });
        this.#unverified(id, 'The transaction is confirmed, but its position could not yet be verified. Check again before opening another trade.', true);
      } else {
        this.#journal.update(id, { state: 'confirmed', receipt, verifiedInSession: true });
        this.#publish({ ...(id === this.#activeRecord && record.plan ? { flow: { stage: 'confirmed', plan: record.plan, receipt } as Flow } : {}) });
      }
      this.#pollStarted.delete(id);
      if (record.view.account === this.#state.wallet?.address.toLowerCase()) void this.refreshMarket();
    } catch {
      if (!this.#disposed) this.#unverified(id, 'The transaction cannot currently be verified. Your hash is saved. Check again; do not resubmit.');
    } finally { this.#observers.delete(id); }
  }

  #unverified(id: string, message: string, currentReceiptProven = false): void {
    const record = this.#journal.get(id);
    if (!record) return;
    this.#journal.update(id, { state: 'unverified', ...(currentReceiptProven ? {} : { verifiedInSession: false, receipt: undefined }) });
    this.#publish({ ...(id === this.#activeRecord && record.plan ? { flow: { stage: 'unverified', plan: record.plan, hash: record.view.hash, error: { code: 'receipt-unverified', message } } as Flow } : {}) });
  }

  dispose(): void {
    this.#disposed = true;
    this.#retirePreparation();
    this.#marketRead?.abort();
    this.#unwatch();
    clearInterval(this.#tick);
    for (const timer of this.#polls.values()) clearTimeout(timer);
    for (const observer of this.#observers.values()) observer.abort();
    this.#listeners.clear();
  }
}
