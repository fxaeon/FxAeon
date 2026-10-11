/** Deterministic EIP-1193 wallet used by browser-only connected-flow tests. */
export interface BrowserWalletShimOptions {
  address?: string;
  /** Start with a remembered app session and exposed account, or require an explicit connection. */
  initiallyConnected?: boolean;
  /** Withhold both injection and EIP-6963 discovery until `window.__wallet.inject()`. */
  manualInjection?: boolean;
  chainId?: string;
  /** Deterministic switch behavior for network-selector browser regressions. */
  switchChain?: {
    /** Hold a switch request open long enough for pending UI assertions. */
    delayMs?: number;
    /** Hold the request until the test calls `window.__wallet.releaseSwitch()`. */
    manual?: boolean;
    /** Consume one outcome per switch request; omitted entries succeed. */
    outcomes?: ('success' | 'reject' | 'noop')[];
  };
}

export function browserWalletInitScript(_opts: BrowserWalletShimOptions = {}): (o: BrowserWalletShimOptions) => void {
  return (o: BrowserWalletShimOptions) => {
    // tsx emits calls to this helper while serializing the fixture function.
    // Install it on the browser global before those calls execute, so separate
    // Playwright init-script ordering cannot cause a reference error.
    (globalThis as Record<string, unknown>)['__name'] = function (target: unknown): unknown { return target; };
    let address = o.address ?? '0x930f0000000000000000000000000000000098b9';
    let connected = o.initiallyConnected ?? false;
    let chainId = o.chainId ?? '0x1';
    const providerRdns = 'com.fxaeon.test';
    // A connected-flow fixture models a prior deliberate app connection, not
    // an arbitrary extension that happens to expose eth_accounts. Seed only
    // once per tab/origin so reload cannot undo disconnect or rewrite a saved
    // account/provider preference. The app still verifies fresh wallet state.
    const seededKey = 'fxaeon:e2e-browser-wallet-session-seeded';
    if (!sessionStorage.getItem(seededKey)) {
      sessionStorage.setItem(seededKey, '1');
      if (connected && localStorage.getItem('fxaeon:browser-wallet-disconnected') !== '1') {
        localStorage.setItem('fxaeon:wallet-provider-rdns', providerRdns);
        localStorage.setItem('fxaeon:browser-wallet-address', address);
      }
    }
    let switchAttempt = 0;
    const pendingSwitches: Array<() => void> = [];
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((listener) => listener(...args));
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        requests.push({ method, params });
        if (method === 'eth_accounts') return connected ? [address] : [];
        if (method === 'eth_requestAccounts') { connected = true; return [address]; }
        if (method === 'wallet_revokePermissions') {
          connected = false;
          emit('accountsChanged', []);
          return null;
        }
        if (method === 'eth_chainId') return chainId;
        if (method === 'wallet_switchEthereumChain') {
          const next = (params?.[0] as { chainId?: unknown } | undefined)?.chainId;
          if (typeof next !== 'string') throw new Error('missing chain id');
          const switchOptions = o.switchChain;
          const delayMs = Math.max(0, switchOptions?.delayMs ?? 0);
          if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          if (switchOptions?.manual) await new Promise<void>((resolve) => pendingSwitches.push(resolve));
          const outcome = switchOptions?.outcomes?.[switchAttempt++] ?? 'success';
          if (outcome === 'reject') {
            const error = new Error('User rejected the network switch.') as Error & { code?: number };
            error.code = 4001;
            throw error;
          }
          if (outcome === 'noop') return null;
          chainId = next;
          emit('chainChanged', chainId);
          return null;
        }
        if (method === 'wallet_addEthereumChain') return null;
        if (method === 'eth_sendTransaction') return `0x${'1'.repeat(64)}`;
        throw new Error(`Unhandled test wallet method: ${method}`);
      },
      on(event: string, listener: (...args: unknown[]) => void) { (listeners.get(event) ?? (listeners.set(event, new Set()), listeners.get(event)!)).add(listener); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    };
    let injected = false;
    const announce = () => {
      if (!injected) return;
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { provider, info: { name: 'Test wallet', rdns: providerRdns } },
      }));
    };
    const inject = () => {
      injected = true;
      (window as unknown as { ethereum: unknown }).ethereum = provider;
      announce();
    };
    window.addEventListener('eip6963:requestProvider', announce);
    (window as unknown as { __wallet: unknown }).__wallet = {
      provider,
      requests,
      inject,
      /** Test-only controls exercise real accountsChanged lifecycle handling. */
      setAccounts(accounts: string[]) {
        if (accounts.length > 0) {
          address = accounts[0];
          connected = true;
        } else {
          connected = false;
        }
        emit('accountsChanged', connected ? [address] : []);
      },
      releaseSwitch() { pendingSwitches.shift()?.(); },
    };
    if (!o.manualInjection) inject();
  };
}
