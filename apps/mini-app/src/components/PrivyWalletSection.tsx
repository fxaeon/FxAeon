'use client';

/** Compact Settings controls for user-managed Privy and browser wallets. */
import { useCallback, useMemo, useState } from 'react';
import { ChevronRight, KeyRound, Plus, RefreshCw, Wallet, type LucideIcon } from 'lucide-react';
import { useCreateWallet, useExportWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import { haptic } from '@/lib/telegram';
import { isWalletConnectCancellation, usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';

import { userSafeError } from '@/lib/errors';
import { Button } from '@/components/ui';
import { compactAddress } from '@/lib/addressPresentation';
import styles from './WalletSection.module.css';

function ActionRow({ icon: Icon, title, detail, label, onClick, loading = false, disabled = false, variant = 'ghost' }: {
  icon: LucideIcon;
  title: string;
  detail: string;
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
}) {
  return <div className={styles.actionRow}>
    <span className={styles.icon}><Icon size={18} aria-hidden="true" /></span>
    <span className={styles.copy}><strong>{title}</strong><small>{detail}</small></span>
    <Button variant={variant} aria-label={label} className={styles.actionButton} onClick={onClick} loading={loading} disabled={disabled}>{loading ? 'Working' : label.replace(/^(Create|Connect|Export) (?:Privy |external )?wallet$/i, '$1')}</Button>
  </div>;
}

export default function PrivyWalletControls() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { selectedWallet, selectWallet, connect } = usePrivyWallet();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const [busy, setBusy] = useState<'none' | 'create' | 'connect' | 'export'>('none');
  const [error, setError] = useState('');
  const readyTimedOut = useWalletReadyTimeout(ready);

  const embedded = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2'),
    [wallets],
  );
  const externalWallets = useMemo(
    () => wallets.filter((wallet) => wallet.type === 'ethereum' && wallet.walletClientType !== 'privy' && wallet.walletClientType !== 'privy-v2'),
    [wallets],
  );
  const otherWallets = useMemo(
    () => wallets.filter((wallet) => wallet.type === 'ethereum' && wallet.address.toLowerCase() !== selectedWallet?.address.toLowerCase()),
    [selectedWallet?.address, wallets],
  );

  const handleConnect = useCallback(async (external = false) => {
    setBusy('connect'); setError('');
    try { await connect({ external }); haptic('success'); }
    catch (cause) {
      // Closing the wallet prompt is a choice, not a failure.
      if (isWalletConnectCancellation(cause)) return;
      setError(userSafeError(cause, 'Wallet connection was cancelled.')); haptic('error');
    }
    finally { setBusy('none'); }
  }, [connect]);

  const handleCreate = useCallback(async () => {
    if (!authenticated) { await handleConnect(); return; }
    setBusy('create'); setError('');
    try { await createWallet(); haptic('success'); }
    catch (cause) { setError(userSafeError(cause, 'Wallet creation was cancelled.')); haptic('error'); }
    finally { setBusy('none'); }
  }, [authenticated, createWallet, handleConnect]);

  const handleExport = useCallback(async () => {
    if (!embedded?.address) return;
    setBusy('export'); setError('');
    try { await exportWallet({ address: embedded.address }); }
    catch (cause) {
      if (cause instanceof Error && !/cancel|exit|closed/i.test(cause.message)) setError(userSafeError(cause, 'Wallet export could not be completed.'));
    } finally { setBusy('none'); }
  }, [embedded?.address, exportWallet]);

  if (!ready) {
    if (readyTimedOut) return <div className={styles.panel} role="alert" aria-live="polite">
      <p className={styles.errorCopy}>Wallet services are unavailable. Retry to reconnect.</p>
      <Button aria-label="Retry wallet provider" onClick={() => window.location.reload()} className={styles.retry}><RefreshCw size={16} aria-hidden="true" />Retry wallet</Button>
    </div>;
    return <div className={`${styles.panel} ${styles.loading}`} role="status" aria-live="polite"><span className="sr-only">Loading wallet provider</span></div>;
  }

  if (!authenticated) return <div className={styles.panel}>
    <div className={styles.actionRow}>
      <span className={styles.icon}><Wallet size={18} aria-hidden="true" /></span>
      <span className={styles.copy}><strong>No wallet connected</strong><small>Connect to FxAeon.</small></span>
      <Button aria-label="Connect wallet" className={styles.actionButton} onClick={() => void handleConnect()} loading={busy === 'connect'}>Connect</Button>
    </div>
    {error && <p role="alert" className={styles.errorCopy}>{error}</p>}
  </div>;

  return <div className={styles.panel}>
    {otherWallets.length > 0 && <section className={styles.walletChoices} aria-labelledby="settings-other-wallets">
      <h3 id="settings-other-wallets">Switch wallet</h3>
      {otherWallets.map((wallet) => <button key={wallet.address} type="button" className={styles.walletChoice}
        aria-label={`Switch to ${wallet.walletClientType ?? 'Ethereum wallet'} ${wallet.address}`}
        disabled={busy !== 'none'} onClick={() => selectWallet(wallet.address)}>
        <span><strong>{wallet.walletClientType ?? 'Ethereum wallet'}</strong><small>{compactAddress(wallet.address)}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>)}
    </section>}
    <div className={styles.actions} role="group" aria-label="Wallet actions">
      {!embedded && <ActionRow icon={Plus} title="Create wallet" detail="Add an FxAeon wallet." label="Create wallet" variant="primary" onClick={() => void handleCreate()} loading={busy === 'create'} disabled={busy !== 'none'} />}
      <ActionRow icon={Wallet} title="Connect another wallet" detail="Use an external EVM wallet." label="Connect external wallet" onClick={() => void handleConnect(true)} loading={busy === 'connect'} disabled={busy !== 'none'} />
      {embedded && <ActionRow icon={KeyRound} title="Export wallet" detail="Open secure export." label="Export wallet" onClick={() => void handleExport()} loading={busy === 'export'} disabled={busy !== 'none'} />}
    </div>
    {error && <p role="alert" className={styles.errorCopy}>{error}</p>}
    {externalWallets.length > 0 && <p className={styles.statusCopy}>{externalWallets.length} external Ethereum wallet{externalWallets.length === 1 ? '' : 's'} connected.</p>}
  </div>;
}
