'use client';

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import { ProviderLoadingState } from '@/components/ProviderLoadingState';
import { getWebApp, haptic, openExternalLink, waitForTelegramWebApp } from '@/lib/telegram';
import {
  TELEGRAM_ADMISSION_ENABLED, currentTelegramLaunchData, forgetAdmission, launchUserId, rememberAdmission,
  rememberedAdmission, requestTelegramAdmission, webAppUrl, type TelegramAdmission, type TelegramAdmissionIntent,
} from '@/lib/telegramAdmission';
import styles from '@/components/UtilitySurfaces.module.css';

type GateView = 'open' | 'checking' | Exclude<TelegramAdmission, 'admitted'>;

const viewFor = (result: TelegramAdmission): GateView => (result === 'admitted' ? 'open' : result);

/** Ask with the launch's signed data; remember or forget this device's seat. */
async function ask(intent: TelegramAdmissionIntent): Promise<TelegramAdmission> {
  let launchData = currentTelegramLaunchData();
  if (!launchData) {
    await waitForTelegramWebApp();
    launchData = currentTelegramLaunchData();
  }
  const result = await requestTelegramAdmission(launchData, intent);
  if (result === 'admitted') rememberAdmission(launchUserId(launchData));
  else if (result === 'full' || result === 'waitlisted') forgetAdmission();
  return result;
}

/**
 * Renders the Privy wallet only for admitted Telegram users. Everyone else
 * gets a waitlist and the web app, and never loads Privy, so the Telegram
 * cohort stays inside Privy's free monthly-user allowance. Off unless the
 * build enables it; a member remembered on this device opens immediately.
 */
export function TelegramAdmissionGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<GateView>(() => !TELEGRAM_ADMISSION_ENABLED
    || rememberedAdmission(launchUserId(currentTelegramLaunchData())) ? 'open' : 'checking');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!TELEGRAM_ADMISSION_ENABLED) return;
    // A remembered member keeps this session; the check still refreshes or
    // forgets the device's memory for the next launch.
    const remembered = view === 'open';
    let cancelled = false;
    void ask('enter').then((result) => { if (!cancelled && !remembered) setView(viewFor(result)); });
    return () => { cancelled = true; };
    // One check per launch; retries and joins call ask() themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (intent: TelegramAdmissionIntent) => {
    setBusy(true);
    setNotice('');
    const result = await ask(intent);
    setBusy(false);
    if (result === 'unavailable' && intent === 'join') {
      setNotice('Couldn’t join the waitlist. Check your connection and try again.');
      haptic('error');
      return;
    }
    if (result === 'waitlisted' || result === 'admitted') haptic('success');
    setView(viewFor(result));
  };

  if (view === 'open') return <>{children}</>;
  if (view === 'checking') return <ProviderLoadingState />;
  return <AdmissionScreen view={view} busy={busy} notice={notice} onJoin={() => void act('join')} onRetry={() => void act('enter')} />;
}

const COPY: Record<Exclude<GateView, 'open' | 'checking'>, { title: string; lead: string }> = {
  full: {
    title: 'Telegram early access is full',
    lead: 'Join the waitlist to save your place. You can use FxAeon on the web right now with your own wallet.',
  },
  waitlisted: {
    title: 'You’re on the waitlist',
    lead: 'Your place is saved. Open FxAeon from Telegram again later, or continue on the web with your own wallet now.',
  },
  unavailable: {
    title: 'Couldn’t check your access',
    lead: 'FxAeon couldn’t reach its Telegram access check. Try again, or continue on the web with your own wallet.',
  },
  expired: {
    title: 'Reopen FxAeon from Telegram',
    lead: 'This launch is too old to check. Close FxAeon and open it again from the bot.',
  },
  rejected: {
    title: 'Open FxAeon from its bot',
    lead: 'This launch couldn’t be verified. Open FxAeon from the FxAeon bot, or continue on the web.',
  },
};

/**
 * The shared button look without the app shell module: this screen renders
 * before any wallet provider, so it imports nothing the shell depends on.
 */
const ACTION = 'button glass-press astryx-interactive flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3';

function ActionButton({ children, onClick, busy = false }: { children: ReactNode; onClick: () => void; busy?: boolean }) {
  return <button type="button" className={`${ACTION} button-primary font-semibold`} disabled={busy} aria-busy={busy || undefined}
    onClick={() => { haptic('medium'); onClick(); }}>
    {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
    {children}
  </button>;
}

function AdmissionScreen({ view, busy, notice, onJoin, onRetry }: {
  view: Exclude<GateView, 'open' | 'checking'>; busy: boolean; notice: string; onJoin: () => void; onRetry: () => void;
}) {
  // Only rendered in the Telegram client, never during static rendering.
  const href = webAppUrl(typeof window === 'undefined' ? '/' : window.location.pathname);
  const openWeb = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(href)) {
      event.preventDefault();
    }
  };
  // The web app is the next step once the waitlist holds the user's place.
  const webPrimary = view !== 'full' && view !== 'unavailable';
  const close = view === 'expired' ? getWebApp()?.close : undefined;
  return (
    <main className={`${styles.loginPanel} ${styles.authStage} utility-stage mx-auto w-full`} data-telegram-admission={view}>
      <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
      <h1 className={styles.authTitle}>{COPY[view].title}</h1>
      <p className={styles.authLead}>{COPY[view].lead}</p>
      <div className={styles.authActions}>
        {view === 'full' && <ActionButton onClick={onJoin} busy={busy}>Join the waitlist</ActionButton>}
        {view === 'unavailable' && <ActionButton onClick={onRetry} busy={busy}>Try again</ActionButton>}
        {close && <ActionButton onClick={() => close()}>Close FxAeon</ActionButton>}
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={openWeb}
          className={`${ACTION} ${webPrimary && !close ? 'button-primary font-semibold' : 'button-ghost text-[var(--text)]'}`}>
          Continue on the web <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
      {notice && <p role="alert" className={styles.authNotice} data-tone="danger">{notice}</p>}
      {view === 'full' && <p className={styles.authFinePrint}>Joining saves only your Telegram user ID and when you joined.</p>}
    </main>
  );
}
