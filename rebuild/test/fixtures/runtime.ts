/** DETERMINISTIC TEST BUILD ONLY. No public RPC, private keys or real funds. */
import { AppError, assertActive } from '../../src/domain/errors';
import type { Hash, LongIntent, PreparedLong, ProtocolPort, Runtime, WalletSession } from '../../src/domain/ports';
import { createBrowserWallet } from '../../src/wallet/browser';
import { createHost } from '../../src/host/browser';

const WAD = 10n ** 18n;
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
const CONTRACT = '0x2222222222222222222222222222222222222222' as const;
const HASH = `0x${'ab'.repeat(32)}` as Hash;
const BLOCK = `0x${'cd'.repeat(32)}` as Hash;
const DATA = `0x94ad7494${'0'.repeat(64)}` as Hash;
const PRICE = 352045n * 10n ** 16n;
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function createRuntime(): Runtime {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    throw new Error('The simulation build may run only on loopback.');
  }
  const query = new URLSearchParams(location.search);
  const scenario = query.get('scenario') ?? 'success';
  const requestedTtl = Number(query.get('ttl') ?? '30000');
  const ttl = Number.isInteger(requestedTtl) && requestedTtl >= 500 && requestedTtl <= 30000 ? requestedTtl : 30000;
  let account = ACCOUNT as string;
  let chain = scenario === 'wrong-chain' ? '0x2105' : '0x1';
  let connected = false;
  let sends = 0;
  let nonce = 7;
  let plan: PreparedLong | undefined;
  const requests: Array<{ method: string; params?: unknown }> = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (name: string, value: unknown): void => { for (const fn of listeners.get(name) ?? []) fn(value); };
  const provider = {
    async request(request: { method: string; params?: unknown }): Promise<unknown> {
      requests.push(request);
      switch (request.method) {
        case 'eth_requestAccounts': connected = true; return [account];
        case 'eth_accounts': return connected ? [account] : [];
        case 'eth_chainId': return chain;
        case 'wallet_switchEthereumChain': chain = '0x1'; emit('chainChanged', chain); return null;
        case 'eth_sendTransaction': {
          sends++;
          await delay(250);
          if (scenario === 'reject') throw { code: 4001, message: 'Test rejection' };
          if (scenario === 'unknown-send') throw { code: -32603, message: 'Test transport interruption' };
          const calls = request.params as Array<Record<string, unknown>>;
          const actual = calls[0];
          if (!plan || !actual || actual.to !== plan.call.to || actual.data !== plan.call.data || BigInt(String(actual.value)) !== plan.call.value) throw new Error('Fixture reviewed/send mismatch');
          nonce++;
          return HASH;
        }
        default: throw new Error('Unsupported fixture wallet method');
      }
    },
    on(name: string, fn: (...args: unknown[]) => void): void {
      const group = listeners.get(name) ?? new Set(); group.add(fn); listeners.set(name, group);
    },
    removeListener(name: string, fn: (...args: unknown[]) => void): void { listeners.get(name)?.delete(fn); }
  };
  const wallet = createBrowserWallet({ events: new EventTarget(), injected: () => provider });
  const protocol: ProtocolPort = {
    async readMarket(address, signal) {
      await delay(60); assertActive(signal);
      return { chainId: 1, blockNumber: 26_000_000n, readAt: Date.now(), balanceWei: address ? 2_586n * 10n ** 15n : undefined,
        priceUsdE18: PRICE, minLeverageBps: 11_000, maxLeverageBps: 50_000, paused: false };
    },
    async prepare(intent: LongIntent, session: WalletSession, signal) {
      await delay(scenario === 'slow-quote' ? 6_000 : 450); assertActive(signal);
      if (scenario === 'simulation-error') throw new AppError('simulation', 'The transaction simulation reverted. No wallet request was made. Refresh the quote or lower the amount.');
      if (scenario === 'insufficient-funds' || intent.amountWei > 25n * WAD / 10n) throw new AppError('insufficient-funds', 'Keep enough ETH for the trade and its estimated network fee.');
      const now = Date.now();
      const collateral = intent.amountWei * BigInt(intent.leverageBps) * 999n / (10000n * 1000n);
      const debt = intent.amountWei * PRICE * BigInt(intent.leverageBps - 10000) / (WAD * 10000n);
      const value = collateral * PRICE / WAD;
      const fee = 200_000n * 18_000_000_000n;
      plan = {
        id: `0x${intent.amountWei.toString(16).padStart(64, '0')}`,
        sessionId: session.id, intent: { ...intent }, preparedAt: now, expiresAt: now + ttl, blockNumber: 26_000_000n,
        call: { chainId: 1, from: session.address, to: CONTRACT, data: DATA, value: intent.amountWei, nonce },
        economics: { collateralStEthWei: collateral, debtFxUsdWei: debt, estimatedLeverageBps: Number(value * 10000n / (value - debt)),
          executionPriceUsdE18: PRICE, minimumWstEthWei: intent.amountWei * 995n * 10n / (1000n * 12n),
          supplyFeeRatio: 1_000_000n, borrowFeeRatio: 0n },
        gasLimit: 200_000n, feePerGasWei: 18_000_000_000n, estimatedNetworkFeeWei: fee,
        requiredBalanceWei: intent.amountWei + fee, simulation: 'passed'
      };
      return plan;
    },
    async preflight(accepted, session, signal) {
      await delay(100); assertActive(signal);
      if (scenario === 'account-change') { account = '0x3333333333333333333333333333333333333333'; emit('accountsChanged', [account]); }
      if (scenario === 'nonce-drift') throw new AppError('nonce-changed', 'Your wallet nonce changed. Refresh and review before signing.');
      if (session.id !== accepted.sessionId || accepted.call.nonce !== nonce) throw new AppError('nonce-changed', 'This transaction is no longer current.');
    },
    async observe(hash, call, signal) {
      await delay(180); assertActive(signal);
      if (scenario === 'pending') return null;
      if (scenario === 'receipt-error') throw new AppError('receipt-unverified', 'Receipt unavailable in this simulation.');
      if (hash !== HASH || call.to !== CONTRACT || sends < 1) return null;
      return { hash, blockHash: BLOCK, blockNumber: 26_000_001n, status: scenario === 'reverted' ? 'reverted' : 'success', networkFeeWei: 170_000n * 15_000_000_000n,
        positionId: scenario === 'missing-position' || scenario === 'reverted' ? undefined : 701n,
        position: scenario === 'missing-position' || scenario === 'reverted' || !plan ? undefined : {
          id: 701n, collateralStEthWei: plan.economics.collateralStEthWei - 100n, debtFxUsdWei: plan.economics.debtFxUsdWei, leverageBps: plan.economics.estimatedLeverageBps
        } };
    }
  };
  Object.defineProperty(window, '__fxaeonTest', { configurable: false, value: Object.freeze({
    snapshot: () => ({ scenario, sends, requests: [...requests], acceptedData: plan?.call.data, acceptedValue: plan?.call.value.toString() }),
    changeAccount: () => { account = '0x3333333333333333333333333333333333333333'; emit('accountsChanged', [account]); },
    changeChain: () => { chain = '0x2105'; emit('chainChanged', chain); }
  }) });
  return { mode: 'simulation', protocol, wallet, host: createHost() };
}
