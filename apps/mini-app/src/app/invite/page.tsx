'use client';

import { useEffect, useRef, useState } from 'react';
import FxLogo from '@/components/FxLogo';
import { consumeAccessToken, forgetAccessToken, miniappAccess, accessErrorMessage, telegramReturnUrl } from '@/lib/miniappAccess';
import styles from '@/components/admission/AdmissionScreen.module.css';

export default function InvitePage() {
  const token = useRef('');
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    token.current = consumeAccessToken(); setAvailable(Boolean(token.current));
    if (!token.current) setError('This confirmation link is missing or expired.');
    return () => { generation.current += 1; controller.current?.abort(); };
  }, []);
  const confirm = async () => {
    if (!token.current || busyRef.current || verified) return;
    busyRef.current = true; setBusy(true); setError('');
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    try {
      await miniappAccess('email/confirm', { token: token.current }, { signal: abort.signal });
      if (generation.current !== version || abort.signal.aborted) return;
      token.current = ''; forgetAccessToken(); setVerified(true);
    } catch (cause) { if (generation.current === version) setError(accessErrorMessage(cause)); }
    finally { if (generation.current === version) { busyRef.current = false; setBusy(false); } }
  };
  return <main className={styles.screen} aria-labelledby="invite-title"><div className={styles.panel}>
    <header className={styles.header}><FxLogo size={32} /></header>
    <div className={styles.content}><div className={styles.copy}><div className={styles.message}>
    <h1 id="invite-title" className={styles.title}>{verified ? 'Email confirmed.' : 'Confirm your email.'}</h1>
    <p className={styles.lead}>{verified ? 'We’ll send your invite here once you’re approved.' : 'Confirm this address for your FxAeon invitation.'}</p>
    </div></div><div className={styles.actions} aria-busy={busy}>
    {error && <p role="alert">{error}</p>}
    {available && !verified && <button className={styles.primary} disabled={busy} onClick={() => void confirm()}>{busy ? 'Confirming…' : 'Confirm email'}</button>}
    <a className={verified || !available ? styles.primary : styles.secondary} href={telegramReturnUrl()} referrerPolicy="no-referrer">Return to Telegram</a>
  </div></div></div></main>;
}
