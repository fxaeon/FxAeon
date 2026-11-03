'use client';

import { useEffect, useRef, useState } from 'react';
import { startRegistration, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import FxLogo from '@/components/FxLogo';
import { WalletApprovalDetails } from '@/components/admission/WalletApprovalDetails';
import { miniappAccess, consumeApprovalTicket, forgetAccessToken, verifyChallengeCommitment, telegramReturnUrl, accessErrorMessage, isSignResult, isWalletResult,
  verifySigningChallenge, validateApprovalTransaction, type HandoffRead, type MiniappTransaction } from '@/lib/miniappAccess';
import styles from './WalletApproval.module.css';

export default function WalletApprovalPage() {
  const token = useRef('');
  const verifiedChallenge = useRef('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const submitted = useRef(false);
  const [request, setRequest] = useState<HandoffRead>();
  const [transaction, setTransaction] = useState<MiniappTransaction>();
  const [walletId, setWalletId] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const ticket = consumeApprovalTicket();
    token.current = ticket.token;
    const version = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    if (!token.current || !/^[A-Za-z0-9_-]{43}$/.test(ticket.commitment)) { setError('This approval link is missing or expired. Return to Telegram.'); setBusy(false); return; }
    void miniappAccess('handoff/read', { token: token.current }, { signal: abort.signal }).then(async value => {
      if (generation.current !== version || abort.signal.aborted) return;
      await verifyChallengeCommitment(value.options.challenge, ticket.commitment);
      if (generation.current !== version || abort.signal.aborted) return;
      verifiedChallenge.current = value.options.challenge;
      if (value.kind === 'sign') {
        const tx = validateApprovalTransaction(value.transaction);
        const verified = verifySigningChallenge(value.options.challenge, tx);
        setTransaction(verified.transaction); setWalletId(verified.walletId);
      }
      setRequest(value);
    }).catch(cause => { if (generation.current === version && !abort.signal.aborted) setError(accessErrorMessage(cause)); })
      .finally(() => { if (generation.current === version && !abort.signal.aborted) setBusy(false); });
    return () => { generation.current += 1; abort.abort(); controller.current?.abort(); WebAuthnAbortService.cancelCeremony(); };
  }, []);

  const approve = async () => {
    if (!request || !token.current || inFlight.current || submitted.current || closed) return;
    inFlight.current = true; setBusy(true); setError('');
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    const assertCurrent = () => { if (generation.current !== version || abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
    try {
      if (request.options.challenge !== verifiedChallenge.current) throw new Error('Approval challenge changed.');
      if (request.kind === 'sign') {
        if (!transaction) throw new Error('Missing transaction.');
        verifySigningChallenge(request.options.challenge, transaction, walletId);
      }
      // Neither reading a ticket nor loading this page invokes a credential API.
      const response = request.kind === 'register'
        ? await startRegistration({ optionsJSON: request.options })
        : await startAuthentication({ optionsJSON: request.options });
      assertCurrent();
      if (request.kind === 'sign') verifySigningChallenge(request.options.challenge, transaction!, walletId);
      submitted.current = true;
      const result = await miniappAccess('handoff/complete', { token: token.current, response }, { signal: abort.signal });
      assertCurrent();
      if (request.kind === 'sign' ? !isSignResult(result) : !isWalletResult(result)) throw new Error('Unexpected approval result.');
      token.current = ''; forgetAccessToken(); setDone(true);
    } catch (cause) {
      if (generation.current === version) setError(submitted.current
        ? 'The result could not be confirmed. Return to Telegram and check before trying again.' : accessErrorMessage(cause));
    } finally {
      if (generation.current === version) { inFlight.current = false; setBusy(false); }
    }
  };
  const cancel = () => {
    generation.current += 1; controller.current?.abort(); WebAuthnAbortService.cancelCeremony();
    token.current = ''; forgetAccessToken(); setClosed(true); setBusy(false);
    setError(submitted.current ? 'Approval may already have completed. Return to Telegram and check your wallet activity.' : 'Approval cancelled.');
  };

  return <main className={styles.screen}><div className={styles.panel}>
    <FxLogo size={36} />
    <h1>{done ? request?.kind === 'sign' ? 'Transaction submitted.' : 'Wallet ready.' : request?.kind === 'sign' ? 'Approve transaction.' : request?.kind === 'register' ? 'Set up your passkey.' : 'Wallet approval.'}</h1>
    {!done && request?.kind === 'register' && <p>Keep your passkey synced or backed up so you can use it again.</p>}
    {!done && transaction && <WalletApprovalDetails transaction={transaction} walletId={walletId} />}
    {busy && <p role="status">{request ? 'Waiting for approval…' : 'Checking approval…'}</p>}
    {error && <p role="alert">{error}</p>}
    {request && !done && !closed && !submitted.current && <button className={styles.primary} disabled={busy} onClick={() => void approve()}>{request.kind === 'sign' ? 'Approve with passkey' : 'Create passkey'}</button>}
    {!done && !closed && request && <button className={styles.secondary} onClick={cancel}>Cancel</button>}
    <a href={telegramReturnUrl()} referrerPolicy="no-referrer">Return to Telegram</a>
  </div></main>;
}
