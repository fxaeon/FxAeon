'use client';

import { useRef, type MouseEvent } from 'react';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import type { DiscoveredEip6963Provider } from '@/lib/wallet/eip6963';
import { getWalletBrowserLinks } from '@/lib/wallet/walletBrowserLinks';

export function ExternalWalletDialog({ providers, onChoose, onCancel }: {
  providers: readonly DiscoveredEip6963Provider[];
  onChoose: (provider: DiscoveredEip6963Provider) => void;
  onCancel: () => void;
}) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useOverlayDialog<HTMLDivElement>({ open: true, onClose: onCancel, triggerRef });
  const walletBrowserLinks = getWalletBrowserLinks(typeof window === 'undefined' ? '/' : window.location.pathname);
  return <div className="wallet-provider-chooser-backdrop" role="presentation" onMouseDown={(event: MouseEvent) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="wallet-provider-chooser-title" className="wallet-provider-chooser" style={{ maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto' }}>
      <h2 id="wallet-provider-chooser-title" className="text-display text-lg font-semibold">Connect your wallet</h2>
      <p className="mt-2 text-sm text-mut">{providers.length ? 'Choose the wallet you want to use.' : 'Open FxAeon inside your wallet app to connect.'} You approve every transaction in your wallet.</p>
      {providers.length > 0 && <div className="mt-4 flex flex-col gap-2">{providers.map((provider) => <button key={provider.rdns} className="button glass-press flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left" type="button" onClick={() => onChoose(provider)}><span className="min-w-0 flex-1 break-words text-left">{provider.name}</span><span className="shrink-0 text-xs text-mut">Detected</span></button>)}</div>}
      <p className="mb-2 mt-5 text-xs text-mut">Open in a wallet app</p>
      <div className="flex flex-col gap-2 sm:flex-row">{walletBrowserLinks.map((link) => <a key={link.name} href={link.href} rel="noreferrer" className="button glass-press flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm">Open in {link.name}</a>)}</div>
      <p className="mt-3 text-xs text-mut">Connect again in the wallet’s browser. If the app does not open, copy fxaeon.com into its browser.</p>
      <button type="button" onClick={onCancel} className="mt-3 min-h-11 w-full px-3 text-sm text-mut">Cancel</button>
    </div>
  </div>;
}
