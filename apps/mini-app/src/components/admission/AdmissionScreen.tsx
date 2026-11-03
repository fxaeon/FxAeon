'use client';

import { useId } from 'react';
import FxLogo from '../FxLogo';
import styles from './AdmissionScreen.module.css';

export type AdmissionScreenState =
  | 'intro' | 'full' | 'waiting' | 'alerts-off' | 'email' | 'verify' | 'verified'
  | 'invited' | 'passkey' | 'ready' | 'setup-error' | 'join-error' | 'checking';

export type AdmissionAction =
  | 'join' | 'open-web' | 'done' | 'allow-notifications' | 'add-email'
  | 'submit-email' | 'back-to-waitlist' | 'setup-wallet' | 'defer-setup'
  | 'create-passkey' | 'back-to-invitation' | 'open-app' | 'retry-setup' | 'retry-join' | 'check-email-status' | 'retry-email';

export type AdmissionEmailDelivery = 'unknown' | 'not_requested' | 'pending' | 'accepted' | 'failed' | 'uncertain' | 'expired' | 'verified';

type CommonProps = {
  /** Only confirmed permission may produce Telegram delivery copy. */
  notificationPermission?: 'granted' | 'denied' | 'unknown';
  /** Queued/accepted are delivery facts, never proof of inbox arrival. */
  emailDelivery?: AdmissionEmailDelivery;
  /** The parent owns all effects, navigation, failures and state transitions. */
  onAction: (action: AdmissionAction) => void;
  busy?: boolean;
  primaryDisabled?: boolean;
  primaryLabel?: string;
  statusMessage?: string;
  setupHint?: string;
  /** A user-facing failure from the parent, never a raw backend exception. */
  error?: string;
  /** Omitted unless the parent supplies a support destination. */
  supportHref?: string;
};

export type AdmissionScreenProps = CommonProps & (
  | { state: 'email'; email: string; onEmailChange: (email: string) => void }
  | { state: Exclude<AdmissionScreenState, 'email'>; email?: string; onEmailChange?: (email: string) => void }
);

type Action = { label: string; action: AdmissionAction };
type Copy = { title: string; lead: string; detail?: string; primary?: Action; secondary?: Action };

const COPY: Record<AdmissionScreenState, Copy> = {
  intro: {
    title: 'Join early access.', lead: 'We’ll invite you once you’re approved.',
    primary: { label: 'Join', action: 'join' },
    secondary: { label: 'Use FxAeon on the web', action: 'open-web' },
  },
  full: {
    title: 'Early access\nis full.', lead: 'Join the waitlist for a future opening.',
    primary: { label: 'Join the waitlist', action: 'join' },
    secondary: { label: 'Use FxAeon on the web', action: 'open-web' },
  },
  waiting: {
    title: 'You’re on\nthe waitlist.', lead: 'We’ll send you an invite once you’re approved.',
    primary: { label: 'Done', action: 'done' },
    secondary: { label: 'Get an email too', action: 'add-email' },
  },
  'alerts-off': {
    title: 'You’re on\nthe waitlist.', lead: 'We’ll send you an invite once you’re approved.',
    detail: 'Allow Telegram invites, add an email, or check back here.',
    primary: { label: 'Allow Telegram invites', action: 'allow-notifications' },
    secondary: { label: 'Use email instead', action: 'add-email' },
  },
  email: {
    title: 'Your invite,\nby email.', lead: 'Add an email for your invitation. This is optional.',
    primary: { label: 'Send confirmation link', action: 'submit-email' },
    secondary: { label: 'Skip for now', action: 'back-to-waitlist' },
  },
  verify: {
    title: 'Confirmation\nrequested.', lead: 'Use the confirmation link when your email arrives.',
    primary: { label: 'Check email status', action: 'check-email-status' },
    secondary: { label: 'Back to the waitlist', action: 'back-to-waitlist' },
  },
  verified: {
    title: 'You’re on\nthe waitlist.', lead: 'We’ll send you an invite once you’re approved.',
    detail: 'Your email is confirmed. We’ll send your invite there.',
    primary: { label: 'Done', action: 'done' },
    secondary: { label: 'Change email', action: 'add-email' },
  },
  invited: {
    title: 'Welcome to\nFxAeon.', lead: 'Set up your wallet to get started.',
    primary: { label: 'Set up my wallet', action: 'setup-wallet' },
    secondary: { label: 'Set up later', action: 'defer-setup' },
  },
  passkey: {
    title: 'Secure\nyour wallet.', lead: 'Create a passkey with your fingerprint, face, or device PIN.',
    detail: 'Keep your passkey synced or backed up so you can use it again.',
    primary: { label: 'Create passkey', action: 'create-passkey' },
    secondary: { label: 'Back', action: 'back-to-invitation' },
  },
  ready: {
    title: 'You’re in.', lead: 'Your wallet is ready.',
    primary: { label: 'Open FxAeon', action: 'open-app' },
  },
  'setup-error': {
    title: 'Let’s try again.', lead: 'We couldn’t confirm wallet setup. Check again when you’re ready.',
    primary: { label: 'Try setup again', action: 'retry-setup' },
    secondary: { label: 'Set up later', action: 'defer-setup' },
  },
  'join-error': {
    title: 'Let’s try again.', lead: 'We couldn’t confirm your place. Check your connection and try again.',
    primary: { label: 'Try again', action: 'retry-join' },
    secondary: { label: 'Use FxAeon on the web', action: 'open-web' },
  },
  checking: { title: 'Checking your access.', lead: 'One moment.' },
};

