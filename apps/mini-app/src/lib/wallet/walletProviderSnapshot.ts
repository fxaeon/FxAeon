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

/** Fresh read only: does not persist a namespace object, request accounts, or
 * override an announcement. Conflicting claims remain visible to the resolver.
 */
export function readWalletProviderSnapshot(
  announced: readonly DiscoveredEip6963Provider[],
  host: unknown,
): DiscoveredEip6963Provider[] {
  const result = [...announced];
  for (const { path, rdns, name } of NAMESPACES) {
    const provider = namespaceProvider(host, path);
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
