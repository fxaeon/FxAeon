'use client';

import { useState } from 'react';
import { useEnsAddress, useEnsName } from 'wagmi';
import type { Address } from 'viem';
import { ChevronRight, LogOut, RefreshCw, Wallet } from 'lucide-react';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { WalletAvatar } from '@/components/WalletAvatar';
import { useWalletProfileSession } from '@/components/WalletDemandProvider';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import { compactAddress } from '@/lib/addressPresentation';
import { userSafeError } from '@/lib/errors';
import { haptic } from '@/lib/telegram';
import styles from './AccountControls.module.css';

const ENS_POLICY = { retry: 1, retryDelay: 1000, staleTime: 300_000, gcTime: 1_800_000, refetchOnWindowFocus: false } as const;

/** A reverse record is a display name only after forward verification. */
export function useVerifiedWalletName(address?: string, enabled = true): string | null {
  const reverse = useEnsName({ address: address as Address | undefined, chainId: 1, query: { ...ENS_POLICY, enabled: enabled && Boolean(address) } });
  const forward = useEnsAddress({ name: reverse.data ?? '', chainId: 1, query: { ...ENS_POLICY, enabled: enabled && Boolean(address && reverse.data) } });
  return reverse.data && forward.data?.toLowerCase() === address?.toLowerCase() ? reverse.data : null;
}

export function AccountSummary() {
  const wallet = usePrivyWallet();
  const { setWalletProfileAddress } = useWalletProfileSession();
  const activeAddress = wallet.ready && wallet.authenticated ? wallet.address : undefined;
  const name = useVerifiedWalletName(activeAddress);
  const timedOut = useWalletReadyTimeout(wallet.ready);
  if (!wallet.ready) return timedOut ? <div className={styles.account} role="status">
    <span>Wallet provider is unavailable.</span><button className={styles.iconButton} type="button" aria-label="Retry wallet provider" onClick={() => window.location.reload()}><RefreshCw size={18} aria-hidden="true" /></button>
  </div> : <div className={`${styles.account} ${styles.loading}`} role="status" aria-label="Loading account">
    {/* The connected card's shape: a round avatar beside a name and an address. */}
    <span className={`skeleton ${styles.skeletonAvatar}`} /><span className={styles.copy}><span className={`skeleton ${styles.skeletonName}`} /><span className={`skeleton ${styles.skeletonAddress}`} /></span>
  </div>;
  if (!activeAddress) return <div className={styles.account}>
    <span className={styles.accountIcon}><Wallet size={22} aria-hidden="true" /></span>
    <span className={styles.copy}><strong>{wallet.authenticated ? 'Choose a wallet' : 'No wallet connected'}</strong></span>
    <ConnectWalletButton className={styles.connect}>{wallet.authenticated ? 'Choose' : 'Connect'}</ConnectWalletButton>
  </div>;
  return <button type="button" className={styles.account} aria-label="View connected account" onClick={() => { haptic('light'); setWalletProfileAddress(activeAddress.toLowerCase()); }}>
    {/* The same avatar as the header, so the account reads as one identity. */}
    <span className={`${styles.accountIcon} ${styles.accountAvatar}`}><WalletAvatar address={activeAddress} size={40} /></span>
    <span className={styles.copy}><strong>{name ?? 'Connected wallet'}</strong><small title={activeAddress}>{compactAddress(activeAddress)}</small></span>
    <ChevronRight size={18} aria-hidden="true" />
  </button>;
}

export function SessionControl({ onDisconnected }: { onDisconnected?: () => void }) {
  const wallet = usePrivyWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!wallet.ready || !wallet.authenticated) return null;
  const disconnect = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await wallet.disconnect(); haptic('success'); onDisconnected?.(); }
    catch (cause) { setError(userSafeError(cause, 'Disconnect could not be completed. Try again.')); haptic('error'); }
    finally { setBusy(false); }
  };
  return <div className={styles.session}>
    <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void disconnect()}><LogOut size={18} aria-hidden="true" />{busy ? 'Disconnecting…' : 'Disconnect wallet'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
