'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowLeft, Check, ChevronRight, CircleHelp, Coins, Copy, ExternalLink, KeyRound, LoaderCircle, Search, ShieldCheck, Wallet, X } from 'lucide-react';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import type { WalletChoice } from '@/lib/wallet/walletCatalog';
import { copyText } from '@/lib/clipboard';
import { openExternalLink } from '@/lib/telegram';

export type WalletDialogAttempt = {
  walletId: string;
  name: string;
  status: 'pending' | 'error' | 'handoff';
  message?: string;
  fallbackHref?: string;
  guideHref?: string;
  dappHref?: string;
  canReopen?: boolean;
};

function WalletMark({ icon }: { icon?: string }) {
  return <WalletMarkImage key={icon ?? 'fallback'} icon={icon} />;
}

function WalletMarkImage({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(icon && !failed);
  return <span className={`wallet-provider-mark${showImage ? ' wallet-provider-brand' : ''}`} aria-hidden="true">
    {showImage ? <>
      {/* Local catalog marks or validated EIP-6963 data images; never inline SVG. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon} alt="" width={32} height={32} onError={() => setFailed(true)} />
    </> : <Wallet size={24} />}
  </span>;
}

/** Presentation only: wallet identity is chosen here; the shared wallet owner
 * resolves capability and owns approval, cancellation and late results. */
export function ExternalWalletDialog({ choices, pending = null, onChoose, onBack, onCancel }: {
  choices: readonly WalletChoice[];
  pending?: WalletDialogAttempt | null;
  onChoose: (choice: WalletChoice) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [query, setQuery] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [copying, setCopying] = useState(false);
  const copyGeneration = useRef(0);
  useEffect(() => {
    const generation = copyGeneration;
    generation.current++; setCopyMessage(''); setCopying(false);
    return () => { generation.current++; };
  }, [pending?.walletId, pending?.dappHref]);
  const copyDapp = async () => {
    if (!pending?.dappHref) return;
    const generation = ++copyGeneration.current;
    setCopying(true);
    const copied = await copyText(pending.dappHref);
    if (copyGeneration.current !== generation) return;
    setCopyMessage(copied ? 'FxAeon link copied.' : 'Copy was blocked. Select the link below to copy it.');
    setCopying(false);
  };
  const triggerRef = useRef<HTMLElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const otherRef = useRef<HTMLButtonElement | null>(null);
  const helpRef = useRef<HTMLButtonElement | null>(null);
  const dismissRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const focusedWalletId = useRef<string | null>(null);
  const returnScrollTop = useRef(0);
  const helpReturnScrollTop = useRef(0);
  const returnWalletId = useRef<string | null>(null);
  const previousView = useRef({ showAll, showHelp, walletId: pending?.walletId });
  const dialogRef = useOverlayDialog<HTMLDivElement>({ open: true, onClose: onCancel, triggerRef, initialFocusRef: dismissRef,
    restoreFocusFallback: () => {
      const candidates = document.querySelectorAll<HTMLElement>(
        '.app-topbar [data-wallet-connect-trigger], .app-topbar button[aria-label="Open wallet profile"], #main-content h1[tabindex], #main-content',
      );
      return [...candidates].find((element) => !element.matches(':disabled')
        && !element.closest('[hidden],[aria-hidden="true"],[inert]') && element.getClientRects().length > 0) ?? null;
    },
  });
  const selectedWallet = choices.find((choice) => choice.id === pending?.walletId);
  const walletReady = pending?.status === 'handoff' && pending.canReopen === false && selectedWallet?.injected === 'available';
  const showInstallHelp = Boolean(safeHelpLink(pending?.fallbackHref)
    && !(pending?.status === 'handoff' && pending.canReopen === false));
  const showGuideHelp = safeHelpLink(pending?.guideHref);
  const search = showAll ? query.trim().toLocaleLowerCase() : '';
  const visibleChoices = choices.filter((choice) => (
    showAll || choice.primary || (choice.injected === 'available' && !choice.secondary)
  ) && choice.name.toLocaleLowerCase().includes(search))
    .sort((left, right) => Number(right.injected === 'available') - Number(left.injected === 'available'));

  useEffect(() => {
    const previous = previousView.current;
    const walletId = pending?.walletId;
    if (previous.showAll === showAll && previous.showHelp === showHelp && previous.walletId === walletId) {
      // Retry removes its button while the wallet approval is pending. Keep
      // focus inside the dialog without moving it away from a surviving control.
      if (!dialogRef.current?.contains(document.activeElement)) (backRef.current ?? dismissRef.current)?.focus({ preventScroll: true });
      return;
    }
    previousView.current = { showAll, showHelp, walletId };
    if (previous.showHelp && !showHelp && !showAll) {
      if (contentRef.current) contentRef.current.scrollTop = helpReturnScrollTop.current;
      helpRef.current?.focus({ preventScroll: true });
      return;
    }
    if (previous.walletId && !walletId) {
      if (contentRef.current) contentRef.current.scrollTop = returnScrollTop.current;
      const original = [...(dialogRef.current?.querySelectorAll<HTMLElement>('[data-wallet-id]') ?? [])]
        .find((element) => element.dataset.walletId === returnWalletId.current);
      // Discovery may have changed while approval was pending. Restore focus
      // without silently choosing a new route or another wallet.
      const restored = original ?? backRef.current ?? dismissRef.current;
      restored?.focus({ preventScroll: true });
      original?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (contentRef.current) contentRef.current.scrollTop = 0;
    const nextFocus = walletId || showAll || showHelp ? backRef.current : otherRef.current;
    nextFocus?.focus({ preventScroll: true });
    if (!walletId && !showAll) nextFocus?.scrollIntoView({ block: 'nearest' });
  }, [showAll, showHelp, pending?.walletId, pending?.status, dialogRef]);

  useEffect(() => {
    if (focusedWalletId.current && !dialogRef.current?.contains(document.activeElement)) {
      dismissRef.current?.focus({ preventScroll: true });
    }
  }, [choices, dialogRef]);

  const choose = (choice: WalletChoice) => {
    returnScrollTop.current = contentRef.current?.scrollTop ?? 0;
    returnWalletId.current = choice.id;
    onChoose(choice);
  };
  const goBack = () => {
    if (showHelp) setShowHelp(false);
    else if (pending) onBack();
    else { setShowAll(false); setQuery(''); }
  };
  const backLabel = pending && showAll ? 'Back to Other wallets' : 'Back to wallets';
  const title = showHelp ? 'What is a wallet?' : pending?.name ?? (showAll ? 'Other wallets' : 'Connect your wallet');
  const attemptTitle = walletReady ? 'Wallet ready'
    : pending?.status === 'pending' ? 'Waiting for approval'
    : pending?.status === 'error' ? 'Connection not completed'
      : pending?.canReopen === false && selectedWallet?.injected !== 'available' ? 'Wallet not detected' : pending ? `Continue in ${pending.name}` : '';

  return <div className="wallet-provider-chooser-backdrop" role="presentation" onMouseDown={(event: MouseEvent) => { if (event.target === event.currentTarget) { event.preventDefault(); onCancel(); } }}>
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="wallet-provider-chooser-title" aria-describedby={pending ? 'wallet-provider-attempt-message' : undefined} className="wallet-provider-chooser" data-wallet-view={showHelp ? 'help' : pending?.status ?? (showAll ? 'all' : 'wallets')} onFocusCapture={(event) => {
      focusedWalletId.current = (event.target as HTMLElement).closest('[data-wallet-id]')?.getAttribute('data-wallet-id') ?? null;
    }}>
      <header className="wallet-provider-chooser-header">
        {(showAll || pending || showHelp) ? <button ref={backRef} type="button" onClick={goBack} aria-label={backLabel} className="wallet-provider-chooser-close"><ArrowLeft size={20} aria-hidden="true" /></button>
          : <button ref={helpRef} type="button" onClick={() => { helpReturnScrollTop.current = contentRef.current?.scrollTop ?? 0; setShowHelp(true); }} aria-label="What is a wallet?" className="wallet-provider-chooser-close"><CircleHelp size={21} aria-hidden="true" /></button>}
        <h2 id="wallet-provider-chooser-title"><span>{title}</span></h2>
        <button ref={dismissRef} type="button" onClick={onCancel} aria-label="Close wallet selection" className="wallet-provider-chooser-close"><X size={20} aria-hidden="true" /></button>
      </header>
      <div ref={contentRef} className="wallet-provider-chooser-content">
        {showHelp ? <div className="wallet-provider-education">
          <div className="wallet-provider-lesson"><span data-wallet-lesson="connect"><KeyRound size={28} aria-hidden="true" /></span><h3>Your connection to FxAeon</h3><p>Connect without a password.</p></div>
          <div className="wallet-provider-lesson"><span data-wallet-lesson="assets"><Coins size={28} aria-hidden="true" /></span><h3>A home for your assets</h3><p>View, send, and receive digital assets.</p></div>
          <div className="wallet-provider-lesson"><span data-wallet-lesson="control"><ShieldCheck size={28} aria-hidden="true" /></span><h3>You approve every action</h3><p>Connecting shares your public address. Transactions need a separate approval in your wallet.</p></div>
          <button type="button" className="wallet-provider-explore" onClick={() => { setShowHelp(false); setShowAll(true); }}><Wallet size={18} aria-hidden="true" />Explore wallets</button>
        </div> : pending ? <div className="wallet-provider-attempt">
          <div className="wallet-provider-hero" data-pending={pending.status === 'pending' || undefined}><WalletMark icon={selectedWallet?.icon} />{pending.status === 'pending' && <LoaderCircle size={88} className="wallet-provider-pending-icon" aria-hidden="true" />}</div>
          <h3 className="wallet-provider-attempt-title">{attemptTitle}</h3>
          <div className="wallet-provider-attempt-copy" role={pending.status === 'error' ? 'alert' : 'status'}>
            <p id="wallet-provider-attempt-message">{walletReady ? `${pending.name} is ready. Connect to continue.` : pending.message ?? (pending.status === 'pending'
              ? `Approve the connection request in ${pending.name}. You can go back or close this window to stop waiting.`
              : pending.status === 'handoff'
                ? `Opening ${pending.name}…`
                : `Couldn’t connect to ${pending.name}. Try again or choose another wallet.`)}</p>
          </div>
          {pending.status === 'error' && selectedWallet && <button type="button" className="wallet-provider-retry" onClick={() => onChoose(selectedWallet)}>Try again</button>}
          {pending.status === 'handoff' && selectedWallet && walletReady && <button type="button" className="wallet-provider-retry" onClick={() => onChoose(selectedWallet)}><Wallet size={17} aria-hidden="true" />Connect {pending.name}</button>}
          {pending.status === 'handoff' && selectedWallet && pending.canReopen !== false && <button type="button" className="wallet-provider-retry" onClick={() => onChoose(selectedWallet)}><ExternalLink size={17} aria-hidden="true" />Open {pending.name}</button>}
          {pending.status === 'handoff' && pending.canReopen === false && !walletReady && pending.fallbackHref && safeHelpLink(pending.fallbackHref) && <a className="wallet-provider-retry" href={pending.fallbackHref} target="_blank" rel="noopener noreferrer" onClick={event => { if (openExternalLink(pending.fallbackHref!)) event.preventDefault(); }}><ExternalLink size={17} aria-hidden="true" />Get {pending.name}</a>}
          {(pending.status === 'handoff' || pending.status === 'error') && pending.dappHref && <div className="wallet-provider-copy-link">
            <button type="button" disabled={copying} onClick={() => void copyDapp()}><Copy size={15} aria-hidden="true" />{copying ? 'Copying…' : 'Copy FxAeon link'}</button>
            {copyMessage && <p role="status">{copyMessage}</p>}
            {copyMessage.startsWith('Copy was blocked') && <code>{pending.dappHref}</code>}
          </div>}
          {(pending.status === 'handoff' || pending.status === 'error') && (showInstallHelp || showGuideHelp) && <details className="wallet-provider-recovery">
            <summary>Connection help</summary>
            <div className="wallet-provider-handoff-tools">
            {showInstallHelp && <a href={pending.fallbackHref} target="_blank" rel="noopener noreferrer" onClick={event => { if (openExternalLink(pending.fallbackHref!)) event.preventDefault(); }}>Install {pending.name}</a>}
            {showGuideHelp && <a href={pending.guideHref} target="_blank" rel="noopener noreferrer" onClick={event => { if (openExternalLink(pending.guideHref!)) event.preventDefault(); }}>Wallet guide</a>}
            </div>
          </details>}
        </div> : <>
          {showAll && <label className="wallet-provider-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search wallets" placeholder="Search wallets" maxLength={64} value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          <div className="wallet-provider-options">{visibleChoices.map((choice) => <button key={choice.id} data-wallet-id={choice.id} aria-label={choice.name} className="wallet-provider-option" type="button" onClick={() => choose(choice)}>
            <WalletMark icon={choice.icon} />
            <span className="wallet-provider-option-name">{choice.name}</span>
            {choice.injected === 'available' && <span className="wallet-provider-detected"><Check size={11} strokeWidth={2.5} aria-hidden="true" />Detected</span>}
            <ChevronRight size={16} className="wallet-provider-chevron" aria-hidden="true" />
          </button>)}</div>
          {showAll && visibleChoices.length === 0 && <p role="status" className="wallet-provider-empty">No wallets match your search.</p>}
        </>}
      </div>
      {!showHelp && !pending && !showAll && <footer className="wallet-provider-footer">
          <button ref={otherRef} type="button" onClick={() => setShowAll(true)} className="wallet-provider-option wallet-provider-other">
            <span className="wallet-provider-mark" aria-hidden="true"><Search size={23} /></span>
            <span className="wallet-provider-option-name">Other wallets</span>
            <ChevronRight size={16} className="wallet-provider-chevron" aria-hidden="true" />
          </button>
      </footer>}
    </div>
  </div>;
}

function safeHelpLink(value: string | undefined): boolean {
  try {
    if (!value) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
