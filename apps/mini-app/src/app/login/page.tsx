'use client';

/** Compatibility entry for old links; normal wallet flows open in place. */
import { Suspense, useEffect, useState, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import { useWalletProviderMode } from '@/lib/wallet/providerMode';
import { Button, FullScreenSpinner } from '@/components/ui';
import { GroupedAddress } from '@/components/GroupedAddress';
import { WalletAvatar } from '@/components/WalletAvatar';
import { usePrivyWallet } from '@/lib/wallet';
import { userSafeError } from '@/lib/errors';
import { haptic, hasTelegramMiniAppLaunchData, openExternalLink } from '@/lib/telegram';
import styles from '@/components/UtilitySurfaces.module.css';

// The Privy SDK is heavy. Loading the flow dynamically keeps it
// out of this page's first-paint bundle — the chunk is only fetched once the
// Telegram provider gate below passes.
const PrivyFlow = dynamic(() => import('./PrivyFlow'), {
  ssr: false,
  loading: () => <FullScreenSpinner asMain />,
});

function LoginContent() {
  const providerMode = useWalletProviderMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · FxAeon';
    setMounted(true);
  }, []);

  if (!mounted) return <FullScreenSpinner asMain />;

  if (providerMode !== 'privy') {
    if (hasTelegramMiniAppLaunchData()) return <TelegramUnavailableFlow />;
    return <BrowserWalletFlow />;
  }

  return <PrivyFlow />;
}

function TelegramUnavailableFlow() {
  const browserUrl = 'https://fxaeon.com/';
  const openBrowser = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(browserUrl)) {
      event.preventDefault();
    }
  };
  return (
    <main className={`${styles.loginPanel} ${styles.authStage} utility-stage mx-auto w-full`}>
      <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
      <h1 className={styles.authTitle}>Connect in your browser</h1>
      <p className={styles.authLead}>
        Wallet sign-in isn’t available here. Open FxAeon in your browser to connect a wallet.
      </p>
      <div className={styles.authActions}>
        <a href={browserUrl} target="_blank" rel="noopener noreferrer" onClick={openBrowser} className="button button-primary glass-press flex min-h-12 w-full items-center justify-center gap-2 px-4 py-3 font-semibold">
          Continue in browser <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
      <Link href="/" className={styles.authBack}><ArrowLeft aria-hidden="true" />Back to Portfolio</Link>
    </main>
  );
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
        : 'Connect MetaMask, Coinbase Wallet, or another EVM wallet. On mobile, open fxaeon.com in your wallet’s browser.'}</p>

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
            <Button onClick={connect} loading={connecting}>Connect browser wallet</Button>
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
