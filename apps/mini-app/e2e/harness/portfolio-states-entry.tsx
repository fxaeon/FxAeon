import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PortfolioPage from '../../src/app/portfolio/page';
import HistoryPage from '../../src/app/history/page';
import { ProviderLoadingState } from '../../src/components/ProviderLoadingState';

/**
 * Portfolio's first-load states against inline mock providers. One state per
 * page load: the spec sets `__portfolioStates` before this bundle runs, so
 * module caches (market history, positions) never leak between states.
 *
 * - provider: the static shell painted before the wallet providers load
 * - handoff: the provider shell, replaced by the live page (wallet still
 *   loading) when `__portfolioStates.handoff()` is called
 * - wallet: the real shell while the wallet provider initialises
 * - reads: wallet ready, every read still in flight
 * - loaded / empty / unavailable / dust: settled reads
 * - positions: settled reads with two open positions and their brake reads
 */
export type PortfolioStage = 'provider' | 'handoff' | 'wallet' | 'timeout' | 'reads' | 'loaded' | 'empty' | 'unavailable' | 'partial' | 'disconnected' | 'positions' | 'dust';
type HarnessState = { stage: PortfolioStage; route: string; theme: 'official' | 'dark' | 'light'; handoff?: () => void };

const state = ((globalThis as { __portfolioStates?: Partial<HarnessState> }).__portfolioStates ?? {}) as HarnessState;
state.stage ??= 'loaded';
state.route ??= '/portfolio';
state.theme = 'dark';
document.documentElement.dataset.theme = state.theme;
document.documentElement.style.colorScheme = 'dark';

function Harness() {
  const [handedOff, setHandedOff] = useState(false);
  useEffect(() => {
    state.handoff = () => { state.stage = 'wallet'; setHandedOff(true); };
  }, []);
  if (state.stage === 'provider' || (state.stage === 'handoff' && !handedOff)) return <ProviderLoadingState />;
  return state.route === '/history' ? <HistoryPage /> : <PortfolioPage />;
}

createRoot(document.getElementById('root')!).render(<Harness />);
document.documentElement.dataset.harnessReady = 'true';
