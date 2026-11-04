'use client';

/** Compatibility entry for old links; normal wallet flows open in place. */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import { Button, FullScreenSpinner } from '@/components/ui';
import { GroupedAddress } from '@/components/GroupedAddress';
import { WalletAvatar } from '@/components/WalletAvatar';
import { isWalletConnectCancellation, usePrivyWallet } from '@/lib/wallet';
import { userSafeError } from '@/lib/errors';
import { haptic } from '@/lib/telegram';
import styles from '@/components/UtilitySurfaces.module.css';

function LoginContent() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · FxAeon';
    setMounted(true);
  }, []);

  if (!mounted) return <FullScreenSpinner asMain />;

  return <BrowserWalletFlow />;
}

function BrowserWalletFlow() {
  const wallet = usePrivyWallet();
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setError('');
    setConnecting(true);
    try {
      await wallet.connect();
      haptic('success');
    } catch (cause) {
      if (isWalletConnectCancellation(cause)) return;
      setError(userSafeError(cause, 'Browser wallet connection was cancelled.'));
      haptic('error');
    } finally {
      setConnecting(false);
    }
  };

  const connected = Boolean(wallet.authenticated && wallet.address);
  return (
    <main className={`${styles.loginPanel} ${styles.authStage} utility-stage mx-auto w-full`}>
      <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
      <h1 className={styles.authTitle}>{connected ? 'Wallet connected' : 'Connect your wallet'}</h1>
      <p className={styles.authLead}>{connected
        ? 'Every transaction still needs your approval in this wallet.'
        : 'Choose your wallet to continue. Every transaction needs your approval.'}</p>

      {connected && wallet.address ? (
        <>
          <div className={styles.authAddress}>
            <WalletAvatar address={wallet.address} size={32} />
            <GroupedAddress address={wallet.address} />
          </div>
          <div className={styles.authActions}>
            <Link href="/" onClick={() => haptic('medium')} className="button button-primary glass-press flex min-h-12 w-full items-center justify-center gap-2 px-4 py-3 font-semibold">Continue to FxAeon <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
        </>
      ) : (
        <>
          <div className={styles.authActions}>
            <Button onClick={connect} loading={connecting}>Connect wallet</Button>
          </div>
          {error && <p role="alert" className={styles.authNotice} data-tone="danger">{error}</p>}
        </>
      )}
      <Link href="/" className={styles.authBack}><ArrowLeft aria-hidden="true" />Back to Portfolio</Link>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenSpinner asMain />}>
      <LoginContent />
    </Suspense>
  );
}
