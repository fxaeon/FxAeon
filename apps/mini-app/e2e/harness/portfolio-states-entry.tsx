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
 * - hydrating: login ready while the authenticated wallet list is unresolved
 * - reads: wallet ready, every read still in flight
 * - loaded / empty / unavailable / dust: settled reads
 * - positions: settled reads with two open positions and their brake reads
 */
export type PortfolioStage = 'provider' | 'restoring' | 'hydrating' | 'handoff' | 'wallet' | 'timeout' | 'reads' | 'loaded' | 'empty' | 'unavailable' | 'partial' | 'disconnected' | 'positions' | 'dust';
type HarnessState = { stage: PortfolioStage; route: string; theme: 'official' | 'dark' | 'light'; address?: string; chainId?: number;
  handoff?: () => void; transition?: (stage: PortfolioStage, wallet?: { address?: string; chainId?: number }) => void; settleReads?: () => void };

const state = ((globalThis as { __portfolioStates?: Partial<HarnessState> }).__portfolioStates ?? {}) as HarnessState;
state.stage ??= 'loaded';
state.route ??= '/portfolio';
state.theme = 'dark';
document.documentElement.dataset.theme = state.theme;
document.documentElement.style.colorScheme = 'dark';

function Harness() {
  const [handedOff, setHandedOff] = useState(false);
  const [, setRevision] = useState(0);
  useEffect(() => { document.documentElement.dataset.portfolioStage = state.stage; });
  useEffect(() => {
    state.handoff = () => { state.stage = 'wallet'; setHandedOff(true); };
    state.transition = (stage, wallet = {}) => {
      state.stage = stage;
      Object.assign(state, wallet);
      if (['loaded', 'empty', 'unavailable', 'partial', 'positions', 'dust'].includes(stage)) state.settleReads?.();
      setRevision((revision) => revision + 1);
    };
  }, []);
  if (state.stage === 'provider' || (state.stage === 'handoff' && !handedOff)) return <ProviderLoadingState />;
  return state.route === '/history' ? <HistoryPage /> : <PortfolioPage />;
}

createRoot(document.getElementById('root')!).render(<Harness />);
document.documentElement.dataset.harnessReady = 'true';
