import type { DiscoveredEip6963Provider, Eip6963Provider } from './eip6963';
import { walletIdentityRdns } from './walletIdentity';

/** Vendor-documented namespaces are capabilities, not proof of wallet identity.
 * No flags or generic window.ethereum fallback may brand a provider.
 * Coinbase: coinbase-wallet-sdk@810301838030c632ef1bf85a249a006f4886e8bf/packages/wallet-sdk/src/util/provider.ts
 * OKX: https://web3.okx.com/onchainos/dev-docs/wallet/dapp-connect/web-detect-okx-wallet
 * Phantom: https://docs.phantom.com/ethereum-monad-testnet-base-and-polygon/detecting-the-provider
 * Trust: https://developer.trustwallet.com/developer/listing-guide/mobile-optimize
 */
const NAMESPACES = [
  { path: ['coinbaseWalletExtension'], rdns: 'com.coinbase.wallet', name: 'Base Wallet' },
  { path: ['okxwallet'], rdns: 'com.okex.wallet', name: 'OKX' },
  { path: ['phantom', 'ethereum'], rdns: 'app.phantom', name: 'Phantom' },
  { path: ['trustwallet', 'ethereum'], rdns: 'com.trustwallet.app', name: 'Trust Wallet' },
] as const;

export type LegacyWalletProvider = { readonly provider: Eip6963Provider; readonly name?: string; readonly secondary?: boolean };
// Reviewed capability paths, with names used only for display. The canonical
// rdns suppresses a compatibility wrapper when that wallet already announced;
// it is never assigned to a legacy provider or used to authorize one.
// https://github.com/rainbow-me/rainbowkit/tree/main/packages/rainbowkit/src/wallets/walletConnectors
// https://developer.onekey.so/en/connect-to-software/provider/eth/
// https://web3.bitget.com/en/docs/resource/faq
// https://docs.coin98.com/developer-guide/dapps-integration/evm-compatible-dapps-integration
const LEGACY_NAMESPACES = [
  { path: ['bitkeep', 'ethereum'], name: 'Bitget Wallet', rdns: 'com.bitget.web3' },
  { path: ['coin98', 'provider'], name: 'Coin98 Wallet', rdns: 'com.coin98' },
  { path: ['$onekey', 'ethereum'], name: 'OneKey', rdns: 'so.onekey.app.wallet' },
  { path: ['talismanEth'], name: 'Talisman', rdns: 'xyz.talisman' },
  // @keplr-wallet/provider@0.13.41 exposes the EVM provider at keplr.ethereum.
  { path: ['keplr', 'ethereum'], name: 'Keplr', rdns: 'app.keplr' },
  { path: ['backpack', 'ethereum'], name: 'Backpack', rdns: 'app.backpack.mobile' },
  { path: ['safepalProvider'], name: 'SafePal', rdns: null },
] as const;

function namespaceProvider(host: unknown, path: readonly string[]): Eip6963Provider | undefined {
  try {
    let value = host;
    for (const key of path) {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    if (value && (typeof value === 'object' || typeof value === 'function')
      && typeof (value as Eip6963Provider).request === 'function') return value as Eip6963Provider;
  } catch { /* Untrusted extension getters may throw while starting or unloading. */ }
  return undefined;
}

/** Read compatibility providers without requests, identity flags or invented
 * rdns. An aggregate window.ethereum is not an additional wallet when its
 * providers array supplies valid objects. Announced objects take precedence. */
export function readLegacyWalletProviderSnapshot(
  announced: readonly DiscoveredEip6963Provider[], host: unknown,
): LegacyWalletProvider[] {
  const result: LegacyWalletProvider[] = [];
  const seen = new Set(announced.map(item => item.provider));
  const add = (provider: Eip6963Provider | undefined, name?: string) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider); result.push({ provider, ...(name ? { name } : {}) });
  };
  for (const entry of LEGACY_NAMESPACES) {
    const { path, name, rdns } = entry;
    const provider = namespaceProvider(host, path);
    if (rdns && announced.some(item => walletIdentityRdns(item.rdns) === rdns)) {
      if (provider) seen.add(provider);
      continue;
    }
    add(provider, name);
  }
  let arrayHasProvider = false;
  try {
    const values = (host as { ethereum?: { providers?: unknown } })?.ethereum?.providers;
    if (Array.isArray(values)) for (let index = 0; index < values.length; index++) {
      try {
        const provider = namespaceProvider({ value: values[index] }, ['value']);
        if (provider) { arrayHasProvider = true; add(provider); }
      } catch { /* An inaccessible array entry must not hide later wallets. */ }
    }
  } catch { /* A getter on one compatibility surface must not hide the rest. */ }
  // Preserve a distinct standalone provider: it may be a real legacy wallet.
  // Once explicit discovery succeeds, keep this unbranded compatibility route
  // in Other wallets instead of promoting it as another detected primary row.
  if (!arrayHasProvider) {
    const provider = namespaceProvider(host, ['ethereum']);
    const secondary = announced.length > 0 || result.length > 0;
    if (provider && !seen.has(provider)) {
      add(provider);
      if (secondary) result[result.length - 1] = { provider, secondary: true };
    }
  }
  return result;
}

/** Fresh read only: does not persist a namespace object or request accounts.
 * Announcements take precedence over compatibility namespace wrappers. A
 * namespace supplies discovery only when that wallet has not announced itself.
 * Distinct announcements and conflicting brands remain visible to the resolver.
 */
export function readWalletProviderSnapshot(
  announced: readonly DiscoveredEip6963Provider[],
  host: unknown,
): DiscoveredEip6963Provider[] {
  const result = [...announced];
  for (const { path, rdns, name } of NAMESPACES) {
    // A wallet can expose a different compatibility wrapper at its namespace.
    // This is not a second EIP-6963 identity claim. Retain the exact announced
    // object instead of manufacturing an ambiguous duplicate from the fallback.
    const provider = namespaceProvider(host, path);
    const conflictsWithAnnouncedBrand = provider && announced.some((item) => item.provider === provider && walletIdentityRdns(item.rdns) !== rdns);
    if (announced.some((item) => walletIdentityRdns(item.rdns) === rdns) && !conflictsWithAnnouncedBrand) continue;
    if (provider && !result.some((item) => item.provider === provider && walletIdentityRdns(item.rdns) === rdns)) {
      result.push({ provider, rdns, name });
    }
  }
  return result;
}

/** Collect every claim before deduplication. Selecting the first claim would
 * hide a namespace/announcement conflict and lend another wallet's branding.
 */
export function groupWalletProviderClaims(providers: readonly DiscoveredEip6963Provider[]) {
  const byRdns = new Map<string, DiscoveredEip6963Provider[]>();
  const identitiesByProvider = new Map<Eip6963Provider, Set<string>>();
  for (const item of providers) {
    const rdns = walletIdentityRdns(item.rdns);
    const identities = identitiesByProvider.get(item.provider) ?? new Set<string>();
    identities.add(rdns);
    identitiesByProvider.set(item.provider, identities);
    const group = byRdns.get(rdns) ?? [];
    if (!group.some((existing) => existing.provider === item.provider)) group.push(item);
    byRdns.set(rdns, group);
  }
  const conflictingProviders = new Set([...identitiesByProvider]
    .filter(([, identities]) => identities.size > 1).map(([provider]) => provider));
  return { byRdns, conflictingProviders, providers: new Set(identitiesByProvider.keys()) };
}
