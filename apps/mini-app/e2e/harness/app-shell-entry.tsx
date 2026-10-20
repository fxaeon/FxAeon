import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { History } from 'lucide-react';
import { AppShell, Button } from '@/components/ui';
import { ActionRow, ChoiceCards, PageHeading, ProductSurface } from '@/components/ProductUI';
import MorePage from '@/app/more/page';
import SettingsPage from '@/app/settings/page';
import DocsPage from '@/app/docs/page';
import NotFound from '@/app/not-found';
import RouteError from '@/app/error';
import LoginPage from '@/app/login/page';
import HistoryPage from '@/app/history/page';
import { ProviderLoadingState } from '@/components/ProviderLoadingState';
import connectNotice from '@/components/ConnectWalletButton.module.css';

/** The shell lab state lives on globalThis so the mocked wallet and router
 * modules (see e2e/overlay-specs/app-shell.spec.ts) read the same store. */
type ShellLab = {
  path: string;
  overlay: 'none' | 'dialog' | 'review';
  subscribe: (listener: () => void) => () => void;
  set: (patch: Record<string, unknown>) => void;
  snapshot: () => { path: string; overlay: string; outline: boolean };
};

const lab = (globalThis as typeof globalThis & { __shellLab: ShellLab }).__shellLab;

function TradeDraft() {
  const [amount, setAmount] = useState('');
  return <div className="trade-workspace">
    <header className="trade-page-heading"><div><h1>Trade</h1></div></header>
    <label>Trade amount<input value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <p style={{ height: 1200 }}>Ticket</p>
  </div>;
}

function Page({ path }: { path: string }) {
  if (path === '/history') return <HistoryPage />;
  if (path === '/trade') {
    return <AppShell><TradeDraft /></AppShell>;
  }
  // The real More, Settings and Docs routes, against the lab's wallet and router.
  if (path === '/more') return <MorePage />;
  if (path === '/settings') return <SettingsPage />;
  if (path === '/docs') return <DocsPage />;
  // Full-screen stages outside the shell.
  if (path === '/missing') return <NotFound />;
  if (path === '/error') return <RouteError error={new Error('lab')} reset={() => undefined} />;
  if (path === '/login') return <LoginPage />;
  // Every shared control in its unavailable and busy states, on a card.
  if (path === '/controls') {
    return <AppShell>
      <ProductSurface style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button disabled>Not enough ETH for network fees</Button>
        <Button loading>Checking transaction…</Button>
        <Button variant="ghost" disabled>Retry review</Button>
        <Button variant="danger" disabled>Close position</Button>
        <Button variant="outline" disabled>Outline action</Button>
        <ActionRow icon={History} title="Unavailable row" description="Explains why" onClick={() => undefined} disabled />
        <ChoiceCards label="Withdraw" value="instant" onChange={() => undefined}
          options={[{ value: 'instant', label: 'Instant' }, { value: 'queued', label: 'Queued', description: 'Not available yet', disabled: true }]} />
      </ProductSurface>
      {/* ConnectWalletButton's notice when the wallet provider never became ready. */}
      <span role="alert" className={`wallet-connect-toast ${connectNotice.notice}`}>
        <span>Wallet provider is unavailable.</span>
        <button type="button" className={connectNotice.noticeAction} aria-label="Retry wallet provider">Retry</button>
      </span>
    </AppShell>;
  }
  return <AppShell>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeading title="Portfolio" />
      <p style={{ height: 1200 }}>Holdings</p>
    </div>
  </AppShell>;
}

function Lab() {
  const state = useSyncExternalStore(lab.subscribe, lab.snapshot);
  return <>
    {/* Routes remount their shell, as Next's per-page AppShell does. The
        outline is the first paint before the wallet providers load; turning
        it off hands over to the live page in one commit, as the app does. */}
    {state.outline ? <ProviderLoadingState /> : <Page key={state.path} path={state.path} />}
    {state.overlay === 'dialog' && <div role="dialog" aria-modal="true" aria-label="Lab sheet">Sheet</div>}
    {state.overlay === 'review' && <div data-review-viewport="">Review</div>}
  </>;
}

document.documentElement.dataset.harnessReady = 'true';
createRoot(document.getElementById('root')!).render(<Lab />);
