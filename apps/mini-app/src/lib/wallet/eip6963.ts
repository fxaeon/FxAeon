import { walletIdentityRdns } from './walletIdentity';

export type Eip6963Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
export type Eip6963Announcement = { info?: { rdns?: string; name?: string }; provider?: Eip6963Provider };
export type DiscoveredEip6963Provider = { provider: Eip6963Provider; name: string; rdns: string };
export type WalletProviderDiscoveryTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
const discovered: DiscoveredEip6963Provider[] = [];
const DEFAULT_PROVIDER_WAIT_TIMEOUT_MS = 1_000;
const DEFAULT_PROVIDER_WAIT_POLL_MS = 25;
const safeText = (value: unknown, fallback: string) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/g, '').trim().slice(0, 96) || fallback : fallback;
export function recordEip6963Announcement(value: unknown): DiscoveredEip6963Provider | null {
  // Browser events are a runtime boundary; TypeScript cannot validate an
  // extension's announcement or guarantee that it supplies a request method.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const announcement = value as Eip6963Announcement;
    const provider = announcement.provider;
    if (!provider || typeof provider.request !== 'function') return null;
    const info = announcement.info;
    const previous = discovered.find((item) => item.provider === provider);
    const index = discovered.length + 1;
    const rdns = walletIdentityRdns(safeText(info?.rdns, previous?.rdns ?? `unknown-wallet-${index}`));
    // An exact repeat (including a known alias) is harmless. A different
    // identity claim must survive ingestion so the chooser can fail closed.
    if (discovered.some((item) => item.provider === provider && item.rdns === rdns)) return null;
    const item = { provider, name: safeText(info?.name, 'Wallet'), rdns };
    discovered.push(item);
    return item;
  } catch { return null; } // Untrusted announcement/provider/info getters.

}
export function getDiscoveredEip6963Providers(): readonly DiscoveredEip6963Provider[] { return discovered; }
export function selectEip6963Provider(rdns: string | null | undefined): DiscoveredEip6963Provider | undefined {
  const matches = rdns ? discovered.filter((candidate) => candidate.rdns === walletIdentityRdns(rdns)) : [];
  // Display metadata is self-attested. Ambiguous claims never choose first.
  const unique = matches.length === 1 ? matches[0] : undefined;
  return unique && !discovered.some((item) => item.provider === unique.provider && item.rdns !== unique.rdns)
    ? unique : undefined;
}
export function shouldPromptEip6963Provider(preferredRdns?: string | null): boolean { return discovered.length > 1 && !selectEip6963Provider(preferredRdns); }
export function shouldBindEip6963ProviderEvents(preferredRdns?: string | null): boolean { return !shouldPromptEip6963Provider(preferredRdns); }

/**
 * Wait for a browser wallet that may be injected after the app shell renders.
 * EIP-6963 announcements are the fast path; polling also covers legacy
 * window.ethereum injection, which has no standard assignment event.
 */
export function waitForWalletProvider(
  getProvider: () => Eip6963Provider | undefined,
  target: WalletProviderDiscoveryTarget,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<Eip6963Provider> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_WAIT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_PROVIDER_WAIT_POLL_MS;
  return new Promise<Eip6963Provider>((resolve, reject) => {
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutTimer = setTimeout(() => finish(), timeoutMs);
    let settled = false;

    const cleanup = () => {
      target.removeEventListener('eip6963:announceProvider', onAnnounce);
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (provider?: Eip6963Provider, reason?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (provider) resolve(provider);
      else reject(reason ?? new Error('No browser wallet detected. Install MetaMask, Coinbase Wallet, or another EVM wallet to continue.'));
    };
    const check = () => {
      if (settled) return;
      // An announcement can arrive between polls. Replace the existing
      // timer rather than starting a second polling chain that outlives cleanup.
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      pollTimer = undefined;
      let provider: Eip6963Provider | undefined;
      try {
        provider = getProvider();
      } catch {
        // An injected getter can be transiently unavailable while an
        // extension initializes. Continue until the bounded wait expires.
      }
      if (provider) {
        finish(provider);
        return;
      }
      pollTimer = setTimeout(check, pollMs);
    };
    const onAnnounce = () => check();
    const onAbort = () => finish(undefined, new Error('Wallet provider discovery was cancelled.'));

    target.addEventListener('eip6963:announceProvider', onAnnounce);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    check();
  });
}

export function eip6963FocusTrapDestination(state: { activeInside: boolean; atFirst: boolean; atLast: boolean; shiftKey: boolean }): 'first' | 'last' | null {
  if (state.shiftKey && (state.atFirst || !state.activeInside)) return 'last';
  if (!state.shiftKey && (state.atLast || !state.activeInside)) return 'first';
  return null;
}
export function clearEip6963AnnouncementsForTest(): void { discovered.splice(0, discovered.length); }
