import { Component, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, useCreateWallet, useExportWallet, useModalStatus, usePrivy, useSendTransaction, useWallets } from '@privy-io/react-auth';
import type { PrivyClientConfig } from '@privy-io/react-auth';
import { base, mainnet } from 'viem/chains';
import type { PrivyDriver, PrivyWalletController } from './privy.ts';

export interface PrivyMountOptions { appId: string; clientId?: string; theme?: 'dark' | 'light' }

class Boundary extends Component<{ adapter: PrivyWalletController; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.adapter.unavailable(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function Bridge({ adapter, onTheme }: { adapter: PrivyWalletController; onTheme(theme: 'dark' | 'light'): void }) {
  const auth = usePrivy();
  const wallets = useWallets();
  const modal = useModalStatus();
  const transaction = useSendTransaction();
  const exporter = useExportWallet();
  const creator = useCreateWallet();
  const live = useRef({ auth, transaction, exporter, creator, onTheme });
  live.current = { auth, transaction, exporter, creator, onTheme };
  const driver = useMemo<PrivyDriver>(() => ({
    login: () => live.current.auth.login({ loginMethods: ['telegram'] }),
    connectWallet: () => live.current.auth.connectWallet({ walletList: ['detected_ethereum_wallets'] }),
    logout: () => live.current.auth.logout(),
    createWallet: () => live.current.creator.createWallet(),
    exportWallet: address => live.current.exporter.exportWallet({ address }),
    sendTransaction: (call, address) => live.current.transaction.sendTransaction({
      from: call.from, to: call.to, data: call.data, value: call.value, nonce: call.nonce, chainId: call.chainId,
    }, { address, sponsor: false, uiOptions: { showWalletUIs: true, isCancellable: true, description: 'Review and confirm this FxAeon transaction', buttonText: 'Confirm transaction' } }),
    setTheme: theme => live.current.onTheme(theme),
  }), []);
  useLayoutEffect(() => { adapter.attach(driver); return () => adapter.detach(driver); }, [adapter, driver]);
  useLayoutEffect(() => {
    adapter.update({ ready: auth.ready, authenticated: auth.authenticated, userId: auth.user?.id ?? null, walletsReady: wallets.ready, wallets: wallets.wallets, modalOpen: modal.isOpen });
  });
  return null;
}

function Provider({ adapter, options }: { adapter: PrivyWalletController; options: PrivyMountOptions }) {
  const [theme, setTheme] = useState(options.theme ?? 'dark');
  const config = useMemo<PrivyClientConfig>(() => ({
    loginMethods: ['telegram'],
    supportedChains: [mainnet, base],
    defaultChain: mainnet,
    appearance: { theme: theme === 'dark' ? '#0b0d0e' : '#fbfcfa', accentColor: theme === 'dark' ? '#c1e8aa' : '#315c25', walletChainType: 'ethereum-only', walletList: ['detected_ethereum_wallets'] },
    embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: true },
    externalWallets: { walletConnect: { enabled: false } },
  }), [theme]);
  return <PrivyProvider appId={options.appId} clientId={options.clientId} config={config}>
    <Bridge adapter={adapter} onTheme={setTheme} />
  </PrivyProvider>;
}

/** Imported only by the Telegram path after a real public app ID is supplied. */
export function mountPrivyWallet(adapter: PrivyWalletController, options: PrivyMountOptions): () => void {
  const container = document.createElement('div');
  container.dataset.fxaeonAuth = 'telegram';
  document.body.append(container);
  const root = createRoot(container);
  root.render(<Boundary adapter={adapter}><Provider adapter={adapter} options={options} /></Boundary>);
  return () => { root.unmount(); container.remove(); };
}
