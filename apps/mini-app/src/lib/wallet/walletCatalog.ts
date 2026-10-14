import type { DiscoveredEip6963Provider, Eip6963Provider } from './eip6963';
import { walletIdentityRdns } from './walletIdentity';
import { groupWalletProviderClaims, type LegacyWalletProvider } from './walletProviderSnapshot';

/** Display metadata is not connector authority. Announced identities are
 * self-attested; connection always retains the exact selected provider object.
 */
export const WALLET_CATALOG = [
  { id: 'metamask', appUrl: 'https://metamask.io/download', name: 'MetaMask', rdns: 'io.metamask', icon: '/wallets/metamask.svg', primary: true, extensionUrl: 'https://metamask.io/download' },
  // Base Wallet is a display update only. Preserve the existing injected
  // Coinbase Wallet identity; this is not a Base Account/SDK connector.
  { id: 'coinbase', appUrl: 'https://wallet.coinbase.com/download', name: 'Base Wallet', rdns: 'com.coinbase.wallet', icon: '/wallets/base.svg', primary: true, extensionUrl: 'https://www.coinbase.com/wallet/downloads' },
  { id: 'okx', appUrl: 'https://web3.okx.com/download', name: 'OKX', rdns: 'com.okex.wallet', icon: '/wallets/okx.svg', primary: true, extensionUrl: 'https://web3.okx.com/download' },
  { id: 'rabby', appUrl: 'https://rabby.io/', name: 'Rabby', rdns: 'io.rabby', icon: '/wallets/rabby.svg', primary: true, extensionUrl: 'https://rabby.io/' },
  { id: 'trust', appUrl: 'https://trustwallet.com/download', name: 'Trust Wallet', rdns: 'com.trustwallet.app', icon: '/wallets/trust-wallet.svg', primary: false, extensionUrl: 'https://trustwallet.com/browser-extension' },
  { id: 'phantom', appUrl: 'https://phantom.com/download', name: 'Phantom', rdns: 'app.phantom', icon: '/wallets/phantom.svg', primary: false, extensionUrl: 'https://phantom.com/download' },
  { id: 'rainbow', appUrl: 'https://rainbow.me/download', name: 'Rainbow', rdns: 'me.rainbow', icon: '/wallets/rainbow.svg', primary: false, extensionUrl: 'https://rainbow.me/download' },
  { id: 'zerion', appUrl: 'https://zerion.io/download/', name: 'Zerion', rdns: 'io.zerion.wallet', icon: '/wallets/zerion.svg', primary: false, extensionUrl: 'https://zerion.io/extension' },
] as const;

export type WalletBrandId = (typeof WALLET_CATALOG)[number]['id'];

export function getWalletBrand(rdns: string) {
  return WALLET_CATALOG.find((wallet) => wallet.rdns === walletIdentityRdns(rdns));
}

export type WalletChoice = {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly primary: boolean;
  readonly rdns: string | null;
  readonly source: 'catalog' | 'discovered' | 'legacy';
  readonly injected: 'available' | 'ambiguous' | 'none';
  /** Present only when discovery identified one unique provider object. */
  readonly provider?: Eip6963Provider;
};

const legacyIds = new WeakMap<Eip6963Provider, number>();
let nextLegacyId = 1;
function legacyId(provider: Eip6963Provider) {
  let id = legacyIds.get(provider);
  if (!id) { id = nextLegacyId++; legacyIds.set(provider, id); }
  return id;
}

/** No browser reads, provider requests, device detection, or navigation. */
export function buildWalletChoices(
  providers: readonly DiscoveredEip6963Provider[],
  legacyProvider?: Eip6963Provider | readonly LegacyWalletProvider[],
): WalletChoice[] {
  const { byRdns, conflictingProviders, providers: seen } = groupWalletProviderClaims(providers);

  const selection = (group: readonly DiscoveredEip6963Provider[]): Pick<WalletChoice, 'injected' | 'provider'> => {
    if (group.length > 1 || group.some((item) => conflictingProviders.has(item.provider))) return { injected: 'ambiguous' };
    if (group.length === 1) return { injected: 'available', provider: group[0].provider };
    return { injected: 'none' };
  };

  const choices: WalletChoice[] = WALLET_CATALOG.map((wallet) => ({
    id: wallet.id,
    name: wallet.name,
    icon: wallet.icon,
    primary: wallet.primary,
    rdns: wallet.rdns,
    source: 'catalog',
    ...selection(byRdns.get(wallet.rdns) ?? []),
  }));

  // Names are untrusted display text, never identity. Keep every accessible
  // label distinct without lending a catalog brand to an unknown provider.
  const nameKey = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const catalogNames = new Set([
    ...WALLET_CATALOG.map((wallet) => nameKey(wallet.name)),
    // Reserve current and compatibility brand labels without treating any
    // self-attested name as a provider identity or adding an rdns alias.
    ...['Base', 'Base App', 'Coinbase', 'Coinbase Wallet', 'OKX Wallet'].map(nameKey),
    'wallet', 'browser wallet',
  ]);
  const unknownGroups = [...byRdns].filter(([rdns]) => !getWalletBrand(rdns));
  const nameCounts = new Map<string, number>();
  for (const [, group] of unknownGroups) {
    const key = nameKey(group[0].name) || 'wallet';
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  // Reserve literal names first so a generated suffix cannot impersonate a
  // different announced wallet whose actual label already includes a number.
  const reservedNames = new Set([...catalogNames, ...nameCounts.keys()]);
  const nextSuffix = new Map<string, number>();
  for (const [rdns, group] of unknownGroups) {
    let name = group[0].name.trim() || 'Wallet';
    const key = nameKey(name);
    if (catalogNames.has(key) || (nameCounts.get(key) ?? 0) > 1) {
      const base = catalogNames.has(key) ? 'Wallet' : name;
      const baseKey = nameKey(base);
      let suffix = nextSuffix.get(baseKey) ?? 1;
      do { name = `${base} ${suffix++}`; } while (reservedNames.has(nameKey(name)));
      nextSuffix.set(baseKey, suffix);
      reservedNames.add(nameKey(name));
    }
    choices.push({
      id: `injected:${rdns}`,
      name,
      primary: false,
      rdns,
      source: 'discovered',
      ...selection(group),
    });
  }

  // An unannounced global provider has no trustworthy brand. It may be offered
  // only as its own neutral, exact-object selection, never as a named fallback.
  const legacyCollection: readonly LegacyWalletProvider[] = Array.isArray(legacyProvider)
    ? legacyProvider : legacyProvider ? [{ provider: legacyProvider as Eip6963Provider }] : [];
  const legacySeen = new Set(seen);
  const availableLegacy = legacyCollection.filter(item => {
    try {
      if (!item.provider || typeof item.provider.request !== 'function' || legacySeen.has(item.provider)) return false;
      legacySeen.add(item.provider); return true;
    } catch { return false; }
  });
  for (const item of availableLegacy) {
    const provider = item.provider;
    let name = item.name || (availableLegacy.length === 1 ? 'Wallet' : `Wallet ${legacyId(provider)}`);
    let suffix = legacyId(provider);
    while (choices.some(choice => nameKey(choice.name) === nameKey(name))) name = `${item.name || 'Wallet'} ${suffix++}`;
    choices.push({
      id: Array.isArray(legacyProvider) ? `legacy:provider:${legacyId(provider)}` : 'legacy:browser',
      name,
      primary: false,
      rdns: null,
      source: 'legacy',
      injected: 'available',
      provider,
    });
  }
  return choices;
}
