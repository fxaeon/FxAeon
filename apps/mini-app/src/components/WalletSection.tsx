'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Wallet, type LucideIcon } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';
import { useWalletProviderMode } from '@/lib/wallet/providerMode';
import { userSafeError } from '@/lib/errors';
import { Button } from '@/components/ui';
import styles from './WalletSection.module.css';

const PrivyWalletControls = dynamic(() => import('./PrivyWalletSection'), { ssr: false });
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

function BrowserWalletControls() {
  const wallet = usePrivyWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async () => {
    setBusy(true); setError('');
    try { await wallet.connect(); haptic('success'); }
    catch (cause) { setError(userSafeError(cause, 'Browser wallet connection was cancelled.')); haptic('error'); }
    finally { setBusy(false); }
  };

  if (!wallet.ready) return <div className={`${styles.panel} ${styles.loading}`} role="status" aria-live="polite"><span className="sr-only">Loading wallet provider</span></div>;
  return <div className={styles.panel}>
    <ActionRow icon={Wallet} title={wallet.authenticated && wallet.selectedWallet ? 'Browser wallet connected' : 'Connect a browser wallet'}
      detail={wallet.authenticated && wallet.selectedWallet ? 'Reconnect your wallet.' : 'Use a browser extension or open fxaeon.com in your wallet’s mobile browser.'}
      label={wallet.authenticated && wallet.selectedWallet ? 'Reconnect wallet' : 'Connect wallet'}
      onClick={() => void connect()} loading={busy} variant={wallet.authenticated && wallet.selectedWallet ? 'ghost' : 'primary'} />
    {error && <p role="alert" className={styles.errorCopy}>{error}</p>}
  </div>;
}

export default function WalletSection() {
  const providerMode = useWalletProviderMode();
  return providerMode === 'privy' ? <PrivyWalletControls /> : <BrowserWalletControls />;
}
