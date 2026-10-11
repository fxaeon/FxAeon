'use client';

/**
 * Client-only authentication and wallet setup.
 *
 * This flow intentionally has no FxAeon API calls. Privy owns identity and
 * wallet custody; the only wallet mutations available here are an explicit
 * embedded-wallet creation or a user-approved external-wallet connection.
 * There is no raw private-key field and no delegated/session signer step.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Lock, Mail, Plus, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useCreateWallet,
} from '@privy-io/react-auth';
import { haptic } from '@/lib/telegram';
import { AddressChip, Button, FullScreenSpinner } from '@/components/ui';
import FxLogo from '@/components/FxLogo';
import { WalletAvatar } from '@/components/WalletAvatar';
import { isWalletConnectCancellation, usePrivyWallet } from '@/lib/wallet';
import { useT } from '@/lib/i18n';
import { userSafeError } from '@/lib/errors';
import styles from '@/components/UtilitySurfaces.module.css';

type Phase = 'intro' | 'authenticating' | 'choose' | 'creating' | 'done' | 'error';

function errorMessage(error: unknown, fallback: string): string {
  return userSafeError(error, fallback);
}

function PrivyLoginFlow() {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated, address: walletAddress, selectionRequired, connect } = usePrivyWallet();
  const { createWallet } = useCreateWallet();
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const phaseHeadingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    phaseHeadingRef.current?.focus({ preventScroll: true });
  }, [phase]);

  // A persisted Privy session should never force a second login. Let the user
  // choose a wallet only when the authenticated account has no wallet yet.
  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      if (phase === 'done' || phase === 'choose') setPhase('intro');
      return;
    }
    if (phase === 'intro' || phase === 'authenticating' || (phase === 'choose' && walletAddress)) {
      setPhase(walletAddress ? 'done' : 'choose');
    }
  }, [ready, authenticated, phase, walletAddress]);

  const fail = useCallback((cause: unknown, fallback: string) => {
    if (!mountedRef.current) return;
    haptic('error');
    setError(errorMessage(cause, fallback));
    setPhase('error');
  }, []);

  const startEmailLogin = useCallback(async () => {
    setError('');
    setPhase('authenticating');
    try { await connect({ loginMethod: 'email' }); }
    catch (cause) {
      if (!mountedRef.current) return;
      if (isWalletConnectCancellation(cause)) { setPhase('intro'); return; }
      fail(cause, 'Sign-in was not completed.');
    }
  }, [connect, fail]);

  const startExternalWallet = useCallback(async () => {
    setError('');
    setPhase('authenticating');
    try {
      // The shared adapter is the Telegram-aware path. Inside Telegram it
      // restarts seamless sign-in (or asks to reopen FxAeon from Telegram)
      // and never opens Privy's generic login. In a browser it shows every
      // sign-in method enabled for the app, or the wallet selector once
      // signed in. The readiness effect advances the phase when Privy
      // publishes the session and wallet.
      await connect(authenticated ? { external: true } : undefined);
    } catch (cause) {
      if (!mountedRef.current) return;
      if (isWalletConnectCancellation(cause)) {
        setPhase(authenticated ? 'choose' : 'intro');
        return;
      }
      fail(cause, 'Sign-in was not completed.');
    }
  }, [authenticated, connect, fail]);

  const handleCreate = useCallback(async () => {
    if (!authenticated) {
      setPhase('intro');
      setError('Sign in before creating your wallet.');
      return;
    }
    setError('');
    setPhase('creating');
    try {
      await createWallet();
      haptic('success');
      if (mountedRef.current) setPhase('choose');
    } catch (cause) {
      fail(cause, 'Wallet creation was cancelled or failed. No transaction was submitted.');
    }
  }, [authenticated, createWallet, fail]);

  if (!ready) return <FullScreenSpinner asMain />;

  if (authenticated && walletAddress) {
    return (
      <main className={`${styles.loginPanel} ${styles.authStage} mx-auto w-full`}>
        <AuthCheck />
        <h1 ref={phaseHeadingRef} tabIndex={-1} className={styles.authTitle}>
          Wallet ready
        </h1>
        {walletAddress && (
          <div className={styles.authIdentity}>
            <WalletAvatar address={walletAddress} size={28} />
            <AddressChip address={walletAddress} />
          </div>
        )}
        <p className={styles.authNote}>
          <strong>You stay in control.</strong>{' '}
          Every transaction still requires your wallet approval. FxAeon never receives your private key.
        </p>
        <div className={styles.authActions}>
          <Button onClick={() => router.push('/')}>
            Continue
          </Button>
        </div>
      </main>
    );
  }

  if (authenticated && (phase === 'choose' || phase === 'creating' || selectionRequired)) {
    const creating = phase === 'creating';
    return (
      <main className={`${styles.loginPanel} ${styles.authStage} mx-auto w-full`}>
        <h1 ref={phaseHeadingRef} tabIndex={-1} className={styles.authTitle}>
          Choose your wallet
        </h1>
        <p className={styles.authLead}>
          Create a wallet for this account or connect one you already use. Nothing is created or connected automatically.
        </p>
        <div className={styles.authOptions}>
          {selectionRequired && <Link href="/settings" className={styles.authOption} aria-label="Choose wallet">
            <span className={styles.authOptionIcon} aria-hidden="true"><Wallet /></span>
            <span className={styles.authOptionText}><strong>Choose an available wallet</strong><small>Select the wallet you want to use in Settings.</small></span>
            <ChevronRight aria-hidden="true" />
          </Link>}
          <button type="button" className={styles.authOption} onClick={handleCreate} disabled={creating} aria-busy={creating || undefined}>
            <span className={styles.authOptionIcon} aria-hidden="true"><Plus /></span>
            <span className={styles.authOptionText}>
              <strong>{creating ? 'Creating wallet…' : 'Create a new wallet'}</strong>
              <small>Create a wallet secured by Privy for this account.</small>
            </span>
            {creating ? <span className={styles.authSpinner} aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
          <button type="button" className={styles.authOption} onClick={() => void startExternalWallet()}>
            <span className={styles.authOptionIcon} aria-hidden="true"><Wallet /></span>
            <span className={styles.authOptionText}>
              <strong>Connect an existing wallet</strong>
              <small>Add an external wallet, then choose it in Settings.</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        {error && <p role="alert" className={styles.authNotice}>{error}</p>}
        {/* Wallet creation has no timeout, so the ways out stay available while it runs. */}
        <button type="button" className={styles.authBack} onClick={() => setPhase('intro')}>Back</button>
      </main>
    );
  }

  const busy = phase === 'authenticating';
  return (
    <main className={`${styles.loginPanel} ${styles.authStage} mx-auto w-full`}>
      <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
      <h1 ref={phaseHeadingRef} tabIndex={-1} className={styles.authTitle}>
        {t('loginCard.signIn')}
      </h1>
      <p className={styles.authLead}>
        Continue with a wallet or email.
      </p>
      <div className={styles.authActions}>
        <Button variant="primary" onClick={() => void startExternalWallet()} disabled={busy}>
          <Wallet aria-hidden="true" />
          {t('loginCard.wallet')}
        </Button>
        <Button variant="ghost" onClick={() => void startEmailLogin()} disabled={busy}>
          <Mail aria-hidden="true" />
          {t('loginCard.email')}
        </Button>
      </div>
      {phase === 'error' && (
        <div className={styles.authNotice}>
          <p role="alert">{error}</p>
          <button type="button" className={styles.authRetry} onClick={() => { setError(''); setPhase('intro'); }}>
            Try again
          </button>
        </div>
      )}
      <p className={styles.authFinePrint}>
        {t('loginCard.terms')}
      </p>
      <span className={styles.authBadge}>
        <Lock aria-hidden="true" />
        {t('loginCard.poweredBy')} <strong>privy</strong>
      </span>
    </main>
  );
}

/** A check drawn once when the wallet is ready; reduced motion shows it whole. */
function AuthCheck() {
  return (
    <svg className={styles.authCheck} viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r="34" />
      <path d="M23 37.5 32 46.5 50 27.5" />
    </svg>
  );
}

/** The provider is mounted by the authenticated app shell. */
export default function PrivyFlow() {
  return <PrivyLoginFlow />;
}
