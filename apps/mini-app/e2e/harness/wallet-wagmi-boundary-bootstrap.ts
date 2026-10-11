import {
  BROWSER_ADDRESS, DECOY_ADDRESS, EMBEDDED_ADDRESS, EMBEDDED_BALANCE,
  type BoundaryMode, type BoundaryProvider, type WagmiBoundaryState,
} from './wallet-wagmi-boundary-state';

// Runs as a classic script before importing any real wallet or Telegram module.
const requested = new URLSearchParams(location.search).get('mode');
const mode: BoundaryMode = requested === 'telegram' || requested === 'late-host' || requested === 'bridge-wait' ? requested : 'web';
const h: WagmiBoundaryState = globalThis.__wagmiBoundaryHarness = {
  mode, discoveryRequests: 0, configCreates: 0, connectorCreates: 0, wagmiConnections: [],
  privyModuleLoads: 0, privyMounts: 0, privyUnmounts: 0, privyHookCalls: 0,
  routeMounts: 0, routeUnmounts: 0, childMounts: 0, childUnmounts: 0,
  browserCalls: [], decoyCalls: [], embeddedCalls: [], forbiddenCalls: [], errors: [],
  embeddedProvider: undefined as unknown as BoundaryProvider,
  installTelegram() {
    // Launch-shaped data selects UX only; the mocked SDK supplies the session.
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: {
      platform: 'android', initData: 'auth_date=1&hash=synthetic-boundary-only',
    } };
    history.replaceState(history.state, '', `${location.pathname}${location.search}#tgWebAppData=auth_date%3D1%26hash%3Dsynthetic-boundary-only`);
  },
  announceBrowser: () => undefined,
  snapshot() {
    const { embeddedProvider: _provider, installTelegram: _install, announceBrowser: _announce, navigate: _navigate, snapshot: _snapshot, ...state } = h;
    return JSON.parse(JSON.stringify(state));
  },
};

function provider(address: string, kind: 'browser' | 'decoy' | 'embedded'): BoundaryProvider {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    async request(request) {
      h[`${kind}Calls`].push(request);
      if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts') return [address];
      if (request.method === 'eth_chainId') return '0x1';
      if (kind === 'embedded' && request.method === 'eth_getBalance') {
        if (request.params?.[0] !== EMBEDDED_ADDRESS) throw new Error('Synthetic balance requested for the wrong account');
        return `0x${BigInt(EMBEDDED_BALANCE).toString(16)}`;
      }
      h.forbiddenCalls.push(`${kind}:${request.method}`);
      throw new Error(`Unsupported synthetic provider method: ${request.method}`);
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
  };
}

h.embeddedProvider = provider(EMBEDDED_ADDRESS, 'embedded');
const exactBrowser = provider(BROWSER_ADDRESS, 'browser');
// The default global deliberately differs from the selected EIP-6963 object.
window.ethereum = provider(DECOY_ADDRESS, 'decoy');
h.announceBrowser = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
  detail: { info: { name: 'Rabby', rdns: 'io.rabby', uuid: '00000000-0000-4000-8000-000000000001', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }, provider: exactBrowser },
}));
window.addEventListener('eip6963:requestProvider', () => { h.discoveryRequests += 1; h.announceBrowser(); });

// Start each document with no browser restore hint, including reload checks.
// This fixture verifies provider ownership, not persistence of a real SDK login.
for (const key of ['fxaeon:wallet-provider-rdns', 'fxaeon:browser-wallet-address', 'fxaeon:browser-wallet-disconnected']) localStorage.removeItem(key);
if (mode === 'telegram') h.installTelegram();
else if (mode === 'bridge-wait') (window as unknown as { TelegramWebviewProxy: unknown }).TelegramWebviewProxy = { postEvent() {} };
else (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { platform: 'unknown', initData: '' } };

// Safety for manual QA: only the injected fake Rabby can be selected. Other
// catalog choices retain their real markup but must never open a live site.
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-wallet-id]') : null;
  if (target && target.getAttribute('data-wallet-id') !== 'rabby') {
    event.preventDefault(); event.stopImmediatePropagation();
    h.errors.push('QA safety: only the synthetic Rabby selection is enabled.');
  }
}, true);