const EMAIL_COPY: Partial<Record<AdmissionEmailDelivery, Copy>> = {
  pending: { ...COPY.verify, title: 'Email queued.', lead: 'Your confirmation email is waiting to be sent.' },
  accepted: { title: 'Check your\ninbox.', lead: 'Use the confirmation link to verify your email address.',
    primary: { label: 'Back to the waitlist', action: 'back-to-waitlist' }, secondary: { label: 'Use a different email', action: 'add-email' } },
  failed: { title: 'Email couldn’t\nbe sent.', lead: 'Try again, or use a different email address.',
    primary: { label: 'Try again', action: 'retry-email' }, secondary: { label: 'Use a different email', action: 'add-email' } },
  uncertain: { title: 'Email status\nunconfirmed.', lead: 'We couldn’t confirm whether your email was sent.',
    primary: { label: 'Request another email', action: 'retry-email' }, secondary: { label: 'Back to the waitlist', action: 'back-to-waitlist' } },
  expired: { title: 'Confirmation\nlink expired.', lead: 'Request a new link to verify your email address.',
    primary: { label: 'Request a new link', action: 'retry-email' }, secondary: { label: 'Use a different email', action: 'add-email' } },
  not_requested: { title: 'Your invite,\nby email.', lead: 'Add an email for your invitation. This is optional.',
    primary: { label: 'Add email', action: 'add-email' }, secondary: { label: 'Back to the waitlist', action: 'back-to-waitlist' } },
  verified: COPY.verified,
};

/** Presentation only: rendering or clicking never grants access or verifies an email. */
export function AdmissionScreen(props: AdmissionScreenProps) {
  const { state, notificationPermission = 'unknown', busy = false, error, supportHref, onAction, primaryDisabled, primaryLabel, statusMessage, setupHint } = props;
  const id = useId();
  const view = state === 'waiting' && notificationPermission === 'denied' ? 'alerts-off' : state;
  const copy = view === 'verify' ? EMAIL_COPY[props.emailDelivery ?? 'unknown'] ?? COPY.verify : COPY[view];
  const pending = busy || state === 'checking';
  const detail = view === 'waiting'
    ? notificationPermission === 'granted'
      ? 'Your invite will arrive in this Telegram chat.'
      : 'Check back here for your invitation.'
    : view === 'invited' && setupHint ? setupHint : copy.detail;
  const secondary = view === 'waiting' && notificationPermission !== 'granted'
    ? { label: 'Get an email invite', action: 'add-email' as const }
    : copy.secondary;

  return (
    <main className={styles.screen} data-admission-state={view} aria-labelledby={`${id}-title`}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <FxLogo size={32} />
        </header>
        <div className={styles.content}>
          <div className={styles.copy}>
            <div className={styles.message} aria-live="polite" aria-atomic="true">
              <h1 key={`${view}-${props.emailDelivery ?? ''}`} id={`${id}-title`} className={styles.title}>{copy.title}</h1>
              {' '}
              <p className={styles.lead}>{copy.lead}</p>
            </div>
            {state === 'email' && (
              <form id={`${id}-email-form`} className={styles.emailForm} aria-label="Invitation email"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!pending) onAction('submit-email');
                }}>
                <label htmlFor={`${id}-email`}>Email address</label>
                <input id={`${id}-email`} name="email" type="email" autoComplete="email"
                  inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} required
                  placeholder="you@example.com" value={props.email} disabled={pending}
                  onChange={(event) => props.onEmailChange(event.currentTarget.value)} />
              </form>
            )}
          </div>
          <div className={styles.actions} aria-busy={pending}>
            {detail && <p className={styles.detail}>{detail}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
            {statusMessage && <p className={styles.detail} role="status">{statusMessage}</p>}
            {busy && <p className={styles.detail} role="status">One moment…</p>}
            {copy.primary && (
              <button className={styles.primary} type={state === 'email' ? 'submit' : 'button'}
                form={state === 'email' ? `${id}-email-form` : undefined} disabled={pending || primaryDisabled}
                onClick={state === 'email' ? undefined : () => onAction(copy.primary!.action)}>
                {primaryLabel ?? copy.primary.label}
              </button>
            )}
            {secondary && (
              <button className={styles.secondary} type="button" disabled={pending}
                onClick={() => onAction(secondary.action)}>
                {secondary.label}
              </button>
            )}
          </div>
        </div>
        {supportHref && <footer className={styles.footer}><a href={supportHref}>Feedback &amp; reports</a></footer>}
      </div>
    </main>
  );
}

export default AdmissionScreen;
