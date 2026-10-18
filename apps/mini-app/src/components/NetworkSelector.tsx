'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react';
import { usePrivyWallet, type FxChainId } from '@/lib/wallet';
import { usePathname } from 'next/navigation';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { ChainIcon } from '@/components/TokenIcon';
import { beginLocalHistoryEntry, isLocalHistoryTraversal } from '@/lib/useOverlayDialog';

const CHAINS: readonly { id: FxChainId; label: string }[] = [
  { id: 1, label: 'Ethereum' },
  { id: 8453, label: 'Base' },
];

function allowedChainsForRoute(pathname: string): readonly FxChainId[] {
  if (pathname === '/trade' || pathname.startsWith('/trade/')) return [1];
  if (pathname === '/positions' || pathname.startsWith('/positions/')) return [1];
  if (pathname === '/earn' || pathname.startsWith('/earn/')) return [1];
  if (pathname === '/borrow' || pathname.startsWith('/borrow/')) return [1];
  return [1, 8453];
}

function chainLabel(chainId: FxChainId | undefined): string {
  return CHAINS.find((chain) => chain.id === chainId)?.label ?? 'Unsupported network';
}

export default function NetworkSelector() {
  const pathname = usePathname() ?? '/';
  const wallet = usePrivyWallet();
  const instanceId = useId();
  const menuId = `network-selector-menu-${instanceId.replace(/:/g, '')}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const switchRequestRef = useRef(0);
  const walletAddressRef = useRef(wallet.address);
  const connectionVersionRef = useRef(wallet.connectionVersion);
  const mountedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<FxChainId | null>(null);
  const [error, setError] = useState(false);
  const [failedTarget, setFailedTarget] = useState<FxChainId | null>(null);
  const allowedChains = allowedChainsForRoute(pathname);
  const connected = Boolean(wallet.ready && wallet.authenticated && wallet.address);
  const supportedChain = wallet.chainId === 1 || wallet.chainId === 8453;
  const requiredChain = allowedChains.length === 1 ? allowedChains[0] : undefined;
  const routeBlocked = connected && (!supportedChain || !allowedChains.includes(wallet.chainId!));

  useEffect(() => {
    walletAddressRef.current = wallet.address;
    connectionVersionRef.current = wallet.connectionVersion;
  }, [wallet.address, wallet.connectionVersion]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      switchRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    switchRequestRef.current += 1;
    const focusTrigger = rootRef.current?.contains(document.activeElement);
    setOpen(false);
    setError(false);
    setPending(null);
    setFailedTarget(null);
    if (focusTrigger) buttonRef.current?.focus();
  }, [pathname, wallet.address, wallet.connectionVersion]);

  useEffect(() => {
    if (!open) return;
    const selected = menuRef.current?.querySelector<HTMLButtonElement>(
      '[data-network-option][aria-checked="true"]:not([disabled])',
    );
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])');
    (selected ?? first)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const menu = menuRef.current;
    if (!root || !menu) return;

    // The selector can sit near the center of a narrow mobile header. Keeping
    // the menu right-aligned to it would push the menu beyond the viewport.
    // Clamp its left edge to the viewport while preserving right alignment
    // whenever there is room.
    const positionMenu = () => {
      const rootRect = root.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const minLeft = 12 - rootRect.left;
      const maxLeft = window.innerWidth - 12 - rootRect.left - menuRect.width;
      const rightAlignedLeft = rootRect.width - menuRect.width;
      const left = Math.max(minLeft, Math.min(rightAlignedLeft, maxLeft));
      menu.style.left = `${left}px`;
      menu.style.right = 'auto';
    };

    positionMenu();
    window.addEventListener('resize', positionMenu);
    return () => {
      window.removeEventListener('resize', positionMenu);
      menu.style.left = '';
      menu.style.right = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trigger = buttonRef.current;
    let consumedBack = false;
    let restoreFocus = true;
    const historyKey = '__fxaeonNetworkMenu';
    const historyEntry = beginLocalHistoryEntry(historyKey, menuId);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        restoreFocus = false;
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPopState = (event: PopStateEvent) => {
      if (isLocalHistoryTraversal(event)) return;
      consumedBack = true;
      setOpen(false);
    };
    const onTelegramBack = (event: Event) => {
      const detail = (event as CustomEvent<{ consume?: () => void; isConsumed?: () => boolean }>).detail;
      if (detail?.isConsumed?.()) return;
      setOpen(false);
      detail?.consume?.();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('fxaeon:telegram-back', onTelegramBack);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('fxaeon:telegram-back', onTelegramBack);
      historyEntry.finish(consumedBack);
      if (restoreFocus) trigger?.focus({ preventScroll: true });
    };
  }, [open, menuId]);

  const selectChain = async (chainId: FxChainId) => {
    if (pending || !connected || chainId === wallet.chainId) return;
    const requestId = ++switchRequestRef.current;
    const addressAtStart = wallet.address;
    const connectionVersionAtStart = wallet.connectionVersion;
    setPending(chainId);
    setError(false);
    setFailedTarget(null);
    try {
      await wallet.switchChain(chainId);
      if (requestId !== switchRequestRef.current
        || !mountedRef.current
        || (walletAddressRef.current ?? '').toLowerCase() !== (addressAtStart ?? '').toLowerCase()
        || connectionVersionRef.current !== connectionVersionAtStart) return;
      setOpen(false);
      window.setTimeout(() => {
        if (mountedRef.current && switchRequestRef.current === requestId) buttonRef.current?.focus();
      }, 0);
    } catch {
      if (requestId !== switchRequestRef.current
        || !mountedRef.current
        || (walletAddressRef.current ?? '').toLowerCase() !== (addressAtStart ?? '').toLowerCase()
        || connectionVersionRef.current !== connectionVersionAtStart) return;
      setFailedTarget(chainId);
      setError(true);
    } finally {
      if (mountedRef.current && requestId === switchRequestRef.current) setPending(null);
    }
  };

  const label = !connected ? 'Networks' : pending ? `Switching to ${chainLabel(pending)}` : supportedChain ? chainLabel(wallet.chainId) : 'Unsupported network';
  const currentChainIcon = pending ?? (supportedChain ? wallet.chainId : undefined);
  // Until the wallet provider is ready the network is unknown: a quiet
  // placeholder holds the icon's place. Without a wallet, the two supported
  // networks stand in for "which network".
  const idleIcon = !wallet.ready
    ? <span className="network-selector-placeholder skeleton" aria-hidden="true" />
    : <span className="network-selector-chains" aria-hidden="true">{CHAINS.map((chain) => <ChainIcon key={chain.id} chainId={chain.id} size={15} />)}</span>;
  const switchError = failedTarget === null
    ? 'Switch failed.'
    : `Switch failed. Couldn't switch to ${chainLabel(failedTarget)}. Try again.`;
  const visibleLabel = !connected ? 'Networks' : pending ? 'Switching…' : supportedChain ? chainLabel(wallet.chainId) : 'Unsupported';
  return (
    <div ref={rootRef} className={`network-selector-wrap${routeBlocked ? ' network-selector-wrap-blocked' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className="network-selector"
        aria-label={routeBlocked && requiredChain ? `Switch to ${chainLabel(requiredChain)}` : connected ? `Change network, current ${label}` : 'Choose a network or connect a wallet'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-busy={Boolean(pending) || !wallet.ready}
        onClick={() => { setError(false); setOpen((value) => !value); }}
        disabled={Boolean(pending)}
      >
        {pending ? <LoaderCircle className="network-selector-spinner" size={15} aria-hidden="true" /> : currentChainIcon ? <ChainIcon chainId={currentChainIcon} size={17} /> : idleIcon}
        <span className="sr-only network-selector-label">{label}</span>
        <span className="network-selector-visual-label" aria-hidden="true">{visibleLabel}</span>
        <ChevronDown className="network-selector-chevron" size={14} aria-hidden="true" />
      </button>
      {routeBlocked && <p className="network-selector-notice" role="status" aria-live="polite">{requiredChain ? `Switch to ${chainLabel(requiredChain)} to continue.` : 'Choose a supported network to continue.'}</p>}
      {open && <div ref={menuRef} id={menuId} className="network-selector-menu" role="menu" aria-label="Choose wallet network" onKeyDown={(event) => {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])')];
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          buttonRef.current?.focus();
          return;
        }
        if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
        {error && <div className="network-selector-error" role="alert"><AlertTriangle size={14} aria-hidden="true" /> <span>{switchError}</span> <button type="button" role="menuitem" onClick={() => { if (failedTarget !== null) void selectChain(failedTarget); }}>Retry</button><RefreshCw size={13} aria-hidden="true" /></div>}
        {!connected && <ConnectWalletButton className="network-selector-connect" role="menuitem" onConnected={() => { setOpen(false); buttonRef.current?.focus(); }}>Connect wallet</ConnectWalletButton>}
        {CHAINS.map((chain) => {
          const selected = wallet.chainId === chain.id;
          return <button key={chain.id} data-network-option="true" type="button" role="menuitemradio" aria-label={chain.label} aria-checked={selected} disabled={!connected || Boolean(pending)} onClick={() => { void selectChain(chain.id); }}>
            <span className="network-option-label"><ChainIcon chainId={chain.id} size={18} /><strong>{chain.label}</strong></span>
            {selected && <Check size={16} aria-hidden="true" />}
          </button>;
        })}
      </div>}
    </div>
  );
}
